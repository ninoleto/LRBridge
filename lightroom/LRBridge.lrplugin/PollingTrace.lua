-- Developer-only polling diagnostics. Normal startup never reads capture files.
-- Where the host supports getenv, LRBRIDGE_DEVELOPER_DIAGNOSTICS=1 permits a
-- bounded local capture. No HTTP, SDK calls, input or retries.
local Trace = {}
local diagnosticsEnabled = false
-- Lightroom's restricted Lua omits getenv. Missing/failing opt-in stays off.
if type(os.getenv) == "function" then
    local ok, value = pcall(os.getenv, "LRBRIDGE_DEVELOPER_DIAGNOSTICS")
    diagnosticsEnabled = ok and value == "1"
end
if not diagnosticsEnabled then
    function Trace.new()
        return { mark = function() end, call = function(_, fn, ...) return fn(...) end }
    end
    return Trace
end
local unpackValues = unpack or table.unpack
local root = string.gsub(_PLUGIN.path or "", "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
local armPath = root .. "/local-checkpoints/sdk-move-trace.arm"
local checkedAt, capture, expires = nil, nil, nil
local sequence = 0
local function clean(value)
    return string.sub(string.gsub(tostring(value or ""), "[^%w_./:%-]", "_"), 1, 160)
end
local function emit(loop, phase, operation, detail)
    local now = os.time()
    if checkedAt ~= now then
        checkedAt = now
        local file = io.open(armPath, "r")
        local line = file and file:read("*l") or ""
        if file then file:close() end
        local deadline, id = string.match(line, "^(%d+) ([%w_-]+)$")
        deadline = tonumber(deadline)
        capture, expires = nil, nil
        if deadline and deadline >= now and deadline <= now + 600 and #id <= 64 then
            capture, expires = id, deadline
        end
    end
    if not capture or now > expires then return end
    local file = io.open(root .. "/local-checkpoints/" .. capture .. "-sdk.tsv", "a")
    if not file then return end
    sequence = sequence + 1
    -- Wall seconds correlate with server milliseconds; sequence orders events
    -- within a second. os.clock is supplementary CPU time, not elapsed time.
    file:write(table.concat({tostring(now), tostring(sequence), tostring(os.clock()),
        clean(loop), clean(phase), clean(operation), clean(detail)}, "\t") .. "\n")
    file:close()
end
function Trace.new(loop)
    local out = {}
    function out.mark(phase, operation, detail)
        -- Logging failure must never change polling or an operation's outcome.
        pcall(emit, loop, phase, operation, detail)
    end
    local function pack(...) return { n = select("#", ...), ... } end
    function out.call(operation, fn, ...)
        out.mark("enter", operation)
        -- No pcall around the actual operation: retain its yield/error behavior.
        local result = pack(fn(...))
        out.mark("return", operation)
        return unpackValues(result, 1, result.n)
    end
    return out
end
return Trace
