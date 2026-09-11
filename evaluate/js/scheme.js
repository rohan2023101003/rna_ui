/**
 * Loading a network, and reading one algorithm's numbering off it.
 *
 * `bundle.js` is only an index - 17 algorithms and 6 networks, a few kilobytes.
 * The road geometry lives in one file per network under `cities/`, fetched the
 * moment a participant picks their map, so nobody downloads five networks they
 * will never see.
 *
 * A "scheme" here is one algorithm applied to one network. Building it turns
 * the compact arrays in the data file into the two things every task needs:
 *
 *   numbers    road id -> the number this algorithm gave it
 *   buckets    the groups of roads that share one number
 *
 * Two roads can carry the same number for two different reasons, and the
 * paper's pipeline explains both:
 *
 *   Step 1, min-cut partitioning (`GP`) splits the network into partitions and
 *   restarts the numbering inside each one, so number 6 exists once per
 *   partition. Those are genuinely different roads.
 *
 *   Step 2, bucketing (`B`) gives every segment of one physical road the same
 *   number, the way a real street keeps its name across every block. Those are
 *   one road, drawn as several segments.
 *
 * The study shows both: partitions get different colours, bucketed roads are
 * drawn slightly thicker. And because a number can legitimately belong to more
 * than one road, every task accepts *any* road carrying the target number.
 */

import { BUNDLE } from './bundle.js';

const cityCache = new Map();
const schemeCache = new Map();

/** Look up one network's index entry by "City/Network-n". */
export function cityEntry(id) {
  return BUNDLE.cities.find((c) => c.id === id) || BUNDLE.cities[0];
}

/** Fetch a network's roads, adjacency and numberings. Cached per session. */
export async function loadCityData(id) {
  const entry = cityEntry(id);
  if (cityCache.has(entry.id)) return cityCache.get(entry.id);
  const module = await import(`./cities/${entry.file}`);
  cityCache.set(entry.id, module.CITY);
  return module.CITY;
}

/**
 * Colours for partitions.
 *
 * Chosen to stay apart for the common forms of colour blindness, and dark
 * enough to read a black number against. A network with a single partition is
 * left plain black - colour would imply a distinction that is not there.
 */
export const PARTITION_COLOURS = [
  '#1f4fa8', '#b8500f', '#1f7a4d', '#8a2b7a',
  '#7a6a12', '#0f6f80', '#a3243b', '#4a4a4a',
];

/**
 * One algorithm on one network, in the form the tasks want.
 *
 * `numbers` covers only roads that were actually assigned a number: a couple of
 * partitioned MIDDFS runs leave a road at 0, and presenting "0" to a
 * participant as a road number would be a lie.
 */
export function buildScheme(city, key) {
  const cacheKey = `${city.id}|${key}`;
  if (schemeCache.has(cacheKey)) return schemeCache.get(cacheKey);

  const entry = city.numbering[key];
  const summary = city.summary[key] || {};
  const numbers = {};
  const partition = {};
  const byNumber = new Map();          // number -> [road id, ...]
  const groups = new Map();            // partition|number -> [road id, ...]

  city.roads.forEach((road, index) => {
    const id = String(road.i);
    const number = entry.n[index];
    const part = entry.p ? entry.p[index] : null;
    if (part !== null && part >= 0) partition[id] = part;
    if (!number || number <= 0) return;         // never assigned
    numbers[id] = number;
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(id);
    const groupKey = `${part === null ? '' : part}|${number}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(id);
  });

  // A road is "bucketed" when it shares its number with another road in the
  // same partition - i.e. it is one segment of a longer physical road.
  const bucket = {};
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const id of members) bucket[id] = members;
  }

  const partitionCount = new Set(Object.values(partition)).size;
  const scheme = {
    key,
    numbers,
    partition,
    partitionCount,
    /** Colour for one road, or null when the network is not partitioned. */
    colourOf(roadId) {
      if (partitionCount < 2) return null;
      const part = partition[String(roadId)];
      if (part === undefined) return null;
      return PARTITION_COLOURS[part % PARTITION_COLOURS.length];
    },
    /** Every road carrying this number - any of them is a correct answer. */
    roadsWithNumber(number) {
      return byNumber.get(Number(number)) || [];
    },
    /** The other segments of the same physical road, including this one. */
    bucketOf(roadId) {
      return bucket[String(roadId)] || [String(roadId)];
    },
    isBucketed(roadId) {
      return bucket[String(roadId)] !== undefined;
    },
    bucketCount: summary.buckets || 0,
    range: [summary.min || 0, summary.max || 0],
    numberedIds: Object.keys(numbers),
  };
  schemeCache.set(cacheKey, scheme);
  return scheme;
}
