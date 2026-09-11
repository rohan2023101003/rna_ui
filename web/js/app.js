/**
 * Application controller: wires the dataset API, the map renderer and the
 * two-tab UI together.
 *
 *   Tab 1 "View input map"   the cleaned road network exactly as supplied,
 *                            with no numbering applied.
 *   Tab 2 "View output map"  the same geometry with one algorithm's road
 *                            numbers joined on and rendered as labels.
 */

import { api, readFileAsBase64, relevantFiles } from './api.js';
import { EvaluationView } from './evaluate.js';
import { InteractionLogger } from './logger.js';
import { MapView } from './mapview.js';

const $ = (id) => document.getElementById(id);

/* Okabe-Ito: distinguishable under the common forms of colour blindness. */
const CATEGORICAL = ['#0072B2', '#E69F00', '#009E73', '#CC79A7',
                     '#56B4E9', '#D55E00', '#8C6BB1', '#4C7A32'];
const RAMP = ['#2c3d8f', '#3d7fb8', '#4cae9b', '#c9c14a', '#e07a2f', '#a8322a'];
/* Neutral fill for roads whose number is withheld during the task. */
const WITHHELD_COLOR = '#9aa4b0';

const state = {
  datasets: [],
  datasetId: null,
  network: null,        // GeoJSON payload from the API
  numbering: null,      // current algorithm result
  algorithm: null,
  tab: 'input',
  colorMode: 'black',
  buckets: new Map(),   // "partition:number" -> [roadId]
  task: null,
  reference: null,      // a baseline numbering being previewed on the map
};

const map = new MapView($('map'), { tooltipHtml: buildTooltip });
const logger = new InteractionLogger();
const evaluation = new EvaluationView({
  logger,
  onViewNumbering: previewReferenceNumbering,
});

/* ------------------------------------------------------------ bootstrap -- */

init();

async function init() {
  bindTabs();
  bindMapTools();
  bindInputControls();
  bindOutputControls();
  bindUpload();
  bindTaskPreview();
  bindMapEvents();

  try {
    const { datasets } = await api.datasets();
    state.datasets = datasets;
    populateDatasets();
    if (datasets.length) {
      await loadDataset(datasets[0].id);
    } else {
      setStatus('No datasets found. Upload an input folder to begin.');
    }
  } catch (err) {
    toast(`Could not reach the server: ${err.message}`, 'error');
    setStatus('Server unavailable');
  }

  setInterval(renderLogStats, 1500);
}

/* --------------------------------------------------------------- tabs --- */

function bindTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }
}

function switchTab(name) {
  if (state.tab === name) return;
  state.tab = name;
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const pane of document.querySelectorAll('.tab-pane')) {
    pane.classList.toggle('is-active', pane.dataset.pane === name);
  }

  // The evaluation table needs the full width, so it replaces the map and the
  // inspector rather than squeezing in beside them.
  const evaluating = name === 'evaluate';
  $('mapRegion').hidden = evaluating;
  $('evalRegion').hidden = !evaluating;
  document.querySelector('.app-body').classList.toggle('is-evaluating', evaluating);

  logger.log('tab:switch', { tab: name });

  if (evaluating) {
    if (state.datasetId && evaluation.datasetId !== state.datasetId) {
      evaluation.load(state.datasetId);
    }
    return;
  }

  if (name === 'output' && state.network && !state.numbering) {
    const first = $('algorithmSelect').value;
    if (first) loadNumbering(first);
    else refreshMap();
  } else {
    refreshMap();
  }
}

/**
 * Draw one of the reference orderings (Hilbert, RCM, spectral, …) on the map,
 * so a baseline can be compared with an algorithm visually and not only through
 * the table. Useful for producing figures for the paper.
 *
 * The reference is shaped exactly like an algorithm result so it flows through
 * the normal render path - labels, colour modes, inspector and search all work
 * on it unchanged.
 */
