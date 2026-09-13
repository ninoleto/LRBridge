"use strict";

// Test-only Lua runtime; never a production dependency. Set LRBRIDGE_LUA_TEST_RUNTIME
// to an external fengari installation when it is not on Node's module path.
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const runtime = lauxlib.luaL_newstate();
lualib.luaL_openlibs(runtime);
lua.lua_pushjsfunction(runtime, function (state) {
    const name = to_jsstring(lua.lua_tostring(state, 1));
    if (!/^[a-z-]+\.lrtemplate$/.test(name)) throw new Error("Invalid fixture name");
    lua.lua_pushstring(state, to_luastring(fs.readFileSync(path.join(__dirname, "fixtures", "masking-local-presets", name), "utf8")));
    return 1;
});
lua.lua_setglobal(runtime, to_luastring("readFixture"));
function pushValue(value) {
    if (typeof value === "number") return lua.lua_pushnumber(runtime, value);
    if (typeof value === "string") return lua.lua_pushstring(runtime, to_luastring(value));
    lua.lua_newtable(runtime);
    Object.entries(value).forEach(([key, child]) => {
        pushValue(child);
        if (Array.isArray(value)) lua.lua_rawseti(runtime, -2, Number(key) + 1);
        else lua.lua_setfield(runtime, -2, to_luastring(key));
    });
}
pushValue(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "masking-local-presets",
    "native-single-adjustments.json"), "utf8")));
lua.lua_setglobal(runtime, to_luastring("nativeCapture"));
pushValue(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "masking-local-presets",
    "native-exposure-reset.json"), "utf8")));
lua.lua_setglobal(runtime, to_luastring("nativeExposureCapture"));
pushValue(require("../server/local-adjustment-presets").NATIVE_CORRECTION_PRESETS);
lua.lua_setglobal(runtime, to_luastring("nativeDefinitions"));
const source = fs.readFileSync(path.join(__dirname, "masking-preset-application.lua"), "utf8");
if (lauxlib.luaL_dostring(runtime, to_luastring(source)) !== lua.LUA_OK) {
    throw new Error(to_jsstring(lua.lua_tostring(runtime, -1)));
}
lua.lua_close(runtime);
