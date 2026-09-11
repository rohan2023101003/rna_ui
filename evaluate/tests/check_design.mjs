/**
 * Self-checks for the study design, run without a browser.
 *
 *     node evaluate/tests/check_design.mjs
 *
 * Everything the participant's browser does before a pixel is drawn - drawing
 * four schemes out of seventeen, laying them out in a counterbalanced order,
 * choosing which roads each trial asks about - is pure data, so it can be
 * checked here instead of by clicking through 40 sessions.
 *
 * The checks that matter:
 *   - every trial has an answer, and that answer is on the map
 *   - a number shared by several roads is accepted on any of them
 *   - the navigation goal is always reachable from the start
 *   - the four schemes are distinct, counterbalanced, and evenly spread over
 *     the seventeen across the whole sample
 */

import { BUNDLE } from '../js/bundle.js';
import { buildScheme, loadCityData } from '../js/scheme.js';
import {
  CONFIG, bfsHopsFrom, bfsPath, pickFindTrials, pickInferTrials,
  pickNavigateTrials, pickSchemes, planBlocks, practiceSetup, preferencePairs,
} from '../js/design.js';

let failures = 0;
function check(ok, message) {
  if (!ok) { failures += 1; console.log(`  FAIL  ${message}`); }
}

const counts = new Map();
const slots = new Map();      // "Scheme A|2" -> how many participants saw it there

console.log(`${BUNDLE.algorithms.length} algorithms, ${BUNDLE.cities.length} networks\n`);

