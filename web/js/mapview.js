/**
 * MapView - a dependency-free SVG renderer for road networks.
 *
 * Geometry arrives as WGS84 GeoJSON, is projected to Web Mercator and then
 * rescaled into a local coordinate space so SVG path data keeps sub-metre
 * precision at every zoom level. Pan and zoom are applied as a transform on a
 * single group, so the browser does the heavy lifting; road numbers live in a
 * separate screen-space layer so they stay upright and constant-size, and get
 * laid out with collision avoidance on each frame.
 *
 * Everything the human-evaluation tasks will need is exposed as a method:
 * per-road styling (`setRoadStyle`), label overrides (`setLabel`), hiding
 * labels (`setHiddenLabels`), and `on('road:click' | 'view:change' | ...)`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCAL_SPAN = 1000;           // local units across the wider bbox axis
const MIN_SCALE = 0.05;
const MAX_SCALE = 6000;
/** Wheel events closer together than this are one scroll gesture. */
const GESTURE_GAP_MS = 300;

/** Web Mercator, normalised to the unit square. */
function mercator(lon, lat) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return [
    (lon + 180) / 360,
    0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
  ];
}

function mercatorInverse(x, y) {
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lon, lat];
}

export class MapView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = Object.assign({
      roadColor: '#111111',
      roadWidth: 2.0,
      showNodes: false,
      showLabels: true,
      labelDensity: 1.0,
      maxLabels: 600,
    }, options);

    this.roads = [];                 // {id, coords, mid, length, props, el, hit}
    this.roadsById = new Map();
    this.nodes = [];
    this.view = { k: 1, tx: 0, ty: 0 };
    this.size = { w: 1, h: 1 };
    this.origin = { x: 0, y: 0, scale: 1 };

    this.labels = new Map();         // roadId -> string
    this.hiddenLabels = new Set();
    this.pinnedLabels = new Set();   // always drawn, never dropped for space
    this.labelStyles = new Map();    // roadId -> {className}
    this.selectedId = null;
    this.hoverId = null;
    this.highlighted = new Set();

    this._listeners = new Map();
    this._frame = null;
    this._labelPool = [];

    this._buildDom();
    this._bindEvents();
  }

  // ---------------------------------------------------------------- DOM ---

  _buildDom() {
    this.container.classList.add('mapview');
    this.container.innerHTML = '';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'mapview-svg');
    svg.setAttribute('xmlns', SVG_NS);

    // Ordering matters: hit targets sit under the visible strokes so the
    // rendered network stays crisp, and the label layer sits above both.
    this.gViewport = document.createElementNS(SVG_NS, 'g');
    this.gHit = this._group('layer-hit');
    this.gRoads = this._group('layer-roads');
    this.gNodes = this._group('layer-nodes');
    this.gOverlay = this._group('layer-overlay');
    this.gViewport.append(this.gHit, this.gRoads, this.gNodes, this.gOverlay);

    this.gLabels = this._group('layer-labels');   // screen space, untransformed

    svg.append(this.gViewport, this.gLabels);
    this.container.append(svg);
    this.svg = svg;

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'map-tooltip';
    this.tooltip.hidden = true;
    this.container.append(this.tooltip);

    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'map-zoombox';
    this.selectionBox.hidden = true;
    this.container.append(this.selectionBox);

    this._resizeObserver = new ResizeObserver(() => this._measure());
    this._resizeObserver.observe(this.container);
    this._measure();
  }

  _group(className) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', className);
    return g;
  }

  _measure() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const changed = w !== this.size.w || h !== this.size.h;
    // A map built inside a hidden container measures 1x1, so any fit computed
    // then is meaningless. Fit once, the first time it gains a real size.
    //
    // Only once: a container that is hidden and shown again (as the study does
    // between tasks) goes 1x1 and back each time, and re-fitting on every
    // reappearance would throw away whatever view the current task had set.
    const gainedRealSize = !this._hasRealSize && w > 1 && h > 1;
    if (w > 1 && h > 1) this._hasRealSize = true;
    this.size = { w, h };
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    if (!changed) return;
    if (gainedRealSize && this.roads.length) this.fit();
    else this.requestRender();
  }

  // --------------------------------------------------------------- data ---

  /** Replace the rendered network. `geojson` is the payload from /api/datasets. */
  setNetwork(payload) {
    const features = payload?.roads?.features || [];
    const bbox = payload?.bbox;

    // Anchor the local coordinate space on the data's own bounding box.
    if (bbox) {
      const [minX, minY] = mercator(bbox[0], bbox[3]);   // top-left
      const [maxX, maxY] = mercator(bbox[2], bbox[1]);   // bottom-right
      const span = Math.max(maxX - minX, maxY - minY) || 1e-9;
      this.origin = { x: minX, y: minY, scale: LOCAL_SPAN / span };
    }

    this.roads = [];
    this.roadsById.clear();
    this.labels.clear();
    this.hiddenLabels.clear();
    this.pinnedLabels.clear();
    this.labelStyles.clear();
    this.highlighted.clear();
    this.selectedId = null;
    this.hoverId = null;

    const roadFrag = document.createDocumentFragment();
    const hitFrag = document.createDocumentFragment();

    for (const feature of features) {
      const coords = (feature.geometry?.coordinates || []).map(([lon, lat]) =>
        this._toLocal(lon, lat));
      if (coords.length < 2) continue;

      const d = coords.map(([x, y], i) =>
        `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');

      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', d);
      el.setAttribute('class', 'road');

      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'road-hit');

      const id = String(feature.properties.road_id ?? feature.id);
      hit.dataset.roadId = id;
      el.dataset.roadId = id;

      const road = {
        id,
        coords,
        mid: midpointOf(coords),
        props: feature.properties,
        el,
        hit,
      };
      this.roads.push(road);
      this.roadsById.set(id, road);
      roadFrag.append(el);
      hitFrag.append(hit);
    }

    this.gRoads.replaceChildren(roadFrag);
    this.gHit.replaceChildren(hitFrag);
    this._buildNodes(payload?.nodes);
    this.gOverlay.replaceChildren();

    if (this.size.w > 1 && this.size.h > 1) this._hasRealSize = true;
    this.fit({ animate: false });
    this.emit('network:load', { roads: this.roads.length });
  }

  _buildNodes(nodeCollection) {
    this.nodes = [];
    const frag = document.createDocumentFragment();
    for (const feature of nodeCollection?.features || []) {
      const [lon, lat] = feature.geometry.coordinates;
      const [x, y] = this._toLocal(lon, lat);
      const el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', x.toFixed(2));
      el.setAttribute('cy', y.toFixed(2));
      el.setAttribute('r', 2.4);
      el.setAttribute('class', 'node');
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      frag.append(el);
      this.nodes.push({ id: feature.id, el });
    }
    this.gNodes.replaceChildren(frag);
    this.gNodes.style.display = this.options.showNodes ? 'inline' : 'none';
  }

  _toLocal(lon, lat) {
    const [mx, my] = mercator(lon, lat);
    return [(mx - this.origin.x) * this.origin.scale,
            (my - this.origin.y) * this.origin.scale];
  }

  _toLonLat(x, y) {
    return mercatorInverse(x / this.origin.scale + this.origin.x,
                           y / this.origin.scale + this.origin.y);
  }

  // -------------------------------------------------------------- styling --

  setOption(key, value) {
    this.options[key] = value;
    if (key === 'showNodes') this.gNodes.style.display = value ? 'inline' : 'none';
    this.requestRender();
  }

  /**
   * Apply a colour, a width or a state class to one road.
   *
   * Every property is checked with `in` rather than for truthiness, so each one
   * is left alone unless the caller mentions it, and passing `null` (or `''`
   * for the class) is how a caller clears it. Both matter: `''` is falsy, and a
   * caller that changes only the state class must not silently drop a colour
   * some other layer of the interface put there.
   */
  setRoadStyle(roadId, style = {}) {
    const road = this.roadsById.get(String(roadId));
    if (!road) return;
    if ('color' in style) {
      if (style.color == null) road.el.style.removeProperty('stroke');
      else road.el.style.stroke = style.color;
    }
    if ('width' in style) {
      if (style.width == null) road.el.style.removeProperty('stroke-width');
      else road.el.style.strokeWidth = `${style.width}px`;
    }
    if ('className' in style) {
      road.el.setAttribute('class', style.className ? `road ${style.className}` : 'road');
    }
  }

  /** Recolour every road at once from a `road -> colour|null` function. */
  colorBy(fn) {
    for (const road of this.roads) {
      const color = fn ? fn(road) : null;
      if (color) road.el.style.stroke = color;
      else road.el.style.removeProperty('stroke');
    }
  }

  /** Set the text shown on a road. `null` removes it. */
  setLabel(roadId, text) {
    const id = String(roadId);
    if (text === null || text === undefined || text === '') this.labels.delete(id);
    else this.labels.set(id, String(text));
    this.requestRender();
  }

  setLabels(map) {
    this.labels = new Map(Object.entries(map).map(([k, v]) => [String(k), String(v)]));
    this.requestRender();
  }

  /** Roads whose label should be withheld - the basis of the guessing task. */
  setHiddenLabels(ids) {
    this.hiddenLabels = new Set((ids || []).map(String));
    this.requestRender();
  }

  /**
   * Labels that must always appear, however crowded the map is.
   *
   * Ordinary labels are dropped when they would overlap, which is fine for
   * background detail but not for the one road a task is asking about.
   */
  setPinnedLabels(ids) {
    this.pinnedLabels = new Set((ids || []).map(String));
    this.requestRender();
  }

  setLabelStyle(roadId, className) {
    const id = String(roadId);
    if (className) this.labelStyles.set(id, className);
    else this.labelStyles.delete(id);
    this.requestRender();
  }

  clearLabelStyles() {
    this.labelStyles.clear();
    this.requestRender();
  }

  select(roadId, { pan = false } = {}) {
    const id = roadId === null ? null : String(roadId);
    if (this.selectedId) this.roadsById.get(this.selectedId)?.el.classList.remove('is-selected');
    this.selectedId = id && this.roadsById.has(id) ? id : null;
    if (this.selectedId) {
      const road = this.roadsById.get(this.selectedId);
      road.el.classList.add('is-selected');
      // Keep the selected road on top of its neighbours.
      this.gRoads.append(road.el);
      if (pan) this.centerOn(road);
    }
    this.requestRender();
    this.emit('road:select', { roadId: this.selectedId });
  }

  /** Secondary emphasis, e.g. every segment sharing a road number. */
  setHighlighted(ids) {
    for (const id of this.highlighted) {
      this.roadsById.get(id)?.el.classList.remove('is-highlighted');
    }
    this.highlighted = new Set((ids || []).map(String));
    for (const id of this.highlighted) {
      this.roadsById.get(id)?.el.classList.add('is-highlighted');
    }
    this.requestRender();
  }

  // ------------------------------------------------------------ viewport --

  /**
   * Refresh the cached size straight away.
   *
   * ResizeObserver fires a frame late, so a container that has just been shown
   * still reports the size it had while hidden. Any method that computes a
   * transform must therefore measure synchronously first, or it will centre the
   * map using a 1x1 viewport.
   */
  _ensureSized() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;
    if (rect.width === this.size.w && rect.height === this.size.h) return;
    this.size = { w: rect.width, h: rect.height };
    this.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    this.svg.setAttribute('width', rect.width);
    this.svg.setAttribute('height', rect.height);
    this._hasRealSize = true;
  }

  localBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const road of this.roads) {
      for (const [x, y] of road.coords) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: LOCAL_SPAN, maxY: LOCAL_SPAN };
    return { minX, minY, maxX, maxY };
  }

  fit({ padding = 48 } = {}) {
    this._ensureSized();
    const b = this.localBounds();
    const w = Math.max(1e-6, b.maxX - b.minX);
    const h = Math.max(1e-6, b.maxY - b.minY);
    const k = Math.min((this.size.w - padding * 2) / w, (this.size.h - padding * 2) / h);
    this.view.k = clamp(k, MIN_SCALE, MAX_SCALE);
    this.view.tx = this.size.w / 2 - ((b.minX + b.maxX) / 2) * this.view.k;
    this.view.ty = this.size.h / 2 - ((b.minY + b.maxY) / 2) * this.view.k;
    this.requestRender();
    this.emit('view:change', { ...this.view, reason: 'fit' });
  }

  centerOn(road) {
    const [x, y] = road.mid;
    this.view.tx = this.size.w / 2 - x * this.view.k;
    this.view.ty = this.size.h / 2 - y * this.view.k;
    this.requestRender();
    this.emit('view:change', { ...this.view, reason: 'center' });
  }

  /** Zoom to a road and select it - used by "find road number N". */
  zoomToRoad(roadId, { scale = null } = {}) {
    this._ensureSized();
    const road = this.roadsById.get(String(roadId));
    if (!road) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of road.coords) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pad = 140;
    const w = Math.max(1e-3, maxX - minX);
    const h = Math.max(1e-3, maxY - minY);

    // Filling the screen with one segment strands the participant with no
    // surrounding numbers to reason from, so leave the road at roughly half
    // the viewport and never zoom past ~150 m of visible ground.
    const fitted = Math.min((this.size.w - pad) / w, (this.size.h - pad) / h);
    const cap = (this.size.w * this._metresPerLocalUnit()) / 150;
    const target = scale ?? Math.min(fitted * 0.55, cap);
    this.view.k = clamp(target, MIN_SCALE, MAX_SCALE);
    this.view.tx = this.size.w / 2 - ((minX + maxX) / 2) * this.view.k;
    this.view.ty = this.size.h / 2 - ((minY + maxY) / 2) * this.view.k;
    this.requestRender();
    this.emit('view:change', { ...this.view, reason: 'zoom-to-road' });
    return true;
  }

  /**
   * Frame a set of roads together.
   *
   * Used by the navigation task to keep the road you are on and every road you
   * could step onto on screen at a readable size, instead of zooming to one
   * road and leaving the options off the edge.
   */
  zoomToRoads(roadIds, { padding = 110, maxScale = null } = {}) {
    this._ensureSized();
    const roads = (roadIds || []).map((id) => this.roadsById.get(String(id))).filter(Boolean);
    if (!roads.length) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const road of roads) {
      for (const [x, y] of road.coords) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const w = Math.max(1e-3, maxX - minX);
    const h = Math.max(1e-3, maxY - minY);
    const fitted = Math.min((this.size.w - padding) / w, (this.size.h - padding) / h);
    this.view.k = clamp(maxScale ? Math.min(fitted, maxScale) : fitted, MIN_SCALE, MAX_SCALE);
    this.view.tx = this.size.w / 2 - ((minX + maxX) / 2) * this.view.k;
    this.view.ty = this.size.h / 2 - ((minY + maxY) / 2) * this.view.k;
    this.requestRender();
    this.emit('view:change', { ...this.view, reason: 'zoom-to-roads' });
    return true;
  }

  /**
   * Zoom about a point.
   *
   * `gesture` says what the zoom came from, which is what separates one user
   * action from the stream of events it produces: a wheel scroll fires five to
   * thirty `wheel` events, a button press fires one. Counting the events would
   * measure the input device, not the person, so wheel zooms are coalesced into
   * one `gesture:zoom` per burst while discrete zooms emit one each.
   */
  zoomBy(factor, cx = this.size.w / 2, cy = this.size.h / 2, { gesture = 'step' } = {}) {
    const next = clamp(this.view.k * factor, MIN_SCALE, MAX_SCALE);
    const applied = next / this.view.k;
    this.view.tx = cx - (cx - this.view.tx) * applied;
    this.view.ty = cy - (cy - this.view.ty) * applied;
    this.view.k = next;
    this.requestRender();
    this.emit('view:change', { ...this.view, reason: 'zoom' });
    this._noteZoomGesture(gesture);
  }

  /** One `gesture:zoom` per wheel burst, or one per discrete zoom. */
  _noteZoomGesture(kind) {
    if (kind !== 'wheel') {
      this.emit('gesture:zoom', { kind, scale: this.view.k });
      return;
    }
    if (!this._wheelBurst) {
      this.emit('gesture:zoom', { kind, scale: this.view.k });
    }
    clearTimeout(this._wheelBurst);
    this._wheelBurst = setTimeout(() => { this._wheelBurst = null; }, GESTURE_GAP_MS);
  }

  panBy(dx, dy) {
    this.view.tx += dx;
    this.view.ty += dy;
    this.requestRender();
    this.emit('view:change', { ...this.view, reason: 'pan' });
  }

  /** Ground metres spanned by one local coordinate unit (zoom-independent). */
  _metresPerLocalUnit() {
    const [lon1, lat1] = this._toLonLat(0, 0);
    const [lon2] = this._toLonLat(1, 0);
    return Math.abs(lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  }

  /** Metres per screen pixel at the current view - drives the scale bar. */
  metresPerPixel() {
    return this._metresPerLocalUnit() / this.view.k;
  }

  screenToLonLat(sx, sy) {
    return this._toLonLat((sx - this.view.tx) / this.view.k,
                          (sy - this.view.ty) / this.view.k);
  }

  // -------------------------------------------------------------- events --

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  emit(event, detail) {
    for (const handler of this._listeners.get(event) || []) {
      try { handler(detail); } catch (err) { console.error(err); }
    }
  }

  _bindEvents() {
    const svg = this.svg;
    let dragging = null;
    let boxZoom = null;
    let moved = 0;
    let panCounted = false;

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      // Pointer capture keeps a pan alive when the cursor leaves the SVG, but
      // it also retargets the following `click` to the capturing element - so
      // remember which road was under the cursor before capture is taken.
      this._downRoadId = event.target?.dataset?.roadId || null;
      svg.setPointerCapture(event.pointerId);
      moved = 0;
      panCounted = false;
      const point = this._localPoint(event);
      if (event.shiftKey) {
        boxZoom = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
        this.selectionBox.hidden = false;
      } else {
        dragging = { x: event.clientX, y: event.clientY };
        this.container.classList.add('is-panning');
      }
    });

    svg.addEventListener('pointermove', (event) => {
      const point = this._localPoint(event);
      if (boxZoom) {
        boxZoom.x1 = point.x;
        boxZoom.y1 = point.y;
        this._drawZoomBox(boxZoom);
        return;
      }
      if (dragging) {
        const dx = event.clientX - dragging.x;
        const dy = event.clientY - dragging.y;
        moved += Math.abs(dx) + Math.abs(dy);
        dragging = { x: event.clientX, y: event.clientY };
        // One drag is one gesture, however many move events it produces.
        if (moved > 4 && !panCounted) {
          panCounted = true;
          this.emit('gesture:pan', { kind: 'drag' });
        }
        this.panBy(dx, dy);
        return;
      }
      this._updateHover(event);
      this.emit('pointer:move', {
        lonlat: this.screenToLonLat(point.x, point.y),
        screen: [point.x, point.y],
      });
    });

    const endDrag = (event) => {
      if (boxZoom) {
        this._applyZoomBox(boxZoom);
        boxZoom = null;
        this.selectionBox.hidden = true;
        this.emit('gesture:zoom', { kind: 'box', scale: this.view.k });
      }
      dragging = null;
      this.container.classList.remove('is-panning');
      if (svg.hasPointerCapture?.(event.pointerId)) {
        svg.releasePointerCapture(event.pointerId);
      }
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('pointerleave', () => {
      this._setHover(null);
      this.tooltip.hidden = true;
    });

    svg.addEventListener('click', (event) => {
      if (moved > 4) return;                    // that was a pan, not a click
      const roadId = this._downRoadId || event.target?.dataset?.roadId;
      if (roadId) {
        this.select(roadId);
        this.emit('road:click', { roadId, originalEvent: event });
      } else {
        this.select(null);
        this.emit('map:click', { originalEvent: event });
      }
    });

    svg.addEventListener('dblclick', (event) => {
      const point = this._localPoint(event);
      this.zoomBy(event.altKey ? 1 / 1.8 : 1.8, point.x, point.y,
                  { gesture: 'double-click' });
    });

    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = this._localPoint(event);
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002));
      this.zoomBy(factor, point.x, point.y, { gesture: 'wheel' });
    }, { passive: false });

    this.container.tabIndex = 0;
    this.container.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 200 : 60;
      const key = (dx, dy) => () => {
        this.panBy(dx, dy);
        this.emit('gesture:pan', { kind: 'key' });
      };
      const zoom = (factor) => () => this.zoomBy(factor, undefined, undefined,
                                                 { gesture: 'key' });
      const actions = {
        '+': zoom(1.35), '=': zoom(1.35),
        '-': zoom(1 / 1.35), '_': zoom(1 / 1.35),
        ArrowLeft: key(step, 0), ArrowRight: key(-step, 0),
        ArrowUp: key(0, step), ArrowDown: key(0, -step),
        f: () => this.fit(), F: () => this.fit(),
        Escape: () => this.select(null),
      };
      const action = actions[event.key];
      if (action) { event.preventDefault(); action(); }
    });
  }

  _localPoint(event) {
    const rect = this.svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  _updateHover(event) {
    const roadId = event.target?.dataset?.roadId || null;
    this._setHover(roadId);
    if (roadId) {
      const road = this.roadsById.get(roadId);
      const point = this._localPoint(event);
      const html = this.options.tooltipHtml
        ? this.options.tooltipHtml(road)
        : `<strong>Road ${road.id}</strong>`;
      // A tooltip builder returning nothing suppresses the tooltip entirely -
      // the evaluation study needs this so hovering cannot reveal an answer.
      if (!html) { this.tooltip.hidden = true; return; }
      this.tooltip.hidden = false;
      this.tooltip.innerHTML = html;
      const flipX = point.x > this.size.w - 240;
      this.tooltip.style.left = `${point.x + (flipX ? -14 : 14)}px`;
      this.tooltip.style.top = `${point.y + 14}px`;
      this.tooltip.style.transform = flipX ? 'translateX(-100%)' : '';
    } else {
      this.tooltip.hidden = true;
    }
  }

  _setHover(roadId) {
    if (this.hoverId === roadId) return;
    if (this.hoverId) this.roadsById.get(this.hoverId)?.el.classList.remove('is-hover');
    this.hoverId = roadId;
    if (roadId) this.roadsById.get(roadId)?.el.classList.add('is-hover');
    this.emit('road:hover', { roadId });
  }

  _drawZoomBox(box) {
    const left = Math.min(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    Object.assign(this.selectionBox.style, {
      left: `${left}px`, top: `${top}px`,
      width: `${Math.abs(box.x1 - box.x0)}px`,
      height: `${Math.abs(box.y1 - box.y0)}px`,
    });
  }

  _applyZoomBox(box) {
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    if (w < 12 || h < 12) return;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const factor = Math.min(this.size.w / w, this.size.h / h);
    this.zoomBy(factor, cx, cy);
  }

  // ------------------------------------------------------------ rendering --

  requestRender() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.render();
    });
  }

  render() {
    const { k, tx, ty } = this.view;
    this.gViewport.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})`);

    // Roads thicken gently as you zoom in, but never past a legible cap.
    const width = clamp(this.options.roadWidth * (0.7 + 0.35 * Math.log10(k + 1)),
                        0.6, this.options.roadWidth * 3.2);
    this.gRoads.style.strokeWidth = `${width}px`;

    // Node radius is expressed in the viewport's user units, which the group
    // transform then scales - divide by k so intersections stay a constant
    // size on screen instead of vanishing when zoomed out.
    const nodePx = clamp(width * 1.5, 2.6, 6);
    this.gNodes.style.setProperty('--node-r', `${nodePx / k}px`);

    this._renderLabels();
  }

  /**
   * Lay out road-number labels in screen space with greedy collision
   * avoidance: longest roads win, anything that would overlap is dropped. The
   * effect is that labels thin out when zoomed out and fill in as you zoom.
   */
  _renderLabels() {
    const wanted = [];
    if (this.options.showLabels && this.labels.size) {
      const { k, tx, ty } = this.view;
      const margin = 60;
      for (const road of this.roads) {
        const id = road.id;
        const text = this.hiddenLabels.has(id) ? '?' : this.labels.get(id);
        if (text === undefined) continue;
        const sx = road.mid[0] * k + tx;
        const sy = road.mid[1] * k + ty;
        if (!this.pinnedLabels.has(id)
            && (sx < -margin || sy < -margin
                || sx > this.size.w + margin || sy > this.size.h + margin)) continue;
        wanted.push({ id, text, sx, sy, road });
      }
      // Priority: selected road, then highlighted, then hidden-label prompts,
      // then longest roads first so the network's spine stays labelled.
      wanted.sort((a, b) => score(b, this) - score(a, this));
    }

    const budget = Math.min(this.options.maxLabels,
                            Math.round(this.options.maxLabels * this.options.labelDensity));
    const grid = new CollisionGrid(28);
    const placed = [];
    // Street names repeat across every segment of one road; drawing them all
    // is pure noise, so the same text is only redrawn once it is far away.
    const lastSeen = this.options.dedupeLabels ? new Map() : null;
    const repeatDistance = 260;

    for (const candidate of wanted) {
      if (placed.length >= budget) break;
      const w = 11 + candidate.text.length * 6.6;
      const h = 16;
      const box = [candidate.sx - w / 2, candidate.sy - h / 2, w, h];
      const forced = candidate.id === this.selectedId
        || this.hiddenLabels.has(candidate.id)
        || this.pinnedLabels.has(candidate.id);

      if (!forced && lastSeen) {
        const previous = lastSeen.get(candidate.text);
        if (previous && Math.hypot(previous[0] - candidate.sx,
                                   previous[1] - candidate.sy) < repeatDistance) continue;
      }
      if (!forced && grid.hits(box)) continue;

      grid.add(box);
      lastSeen?.set(candidate.text, [candidate.sx, candidate.sy]);
      placed.push({ ...candidate, w, h });
    }

    this._paintLabels(placed);
    this.emit('labels:render', { shown: placed.length, total: this.labels.size });
  }

  _paintLabels(placed) {
    // Reuse DOM nodes across frames; label churn during a pan is the single
    // most expensive thing this renderer does.
    while (this._labelPool.length < placed.length) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'road-label');
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('rx', 4);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      g.append(rect, text);
      this._labelPool.push({ g, rect, text });
      this.gLabels.append(g);
    }

    placed.forEach((item, index) => {
      const slot = this._labelPool[index];
      slot.g.style.display = '';
      slot.g.dataset.roadId = item.id;
      const extra = this.labelStyles.get(item.id);
      const hidden = this.hiddenLabels.has(item.id);
      slot.g.setAttribute('class',
        `road-label${item.id === this.selectedId ? ' is-selected' : ''}` +
        `${hidden ? ' is-blank' : ''}${extra ? ` ${extra}` : ''}`);
      slot.rect.setAttribute('x', (item.sx - item.w / 2).toFixed(1));
      slot.rect.setAttribute('y', (item.sy - item.h / 2).toFixed(1));
      slot.rect.setAttribute('width', item.w.toFixed(1));
      slot.rect.setAttribute('height', item.h);
      slot.text.setAttribute('x', item.sx.toFixed(1));
      slot.text.setAttribute('y', (item.sy + 0.5).toFixed(1));
      slot.text.textContent = item.text;
    });

    for (let i = placed.length; i < this._labelPool.length; i++) {
      this._labelPool[i].g.style.display = 'none';
    }
  }

  /** Serialise the current view to a standalone SVG string. */
  toSVGString() {
    const clone = this.svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = collectMapStyles();
    clone.insertBefore(style, clone.firstChild);
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', getComputedStyle(this.container).backgroundColor || '#fff');
    clone.insertBefore(bg, style.nextSibling);
    return new XMLSerializer().serializeToString(clone);
  }

  destroy() {
    this._resizeObserver.disconnect();
    if (this._frame) cancelAnimationFrame(this._frame);
    this._listeners.clear();
  }
}

