package.path = "lightroom/LRBridge.lrplugin/?.lua;" .. package.path
local calls = {}
local moduleName, tool, uuid = "develop", "masking", "grain-photo"
local selectedMask, selectedComponent = "mask-a", "component-b"
local values = { GrainSize = 25, GrainFrequency = 50, local_Grain = 27 }
local function record(name, value) table.insert(calls, { name, value }) end
local sdk = {
    getSelectedTool = function() return tool end,
    revealAdjustedControls = function(value) record("automatic", value) end,
    revealPanel = function(value) record("panel", value) end,
    startTracking = function(value) record("tracking", value) end,
    setValue = function(param, value, localParam)
        assert(localParam == nil, "shared Grain must use the global SDK parameter")
        values[param] = value; record("set", param)
    end,
    resetToDefault = function(param)
        values[param] = param == "GrainSize" and 25 or 50; record("reset", param)
    end
}
local imports = {
    LrDevelopController = sdk,
    LrApplicationView = { getCurrentModuleName = function() return moduleName end,
        switchToModule = function(value) record("module", value) end },
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function()
        return { getRawMetadata = function(_, key) assert(key == "uuid"); return uuid end }
    end } end },
    LrTasks = { sleep = function() record("sleep") end, pcall = pcall },
    LrHttp = { get = function() error("No network allowed in Grain SDK fixture") end }
}
function import(name) assert(imports[name], name); return imports[name] end
for _, name in ipairs({ "DevelopCategorical", "Query", "Selection", "Application", "Photo", "Crop",
    "ColorGrading", "Enhance", "PointColor", "History", "LensBlur", "ToneCurve", "Profile", "DevelopPresets", "Masking",
    "Remove", "Reflections", "People", "RedEye", "Export", "SettingsClipboard" }) do
    package.loaded[name] = {}
end
local Parser = require "Parser"
local Commands = require "Commands"
local Driver = require "Driver"
for index, json in ipairs(wireCommands) do
    calls = {}
    local command = Parser.parse(json)
    assert(command ~= nil)
    Commands.execute(command)
    if index <= 4 then
        assert(calls[1][1] == "automatic" and calls[1][2] == false)
        for _, call in ipairs(calls) do
            assert(call[1] ~= "module" and call[1] ~= "sleep" and call[1] ~= "panel")
        end
        if command.command == "develop.set" then assert(values[command.slider] == 63)
        else assert(values[command.slider] == (command.slider == "GrainSize" and 25 or 50)) end
    else
        assert(calls[1][1] == "module")
        assert(calls[2][1] == "panel" and calls[2][2] == "GrainSize")
        assert(calls[3][1] == "sleep", "global Grain retains panel preparation in Develop")
    end
    assert(values.local_Grain == 27 and selectedMask == "mask-a" and selectedComponent == "component-b")
end
for _, suffix in ipairs({ 'false', '"true"', 'true,"preserveMaskingPanel":true' }) do
    assert(Parser.parse('{"command":"develop.set","slider":"GrainSize","value":12,"preserveMaskingPanel":' .. suffix .. '}') == nil)
end
assert(Parser.parse('{"command":"develop.set","slider":"Exposure","value":1,"preserveMaskingPanel":true}') == nil)
local scope = { preserveMaskingPanel = true, expectedSelectedPhotoUuid = "grain-photo" }
for _, failure in ipairs({ "photo", "module", "tool", "parameter", "missing-photo" }) do
    calls = {}
    moduleName, tool, uuid = "develop", "masking", "grain-photo"
    local param = "GrainSize"
    if failure == "photo" then uuid = "other-photo"
    elseif failure == "module" then moduleName = "library"
    elseif failure == "tool" then tool = "loupe"
    elseif failure == "parameter" then param = "Exposure"
    elseif failure == "missing-photo" then scope.expectedSelectedPhotoUuid = nil end
    assert(Driver.setSlider(param, 12, scope) == false)
    assert(Driver.resetSlider(param, scope) == false)
    assert(#calls == 0, "invalid context must not navigate, track or write")
end
moduleName, tool, uuid = "develop", "local_point_color", "grain-photo"
scope.expectedSelectedPhotoUuid = "grain-photo"
assert(Driver.setSlider("GrainFrequency", 62, scope) == true)
