/**
 * The evaluation session, start to finish.
 *
 * Runs entirely in the participant's browser. Nothing is sent anywhere: the
 * session is saved to this browser's local storage as it goes (so a refresh
 * does not lose work) and is handed back as a downloadable file at the end.
 *
 * The flow is written as one long async sequence rather than a state machine,
 * because that is far easier to read and to change:
 *
 *   welcome -> participant number -> background -> choose a map -> practice
 *     -> [ for each of 4 blocks:  infer, find, navigate, NASA-TLX ]
 *     -> preference -> context -> send
 *
 * The four blocks are four of the seventeen numbering schemes, drawn and
 * ordered by design.js from the participant number alone. They are never named
 * on screen - only "Scheme A" through "Scheme D" - so nobody can favour the
 * algorithm they think is meant to win.
 */

import { MapView } from '../../web/js/mapview.js';
import { BUNDLE } from './bundle.js';
import {
  CONFIG, pickFindTrials, pickInferTrials, pickNavigateTrials,
  pickSchemes, planBlocks, practiceSetup, preferencePairs,
} from './design.js';
import { buildScheme, loadCityData } from './scheme.js';
import {
  TaskMap, feedback, legend, prompt, runFindTrial,
  runInferTrial, runNavigateTrial,
} from './tasks.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rna-study-session';

/**
 * A fingerprint of the settings that shape a session.
 *
 * A half-finished session is kept in local storage so a refresh does not lose
 * work. That is right for a participant and wrong for whoever is building the
 * study: edit design.js, reload, and the saved session resumes straight into
 * the middle of the *old* design - same schemes, same trial counts, never
 * showing the setup screen again. It looks exactly like the edit did nothing.
 *
 * So the settings are hashed into the session. Change any of them and the old
 * session stops being resumable, because it no longer describes the study this
 * code would run.
 */
function configFingerprint() {
  return JSON.stringify([
    CONFIG.citySelection, CONFIG.fixedCity,
    CONFIG.schemeSelection, CONFIG.fixedSchemes, CONFIG.schemesPerParticipant,
    CONFIG.trialSelection, CONFIG.trials, CONFIG.practice,
    CONFIG.participants, CONFIG.inferSuccessTolerance,
  ]);
}

const state = {
  version: 2,
  participantId: null,
  startedAt: null,
  finishedAt: null,
  // "City/Network-n", e.g. "Hyderabad/Network-2".
  city: null,
  // The algorithms this session compares, in label order. Set by the setup
  // screen or by CONFIG, and stored so a resumed session keeps the same set.
  schemeKeys: null,
  // Which real algorithm each neutral scheme label stood for, so the analysis
  // can undo the blinding.
  schemes: null,
  // 'ask' | 'random' | 'fixed' - how the set above was arrived at.
  schemeSource: null,
  // How many trials of each task this session ran. Recorded because it is not
  // recoverable from the trials alone once someone stops early.
  trialCounts: null,
  background: {},
  trials: [],
  // The warm-up, kept apart from the scored trials so it can never be mistaken
  // for data. Recorded in full all the same: the first few attempts at a task
  // are where the steepest part of any learning curve is, and throwing them
  // away now would make that unrecoverable later.
  practiceTrials: [],
  tlx: [],
  preference: [],
  context: [],
  // What the code was configured to do when this session started. A session
  // saved under different settings cannot be resumed into this one.
  config: null,
  // Optional, and only if they type it on the last screen.
  email: null,
  submittedAt: null,
  userAgent: navigator.userAgent,
  screen: null,
};

let taskMap = null;
let currentCityKey = null;

// --------------------------------------------------------------------------
// Screen plumbing
// --------------------------------------------------------------------------

function show(id) {
  for (const screen of document.querySelectorAll('.screen')) {
    const active = screen.id === id;
    screen.hidden = !active;
    // Emptying the screens we are leaving guarantees ids stay unique across the
    // document. The task screen is exempt: it owns the map, which is expensive
    // to rebuild and must survive between trials.
    if (!active && screen.classList.contains('page')) screen.innerHTML = '';
  }
  // The task screen keeps its map, but its prompt must not linger: leaving
  // stale buttons in a hidden screen means a stray key press could act on a
  // trial that has already finished.
  if (id !== 'task') {
    const bar = document.getElementById('taskPrompt');
    if (bar) { bar.innerHTML = ''; bar.hidden = true; }
    const note = document.getElementById('taskFeedback');
    if (note) { note.textContent = ''; note.hidden = true; }
    legend('');
  }
  window.scrollTo(0, 0);
}

/** Render HTML into a screen and resolve when the named button is pressed. */
function screen(id, html, buttonId = 'next') {
  return new Promise((resolve) => {
    const el = $(id);
    el.innerHTML = html;
    show(id);
    const button = el.querySelector(`#${buttonId}`);
    if (button) button.addEventListener('click', () => resolve(el));
  });
}

function save() {
  try {
    state.config = state.config || configFingerprint();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* private browsing - the session still works, just cannot resume */ }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved) return null;
    // A session saved by an older build, or under different settings, describes
    // a different study. Resuming would mix two designs in one result file - and
    // while the study is still being built it would quietly hide every change
    // made since. Either way it is dropped and the session starts cleanly.
    if (saved.version !== state.version) return null;
    if (saved.config !== configFingerprint()) return null;
    return saved;
  } catch { return null; }
}

/** Has this exact trial already been answered? Used to resume after a refresh. */
function alreadyDone(key) {
  return state.trials.some((t) => t.key === key);
}

function record(entry) {
  state.trials.push(entry);
  save();
}

/** Show which numbering scheme is on screen, and how far through we are. */
function setScheme(label, part, total) {
  const badge = $('schemeBadge');
  if (!badge) return;
  badge.hidden = !label;
  badge.innerHTML = label
    ? `<b>${label}</b><span>part ${part} of ${total}</span>` : '';
}

function progress(done, total) {
  $('progressBar').style.width = `${(done / total) * 100}%`;
  $('progressText').textContent = `${done} of ${total} steps`;
}

