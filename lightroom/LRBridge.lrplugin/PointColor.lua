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

local function readState()
    if not inDevelop() or not processVersionEligible() then return { available = false, swatchCount = 0, selectedIndex = 0, selectionTransient = false } end
    local colors = LrDevelopController.getValue("PointColors")
    local index = LrDevelopController.getSelectedPointColorSwatchIndex(false)
    if type(colors) ~= "table" or type(index) ~= "number" then error("Transient Point Color read failure") end
    local swatchCount = 0
    for key, value in pairs(colors) do
        if type(key) == "number" and key == math.floor(key) and key >= 1 and key <= 8 and type(value) == "table" then swatchCount = swatchCount + 1 end
    end
    if swatchCount == 0 then return { available = true, swatchCount = 0, selectedIndex = 0, selectionTransient = false } end
    if index <= 0 or type(colors[index]) ~= "table" then return { available = true, swatchCount = swatchCount, selectedIndex = 0, selectionTransient = true } end
    local swatch = colors[index]
    local state = { available = true, swatchCount = swatchCount, selectedIndex = index, selectionTransient = false }
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
    if rangeNames[rangeName] ~= true or (boundary ~= "LowerNone" and boundary ~= "LowerFull" and boundary ~= "UpperFull" and boundary ~= "UpperNone") or
        not finite(value) or value < 0 or value > 1 then error("Invalid Point Color range value") end
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    local colors = LrDevelopController.getValue("PointColors")
    local selectedIndex = LrDevelopController.getSelectedPointColorSwatchIndex(false)
    if type(colors) ~= "table" or selectedIndex ~= expectedSelectedIndex or type(colors[selectedIndex]) ~= "table" then PointColor.sendCurrentState(); return false end
    local completeSwatch = deepCopy(colors[selectedIndex], {})
    if not validNestedRange(completeSwatch[rangeName]) then PointColor.sendCurrentState(); return false end
    local marker = effectiveRangeMarker(completeSwatch[rangeName], rangeMarker(completeSwatch, rangeName))
    if marker == nil then PointColor.sendCurrentState(); return false end
    completeSwatch[rangeName][boundary] = value
    if not proposedRangeContainsMarker(completeSwatch[rangeName], marker) or not safeFullRangeWidth(completeSwatch[rangeName]) then PointColor.sendCurrentState(); return false end
    local success, message = LrDevelopController.updateSelectedPointColorSwatch(completeSwatch, false)
    PointColor.sendCurrentState()
    if success ~= true then error("Point Color range update rejected: " .. tostring(message or "unknown")) end
    return true
end

function PointColor.translateRange(rangeName, lowerNone, lowerFull, upperFull, upperNone, expectedSelectedIndex)
    if rangeNames[rangeName] ~= true then error("Invalid Point Color range translation") end
    local translated = { LowerNone = lowerNone, LowerFull = lowerFull, UpperFull = upperFull, UpperNone = upperNone }
    if not validNestedRange(translated) then error("Invalid Point Color range translation") end
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    local colors = LrDevelopController.getValue("PointColors")
    local selectedIndex = LrDevelopController.getSelectedPointColorSwatchIndex(false)
    if type(colors) ~= "table" or selectedIndex ~= expectedSelectedIndex or type(colors[selectedIndex]) ~= "table" then PointColor.sendCurrentState(); return false end
    local completeSwatch = deepCopy(colors[selectedIndex], {})
    if not validNestedRange(completeSwatch[rangeName]) then PointColor.sendCurrentState(); return false end
    local marker = effectiveRangeMarker(completeSwatch[rangeName], rangeMarker(completeSwatch, rangeName))
    if marker == nil or not proposedRangeContainsMarker(translated, marker) or not safeFullRangeWidth(translated) then PointColor.sendCurrentState(); return false end
    completeSwatch[rangeName] = deepCopy(translated, {})
    local success, message = LrDevelopController.updateSelectedPointColorSwatch(completeSwatch, false)
    PointColor.sendCurrentState()
    if success ~= true then error("Point Color range translation rejected: " .. tostring(message or "unknown")) end
    return true
end

function PointColor.sendCurrentState()
    local ok, state = pcall(readState)
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
    local range = fields[field]
    if range == nil or not finite(value) or value < range[1] or value > range[2] then error("Invalid Point Color value") end
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    local colors = LrDevelopController.getValue("PointColors")
    local selectedIndex = LrDevelopController.getSelectedPointColorSwatchIndex(false)
    if type(colors) ~= "table" or selectedIndex ~= expectedSelectedIndex or type(colors[selectedIndex]) ~= "table" then
        PointColor.sendCurrentState()
        return false
    end
    local completeSwatch = deepCopy(colors[selectedIndex], {})
    completeSwatch[field] = value
    local success, message = LrDevelopController.updateSelectedPointColorSwatch(completeSwatch, false)
    PointColor.sendCurrentState()
    if success ~= true then error("Point Color update rejected: " .. tostring(message or "unknown")) end
    return true
end

function PointColor.toggleRangeVisualization()
    if not inDevelop() or not processVersionEligible() then error("Point Color requires Process Version 3+ in Develop") end
    LrDevelopController.togglePointColorRangeVisualization(false)
    return true
end

return PointColor
