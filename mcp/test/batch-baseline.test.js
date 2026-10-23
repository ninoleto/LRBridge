import test from 'node:test';
import assert from 'node:assert/strict';
import { LRBridgeService } from '../src/service.js';
import { mockBridge } from './mock-bridge.js';

const adjustments = [{ slider: 'Contrast', value: 12 }, { slider: 'Clarity', value: 5 }, { slider: 'Vibrance', value: 10 }];
const tool = 'lrbridge_set_multiple_sliders';
const reads = m => m.requests.filter(r => r.path === '/feedback/request-many');
const nextBaseline = (snapshot, state) => state.writes.length > 0 && snapshot.requestedSliders.length === 1 &&
  snapshot.requestedSliders[0] === adjustments[state.writes.length]?.slider;
const input = async m => ({ requestId: 'batch-baseline', context: await m.ownedContext(), adjustments });

async function setup(t, options = {}) {
  const m = await mockBridge({ ...options, onSnapshot(snapshot, state) {
    if (nextBaseline(snapshot, state)) {
      state.context.developCounter++;
      snapshot.context.developCounter = state.context.developCounter;
      return options.onNextBaseline?.(snapshot, state);
    }
    return options.onSnapshot?.(snapshot, state);
  } });
  t.after(() => m.close());
  m.context.developCounter = 14;
  m.values.Contrast.value = 10;
  return m;
}

test('batch reads later dispatch revisions between items while retaining every original baseline', async t => {
  const m = await setup(t), args = await input(m);
  const result = await m.service.call(tool, args);
  assert.equal(result.status, 'confirmed', JSON.stringify(result));
  assert.equal(result.atomic, false);
  assert.deepEqual(result.results.map(r => [r.slider, r.status, r.value]), adjustments.map(a => [a.slider, 'confirmed', a.value]));
  assert.deepEqual(result.results.map(r => r.context.developCounter), [14, 15, 16]);
  assert.deepEqual(m.writes.map(w => [w.body.slider, w.body.expectedValue]), [['Contrast', 10], ['Clarity', 0], ['Vibrance', 0]]);
  assert.equal(reads(m).length, 6); assert.deepEqual(m.service.journal.blocked(), []);
  m.service = new LRBridgeService({ baseUrl: m.url, stateDir: m.stateDir });
  const duplicate = await m.service.call(tool, args);
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.historical, true);
  assert.equal(m.writes.length, 3); assert.equal(reads(m).length, 6);
});

for (const heartbeat of [false, true]) {
  test(`a changed later slider is not overwritten, with heartbeat=${heartbeat}`, async t => {
    const m = await mockBridge({ onComplete(op, state) {
      if (op.body.slider === 'Contrast') state.values.Clarity.value = 7;
    }, onSnapshot(snapshot, state) {
      if (heartbeat && nextBaseline(snapshot, state)) {
        state.context.developCounter++;
        snapshot.context.developCounter = state.context.developCounter;
      }
    } });
    t.after(() => m.close());
    const args = await input(m), result = await m.service.call(tool, args);
    assert.equal(result.status, 'partial_failure', JSON.stringify(result));
    assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
    assert.equal(result.results[1].code, 'baseline_changed');
    assert.equal(result.results[1].baseline.value, 0); assert.equal(result.results[1].observation.value, 7);
    assert.equal(m.values.Contrast.value, 12); assert.equal(m.values.Clarity.value, 7); assert.equal(m.values.Vibrance.value, 0);
    assert.equal(m.writes.length, 1); assert.deepEqual(m.service.journal.blocked(), []);
    const count = reads(m).length;
    assert.equal((await m.service.call(tool, args)).duplicate, true);
    assert.equal(m.writes.length, 1); assert.equal(reads(m).length, count);
  });
}

test('an original range change with the same value rejects the later batch item', async t => {
  const m = await setup(t, { onNextBaseline(snapshot) {
    snapshot.results.Clarity.range = { min: -50, max: 100 };
  } });
  const result = await m.service.call(tool, await input(m));
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(result.results[1].code, 'baseline_changed'); assert.equal(m.writes.length, 1);
});