for (const entry of BUNDLE.cities) {
  const city = await loadCityData(entry.id);
  check(city.roads.length === entry.roadCount, `${entry.id}: road count`);

  let bucketed = 0;
  let partitioned = 0;

  for (let pid = 1; pid <= CONFIG.participants; pid++) {
    const blocks = planBlocks(pid, city);
    const keys = blocks.map((b) => b.algorithm.key);
    check(new Set(keys).size === keys.length, `P${pid}: repeated scheme`);
    check(keys.length === CONFIG.schemesPerParticipant, `P${pid}: wrong scheme count`);

    // Presentation order must be a permutation of the drawn set, and the
    // labels must follow the scheme rather than the slot.
    const labels = blocks.map((b) => b.algorithm.label);
    check(new Set(labels).size === labels.length, `P${pid}: repeated label`);

    const pairs = preferencePairs(pid, pickSchemes(pid));
    check(pairs.length === (keys.length * (keys.length - 1)) / 2,
      `P${pid}: wrong number of preference pairs`);

    if (entry.id !== BUNDLE.cities[0].id) continue;   // sampling checks once
    keys.forEach((key, blockIndex) => {
      counts.set(key, (counts.get(key) || 0) + 1);
      const slot = `${labels[blockIndex]}|${blockIndex}`;
      slots.set(slot, (slots.get(slot) || 0) + 1);
    });
  }

  // Trial content, for every algorithm rather than only the ones drawn.
  for (const algorithm of BUNDLE.algorithms) {
    const scheme = buildScheme(city, algorithm.key);
    if (scheme.partitionCount > 1) partitioned += 1;
    if (scheme.bucketCount > 0) bucketed += 1;

    for (let blockIndex = 0; blockIndex < 4; blockIndex++) {
      for (const t of pickInferTrials(city, blockIndex, CONFIG.trials.infer, scheme)) {
        const answer = scheme.numbers[String(t.roadId)];
        check(answer !== undefined, `${entry.id}/${algorithm.key}: infer road has no number`);
        check(scheme.roadsWithNumber(answer).includes(String(t.roadId)),
          `${entry.id}/${algorithm.key}: infer road missing from its own number group`);
      }

      for (const t of pickFindTrials(city, blockIndex, CONFIG.trials.find, scheme)) {
        const matching = scheme.roadsWithNumber(t.target);
        check(matching.length >= 1, `${entry.id}/${algorithm.key}: find target not on map`);
        check(matching.every((id) => scheme.numbers[id] === t.target),
          `${entry.id}/${algorithm.key}: find candidate carries another number`);
      }

      const navs = pickNavigateTrials(city, blockIndex, CONFIG.trials.navigate, scheme);
      check(navs.length === CONFIG.trials.navigate,
        `${entry.id}/${algorithm.key}: only ${navs.length} navigation trials`);
      for (const t of navs) {
        const goals = scheme.roadsWithNumber(t.target);
        const hops = bfsHopsFrom(city, goals);
        check(hops[t.from] !== undefined,
          `${entry.id}/${algorithm.key}: navigation goal unreachable from start`);
        check(hops[t.from] === t.shortestHops,
          `${entry.id}/${algorithm.key}: shortestHops disagrees with the graph`);
        check(scheme.numbers[String(t.from)] !== t.target,
          `${entry.id}/${algorithm.key}: navigation starts on the goal number`);
        // The window must hold against the *nearest* road carrying the number,
        // not against the road the picker happened to name. Otherwise a
        // bucketed scheme hands out one-hop journeys and looks easier for a
        // reason that has nothing to do with its numbering.
        check(t.shortestHops >= 4 && t.shortestHops <= 9,
          `${entry.id}/${algorithm.key}: journey is ${t.shortestHops} hops, `
          + 'outside the intended 4-9');

        // The route shown to the participant afterwards has to be a real route
        // through the network, and has to be the shortest one - it is what
        // route deviation is measured against.
        const best = bfsPath(city, t.from, goals);
        check(best !== null, `${entry.id}/${algorithm.key}: no route to the goal`);
        if (best) {
          check(best.length - 1 === t.shortestHops,
            `${entry.id}/${algorithm.key}: shown route is ${best.length - 1} steps, `
            + `shortest is ${t.shortestHops}`);
          check(Number(best[0]) === Number(t.from),
            `${entry.id}/${algorithm.key}: route does not start where the trial does`);
          check(scheme.numbers[String(best[best.length - 1])] === t.target,
            `${entry.id}/${algorithm.key}: route does not end on the target number`);
          // Every consecutive pair must actually share a junction, or the
          // "shortest route" is a line drawn through roads that do not meet.
          for (let k = 1; k < best.length; k++) {
            const neighbours = city.adj[String(best[k - 1])] || [];
            check(neighbours.includes(Number(best[k])),
              `${entry.id}/${algorithm.key}: route step ${k} is not a real connection`);
          }
        }
      }
    }

    // How the map will be painted: a colour per partition, and extra width for
    // the segments of one physical road.
    const colours = new Set(city.roads.map((r) => scheme.colourOf(r.i)));
    if (scheme.partitionCount < 2) {
      check(colours.size === 1 && colours.has(null),
        `${entry.id}/${algorithm.key}: unpartitioned scheme is being coloured`);
    } else {
      check(!colours.has(null) || colours.size > 1,
        `${entry.id}/${algorithm.key}: partitioned scheme is not being coloured`);
      for (const road of city.roads) {
        const same = scheme.bucketOf(road.i);
        const shades = new Set(same.map((id) => scheme.colourOf(id)));
        check(shades.size === 1,
          `${entry.id}/${algorithm.key}: one physical road drawn in two colours`);
      }
    }
    const thick = city.roads.filter((r) => scheme.isBucketed(r.i)).length;
    check((thick > 0) === (scheme.bucketCount > 0),
      `${entry.id}/${algorithm.key}: thicker roads disagree with the bucket count`);
    check(!thick || algorithm.bucketed,
      `${entry.id}/${algorithm.key}: unbucketed scheme has roads sharing a number `
      + 'inside one partition');

    // Roads sharing a number are one physical road (same partition) or the
    // same number in another partition - never an accident.
    for (const [id, number] of Object.entries(scheme.numbers)) {
      const group = scheme.roadsWithNumber(number);
      check(group.includes(id), `${entry.id}/${algorithm.key}: road ${id} not in its group`);
      if (group.length > 1 && scheme.partitionCount > 1) {
        const parts = new Set(group.map((r) => scheme.partition[r]));
        const bucket = scheme.bucketOf(id);
        check(bucket.every((r) => scheme.partition[r] === scheme.partition[id]),
          `${entry.id}/${algorithm.key}: bucket spans partitions`);
        check(parts.size > 1 || bucket.length === group.length,
          `${entry.id}/${algorithm.key}: single-partition group is not one bucket`);
      }
    }
  }

  console.log(`  ${entry.id.padEnd(22)} ${String(city.roads.length).padStart(5)} roads  `
    + `${partitioned}/17 schemes partitioned, ${bucketed}/17 bucketed`);
}

