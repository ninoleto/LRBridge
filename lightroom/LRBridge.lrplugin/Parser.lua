local Parser = {}

function Parser.parse(json)

    local command = string.match(json, [["command":"([^"]+)"]])
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])
    local value = string.match(json, [["value":([%-]?%d+%.?%d*)]])

    if amount then
        amount = tonumber(amount)
    end

    if value then
        value = tonumber(value)
    end

    if command == nil then
        return nil
    end

    return {
        command = command,
        slider = slider,
        amount = amount,
        value = value
    }

end

return Parser