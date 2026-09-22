"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { createWindowsLightroomNativeBackend, unavailableNativeState } = require("../server/windows-lightroom-native");
const { createRemoveState } = require("../server/remove-state");
const active = { available: true, active: true, token: "1:2:3:4:5:6:7:8", canCancel: true, canRemove: true, sizeAvailable: true };
const preferences = { available: true, selectedTool: "dust", newSpotType: "heal_patchmatch", brushSize: 25, brushFeather: 50,
    useGenerativeAI: false, detectObjects: true, toolOverlay: "auto", visualizeSpots: false, visualizationThreshold: 50 };
async function run() {
    const children = [], sent = [];
    const backend = createWindowsLightroomNativeBackend({ platform: "win32", spawn() {
        const child = new EventEmitter(); child.pid = 100 + children.length;
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.stdin = new Writable({ write(chunk, _encoding, done) { sent.push({ ...JSON.parse(chunk), child }); done(); } });
        child.kill = () => { child.killed = true; child.emit("exit", null); }; children.push(child); return child;
    } });
    const reply = (index, result) => sent[index].child.stdout.write(JSON.stringify({ id: sent[index].id, ok: true, result }) + "\n");
    const until = async count => { for (let i = 0; sent.length < count && i < 100; i++) await new Promise(r => setTimeout(r, 2)); assert.equal(sent.length, count); };
    try {
        const profile = backend.readProfileSnapshot(), lens = backend.readState(), selection = backend.readRemoveSelection();
        assert.equal(children.length, 2);
        const actionPid = backend.getTransportDiagnostics().helperPid;
        backend.setSelectionObserverPaused(true);
        assert.equal((await selection).available, false, "A read started before pause cannot republish stale success");
        assert.equal(children[0].killed, undefined); assert.equal(children[1].killed, true);
        assert.equal(backend.getTransportDiagnostics().activeOperation, "readProfileSnapshot");
        assert.equal(backend.getTransportDiagnostics().queueDepth, 1);
        for (let i = 0; i < 5; i++) assert.match((await backend.readRemoveSelection()).reason, /temporarily paused/);
        assert.equal(sent.length, 2); assert.equal(children.length, 2, "Paused polling cannot recreate the observer");
        assert.equal(backend.getTransportDiagnostics().selectedObserver, undefined);
        const context = { activeModule: "develop", selectedPhotoUuid: "comparison-photo", contextCounter: 1, developCounter: 2, contextChangedAt: 3 };
        const state = createRemoveState({ getContext: () => context, nativeBackend: backend });
        state.get(true); const query = state.takeRequest(); assert.equal(state.acceptQuery({ ...query, ...preferences }), true);
        await state.refreshSelection();
        const s = state.get(false); assert.equal(s.available, true); assert.equal(s.selection.available, false);
        const command = state.admit("brushSize", 26, { ...context, serverEpoch: s.serverEpoch, stateRevision: s.revision, mode: s.newSpotType });
        assert.ok(command, "SDK Healing Size stays admissible while native observation is paused");
        assert.equal(state.matches(command, "admit"), true); assert.equal(state.matches(command, "dequeue"), true);
        assert.equal(state.acceptResult({ ...command, ...preferences, brushSize: 26, outcome: "confirmed", otherPreferencesPreserved: true }), true);
        reply(0, {}); await profile; await until(3); assert.equal(sent[2].operation, "readState");
        reply(2, unavailableNativeState()); await lens;
        backend.setSelectionObserverPaused(false);
        const restored = backend.readRemoveSelection(); await until(4); reply(3, active);
        assert.equal((await restored).active, true); assert.equal(children.length, 3);
        assert.equal(backend.getTransportDiagnostics().helperPid, actionPid, "Shared action helper survives both transitions");
        assert.equal(backend.getTransportDiagnostics().selectionObserverPaused, false);
        assert.ok(sent.filter(x => x.child !== children[0]).every(x => x.operation === "readRemoveSelection"));
    } finally { await backend.stop(); }
    console.log("Healing observer comparison: only reader stops, in-flight success invalidates, SDK Size continues, Profile/Lens queue survives, observer resumes read-only (simulated).");
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
