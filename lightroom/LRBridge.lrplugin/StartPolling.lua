local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Parser = require "Parser"
local Commands = require "Commands"
local Settings = require "Settings"

local function getPortableRoot()

    local pluginPath = _PLUGIN.path or ""
    local root = string.gsub(pluginPath, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")

    if root == pluginPath then
        root = pluginPath .. "\\..\\.."
    end

    return root

end


local logPath = getPortableRoot() .. "\\lrplugin-log.txt"

local function log(message)

    local file = io.open(logPath, "a")

    if file ~= nil then
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " StartPolling: " .. tostring(message) .. "\n")
        file:close()
    end

end

local function formatExecutionError(failure)

    local success, message = pcall(tostring, failure)

    if success ~= true then
        return "[unprintable error]"
    end

    message = string.gsub(message, "https?://%S+", "[redacted URL]")
    message = string.gsub(message, "%a:[/\\][^%c]+", "[redacted path]")
    message = string.gsub(message, "/[^%s]+", "[redacted path]")
    message = string.gsub(message, "%?[^%s]+", "?[redacted]")

    return message

end

local function executeCommand(command)

    _G.LRBridgeCommandBusy = true

    local success, failure = LrTasks.pcall(Commands.execute, command)

    _G.LRBridgeCommandBusy = false

    local clockSuccess, finishedAt = pcall(os.clock)

    if clockSuccess == true then
        _G.LRBridgeLastCommandFinishedAt = finishedAt
    end

    if success ~= true then
        pcall(function()
            log("command execution failed: " .. formatExecutionError(failure))
        end)
    end

end

if _G.LRBridgePollingStarted == true then

    LrDialogs.message(
        "LRBridge",
        "Polling is already running."
    )

    return

end

_G.LRBridgePollingStarted = true

local config = Settings.load()
local lastSettingsReload = os.time()

LrDialogs.message(
    "LRBridge",
    "Polling started.\nInterval: " .. tostring(config.pollInterval) .. " seconds"
)

LrTasks.startAsyncTask(function()

    while _G.LRBridgePollingStarted == true do

        local now = os.time()

        if now ~= lastSettingsReload then
            lastSettingsReload = now
            config = Settings.load()
        end

        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, [["command"]]) then

            local command = Parser.parse(result)
            if command ~= nil then
                executeCommand(command)
            end

        end

        LrTasks.sleep(config.pollInterval)

    end

end)
