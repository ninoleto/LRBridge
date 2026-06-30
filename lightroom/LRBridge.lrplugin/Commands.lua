local Driver = require "Driver"
local Query = require "Query"
local LrHttp = import "LrHttp"

local Commands = {}

local function sendResult(commandName, slider, value)

    local url =
        "http://127.0.0.1:17891/result" ..
        "?command=" .. tostring(commandName) ..
        "&slider=" .. tostring(slider) ..
        "&value=" .. tostring(value)

    LrHttp.get(url)

end

function Commands.execute(command)

    if command == nil then
        return
    end

    if command.command == "develop.adjust" then

        Driver.adjustSlider(
            command.slider,
            command.amount
        )

        return
    end

    if command.command == "develop.get" then

        local value = Query.getDevelopValue(command.slider)

        sendResult(
            "develop.get.result",
            command.slider,
            value
        )

        return
    end

end

return Commands