// --------------------------------------------------------------------------
// Map handling
// --------------------------------------------------------------------------

function ensureMap() {
  if (taskMap) return taskMap;
  const view = new MapView($('map'), {
    roadWidth: 2.2,
    // No tooltip at all: hovering must never reveal a number.
    tooltipHtml: () => '',
    maxLabels: 400,
  });
  taskMap = new TaskMap(view);

  // Zoom controls. Scroll-to-zoom is not obvious to everyone, and a
  // participant who zooms themselves into a corner needs a way back.
  // Each press is one deliberate action, counted as such. `fit` and
  // `zoomToRoad` do not emit a gesture of their own - the study calls them
  // itself between trials - so the press is counted here instead.
  const tool = (handler) => () => { taskMap.countTool(); handler(); };
  $('zoomIn').addEventListener('click', tool(() => view.zoomBy(1.5)));
  $('zoomOut').addEventListener('click', tool(() => view.zoomBy(1 / 1.5)));
  $('zoomFit').addEventListener('click', tool(() => view.fit()));
  $('zoomTask').addEventListener('click', tool(() => {
    if (taskMap.focusGroup && taskMap.focusGroup.length > 1) {
      view.zoomToRoads(taskMap.focusGroup);
    } else if (taskMap.focusRoad != null) {
      view.zoomToRoad(taskMap.focusRoad);
    }
  }));
  return taskMap;
}

/** Hand one network's geometry to the renderer. Cheap to call repeatedly. */
function loadCity(city) {
  if (currentCityKey === city.id) return;
  currentCityKey = city.id;
  ensureMap().map.setNetwork({
    bbox: city.bbox,
    roads: {
      type: 'FeatureCollection',
      features: city.roads.map((r) => ({
        type: 'Feature',
        id: r.i,
        geometry: { type: 'LineString', coordinates: r.g },
        properties: { road_id: r.i, orientation: r.o, length_m: r.len, name: null },
      })),
    },
    nodes: null,
  });
}

// --------------------------------------------------------------------------
// The session
// --------------------------------------------------------------------------

async function run() {
  const saved = loadSaved();
  if (saved && saved.participantId && !saved.finishedAt) {
    const choice = await resumeOrRestart(saved);
    if (choice === 'restart') {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
      return;
    }
    Object.assign(state, saved);
  } else {
    await welcome();
    await identify();
    await background();
    await setupScreen();
    await practice();
  }

  if (!state.startedAt) state.startedAt = new Date().toISOString();

  // Everything from here needs the geometry, and a resumed session skipped the
  // setup screen, so the load happens here rather than inside it.
  const city = await loadCityData(state.city);
  const blocks = planBlocks(state.participantId, city, state.schemeKeys);
  state.city = city.id;
  state.schemeSource = state.schemeSource || CONFIG.schemeSelection;
  state.trialCounts = trialCounts();
  state.schemes = blocks
    .slice()
    .sort((a, b) => a.algorithm.schemeIndex - b.algorithm.schemeIndex)
    .map((b) => ({ label: b.algorithm.label, algorithm: b.algorithm.key }));
  save();

  const totalSteps = blocks.length * 5 + 2;
  let step = 0;

  for (const block of blocks) {
    await runBlock(block, blocks.length);
    step += 5;
    progress(step, totalSteps);
  }

  setScheme(null);
  await preferenceScreen();
  progress(++step, totalSteps);
  await contextScreen(blocks);
  progress(++step, totalSteps);

  state.finishedAt = new Date().toISOString();
  save();
  await finishScreen();
}

// -- opening screens -------------------------------------------------------

/**
 * Offer to continue a saved session, or throw it away and start fresh.
 *
 * The saved setup is spelled out, because "continue" skips the setup screen
 * entirely: whoever is piloting needs to see that continuing means keeping last
 * run's schemes and trial counts, not the ones they just went to change.
 */
function resumeOrRestart(saved) {
  return new Promise((resolve) => {
    const piloting = CONFIG.schemeSelection === 'ask' || CONFIG.trialSelection === 'ask';
    const counts = saved.trialCounts || {};
    const schemes = (saved.schemes || []).map((x) => x.algorithm);

    const summary = `
      <ul class="plain-list resume-summary">
        <li><b>Map:</b> ${saved.city || 'not chosen yet'}</li>
        <li><b>Schemes:</b> ${schemes.length
          ? `${schemes.length} &mdash; <code>${schemes.join('</code>, <code>')}</code>`
          : 'not chosen yet'}</li>
        <li><b>Trials per scheme:</b> ${counts.infer ?? '?'} guesses,
          ${counts.find ?? '?'} searches, ${counts.navigate ?? '?'} journeys</li>
      </ul>`;

    const resumeButton = `<button class="btn ${piloting ? 'btn-ghost ' : ''}btn-big"
      id="resume">Continue where I left off</button>`;
    const restartButton = `<button class="btn ${piloting ? '' : 'btn-ghost '}btn-big"
      id="restart">Start again from the beginning</button>`;

    const el = $('welcome');
    el.innerHTML = `
      <h1>Welcome back</h1>
      <p>You already started this study as participant
        <b>${saved.participantId}</b> and answered
        <b>${saved.trials.length}</b> questions.</p>
      ${piloting ? `<p class="setup-note"><b>Setup mode.</b> Continuing keeps the
        setup below and goes straight back to the tasks &mdash; the setup screen
        is not shown again. To pick different schemes, trial counts or a
        different map, start again.</p>` : ''}
      ${summary}
      <div class="btn-row">
        ${piloting ? restartButton + resumeButton : resumeButton + restartButton}
      </div>
      <p class="sub">Starting again clears the saved answers and lets you enter a
        participant number from scratch.</p>`;
    show('welcome');
    // Both listeners are attached now. Waiting on one before wiring the other
    // is what made "start again" do nothing.
    el.querySelector('#resume').addEventListener('click', () => resolve('resume'));
    el.querySelector('#restart').addEventListener('click', () => resolve('restart'));
  });
}

