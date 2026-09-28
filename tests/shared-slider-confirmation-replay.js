"use strict";
// Replay the captured revision/404/cache rollback through production Controller code.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const trace = require("./fixtures/sdr-brightness-jump-20260928.json");
const source = fs.readFileSync(process.env.LRBRIDGE_CONTROLLER_SOURCE || path.join(__dirname, "../app/controller.html"), "utf8");
function fn(name) {
    const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
    return start < 0 ? "" : source.slice(start, source.indexOf("\n        }", start) + 10);
}
async function replay(options = {}) {
    const binding = { generation: 1, activeModule: "develop", selectedPhotoUuid: "test-photo", contextCounter: 1, contextChangedAt: 1, developCounter: trace.browserRevision };
    const control = { definition: { id: options.slider || trace.slider, label: "Test slider", min: -100, max: 100, numericStep: 1, displayPrecision: 0 }, row: { isConnected: true }, authoritativeValue: trace.cachedValue,
        localValue: trace.latestInput, desiredValue: trace.latestInput, confirmationPending: true, editGeneration: 64, range: {}, number: {}, increment: {}, decrement: {}, reset: {}, feedbackState: "available" };
    const displays = [], errors = [], requests = [], contexts = [];
    let serverRevision = trace.browserRevision, reads = 0;
    const ctx = { Date, Number, Map, Set, AbortController, Promise,
        console: { error() {} }, lastControllerSelectedPhotoKey: "test-photo",
        developSliderFeedbackBinding: () => ({ ...binding }),
        developSliderFeedbackBindingMatches: owner => Object.keys(binding).every(key => binding[key] === owner[key]),
        pollControllerContext: async () => { contexts.push(serverRevision); binding.developCounter = serverRevision;
            if (options.navigate && reads) binding.selectedPhotoUuid = "another-photo";
            return !options.contextFailure; },
        fetch: async url => { requests.push(url); assert(url.startsWith("/api/feedback/request"), "confirmation cannot send edits");
            return { ok: true, json: async () => ({ request: { id: trace.expiryRequestId + reads } }) }; },
        pollFeedbackSnapshot: async () => {
            reads++;
            if (reads === 1 && !options.healthy) {
                if (!options.transportFailure && !options.noRevisionChange) serverRevision = trace.nextRevision;
                const err = Error("Feedback snapshot HTTP " + (options.transportFailure ? 503 : 404));
                err.feedbackSnapshotMissing = !options.transportFailure;
                err.feedbackDiagnostic = { status: options.transportFailure ? 503 : 404 };
                throw err;
            }
            return { snapshot: { complete: true, results: { [control.definition.id]: { available: !options.unavailable, value: options.value ?? trace.latestInput } } } };
        },
        cancelDevelopSliderStep: c => { c.desiredValue = null; c.confirmationPending = false; c.stepConfirmationExpired = false; c.editGeneration++; },
        showDevelopSliderLocal: (c, value) => { c.localValue = value; displays.push(value); },
        setDevelopSliderState: (c, state, message) => { c.feedbackState = state; c.message = message; },
        setStatus: message => errors.push(message),
        applyTargetedDevelopSliderFeedback: (c, result) => { c.authoritativeValue = result.value;
            if (result.available === false) { c.localValue = null; c.confirmationPending = false; c.desiredValue = null; c.feedbackState = "unavailable"; }
            else if (result.value === c.desiredValue || c.stepConfirmationExpired) { c.localValue = result.value; c.confirmationPending = false; c.desiredValue = null; displays.push(result.value); } },
        valuesMatchDevelopSlider: (_, a, b) => a === b
    };
    vm.createContext(ctx);
    vm.runInContext(["developSliderConfirmationOwnerMatches", "readDevelopSliderConfirmation", "requestDevelopSliderStepFeedback"].map(fn).join("\n"), ctx);
    await ctx.requestDevelopSliderStepFeedback(control, true);
    return { control, displays, errors, requests, contexts, reads };
}
(async () => {
    for (const slider of [trace.slider, "SDRBlend", "SDRHighlights", "Contrast", "SaturationAdjustmentGreen"]) {
        const result = await replay({ slider });
        assert(!result.displays.includes(trace.cachedValue), "captured failure: invalidated read must never display cached 0 over newer -49 (" + slider + ")");
        assert.equal(result.control.localValue, -49);
        assert.equal(result.control.confirmationPending, false, "renewed SDK read must settle the edit");
        assert(result.reads >= 2, "renew the read after verified same-photo revision invalidation");
        assert.deepEqual(result.errors, []);
    }
    const error = await replay({ transportFailure: true });
    assert.equal(error.control.localValue, -49, "transport failure cannot turn cached authority into a new SDK result");
    assert.equal(error.reads, 1, "do not retry an uncertain edit or genuine transport failure");
    assert.equal(error.errors.length, 1, "unconfirmed state must be reported");
    assert.equal(error.control.confirmationPending, false, "later legitimate feedback must remain able to update the control");
    for (const option of [{ noRevisionChange: true }, { contextFailure: true }]) {
        const unverified = await replay(option);
        assert.equal(unverified.reads, 1, "404 is not automatically a verified revision invalidation");
        assert.equal(unverified.control.localValue, -49, "unverified read failure cannot display cached authority");
        assert.equal(unverified.errors.length, 1, "keep unexplained expiry/context failures visible");
    }
    const moved = await replay({ navigate: true });
    assert.equal(moved.reads, 1, "old confirmation cannot follow the next photo");
    assert.deepEqual(moved.displays, []);
    const disagreement = await replay({ healthy: true, value: -45 });
    assert.equal(disagreement.control.localValue, -45, "fresh current SDK disagreement remains authoritative after the bounded confirmation period");
    const unavailable = await replay({ healthy: true, unavailable: true });
    assert.equal(unavailable.control.feedbackState, "unavailable");
    console.log("Captured shared slider confirmation replay passed: no cached rollback, fresh read renewal, other shared sliders, failures, photo changes, SDK disagreement and unavailability (simulated).");
})().catch(error => { console.error(error); process.exitCode = 1; });
