"use strict";
// Production controller functions with delayed SDK feedback; no Lightroom instance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(process.env.LRBRIDGE_CONTROLLER_SOURCE || path.join(__dirname, "../app/controller.html"), "utf8");
function fn(name) {
    const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
    assert(start >= 0, name);
    const end = source.indexOf("\n        }", start);
    return source.slice(start, end + 10);
}
let binding = { generation: 1, activeModule: "develop", selectedPhotoUuid: "photo-a", contextCounter: 1, contextChangedAt: 1, developCounter: 1 };
const interactions = new Set(), writes = [], messages = [];
const context = {
    console, setTimeout, clearTimeout, Number,
    developSliderFeedbackBinding: () => ({ ...binding }),
    developSliderFeedbackBindingMatches: b => Object.keys(binding).every(k => b[k] === binding[k]),
    isDevelopSliderInteracting: c => interactions.has(c.definition.id),
    isProfileAmountControl: () => false,
    isParametricCurveSplitControl: () => false,
    profileAmountSubmissionBlocked: () => false,
    isWhiteBalanceDependentSlider: () => false,
    prepareParametricCurveSplitCommit: (_c, value) => value,
    developSliderNavigationQuery: () => "",
    markSliderCommandSent() {},
    requestDevelopSliderStepFeedback() {},
    setStatus: message => messages.push(message),
    sendCommand: async url => { writes.push(url); return true; },
    showDevelopSliderLocal: (c, value) => { c.localValue = Number(value); },
    applyDevelopSliderFeedback: (c, value) => { c.authoritativeValue = Number(value); c.localValue = Number(value); },
    markDevelopSliderUnavailable: c => { c.localValue = null; },
    configureDevelopSliderRange() {}, hasReceivedAnyAuthoritativeDevelopValue: false
};
vm.createContext(context);
vm.runInContext([
    "clearDevelopSliderStepTimers", "cancelDevelopSliderStep", "developSliderConfirmationTolerance", "valuesMatchDevelopSlider",
    "applyDevelopSliderFeedbackIfChanged", "applyTargetedDevelopSliderFeedback", "submitDevelopSliderValue",
    "flushDevelopSliderValue", "handleDevelopSliderStepSubmission"
].map(fn).join("\n"), context);
function control(id) {
    return { definition: { id, label: id, numericStep: 1, displayPrecision: 0 }, row: { isConnected: true },
        desiredValue: null, localValue: 0, authoritativeValue: 0, pendingValue: null, pendingKind: null,
        lastSubmittedValue: null, requestInFlight: false, confirmationPending: false,
        throttleTimer: null, stepConfirmationTimer: null, stepDebounceTimer: null };
}
async function pair(first, second) {
    const a = control(first), b = control(second), owner = { ...binding };
    a.localValue = 28; context.flushDevelopSliderValue(a, 28, "range");
    b.localValue = -17; context.flushDevelopSliderValue(b, -17, "range");
    await Promise.resolve();
    // Delayed pre-edit feedback while both edits await Lightroom must not move either control.
    context.applyDevelopSliderFeedbackIfChanged(a, { id: 10, available: true, value: 0 });
    context.applyDevelopSliderFeedbackIfChanged(b, { id: 11, available: true, value: 4 });
    assert.deepEqual([a.localValue, b.localValue], [28, -17]);
    // A newer panel snapshot beats the older, separately requested targeted results.
    context.applyDevelopSliderFeedbackIfChanged(a, { id: 14, available: true, value: 28 });
    context.applyDevelopSliderFeedbackIfChanged(b, { id: 14, available: true, value: -17 });
    assert.equal(a.confirmationPending, false);
    assert.equal(b.confirmationPending, false);
    context.applyTargetedDevelopSliderFeedback(a, { available: true, value: 0 }, 12, owner);
    context.applyTargetedDevelopSliderFeedback(b, { available: true, value: 4 }, 13, owner);
    assert.deepEqual([a.localValue, b.localValue], [28, -17], "late targeted results must not undo newer panel confirmation");
    context.applyDevelopSliderFeedbackIfChanged(a, { id: 9, available: false, value: null });
    assert.equal(a.localValue, 28, "older unavailable is not zero or unknown");
    context.applyTargetedDevelopSliderFeedback(a, { available: true, value: 30 }, 16, owner);
    context.applyDevelopSliderFeedbackIfChanged(a, { id: 15, available: true, value: 28 });
    assert.equal(a.localValue, 30, "newer targeted feedback also wins over an older panel");
    binding = { ...binding, developCounter: binding.developCounter + 1 };
    context.applyTargetedDevelopSliderFeedback(a, { available: true, value: 90 }, 17, owner);
    assert.equal(a.localValue, 30, "a changed Develop revision rejects the old read");
    binding = { ...binding, selectedPhotoUuid: "photo-b", contextCounter: binding.contextCounter + 1 };
    context.applyTargetedDevelopSliderFeedback(a, { available: true, value: 90 }, 18, owner);
    assert.equal(a.localValue, 30, "a changed photo rejects the old read");
    context.applyDevelopSliderFeedbackIfChanged(a, { id: 1, available: true, value: 5 });
    assert.equal(a.localValue, 5, "new owner/server epoch may start at lower request IDs");
    assert.equal(messages.length, 0);
}
(async () => {
    await pair("SaturationAdjustmentGreen", "SaturationAdjustmentAqua");
    await pair("PostCropVignetteAmount", "GrainAmount");
    assert.deepEqual(writes.map(url => new URL(url, "http://mock").searchParams.get("value")), ["28", "-17", "28", "-17"],
        "feedback never submits a write or substitutes zero/older values");
    const lens = require("../app/controller-lens-blur");
    const model = lens.createModel();
    model.applyAuthoritative({ ...model.get(), bokehAvailable: true, bokeh: "Circle" });
    let deliver;
    const bokehContext = {
        ...context, Date, AbortSignal, activeTab: "sliders", lensBlurHelper: lens, lensBlurModel: model,
        lensBlurBokehPending: false, lensBlurBokehFeedbackFloor: null, lensBlurStateRevision: 1,
        lensBlurStateRequestInFlight: false, lensBlurVisualizePending: null,
        updateLensBlurPresentation() {}, observeLensBlurVisualizeFeedback() {},
        lensBlurResponseContextMatchesCurrent: c => c.selectedPhotoUuid === binding.selectedPhotoUuid && c.developCounter === binding.developCounter,
        sendCommand: async () => true,
        fetch: async url => {
            assert.equal(url, "/api/lens-blur/state?sdkOnly=true");
            return new Promise(resolve => { deliver = data => resolve({ ok: true, json: async () => data }); });
        },
        sleep: async () => { binding = { ...binding, selectedPhotoUuid: "another-photo" }; }
    };
    vm.createContext(bokehContext);
    vm.runInContext(fn("setLensBlurBokeh") + "\n" + fn("requestLensBlurState"), bokehContext);
    const action = bokehContext.setLensBlurBokeh("SoapBubble");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bokehContext.lensBlurBokehPending, true);
    assert.equal(lens.presentationFor(model.get()).selectedBokeh, "Circle", "queue admission cannot highlight the requested bokeh");
    deliver({ revision: 2, context: { ...binding }, state: { bokehAvailable: true, bokeh: "SoapBubble" } });
    assert.equal(await action, true);
    assert.equal(lens.presentationFor(model.get()).selectedBokeh, "SoapBubble");
    assert.equal(bokehContext.lensBlurBokehPending, false);
    bokehContext.fetch = async () => ({ ok: true, json: async () => ({ revision: 1, context: { ...binding }, state: { ...model.get(), bokeh: "Circle" } }) });
    await bokehContext.requestLensBlurState();
    assert.equal(model.get().bokeh, "SoapBubble", "a slower full/native poll cannot undo newer SDK-only feedback");
    bokehContext.fetch = async () => ({ ok: true, json: async () => ({ revision: 3, context: { ...binding, selectedPhotoUuid: "wrong-photo" }, state: { bokehAvailable: true, bokeh: "Blade" } }) });
    assert.equal(await bokehContext.setLensBlurBokeh("Blade"), false);
    assert.equal(model.get().bokeh, "SoapBubble", "stale photo results cannot confirm bokeh");
    console.log("Shared slider delayed feedback: two rapid HSL edits, two Effects edits, both response orders, unknown, photo/revision and exact write checks passed (mock).");
    console.log("Bokeh pending/confirmed highlight, slow native-poll ordering and stale-photo rejection passed (mock).");
})().catch(error => { console.error(error); process.exitCode = 1; });
