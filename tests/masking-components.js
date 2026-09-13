"use strict";
const assert = require("node:assert/strict");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
const types = require("../app/controller-masking-corrections").creationTypes;

async function verify(kind, type, scenario) {
    const log = console.log;
    console.log = () => {};
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    const sdk = runtime();
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const json = async suffix => { const r = await fetch(base + suffix); assert.equal(r.status, 200, suffix); return r.json(); };
    const sdkResult = async () => { const url = new URL(sdk.result()); return json(url.pathname + url.search); };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: scenario });
        sdk.run("fixtureMasks(3, " + (scenario === "closed") + ", 2)");
        if (scenario === "no-component") sdk.run("fixtureNoComponentSelection()");
        if (scenario === "no-mask") sdk.run("fixtureNoMaskSelection()");
        sdk.set("contextJson", JSON.stringify(context.getContextFields()));
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        const { request } = await json("/masking/next");
        sdk.set("queryJson", JSON.stringify(request)); sdk.run("fixtureQuery()"); await sdkResult();
        const before = await json("/masking/state");
        const binding = new URLSearchParams({ selectedPhotoUuid: before.selectedPhotoUuid, contextCounter: before.contextCounter,
            developCounter: before.developCounter, contextChangedAt: before.contextChangedAt,
            serverEpoch: before.serverEpoch, stateRevision: before.revision });
        const prefix = "/masking/component/" + kind + "?";
        const route = prefix + new URLSearchParams({ maskType: type.maskType, maskSubtype: type.maskSubtype,
            selectedMaskGroupId: "mask-2" }) + "&" + binding;
        assert.equal((await fetch(base + prefix + "maskType=brush&maskSubtype=subject&selectedMaskGroupId=mask-2&" + binding)).status, 400);
        assert.equal((await fetch(base + route + "&maskType=brush")).status, 400);
        assert.equal((await fetch(base + route.replace("selectedMaskGroupId=mask-2", "selectedMaskGroupId=mask-1"))).status, 409);
        if (scenario === "closed" || scenario === "no-mask") {
            assert.equal((await fetch(base + route)).status, 409); assert.equal(commands.getNextCommand(), null); return;
        }
        const admitted = await json(route);
        assert.equal(admitted.pendingOperation.kind, kind);
        assert.equal(admitted.pendingOperation.beforeSelectedMaskId, "mask-2", "real public admission carries the bound mask");
        assert.equal(admitted.pendingOperation.maskType, type.maskType);
        assert.equal(admitted.pendingOperation.maskSubtype, type.maskSubtype);
        assert.equal((await fetch(base + route)).status, 409, "duplicate must not enqueue twice");
        if (scenario.startsWith("queue-")) {
            const change = scenario === "queue-photo" ? { selectedPhotoUuid: "other-photo" } :
                scenario === "queue-module" ? { activeModule: "library" } : { developFingerprint: "changed" };
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", ...change });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(componentCreationCalls == 0)"); return;
        }
        const command = commands.getNextCommand();
        assert.equal(command.command, "masking.component." + kind);
        assert.equal(command.expectedMaskCount, 3); assert.equal(command.expectedMaskToolCount, 2);
        assert.equal(command.expectedSelectedMaskId, "mask-2");
        assert.equal(commands.getNextCommand(), null);
        assert.equal(commands.validateCommand({ ...command, expectedSelectedMaskId: null }), false);
        assert.equal(commands.validateCommand({ ...command, maskSubtype: "invented" }), false);
        assert.equal(commands.validateCommand({ ...command, expectedMaskToolCount: 2048 }), false);
        assert.equal(commands.validateCommand({ ...command, extra: true }), false);
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        sdk.set("commandJson", JSON.stringify(command));
        sdk.set("scenario", scenario === "no-component" ? "automatic" : scenario);
        sdk.set("expectedKind", kind); sdk.set("expectedType", type.maskType); sdk.set("expectedSubtype", type.maskSubtype);
        sdk.run("fixtureExecute()");
        const url = new URL(sdk.result());
        let resultPath = url.pathname + url.search;
        if (scenario === "forged-result") {
            url.searchParams.set("outcome", "confirmed");
            resultPath = url.pathname + url.search;
        }
        await json(resultPath);
        assert.equal((await fetch(base + resultPath)).status, 409, "a duplicate result cannot settle another operation");
        const after = await json("/masking/state");
        const outcome = ["automatic", "no-component"].includes(scenario) ? "confirmed" :
            scenario.includes("before") || scenario.endsWith("during") ? "stale" :
            ["sdk-error", "replace-old", "wrong-group", "forged-result"].includes(scenario) ? "failed" : "started";
        assert.equal(after.lastResult.outcome, outcome, kind + "/" + scenario + ": " + after.lastResult.detail);
        assert.equal(after.pendingOperation, null);
        sdk.run("assert(componentCreationCalls == " + (scenario.includes("before") ? 0 : 1) + ")");
        sdk.run("assert(creationCalls == 0 and deletionCalls == 0 and globalWrites == 0 and #selectionCalls == 0 and #componentCalls == 0)");
        if (outcome === "confirmed") {
            assert.equal(after.maskGroupCount, 3); assert.equal(after.selectedMaskGroupId, "mask-2");
            assert.equal(after.selectedMaskToolCount, 3); assert.equal(after.selectedMaskToolId, "new-component");
        }
        if (scenario === "interactive") assert.equal(after.selectedMaskToolCount, 2, "no optimistic component");
        if (scenario === "incomplete") assert.equal(after.available, false);
        if (scenario === "multiple-interactive") assert.equal(after.selectedMaskToolCount, 4);
    } finally { sdk.close(); await bridge.stop(); console.log = log; }
}

(async () => {
    let count = 0;
    for (const kind of ["add", "subtract"]) {
        for (const type of types) { await verify(kind, type, type.instruction ? "interactive" : "automatic"); count++; }
        for (const scenario of ["no-component", "no-mask", "closed", "incomplete", "photo-before", "module-before", "selection-before",
            "mask-before-call", "component-before-call", "components-before-call", "module-before-call", "photo-during", "module-during", "mask-during",
            "sdk-error", "replace-old", "wrong-group", "old-selected", "awaiting-ai", "forged-result", "queue-photo", "queue-module", "queue-develop"]) {
            await verify(kind, types[0], scenario); count++;
        }
        for (const scenario of ["interactive-entry", "multiple-interactive"]) { await verify(kind, types[3], scenario); count++; }
    }
    console.log("Add/Subtract: " + count + " real HTTP/queue/Parser/Commands/Lua scenarios passed with a mocked SDK; all 12 types, original-mask binding, inventory/selection, interactive lifecycle, duplicate and stale-context guards.");
})().catch(error => { console.error(error); process.exitCode = 1; });
