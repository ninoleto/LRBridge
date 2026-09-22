"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { createWindowsLightroomNativeBackend, unavailableNativeState } = require("../server/windows-lightroom-native");

async function run() {
    const children = [], sent = [];
    const backend = createWindowsLightroomNativeBackend({ platform: "win32", spawn() {
        const child = new EventEmitter(); child.pid = 100 + children.length;
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.stdin = new Writable({ write(chunk, _encoding, done) { sent.push({ ...JSON.parse(chunk), child }); done(); } });
        child.kill = () => { child.killed = true; child.emit("exit", null); };
        children.push(child); return child;
    } });
    const reply = (index, result) => sent[index].child.stdout.write(JSON.stringify({ id: sent[index].id, ok: true, result }) + "\n");
    const until = async count => { for (let i = 0; sent.length < count && i < 100; i++) await new Promise(r => setTimeout(r, 2)); assert.equal(sent.length, count); };
    try {
        const profile = backend.readProfileSnapshot(), lens = backend.readState(), label = backend.readProfileLabel();
        profile.catch(() => {}); label.catch(() => {});
        const helperPid = backend.getTransportDiagnostics().helperPid, expiry = Date.now() + 60000;
        backend.setSharedReadPauseUntil(expiry);
        const blocked = await Promise.allSettled([backend.readState(), backend.readProfileSnapshot(), backend.readProfileLabel()]);
        assert.equal(blocked[0].status, "fulfilled");
        assert.equal(blocked[0].value.available, false);
        assert.match(blocked[0].value.reason, /temporarily paused/);
        assert.ok(blocked.slice(1).every(r => r.status === "rejected" && /temporarily paused/.test(r.reason.message)));
        assert.equal(sent.length, 1); assert.equal(children.length, 1); assert.equal(children[0].killed, undefined);
        assert.equal(backend.getTransportDiagnostics().queueDepth, 2, "Already admitted reads drain normally");
        const action = backend.activateFocusRangeAction("subject");
        reply(0, { available: true }); await profile; await until(2);
        assert.equal(sent[1].operation, "activateFocusRangeAction", "Existing action priority remains intact during pause");
        reply(1, unavailableNativeState()); await action; await until(3);
        assert.equal(sent[2].operation, "readState"); reply(2, unavailableNativeState()); await lens; await until(4);
        assert.equal(sent[3].operation, "readProfileLabel"); reply(3, { available: true }); await label;
        const selected = backend.readRemoveSelection(); await until(5);
        assert.equal(sent[4].operation, "readRemoveSelection", "Dedicated observer remains separate");
        assert.notEqual(sent[4].child.pid, helperPid); reply(4, { available: false }); await selected;
        assert.equal(backend.getTransportDiagnostics().sharedReadsPaused, true);
        assert.throws(() => backend.setSharedReadPauseUntil(Date.now() + 700000));
        assert.throws(() => backend.setSharedReadPauseUntil(-1));
        const savedNow = Date.now;
        let resumed;
        try {
            Date.now = () => expiry + 1;
            assert.equal(backend.getTransportDiagnostics().sharedReadsPaused, false);
            resumed = backend.readProfileLabel();
        } finally { Date.now = savedNow; }
        await until(6); assert.equal(sent[5].child.pid, helperPid);
        reply(5, { available: true }); assert.equal((await resumed).available, true);
        backend.setSharedReadPauseUntil(null);
        assert.equal(backend.getTransportDiagnostics().sharedReadsPaused, false);
        assert.equal(sent.filter(r => r.operation === "activateFocusRangeAction").length, 1);
        assert.equal(backend.getTransportDiagnostics().helperRestarts, 0);
    } finally { await backend.stop(); }
    console.log("Shared native read comparison: explicit read failures, existing reads drain, actions dispatch once with preserved priority, separate observer, automatic expiry and same-helper recovery passed (simulated).");
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
