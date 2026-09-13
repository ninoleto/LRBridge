-- Bounded diagnostics for mask curve acceptance. Never supplies authoritative state.
local LrDate = import "LrDate"
local Trace = {}
local bytesWritten = 0
local MAX_BYTES = 4 * 1024 * 1024

local function encode(value, depth)
    local kind = type(value)
    if kind == "nil" then return "null" end
    if kind == "boolean" then return tostring(value) end
    if kind == "number" and value == value and value ~= math.huge and value ~= -math.huge then
        return string.format("%.17g", value)
    end
    if kind ~= "table" then
        local text = tostring(value)
        return '"' .. string.gsub(text, '[%z\1-\31\\"]', function(character)
            return string.format("\\u%04x", string.byte(character))
        end) .. '"'
    end
    if depth > 8 then return '"depth_limit"' end
    local keys, array = {}, true
    for key in pairs(value) do
        keys[#keys + 1] = key
        if type(key) ~= "number" or key < 1 or key > #value or key ~= math.floor(key) then array = false end
    end
    if #keys ~= #value then array = false end
    local entries = {}
    if array then
        for index = 1, #value do entries[index] = encode(value[index], depth + 1) end
        return "[" .. table.concat(entries, ",") .. "]"
    end
    table.sort(keys, function(left, right) return tostring(left) < tostring(right) end)
    for _, key in ipairs(keys) do entries[#entries + 1] = encode(tostring(key), depth + 1) .. ":" .. encode(value[key], depth + 1) end
    return "{" .. table.concat(entries, ",") .. "}"
end

function Trace.start(command)
    if bytesWritten >= MAX_BYTES then return nil end
    return { command = command, startedAt = LrDate.currentTime(), events = {} }
end

function Trace.record(trace, event, data)
    if trace == nil or #trace.events >= 160 then return end
    -- Freeze values immediately: an SDK table can be mutated by a later write.
    local ok, encoded = pcall(encode, { event = event, at = LrDate.currentTime(), data = data }, 0)
    if ok then trace.events[#trace.events + 1] = encoded end
end

function Trace.finish(trace, executionOk, result)
    if trace == nil then return end
    pcall(function()
        local header = encode({ command = trace.command, startedAt = trace.startedAt,
            finishedAt = LrDate.currentTime(), executionOk = executionOk, result = result }, 0)
        local line = string.sub(header, 1, -2) .. ',"events":[' .. table.concat(trace.events, ",") .. "]}"
        if bytesWritten + #line > MAX_BYTES then bytesWritten = MAX_BYTES; return end
        bytesWritten = bytesWritten + #line
        local pluginPath = _PLUGIN.path or ""
        local root = string.gsub(pluginPath, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
        if root == pluginPath then return end
        local file = io.open(root .. "/lrplugin-log.txt", "a")
        if file then
            file:write(os.date("%Y-%m-%d %H:%M:%S") .. " MaskToneCurveTrace " .. line .. "\n")
            file:close()
        end
    end)
end

return Trace
