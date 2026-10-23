import { createHash } from 'node:crypto';
import { BridgeError, HttpClient } from './http.js';
import { BridgeClient, equalContext, finite, validRange, pause } from './bridge-client.js';
import { Journal, fingerprint } from './journal.js';
import { schemas } from './schemas.js';

const WRITE_TOOLS = new Set(['lrbridge_set_slider', 'lrbridge_adjust_slider', 'lrbridge_reset_slider', 'lrbridge_set_multiple_sliders']);
const errorData = error => ({ code: error.code || 'internal_error', message: error instanceof BridgeError ? error.message : 'Internal failure; no automatic retry.', ...error.details });
const failed = (error, status = 'rejected') => ({ status, ...errorData(error), retryAutomatically: false });
const isInt = n => Number.isSafeInteger(n) && n >= 0;
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) < 1e-9;
const stepCount = (amount, step) => {
  const count = amount / step;
  return finite(count) && Number.isSafeInteger(Math.round(count)) && Math.abs(count - Math.round(count)) < 1e-9 ? Math.round(count) : null;
};

export class LRBridgeService {
  constructor(options = {}) {
    this.http = new HttpClient(options);
    this.bridge = new BridgeClient(this.http, options);
    this.journal = new Journal(this.http.origin, options.stateDir);
    this.operationTimeoutMs = options.operationTimeoutMs ?? 70000;
    this.batchTimeoutMs = options.batchTimeoutMs ?? 120000;
  }

  async call(name, input = {}, signal) {
    try {
      const schema = schemas[name];
      if (!schema) throw new BridgeError('unknown_tool', 'Unknown MCP tool.');
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new BridgeError('invalid_input', 'Invalid tool arguments.', {
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
      });
      const args = parsed.data;
      if (WRITE_TOOLS.has(name)) return await this.write(name, args, signal);
      if (name === 'lrbridge_get_operation') return await this.getOperation(args.requestId, signal);
      if (name === 'lrbridge_list_sliders') return await this.listSliders(args, signal);
      if (name === 'lrbridge_get_slider_values') return { status: 'read', ...await this.bridge.readValues(args.sliders, { signal }) };
      const state = await this.bridge.context(signal);
      if (name === 'lrbridge_get_photo_context') return { status: 'read', ...this.publicContext(state) };
      const status = await this.http.get('/status', { signal });
      return { status: 'read', bridgeReachable: true, api: this.http.origin, ...this.publicContext(state),
        queueLength: isInt(status.queueLength) ? status.queueLength : null,
        blockedOperations: this.journal.blocked(),
        note: 'Heartbeat is connection evidence, not proof of edit completion. Queue length excludes a command already dispatched to the SDK.' };
    } catch (error) {
      if (name === 'lrbridge_get_status' && ['connection_failed', 'http_timeout'].includes(error.code)) {
        return { status: 'offline', bridgeReachable: false, ...errorData(error), retryAutomatically: false };
      }
      return failed(error, WRITE_TOOLS.has(name) ? 'rejected' : 'error');
    }
  }

  publicContext(state) {
    return { context: state.context, photo: state.photo, lightroom: state.lightroom,
      heartbeatAgeMs: state.heartbeatAgeMs, lastHeartbeatAt: state.lastHeartbeatAt,
      scope: 'active photo only; selection count, catalog identity and image previews are not supplied by this RC1 context API' };
  }

  async listSliders({ group, includeAvailability }, signal) {
    const state = await this.bridge.context(signal);
    const registry = await this.bridge.metadata(signal);
    const caps = await this.bridge.capabilities(state.context, signal);
    const selected = registry.filter(d => group === undefined || d.group === group);
    let observation, availabilityError;
    if (includeAvailability && selected.length) {
      try { observation = await this.bridge.readValues(selected.map(d => d.id), { expected: state.context, metadata: registry, signal }); }
      catch (error) { availabilityError = errorData(error); }
    }
    return { status: 'read', context: observation?.context || state.context, count: selected.length,
      ...(availabilityError ? { availabilityError } : {}),
      sliders: selected.map(d => ({ id: d.id, label: d.label, group: d.group,
        registryRange: { min: d.min, max: d.max }, numericStep: d.numericStep, precision: d.displayPrecision,
        legacyCapabilities: { adjust: d.adjustSupported !== false, reset: d.resetSupported !== false, feedback: d.feedbackSupported === true },
        mcpCapabilities: { setAbsolute: caps.set.sliders.includes(d.id),
          adjustNumeric: caps.nudge.sliders.some(s => s.id === d.id), reset: caps.reset.sliders.includes(d.id) },
        availability: observation?.values[d.id] || { status: d.feedbackSupported === true ? 'unknown' : 'unsupported_feedback', available: null }
      })),
      note: 'registryRange can contain a cached runtime range; only an available owned SDK observation establishes the current range. RC1 guarded Set supports Contrast, Clarity and Vibrance only.' };
  }

