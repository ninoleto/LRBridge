local Parser = {}

function Parser.parse(json)

    local slider = string.match(json, [["slider":"([^"]+)"]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])

    if amount then
        amount = tonumber(amount)
    end

    if slider == nil or amount == nil then
        return nil
    end

    return {
        slider = slider,
        amount = amount
    }

end

return Parser