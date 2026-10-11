math.pow = math.pow or function(a, b) return a ^ b end
local photoA = { getRawMetadata = function() return "photo-a" end }
photo = photoA
local other = { getRawMetadata = function() return "photo-b" end }
selectedPhoto, selectedIndex, selections, scenario = photo, 1, 0, ""
local catalog = { getTargetPhoto = function() return selectedPhoto end }
local range = { LowerNone = 0.1, LowerFull = 0.3, UpperFull = 0.7, UpperNone = 0.9 }
local colors = {}
for i = 1, 8 do colors[i] = { SrcHue = 1, SrcSat = 0.5, SrcLum = 0.2, HueShift = 0.27,
    SatScale = -0.18, LumScale = 0.11, Variance = 0.14, RangeAmount = 0.6,
    HueRange = range, SatRange = range, LumRange = range } end
local sdk = {
    getProcessVersion = function() return "15" end,
    getValue = function(name)
        assert(name == "PointColors")
        if scenario == "photo-read" then selectedPhoto = other end
        return colors
    end,
    getSelectedPointColorSwatchIndex = function(mask) assert(mask == false); return selectedIndex end,
    selectPointColorSwatch = function(index, mask) assert(mask == false); selections = selections + 1; selectedIndex = index end
}
local http = { get = function(url)
    if string.find(url, "/point-color/state", 1, true) then
        if scenario == "photo-http" then selectedPhoto = other end
        if scenario == "shutdown" then _G.LRBridgePollingLifecycle = { stopping = true } end
        if scenario == "epoch" then return string.gsub(contextJson, '"serverEpoch":"[^"]+"', '"serverEpoch":"old"') end
        return contextJson
    end
    assert(string.find(url, "/point-color/result?", 1, true))
    resultUrl, savedResultUrl = url, url
    return '{"ok":true}'
end }
function import(name)
    if name == "LrDevelopController" then return sdk end
    if name == "LrApplication" then return { activeCatalog = function() return catalog end } end
    if name == "LrApplicationView" then return { getCurrentModuleName = function() return "develop" end } end
    if name == "LrTasks" then return { pcall = pcall } end
    if name == "LrHttp" then return http end
    return {}
end
local nativeRequire = require
function require(name)
    if name == "PointColor" or name == "Parser" or name == "Commands" then
        if not package.loaded[name] then package.loaded[name] = dofile(pluginRoot .. "/" .. name .. ".lua") end
        return package.loaded[name]
    end
    return {}
end
Parser = require "Parser"
local PointColor, Commands = require "PointColor", require "Commands"
function publish() PointColor.sendCurrentState(contextJson) end
function execute() Commands.execute(Parser.parse(commandJson)) end
