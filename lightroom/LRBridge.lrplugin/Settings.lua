local Settings = {}

local settingsPath = "D:\\Projects\\LRBridge\\config\\settings.txt"

local defaultPollIntervalMs = 100
local minPollIntervalMs = 10
local maxPollIntervalMs = 1000

local function clamp(value, minValue, maxValue)

    if value < minValue then
        return minValue
    end

    if value > maxValue then
        return maxValue
    end

    return value

end

local function writeDefaultSettings()

    local file = io.open(settingsPath, "w")

    if file ~= nil then
        file:write("poll_interval_ms=" .. tostring(defaultPollIntervalMs) .. "\n")
        file:close()
    end

end

local function readFile()

    local file = io.open(settingsPath, "r")

    if file == nil then
        writeDefaultSettings()
        file = io.open(settingsPath, "r")
    end

    if file == nil then
        return nil
    end

    local content = file:read("*all")
    file:close()

    return content

end

function Settings.load()

    local content = readFile()
    local pollIntervalMs = defaultPollIntervalMs

    if content ~= nil then

        local value = string.match(content, "poll_interval_ms%s*=%s*(%d+)")

        if value ~= nil then
            pollIntervalMs = tonumber(value)
        end

    end

    pollIntervalMs = clamp(pollIntervalMs, minPollIntervalMs, maxPollIntervalMs)

    return {
        pollIntervalMs = pollIntervalMs,
        pollInterval = pollIntervalMs / 1000
    }

end

return Settings
