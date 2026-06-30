local Driver = require "Driver"

local Commands = {}

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

    print("Unknown command: " .. tostring(command.command))

end

return Commands