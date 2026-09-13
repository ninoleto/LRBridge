"use strict";
const assert = require("node:assert/strict");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
let scenarios = 0;

async function verify(kind, count, scenario, selectedIndex = count) {
    scenarios += 1;
    const log = console.log; console.log = () => {};
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    const sdk = runtime();
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const json = async suffix => { const r = await fetch(base + suffix); assert.equal(r.status, 200, suffix); return r.json(); };
    const apply = async outcome => {
        const url = new URL(sdk.result());
        if (outcome) url.searchParams.set("outcome", outcome);
        if (url.pathname === "/masking/operation-result") {
            if (scenario === "missing-proof") {
                url.searchParams.delete("deletionBefore"); url.searchParams.delete("deletionAfter");
            }
            if (scenario === "invalid-proof") url.searchParams.set("deletionAfter", "unrelated-mask");
            const response = await fetch(base + url.pathname + url.search);
            const body = await response.json();
            const diagnostics = await json("/diagnostics/masking-deletion");
            const received = diagnostics.events.find(e => e.event === "result-received");
            const reply = diagnostics.events.find(e => e.event === "result-response");
            assert.equal(diagnostics.version, "mask-delete-confirmation-1");
            assert.deepEqual(received.data.query, Object.fromEntries(url.searchParams), "retain the exact submitted fields, including proof");
            assert.equal(reply.data.status, response.status); assert.deepEqual(reply.data.body, body);
            if (outcome === "confirmed" && kind === "selected" || ["missing-proof", "invalid-proof"].includes(scenario)) {
                assert.equal(response.status, 409, "selection recovery cannot replace strict removal proof");
                assert.ok(diagnostics.events.some(e => e.event === "validation-rejected" &&
                    e.data.reason === (scenario === "invalid-proof" ? "removal-inventory-proof" : "missing-removal-proof")));
            } else assert.equal(response.status, 200);
            const state = diagnostics.state;
            await json("/diagnostics/masking-deletion-browser?report=" + encodeURIComponent(JSON.stringify({
                version: diagnostics.version, client: "fixture", sequence: 1, event: "render", kind: "deleteSelected",
                operationId: url.searchParams.get("operationId"), data: { status: "diagnostic only" }
            })));
            assert.deepEqual((await json("/diagnostics/masking-deletion")).state, state, "diagnostics cannot settle or refresh authoritative state");
            return;
        }
        if (outcome === "confirmed" && kind === "selected") {
            assert.equal((await fetch(base + url.pathname + url.search)).status, 409, "success without removal proof is rejected");
            return;
        }
        return json(url.pathname + url.search);
    };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: scenario });
        sdk.run("fixtureMasks(" + count + "," + (scenario === "closed") + "," + selectedIndex + ")");
        sdk.set("contextJson", JSON.stringify(context.getContextFields()));
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        const query = (await json("/masking/next")).request;
        sdk.set("queryJson", JSON.stringify(query));
        sdk.run("fixtureQuery()"); await apply();
        const before = await json("/masking/state"); assert.equal(before.maskGroupCount, count);
        const binding = new URLSearchParams({ selectedPhotoUuid: before.selectedPhotoUuid, contextCounter: before.contextCounter,
            developCounter: before.developCounter, contextChangedAt: before.contextChangedAt,
            serverEpoch: before.serverEpoch, stateRevision: before.revision });
        const route = "/masking/" + (kind === "selected" ? "selected/delete?selectedMaskGroupId=" + before.selectedMaskGroupId + "&" : "all/delete?") + binding;
        if (kind === "selected") assert.equal((await fetch(base + "/masking/selected/delete?selectedMaskGroupId=wrong&" + binding)).status, 409);
        assert.equal((await fetch(base + route + "&stateRevision=0")).status, 400);
        const admission = await json(route);
        if (kind === "selected") assert.equal(admission.pendingOperation.beforeSelectedMaskId, before.selectedMaskGroupId,
            "public admission must carry the selected target required by the browser");
        assert.equal((await fetch(base + route)).status, 409, "duplicate delete must not enqueue another command");
        if (scenario === "queue-photo") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "next" });
            assert.equal(commands.getNextCommand(), null);
            sdk.run("assert(deletionCalls == 0 and globalWrites == 0)"); return;
        }
        const command = commands.getNextCommand();
        assert.equal(command.command, "masking." + kind + ".delete");
        assert.equal(command.expectedMaskCount, count);
        assert.equal(commands.getNextCommand(), null);
        assert.equal(commands.validateCommand({ ...command, expectedMaskCount: 0 }), false);
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        sdk.set("commandJson", JSON.stringify(command)); sdk.set("scenario", scenario.startsWith("forged-") ? "no-change" :
            scenario === "server-photo-after-removal" ? "photo-before-selection" : scenario);
        sdk.run("fixtureEnableDeletionTrace()");
        sdk.run("fixtureExecute()");
        sdk.run('assert(#deletionTraceLines == 2) assert(string.find(deletionTraceLines[1], "version=mask-delete-confirmation-1", 1, true)) ' +
            'assert(string.find(deletionTraceLines[1], "phase=submitted", 1, true)) assert(string.find(deletionTraceLines[2], "pcall=true status=200 body=", 1, true))');
        if (scenario === "server-photo-after-removal") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "next" });
            const result = new URL(sdk.result());
            assert.equal(result.searchParams.get("outcome"), "deleted");
            assert.equal((await fetch(base + result.pathname + result.search)).status, 409, "old removal proof cannot overwrite a new photo context");
            sdk.run("assert(deletionCalls == 1 and #selectionCalls == 0 and #componentCalls == 0)"); return;
        }
        await apply(scenario === "forged-confirmed" ? "confirmed" : scenario === "forged-no-change" ? "no_change" : null);
        const after = await json("/masking/state");
        const beforeWrite = ["photo-before", "module-before", "count-before", "selection-before"].includes(scenario);
        const stale = beforeWrite || scenario === "photo-during";
        const failed = ["sdk-error", "no-change", "wrong-mask", "forged-confirmed", "forged-no-change", "missing-proof", "invalid-proof"].includes(scenario);
        const incomplete = ["selection-error", "component-error", "selection-no-effect", "photo-before-selection",
            "photo-before-component", "photo-in-selection", "photo-in-component", "inventory-before-selection"].includes(scenario);
        assert.equal(after.lastResult.outcome, stale ? "stale" : failed ? "failed" : incomplete ? "deleted" : "confirmed", scenario + ": " + after.lastResult.detail);
        assert.equal(after.pendingOperation, null);
        sdk.run("assert(deletionCalls == " + (beforeWrite ? 0 : 1) + ") assert(globalWrites == 0)");
        if (incomplete) {
            assert.match(after.lastResult.detail, /^Mask (?:was )?deleted/);
            assert.doesNotMatch(after.lastResult.detail, /try again|retry/i);
        }
        if (!stale && !failed && !incomplete) {
            assert.equal(after.maskGroupCount, kind === "all" ? 0 : count - 1);
            if (kind === "selected") assert.notEqual(after.selectedMaskGroupId, before.selectedMaskGroupId);
            if (after.maskGroupCount) assert.equal(after.selectedMaskToolCount, 2, "other masks retain all components");
            else assert.notEqual(after.hasSelectedMaskGroup, true);
            if (kind === "selected" && after.maskGroupCount) {
                const preserved = ["native-selection", "user-before-selection", "user-before-component"].includes(scenario);
                assert.equal(after.selectedMaskGroupId, "mask-" + (preserved ? 1 : selectedIndex < count ? selectedIndex + 1 : selectedIndex - 1));
                if (preserved) {
                    assert.equal(after.selectedMaskToolId, "extra-1");
                    sdk.run("assert(#componentCalls == 0)");
                    if (scenario !== "user-before-component") sdk.run("assert(#selectionCalls == 0)");
                }
            }
        }
        sdk.run("assert(#selectionCalls <= 1 and #componentCalls <= 1)");
        if (kind === "all" || count === 1 || scenario === "photo-before-selection") sdk.run("assert(#selectionCalls == 0 and #componentCalls == 0)");
        if (scenario === "photo-before-component" || scenario === "photo-in-selection") sdk.run("assert(#componentCalls == 0)");
        if (after.available && (after.maskGroupCount === 0 || scenario === "selection-no-effect")) {
            sdk.set("maskingJson", JSON.stringify(after));
            sdk.set("queryJson", JSON.stringify({ ...query, expectedMaskingRevision: after.revision }));
            sdk.run("pollSelectionCalls = #selectionCalls; pollComponentCalls = #componentCalls; fixtureQuery()");
            const polled = new URL(sdk.result()).searchParams;
            assert.equal(polled.get("available"), "true");
            assert.equal(Number(polled.get("maskGroupCount")), after.maskGroupCount);
            assert.equal(polled.get("hasSelectedMaskGroup"), after.active ? "false" : "null");
            sdk.run("assert(#selectionCalls == pollSelectionCalls and #componentCalls == pollComponentCalls)");
        }
    } finally { sdk.close(); await bridge.stop(); console.log = log; }
}

