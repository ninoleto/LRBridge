"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const L = lauxlib.luaL_newstate();
try {
    lualib.luaL_openlibs(L);
    const source = fs.readFileSync(path.join(__dirname, "polling-lifecycle.lua"), "utf8");
    const status = lauxlib.luaL_dostring(L, to_luastring(source));
    assert.equal(status, lua.LUA_OK, status === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(L, -1)));
    console.log(`Polling lifecycle: ${lua.lua_tonumber(L, -1)} cooperative mock-SDK scenarios passed (actual production Lua; no native failure injection).`);
} finally {
    lua.lua_close(L);
}
