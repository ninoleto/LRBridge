"use strict";
// Execute the production polling module with cooperative SDK/HTTP doubles.
// The two captured failures must fail against the source saved with the retest.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const fixture = require("./fixtures/shared-reset-delay-20260928.json");
function literal(value) {
    if (value === null) return "nil";
    if (Array.isArray(value)) return "{" + value.map(literal).join(",") + "}";
    if (typeof value === "object") return "{" + Object.entries(value).map(([key, item]) =>
        "[" + JSON.stringify(key) + "]=" + literal(item)).join(",") + "}";
    return JSON.stringify(value);
}
const source = fs.readFileSync(process.env.LRBRIDGE_FEEDBACK_LUA_SOURCE ||
    path.join(__dirname, "../lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
const mode = process.argv.includes("--busy-only") ? "busy" : process.argv.includes("--drain-only") ? "drain" : "all";
const L = lauxlib.luaL_newstate();
try {
    lualib.luaL_openlibs(L);
    const script = "pollingSource=" + JSON.stringify(source) + "; captured=" + literal(fixture) +
        "; mode=" + JSON.stringify(mode) + ";\n" + fs.readFileSync(path.join(__dirname, "shared-reset-confirmation.lua"), "utf8");
    const status = lauxlib.luaL_dostring(L, to_luastring(script));
    assert.equal(status, lua.LUA_OK, status === lua.LUA_OK ? "" : lua.lua_tojsstring(L, -1));
    console.log(`Shared Reset confirmation: ${lua.lua_tonumber(L, -1)} production-Lua scenarios passed (${mode}; simulated SDK, no native edits).`);
} finally { lua.lua_close(L); }
