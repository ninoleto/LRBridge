"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const http = require("node:http");
const native = require("../server/windows-lightroom-native");
const ui = require("../app/controller-lens-blur");
const { createBridge } = require("../server/bridge");
const { proxyControllerRequest } = require("../app/controller-proxy");

async function until(predicate) {
    const end = Date.now() + 1500;
    while (!predicate()) {
        if (Date.now() >= end) throw Error("Native polling fixture did not advance");
        await new Promise(resolve => setTimeout(resolve, 2));
    }
}
function profileResult(operation) {
    const common = { available: true, processId: 15300, mainHwnd: 71001, comboHwnd: 71002, listHwnd: 71003,
        patterns: { selection: true, expandCollapse: true, selectionItem: true } };
    return operation === "readProfileLabel" ? { ...common, selectedLabel: "Adobe Color" } : {
        ...common, reason: null, expanded: false, browsePosition: 2, browseLabel: "Browse...", selectedCount: 1,
        selected: { position: 0, label: "Adobe Color" },
        options: ["Adobe Color", "Adobe Vivid"].map((label, position) => ({ position, label, enabled: true, selectionItem: true }))
    };
}
function fixture(autoProfile, profileDelayMs = 0) {
    const sent = [];
    let child, kills = 0;
    const backend = native.createWindowsLightroomNativeBackend({ platform: "win32", spawn() {
        child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.stdin = new Writable({ write(chunk, _encoding, done) {
            const message = JSON.parse(chunk);
            if (autoProfile === "hold-next" && message.operation.startsWith("readProfile")) {
                autoProfile = true; sent.push(message);
            } else if (autoProfile && message.operation.startsWith("readProfile")) {
                setTimeout(() => child.stdout.write(JSON.stringify({ id: message.id, ok: true, result: profileResult(message.operation) }) + "\n"), profileDelayMs);
            } else sent.push(message);
            done();
        } });
        child.kill = () => { kills++; child.emit("exit", null); };
        return child;
    } });
    return { backend, sent, kills: () => kills, setAutoProfile(value) { autoProfile = value; },
        reply(message, result) { child.stdout.write(JSON.stringify({ id: message.id, ok: true, result }) + "\n"); } };
}
function state(value) {
    return { ...native.unavailableNativeState(), available: true, reason: null, apply: { available: true, value } };
}

