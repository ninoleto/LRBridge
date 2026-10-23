import { BridgeError } from './http.js';

export const OWNER_FIELDS = ['serverEpoch', 'activeModule', 'selectedPhotoUuid', 'contextCounter', 'contextChangedAt'];
export const CONTEXT_FIELDS = [...OWNER_FIELDS, 'developCounter'];
export const equalContext = (a, b, revision = true) => !!a && !!b &&
  (revision ? CONTEXT_FIELDS : OWNER_FIELDS).every(key => a[key] === b[key]);
export const owner = (epoch, ctx) => Object.fromEntries(CONTEXT_FIELDS.map(k => [k, k === 'serverEpoch' ? epoch : ctx?.[k]]));
export const finite = n => typeof n === 'number' && Number.isFinite(n);
export const validRange = r => r && finite(r.min) && finite(r.max) && r.min < r.max;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const identity = s => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(s);
export const pause = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new BridgeError('cancelled', 'Operation cancelled.')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});

export class BridgeClient {
  constructor(http, { readTimeoutMs = 8000, pollMs = 150, heartbeatMaxAgeMs = 5000 } = {}) {
    this.http = http;
    this.readTimeoutMs = readTimeoutMs;
    this.pollMs = pollMs;
    this.heartbeatMaxAgeMs = heartbeatMaxAgeMs;
  }
  async context(signal) {
    const caps = await this.http.get('/set/capabilities', { signal });
    const c = caps.context;
    if (caps.supported !== true || caps.version !== 1 || !identity(caps.serverEpoch) || !c ||
        !integer(c.contextCounter) || !integer(c.developCounter) || typeof c.activeModule !== 'string') {
      throw new BridgeError('incompatible_bridge', 'Expected LRBridge RC1 guarded protocol version 1.');
    }
    const age = finite(c.lastHeartbeatAt) ? Date.now() - c.lastHeartbeatAt : null;
    const lightroom = age === null || age < -1000 || age > this.heartbeatMaxAgeMs ? 'heartbeat_stale' :
      c.activeModule !== 'develop' ? 'not_in_develop' : !identity(c.selectedPhotoUuid) ? 'no_photo' : 'ready';
    return { context: owner(caps.serverEpoch, c), photo: {
      uuid: c.selectedPhotoUuid ?? null, key: c.selectedPhotoKey ?? null, path: c.selectedPhotoPath ?? null
    }, lightroom, heartbeatAgeMs: age, lastHeartbeatAt: c.lastHeartbeatAt ?? null, caps };
  }
  requireReady(state) {
    if (state.lightroom !== 'ready' || !integer(state.context.contextChangedAt)) {
      throw new BridgeError(state.lightroom, 'A recent Lightroom heartbeat, selected photo UUID and Develop module are required.');
    }
  }
  async checkContext(expected, signal, revision = true) {
    const state = await this.context(signal);
    this.requireReady(state);
    if (!equalContext(expected, state.context, revision) || state.context.developCounter < expected.developCounter) {
      throw new BridgeError('context_changed', 'Photo, module, server epoch or Develop revision changed. Read again; do not rebase an uncertain write.');
    }
    return state;
  }
  async metadata(signal) {
    const data = await this.http.get('/sliders', { signal });
    if (!Array.isArray(data.sliders) || data.sliders.length > 512) throw new BridgeError('invalid_metadata', 'Invalid slider registry.');
    const ids = new Set();
    for (const d of data.sliders) {
      if (!d || typeof d.id !== 'string' || ids.has(d.id) || !validRange(d) ||
          !finite(d.numericStep) || d.numericStep <= 0 || !integer(d.displayPrecision) || d.displayPrecision > 10) {
        throw new BridgeError('invalid_metadata', 'Slider metadata is incomplete or inconsistent.');
      }
      ids.add(d.id);
    }
    return data.sliders;
  }
  async capabilities(context, signal) {
    const entries = await Promise.all(['set', 'nudge', 'reset'].map(async family => {
      const caps = await this.http.get(`/${family}/capabilities`, { signal });
      const c = { ...caps.context, activeModule: caps.context?.activeModule ?? context.activeModule };
      if (caps.version !== 1 || caps.supported !== true || caps.method !== 'POST' || caps.endpoint !== `/${family}` ||
          !Array.isArray(caps.sliders) || !equalContext(context, owner(caps.serverEpoch, c))) {
        throw new BridgeError('capabilities_changed', 'Capabilities do not belong to the current RC1 photo/context.');
      }
      return [family, caps];
    }));
    return Object.fromEntries(entries);
  }
  async readValues(ids, { expected, metadata, signal, followDispatchRevision = false } = {}) {
    const initial = expected ? await this.checkContext(expected, signal, !followDispatchRevision) : await this.context(signal);
    this.requireReady(initial);
    const context = initial.context;
    const registry = metadata || await this.metadata(signal);
    const requested = ids || registry.map(d => d.id);
    if (new Set(requested).size !== requested.length) throw new BridgeError('duplicate_slider', 'Request each slider only once.');
    const definitions = requested.map(id => {
      const d = registry.find(item => item.id === id);
      if (!d) throw new BridgeError('unsupported_slider', `Unknown slider ID: ${id}`);
      return d;
    });
    const readable = definitions.filter(d => d.feedbackSupported === true).map(d => d.id);
    const values = {};
    definitions.filter(d => d.feedbackSupported !== true).forEach(d => { values[d.id] = { status: 'unsupported_feedback', available: null }; });
    if (!readable.length) return { context, values, authority: 'none' };
    const start = await this.http.get('/feedback/request-many?' + new URLSearchParams({ sliders: readable.join(','), purpose: 'edit' }), { signal });
    const id = start.request?.id;
    if (!integer(id) || id === 0 || !Array.isArray(start.sliders) ||
        readable.length !== start.sliders.length || readable.some(s => !start.sliders.includes(s))) {
      throw new BridgeError('invalid_feedback', 'LRBridge did not admit the requested feedback set.');
    }
    const deadline = Date.now() + this.readTimeoutMs;
    let snapshot, dispatchContext;
    while (Date.now() < deadline) {
      const data = await this.http.get(`/feedback/snapshot?id=${id}&wait=1`, { signal,
        timeoutMs: Math.min(this.http.timeoutMs, Math.max(1, deadline - Date.now())) });
      snapshot = data.snapshot;
      if (!snapshot || snapshot.id !== id || !Array.isArray(snapshot.requestedSliders) ||
          snapshot.requestedSliders.length !== readable.length || readable.some(s => !snapshot.requestedSliders.includes(s))) {
        throw new BridgeError('invalid_feedback', 'Feedback snapshot identity mismatch.');
      }
      if (snapshot.context) {
        const binding = owner(context.serverEpoch, snapshot.context);
        // RC1 purpose=edit binds an empty queued request at SDK dispatch. The
        // caller may follow a newer revision only for confirmation or a later
        // batch read whose original baseline is separately preserved/compared.
        // The owner never changes. Once seen, the dispatch binding is immutable
        // even while results are partial. Initial admission reads remain exact.
        const requireExactRevision = dispatchContext !== undefined || !followDispatchRevision;
        if (!equalContext(dispatchContext || context, binding, requireExactRevision) ||
            !integer(binding.developCounter) || binding.developCounter < context.developCounter) {
          throw new BridgeError('stale_feedback', 'Feedback belongs to a different photo or Develop revision.', {
            snapshotId: id, expectedContext: dispatchContext || context, feedbackContext: binding
          });
        }
        dispatchContext = binding;
      } else if (dispatchContext) {
        throw new BridgeError('invalid_feedback', 'Feedback lost its SDK-dispatch context binding.', { snapshotId: id });
      }
      if (snapshot.complete === true) break;
      await pause(Math.min(this.pollMs, Math.max(1, deadline - Date.now())), signal);
    }
    if (!snapshot?.complete) throw new BridgeError('feedback_timeout', 'SDK feedback did not complete. Missing values are unknown, never defaults.');
    if (!snapshot.context || !snapshot.results || !finite(snapshot.completedAt)) {
      throw new BridgeError('invalid_feedback', 'Completed feedback lacks owned context or results.');
    }
    await this.checkContext(dispatchContext, signal);
    for (const id of readable) {
      const value = snapshot.results[id];
      if (!value || value.id !== snapshot.id || value.slider !== id || !finite(value.receivedAt) ||
          typeof value.available !== 'boolean') throw new BridgeError('invalid_feedback', `Missing or mismatched SDK result for ${id}.`);
      if (!value.available) {
        if (value.value !== null || value.range !== null) throw new BridgeError('invalid_feedback', 'Unavailable feedback contains a fabricated value.');
        values[id] = { status: 'unavailable', available: false, source: 'sdk', receivedAt: value.receivedAt };
      } else {
        if (!finite(value.value) || !validRange(value.range) || value.value < value.range.min || value.value > value.range.max) {
          throw new BridgeError('invalid_feedback', `Invalid SDK value/range for ${id}.`);
        }
        values[id] = { status: 'available', available: true, value: value.value, range: value.range,
          source: 'sdk', receivedAt: value.receivedAt };
      }
    }
    return { context: dispatchContext, values, authority: 'request_owned_sdk_snapshot', snapshotId: snapshot.id,
      observedAt: snapshot.completedAt, note: 'An owned SDK observation at this revision; later native edits may change it.' };
  }
}
