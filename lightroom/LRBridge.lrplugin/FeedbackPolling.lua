local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Query = require "Query"

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
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " FeedbackPolling: " .. tostring(message) .. "\n")
        file:close()
    end

end

local function parseRequestId(json)

    if json == nil then
        return nil
    end

    local id = string.match(json, [["id"%s*:%s*(%d+)]])

    if id == nil then
        return nil
    end

    return tonumber(id)

end

local function parseSlider(json)

    if json == nil then
        return nil
    end

    return string.match(json, [["slider"%s*:%s*"([^"]+)"]])

end

if _G.LRBridgeFeedbackPollingStarted == true then

    log("feedback polling already running")
    return

end

_G.LRBridgeFeedbackPollingStarted = true

LrTasks.startAsyncTask(function()

    log("feedback polling loop started")

    while _G.LRBridgeFeedbackPollingStarted == true do

        local result = LrHttp.get("http://127.0.0.1:17891/feedback/next")

        local slider = parseSlider(result)

        if slider ~= nil then

            local id = parseRequestId(result)
            log("feedback request received: " .. tostring(slider))

            local waitStartedAt = os.clock()

            while _G.LRBridgeCommandBusy == true do

                LrTasks.sleep(0.05)

                if os.clock() - waitStartedAt > 3 then
                    log("feedback busy wait timeout, reading anyway: " .. tostring(slider))
                    break
                end

            end

            LrTasks.sleep(0.15)

            local value = Query.getDevelopValue(slider)

            local url =
                "http://127.0.0.1:17891/feedback/result" ..
                "?id=" .. tostring(id) ..
                "&slider=" .. tostring(slider) ..
                "&value=" .. tostring(value)

            LrHttp.get(url)

            log("feedback result sent: " .. tostring(slider) .. "=" .. tostring(value))

        end

        LrTasks.sleep(0.2)

    end

    log("feedback polling loop stopped")

end)
