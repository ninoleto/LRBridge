"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const definition = require("../server/remove-state");
const commands = require("../server/commands");
const { runtime } = require("./masking-create");
const { createBridge } = require("../server/bridge");
const contextModule = require("../server/context");
const windowsNative = require("../server/windows-lightroom-native");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const token = "1:2:3:4:5:6:7:8";
const active = () => ({ available: true, active: true, token, canCancel: true, canRemove: true, sizeAvailable: true });
const preferences = { available: true, selectedTool: "dust", newSpotType: "heal_patchmatch", brushSize: 25, brushFeather: 50,
    useGenerativeAI: true, detectObjects: false, toolOverlay: "selected", visualizeSpots: true, visualizationThreshold: 37,
    repair: { available: true, selected: false, count: 0 } };
async function fixture() {
    let time = 1000, nativeState = active(), sent = 0, hold = null;
    const context = { activeModule: "develop", selectedPhotoUuid: "creation-photo", contextCounter: 1, developCounter: 2, contextChangedAt: 3 };
    const state = definition.createRemoveState({ now: () => time, getContext: () => ({ ...context }), serverEpoch: "selected-test",
        nativeBackend: { readRemoveSelection: async () => { if (nativeState instanceof Error) throw nativeState; return hold ? await hold.promise : nativeState; },
            actRemoveSelection: async (action, identity, url) => { assert.ok(["cancel", "remove"].includes(action)); assert.equal(identity, token);
                assert.equal(new URL(url).pathname, "/remove/selection-validate"); sent++; return { sent: true }; } } });
    state.get(true); const query = state.takeRequest(); assert.ok(query);
    assert.equal(state.acceptQuery({ ...query, ...preferences }), true);
    await state.refreshSelection();
    const client = () => { const s = state.get(false); return { ...context, serverEpoch: s.serverEpoch, stateRevision: s.revision,
        mode: s.newSpotType, selectionToken: s.selection.token }; };
    const admit = value => state.admit("selectedSelection", value, client());
    const dequeue = command => { assert.equal(commands.validateCommand(command), true); assert.equal(state.matches(command, "admit"), true);
        assert.equal(state.matches(command, "dequeue"), true); assert.equal(state.matches(command, "dequeue"), false); };
    return { state, context, client, admit, dequeue, sent: () => sent, setNative: next => { nativeState = next; },
        advance: ms => { time += ms; }, hold() { let resolve; const promise = new Promise(r => { resolve = r; }); hold = { promise, resolve }; return hold; } };
}
function parseResult(url) {
    const out = {};
    for (const [k, value] of new URL(url).searchParams) {
        out[k] = ["repair", "dust"].includes(k) ? JSON.parse(value) : value === "true" ? true : value === "false" ? false :
            value === "null" ? null : /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
    }
    return out;
}
async function luaScenario(action, scenario) {
    const f = await fixture(), command = f.admit(action); assert.ok(command); f.dequeue(command);
    const sdk = runtime();
    try {
        sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
        sdk.run(fs.readFileSync(path.join(__dirname, "remove-selection.lua"), "utf8"));
        sdk.set("selectionAction", action); sdk.set("selectionScenario", scenario); sdk.set("commandJson", JSON.stringify(command));
        sdk.run("removeExecute()");
        const result = parseResult(sdk.result());
        const before = ["inactive-before", "missing-before", "token-before"].includes(scenario);
        sdk.run("assert(selectionInvokes == " + (before ? 0 : 1) + ")");
        const expected = before || ["photo-after", "tool-after"].includes(scenario) ? "stale" : scenario === "ordinary" ? "confirmed" : "unknown";
        assert.equal(result.outcome, expected, action + "/" + scenario + ": " + result.detail);
        if (!before) { assert.equal(await f.state.invokeSelection(command), true); assert.equal(await f.state.invokeSelection(command), false); }
        f.setNative({ ...active(), active: false }); await f.state.refreshSelection();
        assert.equal(f.state.acceptResult(result), true, scenario);
        assert.equal(f.state.get(false).lastResult.outcome, expected);
        assert.equal(f.state.get(false).pendingOperation, null);
        assert.equal(f.state.acceptResult(result), false, "Late completion cannot settle twice");
    } finally { sdk.close(); }
}
async function httpScenario(action, changePhoto = false) {
    const originalLog = console.log; console.log = () => {};
    commands.resetQueueForTests();
    let nativeState = active(), sends = 0, holdRead = false, releaseRead;
    const backend = { ...windowsNative.createUnavailableWindowsBackend("fixture"),
        readRemoveSelection: async () => holdRead ? await new Promise(resolve => { releaseRead = resolve; }) : nativeState,
        actRemoveSelection: async () => { sends++; nativeState = { ...active(), active: false }; return { sent: true }; } };
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20, windowsNativeBackend: backend });
    const sdk = runtime();
    try {
        await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const get = async (suffix, status = 200) => { const res = await fetch(base + suffix); assert.equal(res.status, status, suffix); return res.json(); };
        contextModule.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: action + changePhoto });
        sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
        sdk.run(fs.readFileSync(path.join(__dirname, "remove-selection.lua"), "utf8"));
        await get("/remove/state"); const query = await get("/remove/next");
        sdk.set("queryJson", JSON.stringify(query)); sdk.run("removeQuery()");
        let result = new URL(sdk.result()); await get(result.pathname + result.search);
        let s;
        for (let i = 0; i < 30; i++) { s = await get("/remove/state"); if (s.selection.available) break; await new Promise(resolve => setTimeout(resolve, 50)); }
        assert.equal(s.selection.active, true);
        const binding = Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, s[k]]));
        const request = new URLSearchParams({ ...binding, stateRevision: s.revision, mode: s.newSpotType,
            selectionToken: s.selection.token, field: "selectedSelection", value: action });
        const route = "/remove/selection?" + request;
        await get(route + "&extra=x", 400);
        await get("/remove/brush?" + request, 400);
        await get(route); await get(route, 409);
        if (changePhoto) {
            contextModule.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "changed" });
            assert.equal(commands.getNextCommand(), null); assert.equal(sends, 0); return;
        }
        const c = commands.getNextCommand(); assert.equal(c.command, "remove.selection.action");
        assert.equal(commands.getNextCommand(), null); assert.equal(commands.tryEnqueueCommand(c).accepted, false);
        const envelope = new URLSearchParams({ operationId: c.operationId });
        for (const k of definition.bindingFields) envelope.set(k, c[k]);
        assert.equal((await get("/remove/selection-native?action=invoke&" + envelope)).sent, true);
        assert.equal((await get("/remove/selection-native?action=invoke&" + envelope)).sent, false); assert.equal(sends, 1);
        sdk.set("selectionAction", action); sdk.set("selectionScenario", "ordinary"); sdk.set("commandJson", JSON.stringify(c)); sdk.run("removeExecute()");
        result = new URL(sdk.result()); await get(result.pathname + result.search); await get(result.pathname + result.search, 409);
        s = await get("/remove/state"); assert.equal(s.lastResult.outcome, "confirmed"); assert.equal(s.pendingOperation, null);
        // A slow Windows read cannot hold /remove/state (including Dust feedback) open.
        holdRead = true; await new Promise(resolve => setTimeout(resolve, 800));
        const before = Date.now(); await get("/remove/state");
        assert.ok(Date.now() - before < 500, "SDK state response must not wait for native discovery");
        await Promise.resolve(); if (releaseRead) releaseRead(nativeState);
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = originalLog; }
}
async function nativeQueue() {
    const children = [], sent = [];
    const backend = windowsNative.createWindowsLightroomNativeBackend({ platform: "win32", spawn() {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.stdin = new Writable({ write(chunk, _encoding, done) { sent.push({ ...JSON.parse(chunk), child }); done(); } });
        child.kill = () => { child.killed = true; child.emit("exit", null); }; children.push(child); return child;
    } });
    const reply = (i, result) => sent[i].child.stdout.write(JSON.stringify({ id: sent[i].id, ok: true, result }) + "\n");
    const until = async count => { for (let i = 0; sent.length < count && i < 100; i++) await new Promise(r => setTimeout(r, 2)); assert.equal(sent.length, count); };
    try {
        const profile = backend.readProfileSnapshot(), lens = backend.readState(), selected = backend.readRemoveSelection();
        const queued = backend.readRemoveSelection(), shared = backend.readRemoveSelection(), label = backend.readProfileLabel();
        assert.equal(children.length, 2, "One bounded read-only observer is separate from the action helper");
        assert.equal(backend.getTransportDiagnostics().queueDepth, 2);
        assert.equal(backend.getTransportDiagnostics().selectedObserver.queueDepth, 1);
        assert.equal(sent[1].operation, "readRemoveSelection"); reply(1, active());
        assert.equal((await selected).active, true); await until(3); reply(2, active());
        const result = await queued; assert.equal(result.active, true); assert.ok(result.readTiming.executionMs >= 0);
        assert.deepEqual(await shared, result, "Only undispatched Selected reads coalesce");
        assert.equal(backend.getTransportDiagnostics().activeOperation, "readProfileSnapshot", "Selected reads finish while Profile is still busy");
        reply(0, {}); await profile; await until(4); assert.equal(sent[3].operation, "readState");
        reply(3, windowsNative.unavailableNativeState()); await lens; await until(5);
        assert.equal(sent[4].operation, "readProfileLabel"); reply(4, {}); await label;
        const heldProfile = backend.readProfileSnapshot(); await until(6);
        const refinement = backend.actRemoveSelectionRefinement("add", token + ":12:13", "http://127.0.0.1:17891/remove/selection-validate?operationId=test");
        const independent = backend.readRemoveSelection(); await until(7);
        assert.equal(sent[6].operation, "readRemoveSelection"); reply(6, active()); await independent;
        assert.equal(backend.getTransportDiagnostics().activeOperation, "readProfileSnapshot");
        reply(5, {}); await heldProfile; await until(8);
        assert.equal(sent[7].operation, "actRemoveSelectionRefinement"); assert.equal(sent[7].child, sent[0].child, "Add uses the existing shared action helper");
        reply(7, { sent: true, modeConfirmed: false }); assert.equal((await refinement).sent, true);
        assert.equal(children.length, 2, "No third helper or native writer is introduced");
        const observer = windowsNative.createWindowsLightroomNativeBackend({ platform: "win32", spawn() { throw Error("Observer must reject before dispatch"); } }, true);
        assert.throws(() => observer.actRemoveSelectionRefinement("add", token + ":12:13", "http://127.0.0.1:17891/remove/selection-validate?operationId=test"), /only permits reads/);
        await observer.stop();
    } finally { await backend.stop(); assert.ok(children.every(child => child.killed), "Both helpers stop"); }
}
async function run() {
    for (const action of ["cancel", "remove"]) for (const scenario of ["ordinary", "inactive-before", "missing-before", "token-before",
        "photo-after", "tool-after", "preferences-after", "still-active", "missing-after", "token-after", "dispatch-error", "unsent"])
        await luaScenario(action, scenario);
    await luaScenario("cancel", "cancel-changed"); await luaScenario("remove", "unchanged"); await luaScenario("remove", "not-ready");
    for (const action of ["cancel", "remove"]) for (const scenario of ["guard-photo", "guard-tool", "guard-mode"])
        await luaScenario(action, scenario);
    for (const nativeState of [{ available: false }, { ...active(), active: false }, { ...active(), token: "bad" },
        { ...active(), canCancel: false, canRemove: false }]) {
        const f = await fixture(); f.setNative(nativeState); await f.state.refreshSelection(); assert.equal(f.admit("cancel"), null); assert.equal(f.admit("remove"), null);
    }
    {
        const f = await fixture(); f.advance(2600); assert.equal(f.admit("remove"), null, "Stale selection feedback fails closed");
        await f.state.refreshSelection(); const c = f.admit("remove"); assert.ok(c); f.dequeue(c);
        assert.equal(f.admit("remove"), null, "Duplicate submission has no second owner");
        assert.equal(await f.state.invokeSelection(c), true); assert.equal(await f.state.invokeSelection(c), false); assert.equal(f.sent(), 1);
        f.context.selectedPhotoUuid = "other-photo"; assert.equal(await f.state.invokeSelection(c), false); assert.equal(f.state.get(false).pendingOperation, null);
    }
    {
        const f = await fixture(); const size = f.state.admit("brushSize", 42, f.client()); assert.ok(size); f.dequeue(size);
        for (let i = 0; i < 8; i++) {
            f.advance(850); await f.state.refreshSelection(false);
            assert.equal(f.state.get(false).selection.ageMs, 0, "Native availability refreshes throughout a pending SDK Size operation");
        }
        f.setNative(new Error("Selected observer timed out")); f.advance(850); await f.state.refreshSelection(false);
        let s = f.state.get(false); assert.equal(s.selection.available, false);
        assert.equal(s.selection.reason, "Selected observer timed out"); assert.equal(s.selection.read.failure, s.selection.reason);
        f.setNative(active()); f.advance(850); await f.state.refreshSelection(false);
        assert.equal(f.state.get(false).selection.available, true, "A fresh read, not cached success, recovers availability");
        assert.equal(f.state.acceptResult({ ...size, ...preferences, brushSize: 42, outcome: "confirmed", otherPreferencesPreserved: true }), true);
        s = f.state.get(false); assert.equal(s.pendingOperation, null); assert.equal(s.lastResult.outcome, "confirmed");
    }
    {
        const f = await fixture(); const hold = f.hold(); const poll = f.state.refreshSelection(); await Promise.resolve();
        f.context.developCounter++; f.state.sync(); hold.resolve(active()); await poll;
        assert.equal(f.state.get(false).selection.available, false, "Old native read cannot populate the next Develop context");
    }
    {
        const f = await fixture(); const c = f.admit("remove"); f.dequeue(c); f.advance(120001);
        assert.equal(f.state.get(false).pendingOperation, null, "Expiry releases the operation without retry");
        assert.equal(await f.state.invokeSelection(c), false); assert.equal(f.sent(), 0);
    }
    for (const valid of [false, true]) {
        const f = await fixture(), c = f.admit("remove"); f.dequeue(c);
        assert.equal(await f.state.challengeSelection(c), false, "No challenge before a native invocation owns the operation");
        await f.state.invokeSelection(c);
        const challenge = f.state.challengeSelection(c);
        assert.equal(f.state.selectionGuard(c, "poll", null), true);
        assert.equal(f.state.selectionGuard(c, "confirm", valid), true);
        assert.equal(await challenge, valid, "Only a fresh affirmative SDK sample permits the native click");
        assert.equal(f.state.selectionGuard(c, "confirm", true), false, "A guard response cannot be reused");
    }
    {
        const f = await fixture(), c = f.admit("remove"); f.dequeue(c); await f.state.invokeSelection(c);
        const challenge = f.state.challengeSelection(c);
        f.context.selectedPhotoUuid = "photo-during-native-wait"; f.state.sync();
        assert.equal(await challenge, false, "Photo change revokes an unanswered native challenge");
    }
    {
        const f = await fixture(), c = f.admit("remove"); f.dequeue(c); await f.state.invokeSelection(c);
        f.state.reject(c, "uncertain native result"); await f.state.refreshSelection();
        assert.equal(f.admit("remove"), null, "Same active selection cannot be resubmitted after uncertainty");
        f.setNative({ ...active(), active: false }); await f.state.refreshSelection();
        f.setNative(active()); await f.state.refreshSelection(); assert.ok(f.admit("remove"), "New selection becomes available after an observed inactive transition");
    }
    await httpScenario("cancel"); await httpScenario("remove"); await httpScenario("remove", true); await nativeQueue();
    console.log("Remove Selected: 33 production-Lua scenarios plus HTTP/queue, live SDK challenge, independent observer/shared action queue, Size availability, read failures, duplicate dispatch, late-context and expiry checks passed (simulated).");
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
