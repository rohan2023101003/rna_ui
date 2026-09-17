/**
 * The three tasks a participant works through in every block.
 *
 * Each task function paints its own controls, waits for the participant, and
 * resolves with one trial record. Nothing here decides *which* roads are used -
 * that comes from design.js - so the tasks stay simple and testable.
 *
 * Every task records how much map interaction it took (pans, zooms, clicks), by
 * snapshotting the counters at the start and taking the difference at the end.
 *
 * One rule runs through all three: **a road number, not a road, is the answer.**
 * Under the paper's pipeline a number can belong to several roads - to one
 * segment per partition after Step 1, and to every segment of one physical road
 * after Step 2 - so clicking any road carrying the number asked for is correct.
 */

import {
  CONFIG, bfsHopsFrom, bfsPath, orientationOf, routeMetres, ruleParity, shortestMetres,
} from './design.js';

const $ = (id) => document.getElementById(id);

/**
 * How long the Next button ignores input after a trial's answer is shown.
 *
 * Short enough not to feel unresponsive, long enough that the second half of a
 * reflex "Enter, Enter" cannot skip the feedback unread.
 */
const ADVANCE_GUARD_MS = 350;

/** How much thicker a road drawn as several segments of one street is. */
const BUCKET_WIDTH_FACTOR = 1.7;

/**
 * Wrap the shared map so tasks can count interaction without knowing details.
 *
 * Counting is the part of this study that is easiest to get quietly wrong, so
 * what each counter means is spelled out:
 *
 *   pan, zoom       one per *gesture*. A drag across the screen fires 50-200
 *                   pointermove events and a scroll fires 5-30 wheel events;
 *                   counting those would measure the pointing device and the
 *                   screen refresh rate, not the person. The renderer coalesces
 *                   each continuous gesture into one `gesture:pan`/`gesture:zoom`.
 *   panEvents,      the raw event counts, kept alongside so the coalescing can
 *   zoomEvents      be checked - or undone - at analysis time.
 *   tool            presses of the on-screen +, -, "Whole map", "Back to road".
 *   click           clicks that landed on a road.
 *   emptyClick      clicks that landed on blank map.
 *   hover           roads the cursor entered. Emitted on *transitions* only, so
 *                   resting on one road is one hover, not one per frame.
 *   hiddenMs        milliseconds the tab spent in the background. Elapsed time
 *                   keeps running when someone switches tab, so this is
 *                   recorded to let the analysis exclude or correct those.
 */
