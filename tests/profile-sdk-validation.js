"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");

function literal(value) {
    if (value === null) return "nil";
    if (Array.isArray(value)) return "{" + value.map(literal).join(",") + "}";
    if (typeof value === "object") return "{" + Object.entries(value).map(([key, item]) =>
        "[" + JSON.stringify(key) + "]=" + literal(item)).join(",") + "}";
    return JSON.stringify(value);
}

function run() {
    const fixture = require("./fixtures/profile-sdk-vivid-18.4.json");
    const capturedSequence = require("./fixtures/profile-reset-auto-vivid-20260926.json");
    // Expose locals only in this in-memory test chunk; production exports stay unchanged.
    const source = fs.readFileSync(process.env.LRBRIDGE_PROFILE_SOURCE || path.join(__dirname, "../lightroom/LRBridge.lrplugin/Profile.lua"), "utf8")
        .replace(/return Profile\s*$/, "return { api=Profile, definitions=supportedProfiles, desired=desiredState, equal=graphEqual }");
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    try {
        const script = "profileSource=" + JSON.stringify(source) + "; captured=" + literal(fixture) +
            "; capturedSequence=" + literal(capturedSequence) + ";\n" +
            fs.readFileSync(path.join(__dirname, "profile-sdk-validation.lua"), "utf8");
        if (lauxlib.luaL_dostring(L, to_luastring(script)) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
    } finally { lua.lua_close(L); }
}
if (require.main === module) run();
module.exports = { run };
