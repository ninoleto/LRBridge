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

function Settings.load()

    local config = {
        pollInterval = 0.05
    }

    local file = io.open(settingsPath, "r")

    if file == nil then
        return config
    end

    local content = file:read("*all")
    file:close()

    local pollMs = string.match(content, "poll_interval_ms%s*=%s*(%d+)")

    if pollMs ~= nil then
        pollMs = tonumber(pollMs)

        if pollMs ~= nil then
            pollMs = clamp(pollMs, 10, 1000)
            config.pollInterval = pollMs / 1000
        end
    end

    return config

end

return Settings