/**
 * Study design: what each participant sees, and in what order.
 *
 * Everything here is deterministic. Give the same participant number twice and
 * you get exactly the same conditions, in the same order, with the same roads
 * tested. That matters for two reasons: a participant who refreshes the page
 * resumes the identical study, and the analysis can reconstruct any session
 * from its participant number alone.
 */

import { BUNDLE } from './bundle.js';
import { buildScheme } from './scheme.js';

export const CONFIG = {
  participants: 40,

  // -- which map ----------------------------------------------------------
  // 'ask'   - the participant picks one of the six networks
  // 'fixed' - everyone uses FIXED_CITY (this is what gives the scheme
  //           comparison its power, so switch to it once the pilot is done)
  citySelection: 'ask',
  // Pick a map the setup screen shows no warning for. Brooklyn/Network-1 is too
  // small for partitioned schemes at the default trial counts - some guesses
  // would have to reuse a number answered in another zone - and
  // Hyderabad/Network-1 is the practice map.
  fixedCity: 'Brooklyn/Network-1',

  // -- which numbering schemes -------------------------------------------
  // There are 17 algorithm outputs and nobody can sit through all of them, so
  // a session covers a handful. Three ways to decide which:
  //
  // 'ask'    - the setup screen lists all 17 and you tick the ones to compare,
  //            alongside the map. For piloting: it lets you try any combination
  //            without editing code. Participants must NOT see this screen -
  //            it names the algorithms, which the blinding depends on hiding.
  // 'random' - each participant gets `schemesPerParticipant` drawn from the
  //            pool, seeded by participant number and spread evenly across the
  //            sample. Useful for a wide first pass over all 17.
  // 'fixed'  - everyone does `fixedSchemes`, in a counterbalanced order.
  //            **This is the setting for the real study.**
  //
  //     schemeSelection: 'fixed',
  //     fixedSchemes: ['mucs', 'mucs_BGP', 'middfs_BucsGP_d5', 'bfs'],
  //
  // Whichever mode, the *order* always comes from the participant number, so
  // no scheme is systematically shown first or last.
  schemeSelection: 'ask',
  schemesPerParticipant: 4,
  fixedSchemes: null,
  // How many schemes the setup screen will accept. One is allowed - useful for
  // checking a single algorithm end to end - though with one there is nothing
  // to compare it against, so the side-by-side round is skipped. The upper end
  // is a session-length limit, not a technical one.
  schemeCountRange: [1, 6],

  // -- how many trials ----------------------------------------------------
  // 'ask'   - the setup screen offers these as editable numbers
  // 'fixed' - the numbers below are used, and nothing is asked
  trialSelection: 'ask',
  // Chosen for a ~30 minute session. Raising `infer` improves the learnability
  // estimate; raising the others improves everything else but costs minutes.
  trials: { infer: 14, find: 4, navigate: 3 },
  // What the setup screen will accept, and the point below which a measure
  // stops meaning very much. `learnMin` is the smallest `infer` count that
  // still supports a learning-gain estimate: it compares the first third of a
  // block against the last third, so fewer than six leaves one or two trials
  // in each third and the number is mostly noise.
  trialRange: { infer: [1, 40], find: [1, 20], navigate: [1, 15] },
  learnMin: 6,

  // -- the warm-up --------------------------------------------------------
  // Practice is deliberately not configurable: it is the same for everyone, on
  // a network nobody is scored on, so that what people bring to their first
  // scored trial is the same thing. It covers all three tasks, because meeting
  // a task for the first time while being measured is what produces a slow,
  // error-filled first block.
  //
  // Hyderabad/Network-1 is the smallest of the six - 83 roads, under 3 km - so
  // the whole map fits on screen and nobody is learning to pan and zoom at the
  // same time as learning the task. mucs_BGP is partitioned *and* bucketed, so
  // the two things that confuse people - coloured zones, and two roads sharing
  // a number - are met here, with the answers shown, rather than mid-study.
  //
  // Practice answers are never recorded.
  practice: {
    city: 'Hyderabad/Network-1',
    scheme: 'mucs_BGP',
    infer: 2,
    find: 1,
    navigate: 1,
  },
  timeLimitMs: { find: 120000, navigate: 180000 },
  // No running clock is ever shown: a visible timer is a manipulation, not a
  // neutral display - it pushes people to trade accuracy for speed, and pushes
  // hardest on the hardest schemes. Times are recorded silently. The one
  // concession is here: the last stretch of a timed task shows a notice, so
  // nobody is cut off without warning.
  timeWarningMs: 30000,

  // -- the odd/even rule ----------------------------------------------------
  // The paper's convention: roads running north-south get odd numbers, roads
  // running east-west get even ones. It is part of the numbering system - the
  // way "odd interstates run north-south" is part of the US one, which drivers
  // are told rather than left to discover - so participants are told it up
  // front and it stays on screen.
  //
  // Telling everyone favours no scheme. All 17 were generated with the rule:
  // 99.7-99.9% of roads honour it in the 15 modified schemes and about 86% in
  // plain BFS and DFS. A scheme gains only by actually keeping to it, which is
  // exactly the property being claimed for it. Switching this off turns the
  // guessing task into discovering the rule unaided - a different question,
  // and one the paper does not ask.
  showParityRule: true,
  // A guess this far from the real number or closer counts as a success.
  // Expressed as a fraction of the number range, and fixed in advance so the
  // threshold cannot be chosen afterwards to flatter a result.
  inferSuccessTolerance: 0.10,

  // -- sending the results back -------------------------------------------
  // With a URL here the last screen becomes one button: the participant's
  // answers are posted straight to you and they are done. Without one they
  // have to download a file and send it themselves, which is where people
  // drop out. The download stays available either way, as the fallback for a
  // failed send.
  //
  // Any endpoint that accepts a POST works. Two are handled without extra
  // code - see evaluate/README.md for the five-minute setup of each:
  //
  //   Formspree     https://formspree.io/f/abcdwxyz        (50 a month free)
  //   Apps Script   https://script.google.com/macros/s/.../exec  (free, no cap)
  //
  // A session file is about 38 KB for four schemes.
  submit: {
    url: 'https://script.google.com/macros/s/AKfycbz70yHcfDqias6nWNhWgZMcI7619dFOFYI_aWiPu4tEexQYRqBO0BqJsa7KhlgZ8ibC/exec',
    // An optional email box, so you can thank people or chase a missing file.
    // Never required, and never needed for the results themselves.
    askEmail: false,
  },
};