export class TaskMap {
  constructor(mapView) {
    this.map = mapView;
    this.counts = {
      pan: 0, zoom: 0, panEvents: 0, zoomEvents: 0,
      tool: 0, click: 0, emptyClick: 0, hover: 0, hiddenMs: 0,
    };
    this._clickHandler = null;
    this._scheme = null;
    this._hiddenSince = null;

    this.map.on('view:change', (v) => {
      if (v.reason === 'pan') this.counts.panEvents += 1;
      else if (v.reason === 'zoom') this.counts.zoomEvents += 1;
    });
    this.map.on('gesture:pan', () => { this.counts.pan += 1; });
    this.map.on('gesture:zoom', () => { this.counts.zoom += 1; });
    this.map.on('road:hover', ({ roadId }) => { if (roadId) this.counts.hover += 1; });
    this.map.on('map:click', () => { this.counts.emptyClick += 1; });
    this.map.on('road:click', ({ roadId }) => {
      this.counts.click += 1;
      if (this._clickHandler) this._clickHandler(String(roadId));
    });

    // Time spent with the tab in the background is measured, not guessed at.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._hiddenSince = performance.now();
      } else if (this._hiddenSince !== null) {
        this.counts.hiddenMs += performance.now() - this._hiddenSince;
        this._hiddenSince = null;
      }
    });
  }

  /** Count a press of one of the map's own buttons. */
  countTool() { this.counts.tool += 1; }

  snapshot() {
    // Fold in any background time still accruing, so a trial answered right
    // after coming back to the tab still reports it.
    if (this._hiddenSince !== null) {
      this.counts.hiddenMs += performance.now() - this._hiddenSince;
      this._hiddenSince = performance.now();
    }
    return { ...this.counts };
  }

  since(before) {
    const now = this.snapshot();
    return {
      pans: now.pan - before.pan,
      zooms: now.zoom - before.zoom,
      panEvents: now.panEvents - before.panEvents,
      zoomEvents: now.zoomEvents - before.zoomEvents,
      toolPresses: now.tool - before.tool,
      clicks: now.click - before.click,
      emptyClicks: now.emptyClick - before.emptyClick,
      hovers: now.hover - before.hover,
      hiddenMs: Math.round(now.hiddenMs - before.hiddenMs),
    };
  }

  onRoadClick(handler) { this._clickHandler = handler; }

  /**
   * Draw one scheme's numbering, optionally withholding some roads' numbers.
   *
   * This is also where the two things that make a numbering readable get drawn:
   *
   *   colour  one per min-cut partition, because the numbering restarts inside
   *           each one. A network the algorithm did not partition stays black,
   *           since colouring it would imply a division that is not there.
   *   width   segments that share a number with a neighbour are one physical
   *           road, and are drawn slightly thicker so they read as one street
   *           rather than as a numbering mistake.
   */
  showNumbering(scheme, { hide = [], highlight = [], pin = [] } = {}) {
    this._scheme = scheme;
    const labels = {};
    for (const [roadId, number] of Object.entries(scheme.numbers)) {
      labels[roadId] = String(number);
    }
    this.map.setLabels(labels);
    this.map.setHiddenLabels(hide);
    this.map.setPinnedLabels(pin);
    this.map.clearLabelStyles();
    this.map.setHighlighted(highlight);
    this.repaintScheme();
    for (const roadId of hide) this.map.setRoadStyle(roadId, { className: 'is-blanked' });
  }

  /** Reset every road to its scheme colour and width, dropping task states. */
  repaintScheme() {
    const scheme = this._scheme;
    const base = this.map.options.roadWidth;
    for (const road of this.map.roads) {
      this.map.setRoadStyle(road.id, {
        className: '',
        color: scheme ? scheme.colourOf(road.id) : null,
        width: scheme && scheme.isBucketed(road.id) ? base * BUCKET_WIDTH_FACTOR : null,
      });
    }
    this._marked = {};
  }

  /** Mark a set of roads with a state class, clearing the previous set. */
  mark(roadIds, className) {
    for (const roadId of this._marked?.[className] || []) {
      this.map.setRoadStyle(roadId, { className: '' });
    }
    this._marked = this._marked || {};
    this._marked[className] = [...roadIds].map(String);
    for (const roadId of this._marked[className]) {
      this.map.setRoadStyle(roadId, { className });
    }
  }

  clearMarks() {
    for (const list of Object.values(this._marked || {})) {
      for (const roadId of list) this.map.setRoadStyle(roadId, { className: '' });
    }
    this._marked = {};
  }

  /** Remember the road this trial is about, for the "Back to road" button. */
  focusOn(roadId, alsoShow = []) {
    this.focusRoad = roadId === null ? null : Number(roadId);
    this.focusGroup = roadId === null ? [] : [roadId, ...alsoShow].map(Number);
    const button = document.getElementById('zoomTask');
    if (button) button.hidden = this.focusRoad === null;
  }

  clear() {
    this._clickHandler = null;
    this._scheme = null;
    this.focusOn(null);
    this._marked = {};
    this.map.setHiddenLabels([]);
    this.map.setPinnedLabels([]);
    this.map.setHighlighted([]);
    this.map.select(null);
    for (const road of this.map.roads) {
      this.map.setRoadStyle(road.id, { className: '', color: null, width: null });
    }
    legend('');
    timeWarning('');
  }
}

/** Show a prompt bar above the map and return its body element to fill in. */
function prompt(html) {
  const bar = $('taskPrompt');
  bar.innerHTML = html;
  bar.hidden = false;
  return bar;
}

function feedback(message, kind) {
  const el = $('taskFeedback');
  el.textContent = message || '';
  el.className = `task-feedback${kind ? ` is-${kind}` : ''}`;
  el.hidden = !message;
}

/** The strip under the map that explains the colours and the thick roads. */
function legend(html) {
  const el = $('mapLegend');
  if (!el) return;
  el.innerHTML = html || '';
  el.hidden = !html;
}

