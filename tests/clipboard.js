"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
const definition = require("../server/clipboard-state");
const client = (s, requestId) => Object.fromEntries(definition.clientFields.map(k => [k, k === "requestId" ? requestId : k === "stateRevision" ? s.revision : s[k]]));
let serial = 0;
async function scenario(action, name, moduleName = "develop", single = false) {
    const log = console.log; console.log = () => {};
    commands.resetQueueForTests(); const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "clipboard.lua"), "utf8"));
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (suffix, status = 200) => { const r = await fetch(base + suffix); assert.equal(r.status, status, name + " " + suffix); return r.json(); };
    const sdkResult = () => { const u = new URL(sdk.result()); return u.pathname + u.search; };
    try {
        const requestId = "test-" + (++serial);
        context.updateContext({ activeModule: moduleName, selectedPhotoUuid: "creation-photo", developFingerprint: requestId });
        sdk.set("clipboardModule", moduleName); if (single) sdk.run("clipboardSingle()");
        await get("/clipboard/state?extra=1", 400); await get("/clipboard/state");
        const query = commands.getNextCommand(); assert.equal(query.command, "clipboard.query");
        assert.equal(commands.tryEnqueueCommand(query).accepted, false);
        sdk.set("commandJson", JSON.stringify(query)); sdk.run("clipboardRun()");
        const qr = sdkResult(); await get(qr); await get(qr, 409);
        const before = await get("/clipboard/state"); assert.equal(before.available, true); assert.equal(before.selectionCount, single ? 1 : 2);
        const route = "/clipboard/action?" + new URLSearchParams({ command: action, ...client(before, requestId) });
        await get(route + "&extra=1", 400); await get(route + "&command=clipboard.paste", 400);
        await get(route.replace("stateRevision=" + before.revision, "stateRevision=NaN"), 409);
        await get(route.replace("selectionToken=", "selectionToken=changed"), 409);
        await get("/command?command=" + action, 400);
        // No preceding web Copy: Paste is admitted from native selection/capability alone.
        const admitted = await get(route); assert.equal(admitted.pendingOperation.command, action);
        assert.equal((await get(route)).duplicate, true); await get(route.replace(requestId, requestId + "-new"), 409);
        if (name === "queue-context") {
            context.updateContext({ activeModule: moduleName, selectedPhotoUuid: "other", developFingerprint: "new" });
            assert.equal(commands.getNextCommand(), null); return;
        }
        const c = commands.getNextCommand(); assert.equal(c.command, action); assert.equal(commands.getNextCommand(), null);
        assert.equal(c.updateAISettings, action === "clipboard.paste");
        assert.equal(commands.tryEnqueueCommand(c).accepted, false); assert.equal(commands.tryEnqueueBatch([c]).accepted, false);
        for (const patch of [{ extra: true }, { requestId: "bad value" }, { expectedContextCounter: -1 }, { expectedSelectionToken: "" },
            { updateAISettings: !c.updateAISettings }, { command: "clipboard.anything" }]) assert.equal(commands.validateCommand({ ...c, ...patch }), false);
        const claim = "/clipboard/claim?" + new URLSearchParams(c), validate = "/clipboard/validate?" + new URLSearchParams(c);
        assert.equal((await get(validate)).valid, false);
        assert.equal((await get(claim)).valid, true); assert.equal((await get(claim)).valid, false);
        assert.equal((await get(validate)).valid, true);
        sdk.set("clipboardScenario", name); sdk.set("commandJson", JSON.stringify(c));
        if (name === "reload") sdk.run("clipboardResetLease()");
        if (name === "missing-method") sdk.run("clipboardNoMethods()");
        sdk.run("clipboardRun()");
        const interrupted = ["shutdown", "generation", "claim-lost"].includes(name);
        const called = ["ordinary", "selection-reordered", "sdk-error", "sdk-false", "sdk-nil", "ai-pending", "ai-error", "ai-nil", "gate-after-error"].includes(name);
        sdk.run("assert(clipboardCalls == " + (called ? 1 : 0) + ")");
        if (!interrupted) {
            if (called && action === "clipboard.paste") context.updateContext({ activeModule: moduleName, selectedPhotoUuid: "creation-photo", developFingerprint: requestId + "-paste" });
            const result = sdkResult(); await get(result); await get(result, 409);
            const after = await get("/clipboard/state");
            assert.equal(after.lastResult.outcome, called ? name.startsWith("sdk-") || name === "gate-after-error" ? "uncertain" : "success" : "stale");
            assert.equal(after.lastResult.targetCount, action === "clipboard.copy" || single ? 1 : 2);
            if (called && action === "clipboard.paste") {
                assert.equal(after.lastResult.aiPendingCount, name === "ai-pending" ? 1 : name === "ai-error" || name === "ai-nil" ? null : 0);
                if (after.lastResult.outcome === "success" && !single) assert.match(after.lastResult.detail, /at least one of 2/);
                assert.match(after.lastResult.detail, /not proof of completed AI/);
            }
            if (after.needsReview) await get("/clipboard/acknowledge?" + new URLSearchParams({ serverEpoch: after.serverEpoch, operationId: c.operationId }));
            assert.equal((await get(route)).duplicate, true, "consumed IDs survive completion, failure and context change");
            sdk.run("clipboardRun(); assert(clipboardCalls == " + (called ? 1 : 0) + ")");
            if (called) sdk.run("assert(clipboardMethod == '" + (action === "clipboard.copy" ? "copy" : single ? "photo-paste" : "catalog-paste") + "')");
        }
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
function stateChecks() {
    let now = 1000, state, queued = [], refreshed = 0;
    const ctx = { activeModule: "library", selectedPhotoUuid: "photo", contextCounter: 1, developCounter: 0, contextChangedAt: 1 };
    const snapshot = { available: true, selectionToken: "lease-one", selectionCount: 2, copySupported: true, pasteSupported: true };
    state = definition.createClipboardState({ now: () => now, serverEpoch: "epoch", getContext: () => ctx,
        onChanged() { refreshed++; }, enqueue(c) { queued.push(c); return state.matches(c, "admit"); } });
    const refresh = () => { state.get(true); const q = queued.pop(); assert.ok(q); state.matches(q, "dequeue"); assert.equal(state.acceptQuery({ ...q, ...snapshot }), true); return state.get(); };
    let s = refresh(); now += 5001; assert.equal(state.admit("clipboard.paste", client(s, "expired")), null);
    s = refresh(); const input = client(s, "once"), { command: c } = state.admit("clipboard.paste", input);
    state.matches(c, "admit"); state.matches(c, "dequeue"); assert.equal(state.claim(c), true);
    ctx.developCounter++; assert.equal(state.validateClaim(c), false, "changed Develop context inside gate rejects invocation");
    assert.ok(state.get().pendingOperation, "Paste's own Develop feedback must not discard its result");
    now += 120001; assert.equal(state.validateClaim(c), false); assert.equal(state.get().needsReview, true);
    assert.equal(state.get().lastResult.invoked, null);
    assert.equal(state.acceptResult({ ...c, outcome: "success", invoked: true, sdkResult: true, aiPendingCount: 0, aiCheckedCount: 2 }), false);
    assert.equal(state.admit("clipboard.paste", input).duplicate, true); assert.equal(state.admit("clipboard.copy", input), null);
    s = refresh(); assert.equal(state.admit("clipboard.paste", client(s, "new")), null);
    assert.equal(state.acknowledge({ serverEpoch: "epoch", operationId: c.operationId }), true);
    assert.equal(refreshed, 2, "Paste admission/result refresh authoritative history");
    assert.equal(state.admit("clipboard.copy", { ...client(s, "old"), serverEpoch: "retired" }), null);
}
function queueOrderChecks() {
    commands.setClipboardAdmissionProvider({ matches: () => true });
    for (const command of definition.actions) for (const after of [{ command: "develop.set", slider: "Exposure", value: 2 }, { command: "develop.reset", slider: "Exposure" }]) {
        commands.resetQueueForTests();
        const c = { command, requestId: "order", operationId: "cb-1", expectedSelectionToken: "lease", updateAISettings: command === "clipboard.paste",
            expectedServerEpoch: "test", expectedActiveModule: "develop", expectedSelectedPhotoUuid: "p", expectedContextCounter: 1, expectedDevelopCounter: 1, expectedContextChangedAt: 1 };
        commands.tryEnqueueCommand({ command: "develop.set", slider: "Exposure", value: 1 });
        assert.equal(commands.tryEnqueueCommand(c).accepted, true); commands.tryEnqueueCommand(after);
        assert.equal(commands.getNextCommand().value, 1); assert.equal(commands.getNextCommand().command, command);
        assert.equal(commands.getNextCommand().command, after.command); assert.equal(commands.getNextCommand(), null);
    }
    commands.resetQueueForTests();
}
async function verify() {
    stateChecks(); let count = 0;
    for (const action of definition.actions) for (const name of ["ordinary", "selection-same-count", "selection-added", "selection-reordered", "active-missing", "duplicate-member",
        "active-uuid", "module", "catalog-path", "catalog-object", "during-metadata", "metadata-error", "no-photo", "sdk-error", "sdk-false", "sdk-nil",
        "queue-context", "reload", "shutdown", "generation", "claim-lost", "validate-lost", "validate-stale", "during-validate", "missing-method"]) {
        await scenario(action, name); count++;
    }
    for (const name of ["gate-timeout", "gate-selection", "gate-empty", "gate-after-error", "ai-pending", "ai-error", "ai-nil"]) { await scenario("clipboard.paste", name); count++; }
    for (const action of definition.actions) for (const moduleName of ["library", "develop"]) { await scenario(action, "ordinary", moduleName, true); count++; }
    const log = console.log; console.log = () => {}; try { queueOrderChecks(); } finally { console.log = log; }
    console.log("Clipboard: " + count + " HTTP/queue/Parser/Commands/mock SDK scenarios plus expiry, late-result, history and queue-order checks passed.");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verify };
