/**
 * Evaluation tab: scores every numbering against the framework in
 * EVALUATION.md and renders the results as a comparison table.
 *
 * Rows are fetched one at a time so the table fills progressively and the
 * browser stays responsive - a full sweep on the largest network is a few
 * hundred permutation tests. The metric catalogue comes from the server, so
 * this file never hard-codes what a column means or which direction is good.
 */

import { api } from './api.js';

const $ = (id) => document.getElementById(id);

/* A representative subset when you do not want all 23 rows. Deliberately spans
   the full spread of number ranges (bucketed, partitioned and plain variants),
   because that spread is what the Metric 1 confound check needs to see. */
const KEY_SUBSET = [
  'mucs', 'mucs_B', 'mucs_GP', 'mucs_BGP',
  'middfs_d5', 'middfs_B_d5', 'mdfs', 'bfs', 'dfs',
  'baseline:random', 'baseline:coordinate', 'baseline:hilbert',
  'baseline:hilbert_parity', 'baseline:rcm',
];

export class EvaluationView {
  constructor({ logger, onViewNumbering }) {
    this.logger = logger;
    this.onViewNumbering = onViewNumbering;
    this.setup = null;
    this.datasetId = null;
    this.results = new Map();     // row id -> scored row
    this.hiddenGroups = new Set();
    this.sortKey = null;
    this.sortDir = 1;
    this.running = false;
    this._bind();
  }

