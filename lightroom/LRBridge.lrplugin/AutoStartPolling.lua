local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Parser = require "Parser"
local Commands = require "Commands"
local Settings = require "Settings"

local logPath = "D:\\Projects\\LRBridge\\lrplugin-log.txt"

local function log(message)

    local file = io.open(logPath, "a")

    if file ~= nil then
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " AutoStartPolling: " .. tostring(message) .. "\n")
        file:close()
    end

end

if _G.LRBridgePollingStarted == true then

    log("polling already running")
    return

end

_G.LRBridgePollingStarted = true

local config = Settings.load()

log("silent polling started, interval " .. tostring(config.pollInterval))

LrTasks.startAsyncTask(function()

    log("polling loop started")

    while _G.LRBridgePollingStarted == true do

        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, [["command"]]) then

            local command = Parser.parse(result)

            if command ~= nil then
                log("command received: " .. tostring(command.command) .. " " .. tostring(command.slider))
                Commands.execute(command)
            end

        end

        LrTasks.sleep(config.pollInterval)

    end

    log("polling loop stopped")

end)