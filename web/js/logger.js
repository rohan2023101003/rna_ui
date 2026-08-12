/**
 * Interaction logger - the client half of objective 4.
 *
 * Every meaningful action (dataset load, algorithm switch, pan, zoom, road
 * click, label reveal, answer submitted) is timestamped and batched to
 * /api/events, which appends newline-delimited JSON. High-frequency gestures
 * are coalesced so a single continuous pan or zoom becomes one record with a
 * duration rather than hundreds of frames.
 */

import { api } from './api.js';

const FLUSH_INTERVAL_MS = 4000;
const COALESCE_MS = 700;
const MAX_QUEUE = 200;

export class InteractionLogger {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.sessionId = crypto.randomUUID();
    this.participantId = null;
    this.queue = [];
    this.counts = new Map();
    this.startedAt = performance.now();
    this._pending = new Map();   // coalescing buffer, keyed by event type
    this._timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // A closing tab must not take the tail of the log with it.
    addEventListener('pagehide', () => this.flush(true));
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
  }

  setParticipant(id) {
    this.participantId = id || null;
  }

  /** Record a discrete event. */
  log(type, detail = {}) {
    this.counts.set(type, (this.counts.get(type) || 0) + 1);
    if (!this.enabled) return;
    this.queue.push({
      type,
      detail,
      t_ms: Math.round(performance.now() - this.startedAt),
      client_time: new Date().toISOString(),
    });
    if (this.queue.length >= MAX_QUEUE) this.flush();
  }

  /**
   * Record a gesture that fires continuously. Repeated calls within
   * COALESCE_MS collapse into one event carrying a count and duration.
   */
  logGesture(type, detail = {}) {
    this.counts.set(type, (this.counts.get(type) || 0) + 1);
    if (!this.enabled) return;
    const now = performance.now();
    const open = this._pending.get(type);
    if (open && now - open.last < COALESCE_MS) {
      open.last = now;
      open.frames += 1;
      open.detail = detail;
      clearTimeout(open.timer);
      open.timer = setTimeout(() => this._closeGesture(type), COALESCE_MS);
      return;
    }
    if (open) this._closeGesture(type);
    const record = { start: now, last: now, frames: 1, detail };
    record.timer = setTimeout(() => this._closeGesture(type), COALESCE_MS);
    this._pending.set(type, record);
  }

  _closeGesture(type) {
    const open = this._pending.get(type);
    if (!open) return;
    clearTimeout(open.timer);
    this._pending.delete(type);
    this.queue.push({
      type,
      detail: { ...open.detail, frames: open.frames,
                duration_ms: Math.round(open.last - open.start) },
      t_ms: Math.round(open.start - this.startedAt),
      client_time: new Date(Date.now() - (performance.now() - open.start)).toISOString(),
    });
  }

  /** Counts by event type - shown live in the UI so the logging is visible. */
  summary() {
    return Object.fromEntries([...this.counts.entries()].sort((a, b) => b[1] - a[1]));
  }

  async flush(immediate = false) {
    for (const type of [...this._pending.keys()]) this._closeGesture(type);
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    const payload = {
      session_id: this.sessionId,
      participant_id: this.participantId,
      events: batch,
    };
    try {
      if (immediate && navigator.sendBeacon) {
        navigator.sendBeacon('/api/events',
          new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      } else {
        await api.events(payload);
      }
    } catch {
      // Logging must never break the experiment; keep the batch for a retry.
      this.queue = batch.concat(this.queue).slice(-MAX_QUEUE * 2);
    }
  }
}
