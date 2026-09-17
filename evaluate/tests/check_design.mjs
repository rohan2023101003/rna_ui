/**
 * Self-checks for the study design, run without a browser.
 *
 *     node evaluate/tests/check_design.mjs
 *
 * Everything the participant's browser decides before a pixel is drawn - which
 * schemes, in what order, which roads each trial asks about - is pure data, so
 * it is checked here rather than by clicking through 40 sessions.
 *
 * The trial checks are exact, not statistical, wherever they can be: every
 * block of every scheme on every network is planned and each rule is asserted
 * trial by trial. The one statistical check - that find targets are uniform
 * over numbers - uses a threshold loose enough never to fail by chance and tight
 * enough to catch the bias it was written to catch.
 */

import { BUNDLE } from '../js/bundle.js';
import { buildScheme, loadCityData } from '../js/scheme.js';
import {
  CONFIG, bfsHopsFrom, bfsPath, isStub, pickSchemes, planBlocks, planTrials,
  practiceSetup, routeMetres, shortestMetres,
} from '../js/design.js';

let failures = 0;
const reported = new Map();
function check(ok, message) {
  if (ok) return;
  failures += 1;
  // One line per distinct problem, with a count, so a systematic fault does
  // not scroll a thousand identical lines past.
  const key = message.replace(/\d+/g, '#');
  reported.set(key, (reported.get(key) || 0) + 1);
  if (reported.get(key) === 1) console.log(`  FAIL  ${message}`);
}

/** Trial counts used for the exhaustive checks: the study's defaults. */
const COUNTS = { infer: 14, find: 4, navigate: 3 };
const BLOCKS = 6;

/** Some road of `b` is one of `a`'s roads or shares a junction with one. */
function touching(city, a, b) {
  const near = new Set();
  for (const id of a) {
    near.add(Number(id));
    for (const m of city.adj[String(id)] || []) near.add(m);
  }
  return b.some((id) => near.has(Number(id)));
}

// --------------------------------------------------------------------------
// Which schemes, and in what order
// --------------------------------------------------------------------------

console.log(`${BUNDLE.algorithms.length} algorithms, ${BUNDLE.cities.length} networks\n`);

// The draw checks control their own mode, so they test the design rather than
// whatever design.js happens to be set to today.
const saved = { mode: CONFIG.schemeSelection, fixed: CONFIG.fixedSchemes };
CONFIG.schemeSelection = 'random';
CONFIG.fixedSchemes = null;
{
  const city = await loadCityData(BUNDLE.cities[0].id);
  const seen = new Map();
  const slots = new Map();
  for (let pid = 1; pid <= CONFIG.participants; pid++) {
    const blocks = planBlocks(pid, city);
    const keys = blocks.map((b) => b.algorithm.key);
    const labels = blocks.map((b) => b.algorithm.label);
    check(new Set(keys).size === keys.length, `P${pid}: a scheme repeats`);
    check(keys.length === CONFIG.schemesPerParticipant, `P${pid}: wrong number of schemes`);
    check(new Set(labels).size === labels.length, `P${pid}: a label repeats`);
    blocks.forEach((b, position) => {
      seen.set(b.algorithm.key, (seen.get(b.algorithm.key) || 0) + 1);
      slots.set(`${b.algorithm.label}|${position}`, (slots.get(`${b.algorithm.label}|${position}`) || 0) + 1);
    });
  }
  const draws = [...seen.values()];
  check(seen.size === BUNDLE.algorithms.length,
    `only ${seen.size} of ${BUNDLE.algorithms.length} algorithms are ever drawn`);
  check(Math.max(...draws) - Math.min(...draws) <= 2, 'algorithms are drawn unevenly');
  const counts = [...slots.values()];
  check(Math.max(...counts) === Math.min(...counts), 'scheme order is not balanced');
  console.log(`  random draw: every algorithm seen ${Math.min(...draws)}-${Math.max(...draws)} `
    + `times over ${CONFIG.participants} participants; each slot in each position `
    + `${counts[0]} times`);

  const pool = BUNDLE.algorithms.map((a) => a.key);
  const [lo, hi] = CONFIG.schemeCountRange;
  for (let n = lo; n <= hi; n++) {
    const picked = pool.slice(0, n);
    const slotCounts = new Map();
    for (let pid = 1; pid <= CONFIG.participants; pid++) {
      const blocks = planBlocks(pid, city, picked);
      check([...blocks.map((b) => b.algorithm.key)].sort().join() === [...picked].sort().join(),
        `${n} chosen schemes: the set changed`);
      blocks.forEach((b, position) => {
        const k = `${b.algorithm.label}|${position}`;
        slotCounts.set(k, (slotCounts.get(k) || 0) + 1);
      });
    }
    const c = [...slotCounts.values()];
    check(slotCounts.size === n * n, `${n} chosen schemes: not every scheme in every position`);
    check(Math.max(...c) - Math.min(...c) <= 1, `${n} chosen schemes: order unbalanced`);
  }
  console.log(`  chosen sets of ${lo}-${hi}: every scheme in every position, balanced`);

  CONFIG.schemeSelection = 'fixed';
  CONFIG.fixedSchemes = ['mucs', 'mucs_BGP', 'middfs_BucsGP_d5', 'bfs'];
  const sets = new Set();
  for (let pid = 1; pid <= CONFIG.participants; pid++) {
    sets.add(pickSchemes(pid).map((a) => a.key).sort().join());
  }
  check(sets.size === 1, "'fixed' gives different participants different schemes");
  console.log("  'fixed': every participant gets the same four");
}
CONFIG.schemeSelection = saved.mode;
CONFIG.fixedSchemes = saved.fixed;