/** Neutral names. A participant must never learn which algorithm is which. */
const SCHEME_LABELS = ['Scheme A', 'Scheme B', 'Scheme C', 'Scheme D',
                       'Scheme E', 'Scheme F'];

/**
 * A balanced Latin square for any number of conditions (Williams design).
 *
 * Each scheme appears once in every position, and each scheme precedes each
 * other scheme equally often. That removes any advantage from being shown
 * first (while the participant is still warming up) or last (while they are
 * tiring), and it removes any effect of one particular scheme being the one
 * you just came from.
 *
 * The first row is 0, n-1, 1, n-2, 2, ... and each later row adds one to it.
 * For an even n those n rows are balanced on their own; for an odd n the
 * reversed rows are needed too, which is why an odd count produces 2n orders.
 *
 * Generated rather than written out, so changing the number of schemes needs no
 * new table - which is what makes the count configurable at all.
 */
function balancedOrders(n) {
  const first = [];
  for (let j = 0; j < n; j++) {
    first.push(j % 2 === 0 ? j / 2 : n - (j + 1) / 2);
  }
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(first.map((v) => (v + i) % n));
  if (n % 2 === 1) {
    for (let i = 0; i < n; i++) rows.push([...rows[i]].reverse());
  }
  return rows;
}

/** Small seeded random number generator (mulberry32), so runs are repeatable. */
export function makeRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn any string into a stable numeric seed. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffled(items, rand) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --------------------------------------------------------------------------
// Which schemes this participant sees
// --------------------------------------------------------------------------