console.log('\n  how often each algorithm is seen across '
  + `${CONFIG.participants} participants:`);
const seen = [...counts.entries()].sort((a, b) => b[1] - a[1]);
check(seen.length === BUNDLE.algorithms.length,
  `only ${seen.length} of ${BUNDLE.algorithms.length} algorithms are ever drawn`);
const most = seen[0][1];
const least = seen[seen.length - 1][1];
check(most - least <= 2, `uneven draw: ${most} vs ${least}`);
console.log('    ' + seen.map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`    every algorithm drawn ${least}-${most} times`);

// Counterbalancing: each of the four scheme slots must appear in each of the
// four positions equally often, so no scheme is systematically judged while
// people are still warming up or already tired.
const slotCounts = [...slots.values()];
check(slots.size === CONFIG.schemesPerParticipant ** 2,
  `counterbalancing covers only ${slots.size} of `
  + `${CONFIG.schemesPerParticipant ** 2} scheme/position combinations`);
check(Math.max(...slotCounts) === Math.min(...slotCounts),
  `unbalanced order: ${Math.min(...slotCounts)}-${Math.max(...slotCounts)} per slot`);
console.log(`\n  order counterbalancing: each scheme slot appears in each of the `
  + `${CONFIG.schemesPerParticipant} positions ${slotCounts[0]} times`);

// --------------------------------------------------------------------------
// The other two ways of choosing schemes, and every count the setup screen
// will accept. The order must stay balanced whichever route the set came from.
// --------------------------------------------------------------------------

const city = await loadCityData(BUNDLE.cities[0].id);
const pool = BUNDLE.algorithms.map((a) => a.key);
const [minCount, maxCount] = CONFIG.schemeCountRange;

console.log('\n  scheme selection modes:');
for (let n = minCount; n <= maxCount; n++) {
  // An explicit set, as the setup screen produces it.
  const picked = pool.slice(0, n);
  const seen = new Map();
  let ok = true;
  for (let pid = 1; pid <= CONFIG.participants; pid++) {
    const blocks = planBlocks(pid, city, picked);
    const keys = blocks.map((b) => b.algorithm.key);
    if (keys.length !== n || new Set(keys).size !== n) ok = false;
    if ([...keys].sort().join() !== [...picked].sort().join()) ok = false;
    blocks.forEach((b, position) => {
      const slot = `${b.algorithm.label}|${position}`;
      seen.set(slot, (seen.get(slot) || 0) + 1);
    });
    const schemes = pickSchemes(pid, picked);
    if (preferencePairs(pid, schemes).length !== (n * (n - 1)) / 2) ok = false;
  }
  check(ok, `${n} chosen schemes: wrong set, order or practice scheme`);
  // Every scheme in every position, as evenly as 40 participants divide.
  const counts = [...seen.values()];
  check(seen.size === n * n,
    `${n} chosen schemes: only ${seen.size} of ${n * n} scheme/position combinations`);
  check(Math.max(...counts) - Math.min(...counts) <= 1,
    `${n} chosen schemes: order unbalanced (${Math.min(...counts)}-${Math.max(...counts)})`);
  console.log(`    ${n} schemes: all ${n * n} scheme/position combinations used, `
    + `${Math.min(...counts)}-${Math.max(...counts)} participants each`);
}

