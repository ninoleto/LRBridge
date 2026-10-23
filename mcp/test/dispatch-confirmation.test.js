import test from 'node:test';
import assert from 'node:assert/strict';
import { LRBridgeService } from '../src/service.js';
import { mockBridge } from './mock-bridge.js';

const batchActions = [
  { slider: 'Contrast', value: 10 }, { slider: 'Clarity', value: 5 }, { slider: 'Vibrance', value: 10 }
];
const snapshots = m => m.requests.filter(r => r.path === '/feedback/request-many');
const setInput = async m => ({ requestId: 'dispatch-set', context: await m.ownedContext(), slider: 'Contrast', value: 10 });

async function setup(t, options = {}) {
  const m = await mockBridge({ ...options, onSnapshot(snapshot, state) {
    // RC1 purpose=edit binds the snapshot at SDK dispatch. A heartbeat while
    // the empty request is queued may advance its revision before any sample.
    if (state.writes.length) {
      state.context.developCounter++;
      snapshot.context.developCounter = state.context.developCounter;
    }
    return options.onSnapshot?.(snapshot, state);
  } });
  t.after(() => m.close());
  return m;
}

for (const [family, tool, args, value] of [
  ['Set', 'lrbridge_set_slider', { slider: 'Contrast', value: 10 }, 10],
  ['Reset', 'lrbridge_reset_slider', { slider: 'Contrast' }, 0.37],
  ['Nudge', 'lrbridge_adjust_slider', { slider: 'Vibrance', amount: 5 }, 5]
]) {
  test(`${family} confirmation accepts the new snapshot's later SDK-dispatch revision under its original owner`, async t => {
    const m = await setup(t, { onComplete(_op, state) {
      // Reset/Nudge need a separate read when their retained receipt is older.
      if (family !== 'Set') state.context.developCounter++;
    } });
    const input = { requestId: 'dispatch-' + family, context: await m.ownedContext(), ...args };
    const result = await m.service.call(tool, input);
    assert.equal(result.status, 'confirmed', JSON.stringify(result));
    assert.equal(result.value, value);
    assert.equal(result.context.developCounter, m.context.developCounter);
    assert.ok(result.context.developCounter > result.receipt.result.executionDevelopCounter);
    assert.equal(result.context.selectedPhotoUuid, input.context.selectedPhotoUuid);
    assert.equal(snapshots(m).length, 2); assert.equal(m.writes.length, 1);
    const snapshot = m.snapshots.get(result.snapshotId);
    assert.equal(snapshot.context.developCounter, result.context.developCounter);
    assert.equal(snapshot.results[args.slider].value, result.value);
    assert.deepEqual(m.service.journal.blocked(), []);
    m.service = new LRBridgeService({ baseUrl: m.url, stateDir: m.stateDir });
    const duplicate = await m.service.call(tool, input);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.historical, true);
    assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
  });
}

test('heartbeat between receipt context check and confirmation read keeps the original owner', async t => {
  let checks = 0;
  const m = await setup(t, { intercept({ path, mock }) {
    if (path === '/set/capabilities' && mock.writes.length && ++checks === 2) mock.context.developCounter++;
  } });
  const input = await setInput(m);
  const result = await m.service.call('lrbridge_set_slider', input);
  assert.equal(result.status, 'confirmed', JSON.stringify(result));
  assert.equal(result.value, 10);
  assert.equal(result.context.developCounter, input.context.developCounter + 2);
  assert.equal(result.context.contextCounter, input.context.contextCounter);
  assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
});

test('confirmation waits through an unbound request and a fixed partial SDK-dispatch binding', async t => {
  let polls = 0;
  const m = await setup(t, { intercept({ path, mock, query, res, send }) {
    if (path !== '/feedback/snapshot' || !mock.writes.length) return;
    const snapshot = structuredClone(mock.snapshots.get(Number(query.id)));
    if (++polls < 3) { snapshot.complete = false; snapshot.completedAt = null; snapshot.results = {}; }
    if (polls === 1) delete snapshot.context;
    send(res, 200, { ok: true, snapshot }); return true;
  } });
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'confirmed', JSON.stringify(result));
  assert.equal(result.value, 10); assert.equal(result.context.developCounter, 5);
  assert.equal(polls, 3); assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
});

test('batch confirms all three independently despite a heartbeat before every confirmation dispatch', async t => {
  // Unlike setup(), advance only confirmation reads, not the following step's
  // preflight; admission baselines still require their exact captured revision.
  let pendingConfirmation = false;
  const m = await mockBridge({ onComplete() { pendingConfirmation = true; }, onSnapshot(snapshot, state) {
    if (pendingConfirmation) {
      pendingConfirmation = false;
      state.context.developCounter++;
      snapshot.context.developCounter = state.context.developCounter;
    }
  } });
  t.after(() => m.close());
  const input = { requestId: 'dispatch-batch', context: await m.ownedContext(), adjustments: batchActions };
  const result = await m.service.call('lrbridge_set_multiple_sliders', input);
  assert.equal(result.status, 'confirmed', JSON.stringify(result));
  assert.equal(result.atomic, false);
  assert.deepEqual(result.results.map(r => [r.slider, r.status, r.value]), batchActions.map(a => [a.slider, 'confirmed', a.value]));
  assert.deepEqual(m.writes.map(w => w.body.slider), batchActions.map(a => a.slider));
  assert.deepEqual(result.results.map(r => r.context.developCounter), [5, 6, 7]);
  assert.equal(snapshots(m).length, 6);
  assert.equal((await m.service.call('lrbridge_set_multiple_sliders', input)).duplicate, true);
  assert.equal(m.writes.length, 3); assert.equal(snapshots(m).length, 6);
});

