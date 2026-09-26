"use strict";
// Replay the captured HTTP/context race through production browser functions.
// This is a regression check, not a replacement for live touchscreen acceptance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const captured = require("./fixtures/touch-feedback-context-20260926.json");
const source = fs.readFileSync(process.env.LRBRIDGE_CONTROLLER_SOURCE ||
    path.join(__dirname, "../app/controller.html"), "utf8");
function fn(name) {
    const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
    assert(start >= 0, name);
    return source.slice(start, source.indexOf("\n        }", start) + 10);
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function response(status, body) {
    return { status, ok: status >= 200 && status < 300,
        json: async () => body, text: async () => JSON.stringify(body) };
}
function fixture(record, options = {}) {
    const binding = { generation: 1, ...record.browserContext };
    const errors = [], applied = [], requests = [], contextReads = [];
    const controls = Object.fromEntries(record.affected.map(item => [item.slider, {
        definition: { id: item.slider }, row: { isConnected: true }, number: { value: "" },
        authoritativeValue: item.authoritativeValue, feedbackState: item.feedbackState,
        confirmationPending: false, disabled: item.disabled
    }]));
    let reads = 0;
    const ctx = {
        AbortController, Date, Number, console: { error: (...args) => errors.push(args) },
        pendingDevelopSliderResetFeedback: new Map(), pruneDevelopSliderResetFeedback() {},
        genericFeedbackActive: true, genericFeedbackGeneration: 1, activeTab: "sliders",
        liveFeedbackSnapshotInFlight: false, pendingFullFeedbackSnapshot: false,
        genericFeedbackAbortController: null, controllerContextPollInFlight: null,
        developLoadingStatus: null, developSliderControls: controls,
        isTreatmentControllerTab: () => false, isGenericDevelopFeedbackTab: () => true,
        requestLensBlurState() {}, requestDevelopCategoricalState() {}, colorMixerView: "hsl",
        getVisibleFeedbackSliders: () => Object.keys(controls),
        developSliderFeedbackBinding: () => ({ ...binding }),
        connectedDevelopSliderControls: id => [controls[id]],
        isDevelopSliderInteracting: () => false, cancelDevelopSliderStep() {},
        notifyDevelopSliderPresentation() {},
        setDevelopSliderState: (control, state) => { control.feedbackState = state; },
        applyFeedbackSnapshot: snapshot => applied.push({ id: snapshot.id, binding: { ...binding } }),
        sleep: async () => { throw Error("Unexpected snapshot polling delay"); },
        readControllerContext: async () => {
            contextReads.push({ ...binding });
            if (options.contextFails) return false;
            Object.assign(binding, options.nextContext || record.nextContext);
            if (options.navigateGeneration) {
                ctx.genericFeedbackGeneration += 1;
                ctx.liveFeedbackSnapshotInFlight = false; // The view teardown owns this flag after navigation.
            }
            return true;
        },
        fetch: async url => {
            requests.push(url);
            if (url.startsWith("/api/feedback/request-many?")) {
                reads += 1;
                return response(200, { request: { id: record.requestId + reads - 1 } });
            }
            assert(url.startsWith("/api/feedback/snapshot?"), "feedback cannot write Lightroom settings");
            if (reads === 1 && !options.healthy) return response(options.status || record.status,
                options.body || record.body);
            return response(200, { snapshot: { id: record.requestId + reads - 1, complete: true, results: {} } });
        }
    };
    vm.createContext(ctx);
    vm.runInContext(["developSliderFeedbackBindingMatches", "pollFeedbackSnapshot", "logFeedbackSnapshotFailure",
        "markDevelopSliderError", "requestLiveFeedbackSnapshot", "pollControllerContext"].map(fn).join("\n"), ctx);
    return { ctx, binding, controls, errors, applied, requests, contextReads };
}
async function run(record, options) {
    const f = fixture(record, options);
    await f.ctx.requestLiveFeedbackSnapshot(false);
    for (let n = 0; n < 20 && f.ctx.liveFeedbackSnapshotInFlight; n++) await tick();
    assert.equal(f.ctx.liveFeedbackSnapshotInFlight, false);
    return f;
}
(async () => {
    for (const record of captured.cases) {
        const f = await run(record);
        assert.equal(f.errors.length, 0, "captured obsolete snapshot " + record.requestId + " is not a current feedback failure");
        assert.equal(f.contextReads.length, 1, "validate current context before classifying a missing snapshot");
        assert.equal(f.applied.length, 1, "obtain replacement feedback instead of applying the invalidated result");
        assert.equal(f.applied[0].id, record.requestId + 1);
        assert.equal(f.applied[0].binding.developCounter, record.nextContext.developCounter);
        assert.equal(f.requests.filter(url => url.includes("request-many")).length, 2);
        assert(Object.values(f.controls).every(c => c.feedbackState === "unavailable"),
            "an obsolete read must not replace authoritative unavailability with Feedback error");
    }
    const record = captured.cases[0];
    for (const options of [
        { nextContext: record.browserContext }, { contextFails: true },
        { status: 503, body: { error: "SDK disconnected" } },
        { status: 404, body: { error: "Different error" } }
    ]) {
        const f = await run(record, options);
        assert.equal(f.errors.length, 1, "current-context, unverified and other errors remain visible");
        assert.equal(f.applied.length, 0);
        assert.equal(f.requests.filter(url => url.includes("request-many")).length, 1, "no automatic retry for a genuine failure");
        assert(Object.values(f.controls).every(c => c.feedbackState === "error"));
    }
    for (const changed of [{ selectedPhotoUuid: "other-photo" }, { activeModule: "library" }, { contextCounter: 3 }]) {
        const f = await run(record, { nextContext: { ...record.browserContext, ...changed } });
        assert.equal(f.errors.length, 0);
        assert.equal(f.applied[0].id, record.requestId + 1, "never apply another photo/module/context's obsolete snapshot");
    }
    const navigation = await run(record, { navigateGeneration: true });
    assert.equal(navigation.errors.length, 0);
    assert.equal(navigation.applied.length, 0, "obsolete view cannot apply or restart its read");
    const healthy = await run(record, { healthy: true });
    assert.equal(healthy.contextReads.length, 0, "healthy polling does not acquire an extra context read");
    assert.equal(healthy.applied.length, 1);

    const pending = fixture(record);
    let resolveOld;
    pending.ctx.controllerContextPollInFlight = new Promise(resolve => { resolveOld = resolve; });
    const old = pending.ctx.controllerContextPollInFlight;
    old.finally(() => { pending.ctx.controllerContextPollInFlight = null; });
    const fresh = pending.ctx.pollControllerContext(true);
    assert.equal(pending.contextReads.length, 0);
    resolveOld(true);
    await fresh;
    assert.equal(pending.contextReads.length, 1, "a context request predating the failure is insufficient");

    for (const [status, body] of [[503, { ok: false }], [200, { ok: false }]]) {
        let classifications = 0;
        const invalid = { fetch: async () => response(status, body), heartbeatWasStale: false, updateHistoryButtons() {},
            lastControllerContextCounter: 2, lastControllerContextChangedAt: 1, lastControllerDevelopCounter: 65,
            lastControllerActiveModule: "develop", lastControllerSelectedPhotoKey: "captured-photo",
            lastControllerSelectedPhotoUuid: "captured-photo", lastControllerHeartbeatAt: 1,
            classifyControllerContextChange() { classifications += 1; throw Error("Invalid response reached context classification"); } };
        vm.createContext(invalid);
        vm.runInContext(fn("readControllerContext"), invalid);
        assert.equal(await invalid.readControllerContext(), false, "failed context responses cannot validate feedback ownership");
        assert.equal(classifications, 0, "failed context responses cannot be treated as navigation");
    }
    console.log("Captured touchscreen snapshot/context races and genuine-error, fresh-read, navigation and healthy-poll guards passed (automated replay).");
})().catch(error => { console.error(error); process.exitCode = 1; });
