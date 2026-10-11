"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const root = process.env.LRBRIDGE_RESET_TEST_ROOT || path.resolve(__dirname, "..");
const pluginRoot = process.env.LRBRIDGE_RESET_PLUGIN_ROOT || path.join(root, "lightroom/LRBridge.lrplugin");
const commands = require(path.join(root, "server/commands")), context = require(path.join(root, "server/context"));
const { createBridge } = require(path.join(root, "server/bridge")), definition = require(path.join(root, "server/reset-completion"));
let serial = 0;
function runtime(respond) {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    const run = source => {
        if (lauxlib.luaL_dostring(L, to_luastring(source)) !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(L, -1)));
    };
    function set(name, value) { lua.lua_pushstring(L, to_luastring(value)); lua.lua_setglobal(L, to_luastring(name)); }
    function get(name) {
        lua.lua_getglobal(L, to_luastring(name));
        const value = lua.lua_isnil(L, -1) ? null : lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : to_jsstring(lua.lua_tostring(L, -1));
        lua.lua_pop(L, 1); return value;
    }
    lua.lua_pushcfunction(L, state => {
        const result = respond(to_jsstring(lua.lua_tostring(state, 1)));
        lua.lua_pushstring(state, to_luastring(typeof result === "string" ? result : JSON.stringify(result)));
        return 1;
    }); lua.lua_setglobal(L, to_luastring("respond"));
    set("pluginRoot", pluginRoot.replaceAll("\\", "/"));
    set("feedbackSource", fs.readFileSync(path.join(pluginRoot, "FeedbackPolling.lua"), "utf8"));
    run(fs.readFileSync(path.join(__dirname, "reset-completion.lua"), "utf8"));
    return { run, set, get, close() { lua.lua_close(L); } };
}
const ctx = () => ({ activeModule: "develop", selectedPhotoUuid: "reset-photo", contextCounter: 5, contextChangedAt: 1234, developCounter: 7 });
const body = (c, slider = "Exposure", epoch = "reset-epoch") => ({ requestId: "reset-" + (++serial), serverEpoch: epoch, slider,
    selectedPhotoUuid: c.selectedPhotoUuid, contextCounter: c.contextCounter, contextChangedAt: c.contextChangedAt });