for (const field of ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt', 'activeModule']) {
  test(`a later confirmation revision cannot change ${field}`, async t => {
    const m = await setup(t, { onSnapshot(snapshot, state) {
      if (!state.writes.length) return;
      snapshot.context[field] = typeof snapshot.context[field] === 'number' ? snapshot.context[field] + 1 : 'another-owner';
    } });
    const result = await m.service.call('lrbridge_set_slider', await setInput(m));
    assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'stale_feedback');
    assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
    assert.deepEqual(m.service.journal.blocked(), ['dispatch-set']);
  });
}

test('server epoch changing during later dispatch invalidates confirmation', async t => {
  const m = await setup(t, { onSnapshot(_snapshot, state) { if (state.writes.length) state.epoch = 'restarted-epoch'; } });
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'context_changed');
  assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
});

for (const revision of [3, -1, 4.5, '5', null]) {
  test(`invalid or regressing SDK-dispatch revision ${JSON.stringify(revision)} cannot confirm`, async t => {
    const m = await setup(t, { onSnapshot(snapshot, state) {
      if (state.writes.length) snapshot.context.developCounter = revision;
    } });
    const result = await m.service.call('lrbridge_set_slider', await setInput(m));
    assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'stale_feedback');
    assert.equal(m.writes.length, 1);
  });
}

test('revision advancing again after dispatch remains uncertain without a new read or POST', async t => {
  const m = await setup(t, { onSnapshot(_snapshot, state) { if (state.writes.length) state.context.developCounter++; } });
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'context_changed');
  assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
});

test('different SDK value at a later dispatch revision remains uncertain', async t => {
  const m = await setup(t, { onSnapshot(snapshot, state) { if (state.writes.length) snapshot.results.Contrast.value = 20; } });
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'target_not_observed');
  assert.equal(result.observation.values.Contrast.value, 20); assert.equal('value' in result, false);
  assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
});

test('unavailable later SDK feedback remains uncertain without an assumed default', async t => {
  const m = await setup(t, { onSnapshot(snapshot, state) {
    if (state.writes.length) Object.assign(snapshot.results.Contrast, { available: false, value: null, range: null });
  } });
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'target_not_observed');
  assert.equal('value' in result, false); assert.equal(m.writes.length, 1);
});

test('preflight never adopts a later dispatch revision as a replacement admission baseline', async t => {
  const m = await mockBridge({ onSnapshot(snapshot, state) {
    state.context.developCounter++;
    snapshot.context.developCounter = state.context.developCounter;
  } });
  t.after(() => m.close());
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'rejected'); assert.equal(result.code, 'stale_feedback');
  assert.equal(m.writes.length, 0); assert.equal(snapshots(m).length, 1);
});

test('an already bound partial confirmation cannot be rebound to another revision', async t => {
  let polls = 0;
  const m = await setup(t, { intercept({ path, mock, query, res, send }) {
    if (path !== '/feedback/snapshot' || !mock.writes.length) return;
    const snapshot = structuredClone(mock.snapshots.get(Number(query.id)));
    if (++polls === 1) { snapshot.complete = false; snapshot.completedAt = null; snapshot.results = {}; }
    else { mock.context.developCounter++; snapshot.context.developCounter++; }
    send(res, 200, { ok: true, snapshot }); return true;
  } });
  const result = await m.service.call('lrbridge_set_slider', await setInput(m));
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'stale_feedback');
  assert.equal(polls, 2); assert.equal(m.writes.length, 1); assert.equal(snapshots(m).length, 2);
});

test('batch stops on a changed owner during the second confirmation, retaining only earlier confirmation', async t => {
  let pendingConfirmation = false;
  const m = await mockBridge({ onComplete() { pendingConfirmation = true; }, onSnapshot(snapshot, state) {
    if (!pendingConfirmation) return;
    pendingConfirmation = false;
    state.context.developCounter++;
    snapshot.context.developCounter = state.context.developCounter;
    if (state.writes.length === 2) snapshot.context.contextCounter++;
  } });
  t.after(() => m.close());
  const result = await m.service.call('lrbridge_set_multiple_sliders', {
    requestId: 'dispatch-partial', context: await m.ownedContext(), adjustments: batchActions
  });
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'uncertain', 'not_attempted']);
  assert.equal(result.results[1].code, 'stale_feedback');
  assert.equal(m.writes.length, 2); assert.equal(m.values.Contrast.value, 10);
  assert.deepEqual(m.service.journal.blocked(), ['dispatch-partial']);
});
