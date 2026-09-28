local LrTasks = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"

local Lifecycle = {}
local retryDelay = 1 -- Fixed, bounded backoff; normal polling intervals stay in the runners.
local plugin = _PLUGIN

local function log(message, failure)
    -- Logging must never defeat cleanup or recovery. Do not serialize commands/photos.
    pcall(function()
        if failure ~= nil then
            local ok, detail = pcall(tostring, failure)
            detail = ok and detail or "[unprintable error]"
            detail = string.gsub(detail, "https?://%S+", "[redacted URL]")
            detail = string.gsub(detail, "%a:[/\\][^%c]+", "[redacted path]")
            detail = string.gsub(detail, "/[^%s]+", "[redacted path]")
            message = message .. ": " .. detail
        end
        local root = string.gsub(_PLUGIN.path, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
        local file = io.open(root .. "\\lrplugin-log.txt", "a")
        if file then
            file:write(os.date("%Y-%m-%d %H:%M:%S") .. " PollingLifecycle: " .. message .. "\n")
            file:close()
        end
    end)
end

function Lifecycle.begin()
    -- ForceInit and cached menu callbacks must not revive a disabled plug-in.
    if plugin.enabled == false then return nil end
    local state = _G.LRBridgePollingLifecycle
    if not state and (_G.LRBridgePollingStarted or _G.LRBridgeFeedbackPollingStarted) then
        log("legacy polling detected; restart Lightroom once before supervised startup")
        return nil
    end
    if not state or state.stopping then
        -- Enable can arrive before the stopped workers finish their current SDK/
        -- HTTP call. Reserve one successor now; it waits for the whole predecessor
        -- chain rather than dropping Enable or overlapping an uncertain action.
        state = { workers = {}, stopping = false, previous = state }
        state.label = tostring(state)
        _G.LRBridgePollingLifecycle = state
    end
    return state
end

function Lifecycle.start(state, name, flag, runner)
    if not state or state.stopping or state.workers[name] then return end
    local owner = {}
    state.workers[name] = owner -- Reserve before scheduling, including startup/backoff.
    _G[flag] = false
    local function current()
        if state.stopping or _G.LRBridgePollingLifecycle ~= state or state.workers[name] ~= owner then return false end
        -- The explicit Disable hook is primary. This also guards a forced load
        -- or a disabled worker resuming after a host yield. Once stopped, an old
        -- generation cannot become live again when the same plug-in is enabled.
        if plugin.enabled == false then state.stopping = true; return false end
        return true
    end
    local function release()
        if state.workers[name] == owner then
            state.workers[name] = nil
            if _G.LRBridgePollingLifecycle == state then _G[flag] = false end
        end
    end
    local scheduled, schedulingError = pcall(function()
        LrTasks.startAsyncTask(function()
            LrFunctionContext.callWithContext("LRBridge " .. name .. " supervisor", function(context)
                context:addCleanupHandler(release)
                LrTasks.sleep(1) -- Preserve the existing automatic startup delay.
                while current() and not Lifecycle.isStopped(state.previous) do LrTasks.sleep(0.1) end
                if current() then state.previous = nil end
                while current() do
                    local attemptActive = true
                    local children = 0
                    local function running() return attemptActive and current() end
                    local function startChildTask(task)
                        if not running() then return end
                        children = children + 1
                        local started, failure = pcall(function()
                            LrTasks.startAsyncTask(function()
                                local ok, err = LrTasks.pcall(task)
                                children = children - 1
                                if not ok and running() then log(name .. " child failed", err) end
                            end)
                        end)
                        if not started then
                            children = children - 1
                            error(failure)
                        end
                    end
                    _G[flag] = true
                    log(name .. " loop started; generation=" .. state.label)
                    -- Each attempt gets fresh locals. A dispatched edit is never saved/replayed.
                    local ok, failure = LrTasks.pcall(runner, running, startChildTask)
                    attemptActive = false
                    if _G.LRBridgePollingLifecycle == state then _G[flag] = false end
                    if current() then
                        log(name .. (ok and " loop exited unexpectedly" or " loop failed") .. "; retry in 1s", failure)
                    end
                    -- Drain read-only feedback children before another attempt or shutdown completes.
                    while children > 0 do LrTasks.sleep(0.1) end
                    if current() then LrTasks.sleep(retryDelay) end
                end
                log(name .. " supervisor stopped; generation=" .. state.label)
            end)
        end)
    end)
    if not scheduled then
        release()
        log(name .. " supervisor could not start", schedulingError)
    end
end

function Lifecycle.stop()
    local state = _G.LRBridgePollingLifecycle
    if state then state.stopping = true end
    log("shutdown requested" .. (state and ("; generation=" .. state.label) or ""))
    return state
end

function Lifecycle.isStopped(state)
    -- A cancelled successor may exit before its still-draining predecessor.
    while state do
        if next(state.workers) ~= nil then return false end
        state = state.previous
    end
    return true
end

return Lifecycle
