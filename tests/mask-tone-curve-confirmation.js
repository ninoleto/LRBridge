"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const runtime = lauxlib.luaL_newstate();
lualib.luaL_openlibs(runtime);
const traces = [];
lua.lua_pushjsfunction(runtime, state => {
    const line = to_jsstring(lua.lua_tostring(state, 1));
    traces.push(JSON.parse(line.slice(line.indexOf("MaskToneCurveTrace ") + "MaskToneCurveTrace ".length)));
    return 0;
});
lua.lua_setglobal(runtime, to_luastring("captureTrace"));
const nativeBlue = require("./fixtures/mask-blue-curve-confirmed.json");
for (const [name, values] of [["nativeBaseline", nativeBlue.baseline], ["nativeTarget", nativeBlue.target]]) {
    lua.lua_newtable(runtime);
    values.forEach((value, index) => { lua.lua_pushnumber(runtime, value); lua.lua_rawseti(runtime, -2, index + 1); });
    lua.lua_setglobal(runtime, to_luastring(name));
}
const source = fs.readFileSync(path.join(__dirname, "mask-tone-curve-confirmation.lua"), "utf8");
if (lauxlib.luaL_dostring(runtime, to_luastring(source)) !== lua.LUA_OK) {
    throw Error(to_jsstring(lua.lua_tostring(runtime, -1)));
}
lua.lua_close(runtime);
assert.ok(traces.length >= 8);
const mismatch = traces.find(trace => trace.command.gestureId === "curve_mismatch");
assert.equal(mismatch.command.channel, "blue");
assert.deepEqual(mismatch.command.points, nativeBlue.target);
assert.equal(mismatch.events.filter(event => event.event === "comparison").length, 12);
assert.ok(mismatch.events.filter(event => event.event === "comparison").every(event => event.data.exactMatch === false));
assert.ok(mismatch.events.some(event => event.event === "editResult" && event.data.outcome === "failed"));
assert.ok(mismatch.events.some(event => event.event === "stopTracking" && event.data.isLocalParam === true));
const representation = traces.find(trace => trace.command.gestureId === "curve_strings");
assert.ok(representation.events.some(event => event.event === "getValue" && Array.isArray(event.data.raw) &&
    typeof event.data.raw[0] === "string" && event.data.normalized[0] === 0));
assert.ok(representation.events.some(event => event.event === "editResult" && event.data.outcome === "confirmed"));
console.log("Mask curve Lua confirmation and bounded raw-value diagnostics passed.");