// 'fixed' mode: CONFIG.fixedSchemes, with no per-session choice.
const savedMode = CONFIG.schemeSelection;
const savedFixed = CONFIG.fixedSchemes;
CONFIG.schemeSelection = 'fixed';
CONFIG.fixedSchemes = ['mucs', 'mucs_BGP', 'middfs_BucsGP_d5', 'bfs'];
const fixedSets = new Set();
for (let pid = 1; pid <= CONFIG.participants; pid++) {
  fixedSets.add(pickSchemes(pid).map((a) => a.key).sort().join());
}
check(fixedSets.size === 1, "'fixed' mode gave different participants different schemes");
console.log(`    'fixed' mode: all ${CONFIG.participants} participants get `
  + `${CONFIG.fixedSchemes.join(', ')}`);
CONFIG.schemeSelection = savedMode;
CONFIG.fixedSchemes = savedFixed;

// --------------------------------------------------------------------------
// Trial counts. The setup screen lets these be anything in `trialRange`, so
// every task has to hand back exactly what it was asked for, at both ends of
// the range, on the smallest network as well as the largest.
// --------------------------------------------------------------------------

console.log('\n  trial counts:');
const smallest = await loadCityData(
  [...BUNDLE.cities].sort((a, b) => a.roadCount - b.roadCount)[0].id);
const largest = await loadCityData(
  [...BUNDLE.cities].sort((a, b) => b.roadCount - a.roadCount)[0].id);

for (const net of [smallest, largest]) {
  const shortfalls = [];
  for (const algorithm of BUNDLE.algorithms) {
    const scheme = buildScheme(net, algorithm.key);
    for (const [task, pick] of [['infer', pickInferTrials], ['find', pickFindTrials],
                                ['navigate', pickNavigateTrials]]) {
      const [lo, hi] = CONFIG.trialRange[task];
      for (const n of [lo, CONFIG.trials[task], hi]) {
        const got = pick(net, 0, n, scheme).length;
        // Asking for more trials than a task can supply is a real limit, not a
        // bug - a network only has so many roads with a distinct number - but
        // it must be visible rather than silently short.
        if (got !== n) shortfalls.push(`${algorithm.key}/${task}: asked ${n}, got ${got}`);
      }
    }
  }
  const worst = shortfalls.length;
  console.log(`    ${net.id.padEnd(21)} ${String(net.roads.length).padStart(5)} roads  `
    + (worst ? `${worst} combination(s) could not supply the maximum: `
               + shortfalls.slice(0, 2).join('; ')
             : 'every task supplies any count in range'));
}

// --------------------------------------------------------------------------
// The warm-up. Fixed for everyone, on a network nobody is scored on, and it has
// to be able to supply all three tasks or the session stalls before it starts.
// --------------------------------------------------------------------------

const warmup = practiceSetup();
const warmupCity = await loadCityData(warmup.city.id);
const warmupScheme = buildScheme(warmupCity, warmup.scheme.key);
check(warmup.city.id === CONFIG.practice.city,
  `practice network ${CONFIG.practice.city} is missing from the bundle`);
check(warmup.scheme.key === CONFIG.practice.scheme,
  `practice scheme ${CONFIG.practice.scheme} is missing from the bundle`);
check(warmupCity.roads.length
  === Math.min(...BUNDLE.cities.map((c) => c.roadCount)),
  'practice does not use the smallest network');
check(pickInferTrials(warmupCity, 99, warmup.counts.infer, warmupScheme).length
  === warmup.counts.infer, 'practice cannot supply its guesses');
check(pickFindTrials(warmupCity, 99, warmup.counts.find, warmupScheme).length
  === warmup.counts.find, 'practice cannot supply its searches');
check(pickNavigateTrials(warmupCity, 99, warmup.counts.navigate, warmupScheme).length
  === warmup.counts.navigate, 'practice cannot supply its journeys');
console.log(`\n  warm-up: ${warmup.city.id} (${warmupCity.roads.length} roads, `
  + `smallest of ${BUNDLE.cities.length}), ${warmup.scheme.key} `
  + `(${warmupScheme.partitionCount} zones, ${warmupScheme.bucketCount} shared numbers), `
  + `${warmup.counts.infer} guesses + ${warmup.counts.find} search + `
  + `${warmup.counts.navigate} journey, same for everyone`);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
