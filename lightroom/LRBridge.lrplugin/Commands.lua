local Driver = require "Driver"

local Commands = {}

function Commands.execute(command)

    if command == nil then
        return
    end

    Driver.adjustSlider(command.slider, command.amount)

end

return Commands