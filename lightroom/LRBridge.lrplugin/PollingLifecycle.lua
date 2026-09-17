local LrTasks = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"

local Lifecycle = {}
local retryDelay = 1 -- Fixed, bounded backoff; normal polling intervals stay in the runners.

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
    local state = _G.LRBridgePollingLifecycle
    if not state and (_G.LRBridgePollingStarted or _G.LRBridgeFeedbackPollingStarted) then
        log("legacy polling detected; restart Lightroom once before supervised startup")
        return nil
    end
    if state and state.stopping and next(state.workers) ~= nil then
        log("startup ignored while polling is stopping")
        return nil
    end
    if not state or state.stopping then
        state = { workers = {}, stopping = false }
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
        return not state.stopping and _G.LRBridgePollingLifecycle == state
            and state.workers[name] == owner
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
                    log(name .. " loop started")
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
                log(name .. " supervisor stopped")
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
    log("shutdown requested")
    return state
end

function Lifecycle.isStopped(state)
    return not state or next(state.workers) == nil
end

return Lifecycle
