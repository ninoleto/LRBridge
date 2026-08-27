local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local ToneCurve = {}

local channelFields = {
    rgb = "ToneCurvePV2012",
    red = "ToneCurvePV2012Red",
    green = "ToneCurvePV2012Green",
    blue = "ToneCurvePV2012Blue"
}

local channelOrder = { "rgb", "red", "green", "blue" }
local refineSaturationField = "CurveRefineSaturation"
local presetCurves = {
    ["Linear"] = { 0, 0, 255, 255 },
    ["Medium Contrast"] = { 0, 0, 32, 22, 64, 56, 128, 128, 192, 196, 255, 255 },
    ["Strong Contrast"] = { 0, 0, 32, 16, 64, 50, 128, 128, 192, 202, 255, 255 }
}
local adjustmentDirty = true
local observerOwner = nil
local activeGesture = nil

local function validInteger(value)
    return type(value) == "number" and value == math.floor(value)
end

local function validNumber(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function validCurve(points)
    if type(points) ~= "table" then return false end
    local length = #points
    if length < 4 or length > 512 or length % 2 ~= 0 then return false end

    local entryCount = 0
    for key, value in pairs(points) do
        if not validInteger(key) or key < 1 or key > length or not validInteger(value) then return false end
        entryCount = entryCount + 1
    end
    if entryCount ~= length then return false end

    local previousX = nil
    for index = 1, length, 2 do
        local x = points[index]
        local y = points[index + 1]
        if x < 0 or x > 255 or y < 0 or y > 255 then return false end
        if previousX ~= nil and x <= previousX then return false end
        previousX = x
    end
    return points[1] == 0 and points[length - 1] == 255
end

local function serializeCurve(points)
    if not validCurve(points) then return nil end
    local serialized = {}
    for index = 1, #points do serialized[index] = tostring(points[index]) end
    return table.concat(serialized, ",")
end

local function copyCurve(points)
    local copy = {}
    for index = 1, #points do copy[index] = points[index] end
    return copy
end

local function selectedPhoto()
    local catalog = LrApplication.activeCatalog()
    if catalog == nil then return nil end
    local ok, photo = LrTasks.pcall(function() return catalog:getTargetPhoto() end)
    if ok == true then return photo end
    return nil
end

local function photoUuid(photo)
    if photo == nil then return "" end
    local ok, uuid = LrTasks.pcall(function() return photo:getRawMetadata("uuid") end)
    if ok == true and uuid ~= nil then return tostring(uuid) end
    return ""
end

local function activeModuleIsDevelop()
    local ok, moduleName = pcall(function() return LrApplicationView.getCurrentModuleName() end)
    return ok == true and string.lower(tostring(moduleName or "")) == "develop"
end

local function jsonInteger(json, field)
    if type(json) ~= "string" then return nil end
    local value = string.match(json, '"' .. field .. '"%s*:%s*(%d+)')
    return value and tonumber(value) or nil
end

local function jsonString(json, field)
    if type(json) ~= "string" then return nil end
    return string.match(json, '"' .. field .. '"%s*:%s*"([^"]*)"')
end

local function currentServerContextMatches(command)
    local ok, result = LrTasks.pcall(function() return LrHttp.get("http://127.0.0.1:17891/context") end)
    if ok ~= true or type(result) ~= "string" then return false end
    return jsonString(result, "activeModule") == "develop" and
        jsonString(result, "selectedPhotoUuid") == command.expectedSelectedPhotoUuid and
        jsonInteger(result, "contextCounter") == command.expectedContextCounter and
        jsonInteger(result, "developCounter") == command.expectedDevelopCounter
end

local function commandShapeMatches(command, requirePoints)
    local field = channelFields[command.channel]
    if field == nil or command.field ~= field then return false end
    if type(command.expectedSelectedPhotoUuid) ~= "string" or command.expectedSelectedPhotoUuid == "" then return false end
    if not validInteger(command.expectedContextCounter) or command.expectedContextCounter < 0 then return false end
    if not validInteger(command.expectedDevelopCounter) or command.expectedDevelopCounter < 0 then return false end
    if not validCurve(command.expectedPoints) then return false end
    if requirePoints == true and not validCurve(command.points) then return false end
    return true
end

local function validateWriteBaseline(command)
    if not commandShapeMatches(command, command.points ~= nil) or not activeModuleIsDevelop() then return false end
    local beforePhoto = selectedPhoto()
    if beforePhoto == nil or photoUuid(beforePhoto) ~= command.expectedSelectedPhotoUuid then return false end
    if not currentServerContextMatches(command) then return false end

    local ok, currentCurve = LrTasks.pcall(function()
        return LrDevelopController.getValue(channelFields[command.channel])
    end)
    if ok ~= true or serializeCurve(currentCurve) ~= serializeCurve(command.expectedPoints) then return false end

    local afterPhoto = selectedPhoto()
    return afterPhoto == beforePhoto and photoUuid(afterPhoto) == command.expectedSelectedPhotoUuid and activeModuleIsDevelop()
end

local function gestureMatches(command)
    return activeGesture ~= nil and activeGesture.kind == "curve" and activeGesture.gestureId == command.gestureId and
        activeGesture.channel == command.channel and activeGesture.field == command.field and
        activeGesture.selectedPhotoUuid == command.expectedSelectedPhotoUuid and
        activeGesture.contextCounter == command.expectedContextCounter
end


local function refineGestureMatches(command)
    return activeGesture ~= nil and activeGesture.kind == "refineSaturation" and
        activeGesture.gestureId == command.gestureId and activeGesture.field == refineSaturationField and
        command.field == refineSaturationField and
        activeGesture.selectedPhotoUuid == command.expectedSelectedPhotoUuid and
        activeGesture.contextCounter == command.expectedContextCounter
end

local function clearActiveGesture()
    local stopOk = LrTasks.pcall(function() LrDevelopController.stopTracking(false) end)
    activeGesture = nil
    return stopOk == true
end

function ToneCurve.readSnapshot()
    local snapshot = { curves = {} }
    for _, channel in ipairs(channelOrder) do
        local field = channelFields[channel]
        local ok, points = LrTasks.pcall(function() return LrDevelopController.getValue(field) end)
        if ok ~= true or not validCurve(points) then return nil end
        snapshot.curves[channel] = copyCurve(points)
        snapshot[channel .. "Serialized"] = serializeCurve(points)
    end

    local nameOk, name = LrTasks.pcall(function() return LrDevelopController.getValue("ToneCurveName2012") end)
    if nameOk ~= true or type(name) ~= "string" or name == "" or string.len(name) > 80 then return nil end
    snapshot.name = name
    local refineOk, refineValue = LrTasks.pcall(function()
        return LrDevelopController.getValue(refineSaturationField)
    end)
    local rangeOk, refineMin, refineMax = LrTasks.pcall(function()
        return LrDevelopController.getRange(refineSaturationField)
    end)
    if refineOk ~= true or rangeOk ~= true or not validNumber(refineValue) or
        not validNumber(refineMin) or not validNumber(refineMax) or refineMin >= refineMax or
        refineValue < refineMin or refineValue > refineMax then return nil end
    snapshot.refineSaturation = refineValue
    snapshot.refineMin = refineMin
    snapshot.refineMax = refineMax
    snapshot.fingerprint = table.concat({
        "ToneCurvePV2012=" .. snapshot.rgbSerialized,
        "ToneCurvePV2012Red=" .. snapshot.redSerialized,
        "ToneCurvePV2012Green=" .. snapshot.greenSerialized,
        "ToneCurvePV2012Blue=" .. snapshot.blueSerialized,
        "ToneCurveName2012=" .. name,
        "CurveRefineSaturation=" .. tostring(refineValue) .. "," .. tostring(refineMin) .. "," .. tostring(refineMax)
    }, "|")
    return snapshot
end

function ToneCurve.markDirty()
    adjustmentDirty = true
end

function ToneCurve.consumeDirty()
    local dirty = adjustmentDirty
    adjustmentDirty = false
    return dirty
end

function ToneCurve.installAdjustmentObserver(functionContext)
    if observerOwner ~= nil then return true end
    local owner = {}
    local ok = pcall(function()
        LrDevelopController.addAdjustmentChangeObserver(functionContext, owner, function()
            adjustmentDirty = true
        end)
    end)
    if ok == true then observerOwner = owner end
    return ok
end

function ToneCurve.beginGesture(command)
    if activeGesture ~= nil then
        if gestureMatches(command) then return false end
        clearActiveGesture()
    end
    if type(command.gestureId) ~= "string" or not validateWriteBaseline(command) then return false end
    local ok = LrTasks.pcall(function() LrDevelopController.startTracking(command.field) end)
    if ok ~= true then return false end
    activeGesture = {
        kind = "curve",
        gestureId = command.gestureId,
        channel = command.channel,
        field = command.field,
        selectedPhotoUuid = command.expectedSelectedPhotoUuid,
        contextCounter = command.expectedContextCounter
    }
    return true
end

function ToneCurve.updateGesture(command)
    if not gestureMatches(command) then return false end
    if not validateWriteBaseline(command) then
        clearActiveGesture()
        return false
    end
    local ok = LrTasks.pcall(function() LrDevelopController.setValue(command.field, copyCurve(command.points)) end)
    if ok == true then
        adjustmentDirty = true
    else
        clearActiveGesture()
    end
    return ok == true
end

function ToneCurve.endGesture(command)
    if not gestureMatches(command) then return false end
    local writeAccepted = false
    if validateWriteBaseline(command) then
        local ok = LrTasks.pcall(function() LrDevelopController.setValue(command.field, copyCurve(command.points)) end)
        writeAccepted = ok == true
        if writeAccepted then adjustmentDirty = true end
    end
    local stopOk = clearActiveGesture()
    return writeAccepted and stopOk == true
end

function ToneCurve.cancelGesture(command)
    if not gestureMatches(command) then return false end
    return clearActiveGesture()
end

function ToneCurve.resetChannel(command)
    if not validateWriteBaseline(command) then return false end
    local ok = LrTasks.pcall(function() LrDevelopController.resetToDefault(command.field) end)
    if ok == true then adjustmentDirty = true end
    return ok == true
end


local function refineCommandShapeMatches(command, requireValue)
    if command.field ~= refineSaturationField or type(command.expectedSelectedPhotoUuid) ~= "string" or
        command.expectedSelectedPhotoUuid == "" or not validInteger(command.expectedContextCounter) or
        command.expectedContextCounter < 0 or not validInteger(command.expectedDevelopCounter) or
        command.expectedDevelopCounter < 0 or not validNumber(command.expectedValue) then return false end
    if requireValue == true and not validNumber(command.value) then return false end
    return true
end

local function validateRefineBaseline(command, requireValue)
    if not refineCommandShapeMatches(command, requireValue) or not activeModuleIsDevelop() then return false end
    local beforePhoto = selectedPhoto()
    if beforePhoto == nil or photoUuid(beforePhoto) ~= command.expectedSelectedPhotoUuid then return false end
    if not currentServerContextMatches(command) then return false end
    local valueOk, currentValue = LrTasks.pcall(function()
        return LrDevelopController.getValue(refineSaturationField)
    end)
    local rangeOk, minimum, maximum = LrTasks.pcall(function()
        return LrDevelopController.getRange(refineSaturationField)
    end)
    if valueOk ~= true or rangeOk ~= true or not validNumber(currentValue) or currentValue ~= command.expectedValue or
        not validNumber(minimum) or not validNumber(maximum) or minimum >= maximum then return false end
    if requireValue == true and (command.value < minimum or command.value > maximum) then return false end
    local afterPhoto = selectedPhoto()
    return afterPhoto == beforePhoto and photoUuid(afterPhoto) == command.expectedSelectedPhotoUuid and activeModuleIsDevelop()
end

function ToneCurve.beginRefineSaturationGesture(command)
    if activeGesture ~= nil then
        if refineGestureMatches(command) then return false end
        clearActiveGesture()
    end
    if type(command.gestureId) ~= "string" or not validateRefineBaseline(command, false) then return false end
    local ok = LrTasks.pcall(function() LrDevelopController.startTracking(refineSaturationField) end)
    if ok ~= true then return false end
    activeGesture = {
        kind = "refineSaturation",
        gestureId = command.gestureId,
        field = refineSaturationField,
        selectedPhotoUuid = command.expectedSelectedPhotoUuid,
        contextCounter = command.expectedContextCounter
    }
    return true
end

function ToneCurve.updateRefineSaturationGesture(command)
    if not refineGestureMatches(command) then return false end
    if not validateRefineBaseline(command, true) then
        clearActiveGesture()
        return false
    end
    local ok = LrTasks.pcall(function() LrDevelopController.setValue(refineSaturationField, command.value) end)
    if ok == true then adjustmentDirty = true else clearActiveGesture() end
    return ok == true
end

function ToneCurve.endRefineSaturationGesture(command)
    if not refineGestureMatches(command) then return false end
    local writeAccepted = false
    if validateRefineBaseline(command, true) then
        local ok = LrTasks.pcall(function() LrDevelopController.setValue(refineSaturationField, command.value) end)
        writeAccepted = ok == true
        if writeAccepted then adjustmentDirty = true end
    end
    local stopOk = clearActiveGesture()
    return writeAccepted and stopOk == true
end

function ToneCurve.cancelRefineSaturationGesture(command)
    if not refineGestureMatches(command) then return false end
    return clearActiveGesture()
end

function ToneCurve.resetRefineSaturation(command)
    if not validateRefineBaseline(command, false) then return false end
    if activeGesture ~= nil then clearActiveGesture() end
    local ok = LrTasks.pcall(function()
        LrDevelopController.resetToDefault(refineSaturationField)
    end)
    if ok == true then adjustmentDirty = true end
    return ok == true
end

local function validatePresetBaseline(command)
    local preset = presetCurves[command.preset]
    if preset == nil or command.field ~= channelFields.rgb or not validCurve(command.points) or
        serializeCurve(command.points) ~= serializeCurve(preset) then return false end
    if not commandShapeMatches({
        channel = "rgb",
        field = command.field,
        expectedSelectedPhotoUuid = command.expectedSelectedPhotoUuid,
        expectedContextCounter = command.expectedContextCounter,
        expectedDevelopCounter = command.expectedDevelopCounter,
        expectedPoints = command.expectedPoints
    }, false) or not activeModuleIsDevelop() then return false end
    local beforePhoto = selectedPhoto()
    if beforePhoto == nil or photoUuid(beforePhoto) ~= command.expectedSelectedPhotoUuid then return false end
    if not currentServerContextMatches(command) then return false end
    local ok, currentCurve = LrTasks.pcall(function()
        return LrDevelopController.getValue(channelFields.rgb)
    end)
    if ok ~= true or serializeCurve(currentCurve) ~= serializeCurve(command.expectedPoints) then return false end
    local afterPhoto = selectedPhoto()
    return afterPhoto == beforePhoto and photoUuid(afterPhoto) == command.expectedSelectedPhotoUuid and activeModuleIsDevelop()
end

function ToneCurve.setPreset(command)
    if not validatePresetBaseline(command) then return false end
    if activeGesture ~= nil then clearActiveGesture() end
    local startOk = LrTasks.pcall(function() LrDevelopController.startTracking(channelFields.rgb) end)
    if startOk ~= true then return false end
    local writeOk = LrTasks.pcall(function()
        LrDevelopController.setValue(channelFields.rgb, copyCurve(command.points))
    end)
    local stopOk = LrTasks.pcall(function() LrDevelopController.stopTracking(false) end)
    if writeOk == true then adjustmentDirty = true end
    return writeOk == true and stopOk == true
end

function ToneCurve.fieldForChannel(channel)
    return channelFields[channel]
end

function ToneCurve.serializeCurve(points)
    return serializeCurve(points)
end

return ToneCurve
