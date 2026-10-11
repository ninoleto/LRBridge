"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const runtimeRoot = process.env.LRBRIDGE_NUDGE_TEST_ROOT || path.resolve(__dirname, "..");
const pluginRoot = process.env.LRBRIDGE_NUDGE_PLUGIN_ROOT || path.join(runtimeRoot, "lightroom/LRBridge.lrplugin");
const commands = require(path.join(runtimeRoot, "server/commands")), context = require(path.join(runtimeRoot, "server/context"));
const { createBridge } = require(path.join(runtimeRoot, "server/bridge")), definition = require(path.join(runtimeRoot, "server/numeric-nudge"));
function runtime(respond) {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    const run = source => { if (lauxlib.luaL_dostring(L, to_luastring(source)) !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(L, -1))); };
    const set = (name, value) => { lua.lua_pushstring(L, to_luastring(value)); lua.lua_setglobal(L, to_luastring(name)); };
    const get = name => { lua.lua_getglobal(L, to_luastring(name)); const value = lua.lua_isnil(L, -1) ? null :
        lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1); return value; };
    if (respond) {
        lua.lua_pushcfunction(L, state => {
            const value = respond(to_jsstring(lua.lua_tostring(state, 1)));
            lua.lua_pushstring(state, to_luastring(value)); return 1;
        }); lua.lua_setglobal(L, to_luastring("respond"));
    }
    set("pluginRoot", pluginRoot.replaceAll("\\", "/"));
    run(fs.readFileSync(path.join(__dirname, "numeric-nudge.lua"), "utf8"));
    return { run, set, get, result() { return get("resultUrl"); }, close() { lua.lua_close(L); } };
}
let serial = 0;
async function scenario(slider, steps, setup, expected, mode = "ordinary", prefix = null) {
    commands.resetQueueForTests();
    const sdk = runtime(), bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (route, status = 200) => { const r = await fetch(base + route); assert.equal(r.status, status, route); return r.json(); };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "nudge-photo", developFingerprint: "nudge-" + (++serial) });
        const cap = await get("/nudge/capabilities");
        assert.equal(cap.sliders.find(s => s.id === "Exposure").numericStep, 0.01);
        assert(cap.sliders.some(s => s.id === "ProfileAmount"));
        if (prefix) await get(prefix);
        const body = { requestId: "test-" + serial, serverEpoch: cap.serverEpoch, slider, steps,
            selectedPhotoUuid: cap.context.selectedPhotoUuid, contextCounter: cap.context.contextCounter, contextChangedAt: cap.context.contextChangedAt };
        const post = async (payload = body, status = 202) => {
            const r = await fetch(base + "/nudge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
            assert.equal(r.status, status, await r.clone().text()); return r.json();
        };
        const receipt = (await post()).receipt;
        assert.equal((await post(body, 200)).duplicate, true);
        await post({ ...body, steps: [2] }, 409);
        sdk.run(setup); sdk.set("scenario", mode);
        const next = async () => { const r = await fetch(base + "/next"); assert.equal(r.status, 200); return r.text(); };
        let nextJson = await next(), c = JSON.parse(nextJson).command;
        if (prefix) {
            sdk.set("commandJson", nextJson); sdk.run("executeJson()");
            // Reset changes Develop revision before nudge dequeue. The relative
            // operation must rebase on the current value on the SAME photo.
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "nudge-photo", developFingerprint: "after-reset-" + serial });
            nextJson = await next(); c = JSON.parse(nextJson).command;
        }
        assert.equal(c.command, "develop.nudge"); assert.equal(await next(), '{"command":null}');
        assert.equal(commands.tryEnqueueCommand(c).accepted, false); assert.equal(commands.tryEnqueueBatch([c]).accepted, false);
        assert.equal(commands.validateCommand({ ...c, numericStep: 100 }), false);
        const key = new URLSearchParams({ serverEpoch: cap.serverEpoch, requestId: body.requestId, operationId: receipt.operationId });
        const beforeClaim = "/nudge/operation-result?" + key + "&outcome=observed&invoked=true&executionDevelopCounter=" + c.admittedDevelopCounter;
        await get(beforeClaim, 409);
        assert.equal((await get("/nudge/claim?" + key)).valid, true);
        assert.equal((await get("/nudge/claim?" + key)).valid, false);
        sdk.set("validateBody", JSON.stringify(await get("/nudge/validate?" + key)));
        sdk.set("commandJson", nextJson); sdk.run("executeJson()");
        const url = sdk.result(); assert(url, mode + " must produce a completion");
        const u = new URL(url); await get(u.pathname + u.search);
        await get(u.pathname + u.search, 409);
        const resultRoute = "/nudge/result?" + new URLSearchParams({ serverEpoch: cap.serverEpoch, requestId: body.requestId });
        const result = (await get(resultRoute)).receipt.result;
        for (const [k, v] of Object.entries(expected)) assert.equal(result[k], v, mode + " " + k + " " + JSON.stringify(result));
        assert.equal(result.slider, slider); assert.equal(result.selectedPhotoUuid, "nudge-photo");
        assert.equal(result.requestId, body.requestId); assert.equal(result.contextCounter, cap.context.contextCounter);
        if (result.sdkValue !== undefined) assert.equal(result.valueSource, "sdk");
        if (prefix) assert(result.executionDevelopCounter > result.admittedDevelopCounter);
        assert.equal((await post(body, 200)).receipt.phase, "complete");
        sdk.run("local before = writes; executeJson(); assert(writes == before); assert(increments == 0)");
        sdk.set("claimBody", '{"valid":false}');
        sdk.run("reloadNudge(); local before = writes; executeJson(); assert(writes == before)");
        // The production parser must reject malformed or oversized ordered batches.
        for (const steps of [[], [0], [1.5], [1001], Array(65).fill(1)]) {
            sdk.set("badJson", JSON.stringify({ ...c, steps })); sdk.run('assert(require("Parser").parse(badJson) == nil)');
        }
        for (const bad of [JSON.stringify(c).replace('"steps":[', '"steps":[,'), JSON.stringify({ ...c, extra: 1 }),
            JSON.stringify(c).replace('"requestId":', '"slider":"Exposure","requestId":')]) {
            sdk.set("badJson", bad); sdk.run('assert(require("Parser").parse(badJson) == nil)');
        }
        return result;
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); }
}
function workerEnvelope() {
    for (const [slider, baseline, expected, low, high] of [
        ["Exposure", 1.23, 1.24, -5, 5], ["Contrast", -17, -16, -100, 100],
        ["Vibrance", 37, 38, -100, 100], ["Temperature", 6123, 6124, 2000, 50000], ["ProfileAmount", 137, 138, 0, 200]
    ]) {
        commands.resetQueueForTests();
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "nudge-photo", developFingerprint: "envelope-" + (++serial) });
        const bridge = createBridge({ httpPort: 0, wsPort: 0 }); // Never start listeners in this regression.
        let dispatched;
        const invoke = (url, method = "get", body, status = 200) => {
            const u = new URL(url, "http://offline"), route = bridge.app.router.stack.find(s => s.route?.path === u.pathname && s.route.methods[method])?.route;
            assert(route, "Missing production route " + u.pathname);
            let json, code = 200;
            const res = { set() { return this; }, status(value) { code = value; return this; }, json(value) { json = JSON.stringify(value); return this; } };
            route.stack.at(-1).handle({ query: Object.fromEntries(u.searchParams), body }, res);
            assert.equal(code, status, u.pathname + " " + json);
            if (u.pathname === "/next" && JSON.parse(json).command?.command === "develop.nudge") dispatched = JSON.parse(json).command;
            return json;
        };
        const sdk = runtime(invoke);
        try {
            const cap = JSON.parse(invoke("/nudge/capabilities"));
            const body = { requestId: "envelope-" + serial, serverEpoch: cap.serverEpoch, slider, steps: [1, 1, -1],
                selectedPhotoUuid: cap.context.selectedPhotoUuid, contextCounter: cap.context.contextCounter, contextChangedAt: cap.context.contextChangedAt };
            const admitted = JSON.parse(invoke("/nudge", "post", body, 202)).receipt;
            assert.equal(admitted.phase, "queued"); assert.equal(admitted.result, null);
            assert.equal(JSON.parse(invoke("/nudge", "post", body)).duplicate, true);
            sdk.run(`sdkValue=${baseline}; sdkMin=${low}; sdkMax=${high}; runWorker()`);
            const resultRoute = "/nudge/result?" + new URLSearchParams({ serverEpoch: cap.serverEpoch, requestId: body.requestId });
            const receipt = JSON.parse(invoke(resultRoute)).receipt, result = receipt.result;
            assert.equal(receipt.phase, "complete", "The /next envelope must execute and complete, not leave a dispatched receipt");
            assert.equal(result.outcome, "observed"); assert.equal(result.baselineValue, baseline); assert.equal(result.sdkValue, expected);
            assert.equal(result.requestId, body.requestId); assert.equal(result.operationId, admitted.operationId); assert.equal(result.slider, slider);
            assert.equal(receipt.serverEpoch, cap.serverEpoch); assert.equal(result.selectedPhotoUuid, body.selectedPhotoUuid);
            assert.equal(result.contextCounter, body.contextCounter); assert.equal(result.contextChangedAt, body.contextChangedAt);
            assert.equal(result.admittedDevelopCounter, dispatched.admittedDevelopCounter); assert.equal(result.valueSource, "sdk");
            assert.equal(sdk.get("writes"), 1); assert.equal(sdk.get("increments"), 0);
            assert.equal(JSON.parse(invoke("/nudge", "post", body)).receipt.phase, "complete");
            sdk.set("commandJson", JSON.stringify({ command: dispatched })); sdk.run("executeJson(); reloadNudge(); executeJson()");
            assert.equal(sdk.get("writes"), 1, "Duplicate envelope and reload must not execute again");

            if (slider === "Exposure") {
                const inner = JSON.stringify(dispatched), wrap = json => '{"command":' + json + '}';
                const invalid = [wrap(JSON.stringify({ ...dispatched, extra: 1 })), '{"command":' + inner + ',"extra":1}',
                    '{"command":' + inner + ',"command":' + inner + '}', wrap(inner.replace('"steps":[', '"steps":[,')),
                    wrap(inner) + "x", wrap(JSON.stringify({ ...dispatched, steps: [{ count: 1 }] })), " ".repeat(4097) + wrap(inner)];
                for (const key of Object.keys(dispatched)) {
                    const missing = { ...dispatched }; delete missing[key]; invalid.push(wrap(JSON.stringify(missing)));
                    invalid.push(wrap(inner.replace('"' + key + '":', '"' + key + '":' + JSON.stringify(dispatched[key]) + ',"' + key + '":')));
                }
                for (const change of [{ operationId: "rc-1" }, { requestId: "bad id" }, { expectedSelectedPhotoUuid: "x".repeat(121) },
                    { expectedContextCounter: -1 }, { admittedDevelopCounter: 9007199254740992 }, { precision: 7 }, { numericStep: 0 }, { numericStep: 2 },
                    ...[[], [0], [1.5], [1001], Array(65).fill(1), Array(5).fill(1000)].map(steps => ({ steps }))]) invalid.push(wrap(JSON.stringify({ ...dispatched, ...change })));
                for (const json of invalid) { sdk.set("badJson", json); sdk.run('assert(require("Parser").parse(badJson) == nil)'); }
                sdk.set("commandJson", inner); sdk.run('assert(require("Parser").parse(commandJson).operationId == "' + admitted.operationId + '")');

                // Run each ordinary command through the unchanged /next worker path.
                sdk.set("scenario", "legacy-adjust");
                invoke("/set?slider=Exposure&value=1.23"); sdk.run("runWorker()"); assert.equal(sdk.get("sdkValue"), 1.23);
                invoke("/adjust?slider=Exposure&amount=2"); sdk.run("runWorker()"); assert.equal(sdk.get("increments"), 2); assert(Math.abs(sdk.get("sdkValue") - 1.25) < 1e-9);
                invoke("/reset?slider=Exposure"); sdk.run("runWorker()"); assert.equal(sdk.get("sdkValue"), 0.37); assert.equal(sdk.get("resets"), 1);
                const reset = { requestId: "envelope-reset-" + serial, serverEpoch: body.serverEpoch, slider: "Exposure",
                    selectedPhotoUuid: body.selectedPhotoUuid, contextCounter: body.contextCounter, contextChangedAt: body.contextChangedAt };
                invoke("/reset", "post", reset, 202); sdk.run("runWorker()");
                const resetReceipt = JSON.parse(invoke("/reset/result?" + new URLSearchParams({ serverEpoch: reset.serverEpoch, requestId: reset.requestId }))).receipt;
                assert.equal(resetReceipt.result.outcome, "observed"); assert.equal(resetReceipt.result.sdkValue, 0.37); assert.equal(sdk.get("resets"), 2);
                assert.equal(sdk.get("writes"), 2); assert.equal(invoke("/next"), '{"command":null}');
            }
        } finally { sdk.close(); commands.resetQueueForTests(); }
    }
}
function queueAndAdmission() {
    const ctx = { activeModule: "develop", selectedPhotoUuid: "nudge-photo", contextCounter: 1, contextChangedAt: 1, developCounter: 1 };
    let clock = 100;
    const state = definition.createNumericNudge({ serverEpoch: "epoch", getContext: () => ctx, now: () => clock, enqueue: commands.tryEnqueueCommand });
    commands.setNumericNudgeAdmissionProvider(state);
    const body = (steps = [1]) => ({ requestId: "req-" + (++serial), serverEpoch: "epoch", slider: "Exposure", steps, selectedPhotoUuid: ctx.selectedPhotoUuid, contextCounter: ctx.contextCounter, contextChangedAt: ctx.contextChangedAt });
    for (const sequence of [["reset", "nudge"], ["set", "nudge", "set"], ["reset", "nudge", "reset"], ["nudge", "nudge", "nudge"]]) {
        commands.resetQueueForTests(); const requests = [];
        for (const [i, kind] of sequence.entries()) {
            if (kind === "nudge") { const b = body([i % 2 ? -1 : 1]); requests.push(b); assert.equal(state.admit(b).status, 202); }
            else assert(commands.enqueueCommand({ command: "develop." + kind, slider: "Exposure", ...(kind === "set" ? { value: i } : {}) }));
        }
        assert.deepEqual(sequence.map(() => commands.getNextCommand().command), sequence.map(s => "develop." + s));
        assert.equal(commands.getNextCommand(), null);
        for (const b of requests) assert.equal(state.admit(b).duplicate, true);
    }
    // Coalescing still works on either side, including unrelated parameters that
    // might change a nudge baseline (e.g. White Balance and Temperature).
    commands.resetQueueForTests();
    commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 1 });
    commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 2 });
    assert.equal(state.admit(body()).status, 202);
    commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 3 });
    commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 4 });
    assert.equal(commands.getNextCommand().value, 2); assert.equal(commands.getNextCommand().command, "develop.nudge"); assert.equal(commands.getNextCommand().value, 4);
    for (const steps of [[], [0], [1.1], ["1"], [Infinity], [null], [1001], Array(65).fill(1), [1000, 1000, 1000, 1000, 97]]) assert.equal(state.admit(body(steps)).status, 400);
    for (const change of [{ slider: "HDREditMode" }, { slider: "unknown" }, { extra: 1 }, { contextCounter: -1 }, { requestId: "bad id" }]) assert.equal(state.admit({ ...body(), ...change }).status, 400);
    assert.equal(state.admit({ ...body(), serverEpoch: "old" }).status, 409);
    for (const field of ["selectedPhotoUuid", "contextCounter", "contextChangedAt", "activeModule"]) {
        commands.resetQueueForTests(); const b = body(); assert.equal(state.admit(b).status, 202);
        const old = ctx[field]; ctx[field] = typeof old === "number" ? old + 1 : "other";
        assert.equal(commands.getNextCommand(), null); assert.equal(state.get(b).result.outcome, "stale");
        assert.equal(state.admit(b).duplicate, true); ctx[field] = old;
    }
    const b = body(); const r = state.admit(b); const c = commands.getNextCommand();
    assert.equal(state.acceptResult({ ...b, operationId: c.operationId, outcome: "observed" }), false);
    assert.equal(state.claim({ ...b, operationId: c.operationId }), true);
    clock += 60001; assert.equal(state.get(b).result.outcome, "uncertain"); assert.equal(state.admit(b).duplicate, true);
    assert.equal(r.receipt.phase, "queued");
    commands.resetQueueForTests();
    // Queue-full refusal consumes no action and can be retried with the same ID.
    for (let i = 0; i < commands.ORDINARY_ADMISSION_CEILING; i++) commands.enqueueCommand({ command: "develop.get", slider: "Exposure" });
    const full = body(); assert.equal(state.admit(full).status, 503); commands.getNextCommand();
    assert.equal(state.admit(full).status, 202); commands.resetQueueForTests();
    // Receipt exhaustion never evicts an old ID and allows it to apply again.
    const small = definition.createNumericNudge({ serverEpoch: "epoch", getContext: () => ctx, enqueue: () => ({ accepted: true }) });
    const first = body(); small.admit(first);
    for (let i = 1; i < definition.MAX_RECEIPTS; i++) assert.equal(small.admit(body()).status, 202);
    assert.equal(small.admit(body()).status, 503); assert.equal(small.admit(first).duplicate, true);
}
async function httpInvalid() {
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    try {
        for (const [body, status] of [["{", 400], [JSON.stringify({ steps: "1".repeat(4200) }), 413], ["[]", 400], ["{}", 400]]) {
            const r = await fetch(base + "/nudge", { method: "POST", headers: { "content-type": "application/json" }, body }); assert.equal(r.status, status);
        }
        assert.equal((await fetch(base + "/command?command=develop.nudge&slider=Exposure")).status, 400);
    } finally { await bridge.stop(); }
}
async function verify() {
    const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
    try {
        workerEnvelope(); queueAndAdmission(); await httpInvalid();
        await scenario("Exposure", [1, 1, -1], "sdkValue = 4.5; sdkDefault = 0.37", { outcome: "observed", baselineValue: 0.37, requestedValue: 0.38, sdkValue: 0.38 }, "ordinary", "/reset?slider=Exposure");
        await scenario("Exposure", [-1, 1], "sdkValue = -5", { sdkValue: -4.99 });
        await scenario("Exposure", [1, -1], "sdkValue = 5", { sdkValue: 4.99 });
        await scenario("Exposure", [1, 1, 1], "sdkValue = 0.1", { sdkValue: 0.13 });
        await scenario("Exposure", [1], "sdkValue = 0.234", { sdkValue: 0.24 });
        await scenario("Exposure", [1], "sdkValue = 2", { baselineValue: 1.23, sdkValue: 1.24 }, "baseline-preparation");
        await scenario("Temperature", [-1, 1, 10], "sdkValue = 4400; sdkDefault = 6123; sdkMin = 2000; sdkMax = 50000", { baselineValue: 6123, sdkValue: 6133 }, "ordinary", "/reset?slider=Temperature");
        await scenario("Temperature", [-1, 1], "sdkValue = -100; sdkMin = -100; sdkMax = 100", { sdkValue: -99 });
        await scenario("ProfileAmount", [-1, 1, 3], "sdkValue = 40; sdkMin = -999; sdkMax = 999", { baselineValue: 100, min: 0, max: 200, sdkValue: 103 }, "ordinary", "/reset?slider=ProfileAmount");
        await scenario("ProfileAmount", [-1, 1], "sdkValue = 0", { sdkValue: 1 });
        await scenario("ProfileAmount", [1, -1], "sdkValue = 200", { sdkValue: 199 });
        for (const mode of ["unsupported-profile", "camera-profile", "adaptive-false", "adaptive-string-false"]) await scenario("ProfileAmount", [1], "sdkValue = 100", { outcome: "unavailable", invoked: false }, mode);
        await scenario("ProfileAmount", [1], "sdkValue = 100", { sdkValue: 101 }, "unknown-profile-support");
        await scenario("HDRMaxValue", [1], "sdkValue = 2.3; sdkMin = 1; sdkMax = 8", { sdkValue: 2.4 });
        await scenario("Exposure", [100, -1], "sdkValue = 0.95; sdkMin = -5; sdkMax = 5", { min: 0, max: 1, sdkValue: 0.99 }, "range-tracking");
        await scenario("ParametricShadowSplit", [20, -1], "sdkValue = 25; sdkMin = 10; sdkMax = 70; neighborValue = 45", { max: 35, sdkValue: 34 });
        for (const mode of ["read-unavailable", "range-unavailable", "read-error"]) await scenario("Exposure", [1], "sdkValue = 1", { outcome: "unavailable", invoked: false }, mode);
        for (const mode of ["photo-preparation", "module-preparation", "process-preparation", "photo-tracking", "photo-validate", "photo-read"]) await scenario("Exposure", [1], "sdkValue = 1", { outcome: "stale", invoked: false }, mode);
        for (const mode of ["profile-preparation", "profile-tracking"]) await scenario("ProfileAmount", [1], "sdkValue = 100", { outcome: "stale", invoked: false }, mode);
        await scenario("Exposure", [1], "sdkValue = 1", { outcome: "uncertain", invoked: true }, "write-error");
        await scenario("Exposure", [1], "sdkValue = 1", { outcome: "uncertain", invoked: true }, "photo-write");
        await scenario("Exposure", [1], "sdkValue = 1", { outcome: "requested", requestedValue: 1.01 }, "readback-unavailable");
        await scenario("Exposure", [1], "sdkValue = 1", { outcome: "observed", requestedValue: 1.01, sdkValue: 1, matchesRequested: false }, "write-no-effect");
    } finally { console.log = log; console.warn = warn; }
    console.log("Numeric nudge: actual /next envelopes through the serial worker to correlated SDK receipts, malformed-envelope rejection, legacy Set/Adjust/both Resets, ordered queue boundaries, HTTP/duplicate/receipt limits, mock SDK baselines, bounds, stale preparation and distinct SDK readback passed. Native Lightroom QA remains required.");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { runtime, verify };
