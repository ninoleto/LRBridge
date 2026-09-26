"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring } = require("fengari");
const { createBridge } = require("../server/bridge");
const native = require("../server/windows-lightroom-native");
const commands = require("../server/commands");
const readLua = name => fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin/", name + ".lua"), "utf8");
function luaChecks() {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    try {
        const code = `
local tool, bokeh, urls, writes = "upright", "Circle", {}, 0
local failBokeh = false
local imports = {
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return {
        getDevelopSettings = function() return {WhiteBalance="Daylight"} end
    } end } end },
    LrApplicationView = { getCurrentModuleName = function() return "develop" end },
    LrTasks = { pcall = pcall },
    LrHttp = { get = function(url) urls[#urls+1] = url; return "" end },
    LrDevelopController = {
        revealPanel = function() end,
        selectTool = function(value) tool=value end,
        getSelectedTool = function() return tool end,
        getProcessVersion = function() return "Version 6" end,
        getValue = function(key)
            if key == "LensBlurActive" then return true end
            if key == "LensBlurFocalRange" then return "0 20 50 100" end
            return 0
        end,
        setValue = function() writes=writes+1; error("Unexpected settings mutation") end,
        resetToDefault = function() error("Unexpected reset") end,
        setLensBlurBokeh = function(value) if failBokeh then error("SDK rejected") end; bokeh=value end,
        getSelectedLensBlurBokeh = function() return bokeh end
    }
}
import = function(name) return imports[name] or {} end
local categorical = assert(load(${JSON.stringify(readLua("DevelopCategorical"))}))()
local lens = assert(load(${JSON.stringify(readLua("LensBlur"))}))()
require = function(name) if name == "DevelopCategorical" then return categorical end
    if name == "LensBlur" then return lens end; return {} end
local dispatch = assert(load(${JSON.stringify(readLua("Commands"))}))()
local parser = assert(load(${JSON.stringify(readLua("Parser"))}))()
dispatch.execute(parser.parse('{"command":"develop_categorical.upright_tool.select","value":"loupe"}'))
assert(tool == "loupe" and writes == 0, "Close must only deselect the tool")
assert(string.find(urls[#urls], "selectedTool=loupe", 1, true), "Close needs SDK tool readback")
dispatch.execute({command="develop_categorical.upright_tool.select"})
assert(tool == "upright", "Legacy Open remains supported")
assert(not pcall(categorical.selectUprightTool, "crop"), "Reject unrelated tools")
for _, value in ipairs({"SoapBubble", "Blade", "Circle"}) do
    dispatch.execute({command="lens_blur.bokeh.set", value=value})
    assert(string.find(urls[#urls], "bokeh="..value, 1, true), "Read bokeh immediately after SDK action")
end
local before = #urls; failBokeh=true
assert(not pcall(dispatch.execute, {command="lens_blur.bokeh.set", value="Ring"}))
assert(#urls == before, "Failed SDK action must not synthesize confirmation")
`;
        if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) throw Error(lua.lua_tojsstring(L, -1));
    } finally { lua.lua_close(L); }
}
async function transportChecks() {
    let releaseNative, nativeCalls = 0;
    const heldNative = new Promise(resolve => { releaseNative = resolve; });
    const backend = { ...native.createUnavailableWindowsBackend(), readState: async () => {
        nativeCalls++; await heldNative; return native.unavailableNativeState();
    } };
    const bridge = createBridge({ httpPort: 0, wsPort: 0, windowsNativeBackend: backend });
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    async function get(url) {
        const res = await fetch(base + url, { signal: AbortSignal.timeout(2000) });
        return { status: res.status, body: await res.json() };
    }
    try {
        await get("/context/update?activeModule=develop&selectedPhotoKey=photo-a&selectedPhotoUuid=photo-a&developFingerprint=first");
        await get("/develop-categorical/result?whiteBalanceAvailable=false&processAvailable=false&vignetteStyleAvailable=false&uprightModeAvailable=true&uprightMode=5&constrainCropAvailable=false&selectedToolAvailable=true&selectedTool=upright");
        assert.equal((await get("/develop-categorical/upright-tool?target=loupe")).status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "develop_categorical.upright_tool.select", value: "loupe" });
        for (const query of ["target=crop", "target=off", "target=reset", "target=loupe&extra=1", "target=loupe&target=upright"]) {
            assert.equal((await get("/develop-categorical/upright-tool?" + query)).status, 400, query);
        }
        await get("/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Blade&selectedToolAvailable=true&selectedTool=loupe&focalRangeAvailable=false");
        const sdk = await get("/lens-blur/state?sdkOnly=true");
        assert.equal(sdk.status, 200);
        assert.equal(sdk.body.state.bokeh, "Blade");
        assert.equal(sdk.body.context.selectedPhotoUuid, "photo-a");
        assert.equal(sdk.body.state.windowsNative, undefined, "SDK-only reads must not fabricate Windows feedback");
        assert.equal(nativeCalls, 0, "SDK confirmation must not wait for the Windows helper");
        for (const query of ["sdkOnly=false", "sdkOnly=1", "sdkOnly=true&extra=1", "sdkOnly=true&sdkOnly=true"]) {
            assert.equal((await get("/lens-blur/state?" + query)).status, 400);
        }
        releaseNative();
        assert.equal((await get("/lens-blur/state")).status, 200, "ordinary state still includes the existing native read");
        assert.equal(nativeCalls, 1);
    } finally { releaseNative(); await bridge.stop(); }
}
(async () => {
    luaChecks(); await transportChecks();
    console.log("Upright Close Lua/HTTP preservation and immediate SDK bokeh readback/Windows bypass passed (mock SDK/native).");
})().catch(error => { console.error(error); process.exitCode = 1; });
