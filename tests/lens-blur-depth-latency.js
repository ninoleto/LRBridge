"use strict";
// Production transport and Controller handlers; delayed native replies are fixtures.
// The native before/after timings are separate evidence, not inferred from this test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const native = require(process.env.LRBRIDGE_NATIVE_SOURCE || "../server/windows-lightroom-native");
const lens = require("../app/controller-lens-blur");
const turn = () => new Promise(resolve => setImmediate(resolve));

async function transport() {
    const children = [], sent = [], pending = [];
    const keep = promise => { pending.push(promise); promise.catch(() => {}); return promise; };
    const backend = native.createWindowsLightroomNativeBackend({ platform: "win32", spawn() {
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
        child.stdin = new Writable({ write(chunk, _, done) { sent.push({ child, ...JSON.parse(chunk) }); done(); } });
        child.kill = () => { child.killed = true; child.emit("exit", null); };
        children.push(child); return child;
    } });
    const reply = (message, result, error) => message.child.stdout.write(JSON.stringify({
        id: message.id, ok: !error, result, error, unavailable: Boolean(error)
    }) + "\n");
    try {
        const profile = keep(backend.readProfileSnapshot());
        const full = keep(backend.readState());
        const write = keep(backend.setCheckbox("autoMask", true));
        const depth = keep(backend.readDepthVisualization());
        await turn();
        const job = sent.find(m => m.operation === "readDepthVisualization");
        assert(job, "Depth admission must dispatch while the captured slow Profile/full-state work is outstanding");
        assert.notEqual(job.child, sent[0].child, "Depth reads must not occupy or interrupt the native action queue");
        reply(job, { available: true, value: false });
        assert.equal((await depth).value, false);
        assert.equal(sent.filter(m => m.operation === "setCheckbox").length, 0, "Native writes retain their existing ordering");
        const confirmation = keep(backend.readDepthVisualization());
        await turn();
        const confirmed = sent.filter(m => m.operation === "readDepthVisualization").at(-1);
        assert.notEqual(confirmed.id, job.id, "Confirmation must obtain a new checkbox reading");
        reply(confirmed, { available: true, value: true });
        assert.equal((await confirmation).value, true);
        const failed = keep(backend.readDepthVisualization()); await turn();
        reply(sent.at(-1), null, "Checkbox owner changed");
        await assert.rejects(failed, /owner changed/);
        reply(sent[0], {}); await profile;
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(sent.at(-1).operation, "setCheckbox"); reply(sent.at(-1), native.unavailableNativeState()); await write;
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(sent.at(-1).operation, "readState"); reply(sent.at(-1), native.unavailableNativeState()); await full;
        backend.setSharedReadPauseUntil(Date.now() + 1000);
        await assert.rejects(backend.readDepthVisualization(), /paused/, "Diagnostic pause still covers the focused reader");
        backend.setSharedReadPauseUntil(null);
    } finally {
        await backend.stop(); await Promise.allSettled(pending);
        assert(children.every(c => c.killed), "Stopping the app must stop every reader");
    }
    for (const mode of ["selected", "depth"]) {
        const observer = native.createWindowsLightroomNativeBackend({ platform: "win32",
            spawn() { throw Error("Read-only guard must reject before dispatch"); }
        }, mode === "selected", mode === "depth");
        await assert.rejects(observer.setCheckbox("autoMask", true), /only permits/);
        await observer.stop();
    }
}

function controllerFixture() {
    const source = fs.readFileSync(process.env.LRBRIDGE_CONTROLLER_SOURCE || path.join(__dirname, "../app/controller.html"), "utf8");
    const names = ["lensBlurVisualizeBindingFromCurrentContext", "lensBlurVisualizeBindingMatches",
        "lensBlurResponseContextMatchesCurrent", "clearLensBlurVisualizePending", "observeLensBlurVisualizeFeedback",
        "setLensBlurVisualizeDepth", "requestLensBlurState"];
    const functions = names.map(name => {
        const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
        assert(start >= 0, name); return source.slice(start, source.indexOf("\n        }", start) + 10);
    }).join("\n");
    const model = lens.createModel();
    const state = value => ({ ...model.get(), available: true, windowsNative: {
        ...model.get().windowsNative, available: true, visualizeDepth: { available: true, value }
    } });
    model.applyAuthoritative(state(false));
    const requests = [], messages = [], timers = new Map(); let timer = 0;
    const c = vm.createContext({ lensBlurHelper: lens, lensBlurModel: model, activeTab: "sliders",
        lastControllerActiveModule: "develop", lastControllerSelectedPhotoUuid: "photo-a",
        lastControllerContextCounter: 1, lastControllerDevelopCounter: 2,
        lensBlurVisualizePending: null, lensBlurStateRequestInFlight: false, lensBlurDepthRequestInFlight: false,
        lensBlurDepthReadSerial: 0, lensBlurDepthFeedbackFloor: 0, lensBlurBokehFeedbackFloor: null,
        lensBlurStateRevision: 1, lensBlurFocalRangeCommitId: null, LENS_BLUR_VISUALIZE_CONFIRMATION_TIMEOUT_MS: 7000,
        setStatus: message => messages.push(message), updateLensBlurPresentation() {},
        setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id),
        fetch: url => new Promise(resolve => requests.push({ url, resolve }))
    });
    vm.runInContext(functions, c);
    const context = () => ({ activeModule: c.lastControllerActiveModule, selectedPhotoUuid: c.lastControllerSelectedPhotoUuid,
        contextCounter: c.lastControllerContextCounter, developCounter: c.lastControllerDevelopCounter });
    const answer = (request, body, ok = true) => { assert(request, "Expected request"); request.resolve({ ok, json: async () => body }); };
    const feedback = (request, value, extra = {}) => answer(request, { state: state(value), context: context(), revision: 1,
        depthOnly: request.url.includes("depthOnly"), ...extra });
    return { c, model, requests, messages, timers, answer, feedback, context };
}

