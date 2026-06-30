local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"
local LrDevelopController = import "LrDevelopController"

local logPath = "D:\\Projects\\LRBridge\\lrplugin-log.txt"

local function log(message)
    local file = io.open(logPath, "a")
    if file then
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " - " .. message .. "\n")
        file:close()
    end
end

local function adjustDevelop(commandJson)
    log("Trying Lightroom develop adjustment: " .. commandJson)

    -- first brute-force test: Exposure only
    local ok, err = pcall(function()
        LrDevelopController.increment("Exposure")
    end)

    if ok then
        log("Exposure increment OK")
    else
        log("Exposure increment FAILED: " .. tostring(err))
        LrDialogs.message("LRBridge error", tostring(err))
    end
end

LrDialogs.message("LRBridge", "Polling started.")
log("Polling started from menu")

LrTasks.startAsyncTask(function()
    while true do
        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, "developAdjust") then
            log("Command received: " .. result)
            adjustDevelop(result)
        end

        LrTasks.sleep(0.5)
    end
end)