  validateAction(action, metadata, caps, value) {
    const d = metadata.find(d => d.id === action.slider);
    if (!d) throw new BridgeError('unsupported_slider', `Unknown slider ID: ${action.slider}`);
    if (action.family === 'set' && !caps.set.sliders.includes(d.id)) {
      throw new BridgeError('unsupported_safe_set', `RC1 does not offer guarded absolute Set for ${d.id}. No legacy write or read/relative emulation was sent.`);
    }
    if (action.family === 'reset' && (!caps.reset.sliders.includes(d.id) || d.resetSupported === false)) {
      throw new BridgeError('unsupported_reset', `Identified Reset is not supported for ${d.id}.`);
    }
    const nudge = caps.nudge.sliders.find(s => s.id === d.id);
    if (action.family === 'nudge' && !nudge) throw new BridgeError('unsupported_adjust', `Numeric Nudge is not supported for ${d.id}.`);
    if (!value || value.available !== true || !validRange(value.range)) {
      throw new BridgeError('slider_unavailable', `${d.id} has no available owned SDK value/range; no write was sent.`);
    }
    if (action.family === 'set') {
      if (!finite(action.value) || action.value < value.range.min || action.value > value.range.max ||
          stepCount(action.value - value.range.min, d.numericStep) === null) {
        throw new BridgeError('invalid_value', `${d.id} value is outside its current SDK range or numeric grid.`, { range: value.range, numericStep: d.numericStep });
      }
    }
    if (action.family === 'nudge') {
      if (!near(nudge.numericStep, d.numericStep) || nudge.precision !== d.displayPrecision ||
          !isInt(caps.nudge.maxStepCount) || caps.nudge.maxStepCount < 1 ||
          !isInt(caps.nudge.maxTotalSteps) || !isInt(caps.nudge.maxAdjustments)) {
        throw new BridgeError('invalid_metadata', 'Inconsistent numeric nudge capabilities.');
      }
      const count = stepCount(action.amount, nudge.numericStep);
      if (count === null || count === 0 || Math.abs(count) > Math.min(4096, caps.nudge.maxTotalSteps)) {
        throw new BridgeError('invalid_amount', 'Amount must be a nonzero multiple of numericStep within the advertised nudge limit.',
          { numericStep: nudge.numericStep, maxTotalSteps: Math.min(4096, caps.nudge.maxTotalSteps) });
      }
      const steps = [];
      let remaining = count;
      while (remaining) {
        const part = Math.sign(remaining) * Math.min(Math.abs(remaining), caps.nudge.maxStepCount, 1000);
        steps.push(part); remaining -= part;
      }
      if (steps.length > Math.min(64, caps.nudge.maxAdjustments)) throw new BridgeError('invalid_amount', 'Too many numeric nudge steps.');
      return { steps };
    }
    return {};
  }

