local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"

local PointColor = {}
local fields = { HueShift = {-1, 1}, SatScale = {-1, 1}, LumScale = {-1, 1}, Variance = {-1, 1}, RangeAmount = {0, 1} }
local rangeNames = { HueRange = true, SatRange = true, LumRange = true }
local boundaries = { "LowerNone", "LowerFull", "UpperFull", "UpperNone" }
local markerFields = { HueRange = "HueRangeMarker", SatRange = "SatRangeMarker", LumRange = "LumRangeMarker" }
local markerEpsilon = 0.0000000001
local minimumFullRangeWidth = 0.01
local widthEpsilon = 0.00000002

local function finite(value) return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge end

local function inDevelop()
    return string.lower(tostring(LrApplicationView.getCurrentModuleName())) == "develop"
end

local function processVersionEligible()
    local value = LrDevelopController.getProcessVersion()
    local version = tonumber(string.match(tostring(value), "(%d+)$"))
    return version ~= nil and version >= 3
end

local function deepCopy(value, seen)
    local valueType = type(value)
    if valueType == "number" then if finite(value) then return value end; error("Point Color contains nonfinite data") end
    if valueType == "boolean" or valueType == "string" then return value end
    if valueType ~= "table" or seen[value] then error("Point Color contains unsupported data") end
    seen[value] = true
    local copy = {}
    for key, child in pairs(value) do
        if type(key) ~= "string" and type(key) ~= "number" then error("Point Color contains unsupported key") end
        copy[key] = deepCopy(child, seen)
    end
    seen[value] = nil
    return copy
end

local function denseArrayLength(value, maximum)
    if type(value) ~= "table" then return nil end
    local count = 0
    local largest = 0
    for key, _ in pairs(value) do
        if type(key) ~= "number" or key < 1 or key ~= math.floor(key) then return nil end
        count = count + 1
        if count > maximum then return nil end
        if key > largest then largest = key end
    end
    if largest ~= count then return nil end
    return count
end

local function validNestedRange(value)
    if type(value) ~= "table" then return false end
    local count = 0
    for key, child in pairs(value) do
        if key ~= "LowerNone" and key ~= "LowerFull" and key ~= "UpperFull" and key ~= "UpperNone" then return false end
        if not finite(child) or child < 0 or child > 1 then return false end
        count = count + 1
    end
    return count == 4 and value.LowerNone <= value.LowerFull and value.LowerFull <= value.UpperFull and value.UpperFull <= value.UpperNone
end

local function validSwatch(swatch)
    if type(swatch) ~= "table" or not finite(swatch.SrcHue) or swatch.SrcHue < 0 or swatch.SrcHue > 6 or
        not finite(swatch.SrcSat) or swatch.SrcSat < 0 or swatch.SrcSat > 1 or
        not finite(swatch.SrcLum) or swatch.SrcLum < 0 or swatch.SrcLum > 1 then return false end
    for field, range in pairs(fields) do
        if not finite(swatch[field]) or swatch[field] < range[1] or swatch[field] > range[2] then return false end
    end
    for rangeName, _ in pairs(rangeNames) do
        if not validNestedRange(swatch[rangeName]) then return false end
    end
    return true
end

local function validCollection(colors)
    local count = denseArrayLength(colors, 8)
    if count == nil then return false end
    for index = 1, count do if not validSwatch(colors[index]) then return false end end
    return true
end

local function closeNumber(left, right)
    return finite(left) and finite(right) and math.abs(left - right) <=
        math.max(0.000001, math.abs(right) * 0.000001)
end

local function equivalentCollection(left, right)
    local leftCount = denseArrayLength(left, 8)
    local rightCount = denseArrayLength(right, 8)
    if leftCount == nil or rightCount == nil or leftCount ~= rightCount then return false end
    for index = 1, leftCount do
        local leftSwatch = left[index]
        local rightSwatch = right[index]
        if not validSwatch(leftSwatch) or not validSwatch(rightSwatch) then return false end
        if not closeNumber(leftSwatch.SrcHue, rightSwatch.SrcHue) or
            not closeNumber(leftSwatch.SrcSat, rightSwatch.SrcSat) or
            not closeNumber(leftSwatch.SrcLum, rightSwatch.SrcLum) then return false end
        for field, _ in pairs(fields) do
            if not closeNumber(leftSwatch[field], rightSwatch[field]) then return false end
        end
        for rangeName, _ in pairs(rangeNames) do
            for _, boundary in ipairs(boundaries) do
                if not closeNumber(leftSwatch[rangeName][boundary], rightSwatch[rangeName][boundary]) then return false end
            end
        end
    end
    return true
