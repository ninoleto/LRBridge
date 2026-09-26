"use strict";
// Replay the command order/context from a real touchscreen capture against Driver.lua.
// SDK calls/sleeps are recorded doubles: this does not measure Lightroom performance.
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const captured = require("./fixtures/touch-slider-preparation-20260926.json");
function literal(value) {
    if (value === null) return "nil";
    if (Array.isArray(value)) return "{" + value.map(literal).join(",") + "}";
    if (typeof value === "object") return "{" + Object.entries(value).map(([key, item]) =>
        "[" + JSON.stringify(key) + "]=" + literal(item)).join(",") + "}";
    return JSON.stringify(value);
}
const source = fs.readFileSync(process.env.LRBRIDGE_DRIVER_SOURCE ||
    path.join(__dirname, "../lightroom/LRBridge.lrplugin/Driver.lua"), "utf8");
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
try {
    const script = "driverSource=" + JSON.stringify(source) + ";captured=" + literal(captured) + ";\n" + `
local calls, moduleName, tool, uuid = {}, captured.activeModule, "masking", "captured-photo"
local function record(kind, value, extra) calls[#calls + 1] = { kind, value, extra } end
local sdk = {
    getSelectedTool = function() return tool end,
    revealAdjustedControls = function(value) record("automatic", value) end,
    revealPanel = function(value) record("panel", value) end,
    startTracking = function(value) record("tracking", value) end,
    setValue = function(slider, value) record("set", slider, value) end,
    resetToDefault = function(slider) record("reset", slider) end
}
local imports = {
    LrDevelopController = sdk,
    LrTasks = { sleep = function(value) record("sleep", value) end, pcall = pcall },
    LrApplicationView = { getCurrentModuleName = function() return moduleName end,
        switchToModule = function(value) record("module", value); moduleName = value end },
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function()
        return { getRawMetadata = function(_, key) assert(key == "uuid"); return uuid end }
    end } end }
}
function import(name) assert(imports[name], name); return imports[name] end
package.loaded.DevelopCategorical = {}
local Driver = assert(load(driverSource))()
assert(captured.activeModule == "develop")
assert(#captured.commands == 24)
for index, command in ipairs(captured.commands) do
    calls = {}
    local isReset = command.kind == "develop.reset"
    if isReset then assert(Driver.resetSlider(command.slider))
    else assert(Driver.setSlider(command.slider, command.value)) end
    assert(calls[1][1] == "module" and calls[1][2] == "develop", "retain the existing SDK wake request")
    for _, call in ipairs(calls) do
        assert(call[1] ~= "sleep" or call[2] ~= 0.2,
            "captured command " .. index .. " still waits for a Develop transition that did not occur")
    end
    assert(calls[2][1] == "panel" and calls[2][2] == command.slider)
    assert(calls[3][1] == "sleep" and calls[3][2] == 0.05, "retain panel preparation")
    if not isReset then assert(calls[4][1] == "tracking" and calls[4][2] == command.slider) end
    assert(#calls == (isReset and 4 or 5), "no duplicate writes or extra operations")
    local applied = calls[#calls]
    assert(applied[1] == (isReset and "reset" or "set") and applied[2] == command.slider)
    assert(applied[3] == command.value, "preserve captured input order and exact values")
end
for _, initialModule in ipairs({ "library", "print" }) do
    moduleName, calls = initialModule, {}
    assert(Driver.resetSlider("Contrast"))
    assert(calls[1][1] == "module" and calls[1][2] == "develop")
    assert(calls[2][1] == "sleep" and calls[2][2] == 0.2, "real module changes still settle")
    assert(calls[3][1] == "panel" and calls[3][2] == "Contrast")
    assert(calls[4][1] == "sleep" and calls[4][2] == 0.05)
    assert(#calls == 5 and calls[5][1] == "reset")
end
-- Existing no-navigation Masking Grain route and photo/tool/module guards stay intact.
local scope = { preserveMaskingPanel = true, expectedSelectedPhotoUuid = "captured-photo" }
moduleName, calls = "develop", {}
assert(Driver.resetSlider("GrainSize", scope))
assert(#calls == 2 and calls[1][1] == "automatic" and calls[1][2] == false and calls[2][1] == "reset")
for _, mismatch in ipairs({ "module", "photo", "tool", "parameter" }) do
    moduleName, uuid, tool, calls = "develop", "captured-photo", "masking", {}
    local slider = "GrainSize"
    if mismatch == "module" then moduleName = "library"
    elseif mismatch == "photo" then uuid = "different-photo"
    elseif mismatch == "tool" then tool = "loupe"
    else slider = "Contrast" end
    assert(Driver.resetSlider(slider, scope) == false)
    assert(#calls == 0, "invalid Masking context must not navigate or write")
end
`;
    if (lauxlib.luaL_dostring(L, to_luastring(script)) !== lua.LUA_OK) {
        throw new Error(lua.lua_tojsstring(L, -1));
    }
    console.log("Captured 24-command slider preparation replay and module/Masking guards passed (mock SDK; not a live timing measurement).");
} finally { lua.lua_close(L); }
