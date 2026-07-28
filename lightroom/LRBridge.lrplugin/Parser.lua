local Parser = {}

function Parser.parse(json)

    local command = string.match(json, [["command":"([^"]+)"]])
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local action = string.match(json, [["action":"([^"]+)"]])
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
    local hue = string.match(json, [["hue":([%-]?%d+%.?%d*)]])
    local saturation = string.match(json, [["saturation":([%-]?%d+%.?%d*)]])
    local rating = string.match(json, [["rating":([%-]?%d+)]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])
    local w = string.match(json, [["w":([%-]?%d+)]])
    local h = string.match(json, [["h":([%-]?%d+)]])
    local value = string.match(json, [["value":"([^"]+)"]])

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

    if command == nil then
        return nil
    end

    return {
        command = command,
        slider = slider,
        action = action,
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
    }

end

return Parser