async function previewReferenceNumbering(rowId, label) {
  if (!state.datasetId) return;
  showLoading(true, `Building ${label}…`);
  try {
    const result = await api.evaluationRow(
      state.datasetId, rowId, evaluation.settings(), 'numbering');
    if (!result.numbering) {
      toast('That row carries no numbering to draw', 'error');
      return;
    }

    const numbering = {};
    const values = [];
    for (const [roadId, number] of Object.entries(result.numbering)) {
      numbering[roadId] = { road_no: number, seq: null };
      values.push(number);
    }

    state.numbering = {
      id: rowId,
      label,
      isReference: true,
      summary: result.info?.summary || 'Reference ordering, not an algorithm output.',
      stages: [],
      modifiers: [],
      depth: null,
      is_baseline: false,
      partitioned: false,
      bucketed: false,
      numbering,
      stats: {
        numbered: values.length,
        matched: values.length,
        unmatched: 0,
        unassigned: 0,
        min_number: Math.min(...values),
        max_number: Math.max(...values),
        distinct_numbers: new Set(values).size,
        odd_count: values.filter((v) => v % 2).length,
        even_count: values.filter((v) => v % 2 === 0).length,
        partition_count: 0,
        shared_number_groups: 0,
      },
    };
    state.algorithm = rowId;
    state.task = null;

    indexBuckets(state.numbering);
    renderAlgorithmCard(state.numbering);
    resetTaskUI();
    switchTab('output');
    refreshMap();
    setStatus(`${label} — reference ordering, ${values.length} roads numbered`);
    toast(`Showing ${label} on the map`, 'ok');
    logger.log('evaluation:preview', { dataset: state.datasetId, row: rowId });
  } catch (err) {
    toast(`Could not draw ${label}: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/* ----------------------------------------------------------- datasets --- */

function populateDatasets() {
  const select = $('datasetSelect');
  select.replaceChildren();

  const groups = new Map();
  for (const entry of state.datasets) {
    const key = entry.source === 'uploaded' ? 'Uploaded' : entry.city;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  for (const [label, entries] of groups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const entry of entries) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.source === 'uploaded'
        ? entry.network
        : `${entry.network}${entry.has_results ? '' : '  (no results)'}`;
      group.append(option);
    }
    select.append(group);
  }

  select.onchange = () => loadDataset(select.value);
}

async function loadDataset(datasetId) {
  const entry = state.datasets.find((d) => d.id === datasetId);
  if (!entry) return;

  showLoading(true, `Loading ${datasetId}…`);
  const started = performance.now();
  try {
    const payload = await api.network(datasetId);
    state.datasetId = datasetId;
    state.network = payload;
    state.numbering = null;
    state.algorithm = null;
    state.task = null;

    $('datasetSelect').value = datasetId;
    $('statusCoords').textContent = '—';    // readout belonged to the old map
    map.setNetwork(payload);
    renderNetworkStats(payload);
    populateAlgorithms(entry);
    renderHeaderMeta(entry, payload);
    clearInspector();
    refreshMap();

    logger.log('dataset:load', {
      dataset: datasetId,
      roads: payload.stats.road_count,
      load_ms: Math.round(performance.now() - started),
    });
    setStatus(`${payload.stats.road_count} road segments loaded from ${datasetId}`);

    if (state.tab === 'output') {
      const first = $('algorithmSelect').value;
      if (first) await loadNumbering(first);
    } else if (state.tab === 'evaluate') {
      await evaluation.load(datasetId);
    } else {
      evaluation.datasetId = null;   // reload lazily when the tab is opened
    }
  } catch (err) {
    toast(`Failed to load ${datasetId}: ${err.message}`, 'error');
    setStatus('Load failed');
  } finally {
    showLoading(false);
  }
}

function renderNetworkStats(payload) {
  const s = payload.stats;
  const bbox = payload.bbox || [0, 0, 0, 0];
  renderDefinitions($('networkStats'), [
    ['Road segments', s.road_count.toLocaleString()],
    ['Intersections', s.node_count.toLocaleString()],
    ['Total length', `${s.total_length_km.toLocaleString()} km`],
    ['North–South', s.orientation.NS.toLocaleString()],
    ['East–West', s.orientation.EW.toLocaleString()],
    ['Named segments', `${s.named_roads} (${s.distinct_names} distinct)`],
    ['Source CRS', payload.crs.source],
    ['Centre', `${bbox[1].toFixed(3)}, ${bbox[0].toFixed(3)}`],
    ['Road layer', s.layers.roads],
  ]);

  // The paper's premise, visible in the data: hardly any segment carries a
  // usable name, so there is nothing meaningful to label on the input map.
  const toggle = $('toggleNames');
  const note = $('namesNote');
  toggle.disabled = !s.names_useful;
  toggle.closest('.switch').classList.toggle('is-disabled', !s.names_useful);
  if (s.names_useful) {
    note.hidden = true;
  } else {
    note.hidden = false;
    note.textContent = s.distinct_names === 0
      ? 'This network has no street-name column — exactly the gap the numbering algorithm fills.'
      : `Every segment here carries the same name (“${s.road_count} × one value”), so names are not shown.`;
  }
}

function renderHeaderMeta(entry, payload) {
  const chips = [
    `<span class="meta-chip is-accent"><b>${escapeHtml(entry.city)}</b> ${escapeHtml(entry.network)}</span>`,
    `<span class="meta-chip">${payload.stats.road_count.toLocaleString()} segments</span>`,
    `<span class="meta-chip">${entry.algorithms.length} algorithm outputs</span>`,
  ];
  $('headerMeta').innerHTML = chips.join('');
}

/* ---------------------------------------------------------- algorithms -- */

function populateAlgorithms(entry) {
  const select = $('algorithmSelect');
  select.replaceChildren();

  if (!entry.algorithms.length) {
    const option = document.createElement('option');
    option.textContent = 'No result files for this dataset';
    option.disabled = true;
    select.append(option);
    select.disabled = true;
    $('algoCard').innerHTML =
      '<p>Upload result CSV files alongside the network folder to see numbering here.</p>';
    return;
  }

  select.disabled = false;
  const groups = new Map();
  for (const algo of entry.algorithms) {
    const key = algo.is_baseline ? 'Reference baselines' : algo.family_full;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(algo);
  }
  for (const [label, algos] of groups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const algo of algos) {
      const option = document.createElement('option');
      option.value = algo.id;
      option.textContent = algo.label;
      group.append(option);
    }
    select.append(group);
  }

  select.onchange = () => loadNumbering(select.value);
}

async function loadNumbering(algorithmId) {
  if (!state.datasetId) return;
  showLoading(true, 'Applying road numbers…');
  try {
    const result = await api.numbering(state.datasetId, algorithmId);
    state.numbering = result;
    state.algorithm = algorithmId;
    state.task = null;
    $('algorithmSelect').value = algorithmId;

    indexBuckets(result);
    autoColourForPartitions(result);
    renderAlgorithmCard(result);
    resetTaskUI();
    refreshMap();

    logger.log('algorithm:select', {
      dataset: state.datasetId,
      algorithm: algorithmId,
      numbered: result.stats.numbered,
    });
    const s = result.stats;
    setStatus(`${result.label} — ${s.numbered} roads numbered, ` +
              `range ${s.min_number}–${s.max_number}, ` +
              `${s.odd_count} odd / ${s.even_count} even`);
  } catch (err) {
    toast(`Could not load ${algorithmId}: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Partitioned algorithms restart their counter in every partition, so the same
 * road number appears several times across the map. Colouring by partition is
 * the only way to tell those apart, so switch to it automatically - but never
 * override a colour mode the user chose deliberately.
 */
function autoColourForPartitions(result) {
  const partitioned = (result.stats?.partition_count || 0) > 1;
  const select = $('colorMode');
  if (partitioned && state.colorMode === 'black') {
    state.colorMode = 'partition';
  } else if (!partitioned && state.colorMode === 'partition') {
    state.colorMode = 'black';
  } else {
    return;
  }
  select.value = state.colorMode;
}

/** Group roads that were given the same number - one physical road, many segments. */
function indexBuckets(result) {
  state.buckets = new Map();
  for (const [roadId, entry] of Object.entries(result.numbering)) {
    const key = `${entry.partition ?? '-'}:${entry.road_no}`;
    if (!state.buckets.has(key)) state.buckets.set(key, []);
    state.buckets.get(key).push(roadId);
  }
}

function bucketKey(entry) {
  return `${entry.partition ?? '-'}:${entry.road_no}`;
}

function renderAlgorithmCard(result) {
  const s = result.stats;

  if (result.isReference) {
    $('algoCard').innerHTML = `
      <h3>${escapeHtml(result.label)}</h3>
      <div class="algo-file">reference ordering — not an algorithm output</div>
      <p>${escapeHtml(result.summary)}</p>
      <div class="algo-badges">
        <span class="badge is-warn">reference</span>
        <span class="badge">numbers ${s.min_number}–${s.max_number}</span>
        <span class="badge">${s.odd_count} odd / ${s.even_count} even</span>
      </div>`;
    return;
  }

  const badges = [];
  if (result.is_baseline) {
    badges.push('<span class="badge is-warn">reference baseline</span>');
  }
  if (result.partitioned) badges.push(`<span class="badge is-accent">${s.partition_count} partitions</span>`);
  if (result.bucketed) badges.push(`<span class="badge is-accent">${s.shared_number_groups} shared numbers</span>`);
  if (result.depth != null) badges.push(`<span class="badge">depth step k=${result.depth}</span>`);
  badges.push(`<span class="badge">${s.odd_count} odd / ${s.even_count} even</span>`);
  badges.push(`<span class="badge">numbers ${s.min_number}–${s.max_number}</span>`);
  if (s.unmatched) {
    badges.push(`<span class="badge is-warn">${s.unmatched} roads unmatched</span>`);
  }
  if (s.unassigned) {
    badges.push(`<span class="badge is-warn">${s.unassigned} road(s) left unnumbered</span>`);
  }

  const stages = result.stages.map((stage) => `
    <div class="stage">
      <span class="stage-step">${escapeHtml(stage.step)}</span>
      <span class="stage-label">${escapeHtml(stage.label)}</span>
      <span class="stage-summary">${escapeHtml(stage.summary)}</span>
    </div>`).join('');

  $('algoCard').innerHTML = `
    <h3>${escapeHtml(result.label)}</h3>
    <div class="algo-file">${escapeHtml(result.id)}.csv</div>
    <div class="stage-list">${stages}</div>
    <div class="algo-badges">${badges.join('')}</div>`;
}

/* ------------------------------------------------------------ map sync -- */

/** Push the current tab + option state into the renderer. */
function refreshMap() {
  if (!state.network) return;
  const showOutput = state.tab === 'output' && state.numbering;

  const namesUseful = state.network.stats.names_useful;
  map.setOption('showLabels', showOutput
    ? $('toggleLabels').checked
    : ($('toggleNames').checked && namesUseful));
  map.setOption('dedupeLabels', !showOutput);

  if (showOutput) {
    const labels = {};
    for (const [roadId, entry] of Object.entries(state.numbering.numbering)) {
      if (entry.unassigned) continue;      // never show "0" as a road number
      labels[roadId] = String(entry.road_no);
    }
    map.setLabels(labels);
    map.clearLabelStyles();
    if (state.task) applyTaskLabels();
    applyColorMode();
  } else {
    // Input view: street names only, and never any numbering.
    const labels = {};
    for (const road of map.roads) {
      const name = road.props.name;
      if (name) labels[road.id] = String(name);
    }
    map.setLabels(labels);
    map.setHiddenLabels([]);
    map.clearLabelStyles();
    for (const road of map.roads) map.setLabelStyle(road.id, 'is-name');
    applyInputColors();
  }

  renderMapTitle();
  renderLegend();
  map.requestRender();
}

function applyInputColors() {
  if ($('toggleOrientation').checked) {
    map.colorBy((road) => road.props.orientation === 'NS' ? CATEGORICAL[0]
              : road.props.orientation === 'EW' ? CATEGORICAL[1] : null);
  } else {
    map.colorBy(null);
  }
}

function applyColorMode() {
  const numbering = state.numbering?.numbering || {};
  const mode = state.colorMode;

  if (mode === 'black') { map.colorBy(null); return; }

  if (mode === 'orientation') {
    map.colorBy((road) => road.props.orientation === 'NS' ? CATEGORICAL[0]
              : road.props.orientation === 'EW' ? CATEGORICAL[1] : null);
    return;
  }

  if (mode === 'partition') {
    map.colorBy((road) => {
      const partition = numbering[road.id]?.partition;
      return partition == null ? null : CATEGORICAL[partition % CATEGORICAL.length];
    });
    return;
  }

  if (mode === 'number') {
    const { min_number: lo, max_number: hi } = state.numbering.stats;
    const span = Math.max(1, hi - lo);
    map.colorBy((road) => {
      const entry = numbering[road.id];
      // The ramp encodes the number, so a withheld road must stay neutral -
      // otherwise its colour gives the answer away against the legend.
      if (!entry || isNumberWithheld(road.id)) return WITHHELD_COLOR;
      return rampColor((entry.road_no - lo) / span);
    });
    return;
  }

  if (mode === 'bucket') {
    // Colour only the roads that share a number with at least one other.
    const shared = [...state.buckets.entries()].filter(([, ids]) => ids.length > 1);
    const colorOf = new Map();
    shared.forEach(([key], index) => colorOf.set(key, CATEGORICAL[index % CATEGORICAL.length]));
    map.colorBy((road) => {
      const entry = numbering[road.id];
      if (!entry) return null;
      // Sharing a bucket colour with its neighbours would reveal which road
      // this one continues, and therefore its number.
      if (isNumberWithheld(road.id)) return WITHHELD_COLOR;
      return colorOf.get(bucketKey(entry)) || '#c2c9d2';
    });
  }
}

function rampColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (RAMP.length - 1);
  const index = Math.min(RAMP.length - 2, Math.floor(scaled));
  return mixHex(RAMP[index], RAMP[index + 1], scaled - index);
}

function mixHex(a, b, t) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const channel = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`;
}

function renderMapTitle() {
  const entry = state.datasets.find((d) => d.id === state.datasetId);
  if (!entry) { $('mapTitle').innerHTML = ''; return; }

  const showOutput = state.tab === 'output' && state.numbering;
  const lines = [
    `<span class="mt-main">${escapeHtml(entry.city)} — ${escapeHtml(entry.network)}</span>`,
    `<span class="mt-sub">${showOutput ? 'Numbered road network' : 'Input road network (no numbering)'} ` +
      `· ${state.network.stats.road_count.toLocaleString()} segments ` +
      `· ${state.network.stats.total_length_km} km</span>`,
  ];
  if (showOutput) {
    lines.push(`<span class="mt-algo">${escapeHtml(state.numbering.label)}` +
               (state.numbering.isReference
                 ? ' · reference ordering</span>'
                 : ` · ${escapeHtml(state.numbering.id)}.csv</span>`));
  }
  $('mapTitle').innerHTML = lines.join('');
}

function renderLegend() {
  const legend = $('legend');
  if (state.tab !== 'output' || !state.numbering) { legend.innerHTML = ''; return; }

  const row = (color, label) =>
    `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span>${label}</div>`;

  if (state.colorMode === 'orientation') {
    legend.innerHTML =
      row(CATEGORICAL[0], 'North–South road — odd numbers') +
      row(CATEGORICAL[1], 'East–West road — even numbers') +
      '<p class="legend-note">The algorithm approximates every road to its nearest ' +
      'cardinal direction and numbers N–S roads odd, E–W roads even.</p>';
  } else if (state.colorMode === 'partition') {
    const count = state.numbering.stats.partition_count;
    legend.innerHTML = count
      ? Array.from({ length: count }, (_, i) =>
          row(CATEGORICAL[i % CATEGORICAL.length], `Partition ${i}`)).join('') +
        '<p class="legend-note">Min-cut partitions are numbered one at a time, so ' +
        'numbers restart within each partition.</p>'
      : '<p class="legend-note">This algorithm did not use min-cut partitioning.</p>';
  } else if (state.colorMode === 'number') {
    const { min_number: lo, max_number: hi } = state.numbering.stats;
    const stops = RAMP.map((c, i) => `${c} ${(i / (RAMP.length - 1) * 100).toFixed(0)}%`).join(', ');
    legend.innerHTML =
      `<div class="legend-ramp" style="background:linear-gradient(90deg, ${stops})"></div>` +
      `<div class="legend-ramp-labels"><span>${lo}</span><span>${hi}</span></div>`;
  } else if (state.colorMode === 'bucket') {
    const shared = state.numbering.stats.shared_number_groups;
    legend.innerHTML = shared
      ? row(CATEGORICAL[0], 'Segments sharing one road number') +
        row('#c2c9d2', 'Segment with a number of its own') +
        `<p class="legend-note">${shared} groups of segments were bucketed into a ` +
        'single physical road.</p>'
      : '<p class="legend-note">This algorithm did not use bucketing, so every ' +
        'segment has its own number.</p>';
  } else {
    legend.innerHTML = '';
  }
}

/* --------------------------------------------------------- map events --- */

function bindMapEvents() {
  map.on('road:click', ({ roadId }) => {
    logger.log('road:click', { dataset: state.datasetId, algorithm: state.algorithm, road_id: roadId });
  });

  map.on('road:select', ({ roadId }) => {
    if (!roadId) { clearInspector(); map.setHighlighted([]); return; }
    renderInspector(roadId);
    const entry = state.numbering?.numbering[roadId];
    // Lighting up the other segments that share the number points straight at
    // the answer, so withheld roads get no highlight.
    if (entry && state.tab === 'output' && !isNumberWithheld(roadId)) {
      const mates = state.buckets.get(bucketKey(entry)) || [];
      map.setHighlighted(mates.length > 1 ? mates.filter((id) => id !== roadId) : []);
    } else {
      map.setHighlighted([]);
    }
  });

  map.on('view:change', (view) => {
    if (view.reason === 'pan') logger.logGesture('map:pan', {});
    else if (view.reason === 'zoom') logger.logGesture('map:zoom', { scale: round(view.k, 3) });
    else logger.log(`map:${view.reason}`, { scale: round(view.k, 3) });
    renderScaleBar();
  });

  map.on('pointer:move', ({ lonlat }) => {
    $('statusCoords').textContent = `${lonlat[1].toFixed(5)}, ${lonlat[0].toFixed(5)}`;
  });

  map.on('labels:render', ({ shown, total }) => {
    $('statusLabels').textContent = total ? `${shown} / ${total} labels` : '—';
  });

  map.on('network:load', () => renderScaleBar());
}

/**
 * True while a road's number is being withheld for the evaluation task.
 *
 * Every surface that could show or encode a road number has to consult this,
 * otherwise the participant can simply read off the answer instead of
 * reasoning about it.
 */
function isNumberWithheld(roadId) {
  return Boolean(state.task?.pending.has(String(roadId)));
}

function buildTooltip(road) {
  const rows = [`<strong>${escapeHtml(road.props.name || `Road segment ${road.id}`)}</strong>`];
  const entry = state.numbering?.numbering[road.id];
  if (state.tab === 'output' && entry) {
    rows.push(isNumberWithheld(road.id)
      ? '<div class="tt-row tt-hidden">Road number hidden — click to answer</div>'
      : `<div class="tt-row">Road number <span class="tt-no">${entry.road_no}</span>` +
        `${entry.partition != null ? ` · partition ${entry.partition}` : ''}</div>`);
  }
  rows.push(`<div class="tt-row">${road.props.length_m} m · ` +
            `${road.props.orientation === 'NS' ? 'North–South' : 'East–West'}</div>`);
  if (road.props.category) rows.push(`<div class="tt-row">${escapeHtml(road.props.category)}</div>`);
  return rows.join('');
}

function renderScaleBar() {
  const metres = map.metresPerPixel() * 60;
  const nice = niceRound(metres);
  const width = (nice / map.metresPerPixel());
  const bar = $('scaleBar');
  bar.querySelector('i').style.width = `${Math.min(150, Math.max(24, width))}px`;
  bar.querySelector('em').textContent = nice >= 1000
    ? `${(nice / 1000).toFixed(nice % 1000 ? 1 : 0)} km`
    : `${Math.round(nice)} m`;
}

function niceRound(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/* ---------------------------------------------------------- inspector --- */

function clearInspector() {
  $('inspectorBody').className = 'inspector-empty';
  $('inspectorBody').textContent =
    'Click any road on the map to see its attributes and assigned number.';
}

function renderInspector(roadId) {
  const road = map.roadsById.get(String(roadId));
  if (!road) return;
  const props = road.props;
  const entry = state.tab === 'output' ? state.numbering?.numbering[roadId] : null;
  const isBlank = state.task?.pending.has(String(roadId));

  const orientationText = props.orientation === 'NS' ? 'North–South'
                        : props.orientation === 'EW' ? 'East–West' : 'unknown';

  const hasNumber = entry && !entry.unassigned;
  const numberBlock = hasNumber && !isBlank
    ? `<div class="inspect-number">${entry.road_no}<small>road no.</small></div>`
    : `<div class="inspect-number is-none">${isBlank ? '?' : '–'}<small>road no.</small></div>`;

  const facts = [
    ['Segment id', props.road_id],
    ['Row in file', props.seq],
    ['Length', `${props.length_m} m`],
    ['Bearing', props.bearing_deg != null ? `${props.bearing_deg}°` : '—'],
    ['Direction', orientationText],
    ['From node', props.source ?? '—'],
    ['To node', props.target ?? '—'],
  ];
  if (props.category) facts.push(['Class', props.category]);

  const numberFacts = [];
  if (entry && !isBlank) {
    if (hasNumber) {
      numberFacts.push(['Assigned number', entry.road_no]);
      numberFacts.push(['Parity', entry.road_no % 2 ? 'odd (North–South)' : 'even (East–West)']);
      // A road within a few degrees of the 45° diagonal could reasonably be
      // called either direction, so it is not a violation of the rule.
      const consistent = (entry.road_no % 2 === 1) === (props.orientation === 'NS');
      numberFacts.push(['Matches direction rule',
        props.near_diagonal ? 'diagonal road — rule not applicable'
                            : (consistent ? 'yes' : 'no')]);
    } else {
      numberFacts.push(['Assigned number', 'not assigned by this algorithm']);
    }
    if (entry.seq != null) numberFacts.push(['Numbering order', `#${entry.seq + 1}`]);
    if (entry.partition != null) numberFacts.push(['Partition', entry.partition]);
  }

  // Naming the shared number, or listing the segments that carry it, would
  // hand over the answer just as plainly as printing it.
  const mates = entry && !isBlank ? (state.buckets.get(bucketKey(entry)) || []) : [];
  const bucketBlock = mates.length > 1 ? `
    <div class="inspect-section">
      <h4>Shares number ${entry.road_no} with ${mates.length - 1} other segment(s)</h4>
      <div class="bucket-list">
        ${mates.map((id) => `<button class="bucket-chip${id === String(roadId) ? ' is-current' : ''}" data-goto="${id}">${id}</button>`).join('')}
      </div>
    </div>` : '';

  const answerBlock = isBlank ? `
    <div class="answer-box">
      <p>This road's number has been hidden. What number would you expect it to have?</p>
      <div class="answer-row">
        <input type="number" id="answerInput" placeholder="e.g. 42" min="1" step="1">
        <button class="btn btn-sm" id="answerBtn">Submit</button>
      </div>
      <div class="answer-feedback" id="answerFeedback"></div>
    </div>` : '';

  const body = $('inspectorBody');
  body.className = '';
  body.innerHTML = `
    <div class="inspect-head">
      ${numberBlock}
      <div class="inspect-title">
        <h3>${escapeHtml(props.name || `Segment ${props.road_id}`)}</h3>
        <p>${escapeHtml(orientationText)} · ${props.length_m} m</p>
      </div>
    </div>
    ${numberFacts.length ? `<div class="inspect-section"><h4>Numbering</h4>
      <dl class="stat-grid">${definitionRows(numberFacts)}</dl></div>` : ''}
    <div class="inspect-section">
      <h4>Segment attributes</h4>
      <dl class="stat-grid">${definitionRows(facts)}</dl>
    </div>
    ${bucketBlock}
    ${answerBlock}
    <div class="inspect-section">
      <button class="attr-toggle" id="rawToggle">Show all source attributes</button>
      <dl class="stat-grid attr-raw" id="rawAttrs" hidden>
        ${definitionRows(Object.entries(props.attrs || {}))}
      </dl>
    </div>`;

  body.querySelector('#rawToggle')?.addEventListener('click', (event) => {
    const panel = body.querySelector('#rawAttrs');
    panel.hidden = !panel.hidden;
    event.target.textContent = panel.hidden
      ? 'Show all source attributes' : 'Hide source attributes';
  });

  for (const chip of body.querySelectorAll('[data-goto]')) {
    chip.addEventListener('click', () => {
      map.select(chip.dataset.goto, { pan: true });
      logger.log('bucket:navigate', { road_id: chip.dataset.goto });
    });
  }

  if (isBlank) bindAnswerBox(String(roadId));
  document.getElementById('inspector').classList.add('is-open');
}