// --------------------------------------------------------------------------
// Trials: every rule, every block, every scheme, every network
// --------------------------------------------------------------------------

console.log(`\n  trial rules, ${BLOCKS} blocks x 17 schemes x 6 networks at ${COUNTS.infer}/${COUNTS.find}/${COUNTS.navigate}:`);

for (const entry of BUNDLE.cities) {
  const city = await loadCityData(entry.id);
  const tally = { trials: 0, spacing: 0, reused: 0, short: 0, blocks: 0, journeys: 0, overlap: 0, inferRoads: 0 };

  for (const algorithm of BUNDLE.algorithms) {
    const scheme = buildScheme(city, algorithm.key);
    const zone = (id) => scheme.partition[String(id)] ?? '';
    const inferByBlock = [];

    for (let b = 0; b < BLOCKS; b++) {
      const plan = planTrials(city, b, scheme, COUNTS);
      const tag = `${entry.id}/${algorithm.key}/b${b}`;
      tally.blocks += 1;
      if (plan.infer.length < COUNTS.infer || plan.find.length < COUNTS.find
          || plan.navigate.length < COUNTS.navigate) tally.short += 1;

      check(JSON.stringify(plan) === JSON.stringify(planTrials(city, b, scheme, COUNTS)),
        `${tag}: planning is not deterministic`);

      const inferNumbers = plan.infer.map((t) => scheme.numbers[String(t.roadId)]);
      const findTargets = plan.find.map((t) => t.target);
      const goals = plan.navigate.map((t) => t.target);
      const startNumbers = plan.navigate.map((t) => scheme.numbers[String(t.from)]);

      // No road twice anywhere in the block.
      const roads = [
        ...plan.infer.map((t) => t.roadId),
        ...plan.find.flatMap((t) => scheme.roadsWithNumber(t.target).map(Number)),
        ...plan.navigate.flatMap((t) => [t.from, t.to]),
      ];
      check(new Set(roads).size === roads.length, `${tag}: a road is used twice in one block`);

      // --- guesses ---
      const buckets = new Set();
      const shownSoFar = new Set();
      plan.infer.forEach((t, i) => {
        tally.trials += 1;
        const id = t.roadId;
        const number = scheme.numbers[String(id)];
        check(number !== undefined, `${tag}: a guess has no answer`);
        check(!isStub(city, id), `${tag}: a guess is on a stub`);
        check((city.adj[String(id)] || []).length >= 2, `${tag}: a guess has too few neighbours`);
        const bucket = `${zone(id)}|${number}`;
        check(!buckets.has(bucket), `${tag}: the same physical road is guessed twice`);
        buckets.add(bucket);
        check(!findTargets.includes(number) && !goals.includes(number),
          `${tag}: a guess reveals a number the block later asks for`);
        // `number-reused` exactly when an earlier-shown guess had this number.
        check(t.relaxed.includes('number-reused') === shownSoFar.has(number),
          `${tag}: number-reused flag is wrong`);
        if (shownSoFar.has(number)) tally.reused += 1;
        shownSoFar.add(number);
        const previous = plan.infer[i - 1];
        const adjacent = previous ? touching(city, [previous.roadId], [id]) : false;
        check(t.relaxed.includes('spacing') === adjacent, `${tag}: guess spacing flag is wrong`);
        if (adjacent) tally.spacing += 1;
      });
      inferByBlock.push(new Set(plan.infer.map((t) => t.roadId)));

      // --- finds ---
      check(new Set(findTargets).size === findTargets.length, `${tag}: a find target repeats`);
      plan.find.forEach((t, i) => {
        tally.trials += 1;
        const matching = scheme.roadsWithNumber(t.target).map(Number);
        check(matching.some((id) => !isStub(city, id)), `${tag}: a find target is only on stubs`);
        check(scheme.numbers[String(t.roadId)] === t.target, `${tag}: find road carries another number`);
        check(!inferNumbers.includes(t.target), `${tag}: a find target was revealed by a guess`);
        const previous = plan.find[i - 1];
        const adjacent = previous
          ? touching(city, scheme.roadsWithNumber(previous.target), matching) : false;
        check(t.relaxed.includes('spacing') === adjacent, `${tag}: find spacing flag is wrong`);
        if (adjacent) tally.spacing += 1;
      });

      // --- journeys ---
      check(new Set(goals).size === goals.length, `${tag}: a journey goal repeats`);
      plan.navigate.forEach((t, i) => {
        tally.trials += 1;
        tally.journeys += 1;
        const goalRoads = scheme.roadsWithNumber(t.target);
        const hops = bfsHopsFrom(city, goalRoads);
        check(hops[t.from] === t.shortestHops, `${tag}: shortestHops disagrees with the graph`);
        check(t.shortestHops >= 4 && t.shortestHops <= 9, `${tag}: journey is ${t.shortestHops} hops`);
        check(!isStub(city, t.to), `${tag}: the nearest goal road is a stub`);
        check(scheme.numbers[String(t.from)] !== t.target, `${tag}: journey starts on its goal`);
        check(!inferNumbers.includes(t.target) && !findTargets.includes(t.target),
          `${tag}: a journey goal was revealed earlier in the block`);
        // Symmetric, because journeys are reordered after being chosen.
        check(!startNumbers.includes(t.target), `${tag}: a journey goal is some journey's start`);

        const best = bfsPath(city, t.from, goalRoads);
        check(best && best.length - 1 === t.shortestHops, `${tag}: shown route is not the shortest`);
        if (best) {
          for (let k = 1; k < best.length; k++) {
            check((city.adj[String(best[k - 1])] || []).includes(Number(best[k])),
              `${tag}: shown route has a step that is not a real connection`);
          }
        }
        const byDistance = shortestMetres(city, t.from, goalRoads);
        check(byDistance !== null, `${tag}: no route by distance`);
        if (byDistance && best) {
          check(Math.abs(routeMetres(city, byDistance.path) - byDistance.metres) < 1e-6,
            `${tag}: distance route does not add up`);
          check(byDistance.metres <= routeMetres(city, best) + 1e-6,
            `${tag}: shortest-by-distance is longer than the shortest-by-steps route`);
          check(goalRoads.map(Number).includes(Number(byDistance.path.at(-1))),
            `${tag}: distance route does not end on the goal number`);
        }
        const previous = plan.navigate[i - 1];
        const adjacent = previous ? touching(city, [previous.from], [t.from]) : false;
        check(t.relaxed.includes('spacing') === adjacent, `${tag}: journey spacing flag is wrong`);
        if (adjacent) tally.spacing += 1;
      });
    }

    for (let x = 0; x < 4; x++) {
      for (let y = x + 1; y < 4; y++) {
        tally.inferRoads += inferByBlock[x].size;
        tally.overlap += [...inferByBlock[x]].filter((r) => inferByBlock[y].has(r)).length;
      }
    }
  }

  const pct = (a, b) => `${(100 * a / Math.max(b, 1)).toFixed(1)}%`;
  if (city.roads.length >= 600) {
    check(tally.overlap === 0, `${entry.id}: guesses reuse roads across blocks on a large network`);
  }
  console.log(`    ${entry.id.padEnd(21)} ${String(city.roads.length).padStart(5)} roads  `
    + `short blocks ${pct(tally.short, tally.blocks).padStart(5)}  `
    + `next-to-previous ${pct(tally.spacing, tally.trials).padStart(5)}  `
    + `number reused across zones ${pct(tally.reused, tally.trials).padStart(5)}  `
    + `guess road reused across blocks ${pct(tally.overlap, tally.inferRoads).padStart(5)}`);
}