(async () => {
    if (process.argv.includes("--selection-only")) {
        await verify("selected", 3, "no-selection", 2); return;
    }
    if (process.argv.includes("--empty-selection-only")) {
        await verify("selected", 3, "empty-selection", 2); return;
    }
    await verify("selected", 2, "confirmed"); await verify("selected", 1, "last");
    await verify("all", 3, "confirmed"); await verify("all", 3, "closed");
    for (const kind of ["selected", "all"]) for (const scenario of ["photo-before", "module-before", "count-before", "photo-during", "sdk-error", "no-change", "queue-photo", "forged-confirmed", "forged-no-change"]) {
        await verify(kind, 2, scenario);
    }
    await verify("selected", 2, "selection-before"); await verify("selected", 2, "wrong-mask");
    await verify("selected", 2, "missing-proof"); await verify("selected", 2, "invalid-proof");
    for (const scenario of ["no-selection", "empty-selection", "deleted-selection"]) {
        for (const index of [1, 2, 3]) await verify("selected", 3, scenario, index);
        await verify("selected", 1, scenario);
        await verify("all", 3, scenario);
    }
    for (const scenario of ["native-selection", "user-before-selection", "user-before-component", "selection-error",
        "component-error", "selection-no-effect", "photo-before-selection", "photo-before-component", "photo-in-selection",
        "photo-in-component", "inventory-before-selection", "server-photo-after-removal"]) await verify("selected", 3, scenario, 2);
    console.log("Mask deletion: " + scenarios + " HTTP/queue/Lua scenarios passed; independent removal proof, next/previous replacement, native/user selection preservation, empty state, partial selection failures and context cancellation (mock SDK).");
})().catch(error => { console.error(error); process.exitCode = 1; });