function definitionRows(pairs) {
  return pairs.map(([key, value]) =>
    `<dt>${escapeHtml(String(key))}</dt><dd>${escapeHtml(String(value ?? '—'))}</dd>`).join('');
}

function renderDefinitions(element, pairs) {
  element.innerHTML = definitionRows(pairs);
}

/* --------------------------------------------------- input tab controls -- */

function bindInputControls() {
  $('toggleNodes').addEventListener('change', (event) => {
    map.setOption('showNodes', event.target.checked);
    logger.log('layer:toggle', { layer: 'nodes', on: event.target.checked });
  });

  $('toggleNames').addEventListener('change', () => refreshMap());
  $('toggleOrientation').addEventListener('change', () => refreshMap());

  $('roadWidth').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('widthOut').textContent = value.toFixed(1);
    map.setOption('roadWidth', value);
  });
}

/* -------------------------------------------------- output tab controls -- */

function bindOutputControls() {
  $('toggleLabels').addEventListener('change', () => {
    refreshMap();
    logger.log('labels:toggle', { on: $('toggleLabels').checked });
  });

  $('labelDensity').addEventListener('input', (event) => {
    const percent = Number(event.target.value);
    $('densityOut').textContent = `${percent}%`;
    map.setOption('labelDensity', percent / 100);
  });

  $('colorMode').addEventListener('change', (event) => {
    state.colorMode = event.target.value;
    refreshMap();
    logger.log('colour:mode', { mode: state.colorMode });
  });

  $('searchBtn').addEventListener('click', runSearch);
  $('searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runSearch();
  });
  $('searchInput').addEventListener('input', () => {
    if (!$('searchInput').value.trim()) $('searchResults').replaceChildren();
  });
}

