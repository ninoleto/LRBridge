"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { createWindowsLightroomNativeBackend } = require("../server/windows-lightroom-native");
const { createRemoveState } = require("../server/remove-state");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const active = { available: true, active: true, token: "1:2:3:4:5:6:7:8", canCancel: true, canRemove: true, sizeAvailable: true };
const preferences = { available: true, selectedTool: "dust", newSpotType: "heal_patchmatch", brushSize: 25, brushFeather: 50,
    useGenerativeAI: false, detectObjects: true, toolOverlay: "auto", visualizeSpots: false, visualizationThreshold: 50 };

async function run() {
    const children = [], writes = [], timers = new Set(); let readFailure = false;
    const backend = createWindowsLightroomNativeBackend({ platform: "win32", spawn() {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => child.emit("exit", null); children.push(child);
        child.stdin = new Writable({ write(chunk, _encoding, done) {
            const command = JSON.parse(chunk); writes.push({ child, ...command });
            // Measured slow Profile discovery, Lens read and a conservative Selected read.
            const ms = command.operation === "readProfileLabel" ? 3800 : command.operation === "readState" ? 900 : 180;
            const timer = setTimeout(() => {
                timers.delete(timer);
                child.stdout.write(JSON.stringify({ id: command.id, ok: !readFailure || command.operation !== "readRemoveSelection",
                    unavailable: true, error: "Selected read failed", result: command.operation === "readRemoveSelection" ? active : {} }) + "\n");
            }, ms); timers.add(timer); done();
        } }); return child;
    } });
    const context = { activeModule: "develop", selectedPhotoUuid: "polling-photo", contextCounter: 1, developCounter: 2, contextChangedAt: 3 };
    const state = createRemoveState({ getContext: () => context, nativeBackend: backend });
    const sdkQuery = () => { state.get(true); const q = state.takeRequest(); if (q) assert.equal(state.acceptQuery({ ...q, ...preferences }), true); };
    const client = () => { const s = state.get(false); return { ...context, serverEpoch: s.serverEpoch, stateRevision: s.revision, mode: s.newSpotType }; };
    let size = null, sizeAt = 0, samples = 0, sizeWrites = 0, maxAge = 0;
    const traffic = [];
    try {
        sdkQuery(); await state.refreshSelection();
        const began = Date.now(); let profileAt = 0, lensAt = 0;
        while (Date.now() - began < 10000) {
            const time = Date.now();
            if (time - profileAt > 4600) { profileAt = time; traffic.push(backend.readProfileLabel()); }
            if (time - lensAt > 2400) { lensAt = time; traffic.push(backend.readState()); }
            if (size && time - sizeAt >= 1500) {
                preferences.brushSize = size.value;
                assert.equal(state.acceptResult({ ...size, ...preferences, outcome: "confirmed", otherPreferencesPreserved: true }), true);
                size = null;
            }
            sdkQuery();
            if (!size) {
                size = state.admit("brushSize", preferences.brushSize + 1, client()); assert.ok(size);
                assert.equal(state.matches(size, "admit"), true); assert.equal(state.matches(size, "dequeue"), true);
                sizeAt = time; sizeWrites++;
            }
            const s = state.get(false); maxAge = Math.max(maxAge, s.selection.ageMs); samples++;
            assert.equal(s.selection.available, true); assert.ok(s.selection.ageMs < 2500, "Selection stays fresh during Size and slow shared-queue traffic");
            assert.equal(s.selection.token, active.token); assert.equal(s.selection.canCancel && s.selection.canRemove && s.selection.sizeAvailable, true);
            state.refreshSelection(false);
            await delay([300, 650, 450, 800][samples % 4]);
        }
        await state.refreshSelection();
        const revision = state.get(false).revision;
        await state.refreshSelection(); assert.equal(state.get(false).revision, revision, "Timing diagnostics do not invalidate editing baselines");
        readFailure = true; await state.refreshSelection();
        const failed = state.get(false).selection;
        assert.equal(failed.available, false); assert.match(failed.reason, /Selected read failed/);
        assert.match(failed.read.failure, /Selected read failed/); assert.ok(failed.read.executionMs >= 0);
        readFailure = false; await state.refreshSelection(); assert.equal(state.get(false).selection.available, true);
        const reading = state.refreshSelection(); context.contextCounter++; state.sync(); await reading;
        assert.equal(state.get(false).selection.available, false, "A read started in the previous photo context is discarded");
        assert.equal(children.length, 2); assert.ok(sizeWrites >= 4);
        const observer = writes.find(w => w.operation === "readRemoveSelection").child;
        assert.ok(writes.filter(w => w.child === observer).every(w => w.operation === "readRemoveSelection"), "Observer never sends actions");
        await Promise.all(traffic);
        console.log(`Selected delayed polling: ${samples} samples, ${sizeWrites} SDK Size operations, maximum native age ${maxAge}ms; slow shared queue, explicit read failure/recovery and stale-context rejection passed (simulated).`);
    } finally { for (const timer of timers) clearTimeout(timer); await backend.stop(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