async function run() {
    await runDepthReadback();
    const f = fixture(), backend = f.backend;
    try {
        const profile = backend.readProfileSnapshot();
        const reads = Array.from({ length: 20 }, () => backend.readState());
        const label = backend.readProfileLabel();
        assert.equal(backend.getTransportDiagnostics().queueDepth, 2, "Only one full-state read waits behind Profile");
        assert.equal(backend.getTransportDiagnostics().sharedStateReads, 19);
        f.reply(f.sent[0], { selectedLabel: "Adobe Vivid" }); await profile;
        await until(() => f.sent.length === 2);
        assert.equal(f.sent[1].operation, "readState", "Profile discovery cannot overtake an already queued state poll");
        const laterRead = backend.readState();
        assert.equal(backend.getTransportDiagnostics().queueDepth, 2, "A later read never shares an already-dispatched snapshot");
        f.reply(f.sent[1], state(true));
        assert((await Promise.all(reads)).every(result => result.apply.value === true));
        await until(() => f.sent.length === 3);
        assert.equal(f.sent[2].operation, "readProfileLabel", "Coalesced state polling cannot starve Profile discovery either");
        f.reply(f.sent[2], { selectedLabel: "Adobe Vivid" }); await label;
        await until(() => f.sent.length === 4);
        f.reply(f.sent[3], state(false));
        assert.equal((await laterRead).apply.value, false);

        const blockingProfile = backend.readProfileSnapshot();
        await until(() => f.sent.length === 5);
        const started = Date.now();
        const expired = await Promise.all([backend.readState(), backend.readState()]);
        assert(Date.now() - started < 4500, "Queue time is bounded before the 10s proxy deadline");
        assert(expired.every(result => !result.available && !result.apply.available && result.apply.value === null),
            "An expired queued poll cannot reuse the last confirmed Off state");
        assert.match(expired[0].reason, /waited too long in the queue/);
        assert.equal(backend.getTransportDiagnostics().queueDepth, 0, "Expired polls do not remain as abandoned work");
        assert.equal(f.kills(), 0, "Queue expiry does not interrupt the helper or Profile operation");
        f.reply(f.sent[4], { selectedLabel: "Adobe Vivid" }); await blockingProfile;
        const recovered = backend.readState(); await until(() => f.sent.length === 6);
        f.reply(f.sent[5], state(true));
        assert.equal((await recovered).apply.value, true, "Polling resumes after queue pressure clears");
    } finally { await backend.stop(); }

    // Actual backend queue, bridge context validation and controller proxy; only native/SDK feedback is simulated.
    const h = fixture(true);
    const bridge = createBridge({ httpPort: 0, wsPort: 0, windowsNativeBackend: h.backend });
    await bridge.start();
    const bridgePort = bridge.getHttpServer().address().port;
    const proxy = http.createServer((req, res) => proxyControllerRequest(req, res, "/lens-blur/state", { upstreamPort: bridgePort }));
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + proxy.address().port;
    const read = async () => { const response = await fetch(base); assert.equal(response.status, 200); return response.json(); };
    const context = async id => fetch("http://127.0.0.1:" + bridgePort + "/context/update?activeModule=develop&selectedPhotoKey=" + id + "&selectedPhotoUuid=" + id + "&developFingerprint=" + id);
    try {
        await context("photo-initial");
        for (const [index, value] of [false, true, false, true, false, true].entries()) {
            const count = h.sent.length;
            const oldPoll = read(); await until(() => h.sent.length === count + 1);
            await context("photo-" + index);
            const sharedBefore = h.backend.getTransportDiagnostics().sharedStateReads;
            const currentPolls = [read(), read(), read()];
            await until(() => h.backend.getTransportDiagnostics().sharedStateReads === sharedBefore + 2);
            h.reply(h.sent[count], state(!value));
            const stale = await oldPoll;
            assert.equal(ui.presentationFor(stale.state).applyAvailable, false, "Old-photo response is rejected");
            await until(() => h.sent.length === count + 2);
            h.reply(h.sent[count + 1], state(value));
            for (const result of await Promise.all(currentPolls)) {
                assert.equal(result.context.selectedPhotoUuid, "photo-" + index);
                const shown = ui.presentationFor(result.state);
                assert.equal(shown.applyAvailable, true);
                assert.equal(shown.applyOnSelected, value);
                assert.equal(shown.applyOffSelected, !value);
            }
        }
        await until(() => !h.backend.getTransportDiagnostics().active && h.backend.getTransportDiagnostics().queueDepth === 0);
        h.setAutoProfile("hold-next");
        const count = h.sent.length;
        const slowProfile = h.backend.readProfileSnapshot();
        await until(() => h.sent.length === count + 1);
        const unavailable = await read(); // The real proxy must receive HTTP 200 before its 10s timeout.
        assert.match(unavailable.state.windowsNative.reason, /waited too long in the queue/);
        assert.equal(ui.presentationFor(unavailable.state).applyAvailable, false);
        h.reply(h.sent[count], {}); await slowProfile;
        const recovery = read(); await until(() => h.sent.length === count + 2);
        h.reply(h.sent[count + 1], state(false));
        assert.equal(ui.presentationFor((await recovery).state).applyOffSelected, true,
            "The same proxy/server recovers from unavailable feedback to confirmed Off without restarting");
    } finally {
        await new Promise(resolve => proxy.close(resolve));
        await bridge.stop(); await h.backend.stop();
    }
    // Reproduce ordinary controller traffic against the real Profile context-refresh chain, not a burst.
    const normal = fixture(true, 900);
    const normalBridge = createBridge({ httpPort: 0, wsPort: 0, windowsNativeBackend: normal.backend });
    await normalBridge.start();
    const normalBase = "http://127.0.0.1:" + normalBridge.getHttpServer().address().port;
    let nextReply = 0, currentValue = false, polling = true;
    const observations = [];
    const answerStates = setInterval(() => {
        while (nextReply < normal.sent.length) {
            const message = normal.sent[nextReply++];
            assert.equal(message.operation, "readState", "Normal status discovery must send no editing commands");
            normal.reply(message, state(currentValue));
        }
    }, 5);
    const poll = async route => {
        while (polling) {
            const response = await fetch(normalBase + route);
            assert.equal(response.status, 200);
            observations.push({ route, body: await response.json() });
            await new Promise(resolve => setTimeout(resolve, 750));
        }
    };
    const loops = [poll("/develop-categorical/state"), poll("/lens-blur/state")];
    try {
        for (const [index, value] of [false, true].entries()) {
            currentValue = value;
            const photo = "normal-" + index;
            await fetch(normalBase + "/context/update?activeModule=develop&selectedPhotoKey=" + photo + "&selectedPhotoUuid=" + photo + "&developFingerprint=" + photo);
            const end = Date.now() + 8000;
            while (!observations.some(row => row.body.profile?.photoUuid === photo && row.body.profile.available) ||
                !observations.some(row => row.body.context?.selectedPhotoUuid === photo &&
                    ui.presentationFor(row.body.state).applyAvailable && ui.presentationFor(row.body.state).applyOnSelected === value)) {
                assert(Date.now() < end, "Both Profile inventory and Apply must recover at normal controller cadence");
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        assert.equal(normal.backend.getTransportDiagnostics().stateQueueTimeouts, 0,
            "Profile's normal label/two-snapshot refresh must not expire Lens Blur reads");
    } finally {
        polling = false; await Promise.all(loops); clearInterval(answerStates); await normalBridge.stop(); await normal.backend.stop();
    }
    console.log("Lens Blur polling: bounded/shared queued reads, fair Profile discovery, queue-expiry recovery and six On/Off photo switches passed (simulated).");
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
async function runDepthReadback() {
    const f = fixture(true);
    const bridge = createBridge({ httpPort: 0, wsPort: 0, windowsNativeBackend: f.backend });
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async route => { const response = await fetch(base + route); return { status: response.status, body: await response.json() }; };
    try {
        await get("/context/update?activeModule=develop&selectedPhotoUuid=depth-a&developFingerprint=depth-a");
        const first = get("/lens-blur/state?depthOnly=true");
        await until(() => f.sent.length === 1);
        assert.equal(f.sent[0].operation, "readDepthVisualization", "Confirmation queries only the required checkbox");
        f.reply(f.sent[0], { available: true, value: false });
        const read = await first;
        assert.equal(read.status, 200); assert.equal(read.body.depthOnly, true);
        assert.deepEqual(read.body.state.windowsNative.visualizeDepth, { available: true, value: false });
        const second = get("/lens-blur/state?depthOnly=true");
        await until(() => f.sent.length === 2);
        await get("/context/update?activeModule=develop&selectedPhotoUuid=depth-b&developFingerprint=depth-b");
        f.reply(f.sent[1], { available: true, value: true });
        assert.equal((await second).body.state.windowsNative.visualizeDepth.available, false, "Discard old-photo checkbox feedback");
        assert.equal((await get("/lens-blur/state?depthOnly=false")).status, 400);
        assert.equal((await get("/lens-blur/state?depthOnly=true&sdkOnly=true")).status, 400);
        assert(f.sent.every(message => message.operation === "readDepthVisualization"), "No unrelated full reads or Windows writes");
        console.log("Lens Blur targeted confirmation: fresh reads, unknown/stale context rejection and unchanged route validation passed (simulated).");
    } finally { await bridge.stop(); }
}
module.exports = { run, runDepthReadback };