function runSearch() {
  const query = $('searchInput').value.trim().toLowerCase();
  const results = $('searchResults');
  results.replaceChildren();
  if (!query || !state.network) return;

  const numbering = state.numbering?.numbering || {};
  const matches = [];
  for (const road of map.roads) {
    const entry = numbering[road.id];
    const withheld = isNumberWithheld(road.id);
    // Searching a number must not locate a road whose number is withheld.
    const number = entry && !withheld ? String(entry.road_no) : null;
    const name = (road.props.name || '').toLowerCase();
    if (number === query || (name && name.includes(query)) || road.id === query) {
      matches.push({ road, entry, withheld });
    }
    if (matches.length >= 40) break;
  }

  logger.log('search', { query, hits: matches.length });

  if (!matches.length) {
    const li = document.createElement('li');
    li.innerHTML = '<button disabled><span class="result-name">No matching road</span></button>';
    results.append(li);
    return;
  }

  for (const { road, entry, withheld } of matches) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.innerHTML =
      `<span class="result-no">${withheld ? '?' : (entry ? entry.road_no : '–')}</span>` +
      `<span class="result-name">${escapeHtml(road.props.name || `Segment ${road.id}`)}</span>` +
      `<span class="result-meta">${road.props.length_m} m</span>`;
    button.addEventListener('click', () => {
      map.zoomToRoad(road.id);
      map.select(road.id);
      logger.log('search:goto', { road_id: road.id, query });
    });
    li.append(button);
    results.append(li);
  }
}