// -------------------------------------------------------------- helpers ---

function score(candidate, view) {
  if (view.pinnedLabels.has(candidate.id)) return 1e10;
  if (candidate.id === view.selectedId) return 1e9;
  if (view.hiddenLabels.has(candidate.id)) return 1e8;
  if (view.highlighted.has(candidate.id)) return 1e7;
  return candidate.road.props.length_m || 0;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/** Point halfway along a polyline by arc length, not by vertex count. */
function midpointOf(coords) {
  let total = 0;
  const spans = [];
  for (let i = 1; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    spans.push(d);
    total += d;
  }
  let target = total / 2;
  for (let i = 0; i < spans.length; i++) {
    if (target <= spans[i] || i === spans.length - 1) {
      const t = spans[i] ? target / spans[i] : 0;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ];
    }
    target -= spans[i];
  }
  return coords[0];
}

/** Uniform-grid overlap test - far cheaper than checking every placed box. */
class CollisionGrid {
  constructor(cell) {
    this.cell = cell;
    this.buckets = new Map();
  }

  *_keys(box) {
    const [x, y, w, h] = box;
    const x0 = Math.floor(x / this.cell), x1 = Math.floor((x + w) / this.cell);
    const y0 = Math.floor(y / this.cell), y1 = Math.floor((y + h) / this.cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) yield `${i}:${j}`;
    }
  }

  hits(box) {
    for (const key of this._keys(box)) {
      for (const other of this.buckets.get(key) || []) {
        if (box[0] < other[0] + other[2] && box[0] + box[2] > other[0] &&
            box[1] < other[1] + other[3] && box[1] + box[3] > other[1]) return true;
      }
    }
    return false;
  }

  add(box) {
    for (const key of this._keys(box)) {
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key).push(box);
    }
  }
}

/** Pull the map-related rules out of the page stylesheet for SVG export. */
function collectMapStyles() {
  const wanted = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules || []) {
      const text = rule.cssText || '';
      if (/\.road|\.node|\.layer-|\.mapview|:root/.test(text)) wanted.push(text);
    }
  }
  return wanted.join('\n');
}