test('an unavailable later baseline never inherits its original available value', async t => {
  const m = await setup(t, { onNextBaseline(snapshot) {
    Object.assign(snapshot.results.Clarity, { available: false, value: null, range: null });
  } });
  const result = await m.service.call(tool, await input(m));
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(result.results[1].code, 'slider_unavailable'); assert.equal(m.writes.length, 1);
});

for (const field of ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt', 'activeModule']) {
  test(`batch cannot adopt a changed ${field} while reading the next baseline`, async t => {
    const m = await setup(t, { onNextBaseline(snapshot) {
      snapshot.context[field] = typeof snapshot.context[field] === 'number' ? snapshot.context[field] + 1 : 'other-owner';
    } });
    const result = await m.service.call(tool, await input(m));
    assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
    assert.equal(result.results[1].code, 'stale_feedback'); assert.equal(m.writes.length, 1);
  });
}

test('server epoch change during a later baseline read rejects before its write', async t => {
  const m = await setup(t, { onNextBaseline(_snapshot, state) { state.epoch = 'new-epoch'; } });
  const result = await m.service.call(tool, await input(m));
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(result.results[1].code, 'context_changed'); assert.equal(m.writes.length, 1);
});

test('a further revision after baseline dispatch is rejected rather than reacquired', async t => {
  const m = await setup(t, { onNextBaseline(_snapshot, state) { state.context.developCounter++; } });
  const result = await m.service.call(tool, await input(m));
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(result.results[1].code, 'context_changed');
  assert.equal(m.writes.length, 1); assert.equal(reads(m).length, 3);
});

test('initial batch prevalidation still requires the caller revision exactly', async t => {
  const m = await setup(t, { onSnapshot(snapshot, state) {
    if (state.writes.length === 0) {
      state.context.developCounter++;
      snapshot.context.developCounter = state.context.developCounter;
    }
  } });
  const result = await m.service.call(tool, await input(m));
  assert.equal(result.status, 'rejected'); assert.equal(result.code, 'stale_feedback');
  assert.equal(m.writes.length, 0); assert.equal(reads(m).length, 1);
});

test('later batch reads cannot regress behind the previous confirmed revision', async t => {
  let decreaseAfterConfirmation = false;
  const m = await setup(t, { onComplete(_op, state) { state.context.developCounter++; },
    intercept({ path, mock }) {
      if (path === '/set/capabilities' && decreaseAfterConfirmation) {
        mock.context.developCounter--; decreaseAfterConfirmation = false;
      }
    } });
  const submit = m.service.submit.bind(m.service);
  m.service.submit = async (...args) => {
    const r = await submit(...args);
    if (r.status === 'confirmed') decreaseAfterConfirmation = true;
    return r;
  };
  const result = await m.service.call(tool, await input(m));
  assert.equal(result.results[0].context.developCounter, 15);
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(result.results[1].code, 'context_changed'); assert.equal(m.writes.length, 1);
});

test('expired batch deadline after acquiring a later baseline prevents another POST', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const m = await setup(t, { client: { batchTimeoutMs: 1000 }, onNextBaseline() { clock += 2000; } });
  const result = await m.service.call(tool, await input(m));
  assert.deepEqual(result.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(result.results[1].code, 'batch_timeout'); assert.equal(m.writes.length, 1);
});

test('revision advancing before the next baseline starts is allowed only with its original value', async t => {
  const m = await setup(t);
  const submit = m.service.submit.bind(m.service);
  m.service.submit = async (...args) => {
    const result = await submit(...args);
    if (result.status === 'confirmed') m.context.developCounter++;
    return result;
  };
  const result = await m.service.call(tool, await input(m));
  assert.equal(result.status, 'confirmed', JSON.stringify(result));
  assert.deepEqual(m.writes.map(w => w.body.expectedValue), [10, 0, 0]);
  assert.equal(m.writes.length, 3);
});

test('an uncertain first edit prevents any next baseline request or batch continuation', async t => {
  const m = await setup(t, { onComplete(op) { op.receipt.result.outcome = 'uncertain'; } });
  const result = await m.service.call(tool, await input(m));
  assert.deepEqual(result.results.map(r => r.status), ['uncertain', 'not_attempted', 'not_attempted']);
  assert.equal(m.writes.length, 1); assert.equal(reads(m).length, 1);
  assert.deepEqual(m.service.journal.blocked(), ['batch-baseline']);
});
