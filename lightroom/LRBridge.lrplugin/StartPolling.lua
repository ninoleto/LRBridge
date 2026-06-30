local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Driver = require "Driver"

local function parseCommand(json)
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])

    if amount then
        amount = tonumber(amount)
    end

    return slider, amount
end

local function executeCommand(json)

    local slider, amount = parseCommand(json)

    if slider == nil or amount == nil then
        return
    end

    Driver.adjustSlider(slider, amount)

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