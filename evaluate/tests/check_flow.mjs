/**
 * The whole study, run end to end in a real DOM, and the result file checked.
 *
 *     node evaluate/tests/check_flow.mjs
 *
 * The other suites check pieces. This one plays a participant: consent, a
 * participant number, the setup screen, every practice task, two scored blocks
 * with all three tasks, the end-of-block questions, and the automatic send - by
 * clicking the same buttons and roads a person would. It then opens the file
 * that would have been sent and checks every field the analysis relies on.
 *
 * `fetch` is replaced before the study loads, so nothing is ever posted to the
 * real submission address. The payload is captured and inspected instead.
 */

import { readFileSync } from 'node:fs';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('  skipped - run `npm install jsdom` to run the study end to end');
  process.exit(0);
}

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const html = readFileSync(`${ROOT}/evaluate/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/evaluate/', pretendToBeVisual: true });
const { window } = dom;

// -- a browser-shaped global scope for the study's modules -------------------
const expose = (name, value) => Object.defineProperty(globalThis, name, {
  value, configurable: true, writable: true });
for (const name of ['document', 'Node', 'Element', 'HTMLElement', 'SVGElement',
  'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'location', 'Blob']) {
  expose(name, typeof window[name] === 'function' && !/^[A-Z]/.test(name)
    ? window[name].bind(window) : window[name]);
}
expose('window', window);
expose('navigator', window.navigator);
expose('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
window.ResizeObserver = globalThis.ResizeObserver;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = () => {};
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.releasePointerCapture = () => {};
window.Element.prototype.hasPointerCapture = () => false;
window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 24, height: 12 });
window.SVGElement.prototype.getComputedTextLength = () => 24;

// Capture what would be sent; never touch the network.
const sent = [];
expose('fetch', async (url, options) => {
  sent.push({ url, options });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
});
window.fetch = globalThis.fetch;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));

// -- settings for the run, applied before the study starts --------------------
const design = await import('../js/design.js');
const { CONFIG, pickSchemes, practiceSetup, bfsPath } = design;
const { buildScheme, loadCityData } = await import('../js/scheme.js');
Object.assign(CONFIG, { citySelection: 'ask', schemeSelection: 'ask', trialSelection: 'ask' });
const configuredUrl = CONFIG.submit?.url || 'https://example.invalid/collect';
CONFIG.submit = { ...CONFIG.submit, url: configuredUrl };

const PID = 3;
const MAP = 'Brooklyn/Network-1';
const KEYS = ['mucs_BGP', 'bfs'];            // partitioned + bucketed, and a baseline
const COUNTS = { infer: 2, find: 1, navigate: 1 };

await import('../js/study.js');

// -- driving helpers -----------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = test();
    if (value) return value;
    if (errors.length) throw new Error(`page error while waiting for ${what}: ${errors[0]?.stack || errors[0]}`);
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}
const visible = (id) => { const el = document.getElementById(id); return el && !el.hidden ? el : null; };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
// The same screen is re-rendered for consecutive steps, so wait for a *new*
// Continue button rather than clicking the one just pressed a second time.
let lastNext = null;
async function next(screenId) {
  const button = await until(() => {
    const b = visible(screenId)?.querySelector('#next');
    return b && b !== lastNext && b.isConnected ? b : null;
  }, `#next on ${screenId}`);
  lastNext = button;
  click(button);
}
/** Click a road on the map the way a pointer does. */
function clickRoad(id) {
  const hit = document.querySelector(`.road-hit[data-road-id="${id}"]`);
  if (!hit) throw new Error(`road ${id} is not on the map`);
  const opts = { bubbles: true, cancelable: true, button: 0 };
  hit.dispatchEvent(new window.MouseEvent('pointerdown', opts));
  hit.dispatchEvent(new window.MouseEvent('pointerup', opts));
  hit.dispatchEvent(new window.MouseEvent('click', opts));
}
async function pressNext() {
  const button = await until(() => $('#trialNext'), 'the trial review');
  await sleep(400);                          // past the reflex guard
  click(button);
  await until(() => !$('#trialNext') || $('#trialNext') !== button, 'the review to close');
}
const promptTarget = () => Number($('#taskPrompt .prompt-target')?.textContent);

