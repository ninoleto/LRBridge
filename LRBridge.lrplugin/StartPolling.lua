local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"
local LrDevelopController = import "LrDevelopController"

local function parseCommand(json)
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])

    if amount then
        amount = tonumber(amount)
    end

    return slider, amount
end

local function adjustSlider(slider, amount)
    if slider ~= "Exposure" then
        return
    end

    if amount > 0 then
        for i = 1, amount do
            LrDevelopController.increment("Exposure")
        end
    elseif amount < 0 then
        for i = 1, -amount do
            LrDevelopController.decrement("Exposure")
        end
    end
end

local function executeCommand(json)
    local slider, amount = parseCommand(json)

    if slider == nil or amount == nil then
        return
    end

    adjustSlider(slider, amount)
end

LrDialogs.message("LRBridge", "Polling started.")

LrTasks.startAsyncTask(function()
    while true do
        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, "developAdjust") then
            executeCommand(result)
        end

        LrTasks.sleep(0.5)
    end
end)