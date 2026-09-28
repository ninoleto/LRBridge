"use strict";
// Execute production controller functions with controlled transport/SDK feedback.
// These are ordering regressions, not evidence of live Lightroom timing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(process.env.LRBRIDGE_CONTROLLER_SOURCE || path.join(__dirname, "../app/controller.html"), "utf8");
function fn(name) {
    const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
    return start < 0 ? "" : source.slice(start, source.indexOf("\n        }", start) + 10);
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const timers = new Map(), reads = [], writes = [], errors = [];
    let serial = 100;
    const binding = { generation: 1, activeModule: "develop", selectedPhotoUuid: "a", contextCounter: 1, contextChangedAt: 1, developCounter: 1 };
    const ctx = {
        console: { error() {} }, Number, Date,
        setTimeout: (cb, delay) => { const id = ++serial; timers.set(id, { cb, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        developSliderFeedbackBinding: () => ({ ...binding }),
        developSliderFeedbackBindingMatches: b => Object.keys(binding).every(k => b[k] === binding[k]),
        isDevelopSliderInteracting: () => false, isProfileAmountControl: c => c.definition.id === "ProfileAmount",
        isParametricCurveSplitControl: () => false, profileAmountSubmissionBlocked: () => false,
        isWhiteBalanceDependentSlider: () => false, prepareParametricCurveSplitCommit: (_, value) => value,
        developSliderNavigationQuery: () => "", markSliderCommandSent() {},
        showDevelopSliderLocal: (c, value) => { c.localValue = Number(value); },
        setStatus: text => errors.push(text), notifyDevelopSliderPresentation() {}, configureDevelopSliderRange() {},
        markDevelopSliderUnavailable: c => { c.localValue = null; }, hasReceivedAnyAuthoritativeDevelopValue: false,
        fetch: async () => { const read = { id: ++serial, ...deferred() }; reads.push(read); return { ok: true, json: async () => ({ request: { id: read.id } }) }; },
        pollFeedbackSnapshot: id => reads.find(r => r.id === id).promise,
        sendCommand: url => { const write = { url, ...deferred() }; writes.push(write); return write.promise; },
        requestDevelopSliderResetFeedback: (control, owner, beforeValue) => { control.resetRead = { owner, beforeValue }; }
    };
    vm.createContext(ctx);
    vm.runInContext([
        "developSliderConfirmationTolerance", "valuesMatchDevelopSlider", "clearDevelopSliderStepTimers",
        "cancelDevelopSliderStep", "cancelDevelopSliderThrottle", "developSliderSubmissionPending",
        "profileAmountSubmissionBlocked",
        "applyDevelopSliderFeedback", "applyDevelopSliderFeedbackIfChanged", "applyTargetedDevelopSliderFeedback",
        "submitDevelopSliderValue", "drainDevelopSliderSubmissions", "scheduleDevelopSliderValue", "flushDevelopSliderValue",
        "developSliderConfirmationOwnerMatches", "readDevelopSliderConfirmation",
        "handleDevelopSliderStepSubmission", "requestDevelopSliderStepFeedback", "beginDevelopSliderReset", "resetDevelopSlider"
    ].map(fn).join("\n"), ctx);
    function control(id) {
        return { definition: { id, label: id, min: -100, max: 100, numericStep: 1, displayPrecision: 0 },
            row: { isConnected: true }, range: {}, number: {}, increment: {}, decrement: {}, reset: {},
            localValue: 0, authoritativeValue: 0, desiredValue: null, pendingValue: null, pendingKind: null,
            lastSubmittedValue: null, throttleTimer: null, stepDebounceTimer: null, stepConfirmationTimer: null };
    }
    function edit(c, value) { c.localValue = value; ctx.flushDevelopSliderValue(c, value, "range"); }
    function feedback(c, value, id = ++serial) { ctx.applyDevelopSliderFeedbackIfChanged(c, { available: true, value, id }); }
    function deliver(read, c, value) { read.resolve({ snapshot: { results: { [c.definition.id]: { available: true, value } } } }); }
    return { ctx, control, edit, feedback, deliver, reads, writes, timers, binding, errors };
}
async function staleConfirmation() {
    for (const pair of [["Exposure", "Contrast"], ["SaturationAdjustmentGreen", "SaturationAdjustmentAqua"], ["PostCropVignetteAmount", "GrainAmount"]]) {
        const f = fixture(), a = f.control(pair[0]), b = f.control(pair[1]);
        f.edit(a, 20); f.writes[0].resolve(true); await tick();
        const oldExpiry = f.ctx.requestDevelopSliderStepFeedback(a, true); await tick();
        const oldRead = f.reads.at(-1);
        f.edit(a, 35); f.edit(b, 17);
        f.writes[1].resolve(true); f.writes[2].resolve(true); await tick();
        // A later polling request can still sample pre-edit values. IDs alone cannot confirm an edit.
        f.feedback(a, 0); f.feedback(b, 4);
        assert.deepEqual([a.localValue, b.localValue], [35, 17]);
        f.deliver(oldRead, a, 0); await oldExpiry;
        // Old expiry must not turn a NEWER pre-edit poll into permission to roll the thumb back.
        f.feedback(a, 20);
        assert.equal(a.localValue, 35, "an older confirmation timeout cannot expire a newer edit");
        assert.equal(a.confirmationPending, true);
        f.feedback(a, 35); f.feedback(b, 17);
        assert.equal(a.confirmationPending, false); assert.equal(b.confirmationPending, false);
        f.feedback(a, 36); assert.equal(a.localValue, 36, "ordinary Lightroom changes resume after confirmation");
        assert.equal(f.writes.length, 3, "feedback never resends or invents an edit");
        assert.deepEqual(f.errors, []);
    }
}
async function resetOrdering() {
    const f = fixture(), c = f.control("Contrast");
    f.ctx.scheduleDevelopSliderValue(c, 31);
    f.ctx.beginDevelopSliderReset(c);
    assert.equal(c.throttleTimer, null, "Reset must cancel the unsent drag timer");
    assert.equal(c.pendingValue, null, "Reset must discard the older unsent drag value");
    f.edit(c, 20);
    f.ctx.scheduleDevelopSliderValue(c, 30);
    f.ctx.resetDevelopSlider(c);
    assert.equal(f.writes.length, 1, "Reset waits only for the already dispatched write admission");
    assert.equal(c.pendingValue, null);
    f.writes[0].resolve(true); await tick();
    assert.match(f.writes[1].url, /^\/api\/reset\?slider=Contrast/);
    f.edit(c, 40); // A newer drag may follow Reset, but cannot overtake it.
    assert.equal(f.writes.length, 2);
    f.writes[1].resolve(true); await tick();
    assert.match(f.writes[2].url, /value=40/);
    f.writes[2].resolve(true); await tick(); f.feedback(c, 40);
    assert.deepEqual(f.writes.map(w => new URL(w.url, "http://fixture").pathname), ["/api/set", "/api/reset", "/api/set"]);
    assert(!f.writes.some(w => /value=30/.test(w.url)), "an older queued drag cannot overwrite Reset");
    f.ctx.resetDevelopSlider(c); f.ctx.resetDevelopSlider(c);
    f.writes[3].resolve(true); await tick(); f.writes[4].resolve(true); await tick();
    assert.equal(f.writes.length, 5, "repeated explicit Reset clicks remain commands");
    assert(c.resetRead, "only the current Reset owns confirmation demand");
}
async function guards() {
    const f = fixture(), c = f.control("GrainAmount");
    f.edit(c, 20); f.edit(c, 0);
    f.feedback(c, 0);
    assert.equal(c.confirmationPending, true, "matching old feedback cannot confirm a value still queued behind an older edit");
    f.writes[0].resolve(true); await tick();
    assert.equal(f.writes.length, 2);
    f.writes[1].resolve(true); await tick(); f.feedback(c, 0);
    assert.equal(c.confirmationPending, false);
    f.edit(c, 25); f.ctx.resetDevelopSlider(c);
    f.binding.selectedPhotoUuid = "another"; f.binding.contextCounter++;
    f.writes[2].resolve(true); await tick();
    assert.equal(f.writes.length, 3, "pending Reset cannot cross to another photo");
    const g = fixture(), d = g.control("Contrast");
    g.edit(d, 12); g.writes[0].resolve(true); await tick();
    const expiry = g.ctx.requestDevelopSliderStepFeedback(d, true); await tick();
    g.deliver(g.reads.at(-1), d, 9); await expiry;
    assert.equal(d.localValue, 9, "a current bounded confirmation still adopts genuine Lightroom disagreement");
    g.edit(d, 13); g.writes[1].resolve(false); await tick();
    assert.match(g.errors.at(-1), /rejected/);
    const p = fixture(), amount = p.control("ProfileAmount");
    Object.assign(amount, { profileAmountEnabled: true, feedbackState: "available", authoritativeValue: 75 });
    p.ctx.resetDevelopSlider(amount);
    assert.equal(p.writes.length, 1, "the current Profile Amount Reset must not block itself as a second pending edit");
    p.writes[0].resolve(true); await tick();
    assert.equal(amount.confirmationPending, true);
    p.feedback(amount, 100);
    assert.equal(amount.confirmationPending, false);
    amount.profileAmountEnabled = false;
    p.ctx.resetDevelopSlider(amount);
    assert.equal(p.writes.length, 1, "unavailable Profile Amount capability still blocks writes");
}
(async () => {
    if (process.argv.includes("--reset-only")) await resetOrdering();
    else { await staleConfirmation(); await resetOrdering(); await guards(); }
    console.log("Main slider intent/feedback and drag -> Reset ordering regressions passed (mock transport and SDK).");
})().catch(error => { console.error(error); process.exitCode = 1; });