/**
 * Explain, in the participant's language, what this scheme's map is showing.
 *
 * Both facts are properties of the algorithm's own output, not of the study:
 * partitions come from the min-cut split, thick roads from bucketing. Saying so
 * is what stops "why do two roads have the same number?" being read as a bug.
 */
function schemeLegend(scheme) {
  const parts = [];
  if (scheme.partitionCount > 1) {
    parts.push(`<span class="legend-item"><i class="legend-swatch is-multi"></i>
      Colours mark <b>${scheme.partitionCount} zones</b>. The numbering starts
      again in each zone, so the same number can appear once per zone.</span>`);
  }
  if (scheme.bucketCount > 0) {
    parts.push(`<span class="legend-item"><i class="legend-swatch is-thick"></i>
      <b>Thicker</b> roads are several stretches of one long road, sharing one
      number.</span>`);
  }
  if (!parts.length) {
    parts.push('<span class="legend-item">Every road here has its own number.</span>');
  }
  // The paper's convention, kept in view for every trial of every scheme. It
  // is the same sentence whatever the scheme, so it helps each one only as far
  // as that scheme actually keeps to it.
  if (CONFIG.showParityRule) {
    parts.unshift(`<span class="legend-item legend-rule">
      <i class="rule-glyph" aria-hidden="true">&#8597;</i> North&ndash;south roads:
      <b>odd</b> numbers
      <i class="rule-glyph" aria-hidden="true">&#8596;</i> east&ndash;west roads:
      <b>even</b> numbers</span>`);
  }
  legend(parts.join(''));
}