/* ----------------------------------------------------------- map tools -- */

function bindMapTools() {
  $('zoomIn').addEventListener('click', () => map.zoomBy(1.4));
  $('zoomOut').addEventListener('click', () => map.zoomBy(1 / 1.4));
  $('fitBtn').addEventListener('click', () => map.fit());
  $('exportBtn').addEventListener('click', exportSvg);
}

function exportSvg() {
  const svg = map.toSVGString();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const parts = [state.datasetId?.replace(/\//g, '-') || 'network'];
  if (state.tab === 'output' && state.algorithm) parts.push(state.algorithm);
  link.href = url;
  link.download = `${parts.join('_')}.svg`;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  // Revoking straight away can cancel the download before the browser has read
  // the blob, so hold the URL until it is certainly finished.
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 60000);
  logger.log('export', { format: 'svg', dataset: state.datasetId, algorithm: state.algorithm });
  toast('Map exported as SVG', 'ok');
}

/* -------------------------------------------------------------- upload -- */

function bindUpload() {
  const dropzone = $('dropzone');
  const folderInput = $('folderInput');
  const fileInput = $('fileInput');

  dropzone.addEventListener('click', () => folderInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); folderInput.click(); }
  });
  $('pickFilesBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    fileInput.click();
  });

  folderInput.addEventListener('change', () => handleUpload(folderInput.files));
  fileInput.addEventListener('change', () => handleUpload(fileInput.files));

  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-over');
    });
  }
  dropzone.addEventListener('drop', async (event) => {
    const files = await collectDroppedFiles(event.dataTransfer);
    handleUpload(files);
  });
}

