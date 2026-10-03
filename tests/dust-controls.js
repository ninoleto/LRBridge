"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runtime } = require("./masking-create");
const commands = require("../server/commands"), context = require("../server/context");
const { createBridge } = require("../server/bridge");
const definition = require("../server/remove-state");
const scenarios = ["success", "unknown-state", "already-target", "renamed-group", "helper-warning-group", "missing-preset", "changed-preset", "duplicate-preset", "version", "pending-ai",
    "gate-timeout", "gate-photo", "gate-edit", "gate-manual", "gate-mode", "gate-preset", "stale-filter", "wrong-identity",
    "sdk-error", "no-change", "other-edit", "other-ai", "manual", "mask", "preference", "after-photo", "queue-photo", "missing-proof",
    "ai-update-needed", "ai-update-locked", "ai-update-unavailable"];
const onScenarios = scenarios.concat(["process-version", "preset-extra-edit", "void-return", "false-return", "delayed", "ai-settles", "ai-pending-after",
    "no-dust-after-processing", "no-dust-missing-completion", "no-dust-missing-preservation", "no-dust-wrong-token",
    "no-dust-result-photo", "no-dust-result-revision",
    "still-processing", "ai-update-locked-after", "ai-update-unavailable-after", "editing-feedback-error", "editing-feedback-unknown", "editing-feedback-missing"]);
const closeScenarios = ["success", "version", "missing-navigation", "pending-ai", "stale-filter", "wrong-identity", "sdk-error",
    "other-edit", "other-ai", "manual", "mask", "preference", "after-photo", "queue-photo", "missing-proof", "dust-changed", "closes-healing", "forged-confirmation", "false-return",
    "ai-update-needed", "ai-update-locked", "ai-update-unavailable", "no-treatment"];
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
        const initiallyApplied = name === "unknown-state" ? null : name === "already-target" ? enabling : !enabling && name !== "no-treatment";
        if (name === "unknown-state") {
            assert.equal(before.dust.available, false);
            assert.equal(before.dust.canEnable, true);
            assert.equal(before.dust.canDisable, true);
        }
        assert.equal(before.dustApply, initiallyApplied, name + ": " + JSON.stringify(before.dust));
        const admitted = await get("/remove/dust?" + q); assert.equal(admitted.dustApply, initiallyApplied);
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
        if (name === "no-dust-missing-completion") path = path.replace(/%22completionConfirmed%22%3Atrue/g, "%22completionConfirmed%22%3Afalse");
        if (name === "no-dust-missing-preservation") path = path.replace(/%22preservationConfirmed%22%3Atrue/g, "%22preservationConfirmed%22%3Afalse");
        if (name === "no-dust-wrong-token") path = path.replace(/%22token%22%3A%22[a-f0-9]+%22/g, "%22token%22%3A%22" + "b".repeat(64) + "%22");
        if (["no-dust-result-photo", "no-dust-result-revision"].includes(name)) {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: name.endsWith("photo") ? "other-photo" : "creation-photo", developFingerprint: "newer-edit" });
            await get(path, 409);
            const changed = await get("/remove/state");
            assert.equal(changed.pendingOperation, null);
            assert.equal(changed.dust, undefined, "Old Dust completion cannot populate a new context");
            sdk.run("assert(dustCalls==1)"); return;
        }
        await get(path); await get(path, 409);
        const after = await get("/remove/state");
        const success = ["success", "renamed-group", "helper-warning-group", "already-target", "void-return", "delayed", "ai-settles", "ai-pending-after", "no-treatment"].includes(name) || !enabling && name === "ai-update-needed";
        const notApplied = enabling && ["no-change", "no-dust-after-processing"].includes(name);
        const unknown = name === "unknown-state" || !enabling && !closing && name === "no-change" || enabling && ["still-processing", "ai-update-locked-after", "ai-update-unavailable-after", "editing-feedback-error", "editing-feedback-unknown", "editing-feedback-missing",
            "no-dust-missing-completion", "no-dust-missing-preservation", "no-dust-wrong-token"].includes(name);
        assert.equal(after.lastResult.outcome, success ? closing ? "requested" : "confirmed" : notApplied ? "not_applied" : unknown ? "unknown" : "failed", direction + ": " + name + ": " + after.lastResult.detail);
        assert.equal(after.pendingOperation, null, "Every terminal result releases the completed operation");
        assert.doesNotMatch(after.lastResult.detail, /No dust detected/i, "Absence of a filter is not a detection result");
        if (notApplied) {
            assert.equal(after.dustApply, false);
            assert.equal(after.dust.completionConfirmed, true);
            assert.equal(after.dust.preservationConfirmed, true);
            assert.match(after.lastResult.detail, /not applied.*ready for editing/i);
            sdk.run("assert(dustSleeps <= " + (name === "no-change" ? 3 : 6) + ", 'Must settle promptly after native editing readiness')");
        }
        if (name === "sdk-error" || name === "false-return") sdk.run("assert(dustSleeps==0, 'Explicit failures never wait for success')");
        const noCall = ["pending-ai", "ai-update-locked", "ai-update-unavailable", "gate-timeout", "gate-photo", "gate-edit", "gate-manual", "gate-mode", "gate-preset", "stale-filter", "wrong-identity"].includes(name) || enabling && name === "ai-update-needed";
        sdk.run("assert(dustCalls==" + (noCall ? 0 : 1) + ")");
        if (success) {
            const appliedAfter = enabling || closing && initiallyApplied;
            assert.equal(after.dustApply, appliedAfter); assert.equal(after.dust.preservationConfirmed, true);
            assert.equal(after.selectedTool, "dust"); assert.equal(after.dust.panelStateAvailable, false);
            sdk.run("assert(dustSettings.Exposure2012==0.7 and #dustSettings.FilterList.Filters==" + (appliedAfter ? 2 : 1) + " and manualPeopleSpots[1].X==0.4)");
            if (closing) assert.match(after.lastResult.detail, /panel state is not exposed/);
            if (["ai-pending-after", "ai-update-needed"].includes(name)) {
                assert.match(after.lastResult.detail, /AI settings.*need.*updat/i, "Confirmation must retain the AI update requirement");
                sdk.run("assert(dustSleeps <= 2, 'An editable photo with stable treatment must settle promptly even when AI settings need updating')");
            }
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
