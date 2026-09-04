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
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " AutoStartPolling: " .. tostring(message) .. "\n")
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

local function commandParameter(command)

    if command.command == "photo.treatment" then
        return command.value
    end

    if command.command == "photo.crop_aspect" then
        if command.mode == "custom" then
            return command.mode .. " " .. tostring(command.w) .. "x" .. tostring(command.h)
        end
        return command.mode
    end

    if command.command == "photo.reveal" then
        return command.scope
    end

    if command.command == "photo.crop_angle.set" then
        return command.value
    end

    if command.command == "photo.crop_angle.reset" then
        return nil
    end

    if command.command == "develop.action" and command.action == "selectCropTool" then
        return command.target or "crop"
    end

    if command.command == "color_grading.wheel.set" then return command.region .. " hue=" .. tostring(command.hue) .. " saturation=" .. tostring(command.saturation) end
    if command.command == "color_grading.value.set" or command.command == "color_grading.value.reset" then return command.control end
    if command.command == "color_grading.region.reset" then return command.region end
    if command.command == "color_grading.view.set" then return command.view end
    if command.command == "enhance.denoise.set" then return "enabled=" .. tostring(command.enabled) .. " amount=" .. tostring(command.amount) end
    if command.command == "enhance.denoise.amount.set" then return "amount=" .. tostring(command.amount) end
    if command.command == "develop_categorical.profile.set" then return command.profile end
    if command.command == "tone_curve.preset.set" then return "RGB preset=" .. tostring(command.preset) end
    if command.command == "develop_presets.inventory.request" then return "request=" .. tostring(command.requestId) end
    if command.command == "develop_preset.apply" then return "uuid=" .. tostring(command.uuid) .. " operation=" .. tostring(command.operationId) end
    if command.command == "develop_preset.amount.set" then return "PresetAmount=" .. tostring(command.presetAmount) end
    if string.sub(command.command or "", 1, string.len("tone_curve.refine_saturation.")) == "tone_curve.refine_saturation." then
        return "CurveRefineSaturation gesture=" .. tostring(command.gestureId or "reset")
    end
    if string.sub(command.command or "", 1, 11) == "tone_curve." then return tostring(command.channel) .. " gesture=" .. tostring(command.gestureId or "reset") end
    return command.slider

end

if _G.LRBridgePollingStarted == true then

    log("polling already running")
    return

end

_G.LRBridgePollingStarted = true

local config = Settings.load()
local lastSettingsReload = os.time()

log("silent polling started, interval " .. tostring(config.pollInterval))

LrTasks.startAsyncTask(function()

    log("polling loop started")

    while _G.LRBridgePollingStarted == true do

        local now = os.time()

        if now ~= lastSettingsReload then

            lastSettingsReload = now

            local newConfig = Settings.load()

            if newConfig.pollInterval ~= config.pollInterval then
                config = newConfig
                log("polling interval changed to " .. tostring(config.pollInterval))
            else
                config = newConfig
            end

        end

        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, [["command"]]) then

            local command = Parser.parse(result)

            if command ~= nil then
                local parameter = commandParameter(command)
                local diagnostic = "command received: " .. tostring(command.command)

                if parameter ~= nil then
                    diagnostic = diagnostic .. " " .. tostring(parameter)
                end

                log(diagnostic)

                executeCommand(command)
            end

        end

        LrTasks.sleep(config.pollInterval)

    end

    log("polling loop stopped")

end)