/** Walk a dropped directory tree; browsers only expose it through this API. */
async function collectDroppedFiles(transfer) {
  const entries = [...(transfer.items || [])]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...transfer.files];

  const files = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await walk(child);
      } while (batch.length);
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

async function handleUpload(fileList) {
  const status = $('uploadStatus');
  const files = relevantFiles(fileList);
  if (!files.length) {
    setUploadStatus('No .shp / .dbf / .prj files found in that selection.', 'error');
    return;
  }
  if (!files.some((f) => f.name.toLowerCase().endsWith('.shp'))) {
    setUploadStatus('That folder has no .shp file - the geometry cannot be read.', 'error');
    return;
  }

  const folderName = (files[0].webkitRelativePath || '').split('/')[0] || 'Uploaded network';
  setUploadStatus(`Reading ${files.length} files…`);
  showLoading(true, 'Processing uploaded network…');

  try {
    const encoded = await Promise.all(files.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      data: await readFileAsBase64(file),
    })));

    const record = await api.upload({
      name: folderName,
      city: 'Uploaded',
      network: folderName,
      files: encoded,
    });

    const { datasets } = await api.datasets();
    state.datasets = datasets;
    populateDatasets();
    await loadDataset(record.id);

    const csvCount = files.filter((f) => f.name.toLowerCase().endsWith('.csv')).length;
    setUploadStatus(
      `Loaded "${folderName}" — ${record.stats.road_count} road segments` +
      `${csvCount ? `, ${csvCount} result file(s)` : ', no result files'}.`, 'ok');
    logger.log('dataset:upload', { name: folderName, files: files.length });
    toast('Network uploaded and rendered', 'ok');
  } catch (err) {
    setUploadStatus(`Upload failed: ${err.message}`, 'error');
    toast(`Upload failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
    $('folderInput').value = '';
    $('fileInput').value = '';
  }
}

function setUploadStatus(message, kind = '') {
  const element = $('uploadStatus');
  element.hidden = false;
  element.textContent = message;
  element.className = `upload-status${kind ? ` is-${kind}` : ''}`;
}

/* ------------------------------------------------------- task preview --- */

function bindTaskPreview() {
  $('blankCount').addEventListener('input', (event) => {
    $('blankOut').textContent = event.target.value;
  });
  $('startTaskBtn').addEventListener('click', startTask);
  $('endTaskBtn').addEventListener('click', endTask);
}

function resetTaskUI() {
  state.task = null;
  $('startTaskBtn').disabled = false;
  $('endTaskBtn').disabled = true;
  $('taskStatus').innerHTML = '';
  map.setHiddenLabels([]);
  map.clearLabelStyles();
}

function startTask() {
  if (!state.numbering) {
    toast('Choose an algorithm on the output tab first', 'error');
    return;
  }
  switchTab('output');

  // Prefer longer roads: they are the ones a participant can actually reason
  // about from the surrounding numbers.
  const candidates = map.roads
    .filter((road) => {
      const entry = state.numbering.numbering[road.id];
      return entry && !entry.unassigned;   // nothing to score a guess against
    })
    .sort((a, b) => (b.props.length_m || 0) - (a.props.length_m || 0))
    .slice(0, Math.max(30, map.roads.length * 0.4));

  const wanted = Math.min(Number($('blankCount').value), candidates.length);
  const chosen = shuffle(candidates).slice(0, wanted).map((road) => road.id);

  state.task = {
    startedAt: performance.now(),
    pending: new Set(chosen),
    answers: new Map(),
  };

  applyTaskLabels();
  applyColorMode();          // repaint so withheld roads drop to neutral
  map.select(null);
  $('startTaskBtn').disabled = true;
  $('endTaskBtn').disabled = false;
  renderTaskStatus();

  logger.log('task:start', {
    dataset: state.datasetId,
    algorithm: state.algorithm,
    blanked: chosen.length,
    road_ids: chosen,
  });
  toast(`${chosen.length} road numbers hidden - click a "?" road to answer`, 'ok');
}

function applyTaskLabels() {
  if (!state.task) return;
  map.setHiddenLabels([...state.task.pending]);
  map.clearLabelStyles();
  for (const roadId of state.task.pending) {
    map.setRoadStyle(roadId, { className: 'is-blanked' });
  }
  for (const [roadId, answer] of state.task.answers) {
    map.setLabel(roadId, String(answer.guess));
    map.setLabelStyle(roadId, 'is-answered');
  }
}

function bindAnswerBox(roadId) {
  const input = $('answerInput');
  const submit = () => {
    const guess = Number(input.value);
    if (!Number.isFinite(guess) || guess <= 0) {
      input.focus();
      return;
    }
    const actual = state.numbering.numbering[roadId].road_no;
    const road = map.roadsById.get(roadId);

    state.task.pending.delete(roadId);
    state.task.answers.set(roadId, {
      guess,
      actual,
      delta: Math.abs(guess - actual),
      parity_match: (guess % 2) === (actual % 2),
      answered_at: performance.now() - state.task.startedAt,
    });

    map.setHiddenLabels([...state.task.pending]);
    map.setLabel(roadId, String(guess));
    map.setLabelStyle(roadId, 'is-answered');
    map.setRoadStyle(roadId, { className: '' });
    applyColorMode();        // answered: this road may show its colour again

    const delta = Math.abs(guess - actual);
    const feedback = $('answerFeedback');
    feedback.className = `answer-feedback ${delta <= 4 ? 'is-close' : 'is-far'}`;
    feedback.textContent =
      `Algorithm assigned ${actual}. You said ${guess} — difference of ${delta}` +
      `${(guess % 2) === (actual % 2) ? ', same parity.' : ', different parity.'}`;

    logger.log('task:answer', {
      dataset: state.datasetId,
      algorithm: state.algorithm,
      road_id: roadId,
      guess,
      actual,
      delta,
      orientation: road?.props.orientation,
      response_ms: Math.round(performance.now() - state.task.startedAt),
    });
    renderTaskStatus();
  };

  $('answerBtn').addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  input.focus();
}

function renderTaskStatus() {
  if (!state.task) { $('taskStatus').innerHTML = ''; return; }
  const answered = state.task.answers.size;
  const remaining = state.task.pending.size;
  $('taskStatus').innerHTML =
    `<strong>${answered}</strong> answered · <strong>${remaining}</strong> remaining`;
  if (!remaining && answered) endTask();
}

function endTask() {
  if (!state.task) return;
  const answers = [...state.task.answers.values()];
  map.setHiddenLabels([]);
  for (const roadId of state.task.pending) map.setRoadStyle(roadId, { className: '' });

  if (!answers.length) {
    $('taskStatus').innerHTML = '<em>Task ended with no answers.</em>';
    resetTaskUI();
    refreshMap();
    return;
  }

  const deltas = answers.map((a) => a.delta).sort((a, b) => a - b);
  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
  const median = deltas[Math.floor(deltas.length / 2)];
  const within5 = deltas.filter((d) => d <= 5).length;
  const parity = answers.filter((a) => a.parity_match).length;

  const summary = {
    answered: answers.length,
    mean_abs_error: round(mean, 2),
    median_abs_error: median,
    within_5: within5,
    parity_agreement: parity,
  };

  $('taskStatus').innerHTML = `
    <strong>${answers.length}</strong> answers scored against
    ${escapeHtml(state.numbering.label)}.
    <dl class="task-score">
      <dt>Mean absolute difference</dt><dd>${summary.mean_abs_error}</dd>
      <dt>Median absolute difference</dt><dd>${summary.median_abs_error}</dd>
      <dt>Within 5 of the algorithm</dt><dd>${within5} / ${answers.length}</dd>
      <dt>Same odd/even parity</dt><dd>${parity} / ${answers.length}</dd>
    </dl>`;

  logger.log('task:end', {
    dataset: state.datasetId, algorithm: state.algorithm, ...summary,
    duration_ms: Math.round(performance.now() - state.task.startedAt),
  });
  logger.flush();

  state.task = null;
  $('startTaskBtn').disabled = false;
  $('endTaskBtn').disabled = true;
  refreshMap();
}

/* ------------------------------------------------------------- logging -- */

function renderLogStats() {
  const summary = logger.summary();
  const entries = Object.entries(summary).slice(0, 7);
  const element = $('logStats');
  element.innerHTML = entries.length
    ? definitionRows(entries)
    : '<dd class="is-empty">No interactions recorded yet.</dd>';
}

$('toggleLogging').addEventListener('change', (event) => {
  logger.enabled = event.target.checked;
  setStatus(event.target.checked ? 'Interaction logging on' : 'Interaction logging paused');
});

/* -------------------------------------------------------------- chrome -- */

function showLoading(on, text = 'Loading…') {
  $('mapLoading').hidden = !on;
  $('loadingText').textContent = text;
}

function setStatus(message) {
  $('statusMessage').textContent = message;
}

function toast(message, kind = '') {
  const element = document.createElement('div');
  element.className = `toast${kind ? ` is-${kind}` : ''}`;
  element.textContent = message;
  $('toastStack').append(element);
  setTimeout(() => element.remove(), 4200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
