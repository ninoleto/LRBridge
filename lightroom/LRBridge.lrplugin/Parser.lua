local Parser = {}

local function parseBooleanField(json, fieldName)
    local keyPattern = '"' .. fieldName .. '"%s*:'
    local count = 0

    for _ in string.gmatch(json, keyPattern) do
        count = count + 1
    end

    if count ~= 1 then
        return nil
    end

    if string.match(json, keyPattern .. '%s*true%s*[,}]') then
        return true
    end

    if string.match(json, keyPattern .. '%s*false%s*[,}]') then
        return false
    end

    return nil
end

local function parseIntegerArrayField(json, fieldName)
    local keyPattern = '"' .. fieldName .. '"%s*:'
    local count = 0
    for _ in string.gmatch(json, keyPattern) do count = count + 1 end
    if count ~= 1 then return nil end

    local body = string.match(json, keyPattern .. '%s*%[([^%]]*)%]')
    if body == nil or body == "" then return nil end
    local values = {}
    for token in string.gmatch(body, "([^,]+)") do
        local trimmed = string.match(token, "^%s*(.-)%s*$")
        if trimmed == nil or string.match(trimmed, "^%-?%d+$") == nil then return nil end
        table.insert(values, tonumber(trimmed))
    end
    return values
end

function Parser.parse(json)

    local command = string.match(json, [["command":"([^"]+)"]])
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local action = string.match(json, [["action":"([^"]+)"]])
    local target = string.match(json, [["target":"([^"]+)"]])
    local targetCount = 0
    for _ in string.gmatch(json, [["target"%s*:]]) do targetCount = targetCount + 1 end
    local direction = string.match(json, [["direction":"([^"]+)"]])
    local flag = string.match(json, [["flag":"([^"]+)"]])
    local label = string.match(json, [["label":"([^"]+)"]])
    local operation = string.match(json, [["operation":"([^"]+)"]])
    local module = string.match(json, [["module":"([^"]+)"]])
    local view = string.match(json, [["view":"([^"]+)"]])
    local mode = string.match(json, [["mode":"([^"]+)"]])
    local scope = string.match(json, [["scope":"([^"]+)"]])
    local region = string.match(json, [["region":"([^"]+)"]])
    local control = string.match(json, [["control":"([^"]+)"]])
    local field = string.match(json, [["field":"([^"]+)"]])
    local range = string.match(json, [["range":"([^"]+)"]])
    local boundary = string.match(json, [["boundary":"([^"]+)"]])
    local profile = string.match(json, [["profile":"([^"]+)"]])
    local commitId = string.match(json, [["commitId":"([^"]+)"]])
    local channel = string.match(json, [["channel":"([^"]+)"]])
    local gestureId = string.match(json, [["gestureId":"([^"]+)"]])
    local preset = string.match(json, [["preset":"([^"]+)"]])
    local expectedSelectedPhotoUuid = string.match(json, [["expectedSelectedPhotoUuid":"([^"]+)"]])
    local expectedSelectedIndex = string.match(json, [["expectedSelectedIndex":([%-]?%d+)]])
    local expectedContextCounter = string.match(json, [["expectedContextCounter":([%-]?%d+)]])
    local expectedDevelopCounter = string.match(json, [["expectedDevelopCounter":([%-]?%d+)]])
    local expectedValue = string.match(json, [["expectedValue":([%-]?%d+%.?%d*)]])
    local profileGeneration = string.match(json, [["profileGeneration":([%-]?%d+)]])
    local lowerNone = string.match(json, [["LowerNone":([%-]?%d+%.?%d*)]])
    local lowerFull = string.match(json, [["LowerFull":([%-]?%d+%.?%d*)]])
    local upperFull = string.match(json, [["UpperFull":([%-]?%d+%.?%d*)]])
    local upperNone = string.match(json, [["UpperNone":([%-]?%d+%.?%d*)]])
    local hue = string.match(json, [["hue":([%-]?%d+%.?%d*)]])
    local saturation = string.match(json, [["saturation":([%-]?%d+%.?%d*)]])
    local rating = string.match(json, [["rating":([%-]?%d+)]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])
    local enabled = parseBooleanField(json, "enabled")
    local w = string.match(json, [["w":([%-]?%d+)]])
    local h = string.match(json, [["h":([%-]?%d+)]])
    local value = string.match(json, [["value":"([^"]+)"]])
    local points = parseIntegerArrayField(json, "points")
    local expectedPoints = parseIntegerArrayField(json, "expectedPoints")

    if value == nil then
        value = string.match(json, [["value":([%-]?%d+%.?%d*)]])
        if value then
            value = tonumber(value)
        end
    end

    if amount then
        amount = tonumber(amount)
    end
    if hue then hue = tonumber(hue) end
    if saturation then saturation = tonumber(saturation) end

    if rating then
        rating = tonumber(rating)
    end

    if w then
        w = tonumber(w)
    end

    if h then
        h = tonumber(h)
    end
    if expectedSelectedIndex then expectedSelectedIndex = tonumber(expectedSelectedIndex) end
    if expectedContextCounter then expectedContextCounter = tonumber(expectedContextCounter) end
    if expectedDevelopCounter then expectedDevelopCounter = tonumber(expectedDevelopCounter) end
    if expectedValue then expectedValue = tonumber(expectedValue) end
    if profileGeneration then profileGeneration = tonumber(profileGeneration) end
    if lowerNone then lowerNone = tonumber(lowerNone) end
    if lowerFull then lowerFull = tonumber(lowerFull) end
    if upperFull then upperFull = tonumber(upperFull) end
    if upperNone then upperNone = tonumber(upperNone) end
    if commitId ~= nil and (string.len(commitId) > 64 or string.match(commitId, "^[A-Za-z0-9_-]+$") == nil) then
        commitId = nil
    end

    if command == nil then
        return nil
    end

    if targetCount > 0 and (targetCount ~= 1 or command ~= "develop.action" or
        action ~= "selectCropTool" or (target ~= "crop" and target ~= "loupe")) then
        return nil
    end

    return {
        command = command,
        slider = slider,
        action = action,
        target = target,
        direction = direction,
        flag = flag,
        rating = rating,
        label = label,
        operation = operation,
        module = module,
        view = view,
        mode = mode,
        scope = scope,
        amount = amount,
        w = w,
        h = h,
        value = value
        ,region = region
        ,control = control
        ,hue = hue
        ,saturation = saturation
        ,enabled = enabled
        ,field = field
        ,range = range
        ,boundary = boundary
        ,profile = profile
        ,LowerNone = lowerNone
        ,LowerFull = lowerFull
        ,UpperFull = upperFull
        ,UpperNone = upperNone
        ,expectedSelectedIndex = expectedSelectedIndex
        ,expectedContextCounter = expectedContextCounter
        ,profileGeneration = profileGeneration
        ,commitId = commitId
        ,channel = channel
        ,gestureId = gestureId
        ,preset = preset
        ,expectedSelectedPhotoUuid = expectedSelectedPhotoUuid
        ,expectedDevelopCounter = expectedDevelopCounter
        ,expectedValue = expectedValue
        ,points = points
        ,expectedPoints = expectedPoints
    }

end

return Parser
