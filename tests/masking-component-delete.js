"use strict";
const assert = require("node:assert/strict");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
let count = 0;

async function verify(scenario, toolCount = 3, toolIndex = 2, maskCount = 3, maskIndex = 2) {
    count++;
    const log = console.log; console.log = () => {};
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    const sdk = runtime(); await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const json = async suffix => { const r = await fetch(base + suffix); assert.equal(r.status, 200, suffix); return r.json(); };
    const deliver = async () => { const url = new URL(sdk.result()); return json(url.pathname + url.search); };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: scenario });
        sdk.run(`fixtureComponentMasks(${maskCount}, ${toolCount}, ${toolIndex}, ${maskIndex})`);
        if (scenario === "no-component") sdk.run("fixtureNoComponentSelection()");
        if (scenario === "no-mask") sdk.run("fixtureNoMaskSelection()");
        sdk.set("contextJson", JSON.stringify(context.getContextFields()));
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        sdk.set("queryJson", JSON.stringify((await json("/masking/next")).request)); sdk.run("fixtureQuery()"); await deliver();
        const before = await json("/masking/state");
        const binding = new URLSearchParams({ selectedPhotoUuid: before.selectedPhotoUuid, contextCounter: before.contextCounter,
            developCounter: before.developCounter, contextChangedAt: before.contextChangedAt, serverEpoch: before.serverEpoch, stateRevision: before.revision });
        const maskId = "mask-" + maskIndex, toolId = "component-" + toolIndex;
        const route = "/masking/component/delete?selectedMaskGroupId=" + maskId + "&selectedMaskToolId=" + toolId + "&" + binding;
        assert.equal((await fetch(base + route.replace("selectedMaskGroupId=" + maskId, "selectedMaskGroupId=wrong"))).status, 409);
        assert.equal((await fetch(base + route.replace("selectedMaskToolId=" + toolId, "selectedMaskToolId=wrong"))).status, 409);
        assert.equal((await fetch(base + route + "&selectedMaskToolId=duplicate")).status, 400);
        if (["no-component", "no-mask"].includes(scenario)) {
            assert.equal((await fetch(base + route)).status, 409); assert.equal(commands.getNextCommand(), null); return;
        }
        const admission = await json(route);
        assert.equal(admission.pendingOperation.kind, "deleteComponent");
        assert.equal(admission.pendingOperation.beforeSelectedMaskId, maskId);
        assert.equal(admission.pendingOperation.beforeSelectedMaskToolId, toolId);
        assert.equal((await fetch(base + route)).status, 409);
        if (scenario.startsWith("queue-")) {
            context.updateContext({ activeModule: scenario === "queue-module" ? "library" : "develop",
                selectedPhotoUuid: scenario === "queue-photo" ? "other-photo" : "creation-photo", developFingerprint: "changed" });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(componentDeletionCalls == 0)"); return;
        }
        const command = commands.getNextCommand(); assert.equal(commands.getNextCommand(), null);
        assert.equal(command.command, "masking.component.delete");
        assert.equal(command.expectedSelectedMaskId, maskId); assert.equal(command.expectedSelectedMaskToolId, toolId);
        assert.equal(command.expectedMaskToolCount, toolCount);
        for (const altered of [{ expectedSelectedMaskId: null }, { expectedSelectedMaskToolId: null }, { expectedMaskToolCount: 0 }, { extra: true }]) {
            assert.equal(commands.validateCommand({ ...command, ...altered }), false);
        }
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state"))); sdk.set("commandJson", JSON.stringify(command));
        sdk.set("scenario", ["selection-error", "component-error", "selection-no-effect", "photo-in-selection", "photo-in-component"].includes(scenario) ? scenario : "component-delete");
        sdk.set("componentDeleteScenario", ["selection-error", "selection-no-effect", "user-before-component", "photo-in-selection"].includes(scenario) ? "no-mask-selection" :
            scenario === "server-photo-after-removal" ? "photo-before-selection" : scenario === "forged-confirmed" ? "no-change" : scenario);
        if (scenario === "user-before-component") sdk.set("componentDeleteScenario", scenario);
        sdk.run("fixtureExecute()");
        const url = new URL(sdk.result());
        assert.equal(url.searchParams.get("targetMaskId"), maskId); assert.equal(url.searchParams.get("targetToolId"), toolId);
        const initiallyDeleted = ["confirmed", "deleted"].includes(url.searchParams.get("outcome"));
        if (initiallyDeleted) {
            assert.ok(url.searchParams.has("deletionBefore") && url.searchParams.has("deletionAfter"));
            assert.ok(url.searchParams.has("componentBefore") && url.searchParams.has("componentAfter"));
            assert.equal(url.searchParams.get("componentBefore").split(",").length, toolCount);
            assert.equal(url.searchParams.get("componentAfter").split(",").filter(Boolean).includes(toolId), false);
        }
        if (scenario === "server-photo-after-removal") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "changed" });
            assert.equal(url.searchParams.get("outcome"), "deleted");
            assert.equal((await fetch(base + url.pathname + url.search)).status, 409); return;
        }
        if (scenario === "forged-confirmed") url.searchParams.set("outcome", "confirmed");
        if (scenario === "missing-proof") { url.searchParams.delete("componentBefore"); url.searchParams.delete("componentAfter"); }
        if (scenario === "invalid-proof") url.searchParams.set("componentAfter", "unrelated-component");
        if (scenario === "missing-target") { url.searchParams.delete("targetMaskId"); url.searchParams.delete("targetToolId"); }
        if (scenario === "wrong-target") url.searchParams.set("targetToolId", "other-tool");
        if (scenario === "forged-selection") { url.searchParams.set("outcome", "confirmed"); url.searchParams.set("selectedMaskToolId", toolId); }
        const result = await fetch(base + url.pathname + url.search);
        const rejected = ["missing-proof", "invalid-proof", "missing-target", "wrong-target", "forged-confirmed"].includes(scenario);
        assert.equal(result.status, rejected ? 409 : 200, scenario + ": " + await result.text());
        assert.equal((await fetch(base + url.pathname + url.search)).status, 409, "duplicate results cannot settle twice");
        const after = await json("/masking/state");
        const beforeWrite = ["photo-before", "module-before", "mask-before", "component-before", "inventory-before"].includes(scenario);
        const stale = beforeWrite || ["photo-during", "module-during"].includes(scenario);
        const failure = rejected || ["sdk-error", "no-change", "wrong-component", "wrong-parent", "collateral"].includes(scenario);
        const partial = ["selection-error", "component-error", "selection-no-effect", "photo-before-selection", "inventory-after", "user-mask-only",
            "photo-in-selection", "photo-in-component", "closed-during", "retain-empty-closed", "forged-selection"].includes(scenario);
        const outcome = stale ? "stale" : failure ? "failed" : partial ? "deleted" : "confirmed";
        assert.equal(after.lastResult.outcome, outcome, scenario + ": " + after.lastResult.detail);
        assert.equal(after.lastResult.targetMaskId, maskId); assert.equal(after.lastResult.targetToolId, toolId);
        assert.equal(after.pendingOperation, null);
        sdk.run(`assert(componentDeletionCalls == ${beforeWrite ? 0 : 1}) assert(deletionCalls == 0 and creationCalls == 0 and globalWrites == 0)`);
        sdk.run("assert(#selectionCalls <= 1 and #componentCalls <= 1)");
        if (outcome === "deleted" || outcome === "confirmed") {
            assert.equal(after.lastResult.remainingComponentCount, toolCount - 1);
            const parentRemoved = toolCount === 1 && !scenario.startsWith("retain-empty");
            assert.equal(after.lastResult.parentRemoved, parentRemoved);
            if (outcome === "deleted") assert.match(after.lastResult.detail, /[Cc]omponent.*deleted/);
            else {
                assert.equal(after.maskGroupCount, maskCount - (parentRemoved ? 1 : 0));
                if (parentRemoved) {
                    if (maskCount === 1) assert.notEqual(after.hasSelectedMaskGroup, true);
                    else assert.equal(after.selectedMaskGroupId, "mask-" + (maskIndex < maskCount ? maskIndex + 1 : maskIndex - 1));
                } else if (["native-other-mask", "user-before-selection", "user-before-component"].includes(scenario)) {
                    assert.equal(after.selectedMaskGroupId, "mask-1"); assert.equal(after.selectedMaskToolId, "extra-1");
                    sdk.run("assert(#componentCalls == 0)");
                } else {
                    assert.equal(after.selectedMaskGroupId, maskId); assert.equal(after.selectedMaskToolCount, toolCount - 1);
                    if (toolCount === 1) assert.equal(after.selectedMaskToolAvailable, false);
                    else assert.equal(after.selectedMaskToolId, "component-" + (["native-selection", "user-component"].includes(scenario) ? 1 : toolIndex < toolCount ? toolIndex + 1 : toolIndex - 1));
                }
            }
        }
        if (scenario === "retain-empty" || toolCount === 1 && scenario === "ordinary") {
            sdk.set("maskingJson", JSON.stringify(after));
            sdk.set("queryJson", JSON.stringify((await json("/masking/next")).request));
            sdk.run("fixtureQuery()"); await deliver();
            const polled = await json("/masking/state");
            assert.equal(polled.available, true); assert.equal(polled.maskGroupCount, after.maskGroupCount);
            assert.equal(polled.selectedMaskToolCount, after.selectedMaskToolCount);
            if (scenario === "retain-empty") {
                const operate = async suffix => {
                    const state = await json("/masking/state");
                    const bound = new URLSearchParams({ selectedPhotoUuid: state.selectedPhotoUuid, contextCounter: state.contextCounter,
                        developCounter: state.developCounter, contextChangedAt: state.contextChangedAt, serverEpoch: state.serverEpoch,
                        stateRevision: state.revision });
                    await json(suffix + "&" + bound);
                    sdk.set("commandJson", JSON.stringify(commands.getNextCommand()));
                    sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
                    sdk.run("fixtureExecute()"); await deliver();
                    const result = await json("/masking/state");
                    assert.equal(result.lastResult.outcome, "confirmed", suffix + ": " + result.lastResult.detail);
                    return result;
                };
                await operate("/masking/panel?open=false");
                let reopened = await operate("/masking/panel?open=true");
                assert.equal(reopened.selectedMaskGroupId, maskId); assert.equal(reopened.selectedMaskToolCount, 0);
                if (maskCount > 1) {
                    await operate("/masking/group/navigate?direction=previous");
                    reopened = await operate("/masking/group/navigate?direction=next");
                    assert.equal(reopened.selectedMaskGroupId, maskId); assert.equal(reopened.selectedMaskToolCount, 0);
                }
                sdk.run("assert(componentDeletionCalls == 1 and deletionCalls == 0)");
            }
        }
    } finally { sdk.close(); await bridge.stop(); console.log = log; }
}

