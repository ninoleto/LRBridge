local LrTasks = import "LrTasks"

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
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " PluginInit: " .. tostring(message) .. "\n")
        file:close()
    end

end

log("PluginInit.lua loaded")

LrTasks.startAsyncTask(function()

    log("auto-start polling task started")

    LrTasks.sleep(1)

    local ok, result = pcall(function()
        dofile(_PLUGIN.path .. "\\AutoStartPolling.lua")
    end)

    if ok ~= true then
        log("ERROR loading AutoStartPolling.lua: " .. tostring(result))
        return
    end

    log("AutoStartPolling.lua loaded")

    local feedbackOk, feedbackResult = pcall(function()
        dofile(_PLUGIN.path .. "\\FeedbackPolling.lua")
    end)

    if feedbackOk ~= true then
        log("ERROR loading FeedbackPolling.lua: " .. tostring(feedbackResult))
        return
    end

    log("FeedbackPolling.lua loaded")

end)