// --------------------------------------------------------------------------
// Find targets are uniform over numbers
// --------------------------------------------------------------------------

{
  const city = await loadCityData('Brooklyn/Network-2');
  const zs = [];
  let worst = 0;
  for (const algorithm of BUNDLE.algorithms) {
    const scheme = buildScheme(city, algorithm.key);
    const eligible = [...new Set(city.roads
      .filter((r) => !isStub(city, r.i) && scheme.numbers[String(r.i)] !== undefined)
      .map((r) => scheme.numbers[String(r.i)]))];
    const multi = (n) => scheme.roadsWithNumber(n).length > 1;
    const expected = eligible.filter(multi).length / eligible.length;
    if (expected === 0 || expected === 1) continue;       // nothing to test
    let hit = 0;
    let total = 0;
    for (let b = 0; b < 200; b++) {
      for (const t of planTrials(city, b, scheme, { infer: 0, find: 4, navigate: 0 }).find) {
        total += 1;
        if (multi(t.target)) hit += 1;
      }
    }
    const z = (hit / total - expected) / Math.sqrt(expected * (1 - expected) / total);
    zs.push(z);
    worst = Math.max(worst, Math.abs(z));
  }
  const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
  // Each |z| < 3.5 (about a 1% chance of any false alarm across the schemes),
  // and their mean near zero - the spacing filter this replaced gave -1.2.
  check(worst < 3.5, `find targets are not uniform over numbers (worst |z| = ${worst.toFixed(2)})`);
  check(Math.abs(mean) < 1.0, `find targets lean one way across schemes (mean z = ${mean.toFixed(2)})`);
  console.log(`\n  find targets uniform over numbers: worst |z| = ${worst.toFixed(2)}, `
    + `mean z = ${mean.toFixed(2)} across ${zs.length} schemes`);
}

