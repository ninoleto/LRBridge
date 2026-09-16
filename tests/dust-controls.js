"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runtime } = require("./masking-create");
const commands = require("../server/commands"), context = require("../server/context");
const { createBridge } = require("../server/bridge");
const definition = require("../server/remove-state");
const scenarios = ["success", "missing-preset", "changed-preset", "duplicate-preset", "version", "pending-ai",
    "gate-timeout", "gate-photo", "gate-edit", "gate-manual", "gate-mode", "gate-preset", "stale-filter", "wrong-identity",
    "sdk-error", "no-change", "other-edit", "other-ai", "manual", "mask", "preference", "after-photo", "queue-photo", "missing-proof"];
const onScenarios = scenarios.concat(["process-version", "preset-extra-edit", "void-return", "false-return", "delayed", "ai-settles", "ai-pending-after"]);
const closeScenarios = ["success", "version", "missing-navigation", "pending-ai", "stale-filter", "wrong-identity", "sdk-error",
    "other-edit", "other-ai", "manual", "mask", "preference", "after-photo", "queue-photo", "missing-proof", "dust-changed", "closes-healing", "forged-confirmation", "false-return"];
async function run(name, direction) {
    const enabling = direction === "on", closing = direction === "close";
    const field = closing ? "dustClose" : "dustApply", value = closing ? "manualRemove" : enabling;
    const log = console.log; console.log = () => {};
    commands.resetQueueForTests();
    const sdk = runtime(); sdk.set("dustScenario", name); sdk.set("dustDirection", direction); sdk.run(fs.readFileSync("tests/dust-controls.lua", "utf8"));
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (url, status = 200) => { const r = await fetch(base + url); assert.equal(r.status, status, name + " " + url); return r.json(); };
    const result = () => { const u = new URL(sdk.result()); return u.pathname + u.search; };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: name });
        await get("/remove/state"); const { request } = await get("/remove/next");
        sdk.set("queryJson", JSON.stringify({ request })); sdk.run("removeQuery()"); await get(result());
        const before = await get("/remove/state");
        const q = new URLSearchParams({ field, value, mode: before.newSpotType, stateRevision: before.revision,
            ...Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, before[k]])) });
        const invalid = new URLSearchParams(q); invalid.set("value", "loupe"); await get("/remove/dust?" + invalid, 400);
        await get("/remove/brush?" + q, 400);
        if (["missing-preset", "changed-preset", "duplicate-preset", "version", "process-version", "preset-extra-edit", "missing-navigation"].includes(name)) {
            assert.equal(name === "version" ? before.dust.available : closing ? before.dust.canRequestClose : enabling ? before.dust.canEnable : before.dust.canDisable, false);
            await get("/remove/dust?" + q, 409); sdk.run("assert(dustCalls==0)"); return;
        }
        assert.equal(before.dustApply, !enabling, name + ": " + JSON.stringify(before.dust));
        const admitted = await get("/remove/dust?" + q); assert.equal(admitted.dustApply, !enabling);
        await get("/remove/dust?" + q, 409);
        if (name === "queue-photo") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other", developFingerprint: "changed" });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(dustCalls==0)"); return;
        }
        const command = commands.getNextCommand(); assert.equal(command.command, "remove.dust." + direction);
        assert.equal(commands.getNextCommand(), null);
        assert.equal(commands.tryEnqueueCommand(command).accepted, false);
        assert.equal(commands.tryEnqueueBatch([command]).accepted, false);
        assert.equal(definition.validCommand({ ...command, value: closing ? "loupe" : !enabling }), false);
        sdk.run("dustAlter()"); sdk.set("commandJson", JSON.stringify(command)); sdk.run("removeExecute()");
        let path = result();
        if (name === "missing-proof") path = path.replace(/%22preservationConfirmed%22%3Atrue/g, "%22preservationConfirmed%22%3Afalse");
        if (name === "forged-confirmation") path = path.replace("outcome=requested", "outcome=confirmed");
        await get(path); await get(path, 409);
        const after = await get("/remove/state");
        const success = ["success", "void-return", "delayed", "ai-settles"].includes(name);
        assert.equal(after.lastResult.outcome, success ? closing ? "requested" : "confirmed" : "failed", direction + ": " + name + ": " + after.lastResult.detail);
        const noCall = ["pending-ai", "gate-timeout", "gate-photo", "gate-edit", "gate-manual", "gate-mode", "gate-preset", "stale-filter", "wrong-identity"].includes(name);
        sdk.run("assert(dustCalls==" + (noCall ? 0 : 1) + ")");
        if (success) {
            assert.equal(after.dustApply, enabling || closing); assert.equal(after.dust.preservationConfirmed, true);
            assert.equal(after.selectedTool, "dust"); assert.equal(after.dust.panelStateAvailable, false);
            sdk.run("assert(dustSettings.Exposure2012==0.7 and #dustSettings.FilterList.Filters==" + (enabling || closing ? 2 : 1) + " and manualPeopleSpots[1].X==0.4)");
            if (closing) assert.match(after.lastResult.detail, /panel state is not exposed/);
        }
        if (!noCall) { sdk.run("removeExecute(); assert(dustCalls==1)"); await get(result(), 409); }
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
(async () => {
    const selected = process.argv.slice(2); let count = 0;
    for (const [direction, names] of [["off", scenarios], ["on", onScenarios], ["close", closeScenarios]]) {
        for (const name of names) if (!selected.length || selected.includes(direction + ":" + name)) { await run(name, direction); count++; }
    }
    assert(count > 0);
    let clock = 1000;
    const ctx = { activeModule: "develop", selectedPhotoUuid: "timed-photo", contextCounter: 1, developCounter: 1, contextChangedAt: 1 };
    const state = definition.createRemoveState({ getContext: () => ctx, now: () => clock, serverEpoch: "timeout-test" });
    state.get(true); const request = state.takeRequest();
    assert(state.acceptQuery({ ...request, available: true, selectedTool: "dust", newSpotType: "heal", brushSize: 25,
        brushFeather: 50, visualizationThreshold: 64, toolOverlay: "auto", useGenerativeAI: false, detectObjects: false, visualizeSpots: false,
        dust: { available: true, applied: false, canEnable: true, canDisable: true, token: "a".repeat(64) } }));
    const before = state.get(false);
    const command = state.admit("dustApply", true, { ...ctx, serverEpoch: before.serverEpoch, stateRevision: before.revision, mode: "heal" });
    assert(command && state.matches(command, "admit") && state.matches(command, "dequeue"));
    clock += 11000; assert(state.get(false).pendingOperation, "On processing can outlast the brush-command timeout");
    clock += 120000; assert.equal(state.get(false).pendingOperation, null);
    assert.equal(state.get(false).lastResult.outcome, "failed"); assert.equal(state.takeRequest(), null, "Timeout never resubmits On");
    console.log("Dust controls: " + count + " HTTP/queue/SDK On, Off/Reset, native navigation requests, preservation and no-retry scenarios plus On timeout passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
