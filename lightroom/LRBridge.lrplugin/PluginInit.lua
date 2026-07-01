local LrTasks = import "LrTasks"

local logPath = "D:\\Projects\\LRBridge\\lrplugin-log.txt"

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

end)