async function welcome() {
  await screen('welcome', `
    <h1>Road numbering study</h1>
    <p class="lead">Thank you for helping. This takes about <b>30 minutes</b>.</p>
    <p>You will be shown maps of real cities where every road has been given a
      number by a computer. Different parts of the study use different numbering
      systems. We want to find out which ones make sense to people.</p>
    <h2>What you will do</h2>
    <ul class="plain-list">
      <li>Guess numbers that have been hidden</li>
      <li>Find a road with a given number</li>
      <li>Travel from one road to another</li>
      <li>Say how demanding each part felt</li>
    </ul>
    <h2>Please know</h2>
    <ul class="plain-list">
      <li>There are no right answers we expect you to know. Your honest best
        guess is exactly what we need.</li>
      <li>We record your answers, how long they take, and how you move the map.
        We do not record your name or your location.${CONFIG.submit?.askEmail
          ? ' At the very end you may leave an email address so we can thank you'
            + ' or ask if something went wrong - it is optional, and the study'
            + ' works exactly the same if you leave it blank.' : ''}</li>
      <li>You can stop at any time by closing the tab. Nothing is sent anywhere
        unless you choose to send us the file at the end.</li>
    </ul>
    <label class="check-line">
      <input type="checkbox" id="consent"> I have read the above and agree to take part.
    </label>
    <div class="btn-row"><button class="btn btn-big" id="next" disabled>Begin</button></div>`);
}

function identify() {
  return new Promise((resolve) => {
    const el = $('identify');
    el.innerHTML = `
      <h1>Your participant number</h1>
      <p>The person who invited you gave you a number between 1 and
        ${CONFIG.participants}. Please type it in. It decides which maps you
        see, so it matters that it is correct.</p>
      <div class="field-big">
        <input type="number" id="pid" min="1" max="${CONFIG.participants}"
               placeholder="e.g. 7" autocomplete="off">
      </div>
      <p class="warn" id="pidWarn" hidden>Please enter a whole number between 1
        and ${CONFIG.participants}.</p>
      <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`;
    show('identify');
    // Scoped to this screen: several screens each contain a #next button, and a
    // document-wide lookup would find whichever appears first in the markup.
    el.querySelector('#next').addEventListener('click', () => {
      const value = Number(el.querySelector('#pid').value);
      if (!Number.isInteger(value) || value < 1 || value > CONFIG.participants) {
        el.querySelector('#pidWarn').hidden = false;
        return;
      }
      state.participantId = value;
      save();
      resolve();
    });
  });
}

async function background() {
  const cityNames = [...new Set(BUNDLE.cities.map((c) => c.city))];
  const cityQuestions = cityNames.map((name) => `
    <label class="field">
      <span class="field-label">How well do you know ${name}?</span>
      <select data-city="${name}">
        <option value="1">Never heard of it</option>
        <option value="2">Heard of it, never been</option>
        <option value="3">Visited briefly</option>
        <option value="4">Spent a lot of time there</option>
        <option value="5">I live or have lived there</option>
      </select>
    </label>`).join('');

  const el = await screen('background', `
    <h1>A few quick questions</h1>
    <p>These help us understand the results. All optional except your age range.</p>
    <label class="field">
      <span class="field-label">Age range</span>
      <select id="age">
        <option value="">Prefer not to say</option>
        <option>18-24</option><option>25-34</option><option>35-44</option>
        <option>45-54</option><option>55-64</option><option>65+</option>
      </select>
    </label>
    <label class="field">
      <span class="field-label">How often do you use maps (paper or digital)?</span>
      <select id="mapuse">
        <option value="">Prefer not to say</option>
        <option>Every day</option><option>A few times a week</option>
        <option>A few times a month</option><option>Rarely</option>
      </select>
    </label>
    ${cityQuestions}
    <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`);

  state.background = {
    age: el.querySelector('#age').value,
    mapUse: el.querySelector('#mapuse').value,
    familiarity: Object.fromEntries(
      [...el.querySelectorAll('[data-city]')].map((s) => [s.dataset.city, Number(s.value)])),
  };
  save();
}

/**
 * Which of the six road networks everyone works on.
 *
 * Each of the three cities has a small network and a large one, and they are
 * genuinely different maps rather than crops of each other, so all six are
 * offered. Set `CONFIG.citySelection = 'fixed'` to put every participant on the
 * same one, which is what the final study should do.
 */
/**
 * The setup screen: which map, which schemes, how many trials.
 *
 * Only the map question is meant for a participant. The rest is a pilot
 * control panel, shown while `schemeSelection`/`trialSelection` are `'ask'` and
 * gone once they are `'fixed'` - which is how this must be configured before
 * anyone is invited, because the scheme list names the algorithms.
 *
 * Written as one promise that resolves only on a *valid* Continue, rather than
 * re-rendering on a bad one. Re-rendering threw away everything the user had
 * just ticked, along with the warning explaining why, which looked exactly like
 * the button doing nothing.
 */