end

local function normalizedSourceEquivalent(current, expected)
    if closeNumber(current, expected) then return true end
    local normalized = math.floor(expected * 100 + 0.5) / 100
    return closeNumber(current, normalized)
end

local function presetEquivalentCollection(left, right)
    local leftCount = denseArrayLength(left, 8)
    local rightCount = denseArrayLength(right, 8)
    if leftCount == nil or rightCount == nil or leftCount ~= rightCount then return false end
    for index = 1, leftCount do
        local leftSwatch = left[index]
        local rightSwatch = right[index]
        if not validSwatch(leftSwatch) or not validSwatch(rightSwatch) then return false end
        if not normalizedSourceEquivalent(leftSwatch.SrcHue, rightSwatch.SrcHue) or
            not normalizedSourceEquivalent(leftSwatch.SrcSat, rightSwatch.SrcSat) or
            not normalizedSourceEquivalent(leftSwatch.SrcLum, rightSwatch.SrcLum) then return false end
        for field, _ in pairs(fields) do
            if not closeNumber(leftSwatch[field], rightSwatch[field]) then return false end
        end
        for rangeName, _ in pairs(rangeNames) do
            for _, boundary in ipairs(boundaries) do
                if not closeNumber(leftSwatch[rangeName][boundary], rightSwatch[rangeName][boundary]) then return false end
            end
        end
    end
    return true
end