  _bind() {
    $('evalRadius').addEventListener('input', (e) => {
      $('radiusOut').textContent = `${e.target.value} m`;
    });
    $('evalPerms').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      $('permsOut').textContent = v === 0 ? 'off' : String(v);
    });
    $('evalSelectAll').addEventListener('click', () => this._setSelection(() => true));
    $('evalSelectNone').addEventListener('click', () => this._setSelection(() => false));
    $('evalSelectKey').addEventListener('click', () =>
      this._setSelection((id) => KEY_SUBSET.includes(id)));
    $('evalRun').addEventListener('click', () => this.run());
    $('evalExport').addEventListener('click', () => this.exportCsv());
  }

  /** Called whenever the active dataset changes. */
  async load(datasetId) {
    this.datasetId = datasetId;
    this.results.clear();
    this.setup = null;
    $('evalExport').disabled = true;
    this._renderEmpty('Loading network structure…');
    try {
      this.setup = await api.evaluationSetup(datasetId, this.settings());
      this._renderPicker();
      this._renderGroups();
      this._renderHeader();
      this._renderEmpty();
    } catch (err) {
      this._renderEmpty(`Could not prepare evaluation: ${err.message}`);
    }
  }

  settings() {
    return {
      radius: Number($('evalRadius').value),
      permutations: Number($('evalPerms').value),
      mode: $('evalMode').value,
    };
  }

  // ------------------------------------------------------------ picker --

  _renderPicker() {
    const picker = $('evalRowPicker');
    picker.replaceChildren();
    if (!this.setup) return;

    const groups = new Map([['Algorithms', []], ['Reference baselines', []]]);
    for (const row of this.setup.rows) {
      groups.get(row.kind === 'baseline' ? 'Reference baselines' : 'Algorithms').push(row);
    }

    for (const [title, rows] of groups) {
      if (!rows.length) continue;
      const heading = document.createElement('h3');
      heading.className = 'row-picker-title';
      heading.textContent = title;
      picker.append(heading);
      for (const row of rows) {
        const label = document.createElement('label');
        label.className = 'row-pick';
        label.title = row.summary || row.label;
        label.innerHTML =
          `<input type="checkbox" value="${escapeAttr(row.id)}"` +
          `${KEY_SUBSET.includes(row.id) ? ' checked' : ''}>` +
          `<span class="row-pick-label">${escapeHtml(row.label)}</span>` +
          (row.role ? `<span class="row-pick-role">${escapeHtml(row.role)}</span>` : '');
        picker.append(label);
      }
    }
  }

  _setSelection(predicate) {
    for (const box of $('evalRowPicker').querySelectorAll('input')) {
      box.checked = predicate(box.value);
    }
  }

  _selected() {
    return [...$('evalRowPicker').querySelectorAll('input:checked')].map((b) => b.value);
  }

  // ------------------------------------------------------------- groups --

  _renderGroups() {
    const container = $('evalGroups');
    container.replaceChildren();
    if (!this.setup) return;
    const seen = [];
    for (const metric of this.setup.metrics) {
      if (!seen.includes(metric.group)) seen.push(metric.group);
    }
    for (const group of seen) {
      const chip = document.createElement('button');
      chip.className = 'group-chip is-on';
      chip.textContent = group;
      chip.addEventListener('click', () => {
        if (this.hiddenGroups.has(group)) this.hiddenGroups.delete(group);
        else this.hiddenGroups.add(group);
        chip.classList.toggle('is-on', !this.hiddenGroups.has(group));
        this.render();
      });
      container.append(chip);
    }
  }

  _renderHeader() {
    const context = this.setup?.context;
    if (!context) return;
    $('evalTitle').textContent = `Evaluation — ${this.datasetId}`;
    const bits = [
      `${context.segments.toLocaleString()} segments`,
      `${context.line_graph_edges.toLocaleString()} junction links`,
      `${context.mean_spatial_neighbours.toFixed(1)} neighbours within ${context.radius_m} m`,
      context.components > 1 ? `${context.components} disconnected components` : 'fully connected',
    ];
    if (!context.ground_truth_available) {
      bits.push('no usable street names → ARI unavailable');
    }
    $('evalSubtitle').textContent = bits.join(' · ');
  }

  // ---------------------------------------------------------------- run --

  async run() {
    if (this.running || !this.setup) return;
    const rows = this._selected();
    if (!rows.length) {
      this._renderEmpty('Select at least one numbering to score.');
      return;
    }

    this.running = true;
    $('evalRun').disabled = true;
    this.results.clear();
    const settings = this.settings();
    const started = performance.now();

    // Radius and neighbour mode change the underlying context, so refresh the
    // header and metric catalogue before scoring against them.
    try {
      this.setup = await api.evaluationSetup(this.datasetId, settings);
      this._renderHeader();
    } catch (err) {
      this._renderEmpty(`Could not prepare evaluation: ${err.message}`);
      this.running = false;
      $('evalRun').disabled = false;
      return;
    }

    $('evalProgress').hidden = false;
    let done = 0;
    const failures = [];

    for (const rowId of rows) {
      $('evalProgressText').textContent = `${rowId} — ${done + 1} of ${rows.length}`;
      $('evalProgressBar').style.width = `${(done / rows.length) * 100}%`;
      try {
        const result = await api.evaluationRow(this.datasetId, rowId, settings);
        if (result.available) this.results.set(rowId, result);
        else failures.push(`${rowId}: ${result.reason || 'unavailable'}`);
      } catch (err) {
        failures.push(`${rowId}: ${err.message}`);
      }
      done += 1;
      this.render();
    }

    $('evalProgressBar').style.width = '100%';
    $('evalProgressText').textContent =
      `${this.results.size} scored in ${((performance.now() - started) / 1000).toFixed(1)} s` +
      (failures.length ? ` · ${failures.length} failed` : '');
    setTimeout(() => { $('evalProgress').hidden = true; }, 2500);

    this.running = false;
    $('evalRun').disabled = false;
    $('evalExport').disabled = this.results.size === 0;
    this.logger?.log('evaluation:run', {
      dataset: this.datasetId, rows: rows.length, scored: this.results.size, ...settings,
    });
    if (failures.length) console.warn('evaluation failures:', failures);
    this.render();
  }

  // ------------------------------------------------------------- render --

  _renderEmpty(message) {
    const body = $('evalBody');
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = 'eval-empty';
    box.innerHTML = message
      ? `<h3>${escapeHtml(message)}</h3>`
      : `<h3>Nothing scored yet</h3>
         <p>Pick the numberings to compare on the left, then run the evaluation.
         Reference baselines — a random permutation as the floor and a Hilbert
         curve as the ceiling — are included so the scores have something to be
         read against.</p>`;
    body.append(box);
  }

  render() {
    if (!this.setup || !this.results.size) {
      if (!this.running) this._renderEmpty();
      return;
    }
    const body = $('evalBody');
    body.replaceChildren();
    body.append(this._confoundCard());
    body.append(this._table());
    body.append(this._footnote());
  }

  /** The headline diagnostic: why the published Metric 1 cannot be trusted. */
  _confoundCard() {
    // Computed over algorithm outputs only. Every reference baseline is a
    // permutation of 1..m by construction, so they all share one number range
    // and including them would dilute exactly the correlation being tested.
    const rows = [...this.results.values()].filter(
      (r) => r.kind === 'algorithm'
             && r.values.paper_m1 != null
             && r.values.number_range != null
             && r.values.morans_i != null);
    const m1 = rows.map((r) => r.values.paper_m1);
    const range = rows.map((r) => r.values.number_range);
    const moran = rows.map((r) => r.values.morans_i);

    const card = document.createElement('section');
    card.className = 'eval-card';
    if (rows.length < 4) {
      card.innerHTML =
        `<h3>Metric 1 confound check</h3>
         <p class="eval-card-note">Score at least four <em>algorithm</em> outputs to
         test how far the published Metric 1 tracks the number range rather than
         spatial quality. Reference baselines are excluded from this check: each is a
         permutation of 1..m, so they all share one range.</p>`;
      return card;
    }
    if (new Set(range).size < 2) {
      card.innerHTML =
        `<h3>Metric 1 confound check</h3>
         <p class="eval-card-note">All ${rows.length} scored algorithms happen to use
         the same number range, so there is no variation to correlate against. Include
         bucketed (<code>_B</code>) or partitioned (<code>_GP</code>) variants, which
         compress the range.</p>`;
      return card;
    }

    const vsRange = spearman(m1, range);
    const vsMoran = spearman(m1, moran);
    // The verdict rests on the range correlation alone: that is the confound.
    // How Metric 1 relates to Moran's I is reported alongside as evidence of
    // what it is failing to measure, but it is not part of the test.
    const magnitude = Math.abs(vsRange);
    const verdict = magnitude > 0.8 ? 'confounded'
                  : magnitude > 0.5 ? 'partly confounded'
                  : 'not detected';

    card.innerHTML = `
      <h3>Metric 1 confound check <span class="pill ${
        verdict === 'not detected' ? 'pill-ok' : 'pill-bad'}">${verdict}</span></h3>
      <div class="confound-grid">
        <div class="confound-stat">
          <span class="confound-value ${magnitude > 0.5 ? 'is-bad' : ''}">${fmtSigned(vsRange, 3)}</span>
          <span class="confound-label">Spearman(Metric 1, number range)</span>
        </div>
        <div class="confound-stat">
          <span class="confound-value ${Math.abs(vsMoran) < 0.5 ? 'is-bad' : ''}">${fmtSigned(vsMoran, 3)}</span>
          <span class="confound-label">Spearman(Metric 1, Moran's I)</span>
        </div>
        <p class="confound-text">
          Across the ${rows.length} algorithm outputs scored here, the published Metric 1
          ${magnitude > 0.8 ? 'is almost entirely explained by'
            : magnitude > 0.5 ? 'substantially tracks' : 'shows little relation to'}
          how many distinct numbers an algorithm used, while its agreement with
          Moran's I — the standard statistic for the spatial coherence it claims to
          measure — is ${fmtSigned(vsMoran, 2)}. Metric 1 has units of "road numbers"
          and is not scale-invariant: doubling every number doubles the score on
          identical geometry.
        </p>
      </div>`;
    return card;
  }

  _table() {
    const metrics = this.setup.metrics.filter((m) => !this.hiddenGroups.has(m.group));
    const rows = [...this.results.values()];

    // Best value per column, respecting each metric's preferred direction.
    const best = new Map();
    for (const metric of metrics) {
      if (metric.better === 'none') continue;
      const values = rows.map((r) => r.values[metric.key]).filter((v) => v != null);
      if (!values.length) continue;
      best.set(metric.key, metric.better === 'high'
        ? Math.max(...values) : Math.min(...values));
    }

    if (this.sortKey) {
      const dir = this.sortDir;
      rows.sort((a, b) => {
        const x = a.values[this.sortKey];
        const y = b.values[this.sortKey];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x - y) * dir;
      });
    }

    const wrap = document.createElement('div');
    wrap.className = 'eval-table-wrap';
    const table = document.createElement('table');
    table.className = 'eval-table';

    // Two header rows: metric groups, then the metrics themselves.
    const groupRow = document.createElement('tr');
    groupRow.innerHTML = '<th class="sticky-col"></th>';
    let index = 0;
    while (index < metrics.length) {
      const group = metrics[index].group;
      let span = 0;
      while (index + span < metrics.length && metrics[index + span].group === group) span++;
      const th = document.createElement('th');
      th.colSpan = span;
      th.className = 'group-head';
      th.textContent = group;
      groupRow.append(th);
      index += span;
    }

    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'sticky-col';
    corner.textContent = 'Numbering';
    headRow.append(corner);
    for (const metric of metrics) {
      const th = document.createElement('th');
      th.className = 'metric-head';
      if (this.sortKey === metric.key) th.classList.add('is-sorted');
      const arrow = metric.better === 'high' ? '↑' : metric.better === 'low' ? '↓' : '';
      th.innerHTML =
        `<span class="metric-name">${escapeHtml(metric.label)}` +
        `<span class="metric-dir" title="${metric.better === 'high' ? 'higher is better'
          : metric.better === 'low' ? 'lower is better' : 'no preferred direction'}">${arrow}</span></span>`;
      th.title = `${metric.summary}\n\n${metric.source}`;
      th.addEventListener('click', () => {
        if (this.sortKey === metric.key) this.sortDir *= -1;
        else { this.sortKey = metric.key; this.sortDir = metric.better === 'high' ? -1 : 1; }
        this.render();
      });
      headRow.append(th);
    }

    const thead = document.createElement('thead');
    thead.append(groupRow, headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.className = row.kind === 'baseline' ? 'is-baseline' : '';

      const name = document.createElement('th');
      name.className = 'sticky-col';
      const role = row.info?.role;
      name.innerHTML =
        `<span class="row-name">${escapeHtml(row.label)}</span>` +
        (role ? `<span class="row-role role-${escapeAttr(role)}">${escapeHtml(role)}</span>` : '');
      if (row.kind === 'baseline' && this.onViewNumbering) {
        const view = document.createElement('button');
        view.className = 'row-view';
        view.textContent = 'view';
        view.title = 'Show this reference numbering on the map';
        view.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onViewNumbering(row.id, row.label);
        });
        name.append(view);
      }
      tr.append(name);

      for (const metric of metrics) {
        const td = document.createElement('td');
        const value = row.values[metric.key];
        td.textContent = formatValue(value, metric.format);
        if (value == null) td.className = 'is-missing';
        else if (best.get(metric.key) === value) td.className = 'is-best';
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  _footnote() {
    const context = this.setup.context;
    const note = document.createElement('p');
    note.className = 'eval-footnote';
    const settings = this.settings();
    note.innerHTML =
      `Buffer ${context.radius_m} m, neighbours measured ${context.neighbour_mode === 'geometry'
        ? 'between road geometries' : 'between road midpoints'}, ` +
      `${settings.permutations || 'no'} permutations. ` +
      `Bandwidth, profile, inference error and Hilbert stretch are computed on the ` +
      `rank-normalised numbering so schemes using different number ranges stay comparable. ` +
      `Click a column heading to sort; hover it for the definition and source.` +
      (context.ground_truth_available
        ? ` ARI is measured over the ${context.named_segments} of ` +
          `${context.segments} segments that carry a street name ` +
          `(${context.distinct_street_names} distinct), so treat it as indicative ` +
          `rather than conclusive until the network is re-extracted from OSM with ` +
          `full naming.`
        : ` ARI against real streets is unavailable here: this network has ` +
          `${context.distinct_street_names} distinct street name(s) across ` +
          `${context.named_segments} named segments.`);
    return note;
  }

  exportCsv() {
    const metrics = this.setup.metrics;
    const header = ['numbering', 'kind', ...metrics.map((m) => m.key)];
    const lines = [header.join(',')];
    for (const row of this.results.values()) {
      lines.push([
        csvCell(row.label), row.kind,
        ...metrics.map((m) => row.values[m.key] ?? ''),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `evaluation_${this.datasetId.replace(/\//g, '-')}.csv`;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 60000);
    this.logger?.log('evaluation:export', { dataset: this.datasetId });
  }
}

// --------------------------------------------------------------- helpers --

function formatValue(value, format) {
  if (value == null) return '—';
  switch (format) {
    case 'int': return Math.round(value).toLocaleString();
    case 'pct': return `${(value * 100).toFixed(1)}%`;
    case 'p': return value <= 0.001 ? '≤0.001' : value.toFixed(3);
    case 'metres': return value >= 1000 ? `${(value / 1000).toFixed(2)} km`
                                        : `${Math.round(value)} m`;
    case 'signed1': return fmtSigned(value, 1);
    case 'signed3': return fmtSigned(value, 3);
    case 'num2': return value.toFixed(2);
    case 'num3': return value.toFixed(3);
    default: return String(value);
  }
}

function fmtSigned(value, places) {
  if (value == null || Number.isNaN(value)) return '—';
  return (value >= 0 ? '+' : '') + value.toFixed(places);
}

/** Spearman rank correlation with midranks, mirroring the server-side version. */
function spearman(a, b) {
  if (a.length < 3) return NaN;
  const rank = (values) => {
    const order = values.map((v, i) => i).sort((i, j) => values[i] - values[j]);
    const out = new Array(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
      const mid = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]] = mid;
      i = j + 1;
    }
    return out;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