/** Turn algorithm keys into records, dropping any the bundle does not have. */
function resolve(keys) {
  return (keys || [])
    .map((key) => BUNDLE.algorithms.find((a) => a.key === key))
    .filter(Boolean);
}

/**
 * The numbering schemes for one participant, in label order.
 *
 * `chosenKeys` is what the setup screen picked, and takes precedence: it is
 * stored in the participant's session, so a resumed session gets the same set.
 * Otherwise `CONFIG.fixedSchemes` applies, and failing that the set is drawn
 * from the pool by participant number.
 *
 * The draw walks a shuffled copy of the whole pool offset by the participant
 * number, rather than sampling independently, so across 40 participants every
 * algorithm comes up a similar number of times instead of some being missed by
 * chance.
 *
 * Labels are assigned here, so "Scheme B" means the same algorithm all the way
 * through one participant's session - including the side-by-side comparison at
 * the end - while still meaning different algorithms for different
 * participants when the set is drawn rather than fixed.
 */
export function pickSchemes(participantId, chosenKeys = null) {
  const pool = BUNDLE.algorithms;
  let chosen = resolve(chosenKeys);

  if (!chosen.length && CONFIG.schemeSelection !== 'random') {
    chosen = resolve(CONFIG.fixedSchemes);
  }

  if (!chosen.length) {
    // One shuffled ordering of all 17, shared by everyone, read from a
    // different starting point per participant. Systematic rather than random
    // sampling: it spreads the 17 evenly over the sample.
    const wanted = Math.min(CONFIG.schemesPerParticipant, pool.length);
    const order = shuffled(pool, makeRandom(hashSeed('scheme-pool')));
    const start = ((participantId - 1) * wanted) % order.length;
    chosen = [];
    for (let i = 0; chosen.length < wanted && i < order.length; i++) {
      chosen.push(order[(start + i) % order.length]);
    }
    // Within a participant the order of the draw is itself shuffled, so
    // neighbouring participant numbers do not get the same pairings.
    chosen = shuffled(chosen, makeRandom(hashSeed(`schemes|${participantId}`)));
  }

  return chosen.map((algorithm, index) => ({
    ...algorithm,
    label: SCHEME_LABELS[index] || `Scheme ${index + 1}`,
    schemeIndex: index,
  }));
}

/**
 * The network and scheme the warm-up runs on, with a usable fallback.
 *
 * Named in CONFIG rather than derived, so every participant practises on
 * exactly the same thing. If the named network or scheme is ever missing from
 * the bundle - a renamed folder, a rebuilt `results/` - the warm-up falls back
 * to the smallest network and the first scheme rather than failing, because a
 * broken warm-up must not be able to stop a session.
 */
export function practiceSetup() {
  const city = BUNDLE.cities.find((c) => c.id === CONFIG.practice.city)
    || [...BUNDLE.cities].sort((a, b) => a.roadCount - b.roadCount)[0];
  const scheme = BUNDLE.algorithms.find((a) => a.key === CONFIG.practice.scheme)
    || BUNDLE.algorithms[0];
  return {
    city,
    scheme,
    counts: {
      infer: CONFIG.practice.infer,
      find: CONFIG.practice.find,
      navigate: CONFIG.practice.navigate,
    },
  };
}

/**
 * The blocks a given participant works through, in presentation order.
 *
 * The balanced square decides the order; `pickSchemes` decided the set. `city`
 * is the loaded network object, the same one for every block.
 */
export function planBlocks(participantId, city, chosenKeys = null) {
  const schemes = pickSchemes(participantId, chosenKeys);
  const orders = balancedOrders(schemes.length);
  const row = orders[(participantId - 1) % orders.length];
  return row.map((schemeIndex, blockIndex) => ({
    blockIndex,
    algorithm: schemes[schemeIndex],
    scheme: buildScheme(city, schemes[schemeIndex].key),
    city,
  }));
}

// --------------------------------------------------------------------------
// Choosing which roads to test
// --------------------------------------------------------------------------

