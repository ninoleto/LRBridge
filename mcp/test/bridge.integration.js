// Actual RC1 HTTP handlers, capabilities, validation, FIFO queue and receipt stores.
// The isolated worker below is a test double, never a Lightroom/catalog connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LRBridgeService } from '../src/service.js';

const require = createRequire(import.meta.url);
const { createBridge } = require('../../server/bridge.js');
const contextState = require('../../server/context.js');
const commands = require('../../server/commands.js');
const sliders = require('../../server/sliders.js');

test('MCP adapter against actual RC1 routes, queue and receipt stores with an isolated SDK worker double', async t => {
  const originalLog = console.log; console.log = () => {};
  t.after(() => { console.log = originalLog; });
  commands.resetQueueForTests();
  contextState.updateContext({ activeModule: 'develop', selectedPhotoUuid: 'integration-photo', developFingerprint: 'integration-1' });
  const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: '127.0.0.1', wsHost: '127.0.0.1', shutdownGraceMs: 20 });
  await bridge.start();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrbridge-real-api-'));
  const baseUrl = `http://127.0.0.1:${bridge.getHttpServer().address().port}`;
  const service = new LRBridgeService({ baseUrl, stateDir, pollMs: 5, readTimeoutMs: 3000, operationTimeoutMs: 3000 });
  const values = { Contrast: 3, Clarity: 4, Vibrance: 5, Exposure: 0.1 };
  const received = [];
  const call = async (route, params) => {
    const response = await fetch(baseUrl + route + (params ? '?' + new URLSearchParams(params) : ''));
    return { status: response.status, data: await response.json() };
  };
  let stop = false, workerError, feedbackBarrier;
  const worker = (async () => {
    while (!stop) {
      if (feedbackBarrier) await feedbackBarrier;
      const read = (await call('/feedback/next')).data.request;
      if (read) {
        const ids = read.slider.startsWith('__many__:') ? read.slider.slice(9).split(',') : [read.slider];
        for (const slider of ids) {
          const d = sliders.getById(slider), c = contextState.getContextFields();
          const params = { id: read.id, slider, value: values[slider] ?? 0, min: d.min, max: d.max };
          if (d.contextBoundRuntimeRange || slider === 'ProfileAmount') Object.assign(params, { selectedPhotoKey: c.selectedPhotoKey, selectedPhotoUuid: c.selectedPhotoUuid });
          assert.equal((await call('/feedback/result', params)).status, 200);
        }
      }
      const command = (await call('/next')).data.command;
      if (command) {
        received.push(command);
        const family = { 'develop.set.guarded': 'set', 'develop.nudge': 'nudge', 'develop.reset.correlated': 'reset' }[command.command];
        assert.ok(family, `Unexpected command ${command.command}`);
        const key = { serverEpoch: command.expectedServerEpoch, requestId: command.requestId, operationId: command.operationId };
        assert.equal((await call(`/${family}/claim`, key)).data.valid, true);
        const validation = (await call(`/${family}/validate`, key)).data;
        assert.equal(validation.valid, true);
        const r = { ...key, invoked: true };
        if (family === 'set') {
          assert.equal(command.expectedValue, values[command.slider]); values[command.slider] = command.value;
          Object.assign(r, { slider: command.slider, selectedPhotoUuid: command.expectedSelectedPhotoUuid,
            contextCounter: command.expectedContextCounter, contextChangedAt: command.expectedContextChangedAt,
            outcome: 'applied', reason: 'sdk-returned' });
        } else if (family === 'reset') {
          values[command.slider] = 0.37;
          Object.assign(r, { slider: command.slider, selectedPhotoUuid: command.expectedSelectedPhotoUuid,
            contextCounter: command.expectedContextCounter, contextChangedAt: command.expectedContextChangedAt,
            executionDevelopCounter: validation.developCounter, outcome: 'observed', resetSucceeded: true, sdkValue: 0.37 });
        } else {
          const d = sliders.getById(command.slider), baselineValue = values[command.slider];
          values[command.slider] += command.steps.reduce((s, n) => s + n, 0) * d.numericStep;
          Object.assign(r, { outcome: 'observed', executionDevelopCounter: validation.developCounter,
            baselineValue, requestedValue: values[command.slider], sdkValue: values[command.slider], min: d.min, max: d.max });
        }
        assert.equal((await call(`/${family}/operation-result`, r)).status, 200);
      }
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  })().catch(error => { workerError = error; });
  t.after(async () => { stop = true; await worker; await bridge.stop(); commands.resetQueueForTests(); fs.rmSync(stateDir, { recursive: true, force: true }); });

  for (const [name, args, expected] of [
    ['lrbridge_set_slider', { slider: 'Contrast', value: 24 }, 24],
    ['lrbridge_adjust_slider', { slider: 'Exposure', amount: 0.35 }, 0.45],
    ['lrbridge_reset_slider', { slider: 'Contrast' }, 0.37]
  ]) {
    await t.test(name, async () => {
      const context = (await service.call('lrbridge_get_photo_context')).context;
      const result = await service.call(name, { requestId: name, context, ...args });
      assert.ifError(workerError);
      assert.equal(result.status, 'confirmed', JSON.stringify(result));
      assert.ok(Math.abs(result.value - expected) < 1e-9);
      const before = received.length;
      assert.equal((await service.call(name, { requestId: name, context, ...args })).duplicate, true);
      assert.equal(received.length, before);
    });
  }
  for (const [name, args, expected] of [
    ['lrbridge_adjust_slider', { slider: 'Vibrance', amount: 5 }, 10],
    ['lrbridge_reset_slider', { slider: 'Contrast' }, 0.37]
  ]) {
    await t.test(`${name} confirms a retained receipt after a same-photo heartbeat using fresh SDK feedback`, async () => {
      const requestId = 'heartbeat-' + name;
      const context = (await service.call('lrbridge_get_photo_context')).context;
      const get = service.http.get.bind(service.http);
      let advanced = false;
      service.http.get = async (route, options) => {
        const data = await get(route, options);
        // Deterministically deliver a heartbeat after the actual RC1 server has
        // accepted and returned an observed receipt, before MCP confirms it.
        if (!advanced && data.receipt?.phase === 'complete' && data.receipt.requestId === requestId) {
          contextState.updateContext({ ...contextState.getContextFields(), developFingerprint: requestId });
          advanced = true;
        }
        return data;
      };
      try {
        const result = await service.call(name, { requestId, context, ...args });
        assert.ifError(workerError);
        assert.equal(result.status, 'confirmed', JSON.stringify(result));
        assert.equal(result.confirmation, 'owned_sdk_receipt_and_fresh_owned_read');
        assert.equal(result.value, expected);
        assert.equal(result.context.developCounter, result.receipt.result.executionDevelopCounter + 1);
        assert.ok(Number.isSafeInteger(result.snapshotId));
        assert.equal(received.filter(command => command.requestId === requestId).length, 1);
      } finally { service.http.get = get; }
    });
  }
  await t.test('batch confirmation follows RC1 dispatch binding after each queued read crosses a same-photo heartbeat', async () => {
    const get = service.http.get.bind(service.http);
    const before = received.length;
    const context = (await service.call('lrbridge_get_photo_context')).context;
    let releaseFeedback, queuedConfirmations = 0;
    service.http.get = async (route, options) => {
      const data = await get(route, options);
      if (route.startsWith('/set/result?') && data.receipt?.phase === 'complete') {
        // Hold the simulated SDK until the next read is actually admitted.
        feedbackBarrier = new Promise(resolve => { releaseFeedback = resolve; });
      } else if (route.startsWith('/feedback/request-many?') && releaseFeedback) {
        const queued = (await call('/feedback/snapshot', { id: data.request.id })).data.snapshot;
        assert.equal(queued.complete, false);
        assert.equal(queued.context, undefined, 'No dispatch binding or SDK sample yet');
        assert.deepEqual(queued.results, {});
        contextState.updateContext({ ...contextState.getContextFields(), developFingerprint: 'queued-confirm-' + ++queuedConfirmations });
        releaseFeedback(); releaseFeedback = undefined; feedbackBarrier = undefined;
      }
      return data;
    };
    try {
      const adjustments = [{ slider: 'Contrast', value: 10 }, { slider: 'Clarity', value: 5 }, { slider: 'Vibrance', value: 10 }];
      const input = { requestId: 'dispatch-batch-real', context, adjustments };
      const result = await service.call('lrbridge_set_multiple_sliders', input);
      assert.ifError(workerError);
      assert.equal(result.status, 'confirmed', JSON.stringify(result));
      assert.equal(result.atomic, false);
      assert.deepEqual(result.results.map(r => [r.slider, r.status, r.value]), adjustments.map(a => [a.slider, 'confirmed', a.value]));
      assert.deepEqual(result.results.map(r => r.context.developCounter), [1, 2, 3].map(n => context.developCounter + n));
      assert.equal(queuedConfirmations, 3);
      assert.equal(received.length - before, 3);
      assert.equal(new Set(received.slice(before).map(c => c.requestId)).size, 3);
      const duplicate = await service.call('lrbridge_set_multiple_sliders', input);
      assert.equal(duplicate.duplicate, true); assert.equal(duplicate.historical, true);
      assert.equal(received.length - before, 3); assert.equal(queuedConfirmations, 3);
      const fresh = await service.call('lrbridge_get_slider_values', { sliders: adjustments.map(a => a.slider) });
      assert.equal(fresh.status, 'read');
      assert.deepEqual(adjustments.map(a => fresh.values[a.slider].value), [10, 5, 10]);
    } finally {
      releaseFeedback?.(); feedbackBarrier = undefined; service.http.get = get;
    }
  });
  await t.test('stale context refuses admission to actual command queue', async () => {
    const before = received.length;
    const context = (await service.call('lrbridge_get_photo_context')).context;
    contextState.updateContext({ activeModule: 'develop', selectedPhotoUuid: 'other-photo', developFingerprint: 'integration-2' });
    const result = await service.call('lrbridge_set_slider', { requestId: 'stale-real', context, slider: 'Clarity', value: 20 });
    assert.equal(result.status, 'rejected'); assert.equal(result.code, 'context_changed'); assert.equal(received.length, before);
  });
});
