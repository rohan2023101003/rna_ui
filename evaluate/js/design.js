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
    url: '',
    // An optional email box, so you can thank people or chase a missing file.
    // Never required, and never needed for the results themselves.
    askEmail: true,
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
 * Trials are seeded by network and block position, not by participant. Every
 * participant therefore answers about the same roads in the same slot, which
 * removes a large source of noise: differences between schemes are not muddled
 * by some participants happening to get harder roads.
 */
function trialSeed(city, blockIndex, task) {
  return hashSeed(`${city.id}|${blockIndex}|${task}`);
}

/** Roads with enough neighbours that their number could reasonably be inferred. */
function inferableRoads(city) {
  return city.roads
    .filter((r) => (city.adj[String(r.i)] || []).length >= 2)
    .sort((a, b) => b.len - a.len);
}

export function pickInferTrials(city, blockIndex, count, scheme) {
  const rand = makeRandom(trialSeed(city, blockIndex, 'infer'));
  // Longer roads first: they are the ones a participant can actually reason
  // about from the numbers around them. Roads this scheme never numbered are
  // no use - there would be no answer to score the guess against.
  const pool = inferableRoads(city)
    .filter((r) => !scheme || scheme.numbers[String(r.i)] !== undefined)
    .slice(0, Math.max(count * 3, 30));
  return shuffled(pool, rand).slice(0, count).map((r) => ({ roadId: r.i }));
}

export function pickFindTrials(city, blockIndex, count, scheme) {
  const rand = makeRandom(trialSeed(city, blockIndex, 'find'));
  const numbered = city.roads.filter((r) => scheme.numbers[String(r.i)] !== undefined);
  return shuffled(numbered, rand).slice(0, count).map((r) => ({
    roadId: r.i,
    target: scheme.numbers[String(r.i)],
  }));
}

/** How far apart a journey's ends must be, in junctions crossed. */
const JOURNEY_HOPS = [4, 9];

/**
 * Navigation trials: far enough apart to be a real journey, close enough that
 * the task does not become tedious.
 *
 * The destination is a *number*, not a road, because a partitioned or bucketed
 * scheme gives that number to several roads and any of them is a legitimate
 * arrival. Everything here therefore works in numbers, and the length of a
 * journey is the distance to the **nearest** road carrying the target number.
 *
 * That last point is not a detail. Choosing a destination road 6 hops away and
 * then letting the participant finish at another stretch of the same street 1
 * hop away would produce journeys far shorter than intended - and only on the
 * partitioned and bucketed schemes, which reuse numbers. Those schemes would
 * then score better on route deviation and on time for a reason that has
 * nothing to do with their numbering. So the 4-9 hop window is applied to the
 * nearest road carrying the number, which is the journey the participant
 * actually faces.
 */
export function pickNavigateTrials(city, blockIndex, count, scheme) {
  const rand = makeRandom(trialSeed(city, blockIndex, 'navigate'));
  const [minHops, maxHops] = JOURNEY_HOPS;
  const ids = city.roads.map((r) => r.i)
    .filter((i) => (city.adj[String(i)] || []).length
      && scheme.numbers[String(i)] !== undefined);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 500) {
    const from = ids[Math.floor(rand() * ids.length)];
    const hops = bfsHops(city, from);

    // Collapse the reachable roads down to reachable *numbers*, keeping the
    // nearest road for each - that is where the journey actually ends.
    const nearest = new Map();
    for (const [id, distance] of Object.entries(hops)) {
      const number = scheme.numbers[id];
      if (number === undefined) continue;
      const best = nearest.get(number);
      if (best === undefined || distance < best.distance) {
        nearest.set(number, { distance, roadId: Number(id) });
      }
    }

    const candidates = [...nearest.entries()].filter(([number, { distance }]) =>
      distance >= minHops && distance <= maxHops
      // A start already carrying the target number would be over before it began.
      && number !== scheme.numbers[String(from)]);
    if (!candidates.length) continue;

    const [target, { distance, roadId }] =
      candidates[Math.floor(rand() * candidates.length)];
    if (out.some((t) => t.from === from && t.target === target)) continue;
    out.push({ from, to: roadId, target, shortestHops: distance });
  }
  return out;
}

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

/** Every pairing of this participant's schemes, for the preference questions. */
export function preferencePairs(participantId, schemes) {
  const rand = makeRandom(hashSeed(`pref|${participantId}`));
  const pairs = [];
  for (let i = 0; i < schemes.length; i++) {
    for (let j = i + 1; j < schemes.length; j++) {
      // Randomise which side each scheme appears on, so a habit of picking the
      // left-hand option does not favour one scheme.
      pairs.push(rand() < 0.5 ? { left: i, right: j } : { left: j, right: i });
    }
  }
  return shuffled(pairs, rand);
}
