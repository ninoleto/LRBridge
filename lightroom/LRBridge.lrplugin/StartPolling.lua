local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Parser = require "Parser"
local Commands = require "Commands"

LrDialogs.message("LRBridge", "Polling started.")

LrTasks.startAsyncTask(function()

    while true do

        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, "develop.adjust") then

            local command = Parser.parse(result)
            Commands.execute(command)

        end

        LrTasks.sleep(0.5)

    end

end)