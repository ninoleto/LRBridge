local Parser = {}

local function parseStringField(json, fieldName)
    local keyPattern = '"' .. fieldName .. '"%s*:'
    local count = 0
    for _ in string.gmatch(json, keyPattern) do count = count + 1 end
    if count ~= 1 then return nil end
    return string.match(json, keyPattern .. '%s*"([^"%c]+)"')
end

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

local function parseIntegerField(json, fieldName)
    local keyPattern = '"' .. fieldName .. '"%s*:'
    local count = 0
    for _ in string.gmatch(json, keyPattern) do count = count + 1 end
    if count ~= 1 then return nil end
    local value = string.match(json, keyPattern .. '%s*([%-]?%d+)%s*[,}]')
    if value == nil then return nil end
    return tonumber(value)
end

local function parseNumberField(json, fieldName)
    local keyPattern = '"' .. fieldName .. '"%s*:'
    local count = 0
    for _ in string.gmatch(json, keyPattern) do count = count + 1 end
    if count ~= 1 then return nil end
    local value = string.match(json, keyPattern .. '%s*([%-]?%d+%.?%d*)%s*[,}]')
    if value == nil then return nil end
    return tonumber(value)
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
    if command == "develop.reset.correlated" then
        if string.len(json) > 2048 then return nil end
        -- /next wraps the flat command in {"command":{...}}. Validate the
        -- inner object, so the envelope key is not a duplicate command field.
        json = string.match(json, '^%s*{%s*"command"%s*:%s*({[^{}]*})%s*}%s*$') or json
        local fields = { command = true, operationId = true, requestId = true, slider = true, expectedServerEpoch = true,
            expectedSelectedPhotoUuid = true, expectedContextCounter = true, expectedContextChangedAt = true, admittedDevelopCounter = true }
        local seen, count = {}, 0
        for key in string.gmatch(json, '"([%w_]+)"%s*:') do
            if not fields[key] or seen[key] then return nil end
            seen[key], count = true, count + 1
        end
        if count ~= 9 then return nil end
        local c = { command = command }
        for _, key in ipairs({ "operationId", "requestId", "slider", "expectedServerEpoch", "expectedSelectedPhotoUuid" }) do
            c[key] = parseStringField(json, key)
            if not c[key] or #c[key] > 120 or not string.match(c[key], "^[%w:_%-]+$") then return nil end
        end
        if not string.match(c.operationId, "^rc%-%d+$") or #c.operationId > 13 then return nil end
        for _, key in ipairs({ "expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter" }) do
            c[key] = parseIntegerField(json, key)
            if not c[key] or c[key] < 0 or c[key] > 9007199254740991 then return nil end
        end
        return c
    end
    if command == "develop.nudge" then
        if string.len(json) > 4096 then return nil end
        json = string.match(json, '^%s*{%s*"command"%s*:%s*({[^{}]*})%s*}%s*$') or json
        local fields = { command = true, operationId = true, requestId = true, slider = true, steps = true,
            numericStep = true, precision = true, expectedServerEpoch = true, expectedSelectedPhotoUuid = true,
            expectedContextCounter = true, expectedContextChangedAt = true, admittedDevelopCounter = true }
        local seen, count = {}, 0
        for key in string.gmatch(json, '"([%w_]+)"%s*:') do
            if not fields[key] or seen[key] then return nil end
            seen[key], count = true, count + 1
        end
        if count ~= 12 then return nil end
        local c = { command = command }
        for _, key in ipairs({ "operationId", "requestId", "slider", "expectedServerEpoch", "expectedSelectedPhotoUuid" }) do
            c[key] = parseStringField(json, key)
            if not c[key] or #c[key] > 120 or not string.match(c[key], "^[%w:_%-]+$") then return nil end
        end
        if not string.match(c.operationId, "^nn%-%d+$") then return nil end
        for _, key in ipairs({ "precision", "expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter" }) do
            c[key] = parseIntegerField(json, key)
            if not c[key] or c[key] < 0 or c[key] > 9007199254740991 then return nil end
        end
        c.numericStep = parseNumberField(json, "numericStep")
        if not c.numericStep or c.numericStep <= 0 or c.numericStep > 1 or c.precision > 6 then return nil end
        local body = string.match(json, '"steps"%s*:%s*%[([^%]]*)%]')
        if not body then return nil end
        c.steps = {}
        local total = 0
        for token in string.gmatch(body .. ",", "([^,]*),") do
            if not string.match(token, "^%s*%-?%d+%s*$") then return nil end
            local n = tonumber(token)
            if not n or n == 0 or math.abs(n) > 1000 then return nil end
            c.steps[#c.steps + 1], total = n, total + math.abs(n)
        end
        if #c.steps == 0 or #c.steps > 64 or total > 4096 then return nil end
        return c
    end
    if command == "develop.set.guarded" then
        if #json > 2048 then return nil end
        json = string.match(json, '^%s*{%s*"command"%s*:%s*({[^{}]*})%s*}%s*$') or json
        local body = string.match(json, '^%s*{([^{}]*)}%s*$')
        if not body then return nil end
        local strings = { command = true, operationId = true, requestId = true, slider = true, expectedServerEpoch = true, expectedSelectedPhotoUuid = true }
        local numbers = { value = true, expectedValue = true, expectedContextCounter = true, expectedContextChangedAt = true, admittedDevelopCounter = true }
        local c, count, pos = {}, 0, 1
        while true do
            local key, offset = string.match(string.sub(body, pos), '^%s*"([%w_]+)"%s*:%s*()')
            if not key or c[key] ~= nil or not (strings[key] or numbers[key]) then return nil end
            pos = pos + offset - 1
            local token, after
            if strings[key] then token, after = string.match(string.sub(body, pos), '^"([%w:_%.-]+)"()')
            else
                token, after = string.match(string.sub(body, pos), '^(%-?%d+%.?%d*[eE][+%-]?%d+)()')
                if not token then token, after = string.match(string.sub(body, pos), '^(%-?%d+%.?%d*)()') end
                if token and (string.match(token, '^%-?0%d') or string.match(token, '%.[eE]') or string.sub(token, -1) == '.') then return nil end
            end
            if not token or #token > 120 then return nil end
            c[key] = strings[key] and token or tonumber(token)
            if c[key] == nil then return nil end
            pos, count = pos + after - 1, count + 1
            local rest = string.sub(body, pos)
            if string.match(rest, '^%s*$') then break end
            local nextPos = string.match(rest, '^%s*,%s*()')
            if not nextPos then return nil end
            pos = pos + nextPos - 1
        end
        if count ~= 11 or c.command ~= command or not string.match(c.operationId or "", '^gs%-%d+$') or #c.operationId > 13 then return nil end
        for _, key in ipairs({ "requestId", "expectedServerEpoch", "expectedSelectedPhotoUuid" }) do
            if not c[key] or not string.match(c[key], '^[%w:_%-]+$') then return nil end
        end
        for _, key in ipairs({ "expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter" }) do
            if not c[key] or c[key] < 0 or c[key] > 9007199254740991 or c[key] ~= math.floor(c[key]) then return nil end
        end
        if c.slider ~= "Contrast" and c.slider ~= "Clarity" and c.slider ~= "Vibrance" then return nil end
        if not c.value or c.value < -100 or c.value > 100 or
            not c.expectedValue or c.expectedValue < -100 or c.expectedValue > 100 then return nil end
        return c
    end
    if command == "point_color.sample.select" then
        if #json > 2048 then return nil end
        json = string.match(json, '^%s*{%s*"command"%s*:%s*({[^{}]*})%s*}%s*$') or json
        local fields = { command = true, selectedIndex = true, expectedSelectedPhotoUuid = true,
            expectedServerEpoch = true, expectedContextCounter = true, expectedDevelopCounter = true, expectedContextChangedAt = true }
        local seen, count, c = {}, 0, { command = command }
        for key in string.gmatch(json, '"([%w_]+)"%s*:') do
            if not fields[key] or seen[key] then return nil end
            seen[key], count = true, count + 1
        end
        if count ~= 7 then return nil end
        for _, key in ipairs({ "expectedSelectedPhotoUuid", "expectedServerEpoch" }) do
            c[key] = parseStringField(json, key)
            if not c[key] or #c[key] > 200 or not string.match(c[key], "^[%w:_%-]+$") then return nil end
        end
        for _, key in ipairs({ "selectedIndex", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }) do
            c[key] = parseIntegerField(json, key)
            if not c[key] or c[key] < 0 or c[key] > 9007199254740991 then return nil end
        end
        if c.selectedIndex < 1 or c.selectedIndex > 8 then return nil end
        return c
    end
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
    local parameter = parseStringField(json, "parameter")
    local correctionSequence = parseIntegerField(json, "correctionSequence")
    local editSequence = parseIntegerField(json, "editSequence")
    local preset = string.match(json, [["preset":"([^"]+)"]])
    local presetKind = parseStringField(json, "presetKind")
    local presetFile = parseStringField(json, "presetFile")
    local maskType = parseStringField(json, "maskType")
    local maskSubtype = parseStringField(json, "maskSubtype")
    local presetParameter = parseStringField(json, "presetParameter")
    local presetValue = parseNumberField(json, "presetValue")
    local requestId = parseStringField(json, "requestId")
    local operationId = parseStringField(json, "operationId")
    local operationKind = parseStringField(json, "operationKind")
    local uuid = parseStringField(json, "uuid")
    local presetAmount = parseIntegerField(json, "presetAmount")
    local expectedPresetUuid = parseStringField(json, "expectedPresetUuid")
    local expectedActiveModule = parseStringField(json, "expectedActiveModule")
    local expectedSelectedPhotoUuid = string.match(json, [["expectedSelectedPhotoUuid":"([^"]+)"]])
    local expectedSelectedIndex = string.match(json, [["expectedSelectedIndex":([%-]?%d+)]])
    local selectedIndex = parseIntegerField(json, "selectedIndex")
    local expectedContextCounter = string.match(json, [["expectedContextCounter":([%-]?%d+)]])
    local expectedDevelopCounter = string.match(json, [["expectedDevelopCounter":([%-]?%d+)]])
    local expectedContextChangedAt = string.match(json, [["expectedContextChangedAt":([%-]?%d+)]])
    local expectedServerEpoch = parseStringField(json, "expectedServerEpoch")
    local expectedMaskingRevision = parseIntegerField(json, "expectedMaskingRevision")
    local expectedRemoveRevision = parseIntegerField(json, "expectedRemoveRevision")
    local expectedReflectionsRevision = parseIntegerField(json, "expectedReflectionsRevision")
    local expectedPeopleRevision = parseIntegerField(json, "expectedPeopleRevision")
    local expectedRedEyeRevision = parseIntegerField(json, "expectedRedEyeRevision")
    local expectedSelectionToken = parseStringField(json, "expectedSelectionToken")
    local expectedSelectedTool = parseStringField(json, "expectedSelectedTool")
    local expectedToolOpen = parseBooleanField(json, "expectedToolOpen")
    local expectedPeopleCount = parseIntegerField(json, "expectedPeopleCount")
    local expectedPeopleInventoryToken = parseStringField(json, "expectedPeopleInventoryToken")
    local expectedRemoveMode = parseStringField(json, "expectedRemoveMode")
    local expectedMaskCount = parseIntegerField(json, "expectedMaskCount")
    local expectedMaskToolCount = parseIntegerField(json, "expectedMaskToolCount")
    local expectedSelectedMaskId = parseStringField(json, "expectedSelectedMaskId")
    local expectedSelectedMaskToolId = parseStringField(json, "expectedSelectedMaskToolId")
    local expectedHidden = parseBooleanField(json, "expectedHidden")
    local expectedInverted = parseBooleanField(json, "expectedInverted")
    local expectedFeedbackId = parseIntegerField(json, "expectedFeedbackId")
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
    local open = parseBooleanField(json, "open")
    local hidden = parseBooleanField(json, "hidden")
    local updateAISettings = parseBooleanField(json, "updateAISettings")
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
    if expectedContextChangedAt then expectedContextChangedAt = tonumber(expectedContextChangedAt) end
    if expectedValue then expectedValue = tonumber(expectedValue) end
    if command == "remove.selection.action" or command == "reflections.set" or command == "remove.dust.off" or command == "remove.dust.on" or command == "remove.dust.close" or command == "remove.brush.set" or command == "remove.panel.set" or command == "remove.repair.action" or command == "remove.repair.fill.set" or command == "remove.repair.param.set" then
        -- Remove preferences include strict booleans and enums as well as numbers.
        local function preferenceValue(name)
            local boolean = parseBooleanField(json, name)
            if boolean ~= nil then return boolean end
            return parseNumberField(json, name) or parseStringField(json, name)
        end
        value = preferenceValue("value")
        expectedValue = preferenceValue("expectedValue")
    end
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

    local preserveMaskingPanel = parseBooleanField(json, "preserveMaskingPanel")
    if string.find(json, '"preserveMaskingPanel"%s*:') and
        (preserveMaskingPanel ~= true or (command ~= "develop.set" and command ~= "develop.reset") or
            (slider ~= "GrainSize" and slider ~= "GrainFrequency")) then return nil end

    return {
        command = command,
        preserveMaskingPanel = preserveMaskingPanel,
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
        ,open = open
        ,hidden = hidden
        ,field = field
        ,range = range
        ,boundary = boundary
        ,profile = profile
        ,LowerNone = lowerNone
        ,LowerFull = lowerFull
        ,UpperFull = upperFull
        ,UpperNone = upperNone
        ,expectedSelectedIndex = expectedSelectedIndex
        ,selectedIndex = selectedIndex
        ,expectedContextCounter = expectedContextCounter
        ,profileGeneration = profileGeneration
        ,commitId = commitId
        ,channel = channel
        ,gestureId = gestureId
        ,parameter = parameter
        ,correctionSequence = correctionSequence
        ,editSequence = editSequence
        ,preset = preset
        ,presetKind = presetKind
        ,presetFile = presetFile
        ,maskType = maskType
        ,maskSubtype = maskSubtype
        ,presetParameter = presetParameter
        ,presetValue = presetValue
        ,requestId = requestId
        ,operationId = operationId
        ,operationKind = operationKind
        ,uuid = uuid
        ,presetAmount = presetAmount
        ,expectedPresetUuid = expectedPresetUuid
        ,updateAISettings = updateAISettings
        ,expectedActiveModule = expectedActiveModule
        ,expectedSelectedPhotoUuid = expectedSelectedPhotoUuid
        ,expectedDevelopCounter = expectedDevelopCounter
        ,expectedContextChangedAt = expectedContextChangedAt
        ,expectedServerEpoch = expectedServerEpoch
        ,expectedMaskingRevision = expectedMaskingRevision
        ,expectedRemoveRevision = expectedRemoveRevision
        ,expectedReflectionsRevision = expectedReflectionsRevision
        ,expectedPeopleRevision = expectedPeopleRevision
        ,expectedRedEyeRevision = expectedRedEyeRevision
        ,expectedSelectionToken = expectedSelectionToken
        ,expectedSelectedTool = expectedSelectedTool
        ,expectedToolOpen = expectedToolOpen
        ,expectedPeopleCount = expectedPeopleCount
        ,expectedPeopleInventoryToken = expectedPeopleInventoryToken
        ,expectedCheckboxState = parseBooleanField(json, "expectedCheckboxState")
        ,expectedAmount = parseNumberField(json, "expectedAmount")
        ,expectedQuality = parseStringField(json, "expectedQuality")
        ,expectedRemoveMode = expectedRemoveMode
        ,expectedMaskCount = expectedMaskCount
        ,expectedMaskToolCount = expectedMaskToolCount
        ,expectedSelectedMaskId = expectedSelectedMaskId
        ,expectedSelectedMaskToolId = expectedSelectedMaskToolId
        ,expectedHidden = expectedHidden
        ,expectedInverted = expectedInverted
        ,expectedFeedbackId = expectedFeedbackId
        ,expectedValue = expectedValue
        ,points = points
        ,expectedPoints = expectedPoints
    }

end

return Parser
