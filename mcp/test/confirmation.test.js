import test from 'node:test';
import assert from 'node:assert/strict';
import { LRBridgeService } from '../src/service.js';
import { mockBridge } from './mock-bridge.js';

for (const [family, tool, args, expected] of [
  ['Reset', 'lrbridge_reset_slider', { slider: 'Contrast' }, 0.37],
  ['Nudge', 'lrbridge_adjust_slider', { slider: 'Vibrance', amount: 5 }, 5]
]) {
  async function setup(t, options = {}) {
    const m = await mockBridge({ ...options, onComplete(op, state) {
      // A same-photo heartbeat can advance the revision after an owned receipt
      // has already been accepted. Do not alter the retained receipt itself.
      state.context.developCounter++;
      return options.onComplete?.(op, state);
    } });
    t.after(() => m.close());
    return m;
  }
  const input = async m => ({ requestId: 'revision-test', context: await m.ownedContext(), ...args });
  const snapshots = m => m.requests.filter(r => r.path === '/feedback/request-many');

  test(`${family} receipt at an earlier revision needs matching fresh SDK feedback at the later revision`, async t => {
    const m = await setup(t), originalInput = await input(m);
    const r = await m.service.call(tool, originalInput);
    assert.equal(r.status, 'confirmed', JSON.stringify(r));
    assert.equal(r.confirmation, 'owned_sdk_receipt_and_fresh_owned_read');
    assert.equal(r.value, expected);
    assert.equal(r.receipt.result.sdkValue, expected);
    assert.equal(r.context.developCounter, r.receipt.result.executionDevelopCounter + 1);
    assert.equal(r.context.selectedPhotoUuid, originalInput.context.selectedPhotoUuid);
    assert.ok(Number.isSafeInteger(r.snapshotId));
    assert.equal(snapshots(m).length, 2);
    const paths = m.requests.map(r => r.path);
    assert.ok(paths.lastIndexOf('/feedback/request-many') > paths.indexOf(`/${family === 'Reset' ? 'reset' : 'nudge'}/result`));
    assert.equal(m.writes.length, 1);
    assert.deepEqual(m.service.journal.blocked(), []);
    m.service = new LRBridgeService({ baseUrl: m.url, stateDir: m.stateDir });
    const duplicate = await m.service.call(tool, originalInput);
    assert.equal(duplicate.status, 'confirmed'); assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.historical, true); assert.equal(m.writes.length, 1);
    assert.equal(snapshots(m).length, 2);
  });

  test(`${family} later SDK value differing from the worker observation stays uncertain and blocks writes`, async t => {
    const m = await setup(t, { onComplete(_op, state) { state.values[args.slider].value = 19; } });
    const originalInput = await input(m), r = await m.service.call(tool, originalInput);
    assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'observation_value_changed');
    assert.equal(r.receipt.result.sdkValue, expected);
    assert.equal(r.observation.values[args.slider].value, 19);
    assert.equal('value' in r, false);
    assert.deepEqual(m.service.journal.blocked(), ['revision-test']);
    assert.equal((await m.service.call(tool, originalInput)).duplicate, true);
    assert.equal((await m.service.call(tool, { ...await input(m), requestId: 'new-intent' })).code, 'review_required');
    assert.equal(m.writes.length, 1);
  });

  test(`${family} unavailable fresh SDK value never inherits the receipt value`, async t => {
    const m = await setup(t, { onComplete(_op, state) { delete state.values[args.slider]; } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'observation_value_changed');
    assert.equal('value' in r, false); assert.equal(m.writes.length, 1);
  });

  test(`${family} revision change during the fresh SDK read stays uncertain without another read or POST`, async t => {
    const m = await setup(t, { onSnapshot(_snapshot, state) { if (state.writes.length) state.context.developCounter++; } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'context_changed');
    assert.equal(snapshots(m).length, 2); assert.equal(m.writes.length, 1);
  });

  test(`${family} a stale snapshot cannot reconfirm a historical receipt`, async t => {
    const m = await setup(t, { onSnapshot(snapshot, state) { if (state.writes.length) snapshot.context.developCounter--; } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'stale_feedback');
    assert.equal(m.writes.length, 1);
  });

  for (const field of ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt', 'activeModule', 'serverEpoch']) {
    test(`${family} changed ${field} is never rebound to a fresh observation`, async t => {
      const m = await setup(t, { onComplete(_op, state) {
        if (field === 'serverEpoch') state.epoch = 'different-epoch';
        else state.context[field] = typeof state.context[field] === 'number' ? state.context[field] + 1 : 'different';
      } });
      const r = await m.service.call(tool, await input(m));
      assert.equal(r.status, 'uncertain'); assert.equal(snapshots(m).length, 1);
      assert.equal(m.writes.length, 1);
    });
  }

  test(`${family} an uncertain worker receipt is never promoted using a later matching value`, async t => {
    const m = await setup(t, { onComplete(op) { op.receipt.result.outcome = 'uncertain'; delete op.receipt.result.sdkValue; } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(snapshots(m).length, 1);
    assert.equal(m.writes.length, 1);
  });

  test(`${family} an execution revision ahead of the current bridge stays uncertain`, async t => {
    const m = await setup(t, { onComplete(op, state) { op.receipt.result.executionDevelopCounter = state.context.developCounter + 1; } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'observation_revision_changed');
    assert.equal(snapshots(m).length, 1); assert.equal(m.writes.length, 1);
  });

  test(`${family} invalid worker observation evidence is not rescued by fresh feedback`, async t => {
    const m = await setup(t, { onComplete(op) {
      if (family === 'Reset') op.receipt.result.capture = 'unowned-feedback';
      else op.receipt.result.matchesRequested = false;
    } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(snapshots(m).length, 1);
    assert.equal(m.writes.length, 1);
  });

  test(`${family} a lost fresh-read response leaves the original write uncertain without replay`, async t => {
    const m = await setup(t, { intercept({ path, mock, req }) {
      if (path === '/feedback/request-many' && mock.writes.length) { req.socket.destroy(); return true; }
    } });
    const r = await m.service.call(tool, await input(m));
    assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'connection_failed');
    assert.equal(m.writes.length, 1); assert.deepEqual(m.service.journal.blocked(), ['revision-test']);
  });
}
