"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
const definition = require("../server/red-eye-state");
const client = s => Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, s[k]]).concat([["stateRevision", s.revision]]));
async function scenario(kind, name) {
    const log = console.log; console.log = () => {};
    commands.resetQueueForTests(); const sdk = runtime();
    sdk.run(fs.readFileSync(path.join(__dirname, "red-eye.lua"), "utf8"));
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (suffix, status = 200) => { const r = await fetch(base + suffix); assert.equal(r.status, status, name + " " + suffix); return r.json(); };
    const resultPath = () => { const u = new URL(sdk.result()); return u.pathname + u.search; };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: kind + name });
        if (kind === "red_eye" || kind === "pet_eye" || name === "close-other") sdk.run("eyeTool='crop'");
        if (name.startsWith("read-")) sdk.set("eyeScenario", name.slice(5));
        await get("/red-eye/state"); const { request } = await get("/red-eye/next"); assert.ok(request);
        assert.equal((await get("/red-eye/next")).request, null);
        sdk.set("queryJson", JSON.stringify({ request })); sdk.run("eyeQuery()");
        const queryResult = resultPath(); await get(queryResult); await get(queryResult, 409);
        const before = await get("/red-eye/state");
        if (name.startsWith("read-")) { assert.equal(before.available, false); return; }
        const params = new URLSearchParams({ operationKind: kind, ...client(before) });
        const route = "/red-eye/action?" + params;
        await get(route + "&extra=1", 400); await get(route + "&operationKind=close", 400);
        if (name === "close-other") { await get(route, 409); sdk.run("assert(eyeCalls == 0)"); return; }
        const admission = await get(route); assert.equal(admission.selectedTool, before.selectedTool, "no optimistic tool state");
        assert.equal(admission.pendingOperation.operationKind, kind); await get(route, 409);
        if (name.startsWith("queue-")) {
            const field = name.slice(6);
            context.updateContext({ activeModule: field === "module" ? "library" : "develop", selectedPhotoUuid: field === "photo" ? "another" : "creation-photo",
                developFingerprint: field === "develop" ? "changed" : kind + name });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(eyeCalls == 0)"); return;
        }
        const command = commands.getNextCommand(); assert.ok(command); assert.equal(commands.getNextCommand(), null);
        assert.equal(commands.tryEnqueueCommand(command).accepted, false); assert.equal(commands.tryEnqueueBatch([command]).accepted, false);
        for (const patch of [{ operationKind: "bad" }, { expectedSelectedTool: "bad" }, { expectedRedEyeRevision: -1 }, { extra: true }])
            assert.equal(commands.validateCommand({ ...command, ...patch }), false);
        const binding = new URLSearchParams({ operationId: command.operationId, ...Object.fromEntries(definition.bindings.map(k => [k, command[k]])) });
        assert.equal((await get("/red-eye/validate?" + binding)).valid, true);
        sdk.set("eyeScenario", name); sdk.set("commandJson", JSON.stringify(command)); sdk.run("eyeExecute()");
        const result = resultPath();
        if (kind === "reset" && name === "ordinary") await get(result.replace("outcome=requested", "outcome=confirmed"), 409);
        await get(result); await get(result, 409);
        const after = await get("/red-eye/state");
        const outcome = name === "ordinary" ? kind === "reset" ? "requested" : "confirmed" :
            name.endsWith("before") || name === "photo-after" || name === "invalid-binding" ? "stale" : "failed";
        assert.equal(after.lastResult.outcome, outcome, name + ": " + after.lastResult.detail);
        const calls = name.endsWith("before") || name === "invalid-binding" || name.startsWith("getter-") ? 0 : 1;
        sdk.run("assert(eyeCalls == " + calls + ")");
        if (outcome === "confirmed") assert.equal(after.selectedTool, kind === "close" ? "loupe" : "redeye");
        if (kind === "reset" && outcome === "requested") assert.equal(after.lastResult.detail, "Reset requested");
        if (calls && ["red_eye", "pet_eye"].includes(kind) && name === "ordinary") sdk.run("assert(eyeMode == '" + kind + "')");
        sdk.run("eyeExecute(); assert(eyeCalls == " + calls + ")");
        assert.equal((await get("/red-eye/validate?" + binding)).valid, false);
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
function stateChecks() {
    let now = 1000;
    const ctx = { activeModule: "develop", selectedPhotoUuid: "p", contextCounter: 1, developCounter: 1, contextChangedAt: 1 };
    const state = definition.createRedEyeState({ now: () => now, serverEpoch: "test", getContext: () => ctx });
    const snapshot = { available: true, selectedTool: "redeye", openSupported: true, closeSupported: true, resetSupported: true, reason: null };
    function refresh() { state.get(true); const q = state.takeRequest(); assert.ok(q); assert.equal(state.acceptQuery({ ...q, ...snapshot }), true); return state.get(false); }
    let s = refresh(); const revision = s.revision; now += 400; s = refresh(); assert.equal(s.revision, revision, "identical feedback retains semantic revision");
    now += 5001; assert.equal(state.admit("reset", client(s)), null, "expired feedback cannot mutate"); s = refresh();
    const c = state.admit("reset", client(s)); assert.ok(c); assert.equal(state.validateBinding(c), false, "not dispatched yet");
    assert.equal(state.matches(c, "admit"), true); assert.equal(state.matches(c, "dequeue"), true);
    now += 15001; assert.equal(state.validateBinding(c), false); assert.equal(state.get(false).available, false);
    assert.equal(state.acceptResult({ ...c, ...snapshot, outcome: "requested", invoked: true }), false, "late completion after timeout rejected");
    s = refresh(); const old = state.admit("close", client(s)); ctx.developCounter++;
    assert.equal(state.matches(old, "dequeue"), false, "context changes cancel ownership");
}
async function verify() {
    stateChecks(); let count = 0;
    for (const kind of definition.kinds) for (const name of ["ordinary", "sdk-error", "sdk-false", "invalid-binding", "photo-before", "module-before", "tool-before", "photo-after", "queue-photo", "queue-module", "queue-develop"] ) {
        await scenario(kind, name); count++;
    }
    for (const kind of ["red_eye", "pet_eye", "close"]) { await scenario(kind, "no-change"); count++; }
    for (const name of ["getter-error", "getter-nil", "getter-unknown", "video", "no-photo"]) { await scenario("reset", "read-" + name); count++; }
    await scenario("close", "close-other"); count++;
    console.log("Red Eye: " + count + " HTTP/queue/Parser/Commands/mock SDK scenarios plus expiry, revision, timeout and late-result checks passed.");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verify };
