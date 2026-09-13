"use strict";
const assert = require("node:assert/strict");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
const types = require("../app/controller-masking-corrections").creationTypes;

async function verify(value, scenario, type = types[6]) {
    const log = console.log;
    console.log = () => {};
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    const sdk = runtime();
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const json = async route => { const r = await fetch(base + route); assert.equal(r.status, 200, route); return r.json(); };
    const resultPath = () => { const url = new URL(sdk.result()); return url.pathname + url.search; };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: scenario });
        sdk.run("fixtureMasks(3, false, 2)");
        sdk.set("inversionMode", scenario); sdk.set("inversionType", type.maskType); sdk.set("inversionSubtype", type.maskSubtype);
        sdk.run("fixtureInversion(" + (value === null ? "nil" : value) + ", inversionMode, inversionType, inversionSubtype)");
        if (scenario === "no-component") sdk.run("fixtureNoComponentSelection()");
        if (scenario === "no-mask") sdk.run("fixtureNoMaskSelection()");
        sdk.set("contextJson", JSON.stringify(context.getContextFields()));
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        const { request } = await json("/masking/next");
        sdk.set("queryJson", JSON.stringify(request)); sdk.run("fixtureQuery()"); await json(resultPath());
        const before = await json("/masking/state");
        if (scenario === "native-poll") {
            let last = before;
            for (const changed of [false, true, false]) {
                if (changed) sdk.run("fixtureNativeInvert()");
                await new Promise(resolve => setTimeout(resolve, 420));
                sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
                const { request } = await json("/masking/next"); assert.ok(request);
                sdk.set("queryJson", JSON.stringify(request)); sdk.run("fixtureQuery()"); await json(resultPath());
                const next = await json("/masking/state");
                assert.equal(next.revision, last.revision + (changed ? 1 : 0), "native inversion changes semantic revision; identical polls do not");
                assert.equal(next.selectedMaskToolInverted, changed ? !last.selectedMaskToolInverted : last.selectedMaskToolInverted);
                last = next;
            }
            sdk.run("assert(inversionCalls == 0);fixtureInversionPreserved()"); return;
        }
        if (!["no-component", "no-mask"].includes(scenario)) {
            assert.equal(before.selectedMaskToolInverted, value);
            assert.equal(before.selectedMaskToolType, type.maskType);
        }
        const binding = new URLSearchParams({ selectedPhotoUuid: before.selectedPhotoUuid, contextCounter: before.contextCounter,
            developCounter: before.developCounter, contextChangedAt: before.contextChangedAt,
            serverEpoch: before.serverEpoch, stateRevision: before.revision });
        const route = "/masking/component/invert?selectedMaskGroupId=mask-2&selectedMaskToolId=tool-2&" + binding;
        assert.equal((await fetch(base + route + "&selectedMaskToolId=other")).status, 400);
        assert.equal((await fetch(base + route.replace("tool-2", "extra-2"))).status, 409);
        assert.equal((await fetch(base + route.replace("mask-2", "mask-1"))).status, 409);
        if (["no-component", "no-mask"].includes(scenario)) {
            assert.equal((await fetch(base + route)).status, 409); assert.equal(commands.getNextCommand(), null); return;
        }
        const admission = await json(route);
        assert.equal(admission.pendingOperation.beforeSelectedMaskId, "mask-2");
        assert.equal(admission.pendingOperation.beforeSelectedMaskToolId, "tool-2");
        assert.equal((await fetch(base + route)).status, 409);
        if (scenario.startsWith("queue-")) {
            context.updateContext({ activeModule: scenario === "queue-module" ? "library" : "develop",
                selectedPhotoUuid: scenario === "queue-photo" ? "other-photo" : "creation-photo", developFingerprint: "changed" });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(inversionCalls == 0)"); return;
        }
        const command = commands.getNextCommand();
        assert.equal(command.command, "masking.component.invert"); assert.equal(command.expectedInverted, value);
        assert.equal(commands.getNextCommand(), null);
        for (const changes of [{ expectedInverted: "false" }, { expectedSelectedMaskToolId: null },
            { expectedSelectedMaskId: null }, { extra: true }]) assert.equal(commands.validateCommand({ ...command, ...changes }), false);
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        sdk.set("commandJson", JSON.stringify(command)); sdk.run("fixtureExecute()");
        const path = resultPath(), url = new URL(base + path);
        assert.equal(url.searchParams.get("targetMaskId"), "mask-2"); assert.equal(url.searchParams.get("targetToolId"), "tool-2");
        if (scenario.startsWith("forged-")) {
            if (scenario === "forged-target") url.searchParams.set("targetToolId", "extra-2");
            if (scenario === "forged-missing-target") { url.searchParams.delete("targetMaskId"); url.searchParams.delete("targetToolId"); }
            if (scenario === "forged-state") url.searchParams.set("selectedMaskToolInverted", String(value));
            if (scenario === "forged-confirmed") url.searchParams.set("outcome", "confirmed");
            if (scenario === "forged-requested") url.searchParams.set("outcome", "requested");
            const r = await fetch(url); assert.equal(r.status, scenario.includes("target") ? 409 : 200);
            if (scenario.includes("target")) return;
        } else await json(path);
        assert.equal((await fetch(base + path)).status, 409);
        const after = await json("/masking/state");
        assert.equal((await fetch(base + route)).status, 409, "the original command cannot be replayed after settlement");
        const expected = scenario.startsWith("forged-") || ["no-change", "sdk-error", "unreadable-after", "malformed-after"].includes(scenario) ? "failed" :
            scenario.endsWith("before") || scenario.endsWith("during") ? "stale" : value === null ? "requested" : "confirmed";
        assert.equal(after.lastResult.outcome, expected, scenario + ": " + after.lastResult.detail);
        assert.equal(after.lastResult.targetMaskId, "mask-2"); assert.equal(after.lastResult.targetToolId, "tool-2");
        assert.equal(after.pendingOperation, null);
        sdk.run("assert(inversionCalls == " + (scenario.endsWith("before") ? 0 : 1) + ");fixtureInversionPreserved()");
        if (expected === "confirmed") {
            assert.equal(after.selectedMaskToolInverted, !value); assert.equal(after.selectedMaskToolId, "tool-2");
            assert.equal(after.maskGroupCount, 3); assert.equal(after.selectedMaskToolCount, 2);
        }
        if (expected === "requested") assert.equal(after.selectedMaskToolInverted, null);
    } finally { sdk.close(); await bridge.stop(); console.log = log; }
}
(async () => {
    let count = 0;
    for (const type of types) for (const value of [false, true]) { await verify(value, "ordinary", type); count++; }
    for (const scenario of ["native-poll", "delayed", "photo-before", "mask-before", "component-before", "inverted-before", "photo-during",
        "module-during", "mask-during", "component-during", "sdk-error", "no-change", "unreadable-after", "malformed-after",
        "queue-photo", "queue-module", "queue-develop", "no-mask", "no-component", "forged-target", "forged-missing-target",
        "forged-state", "forged-requested"]) { await verify(false, scenario); count++; }
    for (const scenario of ["unknown", "forged-confirmed"]) { await verify(null, scenario); count++; }
    console.log("Component inversion: " + count + " HTTP/queue/Parser/Commands/Lua scenarios passed with a mocked SDK.");
})().catch(error => { console.error(error); process.exitCode = 1; });
