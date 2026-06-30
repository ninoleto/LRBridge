local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Parser = require "Parser"
local Commands = require "Commands"
local Settings = require "Settings"

local config = Settings.load()

LrDialogs.message(
    "LRBridge",
    "Polling started.\nInterval: " .. tostring(config.pollInterval) .. " seconds"
)

LrTasks.startAsyncTask(function()

    while true do

        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, [["command"]]) then

            local command = Parser.parse(result)
            Commands.execute(command)

        end

        LrTasks.sleep(config.pollInterval)

    end

end)