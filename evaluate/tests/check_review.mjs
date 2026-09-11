/**
 * Does a trial's answer actually stay on screen?
 *
 * The failure this guards against is invisible in a code review and easy to
 * miss in testing, because it depends on how a participant happens to submit:
 * clicking Submit worked, pressing Enter did not. So it is reproduced here
 * against a real DOM, with the real `review()` from tasks.js.
 */
import { readFileSync } from 'node:fs';

// jsdom is the one dev dependency in this repository, and only this file needs
// it. A missing install skips the checks loudly rather than failing the run.
let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('  skipped - run `npm install jsdom` to check the review screen');
  process.exit(0);
}

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const dom = new JSDOM(`<!doctype html><body>
  <div id="taskPrompt" hidden></div><div id="taskFeedback" hidden></div>
  <div id="mapLegend" hidden></div>
</body>`, { pretendToBeVisual: true });

// The extracted code runs inside the jsdom window, so it picks up that
// window's own document and timers - no globals to patch here.
const { document } = dom.window;

// Pull `review` and its guard out of tasks.js without importing the whole
// module graph (which needs the bundle and a renderer).
const src = readFileSync(process.env.TASKS_FILE || `${ROOT}/evaluate/js/tasks.js`, 'utf8');
const slice = (name, start) => {
  const from = src.indexOf(start);
  return src.slice(from, src.indexOf('\n}\n', from) + 3);
};
// jsdom does not run scripts by default, so the extracted source is compiled
// here and handed the window's own document and timer explicitly.
const code = [
  src.match(/const ADVANCE_GUARD_MS = \d+;/)[0],
  'const $ = (id) => document.getElementById(id);',
  slice('prompt', 'function prompt(html) {'),
  slice('review', "function review(html, buttonText = 'Next') {"),
  'return { review, ADVANCE_GUARD_MS };',
].join('\n\n');
const { review, ADVANCE_GUARD_MS: GUARD } =
  new Function('document', 'setTimeout', code)(dom.window.document,
                                               dom.window.setTimeout.bind(dom.window));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pressEnter = (target) => target.dispatchEvent(new dom.window.KeyboardEvent(
  'keydown', { key: 'Enter', bubbles: true, cancelable: true }));

let failures = 0;
const check = (ok, name) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failures += 1;
};

// -- 1. The submitting keypress must not dismiss the screen it opens --------
{
  const input = document.createElement('input');
  document.body.append(input);
  let done = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') review('<p>It was 50. You said 55.</p>').then(() => { done = true; });
  });
  pressEnter(input);                       // one keypress: submit
  await sleep(0);
  check(!done, 'the Enter that submits does not also dismiss the review');
  await sleep(GUARD + 50);
  check(!done, '...and the review is still up once the guard expires');
  pressEnter(document.body);               // a second, deliberate keypress
  await sleep(0);
  check(done, 'a later Enter does advance to the next trial');
  input.remove();
}

// -- 2. A reflex double-tap must not blow through the answer ---------------
{
  const input = document.createElement('input');
  document.body.append(input);
  let done = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') review('<p>answer</p>').then(() => { done = true; });
  });
  pressEnter(input);
  await sleep(80);                         // a fast second tap, ~80ms later
  pressEnter(document.body);
  await sleep(0);
  check(!done, 'a reflex second Enter 80ms later does not skip the answer');
  await sleep(GUARD + 50);
  check(!done, '...and it stays up, rather than firing late');
  input.remove();
}

// -- 3. The focused button is natively activated by Enter, so test a click --
{
  let done = false;
  review('<p>answer</p>').then(() => { done = true; });
  document.getElementById('trialNext').click();
  await sleep(0);
  check(!done, 'an immediate click on Next is ignored too');
  await sleep(GUARD + 50);
  document.getElementById('trialNext').click();
  await sleep(0);
  check(done, 'a deliberate click on Next advances');
}

// -- 4. The button really is focused, which is what made 2 and 3 necessary --
{
  review('<p>answer</p>');
  await sleep(0);
  check(document.activeElement?.id === 'trialNext',
    'Next is focused, so Enter reaches it natively - hence the guard on go()');
}

console.log(failures ? `\n  ${failures} FAILED` : '\n  review screen holds in every case');
process.exit(failures ? 1 : 0);