// --------------------------------------------------------------------------
// The warm-up
// --------------------------------------------------------------------------

{
  const warmup = practiceSetup();
  const city = await loadCityData(warmup.city.id);
  const scheme = buildScheme(city, warmup.scheme.key);
  check(warmup.city.id === CONFIG.practice.city, `practice network ${CONFIG.practice.city} is missing`);
  check(warmup.scheme.key === CONFIG.practice.scheme, `practice scheme ${CONFIG.practice.scheme} is missing`);
  check(city.roads.length === Math.min(...BUNDLE.cities.map((c) => c.roadCount)),
    'practice does not use the smallest network');
  const plan = planTrials(city, 99, scheme, warmup.counts);
  for (const task of ['infer', 'find', 'navigate']) {
    check(plan[task].length === warmup.counts[task], `practice cannot supply its ${task} trials`);
  }
  console.log(`  warm-up: ${warmup.city.id} with ${warmup.scheme.key}, `
    + `${plan.infer.length} guesses + ${plan.find.length} search + ${plan.navigate.length} journey`);
}

// --------------------------------------------------------------------------
// How far each network can stretch
// --------------------------------------------------------------------------

{
  console.log('\n  most trials per task a block can supply without repeating an answer:');
  for (const entry of BUNDLE.cities) {
    const city = await loadCityData(entry.id);
    let tightest = null;
    for (const algorithm of BUNDLE.algorithms) {
      const scheme = buildScheme(city, algorithm.key);
      const got = {};
      for (const task of ['infer', 'find', 'navigate']) {
        const ask = { infer: 0, find: 0, navigate: 0, [task]: CONFIG.trialRange[task][1] };
        got[task] = planTrials(city, 0, scheme, ask)[task].length;
      }
      const room = Math.min(got.infer / CONFIG.trialRange.infer[1],
        got.find / CONFIG.trialRange.find[1], got.navigate / CONFIG.trialRange.navigate[1]);
      if (!tightest || room < tightest.room) tightest = { room, key: algorithm.key, got };
    }
    const g = tightest.got;
    console.log(`    ${entry.id.padEnd(21)} tightest scheme ${tightest.key.padEnd(17)} `
      + `guesses ${String(g.infer).padStart(2)}/${CONFIG.trialRange.infer[1]}  `
      + `finds ${String(g.find).padStart(2)}/${CONFIG.trialRange.find[1]}  `
      + `journeys ${String(g.navigate).padStart(2)}/${CONFIG.trialRange.navigate[1]}`);
  }
}

if (failures) {
  console.log(`\n${failures} FAILED (${reported.size} distinct problem${reported.size === 1 ? '' : 's'})`);
} else {
  console.log('\nall checks passed');
}
process.exit(failures ? 1 : 0);
