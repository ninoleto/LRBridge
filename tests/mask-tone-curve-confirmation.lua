package.path = "lightroom/LRBridge.lrplugin/?.lua;" .. package.path
unpack = unpack or table.unpack
local time, values, writes, response, selectedMask, representation, pending, delay, writeError, stopError
local linear = {0, 0, 255, 255}
local baseline, target = nativeBaseline, nativeTarget
local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}; for key, child in pairs(value) do result[key] = copy(child) end; return result
end
local controller = {}
controller.getSelectedTool = function() return "masking" end
controller.getSelectedMask = function() return selectedMask end
controller.getSelectedMaskTool = function() return "tool-a" end
controller.getAllMasks = function() return {{ID = "mask-a", Name = "A", Hidden = false,
    Tools = {{ID = "tool-a", Hidden = false}}}} end
controller.getValue = function(field)
    local value = values[field]
    if type(value) ~= "table" or representation ~= "strings" then return copy(value) end
    local pairs = {}; for index = 1, #value, 2 do pairs[#pairs + 1] = string.format("%d,%d", value[index], value[index + 1]) end
    return pairs
end
controller.getRange = function(field) if field == "local_RefineSaturation" then return 0, 100 end end
controller.startTracking = function() end
controller.stopTracking = function(isLocal) assert(isLocal == true); if stopError then error("stop failure") end end
controller.setValue = function(field, value)
    assert(field == "local_Bluecurve")
    assert(type(value[1]) == "number", "SDK write must remain flat numeric data")
    writes = writes + 1
    if writeError then error("write failure") end
    if delay == 0 then values[field] = copy(value) else pending = {field = field, value = copy(value)} end
end
local photo = { getRawMetadata = function(_, key) if key == "uuid" then return "photo-a" end end }
local modules = {
    LrApplication = { activeCatalog = function() return {getTargetPhoto = function() return photo end} end },
    LrApplicationView = {getCurrentModuleName = function() return "develop" end},
    LrDate = {currentTime = function() return time end},
    LrDevelopController = controller,
    LrTasks = {pcall = pcall, sleep = function(seconds)
        time = time + seconds
        if pending and time >= delay then values[pending.field] = pending.value; pending = nil end
    end},
    LrHttp = {get = function(url)
        if url:find("/context", 1, true) then return '{"activeModule":"develop","selectedPhotoUuid":"photo-a","contextCounter":1,"developCounter":1,"contextChangedAt":1}' end
        if url:find("/masking/state", 1, true) then return '{"serverEpoch":"epoch-a","revision":1,"selectedMaskGroupId":"mask-a"}' end
        if url:find("/masking/edit-result", 1, true) then response = url; return '{"ok":true}' end
        error("Unexpected HTTP request " .. url)
    end}
}
import = function(name) return modules[name] or {} end
_PLUGIN = {path = "D:/Projects/LRBridge/lightroom/LRBridge.lrplugin"}
local masking = require "Masking"
io.open = function() return {write = function(_, line) captureTrace(line) end, close = function() end} end
local sequence = 0
local function reset()
    time, writes, response, selectedMask, representation, pending, delay, writeError, stopError = 0, 0, nil, "mask-a", "numbers", nil, 0, false, false
    values = {local_Maincurve = copy(linear), local_Redcurve = copy(linear), local_Greencurve = copy(linear),
        local_Bluecurve = copy(baseline), local_RefineSaturation = 100}
end
local function command(id)
    sequence = sequence + 1
    return {command = "masking.tone_curve.gesture.end", channel = "blue", field = "local_Bluecurve",
        gestureId = "curve_" .. id, editSequence = sequence, expectedPoints = copy(baseline), points = copy(target),
        expectedSelectedMaskId = "mask-a", expectedServerEpoch = "epoch-a", expectedMaskingRevision = 1,
        expectedActiveModule = "develop", expectedSelectedPhotoUuid = "photo-a", expectedContextCounter = 1,
        expectedDevelopCounter = 1, expectedContextChangedAt = 1}
end
local function outcome(expected) assert(response and response:find("outcome=" .. expected, 1, true), response or "no edit result") end
reset(); assert(masking.execute(command("exact"))); outcome("confirmed"); assert(writes == 1)
reset(); representation = "strings"; assert(masking.execute(command("strings"))); outcome("confirmed")
reset(); delay = 0.2; assert(masking.execute(command("delayed"))); outcome("confirmed"); assert(time >= 0.2)
reset(); delay = 1; assert(not masking.execute(command("mismatch"))); outcome("failed"); assert(time < 1)
reset(); writeError = true; assert(not masking.execute(command("write_error"))); outcome("failed")
reset(); stopError = true; assert(not masking.execute(command("stop_error"))); outcome("failed")
reset(); selectedMask = "mask-b"; assert(not masking.execute(command("switched"))); outcome("stale"); assert(writes == 0)
reset(); values.local_Bluecurve = copy(target); assert(not masking.execute(command("old_baseline"))); outcome("stale"); assert(writes == 0)
print("Exact values, representation normalization, bounded delay, write/stop failures and mask/stale guards passed.")