/**
 * How a block's trials are chosen - and why it is not simply random.
 *
 * Plain random sampling was measured against the shipped data first, and it
 * failed in ways that bias exactly the comparison the study exists to make:
 *
 *   - the same number was asked twice in 28-44% of blocks, so the second time
 *     its answer had just been shown;
 *   - on the small networks about 28% of "find road N" targets, and about 30%
 *     of journey goals, had just been revealed by an earlier trial;
 *   - find targets landed on multi-segment roads four times as often as their
 *     share of the numbers, because sampling roads favours long roads.
 *
 * All three bite hardest on partitioned and bucketed schemes, which have the
 * fewest distinct numbers - so those schemes would have looked better for
 * reasons that have nothing to do with how good their numbering is.
 *
 * The rules, strongest first:
 *
 *   Never
 *     - use the same road twice in a block, or guess the same physical road
 *       (partition and number) twice;
 *     - ask a guess whose answer the block later asks you to find or travel to,
 *       because the guess's review would show where it is;
 *     - ask you to find or travel to a number whose location an earlier trial
 *       in the block has already shown.
 *   Avoid - relaxed only when a small network runs out, and recorded when it is
 *     - two guesses with the same number in different zones;
 *     - a trial on a road that shares a junction with the trial just before it.
 *
 * The last rule is applied to the *order* of the trials, never to which trials
 * are chosen. Filtering the choice for spacing was tried and measured: a number
 * spread over many segments is more likely to touch an earlier pick, so the
 * heaviest-bucketed schemes lost their multi-segment numbers - the easy ones to
 * find - more often than chance allows (z = -3.6). Choosing with the hard rules
 * alone and then arranging the order keeps the choice exactly as uniform as the
 * rules permit. Adjacency was already at chance level; ordering removes it.
 *
 * Selection runs find -> travel -> guess, the reverse of the order they are
 * shown in, because the later-shown tasks' targets are what the earlier-shown
 * guesses must avoid revealing. Everything is deterministic from the network,
 * block position and scheme, so a refreshed session gets identical trials.
 */

/** The most blocks a session can have; each gets its own share of the roads. */
const POOL_COUNT = 6;

/** Trials of one task in a block may not be closer than this, in junctions. */
const MIN_SEPARATION_HOPS = 2;

/**
 * A segment shorter than this fraction of its network's median is a stub: a
 * sub-metre digitising artefact, or a sliver where two roads meet. It cannot be
 * seen, let alone reasoned about, so it is never made a trial.
 */
const STUB_FRACTION = 0.25;

/** How far apart a journey's ends must be, in junctions crossed. */
const JOURNEY_HOPS = [4, 9];

const networkCache = new WeakMap();

/** Facts about one network the planner needs, computed once per session. */
function networkFacts(city) {
  if (networkCache.has(city)) return networkCache.get(city);
  const sorted = city.roads.map((r) => r.len).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const stub = new Set(city.roads
    .filter((r) => r.len < median * STUB_FRACTION).map((r) => r.i));

  // Deal every usable road into POOL_COUNT disjoint piles, in a shuffled order
  // fixed per network. Block k draws from pile k first, so the blocks of one
  // session test different roads for as long as the network has enough.
  const usable = city.roads
    .filter((r) => !stub.has(r.i) && (city.adj[String(r.i)] || []).length)
    .map((r) => r.i);
  const order = shuffled(usable, makeRandom(hashSeed(`${city.id}|pools`)));
  const pools = Array.from({ length: POOL_COUNT }, () => []);
  order.forEach((id, n) => pools[n % POOL_COUNT].push(id));

  const facts = {
    stub,
    pools,
    lengthOf: new Map(city.roads.map((r) => [r.i, r.len])),
    orientationOf: new Map(city.roads.map((r) => [r.i, r.o])),
  };
  networkCache.set(city, facts);
  return facts;
}

/** Block k's candidate roads: its own pile first, then the others in turn. */
function roadOrder(city, blockIndex) {
  const { pools } = networkFacts(city);
  const k = ((blockIndex % POOL_COUNT) + POOL_COUNT) % POOL_COUNT;
  const out = [];
  for (let j = 0; j < POOL_COUNT; j++) out.push(...pools[(k + j) % POOL_COUNT]);
  return out;
}