async function doInfer() {
  const input = await until(() => $('#inferInput'), 'a guess');
  // Checked mid-trial: the legend is cleared between tasks, by design.
  const legendEl = $('#mapLegend');
  if (legendEl.hidden) throw new Error('the map legend is hidden during a guess');
  if (CONFIG.showParityRule && !legendEl.querySelector('.legend-rule')) {
    throw new Error('the odd/even rule is not in the legend during a guess');
  }
  input.value = '7';
  click($('#inferSubmit'));
  await pressNext();
}
async function doFind(scheme) {
  await until(() => $('#findGiveUp'), 'a search');
  const target = promptTarget();
  clickRoad(scheme.roadsWithNumber(target)[0]);
  await pressNext();
}
async function doTravel(scheme, city) {
  const trail = await until(() => $('#taskPrompt .path-trail'), 'a journey');
  const from = Number(trail.dataset.current);
  const route = bfsPath(city, from, scheme.roadsWithNumber(promptTarget()));
  for (const step of route.slice(1)) {
    clickRoad(step);
    await sleep(5);
  }
  await pressNext();
}

// -- the participant ---------------------------------------------------------------
const run = (async () => {
  await until(() => visible('welcome'), 'the welcome screen');
  const consent = $('#consent');
  consent.checked = true;
  consent.dispatchEvent(new window.Event('change', { bubbles: true }));
  await next('welcome');

  const pid = await until(() => visible('identify')?.querySelector('#pid'), 'participant number');
  pid.value = String(PID);
  await next('identify');
  await next('background');

  // Setup: map, schemes, trial counts.
  const setup = await until(() => visible('background')?.querySelector('.setup-box'), 'the setup screen');
  click(setup.ownerDocument.querySelector(`input[name="city"][value="${MAP}"]`));
  for (const box of document.querySelectorAll('input[name="scheme"]')) box.checked = KEYS.includes(box.value);
  for (const [task, n] of Object.entries(COUNTS)) {
    document.querySelector(`input[name="trial"][data-key="${task}"]`).value = String(n);
  }
  await next('background');

  // Practice: the rule is explained first, then all three tasks.
  const intro = await until(() => visible('instructions'), 'the practice intro');
  if (CONFIG.showParityRule && !intro.querySelector('.rule-box')) throw new Error('the odd/even rule is not explained before practice');
  await next('instructions');
  const warm = practiceSetup();
  const warmCity = await loadCityData(warm.city.id);
  const warmScheme = buildScheme(warmCity, warm.scheme.key);
  if (!$('.north-arrow')) throw new Error('there is no north arrow');
  for (let i = 0; i < warm.counts.infer; i++) await doInfer();
  await next('instructions');
  for (let i = 0; i < warm.counts.find; i++) await doFind(warmScheme);
  await next('instructions');
  for (let i = 0; i < warm.counts.navigate; i++) await doTravel(warmScheme, warmCity);
  await next('instructions');                     // "That is the idea"

  // Scored blocks.
  const city = await loadCityData(MAP);
  const schemes = pickSchemes(PID, KEYS);
  for (let b = 0; b < KEYS.length; b++) {
    await next('instructions');                   // block intro
    const label = await until(() => $('#schemeBadge b')?.textContent, 'the scheme badge');
    const scheme = buildScheme(city, schemes.find((s) => s.label === label).key);
    for (let i = 0; i < COUNTS.infer; i++) await doInfer();
    await next('instructions');
    for (let i = 0; i < COUNTS.find; i++) await doFind(scheme);
    await next('instructions');
    for (let i = 0; i < COUNTS.navigate; i++) await doTravel(scheme, city);

    // End-of-block questions: the rating is required.
    const q = await until(() => visible('questionnaire'), 'the end-of-block questions');
    click(q.querySelector('#next'));
    await sleep(30);
    if (q.querySelector('#ratingWarn').hidden) throw new Error('continuing without a rating was allowed');
    click(q.querySelector('input[name="couldBeReal"][value="5"]'));
    q.querySelector('#blockComment').value = `comment ${b}`;
    click(q.querySelector('#next'));
    await until(() => !visible('questionnaire') || visible('questionnaire') !== q || !q.querySelector('#blockComment'), 'the questions to close');
  }

  await until(() => /Sent/.test($('#sendStatus')?.textContent || ''), 'the automatic send', 5000);
})();

let flowError = null;
await run.catch((e) => { flowError = e; });

// -- the checks ---------------------------------------------------------------------
let failures = 0;
const check = (ok, name) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failures += 1;
};

check(!flowError, `the whole study runs start to finish${flowError ? ` - ${flowError.message}` : ''}`);
check(errors.length === 0, `no errors on the page${errors.length ? ` - ${errors[0]}` : ''}`);
check(!document.querySelector('#compare'), 'the side-by-side comparison screen is gone');

check(sent.length === 1, `results sent exactly once (sent ${sent.length})`);
const post = sent[0];
check(post?.url === configuredUrl, 'sent to the configured address');
check(/text\/plain/.test(post?.options?.headers?.['Content-Type'] || '')
  || /formspree/.test(configuredUrl), 'sent as text/plain (no CORS preflight)');