local function replaceCollection(value, isForMasking, selectedIndex)
    if not validCollection(value) then return false, "invalid_collection" end
    if selectedIndex ~= nil and (type(selectedIndex) ~= "number" or selectedIndex ~= math.floor(selectedIndex) or
        selectedIndex < 1 or selectedIndex > #value) then return false, "invalid_selection" end
    local current = LrDevelopController.getValue(isForMasking and "local_PointColors" or "PointColors")
    local currentCount = denseArrayLength(current, 8)
    if currentCount == nil then return false, "unreadable_collection" end
    if not presetEquivalentCollection(current, value) then
        if currentCount > 0 then
            local deleted, deleteMessage = LrDevelopController.deletePointColorSwatch(true, 1, isForMasking == true)
            if deleted ~= true then return false, deleteMessage or "delete_rejected" end
        end
        for index = 1, #value do
            local added, addMessage = LrDevelopController.addPointColorSwatch(deepCopy(value[index], {}), isForMasking == true)
            if added ~= true then return false, addMessage or "add_rejected" end
        end
    end
    if selectedIndex ~= nil then LrDevelopController.selectPointColorSwatch(selectedIndex, isForMasking == true) end
    return true
end

local function linearToDisplay(value)
    if value <= 0.0031308 then return 12.92 * value end
    return 1.055 * math.pow(value, 1 / 2.4) - 0.055
end

local function rangeMarker(swatch, rangeName)
    if rangeName == "HueRange" then return 0.5 end
    if rangeName == "SatRange" and finite(swatch.SrcSat) and swatch.SrcSat >= 0 and swatch.SrcSat <= 1 then return swatch.SrcSat end
    if rangeName == "LumRange" and finite(swatch.SrcLum) and swatch.SrcLum >= 0 and swatch.SrcLum <= 1 then return linearToDisplay(swatch.SrcLum) end
    return nil
end

local function effectiveRangeMarker(value, marker)
    if not validNestedRange(value) or not finite(marker) or marker < 0 or marker > 1 then return nil end
    return math.max(value.LowerFull, math.min(marker, value.UpperFull))
end

local function proposedRangeContainsMarker(value, marker)
    return validNestedRange(value) and finite(marker) and value.LowerFull <= marker + markerEpsilon and value.UpperFull + markerEpsilon >= marker
end

local function safeFullRangeWidth(value)
    return validNestedRange(value) and value.UpperFull - value.LowerFull + widthEpsilon >= minimumFullRangeWidth
end

local function readState(isForMasking)
    if not inDevelop() or not processVersionEligible() then return { available = false, swatchCount = 0, selectedIndex = 0, selectionTransient = false } end
    local colors = LrDevelopController.getValue(isForMasking and "local_PointColors" or "PointColors")
    local index = LrDevelopController.getSelectedPointColorSwatchIndex(isForMasking == true)
    if type(colors) ~= "table" or type(index) ~= "number" then error("Transient Point Color read failure") end
    local presetCollection = validCollection(colors) and deepCopy(colors, {}) or nil
    local swatchCount = 0
    for key, value in pairs(colors) do
        if type(key) == "number" and key == math.floor(key) and key >= 1 and key <= 8 and type(value) == "table" then swatchCount = swatchCount + 1 end
    end
    if swatchCount == 0 then return { available = true, swatchCount = 0, selectedIndex = 0,
        selectionTransient = false, presetCollection = presetCollection } end
    if index <= 0 or type(colors[index]) ~= "table" then return { available = true, swatchCount = swatchCount,
        selectedIndex = 0, selectionTransient = true, presetCollection = presetCollection } end
    local swatch = colors[index]
    local state = { available = true, swatchCount = swatchCount, selectedIndex = index,
        selectionTransient = false, presetCollection = presetCollection }
    for field, range in pairs(fields) do
        local value = swatch[field]
        if not finite(value) or value < range[1] or value > range[2] then error("Malformed Point Color scalar state") end
        state[field] = value
    end
    for rangeName, _ in pairs(rangeNames) do
        if not validNestedRange(swatch[rangeName]) then error("Malformed Point Color range state") end
        local marker = effectiveRangeMarker(swatch[rangeName], rangeMarker(swatch, rangeName))
        state[rangeName] = deepCopy(swatch[rangeName], {})
        if marker ~= nil then state[markerFields[rangeName]] = marker end
    end
    return state
end

local function selectedSwatch(expectedSelectedIndex, isForMasking)
    local colors = LrDevelopController.getValue(isForMasking and "local_PointColors" or "PointColors")
    local selectedIndex = LrDevelopController.getSelectedPointColorSwatchIndex(isForMasking == true)
    if type(colors) ~= "table" or selectedIndex ~= expectedSelectedIndex or type(colors[selectedIndex]) ~= "table" then
        return nil
    end
    return deepCopy(colors[selectedIndex], {})
end

local function updateSwatch(completeSwatch, isForMasking)
    local success, message = LrDevelopController.updateSelectedPointColorSwatch(completeSwatch, isForMasking == true)
    return success == true, message
end

function PointColor.readContextState(isForMasking)
    return readState(isForMasking == true)
end

function PointColor.updateContextValue(field, value, expectedSelectedIndex, isForMasking)
    local range = fields[field]
    if range == nil or not finite(value) or value < range[1] or value > range[2] then error("Invalid Point Color value") end
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    local completeSwatch = selectedSwatch(expectedSelectedIndex, isForMasking)
    if completeSwatch == nil then return false, "selection_changed" end
    completeSwatch[field] = value
    return updateSwatch(completeSwatch, isForMasking)
end

function PointColor.updateContextRange(rangeName, boundary, value, expectedSelectedIndex, isForMasking)
    if rangeNames[rangeName] ~= true or
        (boundary ~= "LowerNone" and boundary ~= "LowerFull" and boundary ~= "UpperFull" and boundary ~= "UpperNone") or
        not finite(value) or value < 0 or value > 1 then error("Invalid Point Color range value") end
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    local completeSwatch = selectedSwatch(expectedSelectedIndex, isForMasking)
    if completeSwatch == nil or not validNestedRange(completeSwatch[rangeName]) then return false, "selection_changed" end
    local marker = effectiveRangeMarker(completeSwatch[rangeName], rangeMarker(completeSwatch, rangeName))
    if marker == nil then return false, "unreadable_marker" end
    completeSwatch[rangeName][boundary] = value
    if not proposedRangeContainsMarker(completeSwatch[rangeName], marker) or not safeFullRangeWidth(completeSwatch[rangeName]) then
        return false, "range_excludes_selected_color"
    end
    return updateSwatch(completeSwatch, isForMasking)
end

function PointColor.translateContextRange(rangeName, lowerNone, lowerFull, upperFull, upperNone,
    expectedSelectedIndex, isForMasking)
    if rangeNames[rangeName] ~= true then error("Invalid Point Color range translation") end
    local translated = { LowerNone = lowerNone, LowerFull = lowerFull, UpperFull = upperFull, UpperNone = upperNone }
    if not validNestedRange(translated) then error("Invalid Point Color range translation") end
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    local completeSwatch = selectedSwatch(expectedSelectedIndex, isForMasking)
    if completeSwatch == nil or not validNestedRange(completeSwatch[rangeName]) then return false, "selection_changed" end
    local marker = effectiveRangeMarker(completeSwatch[rangeName], rangeMarker(completeSwatch, rangeName))
    if marker == nil or not proposedRangeContainsMarker(translated, marker) or not safeFullRangeWidth(translated) then
        return false, "range_excludes_selected_color"
    end
    completeSwatch[rangeName] = deepCopy(translated, {})
    return updateSwatch(completeSwatch, isForMasking)
end

local function postState(state)
    local url = "http://127.0.0.1:17891/point-color/result?available=" .. tostring(state.available) .. "&swatchCount=" .. tostring(state.swatchCount) ..
        "&selectedIndex=" .. tostring(state.selectedIndex) .. "&selectionTransient=" .. tostring(state.selectionTransient)
    if state.available and state.selectedIndex > 0 then
        for field, _ in pairs(fields) do url = url .. "&" .. field .. "=" .. tostring(state[field]) end
        for rangeName, _ in pairs(rangeNames) do
            if state[markerFields[rangeName]] ~= nil then url = url .. "&" .. markerFields[rangeName] .. "=" .. tostring(state[markerFields[rangeName]]) end
            for _, boundary in ipairs(boundaries) do url = url .. "&" .. rangeName .. "." .. boundary .. "=" .. tostring(state[rangeName][boundary]) end
        end
    end
    LrHttp.get(url)
end

function PointColor.setRange(rangeName, boundary, value, expectedSelectedIndex)
    local success, message = PointColor.updateContextRange(rangeName, boundary, value, expectedSelectedIndex, false)
    PointColor.sendCurrentState()
    if success ~= true then error("Point Color range update rejected: " .. tostring(message or "unknown")) end
    return true
end

function PointColor.translateRange(rangeName, lowerNone, lowerFull, upperFull, upperNone, expectedSelectedIndex)
    local success, message = PointColor.translateContextRange(rangeName, lowerNone, lowerFull, upperFull, upperNone,
        expectedSelectedIndex, false)
    PointColor.sendCurrentState()
    if success ~= true then error("Point Color range translation rejected: " .. tostring(message or "unknown")) end
    return true
end

function PointColor.sendCurrentState()
    local ok, state = pcall(function() return readState(false) end)
    if not ok then return nil end
    postState(state)
    return state
end

function PointColor.selectTool()
    if not inDevelop() then error("Point Color tool requires Develop") end
    LrDevelopController.selectTool("point_color")
    return true
end

function PointColor.setValue(field, value, expectedSelectedIndex)
    local success, message = PointColor.updateContextValue(field, value, expectedSelectedIndex, false)
    PointColor.sendCurrentState()
    if success ~= true then error("Point Color update rejected: " .. tostring(message or "unknown")) end
    return true
end

function PointColor.toggleRangeVisualization()
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    LrDevelopController.togglePointColorRangeVisualization(false)
    return true
end

function PointColor.copyCollection(value)
    if not validCollection(value) then return nil end
    return deepCopy(value, {})
end

function PointColor.collectionsEquivalent(left, right)
    return equivalentCollection(left, right)
end

function PointColor.presetCollectionsEquivalent(left, right)
    return presetEquivalentCollection(left, right)
end

function PointColor.replaceContextCollection(value, isForMasking, selectedIndex)
    return replaceCollection(value, isForMasking == true, selectedIndex)
end

function PointColor.validValue(field, value)
    local range = fields[field]
    return range ~= nil and finite(value) and value >= range[1] and value <= range[2]
end

function PointColor.validRange(value)
    return validNestedRange(value)
end

return PointColor