(async () => {
    for (const index of [1, 2, 3]) for (const scenario of ["ordinary", "empty-selection", "deleted-selection"]) await verify(scenario, 3, index);
    for (const scenario of ["no-component", "no-mask", "no-mask-selection", "native-selection", "native-other-mask", "photo-before", "module-before",
        "mask-before", "component-before", "inventory-before", "photo-during", "module-during", "sdk-error", "no-change", "wrong-component", "wrong-parent",
        "collateral", "selection-error", "component-error", "selection-no-effect", "photo-before-selection", "user-before-selection", "user-component",
        "user-before-component", "user-mask-only", "inventory-after", "photo-in-selection", "photo-in-component", "closed-during", "server-photo-after-removal",
        "missing-proof", "invalid-proof", "missing-target", "wrong-target", "forged-confirmed", "forged-selection", "queue-photo", "queue-module", "queue-develop"]) await verify(scenario);
    for (const maskIndex of [1, 2, 3]) await verify("ordinary", 1, 1, 3, maskIndex);
    await verify("ordinary", 1, 1, 1, 1);
    for (const scenario of ["retain-empty", "retain-empty-closed"]) { await verify(scenario, 1, 1); await verify(scenario, 1, 1, 1, 1); }
    console.log("Delete Component: " + count + " HTTP/queue/Parser/Lua scenarios passed (mock SDK): removal/target proof, next/previous/native selection, parent removal and retained empty parent, duplicate and context safeguards.");
})().catch(error => { console.error(error); process.exitCode = 1; });
