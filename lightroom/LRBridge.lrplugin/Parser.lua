local Parser = {}

function Parser.parse(json)

    local command = string.match(json, [["command":"([^"]+)"]])
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])

    if amount then
        amount = tonumber(amount)
    end

    if command == nil then
        return nil
    end

    return {
        command = command,
        slider = slider,
        amount = amount
    }

end

return Parser