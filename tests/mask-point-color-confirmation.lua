-- Execute the production Masking/PointColor modules. Only Lightroom's SDK and
-- transport are doubles; the settlement loop and result serialization are real.
package.path = "lightroom/LRBridge.lrplugin/?.lua;" .. package.path
unpack = unpack or table.unpack
math.pow = math.pow or function(value, exponent) return value ^ exponent end
local time, writes, pending = 0, 0, nil
local photoId, maskId, swatchIndex = "photo-a", "mask-a", 1
local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}; for key, child in pairs(value) do result[key] = copy(child) end; return result
end
local function equal(left, right)
    if type(left) ~= "table" then return left == right end
    if type(right) ~= "table" then return false end
    for key, value in pairs(left) do if not equal(value, right[key]) then return false end end
    for key in pairs(right) do if left[key] == nil then return false end end
    return true
end
local swatch = { SrcHue = 0.5, SrcSat = 0.5, SrcLum = 0.21404114048223255,
    HueShift = 0.1, SatScale = 0.2, LumScale = -0.1, Variance = 0, RangeAmount = 0.5 }
for key, value in pairs(scenario.initial or {}) do swatch[key] = value end
for _, name in ipairs({"HueRange", "SatRange", "LumRange"}) do
    swatch[name] = {LowerNone = 0.1, LowerFull = 0.3, UpperFull = 0.7, UpperNone = 0.9}
end
local colors = {copy(swatch), copy(swatch)}
local photos = {}
for _, id in ipairs({"photo-a", "photo-b"}) do
    photos[id] = {getRawMetadata = function(_, key) if key == "uuid" then return id end end}
end
local function switchContext()
    if scenario.switch == "photo" then photoId = "photo-b" end
    if scenario.switch == "mask" then maskId = "mask-b" end
    if scenario.switch == "swatch" then swatchIndex = 2 end
end
if scenario.switchBefore then switchContext() end
local controller = {
    getProcessVersion = function() return "15.4" end,
    getSelectedTool = function() return "masking" end,
    getSelectedMask = function() return maskId end,
    getSelectedMaskTool = function() return "tool-" .. maskId end,
    getAllMasks = function() return {
        {ID = "mask-a", Name = "A", Hidden = false, Tools = {{ID = "tool-mask-a", Hidden = false}}},
        {ID = "mask-b", Name = "B", Hidden = false, Tools = {{ID = "tool-mask-b", Hidden = false}}}
    } end,
    getRange = function() return nil end,
    getSelectedPointColorSwatchIndex = function(localMask) assert(localMask); return swatchIndex end
}
controller.getValue = function(field)
    if field ~= "local_PointColors" then return nil end
    if writes > 0 then capture("read", time, colors[swatchIndex][command.field], swatchIndex) end
    return copy(colors)
end
controller.updateSelectedPointColorSwatch = function(value, localMask)
    assert(localMask == true, "a mask edit must never write global Point Color")
    assert(photoId == "photo-a" and maskId == "mask-a" and swatchIndex == 1)
    assert(value[command.field] == command.value)
    for key, previous in pairs(colors[1]) do
        if key ~= command.field then assert(equal(value[key], previous), "unrelated swatch field changed: " .. key) end
    end
    writes = writes + 1
    capture("write", time, value[command.field], swatchIndex)
    if scenario.sdkError then error("fixture SDK error") end
    if scenario.sdkFailure then return false, "fixture SDK rejection" end
    pending = copy(value)
    pending[command.field] = command.value + (scenario.offset or 0)
    if scenario.delay == 0 then colors[1] = pending; pending = nil end
    return true
end
local modules = {
    LrApplication = {activeCatalog = function() return {getTargetPhoto = function() return photos[photoId] end} end},
    LrApplicationView = {getCurrentModuleName = function() return "develop" end},
    LrDate = {currentTime = function() return time end},
    LrDevelopController = controller,
    LrTasks = {pcall = pcall, sleep = function(seconds)
        time = time + seconds
        if pending and time + 0.000000001 >= scenario.delay then colors[1] = pending; pending = nil end
        if scenario.switch and time >= 0.1 then switchContext() end
    end},
    LrHttp = {get = function(url)
        if url:find("/context", 1, true) then
            if scenario.contextJson then return scenario.contextJson end
            return '{"activeModule":"develop","selectedPhotoUuid":"photo-a","contextCounter":4,"developCounter":7,"contextChangedAt":10}'
        end
        if url:find("/masking/state", 1, true) then
            return '{"serverEpoch":"epoch-a","revision":' .. command.expectedMaskingRevision .. ',"selectedMaskGroupId":"mask-a"}'
        end
        if url:find("/masking/edit-result", 1, true) then capture("result", time, url); return '{"ok":true}' end
        error("Unexpected HTTP request " .. url)
    end}
}
import = function(name) return modules[name] or {} end
_PLUGIN = {path = "lightroom/LRBridge.lrplugin"}
local masking = require "Masking"
local succeeded = masking.execute(command)
capture("returned", time, succeeded)