  async write(name, args, signal) {
    return this.journal.exclusive(async () => {
      const intentHash = fingerprint({ name, args });
      const previous = this.journal.read(args.requestId);
      if (previous) {
        if (previous.fingerprint !== intentHash) throw new BridgeError('request_id_conflict', 'This request ID already identifies different arguments. No write was sent.');
        return { ...(previous.result || { status: 'uncertain', code: 'interrupted_operation', message: 'The earlier call was interrupted. Use lrbridge_get_operation; no write was repeated.' }),
          requestId: args.requestId, duplicate: true, historical: true, retryAutomatically: false };
      }
      const blocked = this.journal.blocked();
      if (blocked.length) throw new BridgeError('review_required', 'An earlier operation needs human review before another write. Use lrbridge_get_operation and the documented CLI acknowledgement.', { blockedOperations: blocked });
      if (this.journal.records().length >= 8192) throw new BridgeError('journal_full', 'Journal capacity reached. No operation IDs are evicted. Archive only after reviewing all operations.');
      const batch = name === 'lrbridge_set_multiple_sliders';
      const actions = batch ? args.adjustments.map(a => ({ ...a, family: 'set' })) : [{ slider: args.slider,
        family: name === 'lrbridge_set_slider' ? 'set' : name === 'lrbridge_reset_slider' ? 'reset' : 'nudge',
        ...(name === 'lrbridge_set_slider' ? { value: args.value } : name === 'lrbridge_adjust_slider' ? { amount: args.amount } : {}) }];
      if (new Set(actions.map(a => a.slider)).size !== actions.length) throw new BridgeError('duplicate_slider', 'A batch cannot contain the same slider twice.');
      // All targets are validated before the first write. No partial batch on a
      // known unsupported slider, unavailable value or invalid numeric target.
      await this.bridge.checkContext(args.context, signal);
      const metadata = await this.bridge.metadata(signal);
      const caps = await this.bridge.capabilities(args.context, signal);
      for (const action of actions) {
        if (!metadata.some(d => d.id === action.slider)) throw new BridgeError('unsupported_slider', `Unknown slider ID: ${action.slider}`);
        if (action.family === 'set' && !caps.set.sliders.includes(action.slider)) {
          throw new BridgeError('unsupported_safe_set', `RC1 guarded Set does not support ${action.slider}; the entire request was refused before any write.`);
        }
      }
      let feedback = await this.bridge.readValues(actions.map(a => a.slider), { expected: args.context, metadata, signal });
      for (const action of actions) this.validateAction(action, metadata, caps, feedback.values[action.slider]);
      const record = { version: 1, origin: this.http.origin, requestId: args.requestId, fingerprint: intentHash,
        intent: { name, args }, state: 'pending', reviewed: false, operations: [], createdAt: new Date().toISOString() };
      this.journal.save(record);
      const results = [];
      const deadline = Date.now() + (batch ? this.batchTimeoutMs : this.operationTimeoutMs);
      for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        if (results.some(r => r.status !== 'confirmed')) {
          results.push({ slider: action.slider, status: 'not_attempted', reason: 'Earlier operation did not confirm. No rollback or continuation.' });
          continue;
        }
        try {
          if (Date.now() >= deadline) throw new BridgeError('batch_timeout', 'Batch deadline reached before this write.');
          if (index > 0) {
            const state = await this.bridge.checkContext(args.context, signal, false);
            feedback = await this.bridge.readValues([action.slider], { expected: state.context, metadata, signal });
          }
          const extra = this.validateAction(action, metadata, caps, feedback.values[action.slider]);
          await this.bridge.checkContext(feedback.context, signal);
          if (signal?.aborted) throw new BridgeError('cancelled', 'Cancelled before submission.');
          const requestId = batch ? 'mcp-' + createHash('sha256').update(args.requestId + ':' + index).digest('hex') : args.requestId;
          const body = { requestId, serverEpoch: feedback.context.serverEpoch, slider: action.slider,
            selectedPhotoUuid: feedback.context.selectedPhotoUuid, contextCounter: feedback.context.contextCounter,
            contextChangedAt: feedback.context.contextChangedAt,
            ...(action.family === 'set' ? { expectedValue: feedback.values[action.slider].value, value: action.value } : extra) };
          const operation = { family: action.family, body, context: feedback.context, stage: 'sending' };
          record.operations.push(operation);
          this.journal.save(record); // Must be durable before the only POST.
          const result = await this.submit(operation, signal, Math.min(deadline, Date.now() + this.operationTimeoutMs));
          operation.result = result;
          operation.stage = 'finished';
          this.journal.save(record);
          results.push({ slider: action.slider, ...result });
        } catch (error) {
          const operation = record.operations[index];
          // A journal failure after confirmation must remain uncertain to this
          // client too: the durable record may still say "sending".
          const uncertain = operation !== undefined;
          results.push({ slider: action.slider, ...failed(error, uncertain ? 'uncertain' : 'rejected') });
          if (operation) operation.result = results.at(-1);
        }
      }
      const anyUncertain = results.some(r => r.status === 'uncertain');
      const allConfirmed = results.every(r => r.status === 'confirmed');
      record.result = batch ? { requestId: args.requestId, status: allConfirmed ? 'confirmed' : anyUncertain ? 'uncertain' : 'partial_failure',
        atomic: false, results, retryAutomatically: false, note: 'Sequential independent edits. Earlier edits are retained; no rollback.' }
        : { requestId: args.requestId, ...results[0], retryAutomatically: false };
      record.state = anyUncertain ? 'uncertain' : 'complete';
      try { this.journal.save(record); }
      catch { return { status: 'uncertain', requestId: args.requestId, code: 'journal_write_failed',
        message: 'Could not persist the final result. Inspect the operation before further edits.', retryAutomatically: false }; }
      return record.result;
    });
  }

  validateReceipt(operation, receipt) {
    const { body, context, family } = operation;
    if (!receipt || receipt.serverEpoch !== body.serverEpoch || receipt.requestId !== body.requestId ||
        typeof receipt.operationId !== 'string' || !new RegExp(`^${family === 'set' ? 'gs' : family === 'nudge' ? 'nn' : 'rc'}-\\d{1,10}$`).test(receipt.operationId) ||
        (operation.operationId && operation.operationId !== receipt.operationId) ||
        !['queued', 'dispatched', 'executing', 'complete'].includes(receipt.phase)) {
      throw new BridgeError('receipt_mismatch', 'Operation receipt identity does not match this request.');
    }
    operation.operationId = receipt.operationId;
    if (receipt.phase !== 'complete') {
      if (receipt.result !== null) throw new BridgeError('invalid_receipt', 'Pending receipt contains a terminal result.');
      return;
    }
    const r = receipt.result;
    if (!r || r.requestId !== body.requestId || r.operationId !== receipt.operationId || r.slider !== body.slider ||
        r.selectedPhotoUuid !== body.selectedPhotoUuid || r.contextCounter !== body.contextCounter ||
        r.contextChangedAt !== body.contextChangedAt || !isInt(r.admittedDevelopCounter) ||
        r.admittedDevelopCounter < context.developCounter ||
        (family !== 'nudge' && r.serverEpoch !== body.serverEpoch) ||
        (r.executionDevelopCounter !== undefined && (!isInt(r.executionDevelopCounter) || r.executionDevelopCounter < r.admittedDevelopCounter))) {
      throw new BridgeError('receipt_mismatch', 'Completed receipt does not match its original photo, context or revision.');
    }
    const outcomes = family === 'set' ? ['applied', 'rejected', 'uncertain'] :
      family === 'reset' ? ['observed', 'stale', 'unavailable', 'failed', 'timeout', 'uncertain'] :
        ['observed', 'requested', 'stale', 'unavailable', 'failed', 'uncertain'];
    if (!outcomes.includes(r.outcome) || (['applied', 'observed', 'requested'].includes(r.outcome) && r.invoked !== true)) {
      throw new BridgeError('invalid_receipt', 'Receipt outcome and invocation flags are inconsistent.');
    }
    if (family === 'set' && (!near(r.expectedValue, body.expectedValue) || !near(r.requestedValue, body.value))) {
      throw new BridgeError('receipt_mismatch', 'Guarded Set receipt describes a different target or baseline.');
    }
  }

  async submit(operation, signal, deadline) {
    // Deliberately one POST, including when the socket closes or times out.
    const response = await this.http.request('/' + operation.family, { body: operation.body, signal });
    let receipt = response.data.receipt;
    if (!receipt) {
      if ([400, 409, 413, 429, 503].includes(response.status) && response.data.ok === false) {
        return { status: 'rejected', code: 'admission_rejected', httpStatus: response.status, invoked: false };
      }
      throw new BridgeError('admission_unknown', 'No correlated receipt was returned. Admission and execution are unknown.');
    }
    while (true) {
      this.validateReceipt(operation, receipt);
      if (receipt.phase === 'complete') break;
      if (Date.now() >= deadline) return { status: 'uncertain', code: 'completion_timeout', receipt,
        message: 'Client wait ended. The queued/claimed command may still execute; it was not cancelled or retried.' };
      await pause(Math.min(this.bridge.pollMs, Math.max(1, deadline - Date.now())), signal);
      const data = await this.http.get(`/${operation.family}/result?` + new URLSearchParams({
        serverEpoch: operation.body.serverEpoch, requestId: operation.body.requestId
      }), { signal, timeoutMs: Math.min(this.http.timeoutMs, Math.max(1, deadline - Date.now())) });
      receipt = data.receipt;
    }
    const r = receipt.result;
    if (r.invoked === false) return { status: 'rejected', code: r.reason || r.outcome, invoked: false, receipt };
    if (operation.family === 'set' ? r.outcome !== 'applied' || r.invoked !== true :
      r.outcome !== 'observed' || r.invoked !== true || r.valueSource !== 'sdk' || !finite(r.sdkValue)) {
      return { status: 'uncertain', code: r.reason || r.outcome, receipt, message: 'No owned SDK confirmation. Do not automatically repeat this edit.' };
    }
    const state = await this.bridge.checkContext(operation.context, signal, false);
    if (operation.family === 'set') {
      const observation = await this.bridge.readValues([operation.body.slider], {
        expected: state.context, signal, followDispatchRevision: true
      });
      const value = observation.values[operation.body.slider];
      if (!value.available || !near(value.value, operation.body.value)) {
        return { status: 'uncertain', code: 'target_not_observed', receipt, observation,
          message: 'SDK invocation succeeded, but separate owned feedback did not confirm the requested value.' };
      }
      return { status: 'confirmed', confirmation: 'successful_sdk_invocation_and_separate_owned_read',
        value: value.value, source: 'sdk', context: observation.context, receipt, snapshotId: observation.snapshotId };
    }
    if (!isInt(r.executionDevelopCounter) || state.context.developCounter < r.executionDevelopCounter) {
      return { status: 'uncertain', code: 'observation_revision_changed', receipt,
        message: 'The worker execution revision is missing or ahead of the current bridge revision.' };
    }
    if (operation.family === 'reset' && (r.resetSucceeded !== true || r.capture !== 'serial-worker-after-reset')) {
      throw new BridgeError('invalid_receipt', 'Reset receipt lacks its serial-worker SDK capture.');
    }
    if (operation.family === 'nudge' && (!validRange(r) || !finite(r.baselineValue) || !finite(r.requestedValue) ||
        r.sdkValue < r.min || r.sdkValue > r.max || r.matchesRequested !== true || !near(r.sdkValue, r.requestedValue))) {
      return { status: 'uncertain', code: 'target_not_observed', receipt, message: 'Nudge readback did not confirm its computed target.' };
    }
    if (state.context.developCounter > r.executionDevelopCounter) {
      // A later heartbeat can account for this edit, but its cause is unknown.
      // Keep the receipt historical and acquire new authority at the current
      // revision under the ORIGINAL epoch/photo/navigation owner. Never re-POST.
      const observation = await this.bridge.readValues([operation.body.slider], {
        expected: state.context, signal, followDispatchRevision: true
      });
      const value = observation.values[operation.body.slider];
      if (!value.available || !near(value.value, r.sdkValue)) {
        return { status: 'uncertain', code: 'observation_value_changed', receipt, observation,
          message: 'Fresh owned SDK feedback does not match the worker observation. No write was repeated.' };
      }
      return { status: 'confirmed', confirmation: 'owned_sdk_receipt_and_fresh_owned_read',
        value: value.value, source: 'sdk', context: observation.context, receipt, snapshotId: observation.snapshotId,
        note: 'The original receipt remains historical. A separate owned SDK read confirms its value at the returned revision; the cause of the revision change is not inferred.' };
    }
    return { status: 'confirmed', confirmation: 'owned_sdk_read_in_serial_worker', value: r.sdkValue, source: 'sdk',
      context: state.context, receipt, note: 'SDK observation after this invocation, not a universal Lightroom processing-completion guarantee.' };
  }

  async getOperation(requestId, signal) {
    const record = this.journal.read(requestId);
    if (!record) throw new BridgeError('unknown_request', 'No local journal entry exists for this request ID. No write was sent.');
    const operations = [];
    for (const op of record.operations) {
      try {
        const data = await this.http.get(`/${op.family}/result?` + new URLSearchParams({ serverEpoch: op.body.serverEpoch, requestId: op.body.requestId }), { signal });
        this.validateReceipt(op, data.receipt);
        operations.push({ family: op.family, receipt: data.receipt, historical: true });
      } catch (error) { operations.push({ family: op.family, requestId: op.body.requestId, ...failed(error, 'uncertain') }); }
    }
    return { status: 'read', requestId, journalState: record.state, reviewed: record.reviewed, originalResult: record.result || null,
      operations, historical: true, retryAutomatically: false,
      note: 'Read-only receipt lookup. Never resubmits a write, resumes an interrupted batch or acknowledges uncertainty.' };
  }

  async acknowledge(requestId) {
    return this.journal.exclusive(async () => {
      const record = this.journal.read(requestId);
      if (!record) throw new BridgeError('unknown_request', 'Unknown request ID.');
      const state = await this.bridge.context();
      for (const op of record.operations) {
        if (state.context.serverEpoch !== op.body.serverEpoch) continue;
        const response = await this.http.request(`/${op.family}/result?` + new URLSearchParams({ serverEpoch: op.body.serverEpoch, requestId: op.body.requestId }));
        if (response.status === 404 && response.data.ok === false) continue;
        if (response.status !== 200) throw new BridgeError('review_unavailable', 'Could not establish operation state.');
        this.validateReceipt(op, response.data.receipt);
        if (response.data.receipt.phase !== 'complete') throw new BridgeError('operation_pending', 'Operation is still pending. Acknowledgement does not cancel it; wait for terminal state.');
      }
      record.reviewed = true;
      record.reviewedAt = new Date().toISOString();
      this.journal.save(record);
      return { requestId, reviewed: true, note: 'Human review recorded. No edit or retry was sent. Original ID remains consumed.' };
    });
  }
}