export function isStub(city, roadId) {
  return networkFacts(city).stub.has(Number(roadId));
}

/** 'NS', 'EW', or null - the direction the odd/even rule is judged on. */
export function orientationOf(city, roadId) {
  return networkFacts(city).orientationOf.get(Number(roadId)) || null;
}

/** What the paper's rule says a road's number should be: 'odd', 'even' or null. */
export function ruleParity(orientation) {
  if (orientation === 'NS') return 'odd';
  if (orientation === 'EW') return 'even';
  return null;
}

/**
 * The spacing rule for one task: each accepted road makes itself and every road
 * closer than MIN_SEPARATION_HOPS off-limits to the next trial of that task.
 */
function spacingRule(city) {
  const near = new Set();
  return {
    ok: (id) => !near.has(Number(id)),
    add(id) {
      // A local visited set, so a road already near an earlier trial does not
      // stop the search from marking what lies beyond it.
      const seen = new Set([Number(id)]);
      let frontier = [Number(id)];
      for (let d = 1; d < MIN_SEPARATION_HOPS; d++) {
        const next = [];
        for (const n of frontier) {
          for (const m of city.adj[String(n)] || []) {
            if (!seen.has(m)) { seen.add(m); next.push(m); }
          }
        }
        frontier = next;
      }
      for (const road of seen) near.add(road);
    },
  };
}

/**
 * Every trial of every task for one block.
 *
 * Returns `{ infer, find, navigate }`. Each trial carries `relaxed`: the names
 * of any soft rules that had to be dropped to fill it, empty when none were.
 * If a network cannot supply `counts` without breaking a hard rule, the block
 * is shorter rather than contaminated - the returned lengths are the truth.
 */
/** Roads that are the same as, or share a junction with, any of `roads`. */
function neighbourhood(city, roads) {
  const rule = spacingRule(city);
  for (const id of roads) rule.add(id);
  return rule;
}

/**
 * Arrange one task's trials so none sits next to the one shown before it.
 *
 * The trials themselves are already chosen; only their order changes. The
 * order starts from a seeded shuffle - never the selection order, which would
 * push trials chosen under a relaxed rule to the end of the block, and the end
 * of a block is exactly what learning gain measures. A greedy pass then takes,
 * at each step, the first remaining trial clear of the last one. A few seeded
 * reshuffles are tried and the order needing the fewest exceptions is kept; any
 * trial that still follows a neighbour is marked `spacing`, never hidden.
 */
function spaceOut(city, items, roadsOf, rand) {
  if (items.length < 2) return items.map((t) => ({ ...t, relaxed: [...(t.relaxed || [])] }));
  let best = null;
  for (let attempt = 0; attempt < 25 && (!best || best.exceptions); attempt++) {
    const order = shuffled(items, rand);
    const zones = order.map((item) => neighbourhood(city, roadsOf(item)));
    const clearOf = (i, j) => roadsOf(order[j]).every((id) => zones[i].ok(id));
    const remaining = order.map((_, i) => i);
    const out = [];
    let exceptions = 0;
    let last = -1;
    while (remaining.length) {
      let at = remaining.findIndex((i) => last < 0 || clearOf(last, i));
      const forced = at < 0;
      if (forced) { at = 0; exceptions += 1; }
      const i = remaining.splice(at, 1)[0];
      const relaxed = (order[i].relaxed || []).filter((r) => r !== 'spacing');
      if (forced) relaxed.push('spacing');
      out.push({ ...order[i], relaxed });
      last = i;
    }
    if (!best || exceptions < best.exceptions) best = { out, exceptions };
  }
  return best.out;
}

/**
 * Every trial of every task for one block.
 *
 * Returns `{ infer, find, navigate }` in the order they are shown. Each trial
 * carries `relaxed`: the names of any soft rules it needed, empty when none. If
 * a network cannot supply `counts` without breaking a hard rule, the block is
 * shorter rather than contaminated - the returned lengths are the truth.
 */
