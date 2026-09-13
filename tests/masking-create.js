"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const types = require("../app/controller-masking-corrections").creationTypes;
const fengari = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

function runtime() {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    const run = source => {
        if (lauxlib.luaL_dostring(L, to_luastring(source)) !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(L, -1)));
    };
    run(fs.readFileSync(path.join(__dirname, "masking-create.lua"), "utf8"));
    return { run, close: () => lua.lua_close(L),
        set(name, value) { lua.lua_pushstring(L, to_luastring(value)); lua.lua_setglobal(L, to_luastring(name)); },
        result() { run("return takeResultUrl()"); const value = to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1); return value; },
        count() { lua.lua_getglobal(L, to_luastring("creationCalls")); const n = lua.lua_tonumber(L, -1); lua.lua_pop(L, 1); return n; }
    };
}

async function verify(type, scenario) {
    const log = console.log;
    console.log = function () {};
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    const sdk = runtime();
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const json = async suffix => { const r = await fetch(base + suffix); assert.equal(r.status, 200, suffix); return r.json(); };
    const applySdkResult = async () => {
        const url = new URL(sdk.result()); return json(url.pathname + url.search);
    };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: scenario });
        sdk.set("contextJson", JSON.stringify(context.getContextFields()));
        const initial = await json("/masking/state");
        sdk.set("maskingJson", JSON.stringify(initial));
        const { request } = await json("/masking/next"); assert.ok(request);
        sdk.set("queryJson", JSON.stringify(request)); sdk.run("fixtureQuery()"); await applySdkResult();
        const before = await json("/masking/state"); assert.equal(before.available, true); assert.equal(before.maskGroupCount, 0);
        const binding = new URLSearchParams({ selectedPhotoUuid: before.selectedPhotoUuid, contextCounter: before.contextCounter,
            developCounter: before.developCounter, contextChangedAt: before.contextChangedAt,
            serverEpoch: before.serverEpoch, stateRevision: before.revision });
        const route = "/masking/create?" + new URLSearchParams({ maskType: type.maskType, maskSubtype: type.maskSubtype }) + "&" + binding;
        assert.equal((await fetch(base + "/masking/create?maskType=brush&maskSubtype=subject&" + binding)).status, 400);
        assert.equal((await fetch(base + route + "&maskType=brush")).status, 400);
        const admitted = await json(route);
        assert.equal(admitted.pendingOperation.kind, "create");
        assert.equal((await fetch(base + route)).status, 409, "duplicate submission must not enqueue another creation");
        if (scenario === "queue-photo") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "next" });
            assert.equal(commands.getNextCommand(), null, "queued creation must be rejected after a photo change");
            assert.equal(sdk.count(), 0);
            return;
        }
        const command = commands.getNextCommand(); assert.equal(command.command, "masking.create");
        assert.equal(commands.getNextCommand(), null);
        assert.equal(command.expectedMaskCount, 0);
        assert.equal(commands.validateCommand({ ...command, maskSubtype: "invented" }), false);
        sdk.set("maskingJson", JSON.stringify(await json("/masking/state")));
        sdk.set("commandJson", JSON.stringify(command)); sdk.set("scenario", scenario);
        sdk.set("expectedType", type.maskType); sdk.set("expectedSubtype", type.maskSubtype);
        sdk.run("fixtureExecute()"); await applySdkResult();
        const after = await json("/masking/state");
        const outcome = scenario === "automatic" ? "confirmed" : scenario === "sdk-error" ? "failed" :
            scenario.includes("before") || scenario === "photo-during" ? "stale" : "started";
        assert.equal(after.lastResult.outcome, outcome, scenario + ": " + after.lastResult.detail);
        assert.equal(sdk.count(), scenario.includes("before") ? 0 : 1);
        assert.equal(after.pendingOperation, null);
        if (scenario === "automatic") {
            assert.equal(after.maskGroupCount, 1); assert.equal(after.selectedMaskGroupId, "new-mask");
            assert.equal(after.selectedMaskToolId, "new-tool");
        } else if (scenario === "multiple-interactive") assert.equal(after.maskGroupCount, 2);
        else if (scenario === "incomplete") assert.equal(after.available, false, "incomplete native inventory must remain unavailable");
        else if (outcome === "started") assert.equal(after.maskGroupCount, 0, "starting a tool must not fabricate a mask");
    } finally { sdk.close(); await bridge.stop(); console.log = log; }
}

if (require.main === module) (async () => {
    for (const type of types) await verify(type, type.instruction ? "interactive" : "automatic");
    await verify(types.find(t => t.maskSubtype === "people"), "multiple-interactive");
    for (const scenario of ["incomplete", "photo-before", "module-before", "photo-during", "sdk-error", "awaiting-ai", "queue-photo"]) {
        await verify(types.find(t => t.maskSubtype === "subject"), scenario);
    }
    console.log("Mask creation: all 12 SDK choices, actual HTTP/queue/Parser/Commands/Masking paths, authoritative selection, interactive/incomplete lifecycle, duplicate and stale-context guards passed (mock SDK).");
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runtime };
