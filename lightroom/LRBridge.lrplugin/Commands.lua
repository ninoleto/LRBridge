local Driver = require "Driver"
local Query = require "Query"
local Selection = require "Selection"
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

    if command.command == "develop.set" then

        Driver.setSlider(
            command.slider,
            command.value
        )

        return
    end

    if command.command == "develop.reset" then

        Driver.resetSlider(
            command.slider
        )

        return
    end

    if command.command == "develop.action" then

        Driver.runAction(
            command.action
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

    if command.command == "selection.navigate" then
        Selection.navigate(command.direction)
        return
    end

    if command.command == "selection.flag" then
        Selection.setFlag(command.flag)
        return
    end

    if command.command == "selection.rating.set" then
        Selection.setRating(command.rating)
        return
    end

    if command.command == "selection.rating.adjust" then
        Selection.adjustRating(command.direction)
        return
    end

    if command.command == "selection.label.set" then
        Selection.setLabel(command.label)
        return
    end

    if command.command == "selection.label.toggle" then
        Selection.toggleLabel(command.label)
        return
    end

end

return Commands
