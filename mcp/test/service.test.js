import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LRBridgeService } from '../src/service.js';
import { mockBridge, registry } from './mock-bridge.js';

async function setup(t, options) { const m = await mockBridge(options); t.after(() => m.close()); return m; }
const set = (m, context, extra = {}) => m.service.call('lrbridge_set_slider', { requestId: 'set-1', context, slider: 'Contrast', value: 24, ...extra });

test('111 live registry entries distinguish safe capabilities, unavailable and unreadable', async t => {
  const m = await setup(t); delete m.values.ProfileAmount;
  const r = await m.service.call('lrbridge_list_sliders');
  assert.equal(r.status, 'read'); assert.equal(r.count, 111);
  assert.equal(r.sliders.find(s => s.id === 'Exposure').mcpCapabilities.setAbsolute, false);
  assert.equal(r.sliders.find(s => s.id === 'Contrast').mcpCapabilities.setAbsolute, true);
  assert.equal(r.sliders.find(s => s.id === 'ProfileAmount').availability.status, 'unavailable');
  assert.equal(r.sliders.find(s => s.id === 'ProfileAmount').mcpCapabilities.adjustNumeric, true);
  assert.ok(r.sliders.some(s => s.availability.status === 'unsupported_feedback'));
  assert.equal(m.writes.length, 0);
});
test('fresh SDK read has owned context, actual ranges, and no defaults for unavailable values', async t => {
  const m = await setup(t); m.values.Exposure.value = 0.37; delete m.values.Temperature;
  const r = await m.service.call('lrbridge_get_slider_values', { sliders: ['Exposure', 'Temperature'] });
  assert.equal(r.status, 'read'); assert.equal(r.values.Exposure.value, 0.37);
  assert.equal(r.values.Temperature.available, false); assert.equal('value' in r.values.Temperature, false);
  assert.deepEqual(r.context, await m.ownedContext());
});
test('absolute Set waits for receipt and independent SDK feedback, never uses legacy GET', async t => {
  const m = await setup(t); const r = await set(m, await m.ownedContext());
  assert.equal(r.status, 'confirmed'); assert.equal(r.value, 24); assert.equal(m.writes.length, 1);
  assert.equal(m.writes[0].body.expectedValue, 0);
  const paths = m.requests.map(r => `${r.method} ${r.path}`);
  assert.ok(paths.indexOf('GET /set/result') < paths.lastIndexOf('GET /feedback/request-many'));
  assert.equal(m.requests.some(r => r.method === 'GET' && ['/set', '/adjust', '/reset', '/command'].includes(r.path)), false);
});
test('relative adjustment uses numeric units and reads execution baseline, including clamping', async t => {
  const m = await setup(t); m.values.Exposure.value = 4.99;
  const r = await m.service.call('lrbridge_adjust_slider', { requestId: 'relative', context: await m.ownedContext(), slider: 'Exposure', amount: 0.35 });
  assert.equal(r.status, 'confirmed'); assert.equal(r.value, 5); assert.deepEqual(m.writes[0].body.steps, [35]);
  assert.equal(r.receipt.result.baselineValue, 4.99);
});
test('Profile Amount uses Nudge capability even though legacy Adjust is disabled', async t => {
  const m = await setup(t);
  const r = await m.service.call('lrbridge_adjust_slider', { requestId: 'amount', context: await m.ownedContext(), slider: 'ProfileAmount', amount: 5 });
  assert.equal(r.status, 'confirmed'); assert.equal(r.value, 105);
});
test('large numeric displacement splits counts in one POST, preserves units', async t => {
  const m = await setup(t); m.values.Temperature = { value: 5000, range: { min: 2000, max: 50000 } };
  const r = await m.service.call('lrbridge_adjust_slider', { requestId: 'kelvin', context: await m.ownedContext(), slider: 'Temperature', amount: 2500 });
  assert.equal(r.status, 'confirmed'); assert.deepEqual(m.writes[0].body.steps, [1000, 1000, 500]); assert.equal(r.value, 7500);
});
test('Reset exposes nondefault actual SDK value; never infers zero', async t => {
  const m = await setup(t, { resetValue: 5150 }); m.values.Temperature = { value: 4500, range: { min: 2000, max: 50000 } };
  const r = await m.service.call('lrbridge_reset_slider', { requestId: 'reset', context: await m.ownedContext(), slider: 'Temperature' });
  assert.equal(r.status, 'confirmed'); assert.equal(r.value, 5150); assert.equal('value' in m.writes[0].body, false);
});
for (const [name, args, code] of [
  ['unsupported absolute Exposure', { slider: 'Exposure', value: 0.35 }, 'unsupported_safe_set'],
  ['unknown slider', { slider: 'Imaginary', value: 1 }, 'unsupported_slider'],
  ['out of range', { value: 101 }, 'invalid_value'],
  ['fraction not on grid', { value: 0.5 }, 'invalid_value'],
  ['numeric string', { value: '24' }, 'invalid_input'],
  ['NaN', { value: NaN }, 'invalid_input'],
  ['Infinity', { value: Infinity }, 'invalid_input'],
  ['extra property', { extra: 'ignored?' }, 'invalid_input']
]) test(`Set refuses ${name} before any write`, async t => {
  const m = await setup(t); const r = await set(m, await m.ownedContext(), args);
  assert.equal(r.status, 'rejected'); assert.equal(r.code, code); assert.equal(m.writes.length, 0);
});
for (const amount of [0, 0.005, 41, -41]) test(`Exposure adjustment refuses invalid amount ${amount}`, async t => {
  const m = await setup(t); const r = await m.service.call('lrbridge_adjust_slider', { requestId: 'bad', context: await m.ownedContext(), slider: 'Exposure', amount });
  assert.equal(r.status, 'rejected'); assert.equal(m.writes.length, 0);
});
test('unsupported Reset and supported but unavailable controls remain distinct', async t => {
  const m = await setup(t); const context = await m.ownedContext();
  let r = await m.service.call('lrbridge_reset_slider', { requestId: 'reset', context, slider: 'HDREditMode' });
  assert.equal(r.code, 'unsupported_reset');
  delete m.values.Contrast; r = await set(m, context);
  assert.equal(r.code, 'slider_unavailable'); assert.equal(m.writes.length, 0);
});
for (const field of ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt', 'developCounter', 'serverEpoch', 'activeModule']) {
  test(`stale ${field} refuses write before admission`, async t => {
    const m = await setup(t); const context = await m.ownedContext();
    if (field === 'serverEpoch') m.epoch = 'new-epoch';
    else m.context[field] = typeof m.context[field] === 'number' ? m.context[field] + 1 : 'changed';
    const r = await set(m, context); assert.equal(r.status, 'rejected'); assert.equal(m.writes.length, 0);
  });
}
test('missing and stale SDK feedback cannot supply a value or admission baseline', async t => {
  const m = await setup(t, { onSnapshot(snapshot) { delete snapshot.results.Contrast; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.code, 'invalid_feedback'); assert.equal(m.writes.length, 0);
});
test('photo changes during feedback acquisition reject the complete snapshot', async t => {
  const m = await setup(t, { onSnapshot(_s, state) { state.photoChange(); } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'rejected'); assert.equal(m.writes.length, 0);
});
test('snapshot ownership must match, even if current context later agrees', async t => {
  const m = await setup(t, { onSnapshot(s) { s.context.developCounter--; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.code, 'stale_feedback'); assert.equal(m.writes.length, 0);
});
test('offline heartbeat refuses reads and writes while retaining metadata support', async t => {
  const m = await setup(t, { offline: true });
  const status = await m.service.call('lrbridge_get_status'); assert.equal(status.bridgeReachable, true); assert.equal(status.lightroom, 'heartbeat_stale');
  const r = await set(m, status.context); assert.equal(r.code, 'heartbeat_stale'); assert.equal(m.writes.length, 0);
  const list = await m.service.call('lrbridge_list_sliders'); assert.equal(list.sliders[0].availability.status, 'unknown');
});
test('queued admission is never confirmation and timeout latches future writes', async t => {
  const m = await setup(t, { neverComplete: true }); const context = await m.ownedContext();
  const r = await set(m, context); assert.equal(r.status, 'uncertain'); assert.ok(['completion_timeout', 'http_timeout'].includes(r.code));
  const second = await set(m, context, { requestId: 'second' }); assert.equal(second.code, 'review_required');
  await assert.rejects(m.service.acknowledge('set-1'), { code: 'operation_pending' }); assert.equal(m.writes.length, 1);
});
test('lost admission response sends exactly once; read-only recovery finds the retained result', async t => {
  const m = await setup(t, { dropAdmission: true }); const context = await m.ownedContext();
  const r = await set(m, context); assert.equal(r.status, 'uncertain'); assert.equal(m.writes.length, 1);
  const lookup = await m.service.call('lrbridge_get_operation', { requestId: 'set-1' });
  assert.equal(lookup.operations[0].receipt.phase, 'complete'); assert.equal(m.writes.length, 1);
  const duplicate = await set(m, context); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.status, 'uncertain');
});
test('duplicate and conflicting IDs remain consumed across MCP process restart', async t => {
  const m = await setup(t); const context = await m.ownedContext();
  assert.equal((await set(m, context)).status, 'confirmed');
  m.service = new LRBridgeService({ baseUrl: m.url, stateDir: m.stateDir });
  assert.equal((await set(m, context)).duplicate, true);
  assert.equal((await set(m, context, { value: 25 })).code, 'request_id_conflict'); assert.equal(m.writes.length, 1);
});
test('uncertain journal blocks new IDs across restart and human acknowledgement does not replay', async t => {
  const m = await setup(t, { dropAdmission: true }); const context = await m.ownedContext();
  await set(m, context); m.service = new LRBridgeService({ baseUrl: m.url, stateDir: m.stateDir });
  assert.equal((await set(m, context, { requestId: 'second' })).code, 'review_required');
  await m.service.acknowledge('set-1');
  assert.equal(m.service.journal.blocked().length, 0);
  assert.equal((await set(m, context)).duplicate, true); assert.equal(m.writes.length, 1);
});
test('receipt with wrong photo cannot be promoted to confirmation', async t => {
  const m = await setup(t, { onComplete(op) { op.receipt.result.selectedPhotoUuid = 'other'; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'receipt_mismatch');
});
test('context changes after invocation never become current-photo success', async t => {
  const m = await setup(t, { onComplete(_op, state) { state.photoChange(); } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(m.writes.length, 1);
});
test('guarded baseline conflict is definite rejection, not automatically rebased', async t => {
  const m = await setup(t, { onComplete(op) { Object.assign(op.receipt.result, { invoked: false, outcome: 'rejected', reason: 'baseline-mismatch' }); } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'rejected'); assert.equal(r.code, 'baseline-mismatch'); assert.equal(m.writes.length, 1);
});
test('applied receipt without matching later feedback is uncertain', async t => {
  const m = await setup(t, { onComplete(_op, state) { state.values.Contrast.value = 27; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'target_not_observed');
});
test('Nudge requested without SDK observation is not confirmed', async t => {
  const m = await setup(t, { onComplete(op) { op.receipt.result.outcome = 'requested'; delete op.receipt.result.sdkValue; } });
  const r = await m.service.call('lrbridge_adjust_slider', { requestId: 'nudge', context: await m.ownedContext(), slider: 'Vibrance', amount: 5 });
  assert.equal(r.status, 'uncertain'); assert.equal(m.writes.length, 1);
});
test('Reset failure with SDK effects is uncertain, no fallback to feedback/default', async t => {
  const m = await setup(t, { onComplete(op) { Object.assign(op.receipt.result, { outcome: 'failed', invoked: true, resetSucceeded: false }); delete op.receipt.result.sdkValue; } });
  const r = await m.service.call('lrbridge_reset_slider', { requestId: 'reset', context: await m.ownedContext(), slider: 'Contrast' });
  assert.equal(r.status, 'uncertain'); assert.equal('value' in r, false);
});
test('queue rejection is explicit and never retried', async t => {
  const m = await setup(t, { rejectAdmission: true });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'rejected'); assert.equal(r.invoked, false); assert.equal(m.writes.length, 1);
});
test('batch prevalidates all absolute capabilities with zero partial edits', async t => {
  const m = await setup(t); const r = await m.service.call('lrbridge_set_multiple_sliders', { requestId: 'batch', context: await m.ownedContext(),
    adjustments: [{ slider: 'Contrast', value: 10 }, { slider: 'Exposure', value: 0.35 }] });
  assert.equal(r.status, 'rejected'); assert.equal(m.writes.length, 0);
});
test('batch confirms in sequence, retains individual receipts and is explicitly non-atomic', async t => {
  const m = await setup(t); const r = await m.service.call('lrbridge_set_multiple_sliders', { requestId: 'batch', context: await m.ownedContext(),
    adjustments: [{ slider: 'Contrast', value: 10 }, { slider: 'Clarity', value: 20 }, { slider: 'Vibrance', value: 30 }] });
  assert.equal(r.status, 'confirmed'); assert.equal(r.atomic, false); assert.equal(r.results.length, 3);
  assert.deepEqual(m.writes.map(w => w.body.slider), ['Contrast', 'Clarity', 'Vibrance']);
  assert.equal(new Set(m.writes.map(w => w.body.requestId)).size, 3);
});
test('batch stops at second failure, retains first edit and never rolls back', async t => {
  const m = await setup(t, { onComplete(op) { if (op.body.slider === 'Clarity') Object.assign(op.receipt.result, { outcome: 'uncertain' }); } });
  const r = await m.service.call('lrbridge_set_multiple_sliders', { requestId: 'batch', context: await m.ownedContext(),
    adjustments: [{ slider: 'Contrast', value: 10 }, { slider: 'Clarity', value: 20 }, { slider: 'Vibrance', value: 30 }] });
  assert.deepEqual(r.results.map(r => r.status), ['confirmed', 'uncertain', 'not_attempted']);
  assert.equal(m.values.Contrast.value, 10); assert.equal(m.writes.length, 2);
});
test('journal failure before POST cannot cause an unrecorded edit', async t => {
  const m = await setup(t); m.service.journal.save = () => { throw new Error('disk full'); };
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'rejected'); assert.equal(m.writes.length, 0);
});
test('interrupted write-ahead record is never replayed', async t => {
  const m = await setup(t, { dropAdmission: true }); const context = await m.ownedContext();
  await set(m, context); const record = m.service.journal.read('set-1'); record.state = 'pending'; delete record.result; m.service.journal.save(record);
  assert.equal((await set(m, context)).code, 'interrupted_operation'); assert.equal(m.writes.length, 1);
});
test('corrupt journal fails closed', async t => {
  const m = await setup(t); const context = await m.ownedContext(); await set(m, context);
  fs.writeFileSync(m.service.journal.filename('set-1'), '{broken');
  assert.equal((await set(m, context, { requestId: 'second' })).code, 'journal_error'); assert.equal(m.writes.length, 1);
});
test('concurrent writers share a lock and cannot reorder overlapping requests', async t => {
  const m = await setup(t, { neverComplete: true }); const context = await m.ownedContext();
  const first = set(m, context); const second = set(m, context, { requestId: 'second' });
  const results = await Promise.all([first, second]);
  assert.equal(results[0].status, 'uncertain'); assert.equal(results[1].code, 'writer_busy'); assert.equal(m.writes.length, 1);
});
test('all mocked API traffic stays within the supported adapter route allowlist', async t => {
  const m = await setup(t); await set(m, await m.ownedContext());
  const paths = new Set(['/set/capabilities', '/nudge/capabilities', '/reset/capabilities', '/sliders', '/feedback/request-many', '/feedback/snapshot', '/set', '/set/result']);
  assert.ok(m.requests.every(r => paths.has(r.path)));
  assert.equal(registry.length, 111);
});

test('SDK feedback received without a context binding cannot confirm Set', async t => {
  const m = await setup(t, { onSnapshot(s) { delete s.context; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.code, 'invalid_feedback'); assert.equal(m.writes.length, 0);
});
test('snapshot IDs and slider result IDs must correlate', async t => {
  const m = await setup(t, { onSnapshot(s) { s.results.Contrast.id++; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.code, 'invalid_feedback'); assert.equal(m.writes.length, 0);
});
test('stalled feedback is unknown, never unavailable or a fabricated baseline', async t => {
  const m = await setup(t, { onSnapshot(s) { s.complete = false; }, client: { readTimeoutMs: 60 } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'rejected');
  assert.ok(['feedback_timeout', 'http_timeout'].includes(r.code)); assert.equal(m.writes.length, 0);
});
test('server epoch change after a write does not trigger another POST', async t => {
  const m = await setup(t, { onComplete(_op, state) { state.epoch = 'epoch-2'; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(m.writes.length, 1);
});
for (const field of ['operationId', 'requestId', 'contextCounter', 'admittedDevelopCounter']) {
  test(`wrong completed ${field} cannot confirm an edit`, async t => {
    const m = await setup(t, { onComplete(op) {
      op.receipt.result[field] = field === 'admittedDevelopCounter' ? 0 : typeof op.receipt.result[field] === 'number' ? 99 : 'wrong-1';
    } });
    const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'receipt_mismatch');
  });
}
test('Nudge observed value different from computed target stays uncertain', async t => {
  const m = await setup(t, { onComplete(op) { op.receipt.result.sdkValue++; op.receipt.result.matchesRequested = false; } });
  const r = await m.service.call('lrbridge_adjust_slider', { requestId: 'different', context: await m.ownedContext(), slider: 'Vibrance', amount: 5 });
  assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'target_not_observed'); assert.equal('value' in r, false);
});
test('inconsistent terminal invocation flags are an invalid receipt, not definite non-execution', async t => {
  const m = await setup(t, { onComplete(op) { op.receipt.result.invoked = false; } });
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(r.code, 'invalid_receipt');
});
test('journal failure after SDK observation remains uncertain with one per-item result', async t => {
  const m = await setup(t); const save = m.service.journal.save.bind(m.service.journal); let count = 0;
  m.service.journal.save = record => { if (++count === 3) throw new Error('disk error'); save(record); };
  const r = await set(m, await m.ownedContext()); assert.equal(r.status, 'uncertain'); assert.equal(m.writes.length, 1);
  assert.deepEqual(m.service.journal.blocked(), ['set-1']);
});
test('non-atomic batch stops when a new photo is selected between targets', async t => {
  const m = await setup(t, { onSnapshot(s, state) {
    if (state.writes.length === 1 && s.requestedSliders[0] === 'Clarity') state.photoChange();
  } });
  const r = await m.service.call('lrbridge_set_multiple_sliders', { requestId: 'navigation-batch', context: await m.ownedContext(),
    adjustments: [{ slider: 'Contrast', value: 10 }, { slider: 'Clarity', value: 20 }, { slider: 'Vibrance', value: 30 }] });
  assert.deepEqual(r.results.map(r => r.status), ['confirmed', 'rejected', 'not_attempted']);
  assert.equal(m.writes.length, 1); assert.equal(m.values.Contrast.value, 10);
});
test('duplicate slider batch and invalid later numeric target cause no partial edits', async t => {
  const m = await setup(t); const context = await m.ownedContext();
  for (const adjustments of [[{ slider: 'Contrast', value: 10 }, { slider: 'Contrast', value: 20 }],
    [{ slider: 'Contrast', value: 10 }, { slider: 'Clarity', value: 101 }]]) {
    assert.equal((await m.service.call('lrbridge_set_multiple_sliders', { requestId: 'invalid-batch', context, adjustments })).status, 'rejected');
  }
  assert.equal(m.writes.length, 0);
});
test('lock cleanup failure preserves the confirmed outcome and prevents another writer', async t => {
  const m = await setup(t); const remove = fs.rmSync;
  fs.rmSync = (file, options) => {
    if (file === m.service.journal.lock) throw new Error('locked by filesystem');
    return remove(file, options);
  };
  let result;
  try { result = await set(m, await m.ownedContext()); }
  finally { fs.rmSync = remove; }
  assert.equal(result.status, 'confirmed'); assert.match(result.journalWarning, /Could not release/);
  assert.equal((await set(m, await m.ownedContext(), { requestId: 'second' })).code, 'writer_busy');
  assert.equal(m.writes.length, 1);
});
