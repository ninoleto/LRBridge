local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local DevelopCategorical = {}

local whiteBalanceValues = {
    ["As Shot"] = true,
    ["Auto"] = true,
    ["Daylight"] = true,
    ["Cloudy"] = true,
    ["Shade"] = true,
    ["Tungsten"] = true,
    ["Fluorescent"] = true,
    ["Flash"] = true,
    ["Custom"] = true
}
-- Lightroom Classic 15.3 verified: setValue("WhiteBalance", "As Shot") changes
-- Temperature/Tint but authoritatively resolves to Custom, so As Shot is readback-only.
local whiteBalanceWritableValues = {
    ["Auto"] = true,
    ["Daylight"] = true,
    ["Cloudy"] = true,
    ["Shade"] = true,
    ["Tungsten"] = true,
    ["Fluorescent"] = true,
    ["Flash"] = true
}
local processValues = {
    ["Version 1"] = true,
    ["Version 2"] = true,
    ["Version 3"] = true,
    ["Version 4"] = true,
    ["Version 5"] = true,
    ["Version 6"] = true
}

local vignetteStyleValues = { [1] = true, [2] = true, [3] = true }
local uprightModeValues = { [0] = true, [1] = true, [2] = true, [3] = true, [4] = true, [5] = true }
local constrainCropValues = { [0] = true, [1] = true }

local function inDevelop()
    return string.lower(tostring(LrApplicationView.getCurrentModuleName())) == "develop"
end

local function hasTargetPhoto()
    local catalog = LrApplication.activeCatalog()
    return catalog ~= nil and catalog:getTargetPhoto() ~= nil
end

local function requireDevelop(panel)
    if not inDevelop() or not hasTargetPhoto() then error("Develop categorical control is unavailable") end
    if panel ~= nil then LrDevelopController.revealPanel(panel) end
end

local function urlEncode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

function DevelopCategorical.setAutoWhiteBalance()
    requireDevelop(nil)
    LrDevelopController.setAutoWhiteBalance()
    return true
end

function DevelopCategorical.setWhiteBalance(value)
    if whiteBalanceWritableValues[value] ~= true then error("Invalid White Balance preset") end
    if value == "Auto" then return DevelopCategorical.setAutoWhiteBalance() end
    requireDevelop("adjustPanel")
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    photo:quickDevelopSetWhiteBalance(value)
    return true
end

function DevelopCategorical.setProcess(value)
    if processValues[value] ~= true then error("Invalid Process version") end
    requireDevelop("calibratePanel")
    LrDevelopController.setProcessVersion(value)
    return true
end

function DevelopCategorical.setVignetteStyle(value)
    if vignetteStyleValues[value] ~= true then error("Invalid Post-Crop Vignetting Style") end
    requireDevelop("effectsPanel")
    LrDevelopController.setValue("PostCropVignetteStyle", value)
    return true
end

function DevelopCategorical.setUprightMode(value)
    if uprightModeValues[value] ~= true then error("Invalid Upright mode") end
    requireDevelop("lensCorrectionsPanel")
    LrDevelopController.setValue("PerspectiveUpright", value)
    return true
end

function DevelopCategorical.setConstrainCrop(value)
    if constrainCropValues[value] ~= true then error("Invalid Constrain Crop value") end
    requireDevelop("lensCorrectionsPanel")
    LrDevelopController.setValue("CropConstrainToWarp", value)
    return true
end

function DevelopCategorical.selectUprightTool()
    requireDevelop("lensCorrectionsPanel")
    LrDevelopController.selectTool("upright")
    return true
end

function DevelopCategorical.sendCurrentState()
    local contextAvailable = inDevelop() and hasTargetPhoto()

    local whiteBalanceOk, whiteBalance = LrTasks.pcall(function()
        local photo = LrApplication.activeCatalog():getTargetPhoto()
        local settings = photo:getDevelopSettings()
        return settings ~= nil and settings.WhiteBalance or nil
    end)
    local whiteBalanceAvailable = contextAvailable and whiteBalanceOk == true and
        type(whiteBalance) == "string" and whiteBalanceValues[whiteBalance] == true

    local processOk, process = pcall(function() return LrDevelopController.getProcessVersion() end)
    local processAvailable = contextAvailable and processOk == true and processValues[process] == true

    local vignetteOk, vignetteStyle = pcall(function()
        return LrDevelopController.getValue("PostCropVignetteStyle")
    end)
    local vignetteNumber = tonumber(vignetteStyle)
    local vignetteAvailable = contextAvailable and vignetteOk == true and vignetteNumber ~= nil and
        vignetteNumber == math.floor(vignetteNumber) and vignetteStyleValues[vignetteNumber] == true

    local uprightOk, uprightMode = pcall(function()
        return LrDevelopController.getValue("PerspectiveUpright")
    end)
    local uprightNumber = tonumber(uprightMode)
    local uprightAvailable = contextAvailable and uprightOk == true and uprightNumber ~= nil and
        uprightNumber == math.floor(uprightNumber) and uprightModeValues[uprightNumber] == true

    local constrainOk, constrainCrop = pcall(function()
        return LrDevelopController.getValue("CropConstrainToWarp")
    end)
    local constrainAvailable = contextAvailable and constrainOk == true and type(constrainCrop) == "number" and
        constrainCropValues[constrainCrop] == true

    local toolOk, selectedTool = pcall(function() return LrDevelopController.getSelectedTool() end)
    local selectedToolAvailable = contextAvailable and toolOk == true and type(selectedTool) == "string" and
        selectedTool ~= "" and string.len(selectedTool) <= 64

    local url = "http://127.0.0.1:17891/develop-categorical/result" ..
        "?whiteBalanceAvailable=" .. tostring(whiteBalanceAvailable) ..
        "&processAvailable=" .. tostring(processAvailable) ..
        "&vignetteStyleAvailable=" .. tostring(vignetteAvailable) ..
        "&uprightModeAvailable=" .. tostring(uprightAvailable) ..
        "&constrainCropAvailable=" .. tostring(constrainAvailable) ..
        "&selectedToolAvailable=" .. tostring(selectedToolAvailable)
    if whiteBalanceAvailable then url = url .. "&whiteBalance=" .. urlEncode(whiteBalance) end
    if processAvailable then url = url .. "&process=" .. urlEncode(process) end
    if vignetteAvailable then url = url .. "&vignetteStyle=" .. tostring(vignetteNumber) end
    if uprightAvailable then url = url .. "&uprightMode=" .. tostring(uprightNumber) end
    if constrainAvailable then url = url .. "&constrainCrop=" .. tostring(constrainCrop) end
    if selectedToolAvailable then url = url .. "&selectedTool=" .. urlEncode(selectedTool) end
    LrHttp.get(url)

    return {
        whiteBalanceAvailable = whiteBalanceAvailable,
        whiteBalance = whiteBalanceAvailable and whiteBalance or nil,
        processAvailable = processAvailable,
        process = processAvailable and process or nil,
        vignetteStyleAvailable = vignetteAvailable,
        vignetteStyle = vignetteAvailable and vignetteNumber or nil,
        uprightModeAvailable = uprightAvailable,
        uprightMode = uprightAvailable and uprightNumber or nil,
        constrainCropAvailable = constrainAvailable,
        constrainCrop = constrainAvailable and constrainCrop or nil,
        selectedToolAvailable = selectedToolAvailable,
        selectedTool = selectedToolAvailable and selectedTool or nil
    }
end

return DevelopCategorical