function setupScreen() {
  const askCity = CONFIG.citySelection !== 'fixed';
  const askSchemes = CONFIG.schemeSelection === 'ask';
  const askTrials = CONFIG.trialSelection === 'ask';
  if (!askCity) state.city = CONFIG.fixedCity;
  if (!askCity && !askSchemes && !askTrials) { save(); return Promise.resolve(); }

  const [minSchemes, maxSchemes] = CONFIG.schemeCountRange;
  const preset = new Set(state.schemeKeys || CONFIG.fixedSchemes
    || pickSchemes(state.participantId).map((a) => a.key));
  const counts = { ...CONFIG.trials, ...(state.trialCounts || {}) };

  const cityOptions = BUNDLE.cities.map((c) => `
    <label class="city-option">
      <input type="radio" name="city" value="${c.id}"
             ${state.city === c.id ? 'checked' : ''}>
      <span class="city-name">${c.city}
        <em>${c.roadCount > 500 ? 'large' : 'small'} network</em></span>
      <span class="city-meta">${c.roadCount} roads &middot;
        ${Math.round(c.lengthKm)} km of streets</span>
    </label>`).join('');

  const schemeOptions = BUNDLE.algorithms.map((a) => `
    <label class="scheme-option">
      <input type="checkbox" name="scheme" value="${a.key}"
             ${preset.has(a.key) ? 'checked' : ''}>
      <span class="scheme-name">${a.name}</span>
      <span class="scheme-tags">
        ${a.partitioned ? '<i class="tag tag-gp">partitioned</i>' : ''}
        ${a.bucketed ? '<i class="tag tag-b">bucketed</i>' : ''}
        ${a.baseline ? '<i class="tag tag-base">baseline</i>' : ''}
      </span>
      <code class="scheme-key">${a.key}</code>
    </label>`).join('');

  // Practice is deliberately absent: it is fixed in CONFIG for everyone, so
  // there is nothing to choose here.
  const TRIAL_FIELDS = [
    ['infer', 'Fill in the blank', 'guesses per scheme'],
    ['find', 'Find the road', 'searches per scheme'],
    ['navigate', 'Travel between roads', 'journeys per scheme'],
  ];
  const trialInputs = TRIAL_FIELDS.map(([key, label, help]) => {
    const [lo, hi] = CONFIG.trialRange[key];
    return `
      <label class="trial-field">
        <span class="trial-label">${label}<em>${help}</em></span>
        <input type="number" name="trial" data-key="${key}"
               min="${lo}" max="${hi}" step="1" value="${counts[key]}">
      </label>`;
  }).join('');

  return new Promise((resolve) => {
    const el = $('background');
    el.innerHTML = `
      ${askCity ? `
        <h1>Choose a map</h1>
        <p>Everything you do will be on this one map. Pick whichever you like -
          there is no right choice, and you do not need to know the city. The
          larger networks have more roads to look at and take a little more
          scrolling.</p>
        ${cityOptions}
        <p class="warn" id="cityWarn" hidden>Please pick one.</p>` : ''}

      ${askSchemes || askTrials ? `
        <div class="setup-box">
          <h2>Study setup</h2>
          <p class="setup-note"><b>Setup step &mdash; not for participants.</b>
            It names the algorithms, and the study depends on participants not
            knowing which scheme is which. Before inviting anyone set
            <code>schemeSelection: 'fixed'</code>,
            <code>trialSelection: 'fixed'</code> and <code>fixedSchemes</code>
            in <code>js/design.js</code>; this whole box then disappears.</p>` : ''}

      ${askSchemes ? `
          <h3>Which numbering schemes to compare</h3>
          <p>Tick ${minSchemes} to ${maxSchemes} of the
            ${BUNDLE.algorithms.length}. Whichever you pick, they are shown as
            Scheme A, B, C ... and each participant number gets them in a
            different order.</p>
          <div class="scheme-list">${schemeOptions}</div>
          <p class="warn" id="schemeWarn" hidden></p>` : ''}

      ${askTrials ? `
          <h3>How many trials</h3>
          <p>Per scheme, for each of the three tasks. Fewer is quicker but
            noisier &mdash; the notes below say where each number starts to
            matter.</p>
          <div class="trial-grid">${trialInputs}</div>
          <p class="warn" id="trialWarn" hidden></p>` : ''}

      ${askSchemes || askTrials ? `
          <p class="setup-estimate" id="setupEstimate"></p>
          <ul class="setup-warnings" id="setupWarnings"></ul>
        </div>` : ''}

      <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`;
    show('background');

    const checked = () =>
      [...el.querySelectorAll('input[name="scheme"]:checked')].map((b) => b.value);
    const typed = () => Object.fromEntries(
      [...el.querySelectorAll('input[name="trial"]')]
        .map((i) => [i.dataset.key, Math.round(Number(i.value))]));

    /**
     * Live estimate and health notes.
     *
     * Per-trial times are from running the study: a guess takes about 15
     * seconds, a search 35, a journey 60, and each block ends with 45 seconds
     * of sliders. They are rough on purpose - the point is to stop someone
     * discovering an hour-long session halfway through it.
     */
    const update = () => {
      const estimate = el.querySelector('#setupEstimate');
      if (!estimate) return;
      const n = askSchemes ? checked().length : preset.size;
      const t = askTrials ? typed() : counts;
      const pairs = (n * (n - 1)) / 2;
      const practice = practiceSetup().counts;
      // 180s of fixed overhead: consent, participant number, background, the
      // between-block screens and the closing questions.
      const seconds = 180
        + practice.infer * 20 + practice.find * 45 + practice.navigate * 70
        + n * ((t.infer || 0) * 15 + (t.find || 0) * 35 + (t.navigate || 0) * 60 + 65)
        + pairs * 25;
      estimate.textContent = `${n} scheme${n === 1 ? '' : 's'} x `
        + `${(t.infer || 0) + (t.find || 0) + (t.navigate || 0)} trials = `
        + `${n * ((t.infer || 0) + (t.find || 0) + (t.navigate || 0))} scored trials, `
        + `${pairs} side-by-side comparison${pairs === 1 ? '' : 's'}, `
        + `roughly ${Math.round(seconds / 60)} minutes per participant.`;

      // What each number costs you in the analysis. Said here rather than
      // discovered later in aggregate.py.
      const notes = [];
      if (n < 2) {
        notes.push('With one scheme there is nothing to compare it against: '
          + 'the side-by-side round is skipped and the models have no contrast '
          + 'to estimate. Useful for checking a scheme end to end, not for a result.');
      }
      if ((t.infer || 0) < CONFIG.learnMin) {
        notes.push(`Learning gain compares the first third of the guesses with `
          + `the last third. Below ${CONFIG.learnMin} guesses that is one or two `
          + `trials each way, so the number will be mostly noise.`);
      }
      if ((t.find || 0) < 3) {
        notes.push('Find-the-road success is a proportion out of this many '
          + 'trials, so with 1 or 2 it can only be 0%, 50% or 100% per person.');
      }
      if ((t.navigate || 0) < 3) {
        notes.push('Route deviation is a median per person per scheme; with '
          + 'fewer than 3 journeys that median is one or two numbers.');
      }
      const list = el.querySelector('#setupWarnings');
      list.innerHTML = notes.map((nt) => `<li>${nt}</li>`).join('');
      list.hidden = !notes.length;
    };

    for (const input of el.querySelectorAll('input[name="scheme"], input[name="trial"]')) {
      input.addEventListener('change', update);
      input.addEventListener('input', update);
    }
    update();

    el.querySelector('#next').addEventListener('click', () => {
      let ok = true;
      const warn = (id, message) => {
        const node = el.querySelector(id);
        if (!node) return;
        node.textContent = message || '';
        node.hidden = !message;
        if (message) ok = false;
      };

      const city = askCity ? el.querySelector('input[name="city"]:checked') : null;
      warn('#cityWarn', askCity && !city ? 'Please pick a map.' : '');

      const keys = askSchemes ? checked() : null;
      warn('#schemeWarn', askSchemes && (keys.length < minSchemes || keys.length > maxSchemes)
        ? `Please tick between ${minSchemes} and ${maxSchemes} schemes - `
          + `you have ${keys.length}.`
        : '');

      const trials = askTrials ? typed() : null;
      if (askTrials) {
        const bad = Object.entries(CONFIG.trialRange).find(([key, [lo, hi]]) =>
          !Number.isFinite(trials[key]) || trials[key] < lo || trials[key] > hi);
        warn('#trialWarn', bad
          ? `"${bad[0]}" must be a whole number between ${bad[1][0]} and ${bad[1][1]}.`
          : '');
      }

      if (!ok) {
        // Nothing is re-rendered: every tick and every number stays exactly as
        // it was, with the reason sitting next to whatever needs changing.
        el.querySelector('.warn:not([hidden])')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      if (city) state.city = city.value;
      if (keys) state.schemeKeys = keys;
      if (trials) state.trialCounts = trials;
      state.schemeSource = CONFIG.schemeSelection;
      save();
      resolve();
    });
  });
}

/**
 * The trial counts in force: what the setup screen chose, or the defaults.
 *
 * Practice is not among them - it is fixed in CONFIG for everyone, so that the
 * warm-up is one less thing that differs between participants.
 */
function trialCounts() {
  return { ...CONFIG.trials, ...(state.trialCounts || {}) };
}

// -- practice --------------------------------------------------------------

/**
 * The warm-up: all three tasks, with the answers shown, on a map nobody is
 * scored on.
 *
 * Fixed for everyone - same network, same scheme, same trials - so that what a
 * participant brings to their first scored trial is the same thing. It runs on
 * the smallest network with a partitioned and bucketed scheme, so the coloured
 * zones and the shared numbers are met here, where being told the answer costs
 * nothing, instead of in the middle of a measured block.
 *
 * Nothing here is recorded.
 */
async function practice() {
  const { city: entry, scheme: algorithm, counts } = practiceSetup();
  if (counts.infer + counts.find + counts.navigate < 1) return;

  const city = await loadCityData(entry.id);
  const scheme = buildScheme(city, algorithm.key);

  await screen('instructions', `
    <h1>First, a quick practice</h1>
    <p>You will try each of the three activities on a small practice map.
      <b>We will tell you the answer every time</b>, so this is where to get the
      hang of it &mdash; none of it is recorded.</p>
    <p class="tip">You can drag the map to move it and scroll to zoom. There are
      buttons for both in the top right.</p>
    <div class="btn-row"><button class="btn btn-big" id="next">Start practice</button></div>`);

  // Practice records exactly what a scored trial records, into its own list.
  const common = { phase: 'practice', algorithm: algorithm.key,
                   scheme: 'Practice', city: city.id, blockIndex: -1 };
  const keep = (key, index, result) => {
    state.practiceTrials.push({ key, trialIndex: index, ...common, ...result });
    save();
  };

  // --- guess a hidden number ---
  if (counts.infer > 0) {
    show('task');
    loadCity(city);
    const trials = pickInferTrials(city, 99, counts.infer, scheme);
    for (let i = 0; i < trials.length; i++) {
      keep(`practice:infer:${i}`, i, await runInferTrial({
        taskMap: ensureMap(), scheme, trial: trials[i],
        index: i, total: trials.length, practice: true,
      }));
    }
  }

  // --- find a road ---
  if (counts.find > 0) {
    await interlude('Practice: find a road',
      'Now you will be given a road number and have to find that road on the '
      + 'map and click it. If several stretches share that number, clicking any '
      + 'one of them counts.');
    show('task');
    loadCity(city);
    const trials = pickFindTrials(city, 99, counts.find, scheme);
    for (let i = 0; i < trials.length; i++) {
      keep(`practice:find:${i}`, i, await runFindTrial({
        taskMap: ensureMap(), scheme, trial: trials[i],
        index: i, total: trials.length, limitMs: CONFIG.timeLimitMs.find,
      }));
    }
  }

  // --- travel between roads ---
  if (counts.navigate > 0) {
    await interlude('Practice: travel between roads',
      'Last one. You start on a road and have to reach a road with a given '
      + 'number, one step at a time. The roads you can step onto from where you '
      + 'are will be outlined in blue.');
    show('task');
    loadCity(city);
    const trials = pickNavigateTrials(city, 99, counts.navigate, scheme);
    for (let i = 0; i < trials.length; i++) {
      keep(`practice:navigate:${i}`, i, await runNavigateTrial({
        taskMap: ensureMap(), scheme, city, trial: trials[i],
        index: i, total: trials.length, limitMs: CONFIG.timeLimitMs.navigate,
      }));
    }
  }

  ensureMap().clear();

  const blockCount = pickSchemes(state.participantId, state.schemeKeys).length;
  await screen('instructions', `
    <h1>That is the idea</h1>
    <p>The real study starts now, on the map you chose. We will still tell you
      the answer after each guess, but the guess itself is what we are
      recording &mdash; so give your best one each time.</p>
    <p>It has ${blockCount} part${blockCount === 1 ? '' : 's'}. Each part
      numbers the <b>same</b> map a different way, so do not be surprised when
      the numbers change completely between parts.</p>
    <div class="btn-row"><button class="btn btn-big" id="next">Start the study</button></div>`);
}

// -- one block -------------------------------------------------------------

async function runBlock(block, blockCount) {
  const { blockIndex, algorithm, city, scheme } = block;
  const tag = `b${blockIndex}`;

  setScheme(algorithm.label, blockIndex + 1, blockCount);

  // What the map will look like under this scheme, in plain words. The two
  // effects come straight from the algorithm: partitioning restarts the
  // numbering per zone, bucketing gives one street one number.
  const notes = [];
  if (scheme.partitionCount > 1) {
    notes.push(`<li>This map is split into <b>${scheme.partitionCount} coloured
      zones</b>. The numbering starts again in each zone, so the same number can
      turn up once in each colour.</li>`);
  }
  if (scheme.bucketCount > 0) {
    notes.push(`<li>Some roads are drawn <b>thicker</b>. Those are several
      stretches of one long road that all share a single number, like a street
      that keeps its name for miles.</li>`);
  }
  notes.push(`<li>Numbers run from <b>${scheme.range[0]}</b> to
    <b>${scheme.range[1]}</b>.</li>`);

  await screen('instructions', `
    <h1>Part ${blockIndex + 1} of ${blockCount}</h1>
    <p>This part uses <b>${algorithm.label}</b> &mdash; a different way of
      numbering the same map of <b>${city.city}</b>. The numbers will not match
      the part you just did.</p>
    <ul class="plain-list">${notes.join('')}</ul>
    <p>You will do three short activities: guess hidden numbers, find a road,
      and travel between two roads.</p>
    <div class="btn-row"><button class="btn btn-big" id="next">Begin part ${blockIndex + 1}</button></div>`);

  show('task');
  loadCity(city);
  const common = { phase: 'scored', blockIndex, algorithm: algorithm.key,
                   scheme: algorithm.label, city: city.id };

  // --- infer ---
  const counts = trialCounts();
  const inferTrials = pickInferTrials(city, blockIndex, counts.infer, scheme);
  for (let i = 0; i < inferTrials.length; i++) {
    const key = `${tag}:infer:${i}`;
    if (alreadyDone(key)) continue;
    const result = await runInferTrial({
      taskMap: ensureMap(), scheme, trial: inferTrials[i],
      index: i, total: inferTrials.length, practice: false,
    });
    record({ key, trialIndex: i, ...common, ...result });
  }

  // --- find ---
  await interlude('Now find some roads',
    'You will be given a road number. Find that road on the map and click it. '
    + 'If several stretches of road share that number, clicking any one of them '
    + 'is correct.');
  show('task');
  const findTrials = pickFindTrials(city, blockIndex, counts.find, scheme);
  for (let i = 0; i < findTrials.length; i++) {
    const key = `${tag}:find:${i}`;
    if (alreadyDone(key)) continue;
    const result = await runFindTrial({
      taskMap: ensureMap(), scheme, trial: findTrials[i],
      index: i, total: findTrials.length, limitMs: CONFIG.timeLimitMs.find,
    });
    record({ key, trialIndex: i, ...common, ...result });
  }

  // --- navigate ---
  await interlude('Now travel between roads',
    'You start on one road and must reach a road with a given number. Click '
    + 'roads that touch the one you are on, one step at a time, as if you were '
    + 'driving. Reaching any road with that number finishes the trip.');
  show('task');
  const navTrials = pickNavigateTrials(city, blockIndex, counts.navigate, scheme);
  for (let i = 0; i < navTrials.length; i++) {
    const key = `${tag}:navigate:${i}`;
    if (alreadyDone(key)) continue;
    const result = await runNavigateTrial({
      taskMap: ensureMap(), scheme, city, trial: navTrials[i],
      index: i, total: navTrials.length, limitMs: CONFIG.timeLimitMs.navigate,
    });
    record({ key, trialIndex: i, ...common, ...result });
  }

  ensureMap().clear();
  prompt('');
  $('taskPrompt').hidden = true;
  feedback('');

  if (!state.tlx.some((t) => t.blockIndex === blockIndex)) {
    await tlxScreen(block);
  }
}

async function interlude(title, body) {
  await screen('instructions', `
    <h1>${title}</h1><p>${body}</p>
    <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`);
}

// -- questionnaires --------------------------------------------------------

const TLX_ITEMS = [
  ['mental', 'Mental demand', 'How much thinking, deciding or searching did it take?', 'Very low', 'Very high'],
  ['physical', 'Physical demand', 'How much physical effort did it take?', 'Very low', 'Very high'],
  ['temporal', 'Time pressure', 'How rushed did you feel?', 'Very low', 'Very high'],
  ['performance', 'Your performance', 'How well do you think you did?', 'Very poor', 'Very well'],
  ['effort', 'Effort', 'How hard did you have to work?', 'Very low', 'Very high'],
  ['frustration', 'Frustration', 'How annoyed or stressed did you feel?', 'Very low', 'Very high'],
];

async function tlxScreen(block) {
  const sliders = TLX_ITEMS.map(([key, label, help, low, high]) => `
    <div class="tlx-item">
      <div class="tlx-head"><b>${label}</b><span>${help}</span></div>
      <input type="range" id="tlx-${key}" min="0" max="100" step="5" value="50">
      <div class="tlx-ends"><span>${low}</span><span>${high}</span></div>
    </div>`).join('');

  const el = await screen('questionnaire', `
    <h1>How did ${block.algorithm.label} feel?</h1>
    <p>Move each slider to wherever feels right for the part you just finished.
      There are no wrong answers.</p>
    ${sliders}
    <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`);

  const answers = Object.fromEntries(
    TLX_ITEMS.map(([key]) => [key, Number(el.querySelector(`#tlx-${key}`).value)]));
  // "Your performance" runs the other way - higher is better - so it is
  // flipped before averaging, as the standard NASA-TLX scoring requires.
  const raw = (answers.mental + answers.physical + answers.temporal
    + (100 - answers.performance) + answers.effort + answers.frustration) / 6;

  state.tlx.push({
    blockIndex: block.blockIndex,
    algorithm: block.algorithm.key,
    scheme: block.algorithm.label,
    city: block.city.id,
    ...answers,
    rawTlx: Math.round(raw * 10) / 10,
  });
  save();
}

async function preferenceScreen() {
  if (state.preference.length) return;
  const schemes = pickSchemes(state.participantId, state.schemeKeys);
  // With a single scheme there is no pair to compare, so the round is skipped
  // rather than shown empty.
  if (schemes.length < 2) return;
  const pairs = preferencePairs(state.participantId, schemes);
  const city = await loadCityData(state.city);

  await screen('instructions', `
    <h1>Almost done</h1>
    <p>Now we will show you two numbered maps side by side &mdash; the same
      ${schemes.length} numbering systems you just worked with. Just tell us
      which one makes more sense to you. There are ${pairs.length} pairs.</p>
    <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`);

  for (let i = 0; i < pairs.length; i++) {
    await onePreference(pairs[i], i, pairs.length, city, schemes);
  }
}

function onePreference(pair, index, total, city, schemes) {
  return new Promise((resolve) => {
    const el = $('compare');
    el.innerHTML = `
      <h1>Which numbering makes more sense?</h1>
      <p class="sub">Pair ${index + 1} of ${total}. Both maps show the same city.</p>
      <div class="compare-grid">
        <div class="compare-side">
          <div class="mini-map" id="miniLeft"></div>
          <button class="btn btn-big" data-side="left">This one</button>
        </div>
        <div class="compare-side">
          <div class="mini-map" id="miniRight"></div>
          <button class="btn btn-big" data-side="right">This one</button>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-ghost" data-side="none">They seem the same</button></div>`;
    show('compare');

    const build = (containerId, schemeIndex) => {
      const scheme = buildScheme(city, schemes[schemeIndex].key);
      const view = new MapView($(containerId), {
        roadWidth: 1.6, tooltipHtml: () => '', maxLabels: 120,
      });
      view.setNetwork({
        bbox: city.bbox,
        roads: {
          type: 'FeatureCollection',
          features: city.roads.map((r) => ({
            type: 'Feature', id: r.i,
            geometry: { type: 'LineString', coordinates: r.g },
            properties: { road_id: r.i, orientation: r.o, length_m: r.len, name: null },
          })),
        },
        nodes: null,
      });
      view.setLabels(Object.fromEntries(
        Object.entries(scheme.numbers).map(([k, v]) => [k, String(v)])));
      // Same conventions as the task map, so the comparison is between the
      // numberings and not between two different ways of drawing them.
      for (const road of view.roads) {
        view.setRoadStyle(road.id, {
          color: scheme.colourOf(road.id),
          width: scheme.isBucketed(road.id) ? 1.6 * 1.7 : null,
        });
      }
      return view;
    };

    const left = build('miniLeft', pair.left);
    const right = build('miniRight', pair.right);
    const started = performance.now();

    for (const button of el.querySelectorAll('[data-side]')) {
      button.addEventListener('click', () => {
        const side = button.dataset.side;
        state.preference.push({
          leftAlgorithm: schemes[pair.left].key,
          rightAlgorithm: schemes[pair.right].key,
          chose: side === 'none' ? null
            : schemes[side === 'left' ? pair.left : pair.right].key,
          ms: Math.round(performance.now() - started),
        });
        save();
        left.destroy();
        right.destroy();
        resolve();
      });
    }
  });
}

async function contextScreen(blocks) {
  if (state.context.length) return;
  const seen = [...new Set(blocks.map((b) => b.city.city))];
  for (const cityName of seen) {
    const el = await screen('questionnaire', `
      <h1>About the ${cityName} maps</h1>
      <label class="field">
        <span class="field-label">"The numbering I saw matches how addresses
          work where I live." (1 = strongly disagree, 7 = strongly agree)</span>
        <input type="range" id="ctx1" min="1" max="7" step="1" value="4">
        <output class="range-out" id="ctx1out">4</output>
      </label>
      <label class="field">
        <span class="field-label">"I could imagine a numbering like this being
          used in a real city." (1 = strongly disagree, 7 = strongly agree)</span>
        <input type="range" id="ctx2" min="1" max="7" step="1" value="4">
        <output class="range-out" id="ctx2out">4</output>
      </label>
      <label class="field">
        <span class="field-label">What, if anything, felt wrong about the
          numbering? (optional)</span>
        <textarea id="ctx3" rows="3" placeholder="Anything at all"></textarea>
      </label>
      <div class="btn-row"><button class="btn btn-big" id="next">Continue</button></div>`);

    for (const n of ['1', '2']) {
      const input = el.querySelector(`#ctx${n}`);
      const out = el.querySelector(`#ctx${n}out`);
      input.addEventListener('input', () => { out.textContent = input.value; });
    }

    state.context.push({
      city: cityName,
      matchesHome: Number(el.querySelector('#ctx1').value),
      couldBeReal: Number(el.querySelector('#ctx2').value),
      comment: el.querySelector('#ctx3').value.slice(0, 1000),
    });
    save();
  }
}


// -- finish ----------------------------------------------------------------

/**
 * Trigger a file download in a way that actually completes.
 *
 * Revoking the object URL immediately after `.click()` can cancel the download
 * before the browser has read the blob, and some browsers ignore an anchor that
 * is not in the document. Both are silent failures, which for this page would
 * mean a participant loses the only copy of their results.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 60000);
}


/**
 * Post the results to whatever endpoint CONFIG.submit.url names.
 *
 * Two request shapes cover the services worth recommending:
 *
 *   Formspree wants JSON and answers with JSON, so it gets `application/json`
 *   and a preflight, which it handles.
 *
 *   Google Apps Script has no CORS preflight handling worth relying on, so it
 *   gets `text/plain`, which keeps the request "simple" - no preflight at all -
 *   and reads the body from `e.postData.contents`. This is also the safest
 *   shape for any other endpoint someone points this at.
 *
 * A rejected promise is a failed send, and the caller falls back to the
 * download. The one case this cannot detect is an opaque response, so the
 * screen always leaves the download available rather than claiming success it
 * cannot verify.
 */
async function sendResults(payload) {
  const url = CONFIG.submit?.url;
  if (!url) throw new Error('no endpoint configured');
  const formspree = /formspree\.io/.test(url);

  const response = await fetch(url, {
    method: 'POST',
    headers: formspree
      ? { 'Content-Type': 'application/json', Accept: 'application/json' }
      : { 'Content-Type': 'text/plain;charset=utf-8' },
    body: formspree
      ? JSON.stringify({
        participant: state.participantId,
        email: state.email || '',
        city: state.city,
        trials: state.trials.length,
        results: payload,
      })
      : payload,
  });
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return response;
}

async function finishScreen() {
  const filename = `rna-study-P${String(state.participantId).padStart(2, '0')}.json`;
  const canSend = Boolean(CONFIG.submit?.url);
  const askEmail = canSend && CONFIG.submit?.askEmail;
  const payloadOf = () => JSON.stringify(state, null, 1);

  // Rendered directly rather than through screen(), which waits for a #next
  // button to be clicked. This screen has no next step, so waiting for one
  // would mean the handlers below never got attached.
  const el = $('finish');
  el.innerHTML = `
    <h1>All done - thank you</h1>
    <p class="lead">You answered <b>${state.trials.length}</b> questions.</p>

    ${canSend ? `
      <div class="finish-box is-primary">
        <p class="send-status" id="sendStatus">Sending your answers...</p>
        <div class="send-actions" id="sendActions" hidden>
          <button class="btn btn-big" id="send">Try again</button>
        </div>
        ${askEmail ? `
          <label class="field" id="emailField" hidden>
            <span class="field-label">Your email &mdash; optional, only so we can
              thank you or ask if something went wrong. It is not part of the
              results.</span>
            <span class="email-row">
              <input type="email" id="email" placeholder="you@example.com"
                     autocomplete="email">
              <button class="btn btn-ghost" id="saveEmail">Send</button>
            </span>
          </label>` : ''}
      </div>

      <details class="finish-fallback" id="fallback">
        <summary>Having trouble? Save the file instead</summary>
        <div class="finish-box">
          <button class="btn" id="download">Download my results file</button>
          <p class="sub">Saves <code>${filename}</code>. Email it back to us and
            we will take it from there.</p>
        </div>
      </details>` : `
      <div class="finish-box is-warning">
        <h2>No submission address is set up</h2>
        <p><b>This message is for whoever is running the study, not for you.</b>
          <code>submit.url</code> is empty in <code>js/design.js</code>, so
          answers cannot be sent automatically. See
          <code>evaluate/README.md</code>, "Hosting it, step by step".</p>
        <button class="btn btn-big" id="download">Download the results file</button>
        <p class="sub">Saves <code>${filename}</code>.</p>
      </div>`}

    <p class="sub" id="closeNote">Please keep this tab open until you see the
      confirmation.</p>`;
  show('finish');

  el.querySelector('#download')?.addEventListener('click', (event) => {
    downloadBlob(new Blob([payloadOf()], { type: 'application/json' }), filename);
    event.target.textContent = 'Downloaded - check your downloads folder';
  });

  if (!canSend) {
    el.querySelector('#closeNote').textContent =
      'You can close this tab once the file is saved.';
    return;
  }

  const status = el.querySelector('#sendStatus');
  const actions = el.querySelector('#sendActions');
  const send = el.querySelector('#send');

  const attempt = async () => {
    actions.hidden = true;
    status.textContent = 'Sending your answers...';
    status.className = 'send-status';
    try {
      await sendResults(payloadOf());
      state.submittedAt = new Date().toISOString();
      save();
      status.innerHTML = '<b>Sent - thank you.</b> That is everything; '
        + 'you can close this tab.';
      status.className = 'send-status is-good';
      el.querySelector('#closeNote').hidden = true;
      // Only now ask for the email, so the answers are safely in before
      // anything optional is put in front of them.
      const field = el.querySelector('#emailField');
      if (field) field.hidden = false;
    } catch (error) {
      status.innerHTML = `Your answers have <b>not</b> been sent yet
        (${error.message}). Please try again &mdash; nothing is lost, they are
        still saved in this browser.`;
      status.className = 'send-status is-bad';
      actions.hidden = false;
      el.querySelector('#fallback').open = true;
    }
  };

  send.addEventListener('click', attempt);

  // A second, smaller send carrying just the email, so giving it is optional in
  // the real sense: the results are already in whether they type one or not.
  el.querySelector('#saveEmail')?.addEventListener('click', async (event) => {
    const value = el.querySelector('#email').value.trim();
    if (!value) return;
    state.email = value;
    save();
    event.target.disabled = true;
    try {
      await sendResults(payloadOf());
      event.target.textContent = 'Thank you';
    } catch {
      event.target.textContent = 'Could not send - never mind';
    }
  });

  // Sent on arrival rather than on a button, because a button here is one more
  // thing to forget, and forgetting it loses the session.
  await attempt();
}

// --------------------------------------------------------------------------

document.addEventListener('change', (event) => {
  if (event.target.id === 'consent') {
    const button = document.querySelector('#welcome #next');
    if (button) button.disabled = !event.target.checked;
  }
});

run().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML('afterbegin',
    `<div class="fatal">Something went wrong: ${error.message}. Your answers so
     far are saved - please refresh the page to continue.</div>`);
});