function workerScenario(slider, setup, expected, mode = "ordinary", precedingSet = true, followingSet = true, repeat = false) {
    commands.resetQueueForTests(); const c = ctx();
    context.updateContext({ activeModule: "develop", selectedPhotoUuid: "reset-photo", developFingerprint: "worker-" + serial });
    if (slider === "Temperature") require(path.join(root, "server/sliders")).setRuntimeRange(slider, 2000, 50000);
    const state = definition.createResetCompletion({ getContext: () => c, serverEpoch: "reset-epoch", enqueue: commands.tryEnqueueCommand });
    commands.setResetCompletionAdmissionProvider(state);
    const request = body(c, slider);
    let captured, dispatched;
    const sdk = runtime(url => {
        const u = new URL(url), input = Object.fromEntries(u.searchParams);
        if (u.pathname === "/next") { const cmd = commands.getNextCommand(); if (cmd?.operationId) dispatched = cmd; return { command: cmd }; }
        if (u.pathname === "/reset/claim") return { valid: state.claim(input) };
        if (u.pathname === "/reset/validate") return state.validate(input);
        if (u.pathname === "/reset/operation-result") {
            captured = { ...input, invoked: input.invoked === "true", resetSucceeded: input.resetSucceeded === "true" };
            for (const k of ["contextCounter", "contextChangedAt", "executionDevelopCounter", "sdkValue"]) if (captured[k] !== undefined) captured[k] = Number(captured[k]);
            return { ok: state.acceptResult(captured) };
        }
        throw Error("Unexpected mock route " + u.pathname);
    });
    try {
        if (precedingSet) assert(commands.enqueueCommand({ command: "develop.set", slider, value: slider === "Temperature" ? 4500 : 3 }));
        const admitted = state.admit(request); assert.equal(admitted.status, 202);
        assert.equal(admitted.receipt.phase, "queued"); assert.equal(admitted.receipt.result, null);
        assert.equal(state.admit(request).duplicate, true);
        if (followingSet) assert(commands.enqueueCommand({ command: "develop.set", slider, value: slider === "Temperature" ? 4800 : 2 }));
        const repeated = repeat ? body(c, slider) : null;
        if (repeated) assert.equal(state.admit(repeated).status, 202);
        sdk.set("scenario", mode); sdk.run(setup); sdk.run("runWorker()");
        if (mode === "shutdown") {
            assert.equal(state.get(request).phase, "executing");
            assert.equal(sdk.get("resets"), 0); assert.equal(sdk.get("reads"), 0);
            state.stop(); // A lost plug-in lifecycle cannot fabricate completion.
        }
        const result = state.get(request).result;
        for (const [k, v] of Object.entries(expected)) assert.equal(result?.[k], v, mode + " " + k + " " + JSON.stringify(result));
        if (mode === "ordinary") {
            sdk.run('local log = table.concat(events, "|"); assert(string.find(log, "reset:" .. ' + JSON.stringify(slider) + ', 1, true)); assert(_G.LRBridgeCommandBusy == false)');
            assert.equal(result.requestId, request.requestId); assert.equal(result.operationId, admitted.receipt.operationId);
            assert.equal(result.serverEpoch, request.serverEpoch); assert.equal(result.slider, slider);
            assert.equal(result.selectedPhotoUuid, request.selectedPhotoUuid); assert.equal(result.contextCounter, request.contextCounter);
            assert.equal(result.contextChangedAt, request.contextChangedAt); assert.equal(result.admittedDevelopCounter, c.developCounter);
            assert.equal(result.valueSource, "sdk");
            if (followingSet) sdk.run('local log = table.concat(events, "|"); assert(string.find(log, "|publish|set:", 1, true), log)');
            if (repeated) {
                const second = state.get(repeated).result;
                assert.equal(second.sdkValue, -0.83); assert.equal(second.requestId, repeated.requestId);
                assert.notEqual(second.operationId, result.operationId);
                assert.equal(state.get(request).result.sdkValue, 0.37, "A later Reset must not overwrite the first Reset's result");
                assert.equal(state.admit(repeated).duplicate, true);
            }
        }
        if (expected.outcome === "failed") assert.equal(sdk.get("reads"), 0, "A failed Reset cannot gain success from a later SDK read");
        assert.equal(state.admit(request).duplicate, true);
        assert.equal(commands.tryEnqueueCommand(dispatched).accepted, false); assert.equal(commands.tryEnqueueBatch([dispatched]).accepted, false);
        const before = sdk.get("resets") + sdk.get("writes");
        for (const bad of [JSON.stringify({ ...dispatched, extra: 1 }), JSON.stringify(dispatched).replace('"requestId":', '"slider":"Exposure","requestId":'),
            JSON.stringify({ ...dispatched, expectedContextCounter: -1 }), JSON.stringify({ ...dispatched, expectedContextCounter: 1.5 }),
            JSON.stringify({ ...dispatched, operationId: "nn-1" }), JSON.stringify({ ...dispatched, requestId: "bad id" }),
            JSON.stringify({ command: { ...dispatched, extra: 1 } }), JSON.stringify({ command: dispatched, extra: 1 }),
            '{"command":' + JSON.stringify(dispatched) + ',"command":' + JSON.stringify(dispatched) + '}']) {
            sdk.set("badJson", bad); sdk.run('assert(require("Parser").parse(badJson) == nil)');
        }
        sdk.set("commandJson", JSON.stringify({ command: dispatched })); sdk.run("executeJson()");
        sdk.set("commandJson", JSON.stringify(dispatched)); sdk.run("executeJson(); package.loaded.ResetCompletion = nil; package.loaded.Commands = nil; executeJson()");
        assert.equal(sdk.get("resets") + sdk.get("writes"), before, "One-use claim survives duplicate delivery and plug-in reload");
        return { result, captured };
    } finally { state.stop(); sdk.close(); commands.resetQueueForTests(); }
}
function receiptAndQueue() {
    commands.resetQueueForTests(); const c = ctx(); let clock = 0;
    const state = definition.createResetCompletion({ getContext: () => c, serverEpoch: "reset-epoch", now: () => clock, enqueue: commands.tryEnqueueCommand });
    commands.setResetCompletionAdmissionProvider(state);
    try {
        const a = body(c), b = body(c);
        commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 1 });
        state.admit(a); commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 2 });
        state.admit(b); commands.enqueueCommand({ command: "develop.reset", slider: "Exposure" });
        assert.equal(commands.getQueueDiagnostics().queue.pending.protected, 3, "Identified Resets retain protected Reset accounting");
        assert.deepEqual(Array.from({ length: 5 }, () => commands.getNextCommand().command),
            ["develop.set", "develop.reset.correlated", "develop.set", "develop.reset.correlated", "develop.reset"]);
        const ar = state.get(a), br = state.get(b); assert.notEqual(ar.operationId, br.operationId);
        const result = { ...a, operationId: ar.operationId, outcome: "observed", invoked: true, resetSucceeded: true,
            executionDevelopCounter: c.developCounter, sdkValue: 0.37 };
        assert.equal(state.acceptResult(result), false, "No result before execution claim");
        assert.equal(state.claim({ ...a, operationId: br.operationId }), false);
        assert.equal(state.claim({ ...a, operationId: ar.operationId }), true); assert.equal(state.claim({ ...a, operationId: ar.operationId }), false);
        for (const change of [{ slider: "Contrast" }, { selectedPhotoUuid: "other" }, { contextCounter: 6 }, { contextChangedAt: 1235 },
            { serverEpoch: "old" }, { requestId: b.requestId }, { operationId: br.operationId }, { resetSucceeded: false }, { invoked: false },
            { sdkValue: NaN }, { outcome: "failed" }]) assert.equal(state.acceptResult({ ...result, ...change }), false);
        c.developCounter += 1; assert.equal(state.acceptResult({ ...result, executionDevelopCounter: c.developCounter }), true,
            "Preceding Set or the Reset's own heartbeat may advance Develop revision");
        assert.equal(state.get(b).result, null, "Each receipt describes only its own Reset");
        assert.equal(state.acceptResult(result), false); assert.equal(state.admit(a).duplicate, true);
        assert.equal(state.admit({ ...a, slider: "Contrast" }).status, 409);
        const mut = state.get(a); mut.result.sdkValue = 999; assert.equal(state.get(a).result.sdkValue, 0.37);
        const delivery = body(c); state.admit(delivery); const deliveryCmd = commands.getNextCommand();
        state.claim({ ...delivery, operationId: deliveryCmd.operationId });
        const oldRevision = c.developCounter; c.developCounter += 1;
        assert.equal(state.acceptResult({ ...result, ...delivery, operationId: deliveryCmd.operationId, executionDevelopCounter: oldRevision }), false);
        assert.equal(state.get(delivery).result.outcome, "uncertain"); assert.equal(state.get(delivery).result.sdkValue, undefined);
        for (const field of ["selectedPhotoUuid", "contextCounter", "contextChangedAt", "activeModule"]) {
            const req = body(c); state.admit(req); const old = c[field]; c[field] = typeof old === "number" ? old + 1 : "other";
            assert.equal(commands.getNextCommand(), null); assert.equal(state.get(req).result.outcome, "stale");
            assert.equal(state.admit(req).duplicate, true); c[field] = old;
        }
        const expired = body(c); state.admit(expired); clock += definition.TIMEOUT_MS; state.syncAll();
        assert.equal(state.get(expired).result.outcome, "timeout"); assert.equal(commands.getNextCommand(), null);
        const uncertain = body(c); state.admit(uncertain); const cmd = commands.getNextCommand(); state.claim({ ...uncertain, operationId: cmd.operationId });
        c.contextCounter += 1; state.syncAll(); assert.equal(state.get(uncertain).result.outcome, "uncertain");
        assert.equal(state.acceptResult({ ...result, ...uncertain, operationId: cmd.operationId }), false); c.contextCounter -= 1;
        const claimedTimeout = body(c); state.admit(claimedTimeout); const timeoutCmd = commands.getNextCommand();
        state.claim({ ...claimedTimeout, operationId: timeoutCmd.operationId }); clock += definition.TIMEOUT_MS; state.syncAll();
        assert.equal(state.get(claimedTimeout).result.outcome, "uncertain"); assert.equal(state.admit(claimedTimeout).duplicate, true);
        const queued = body(c); state.admit(queued); state.stop(); assert.equal(state.get(queued).result.outcome, "stale");
        commands.resetQueueForTests();
        for (let i = 0; i < commands.HARD_QUEUE_CAPACITY; i++) commands.enqueueCommand({ command: "develop.action", action: "setAutoTone" });
        const full = body(c), refused = state.admit(full); assert.equal(refused.status, 503); assert.equal(refused.receipt.result.outcome, "unavailable");
        commands.resetQueueForTests(); assert.equal(state.admit(full).duplicate, true, "Rejected receipt must remain terminal on retry");
        const cap = definition.createResetCompletion({ getContext: () => c, serverEpoch: "reset-epoch", enqueue: () => ({ accepted: true }) });
        const first = body(c); cap.admit(first);
        for (let i = 1; i < definition.MAX_RECEIPTS; i++) assert.equal(cap.admit(body(c)).status, 202);
        assert.equal(cap.admit(body(c)).status, 503); assert.equal(cap.admit(first).duplicate, true); cap.stop();
        for (const change of [{ slider: "HDREditMode" }, { slider: "missing" }, { extra: 1 }, { requestId: "bad id" }, { contextCounter: -1 }]) {
            assert.equal(state.admit({ ...body(c), ...change }).status, 400);
        }
        assert.equal(state.admit(body(c, "Exposure", "old")).status, 409);
        assert.equal(state.get({ ...a, serverEpoch: "new" }), null);
    } finally { state.stop(); commands.resetQueueForTests(); }
}
async function queuedRaceHttp() {
    commands.resetQueueForTests(); const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    const sdk = runtime(() => { throw Error("No Reset worker should run before dispatch"); });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (route, status = 200) => { const r = await fetch(base + route); assert.equal(r.status, status, route); return r.json(); };
    const post = async (payload, status = 202, suffix = "") => {
        const r = await fetch(base + "/reset" + suffix, { method: "POST", headers: { "content-type": "application/json" }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
        assert.equal(r.status, status, await r.clone().text()); if (status < 300) assert.equal(r.headers.get("cache-control"), "no-store"); return r.json();
    };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "reset-photo", developFingerprint: "race-" + serial });
        const cap = await get("/reset/capabilities"), request = body(cap.context, "Exposure", cap.serverEpoch);
        assert.equal(cap.serverEpoch, (await get("/nudge/capabilities")).serverEpoch);
        await get("/set?slider=Exposure&value=2.75");
        const admitted = await post(request), receiptUrl = "/reset/result?" + new URLSearchParams({ serverEpoch: cap.serverEpoch, requestId: request.requestId });
        assert.equal((await post(request, 200)).duplicate, true); await post({ ...request, slider: "Contrast" }, 409);
        const read = (await get("/feedback/request?slider=Exposure&purpose=reset")).request;
        const dispatchedRead = await get("/feedback/next"); assert.equal(dispatchedRead.request.id, read.id);
        sdk.run("sdkValue = 4.2"); sdk.set("feedbackJson", JSON.stringify(dispatchedRead)); sdk.run("runFeedback(feedbackJson)");
        const u = new URL(sdk.get("feedbackUrl")); await get(u.pathname + u.search);
        const snapshot = (await get("/feedback/snapshot?id=" + read.id)).snapshot;
        assert.equal(snapshot.complete, true); assert.equal(snapshot.results.Exposure.value, 4.2, "Priority feedback reproduces PRE-RESET SDK value");
        assert.equal((await get(receiptUrl)).receipt.phase, "queued"); assert.equal((await get(receiptUrl)).receipt.result, null);
        sdk.run("assert(resets == 0 and writes == 0)");
        const key = { serverEpoch: cap.serverEpoch, requestId: request.requestId, operationId: admitted.receipt.operationId };
        assert.equal((await get("/reset/claim?" + new URLSearchParams(key))).valid, false, "A queued Reset cannot yet be claimed");
        assert.equal((await get("/next")).command.command, "develop.set");
        const reset = (await get("/next")).command; assert.equal(reset.command, "develop.reset.correlated");
        assert.equal((await get("/reset/claim?" + new URLSearchParams(key))).valid, true);
        assert.equal((await get("/reset/claim?" + new URLSearchParams(key))).valid, false);
        const result = { ...key, slider: "Exposure", selectedPhotoUuid: request.selectedPhotoUuid, contextCounter: request.contextCounter,
            contextChangedAt: request.contextChangedAt, outcome: "observed", invoked: true, resetSucceeded: true,
            executionDevelopCounter: reset.admittedDevelopCounter, sdkValue: 0.37 };
        await get("/reset/operation-result?" + new URLSearchParams({ ...result, resetSucceeded: false }), 409);
        await get("/reset/operation-result?" + new URLSearchParams(result));
        assert.equal((await get(receiptUrl)).receipt.result.sdkValue, 0.37);
        assert.equal((await post(request, 200)).receipt.phase, "complete");
        await get("/reset/operation-result?" + new URLSearchParams(result), 409);
        await get("/reset/result?" + new URLSearchParams({ ...key, serverEpoch: "old" }), 400);
        await get("/reset/result?serverEpoch=old&requestId=" + request.requestId, 404);
        await post("{", 400); await post("[]", 400); await post(JSON.stringify({ data: "x".repeat(2200) }), 413);
        await post(request, 400, "?unexpected=1");
        await get("/command?command=develop.reset.correlated&slider=Exposure", 400);
        // Legacy admission and Web Controller request shape remain byte-compatible.
        await get("/reset?slider=Contrast"); assert.equal((await get("/next")).command.command, "develop.reset");
        await get("/reset?slider=Vibrance");
        assert.equal((await get("/next")).command.command, "develop.reset");
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); }
}
async function verify() {
    const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
    try {
        receiptAndQueue(); await queuedRaceHttp();
        for (const [slider, value] of [["Exposure", 0.37], ["Contrast", 17], ["Vibrance", -23], ["Temperature", 6123], ["ProfileAmount", 137]]) {
            workerScenario(slider, "resetValue = " + value, { outcome: "observed", sdkValue: value, invoked: true, resetSucceeded: true });
        }
        workerScenario("Exposure", "resetValues = {0.37, -0.83}", { outcome: "observed", sdkValue: 0.37 }, "ordinary", true, true, true);
        workerScenario("Temperature", "sdkValue = -63; resetValue = -17", { outcome: "observed", sdkValue: -17 }, "ordinary", false, false);
        workerScenario("Exposure", "sdkValue = 4.2", { outcome: "uncertain", sdkValue: undefined }, "shutdown", false, false);
        for (const mode of ["reset-error", "reset-false"]) for (const slider of ["Exposure", "ProfileAmount"]) {
            workerScenario(slider, "sdkValue = 4.2", { outcome: "failed", invoked: true, resetSucceeded: false }, mode, false, false);
        }
        for (const mode of ["read-error", "read-nil"]) workerScenario("Exposure", "sdkValue = 4.2", { outcome: "unavailable", invoked: true, resetSucceeded: true }, mode, false, false);
        for (const mode of ["metadata-photo", "settings-photo", "preparation-photo", "preparation-module", "preparation-process", "validate-photo"]) {
            workerScenario("Exposure", "sdkValue = 4.2", { outcome: "stale", invoked: false }, mode, false, false);
        }
        for (const mode of ["reset-photo", "reset-process", "read-photo", "read-process", "publish-photo"]) {
            workerScenario("Exposure", "sdkValue = 4.2", { outcome: "uncertain", sdkValue: undefined, invoked: true }, mode, false, false);
        }
        for (const mode of ["preparation-profile", "tracking-photo"]) workerScenario("ProfileAmount", "sdkValue = 40", { outcome: "stale", invoked: false }, mode, false, false);
        workerScenario("ProfileAmount", "sdkValue = 40", { outcome: "uncertain", sdkValue: undefined }, "read-profile", false, false);
        for (const mode of ["disabled-profile", "camera-profile", "adaptive-disabled"]) workerScenario("ProfileAmount", "sdkValue = 40", { outcome: "unavailable", invoked: false }, mode, false, false);
    } finally { console.log = log; console.warn = warn; }
    console.log("Reset completion: exact queued-Reset/priority-reader race, production serial-worker Set→Reset→SDK read→result→Set ordering, non-default Exposure/Contrast/Vibrance/Temperature/Profile Amount, retries/reload/correlation, SDK failures, stale ownership, FIFO replacement boundaries and bounded receipt lifecycle passed. Native Reset timing remains unverified.");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verify, runtime };