async function controller() {
    const f = controllerFixture(), { c, requests, model, feedback, answer } = f;
    const oldFull = c.requestLensBlurState();
    const action = c.setLensBlurVisualizeDepth(true);
    assert.equal(model.get().windowsNative.visualizeDepth.value, false, "A request is not confirmation");
    answer(requests[1], { ok: true, changed: true, windowsNative: { visualizeDepth: { available: true, value: false } } });
    await action;
    assert.equal(requests.length, 3, "Depth confirmation must start without waiting for the captured slow full-state read");
    assert.match(requests[2].url, /depthOnly=true/);
    feedback(requests[2], true); await turn();
    assert.equal(c.lensBlurVisualizePending, null);
    assert.equal(model.get().windowsNative.visualizeDepth.value, true);
    feedback(requests[0], false); await oldFull;
    assert.equal(model.get().windowsNative.visualizeDepth.value, true, "Late pre-command full feedback cannot undo confirmed On");
    const external = c.requestLensBlurState(); feedback(requests.at(-1), false); await external;
    assert.equal(model.get().windowsNative.visualizeDepth.value, false, "New external Lightroom changes are still accepted");

    const second = c.setLensBlurVisualizeDepth(true);
    answer(requests.at(-1), { ok: true, changed: true, windowsNative: { visualizeDepth: { available: true, value: false } } }); await second;
    const pendingRead = requests.at(-1), oldContext = f.context();
    c.lastControllerSelectedPhotoUuid = "photo-b"; c.lastControllerContextCounter++;
    feedback(pendingRead, true, { context: oldContext }); await turn();
    assert.equal(c.lensBlurVisualizePending, null);
    assert(f.messages.some(m => /ERROR:.*context changed/.test(m)));
    assert.equal(model.get().windowsNative.visualizeDepth.value, false, "Old-photo confirmation must not apply");

    const failure = c.setLensBlurVisualizeDepth(true);
    answer(requests.at(-1), { ok: false, error: "Native helper unavailable" }, false); await failure;
    assert(f.messages.some(m => /ERROR: Native helper unavailable/.test(m)));
    assert.equal(model.get().windowsNative.visualizeDepth.value, false);
    const count = requests.filter(r => r.url.includes("visualize-depth?")).length;
    feedback(requests.at(-1), false); await turn();
    assert.equal(requests.filter(r => r.url.includes("visualize-depth?")).length, count, "No retry of an uncertain action");

    const noConfirm = c.setLensBlurVisualizeDepth(true);
    answer(requests.at(-1), { ok: true, changed: true, windowsNative: { visualizeDepth: { available: true, value: false } } }); await noConfirm;
    feedback(requests.at(-1), false); await turn();
    assert(c.lensBlurVisualizePending, "Unchanged checkbox must not confirm a requested toggle");
    [...f.timers.values()].at(-1)();
    assert(f.messages.some(m => /ERROR: Lightroom did not confirm Visualize Depth/.test(m)));

    for (const olderFails of [true, false]) {
        const g = controllerFixture();
        const full = g.c.requestLensBlurState();
        const edit = g.c.setLensBlurVisualizeDepth(true);
        g.answer(g.requests[1], { ok: true, changed: true, windowsNative: { visualizeDepth: { available: true, value: false } } }); await edit;
        if (olderFails) g.answer(g.requests[0], { error: "Full discovery failed" }, false);
        else g.answer(g.requests[0], { context: g.context(), revision: 1, state: { windowsNative: { available: false } } });
        await full;
        g.feedback(g.requests[2], true); await turn();
        assert.equal(g.model.get().windowsNative.visualizeDepth.value, true,
            "A fresh independent checkbox read must confirm even after full discovery became unavailable");
        assert.equal(g.c.lensBlurVisualizePending, null);
        assert.equal(g.model.get().windowsNative.brush.size.available, false, "Unrelated failed controls remain unavailable");
    }
}

const tests = { transport, controller };
(async () => {
    for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(tests)) { await tests[name](); console.log("PASS Visualize Depth " + name + " (simulated)"); }
})().catch(error => { console.error(error); process.exitCode = 1; });