let data = null;
try { data = JSON.parse(post.options.body); } catch { /* checked below */ }
check(Boolean(data), 'the payload is valid JSON');

if (data) {
  const scored = data.trials;
  const expected = KEYS.length * (COUNTS.infer + COUNTS.find + COUNTS.navigate);
  check(scored.length === expected, `${expected} scored trials recorded (got ${scored.length})`);
  check(data.practiceTrials.length === 4, `4 warm-up trials recorded separately (got ${data.practiceTrials.length})`);
  check(data.practiceTrials.every((t) => t.phase === 'practice' && t.city === 'Hyderabad/Network-1'),
    'warm-up trials are labelled practice, on the practice map');
  check(scored.every((t) => t.phase === 'scored' && t.city === MAP), 'scored trials are labelled scored, on the chosen map');
  check(!('preference' in data) && !('context' in data), 'no comparison or end-of-study context data');
  check(data.plan.length === KEYS.length
    && data.plan.every((p) => p.infer === COUNTS.infer && p.find === COUNTS.find && p.navigate === COUNTS.navigate),
    'each block records what it planned');
  check(JSON.stringify(data.trialCounts) === JSON.stringify({ infer: 2, find: 1, navigate: 1 }),
    'trial counts from the setup screen are recorded');
  check(data.schemes.map((s) => s.algorithm).sort().join() === [...KEYS].sort().join(),
    'the schemes used are recorded, unblinded');
  check(Boolean(data.finishedAt), 'the finish time is in the file that was sent');
  // `submittedAt` cannot be inside the payload it describes - it is set once the
  // send succeeds (the receiving script timestamps the file itself). It must be
  // in the browser's saved copy, which is what a retry or a resume reads.
  const savedCopy = JSON.parse(window.localStorage.getItem('rna-study-session') || '{}');
  check(Boolean(savedCopy.submittedAt), "the browser's saved copy records that it was sent");

  const all = [...data.practiceTrials, ...scored];
  const counters = ['pans', 'zooms', 'panEvents', 'zoomEvents', 'toolPresses',
    'clicks', 'emptyClicks', 'hovers', 'hiddenMs', 'ms'];
  check(all.every((t) => counters.every((k) => Number.isFinite(t[k]))), 'every trial has every counter and its time');
  check(all.every((t) => Array.isArray(t.relaxed)), 'every trial records which selection rules were relaxed');

  const infer = all.filter((t) => t.task === 'infer');
  check(infer.every((t) => t.guess === 7 && Number.isFinite(t.actual) && Number.isFinite(t.errorNorm)),
    'guesses record the guess, the answer and the error');
  check(infer.every((t) => ['NS', 'EW', null].includes(t.orientation)
    && (t.orientation === null || (t.ruleParity === (t.orientation === 'NS' ? 'odd' : 'even')
      && t.ruleFollowed === ((t.ruleParity === 'odd') === true)
      && t.ruleHolds === ((t.actual % 2 === 1) === (t.ruleParity === 'odd'))))),
    'guesses record direction, what the rule predicts, and both rule outcomes correctly');

  const finds = all.filter((t) => t.task === 'find');
  check(finds.every((t) => t.found === true && t.wrongClicks === 0 && t.warned === false),
    'searches record success, wrong clicks and the time notice');

  const trips = all.filter((t) => t.task === 'navigate');
  check(trips.every((t) => t.arrived === true && t.moves === t.shortestHops && t.routeDeviation === 1),
    'journeys taken by the shortest route score a deviation of exactly 1');
  check(trips.every((t) => Array.isArray(t.path) && Array.isArray(t.bestPath)
    && t.path.length - 1 === t.moves && t.bestPath.length - 1 === t.shortestHops),
    'journeys record the route taken and the shortest route');
  check(trips.every((t) => t.routeMetres > 0 && t.shortestMetres > 0
    && t.routeDeviationMetres >= 1 - 1e-9 && Array.isArray(t.shortestMetresPath)),
    'journeys record distance, and no route beats the shortest by distance');

  check(data.tlx.length === KEYS.length && data.tlx.every((t) => Number.isFinite(t.rawTlx)
    && Array.isArray(t.untouched) && t.untouched.length === 6),
    'workload recorded per block, with untouched sliders noted');
  check(data.ratings.length === KEYS.length
    && data.ratings.every((r, i) => r.couldBeReal === 5 && r.comment === `comment ${i}` && KEYS.includes(r.algorithm)),
    'the real-city rating and comment are recorded per scheme');
}

console.log(failures ? `\n  ${failures} FAILED` : '\n  the study runs end to end and records everything');
process.exit(failures ? 1 : 0);
