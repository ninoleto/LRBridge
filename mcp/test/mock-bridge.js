import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LRBridgeService } from '../src/service.js';

export const registry = JSON.parse(fs.readFileSync(new URL('../../config/sliders.json', import.meta.url), 'utf8'));
export async function mockBridge(options = {}) {
  const context = { activeModule: 'develop', selectedPhotoUuid: 'photo-1', selectedPhotoKey: 'photo-1', selectedPhotoPath: null,
    contextCounter: 1, contextChangedAt: 100, developCounter: 4, lastHeartbeatAt: Date.now() };
  const mock = { context, epoch: 'epoch-1', requests: [], writes: [], snapshots: new Map(), receipts: new Map(),
    values: Object.fromEntries(registry.map(d => [d.id, { value: Math.max(d.min, Math.min(d.max, 0)), range: { min: d.min, max: d.max } }])),
    options, sequence: 0, photoChange() { context.selectedPhotoUuid = 'photo-2'; context.selectedPhotoKey = 'photo-2'; context.contextCounter++; context.contextChangedAt++; } };
  mock.values.ProfileAmount.value = 100;
  const snapshotContext = () => ({ ...context, lastHeartbeatAt: options.offline ? Date.now() - 10000 : Date.now() });
  const caps = family => ({ supported: true, version: 1, serverEpoch: mock.epoch, endpoint: '/' + family, method: 'POST', context: snapshotContext(),
    ...(family === 'set' ? { sliders: ['Contrast', 'Clarity', 'Vibrance'] } : family === 'reset' ? {
      sliders: registry.filter(d => d.feedbackSupported && d.resetSupported !== false).map(d => d.id)
    } : { maxAdjustments: 64, maxStepCount: 1000, maxTotalSteps: 4096,
      sliders: registry.filter(d => d.feedbackSupported && d.max - d.min > 1).map(d => ({ id: d.id, numericStep: d.numericStep, precision: d.displayPrecision })) }) });
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const chunks = []; for await (const part of req) chunks.push(part);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
      const request = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body };
      mock.requests.push(request);
      if (await options.intercept?.({ ...request, req, res, mock, send })) return;
      const family = url.pathname.split('/')[1];
      if (url.pathname.endsWith('/capabilities')) return send(res, 200, caps(family));
      if (url.pathname === '/sliders') return send(res, 200, { sliders: options.metadata || registry });
      if (url.pathname === '/status' || url.pathname === '/context') return send(res, 200, { ok: true, queueLength: 0, ...snapshotContext() });
      if (url.pathname === '/feedback/request-many') {
        const id = ++mock.sequence, ids = url.searchParams.get('sliders').split(',');
        const snapshot = { id, requestedSliders: ids, results: {}, complete: true, context: snapshotContext(), requestedAt: Date.now(), completedAt: Date.now() };
        for (const slider of ids) {
          const v = mock.values[slider];
          snapshot.results[slider] = { id, slider, available: !!v, value: v?.value ?? null, range: v?.range ?? null, receivedAt: Date.now() };
        }
        await options.onSnapshot?.(snapshot, mock);
        mock.snapshots.set(id, snapshot);
        return send(res, 200, { ok: true, request: { id }, sliders: ids, count: ids.length });
      }
      if (url.pathname === '/feedback/snapshot') {
        const snapshot = mock.snapshots.get(Number(url.searchParams.get('id')));
        return send(res, snapshot ? 200 : 404, { ok: !!snapshot, snapshot });
      }
      if (req.method === 'POST' && ['set', 'reset', 'nudge'].includes(family)) {
        mock.writes.push(request);
        if (options.rejectAdmission) return send(res, 503, { ok: false, error: 'Queue full' });
        const operationId = `${family === 'set' ? 'gs' : family === 'nudge' ? 'nn' : 'rc'}-${++mock.sequence}`;
        const receipt = { serverEpoch: mock.epoch, requestId: body.requestId, operationId, phase: 'queued', result: null };
        mock.receipts.set(body.requestId, { receipt, body, family, admitted: context.developCounter, polls: 0 });
        if (options.dropAdmission) return req.socket.destroy();
        return send(res, 202, { ok: true, receipt, duplicate: false });
      }
      if (url.pathname.endsWith('/result')) {
        const op = mock.receipts.get(url.searchParams.get('requestId'));
        if (!op || url.searchParams.get('serverEpoch') !== mock.epoch) return send(res, 404, { ok: false, receipt: null });
        if (op.receipt.phase !== 'complete' && !options.neverComplete) {
          const b = op.body, v = mock.values[b.slider];
          const result = { serverEpoch: mock.epoch, requestId: b.requestId, operationId: op.receipt.operationId, slider: b.slider,
            selectedPhotoUuid: b.selectedPhotoUuid, contextCounter: b.contextCounter, contextChangedAt: b.contextChangedAt,
            admittedDevelopCounter: op.admitted, executionDevelopCounter: context.developCounter, invoked: true };
          if (op.family === 'set') {
            Object.assign(result, { expectedValue: b.expectedValue, requestedValue: b.value, outcome: 'applied', reason: 'sdk-returned' });
            v.value = b.value;
          } else if (op.family === 'reset') {
            v.value = options.resetValue ?? 0.37;
            Object.assign(result, { outcome: 'observed', resetSucceeded: true, sdkValue: v.value, valueSource: 'sdk', capture: 'serial-worker-after-reset' });
          } else {
            const d = registry.find(d => d.id === b.slider);
            const baselineValue = v.value;
            for (const count of b.steps) v.value = Number(Math.max(v.range.min, Math.min(v.range.max, v.value + count * d.numericStep)).toFixed(d.displayPrecision));
            Object.assign(result, { outcome: 'observed', baselineValue, requestedValue: v.value, sdkValue: v.value, ...v.range, valueSource: 'sdk', matchesRequested: true });
            delete result.serverEpoch; // RC1 Nudge has epoch on the receipt envelope only.
          }
          op.receipt.phase = 'complete'; op.receipt.result = result;
          await options.onComplete?.(op, mock);
        }
        op.polls++;
        return send(res, 200, { ok: true, receipt: op.receipt });
      }
      send(res, 404, { ok: false, error: 'Unexpected route' });
    } catch (error) { send(res, 500, { ok: false, error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  mock.url = `http://127.0.0.1:${server.address().port}`;
  mock.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrbridge-mcp-test-'));
  mock.service = new LRBridgeService({ baseUrl: mock.url, stateDir: mock.stateDir, httpTimeoutMs: 1000,
    pollMs: 2, readTimeoutMs: 1000, operationTimeoutMs: options.neverComplete ? 100 : 2000, batchTimeoutMs: 5000, ...options.client });
  mock.ownedContext = async () => (await mock.service.call('lrbridge_get_photo_context')).context;
  mock.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(mock.stateDir, { recursive: true, force: true }); };
  return mock;
}