export function planTrials(city, blockIndex, scheme, counts) {
  const { stub } = networkFacts(city);
  const want = { infer: counts.infer || 0, find: counts.find || 0,
                 navigate: counts.navigate || 0 };
  const numberOf = (id) => scheme.numbers[String(id)];
  const zoneOf = (id) => scheme.partition[String(id)] ?? '';
  const seeded = (task) => makeRandom(
    hashSeed(`${city.id}|${blockIndex}|${scheme.key}|${task}`));

  const usedRoads = new Set();     // no road twice in a block, in any task
  const targets = new Set();       // numbers a find or travel trial asks for

  // --- find: uniform over numbers, not roads ------------------------------
  const numbers = [...new Set(city.roads
    .filter((r) => !stub.has(r.i) && numberOf(r.i) !== undefined)
    .map((r) => numberOf(r.i)))].sort((a, b) => a - b);
  const find = [];
  for (const number of shuffled(numbers, seeded('find'))) {
    if (find.length >= want.find) break;
    const roads = scheme.roadsWithNumber(number).map(Number);
    find.push({ roadId: roads.find((id) => !stub.has(id)) ?? roads[0],
                target: number, relaxed: [] });
    targets.add(number);
    for (const id of roads) usedRoads.add(id);
  }

  // --- travel: goal is the nearest road carrying a number, 4-9 hops away ----
  // Journeys can be reordered afterwards, so the leak rule is kept symmetric:
  // no journey's goal is any journey's starting number, whichever comes first.
  const [minHops, maxHops] = JOURNEY_HOPS;
  const starts = roadOrder(city, blockIndex).filter((id) => numberOf(id) !== undefined);
  const pickGoal = seeded('navigate');
  const startNumbers = new Set();
  const journeyGoals = new Set();
  const journeys = [];
  for (const from of starts) {
    if (journeys.length >= want.navigate) break;
    if (usedRoads.has(from) || journeyGoals.has(numberOf(from))) continue;

    // Collapse reachable roads to reachable numbers, keeping the nearest road
    // of each: arrival is by number, so that is where a journey really ends.
    const hops = bfsHops(city, from);
    const nearest = new Map();
    for (const [id, distance] of Object.entries(hops)) {
      const number = numberOf(id);
      if (number === undefined) continue;
      const best = nearest.get(number);
      if (best === undefined || distance < best.distance) {
        nearest.set(number, { distance, roadId: Number(id) });
      }
    }
    const options = [...nearest.entries()].filter(([number, { distance, roadId }]) =>
      distance >= minHops && distance <= maxHops
      && !stub.has(roadId) && !usedRoads.has(roadId)
      && number !== numberOf(from)
      && !targets.has(number) && !startNumbers.has(number));
    if (!options.length) continue;

    const [target, { distance, roadId }] =
      options[Math.floor(pickGoal() * options.length)];
    journeys.push({ from, to: roadId, target, shortestHops: distance, relaxed: [] });
    targets.add(target);
    journeyGoals.add(target);
    startNumbers.add(numberOf(from));
    usedRoads.add(from);
    usedRoads.add(roadId);
  }

  // --- guess: chosen last, so it avoids every target above -------------------
  const guessable = roadOrder(city, blockIndex).filter((id) =>
    numberOf(id) !== undefined && (city.adj[String(id)] || []).length >= 2);
  const buckets = new Set();
  const guessedNumbers = new Set();
  const infer = [];
  for (const uniqueNumber of [true, false]) {
    for (const id of guessable) {
      if (infer.length >= want.infer) break;
      const number = numberOf(id);
      const bucket = `${zoneOf(id)}|${number}`;
      if (usedRoads.has(id) || buckets.has(bucket) || targets.has(number)) continue;
      if (uniqueNumber && guessedNumbers.has(number)) continue;
      infer.push({ roadId: id, relaxed: [] });
      buckets.add(bucket);
      guessedNumbers.add(number);
      usedRoads.add(id);
    }
  }

  const plan = {
    find: spaceOut(city, find, (t) => scheme.roadsWithNumber(t.target), seeded('order-find')),
    navigate: spaceOut(city, journeys, (t) => [t.from], seeded('order-navigate')),
    infer: spaceOut(city, infer, (t) => [t.roadId], seeded('order-infer')),
  };

  // A number shared with an earlier guess (another zone's road) is flagged on
  // whichever of the pair is *shown* second - that is the one whose answer the
  // participant has glimpsed - so the flag follows the final order.
  const seen = new Set();
  for (const trial of plan.infer) {
    const number = numberOf(trial.roadId);
    trial.relaxed = trial.relaxed.filter((r) => r !== 'number-reused');
    if (seen.has(number)) trial.relaxed.push('number-reused');
    seen.add(number);
  }
  return { infer: plan.infer, find: plan.find, navigate: plan.navigate };
}