/** The notice shown in the last stretch of a timed task; empty hides it. */
export function timeWarning(text) {
  const el = $('timeWarning');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

/**
 * Arm the "nearly out of time" notice for a timed task.
 *
 * There is deliberately no running clock. A visible timer is a manipulation:
 * it pushes people to trade accuracy for speed, and it pushes hardest on the
 * hardest schemes, so it would change the very numbers being compared. Time is
 * recorded silently instead. This notice exists only so that a trial with a
 * limit never ends without warning. Returns a function that cancels it and
 * reports whether it was shown, which is recorded with the trial.
 */
function armTimeWarning(limitMs) {
  let shown = false;
  const lead = CONFIG.timeWarningMs || 0;
  const timer = lead > 0 && limitMs > lead
    ? setTimeout(() => {
      shown = true;
      timeWarning(`${Math.round(lead / 1000)} seconds left for this one.`);
    }, limitMs - lead)
    : null;
  return () => {
    clearTimeout(timer);
    timeWarning('');
    return shown;
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold the result on screen until the participant presses Next.
 *
 * Trials used to advance on a timer, which meant the confirmation of what just
 * happened - the right answer, or "you arrived" - was painted over by the next
 * trial almost immediately. People could not tell whether their last click had
 * worked, which is both bad feedback and a reason to distrust the data.
 *
 * The wait happens *after* the response has been timed and recorded, so
 * however long someone spends reading this it never lands in their task time.
 */
function review(html, buttonText = 'Next') {
  return new Promise((resolve) => {
    prompt(`${html}
      <div class="prompt-controls">
        <button class="btn btn-next" id="trialNext">${buttonText}</button>
      </div>`);
    const button = $('trialNext');
    button.focus();

    /**
     * Enter stays the submit key, and also works here - but not instantly.
     *
     * Typing a number and hitting Enter twice is a normal habit, and the second
     * Enter used to land on this screen before it had been read: the answer
     * flashed past. Two separate routes cause that, and both have to be closed.
     *
     *   1. The *same* keypress that submitted is still bubbling towards
     *      `document` when this screen is built, so a listener added now is
     *      read by that very event.
     *   2. The button is focused, and a focused <button> is natively activated
     *      by Enter - a click the page never sees as a keypress.
     *
     * So the gate is on `go()` itself rather than on the key listener, which
     * covers the native activation as well. `ADVANCE_GUARD_MS` is long enough
     * to absorb a reflex double-tap (under ~250 ms) and short enough that a
     * deliberate press, after actually reading two lines of feedback, is never
     * refused.
     */
    let armed = false;
    const go = () => {
      if (!armed) return;
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      go();
    };
    button.addEventListener('click', go);
    document.addEventListener('keydown', onKey);
    setTimeout(() => { armed = true; }, ADVANCE_GUARD_MS);
  });
}

// --------------------------------------------------------------------------
// T1 - Fill in the blank
// --------------------------------------------------------------------------

export function runInferTrial({ taskMap, scheme, city, trial, index, total, practice }) {
  return new Promise((resolve) => {
    const roadId = String(trial.roadId);
    const numbering = scheme.numbers;
    const actual = numbering[roadId];
    // Which way the road runs, and so what the odd/even rule says its number
    // should be. Recorded whether or not the rule is shown on screen.
    const orientation = city ? orientationOf(city, roadId) : null;
    const rule = ruleParity(orientation);
    const numbers = Object.values(numbering);
    const range = Math.max(...numbers) - Math.min(...numbers);

    // Blank every road carrying this number, not just the one being asked
    // about. Under bucketing the next stretch of the same road carries the same
    // number, and under partitioning so does one road per zone - leaving those
    // on screen would print the answer next to the question.
    const sameNumber = scheme.roadsWithNumber(actual);
    const hidden = sameNumber.includes(roadId) ? sameNumber : [roadId, ...sameNumber];

    taskMap.showNumbering(scheme, { hide: hidden });
    taskMap.map.zoomToRoad(roadId);
    taskMap.focusOn(roadId);
    schemeLegend(scheme);

    prompt(`
      <div class="prompt-main">What number do you think the
        <b class="prompt-target">highlighted road</b> should have?</div>
      <div class="prompt-sub">Look at the numbers on the roads around it. Trial
        ${index + 1} of ${total}.</div>
      <div class="prompt-controls">
        <input type="number" id="inferInput" min="1" step="1"
               placeholder="Type a number" autocomplete="off">
        <button class="btn" id="inferSubmit">Submit</button>
      </div>`);

    const before = taskMap.snapshot();
    const started = performance.now();
    const input = $('inferInput');
    input.focus();

    const submit = async () => {
      const guess = Number(input.value);
      if (!Number.isFinite(guess) || guess <= 0) { input.focus(); return; }
      // Timed and counted here, the instant the answer is given - before any
      // feedback is shown and before the participant reads it.
      const ms = Math.round(performance.now() - started);
      const interaction = taskMap.since(before);
      const errorAbs = Math.abs(guess - actual);
      const close = errorAbs <= range * 0.1;

      // Feedback on every trial, not just practice. Learning needs it: without
      // being told the answer there is nothing to learn from, and learnability
      // is one of the measures. The guess is recorded before it is shown, so
      // the answer cannot affect the response we are scoring.
      feedback(
        errorAbs === 0
          ? `Exactly right - it was ${actual}.`
          : `It was ${actual}. You said ${guess}${close ? ' - close.' : '.'}`,
        close ? 'good' : 'bad');

      // Show the answer on the road itself, so the number and the place it
      // belongs to are seen together.
      taskMap.showNumbering(scheme, { pin: hidden, highlight: hidden });
      await review(`
        <div class="prompt-main">${errorAbs === 0 ? 'Exactly right.'
          : close ? 'Close.' : 'Not quite.'}</div>
        <div class="prompt-sub">
          <span class="answer-line"><i class="answer-key is-yours"></i>
            <b>You said:</b> ${guess}</span>
          <span class="answer-line"><i class="answer-key is-right"></i>
            <b>The answer:</b> ${actual}${errorAbs === 0 ? ''
              : ` &mdash; out by ${errorAbs}`}</span>
          <span class="answer-note">The road is highlighted with its real
            number on it.</span>
        </div>`);
      feedback('');

      resolve({
        task: 'infer',
        roadId: Number(roadId),
        actual,
        guess,
        errorAbs,
        errorNorm: range > 0 ? errorAbs / range : null,
        parityMatch: (guess % 2) === (actual % 2),
        orientation,
        ruleParity: rule,
        // Two different findings, kept apart: whether the participant's guess
        // followed the rule, and whether the scheme's real number does.
        ruleFollowed: rule ? (Math.abs(guess) % 2 === 1) === (rule === 'odd') : null,
        ruleHolds: rule ? (actual % 2 === 1) === (rule === 'odd') : null,
        numberRange: range,
        sharedBy: hidden.length,
        ms,
        ...interaction,
      });
    };

    $('inferSubmit').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

// --------------------------------------------------------------------------
// T2 - Find the road
// --------------------------------------------------------------------------

export function runFindTrial({ taskMap, scheme, trial, index, total, limitMs }) {
  return new Promise((resolve) => {
    const roadId = String(trial.roadId);
    const numbering = scheme.numbers;
    const target = trial.target ?? numbering[roadId];

    // Every road carrying the target number. Any one of them counts: they are
    // either stretches of the same street or the same number in another zone,
    // and a participant has no way to tell which one we had in mind.
    const matching = scheme.roadsWithNumber(target);

    // Pinning guarantees the answer is actually drawn. Without it the label can
    // be dropped when the map is crowded, and the participant would be hunting
    // for a number that is not on screen.
    taskMap.showNumbering(scheme, { pin: matching });
    taskMap.map.fit();
    taskMap.focusOn(null);
    schemeLegend(scheme);

    const plural = matching.length > 1
      ? ` <span class="prompt-note">(${matching.length} stretches carry this
          number &mdash; any of them counts)</span>` : '';

    prompt(`
      <div class="prompt-main">Find road number
        <b class="prompt-target">${target}</b> and click it.</div>
      <div class="prompt-sub">Trial ${index + 1} of ${total}. It is definitely on
        the map &mdash; zoom in if the labels are small.${plural}</div>
      <div class="prompt-controls">
        <button class="btn btn-ghost" id="findGiveUp">I cannot find it</button>
      </div>`);

    const before = taskMap.snapshot();
    const started = performance.now();
    let wrongClicks = 0;
    let done = false;
    const stopWarning = armTimeWarning(limitMs);

    /**
     * Close the trial.
     *
     * The clock and the interaction counters are read here, at the moment the
     * outcome is decided - not when the review screen is dismissed. Otherwise
     * time spent looking at the revealed answer would be charged to the search.
     */
    const finish = async (found, gaveUp, heading) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      const warned = stopWarning();
      const ms = Math.round(performance.now() - started);
      const interaction = taskMap.since(before);
      taskMap.onRoadClick(null);

      // Show where it was either way, so nobody leaves a trial unsure.
      taskMap.mark(matching, 'is-answer');
      taskMap.map.zoomToRoads(matching);
      feedback('');
      await review(`
        <div class="prompt-main">${heading}</div>
        <div class="prompt-sub">
          <span class="answer-line"><i class="answer-key is-yours"></i>
            <b>You:</b> ${found
              ? `found it${wrongClicks ? ` after ${wrongClicks} other `
                  + `road${wrongClicks === 1 ? '' : 's'}` : ' first time'}`
              : `did not find it${wrongClicks ? `, after trying ${wrongClicks} `
                  + `road${wrongClicks === 1 ? '' : 's'}` : ''}`}</span>
          <span class="answer-line"><i class="answer-key is-right"></i>
            <b>The answer:</b> road ${target}, highlighted in green${
              matching.length > 1
                ? ` &mdash; all ${matching.length} stretches of it` : ''}</span>
        </div>`);
      taskMap.repaintScheme();

      resolve({
        task: 'find',
        roadId: Number(roadId),
        target,
        candidates: matching.length,
        found,
        gaveUp: Boolean(gaveUp),
        wrongClicks,
        ms,
        timedOut: !found && !gaveUp,
        warned,
        ...interaction,
      });
    };

    const timeout = setTimeout(
      () => finish(false, false, 'Time is up for this one.'), limitMs);

    taskMap.onRoadClick((clickedId) => {
      if (done) return;
      if (String(numbering[clickedId]) === String(target)) {
        finish(true, false, 'Correct.');
      } else {
        wrongClicks += 1;
        const what = numbering[clickedId] === undefined
          ? 'That road was never given a number.'
          : `That is road ${numbering[clickedId]}.`;
        feedback(`${what} Keep looking.`, 'bad');
        setTimeout(() => feedback(''), 1100);
      }
    });

    $('findGiveUp').addEventListener('click',
      () => finish(false, true, 'No problem - here it is.'));
  });
}

// --------------------------------------------------------------------------
// T3 - Get there
// --------------------------------------------------------------------------

export function runNavigateTrial({ taskMap, scheme, city, trial, index, total, limitMs }) {
  return new Promise((resolve) => {
    const numbering = scheme.numbers;
    const from = String(trial.from);
    const targetNumber = trial.target ?? numbering[String(trial.to)];

    // The goal is the number, so every road carrying it is a finish line, and
    // "am I getting closer?" is measured against whichever is nearest.
    const goals = scheme.roadsWithNumber(targetNumber);
    const hops = bfsHopsFrom(city, goals);

    const path = [from];
    let errors = 0;
    let backtracks = 0;
    let done = false;

    // Thicker roads and larger numbers: this task is about reading the numbers
    // on the roads themselves while deciding where to go next.
    taskMap.map.setOption('roadWidth', 3.6);
    document.getElementById('mapPanel').classList.add('is-navigating');

    const neighboursOf = (roadId) => (city.adj[String(roadId)] || []).map(String);

    /**
     * Show which roads can actually be reached from here.
     *
     * Some roads meet on screen without sharing a junction in the underlying
     * data - 32 such pairs in Melbourne alone - so leaving people to guess
     * produces "those roads are not connected" over and over. Marking the real
     * options removes the guesswork without giving away where the target is.
     */
    const paint = () => {
      const current = path[path.length - 1];
      const options = neighboursOf(current).filter((id) => id !== current);
      // Repaint from the scheme first, then apply states in order. Marking one
      // set at a time would let a later set wipe the class an earlier one just
      // applied to the same road - the road you came from would lose its
      // colour - and the reset also restores the partition colours underneath.
      taskMap.repaintScheme();
      taskMap.mark(options, 'is-available');
      taskMap.mark(path.slice(0, -1), 'is-travelled');
      taskMap.mark([current], 'is-current');
      taskMap.focusOn(current, options);
      // Keep the current road and everything reachable from it on screen, so
      // the options are always large enough to read and click.
      taskMap.map.zoomToRoads([current, ...options]);
    };

    const render = () => {
      const current = path[path.length - 1];
      const options = neighboursOf(current).length;
      const note = goals.length > 1
        ? ` There are ${goals.length} stretches numbered ${targetNumber};
            reaching any of them finishes the trip.` : '';
      prompt(`
        <div class="prompt-main">Travel to road
          <b class="prompt-target">${targetNumber}</b>.</div>
        <div class="prompt-sub">
          You are on <b class="chip chip-current">${numbering[current] ?? '?'}</b>.
          Click any road outlined in <b class="chip chip-available">blue</b>
          &mdash; those are the ${options} you can reach from here.
          Trial ${index + 1} of ${total}.${note}
        </div>
        <div class="prompt-controls">
          <span class="path-trail" data-current="${current}" data-steps="${path.length}">
            ${path.map((p) => numbering[p] ?? '?').join(' &rarr; ')}
          </span>
          <button class="btn btn-ghost btn-sm" id="navUndo"
                  ${path.length < 2 ? 'disabled' : ''}>Undo last step</button>
          <button class="btn btn-ghost btn-sm" id="navGiveUp">I cannot get there</button>
        </div>`);
      paint();
      $('navUndo').addEventListener('click', () => {
        if (path.length > 1) { path.pop(); backtracks += 1; render(); }
      });
      $('navGiveUp').addEventListener('click',
        () => finish(false, 'No problem - here is where it was.'));
    };

    const before = taskMap.snapshot();
    const started = performance.now();
    const stopWarning = armTimeWarning(limitMs);

    /**
     * Close the journey and show what happened.
     *
     * Both routes are drawn: the one taken, and the shortest one there was.
     * Without it the screen simply jumped to the next trial the instant the
     * goal was clicked, so a participant could not even tell that they had
     * arrived - let alone whether they had gone the long way round.
     *
     * Clock and counters are read before any of that is drawn.
     */
    const finish = async (arrived, reason) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      const warned = stopWarning();
      const ms = Math.round(performance.now() - started);
      const interaction = taskMap.since(before);
      taskMap.onRoadClick(null);
      const moves = path.length - 1;

      const best = bfsPath(city, trial.from, goals) || [];
      const taken = path.map(Number);
      const bestSet = new Set(best.map(String));
      const deviation = arrived && trial.shortestHops > 0
        ? moves / trial.shortestHops : null;

      // Steps are the primary measure: one click is one step, and the paper's
      // own connectivity metrics count hops. Distance on the ground is recorded
      // beside it, because a route with fewer but longer roads can win on
      // steps and lose on metres.
      const byDistance = shortestMetres(city, trial.from, goals);
      const takenMetres = routeMetres(city, taken);
      const deviationMetres = arrived && byDistance && byDistance.metres > 0
        ? takenMetres / byDistance.metres : null;

      // Best route first, then the route taken on top, so roads on both show
      // as "taken" - the overlap is the part that was already optimal.
      taskMap.repaintScheme();
      taskMap.mark(best.map(String), 'is-best');
      taskMap.mark(taken.map(String), 'is-travelled');
      taskMap.mark([String(taken[taken.length - 1])], 'is-current');
      taskMap.map.zoomToRoads([...new Set([...taken, ...best])]);
      taskMap.focusOn(null);
      feedback('');

      const asNumbers = (ids) => ids.map((id) => numbering[String(id)] ?? '?')
        .join(' &rarr; ');
      const verdict = !arrived ? reason
        : deviation === 1 ? 'Arrived &mdash; and by the shortest route there was.'
        : `Arrived in ${moves} step${moves === 1 ? '' : 's'}. The shortest route
           was ${best.length - 1}.`;

      await review(`
        <div class="prompt-main">${verdict}</div>
        <div class="prompt-sub">
          <span class="answer-line"><i class="answer-key is-route-yours"></i>
            <b>Your route:</b> ${asNumbers(taken)}
            (${moves} step${moves === 1 ? '' : 's'})</span>
          <span class="answer-line"><i class="answer-key is-route-best"></i>
            <b>Shortest route:</b> ${best.length
              ? `${asNumbers(best)} (${best.length - 1} step${
                  best.length === 2 ? '' : 's'})`
              : 'none &mdash; the goal could not be reached'}</span>
        </div>`);

      taskMap.repaintScheme();
      taskMap.map.setOption('roadWidth', 2.2);
      document.getElementById('mapPanel').classList.remove('is-navigating');

      resolve({
        task: 'navigate',
        from: trial.from,
        to: trial.to,
        targetNumber,
        goalRoads: goals.length,
        arrived,
        moves,
        shortestHops: trial.shortestHops,
        routeDeviation: deviation,
        wayfindingErrors: errors,
        backtracks,
        path: taken,
        // The route that was available, so route deviation can be checked
        // against the graph rather than taken on trust.
        bestPath: best,
        routeMetres: Math.round(takenMetres * 10) / 10,
        shortestMetres: byDistance ? Math.round(byDistance.metres * 10) / 10 : null,
        routeDeviationMetres: deviationMetres,
        shortestMetresPath: byDistance ? byDistance.path : null,
        warned,
        ms,
        ...interaction,
      });
    };

    const timeout = setTimeout(
      () => finish(false, 'Time is up for this one.'), limitMs);

    taskMap.onRoadClick((clickedId) => {
      if (done) return;
      const current = path[path.length - 1];
      if (clickedId === current) return;
      if (!neighboursOf(current).includes(clickedId)) {
        const what = numbering[clickedId] === undefined
          ? 'That road' : `Road ${numbering[clickedId]}`;
        feedback(`${what} does not join the one you are on. `
                 + 'Pick one of the roads outlined in blue.', 'bad');
        setTimeout(() => feedback(''), 1600);
        return;
      }
      // A step that leaves you no closer to the goal is a wayfinding error:
      // the numbering pointed the wrong way.
      const beforeDist = hops[Number(current)];
      const afterDist = hops[Number(clickedId)];
      if (afterDist !== undefined && beforeDist !== undefined && afterDist >= beforeDist) {
        errors += 1;
      }
      path.push(clickedId);
      // Arrival is by number, not by road: any stretch carrying it will do.
      if (String(numbering[clickedId]) === String(targetNumber)) {
        finish(true);
        return;
      }
      render();
    });

    taskMap.showNumbering(scheme, { pin: [from, ...neighboursOf(from)] });
    schemeLegend(scheme);
    render();
  });
}

export { legend, prompt, feedback };
