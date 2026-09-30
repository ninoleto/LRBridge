"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");

(async function () {
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40 });
    const wire = [];
    await bridge.start();
    try {
        const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "grain-photo", developFingerprint: "one" });
        const fields = context.getContextFields();
        const scope = "&preserveMaskingPanel=true&selectedPhotoUuid=grain-photo&contextCounter=" + fields.contextCounter;
        for (const slider of ["GrainSize", "GrainFrequency"]) {
            for (const route of ["/set?value=63&slider=", "/reset?slider="]) {
                const response = await fetch(base + route + slider + scope);
                assert.equal(response.status, 200);
                const command = commands.getNextCommand();
                assert.equal(command.preserveMaskingPanel, true);
                assert.equal(command.expectedSelectedPhotoUuid, "grain-photo");
                wire.push(JSON.stringify(command));
            }
        }
        for (const query of [
            "/set?slider=Exposure&value=1" + scope,
            "/reset?slider=GrainSize" + scope.replace("true", "false"),
            "/set?slider=GrainSize&value=37&preserveMaskingPanel=true",
            "/reset?slider=GrainFrequency" + scope.replace("grain-photo", "stale-photo"),
            "/set?slider=GrainSize&value=37" + scope + "&unexpected=1",
            "/set?slider=GrainSize&value=101" + scope,
            "/reset?slider=GrainSize&selectedPhotoUuid=grain-photo"
        ]) assert.equal((await fetch(base + query)).status, 400, query);
        assert.equal(commands.getNextCommand(), null);
        const masked = { command: "develop.set", slider: "GrainSize", value: 41, preserveMaskingPanel: true };
        assert.equal(commands.enqueueCommand(masked), true);
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "grain-photo", developFingerprint: "two" });
        assert.equal(commands.getNextCommand().value, 41, "own Develop revision must not cancel photograph-wide Grain");
        assert.equal(commands.enqueueCommand(masked), true);
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "three" });
        assert.equal(commands.getNextCommand(), null, "old-photo queued Grain must be dropped");
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "grain-photo", developFingerprint: "four" });
        commands.enqueueCommand(masked);
        commands.enqueueCommand(Object.assign({}, masked, { value: 42 }));
        assert.equal(commands.getNextCommand().value, 42, "coalescing retains latest scoped command");
        assert.equal(commands.getNextCommand(), null);
        assert.equal((await fetch(base + "/set?slider=GrainSize&value=38")).status, 200);
        const global = commands.getNextCommand();
        assert.equal(global.preserveMaskingPanel, undefined, "global host retains intentional reveal");
        wire.push(JSON.stringify(global));
    } finally {
        await bridge.stop();
    }

    const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
    const runtime = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(runtime);
    lua.lua_newtable(runtime);
    wire.forEach((value, index) => { lua.lua_pushstring(runtime, to_luastring(value)); lua.lua_rawseti(runtime, -2, index + 1); });
    lua.lua_setglobal(runtime, to_luastring("wireCommands"));
    const source = fs.readFileSync(path.join(__dirname, "grain-navigation.lua"), "utf8");
    const override = process.env.LRBRIDGE_GRAIN_TEST_SOURCE ? "package.preload.Driver=function()\n" +
        fs.readFileSync(process.env.LRBRIDGE_GRAIN_TEST_SOURCE, "utf8") + "\nend\n" : "";
    if (lauxlib.luaL_dostring(runtime, to_luastring(override + source)) !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(runtime, -1)));
    lua.lua_close(runtime);
    console.log("Grain HTTP/queue/Parser/Commands/Driver navigation scope, SDK calls, coalescing and stale-photo guards passed (mock SDK).");
})().catch(error => { console.error(error); process.exitCode = 1; });