// --------------------------------------------------------------------------
// Routes
// --------------------------------------------------------------------------

/**
 * The shortest route from one road to the nearest of a set of goal roads.
 *
 * Returns the actual sequence of roads, start first, or `null` if no goal is
 * reachable. Used to show a participant what the best route was after they have
 * finished a journey - which is both the feedback that makes the task
 * learnable, and the check that the route-deviation number means what it says.
 */
export function bfsPath(city, from, goals) {
  const target = new Set([...goals].map(Number));
  const start = Number(from);
  if (target.has(start)) return [start];

  const cameFrom = new Map([[start, null]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of city.adj[String(node)] || []) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, node);
      if (target.has(next)) {
        const path = [next];
        let step = node;
        while (step !== null && step !== undefined) {
          path.push(step);
          step = cameFrom.get(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** Hop distances from one road to every other, across shared junctions. */
export function bfsHops(city, start) {
  return bfsHopsFrom(city, [start]);
}

/**
 * Hop distances from a set of roads outwards, all at once.
 *
 * Used for the navigation task, where the goal is every road carrying the
 * target number: the distance that matters is to whichever of them is nearest.
 */
export function bfsHopsFrom(city, starts) {
  const seen = {};
  const queue = [];
  for (const start of starts) {
    const id = Number(start);
    if (seen[id] === undefined) { seen[id] = 0; queue.push(id); }
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of city.adj[String(node)] || []) {
      if (seen[next] === undefined) {
        seen[next] = seen[node] + 1;
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Metres covered stepping from one road onto the next.
 *
 * Counted midpoint to midpoint - half of each road - because it is symmetric
 * and does not depend on which end of a road someone is imagined to enter.
 * Summed along a route it gives half the start road, every road in between in
 * full, and half the road arrived on.
 */
export function stepMetres(city, a, b) {
  const { lengthOf } = networkFacts(city);
  return ((lengthOf.get(Number(a)) || 0) + (lengthOf.get(Number(b)) || 0)) / 2;
}

/** Length of a route, in metres, by `stepMetres`. */
export function routeMetres(city, path) {
  let total = 0;
  for (let k = 1; k < path.length; k++) total += stepMetres(city, path[k - 1], path[k]);
  return total;
}

/** Minimal binary heap for Dijkstra; the networks are small, but correctness is not. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(key, value) {
    const a = this.items;
    a.push([key, value]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The shortest route by distance to the nearest goal road (Dijkstra).
 *
 * The study's primary route measure is in steps - one click is one step, and
 * the paper's own connectivity metrics count hops. Distance is recorded next
 * to it as the real-world check: a route with fewer but longer roads can be
 * shorter in steps and longer on the ground. Returns `{ metres, path }` or
 * `null` if no goal is reachable.
 */
export function shortestMetres(city, from, goals) {
  const target = new Set([...goals].map(Number));
  const start = Number(from);
  const dist = new Map([[start, 0]]);
  const prev = new Map([[start, null]]);
  const done = new Set();
  const heap = new MinHeap();
  heap.push(0, start);
  while (heap.size) {
    const [d, node] = heap.pop();
    if (done.has(node)) continue;
    done.add(node);
    if (target.has(node)) {
      const path = [];
      for (let step = node; step != null; step = prev.get(step)) path.push(step);
      return { metres: d, path: path.reverse() };
    }
    for (const next of city.adj[String(node)] || []) {
      const candidate = d + stepMetres(city, node, next);
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, node);
        heap.push(candidate, next);
      }
    }
  }
  return null;
}
