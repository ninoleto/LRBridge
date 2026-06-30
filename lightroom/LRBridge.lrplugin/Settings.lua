local Settings = {}

local settingsPath = "D:\\Projects\\LRBridge\\config\\settings.txt"

local function clamp(value, minValue, maxValue)

    if value < minValue then
        return minValue
    end

    if value > maxValue then
        return maxValue
    end

    return value

end

function Settings.getPollInterval()

    local defaultMs = 50
    local file = io.open(settingsPath, "r")

    if file == nil then
        return defaultMs / 1000
    end

    local content = file:read("*all")
    file:close()

    local value = string.match(content, "poll_interval_ms%s*=%s*(%d+)")

    if value == nil then
        return defaultMs / 1000
    end

    local pollMs = tonumber(value)

    if pollMs == nil then
        return defaultMs / 1000
    end

    pollMs = clamp(pollMs, 10, 1000)

    return pollMs / 1000

end

return Settings