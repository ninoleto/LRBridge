"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
const definition = require("../server/export-state");
const client = (s, requestId) => Object.fromEntries(definition.clientFields.map(k => [k, k === "requestId" ? requestId : k === "stateRevision" ? s.revision : s[k]]));
let serial = 0;
async function scenario(action, name, moduleName = "develop") {
    const log = console.log; console.log = () => {};
    commands.resetQueueForTests(); const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "export.lua"), "utf8"));
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (suffix, status = 200) => { const r = await fetch(base + suffix); assert.equal(r.status, status, name + " " + suffix); return r.json(); };
    const sdkResult = () => { const u = new URL(sdk.result()); return u.pathname + u.search; };
    try {
        const requestId = "test-" + (++serial);
        context.updateContext({ activeModule: moduleName, selectedPhotoUuid: "creation-photo", developFingerprint: requestId });
        sdk.set("exportModule", moduleName);
        await get("/export/state?extra=1", 400);
        await get("/export/state"); const query = commands.getNextCommand(); assert.equal(query.command, "export.query");
        assert.equal(commands.tryEnqueueCommand(query).accepted, false);
        sdk.set("commandJson", JSON.stringify(query)); sdk.run("exportRun()");
        const qr = sdkResult(); await get(qr); await get(qr, 409);
        const before = await get("/export/state"); assert.equal(before.available, true); assert.equal(before.selectionCount, 2);
        const route = "/export/action?" + new URLSearchParams({ command: action, ...client(before, requestId) });
        await get(route + "&extra=1", 400); await get(route + "&command=export.previous", 400);
        await get(route.replace("stateRevision=" + before.revision, "stateRevision=NaN"), 409);
        await get(route.replace("selectionToken=", "selectionToken=changed"), 409);
        await get("/command?command=" + action, 400);
        const admitted = await get(route); assert.equal(admitted.pendingOperation.command, action);
        assert.equal((await get(route)).duplicate, true, "identical HTTP retry returns receipt without dispatching again");
        await get(route.replace(requestId, requestId + "-new"), 409);
        if (name === "queue-context") {
            context.updateContext({ activeModule: moduleName, selectedPhotoUuid: "other", developFingerprint: "new" });
            assert.equal(commands.getNextCommand(), null); return;
        }
        const c = commands.getNextCommand(); assert.equal(c.command, action); assert.equal(commands.getNextCommand(), null);
        assert.equal(commands.tryEnqueueCommand(c).accepted, false); assert.equal(commands.tryEnqueueBatch([c]).accepted, false);
        for (const patch of [{ extra: true }, { requestId: "bad value" }, { expectedContextCounter: -1 }, { expectedSelectionToken: "" }, { command: "export.anything" }])
            assert.equal(commands.validateCommand({ ...c, ...patch }), false);
        const claim = "/export/claim?" + new URLSearchParams(c);
        assert.equal((await get(claim)).valid, true); assert.equal((await get(claim)).valid, false, "one-use server claim");
        sdk.set("exportScenario", name); sdk.set("commandJson", JSON.stringify(c));
        if (name === "reload") sdk.run("exportResetLease()");
        sdk.run("exportRun()");
        const interrupted = ["shutdown", "generation", "claim-lost"].includes(name);
        const called = ["ordinary", "selection-reordered", "sdk-error", "sdk-false"].includes(name);
        sdk.run("assert(exportCalls == " + (called ? 1 : 0) + ")");
        if (!interrupted) {
            const result = sdkResult(); await get(result); await get(result, 409);
            let after = await get("/export/state");
            assert.equal(after.lastResult.outcome, called ? name.startsWith("sdk-") ? "uncertain" : "requested" : "stale");
            assert.doesNotMatch(after.lastResult.detail, /completed/i);
            if (after.needsReview) {
                await get("/export/acknowledge?serverEpoch=wrong&operationId=" + c.operationId, 409);
                await get("/export/acknowledge?" + new URLSearchParams({ serverEpoch: after.serverEpoch, operationId: c.operationId }));
            }
            assert.equal((await get(route)).duplicate, true, "completed/stale/uncertain request IDs are never reused");
            sdk.run("exportRun(); assert(exportCalls == " + (called ? 1 : 0) + ")");
            if (called) sdk.run("assert(exportMethod == '" + action.split(".")[1] + "')");
        }
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
function stateChecks() {
    let now = 1000, state, queued = [];
    const ctx = { activeModule: "library", selectedPhotoUuid: "photo", contextCounter: 1, developCounter: 0, contextChangedAt: 1 };
    const snapshot = { available: true, selectionToken: "lease-one", selectionCount: 2, dialogSupported: true, previousSupported: true };
    state = definition.createExportState({ now: () => now, serverEpoch: "epoch", getContext: () => ctx,
        enqueue(c) { queued.push(c); return state.matches(c, "admit"); } });
    const refresh = () => { state.get(true); const q = queued.pop(); assert.ok(q); assert.equal(state.matches(q, "dequeue"), true); assert.equal(state.acceptQuery({ ...q, ...snapshot }), true); return state.get(); };
    let s = refresh(), revision = s.revision; now += 1001; s = refresh(); assert.equal(s.revision, revision);
    now += 5001; assert.equal(state.admit("export.previous", client(s, "expired")), null);
    s = refresh(); const input = client(s, "once"); const { command: c } = state.admit("export.previous", input);
    assert.equal(state.claim(c), false); state.matches(c, "admit"); state.matches(c, "dequeue"); assert.equal(state.claim(c), true);
    now += 15001; assert.equal(state.claim(c), false); assert.equal(state.get().needsReview, true);
    assert.equal(state.get().lastResult.invoked, null, "timeout cannot assert that the SDK was or was not invoked");
    assert.equal(state.acceptResult({ ...c, outcome: "requested", invoked: true }), false, "late result cannot settle timed-out operation");
    assert.equal(state.admit("export.previous", input).duplicate, true); assert.equal(state.admit("export.dialog", input), null);
    s = refresh(); assert.equal(state.admit("export.previous", client(s, "new")), null, "uncertainty requires explicit review");
    assert.equal(state.acknowledge({ serverEpoch: "epoch", operationId: c.operationId }), true);
    s = state.get(); const again = state.admit("export.dialog", client(s, "new")); assert.ok(again);
    ctx.contextCounter++; assert.equal(state.matches(again.command, "dequeue"), false);
    assert.equal(state.get().lastResult.outcome, "stale");
    assert.equal(state.admit("export.previous", { ...input, serverEpoch: "old" }), null);
}
function queueOrderChecks() {
    commands.setExportAdmissionProvider({ matches: () => true });
    const action = { command: "export.previous", requestId: "order", operationId: "ex-1", expectedSelectionToken: "lease",
        expectedServerEpoch: "test", expectedActiveModule: "develop", expectedSelectedPhotoUuid: "p",
        expectedContextCounter: 1, expectedDevelopCounter: 1, expectedContextChangedAt: 1 };
    for (const [before, after] of [
        [{ command: "develop.set", slider: "Exposure", value: 1 }, { command: "develop.set", slider: "Exposure", value: 2 }],
        [{ command: "develop.set", slider: "Contrast", value: 10 }, { command: "develop.reset", slider: "Contrast" }],
        [{ command: "develop_categorical.white_balance.set", value: "Daylight" }, { command: "develop_categorical.white_balance.set", value: "Cloudy" }],
        [{ command: "color_grading.wheel.set", region: "shadows", hue: 10, saturation: 20 }, { command: "color_grading.region.reset", region: "shadows" }]
    ]) {
        commands.resetQueueForTests();
        assert.equal(commands.tryEnqueueCommand(before).accepted, true);
        assert.equal(commands.tryEnqueueCommand(action).accepted, true);
        assert.equal(commands.tryEnqueueCommand(after).accepted, true);
        assert.equal(commands.getNextCommand().command, before.command, "earlier edit must stay before Export");
        assert.equal(commands.getNextCommand().command, action.command);
        assert.equal(commands.getNextCommand().command, after.command);
        assert.equal(commands.getNextCommand(), null);
    }
    commands.resetQueueForTests();
}
async function verify() {
    stateChecks(); let count = 0;
    for (const action of definition.actions) for (const name of ["ordinary", "selection-same-count", "selection-added", "selection-reordered", "active-missing", "duplicate-member",
        "active-uuid", "module", "catalog-path", "catalog-object", "during-metadata", "metadata-error", "no-photo", "sdk-error", "sdk-false", "queue-context", "reload", "shutdown", "generation", "claim-lost"]) {
        await scenario(action, name); count++;
    }
    await scenario("export.dialog", "ordinary", "library"); await scenario("export.previous", "ordinary", "library"); count += 2;
    const savedLog = console.log; console.log = () => {}; try { queueOrderChecks(); } finally { console.log = savedLog; }
    console.log("Export: " + count + " HTTP/queue/Parser/Commands/mock SDK scenarios and request expiry, uncertainty, duplicate and late-result checks passed.");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verify };
