local Parser = {}

function Parser.parse(json)

    local command = string.match(json, [["command":"([^"]+)"]])
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local action = string.match(json, [["action":"([^"]+)"]])
    local direction = string.match(json, [["direction":"([^"]+)"]])
    local flag = string.match(json, [["flag":"([^"]+)"]])
    local label = string.match(json, [["label":"([^"]+)"]])
    local rating = string.match(json, [["rating":([%-]?%d+)]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])
    local value = string.match(json, [["value":([%-]?%d+%.?%d*)]])

    if amount then
        amount = tonumber(amount)
    end

    if value then
        value = tonumber(value)
    end

    if rating then
        rating = tonumber(rating)
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
        amount = amount,
        value = value
    }

end

return Parser
