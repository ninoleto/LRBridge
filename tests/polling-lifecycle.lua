-- Execute the production startup, supervisors and both runners with cooperative SDK tasks.
-- Virtual time and in-memory HTTP keep failure injection away from the user's catalog/server.
local pluginRoot = pluginRoot or "lightroom/LRBridge.lrplugin"
package.path = pluginRoot .. "/?.lua;" .. package.path
local originalDofile = dofile
local originalTime, originalClock = os.time, os.clock
local S
local function loadPlugin(file) return dofile(pluginRoot .. "/" .. file) end
local function setup()
    S = { now = 1000, tasks = {}, requests = {}, edits = {}, queue = {}, logs = {},
        online = true, observers = 0, peakObservers = 0, module = "library", interval = 0.1 }
    _PLUGIN = { path = pluginRoot, enabled = true }
    _G.LRBridgePollingLifecycle, _G.LRBridgePollingStarted, _G.LRBridgeFeedbackPollingStarted = nil, nil, nil
    _G.LRBridgeCommandBusy = false
    package.loaded.PollingLifecycle = nil
    package.loaded.PollingTrace = nil
    os.getenv = nil -- Lightroom does not expose this optional Lua library function.
    dofile = function(file)
        file = string.gsub(file, "\\", "/")
        if S.loadFault and string.find(file, S.loadFault, 1, true) then error("injected load failure") end
        return originalDofile(file)
    end
    os.time = function() return math.floor(S.now) end
    os.clock = function() return S.now end
    io.open = function()
        return { write = function(_, message)
            if S.logFault then error("injected logging failure") end
            table.insert(S.logs, message)
        end, close = function() end }
    end
    local tasks = { pcall = pcall }
    tasks.startAsyncTask = function(fn)
        if S.scheduleFault then error("injected scheduling failure") end
        table.insert(S.tasks, { co = coroutine.create(fn), at = S.now })
    end
    tasks.sleep = function(delay)
        if S.sleepFault == delay then S.sleepFault = nil; error("injected sleep failure") end
        coroutine.yield(delay)
    end
    local contexts = { callWithContext = function(_, fn)
        local cleanup = {}
        local ok, failure = pcall(fn, { addCleanupHandler = function(_, cb) table.insert(cleanup, cb) end })
        for i = #cleanup, 1, -1 do cleanup[i]() end
        if not ok then error(failure) end
    end }
    local function observe(context)
        S.observers = S.observers + 1
        S.peakObservers = math.max(S.observers, S.peakObservers)
        context:addCleanupHandler(function() S.observers = S.observers - 1 end)
        return true
    end
    local photo = { getRawMetadata = function(_, key) if key == "uuid" then return "photo-1" end end,
        getDevelopSettings = function() if S.readPhoto then S.readPhoto() end; return { ConvertToGrayscale = false } end }
    local http = { get = function(url)
        local endpoint = string.match(url, "17891([^?]+)")
        table.insert(S.requests, { endpoint = endpoint, time = S.now, url = url })
        if S.http then local handled, body = S.http(endpoint, url); if handled then return body end end
        if not S.online then return nil end
        if endpoint == "/next" then return table.remove(S.queue, 1) or '{"command":null}' end
        if endpoint == "/feedback/next" and S.feedbackResponse then
            local response = S.feedbackResponse; S.feedbackResponse = nil; return response
        end
        return '{}'
    end }
    import = function(name)
        return ({ LrTasks = tasks, LrHttp = http, LrFunctionContext = contexts,
            LrDate = { currentTime = function() return S.now end },
            LrApplicationView = { getCurrentModuleName = function() return S.module end },
            LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return photo end } end },
            LrDevelopController = { getValue = function() return 0 end,
                addAdjustmentChangeObserver = function(context) observe(context) end } })[name] or {}
    end
    package.loaded.Settings = { load = function()
        if S.settingsFault then error("injected settings failure") end
        return { pollInterval = S.interval }
    end }
    package.loaded.Parser = nil -- Use the actual command parser.
    package.loaded.Commands = { execute = function(command)
        table.insert(S.edits, command)
        if S.execute then S.execute(command) end
    end }
    for _, name in ipairs({ "Query", "ColorGrading", "Enhance", "PointColor", "History", "LensBlur",
        "DevelopCategorical", "Masking", "Remove", "Reflections", "People", "RedEye" }) do
        package.loaded[name] = { sendRequestedSnapshot = function()
            if S.snapshot then S.snapshot(name) end
        end }
    end
    package.loaded.Query.getDevelopValue = function() return nil end
    -- Exercise the actual observer ownership/cleanup methods; other SDK reads are outside this fixture.
    package.loaded.ToneCurve, package.loaded.DevelopPresets = nil, nil
    local curve, presets = require "ToneCurve", require "DevelopPresets"
    curve.readSnapshot = function() return nil end
    curve.consumeDirty = function() return false end
    presets.consumeAmountDirty = function() return false end
end

local function step()
    local chosen
    for _, task in ipairs(S.tasks) do
        if coroutine.status(task.co) ~= "dead" and (not chosen or task.at < chosen.at) then chosen = task end
    end
    assert(chosen, "no runnable task")
    S.now = math.max(S.now, chosen.at)
    local ok, delay = coroutine.resume(chosen.co)
    assert(ok, tostring(delay))
    chosen.at = S.now + (delay or 0)
end
local function untilTrue(predicate)
    for _ = 1, 2000 do if predicate() then return end; step() end
    error("scheduler did not reach expected state")
end
local function advance(seconds)
    local target = S.now + seconds
    untilTrue(function() return S.now >= target end)
end
local function count(endpoint)
    local result = 0
    for _, request in ipairs(S.requests) do if request.endpoint == endpoint then result = result + 1 end end
    return result
end
local function logged(text)
    for _, message in ipairs(S.logs) do if string.find(message, text, 1, true) then return true end end
    return false
end
local function start() loadPlugin("PluginInit.lua") end
local function started()
    start()
    untilTrue(function() return count("/next") > 0 and count("/feedback/next") > 0 end)
end
local function pluginEvent(kind)
    if kind == "LrDisablePlugin" then _PLUGIN.enabled = false end
    if kind == "LrEnablePlugin" then _PLUGIN.enabled = true end
    local script = loadPlugin("Info.lua")[kind]
    if script then return loadPlugin(script) end
end
local function shutdown()
    local done = false
    loadPlugin("PluginShutdown.lua").LrShutdownFunction(function() done = true end, function() end)
    return function() return done end
end
local commandA = '{"command":{"command":"photo.rotate","direction":"left"}}'
local commandB = '{"command":{"command":"photo.rotate","direction":"right"}}'
local tests = 0
local function test(name, fn)
    if testFilter and not string.find(name, testFilter, 1, true) then return end
    setup()
    local ok, failure = pcall(fn)
    assert(ok, name .. ": " .. tostring(failure))
    untilTrue(shutdown())
    assert(not _G.LRBridgePollingStarted and not _G.LRBridgeFeedbackPollingStarted, name .. ": flags must clear")
    tests = tests + 1
end

-- Captured defect: Lightroom's preferences listed the packaged plug-in as disabled,
-- but its independent log still received commands alongside the diagnostic worker.
-- Dispatch the actual Info.lua event; do not substitute an unload for Disable.
test("Plug-in Manager Disable stops both consumers and cleans observers", function()
    S.module = "develop"; started()
    local state = _G.LRBridgePollingLifecycle
    pluginEvent("LrDisablePlugin")
    local before = #S.requests
    S.queue = { commandA }
    -- A separate timer lets virtual time advance after both workers have exited.
    import("LrTasks").startAsyncTask(function() import("LrTasks").sleep(2) end)
    advance(1.5)
    assert(#S.requests == before and #S.edits == 0 and #S.queue == 1,
        "captured defect: a disabled plug-in must not keep dequeuing commands or feedback")
    assert(next(state.workers) == nil and S.observers == 0, "Disable must drain workers and observer contexts")
end)

test("forced initialization of a disabled plug-in stays idle", function()
    _PLUGIN.enabled = false
    start(); loadPlugin("StartPolling.lua")
    assert(#S.tasks == 0 and #S.requests == 0, "ForceInit must not start a disabled plug-in")
end)

test("Enable alone starts one pair after Disable, duplicate callbacks stay idempotent", function()
    started()
    local old = _G.LRBridgePollingLifecycle
    pluginEvent("LrDisablePlugin")
    pluginEvent("LrEnablePlugin"); pluginEvent("LrEnablePlugin"); start()
    S.queue = { commandA }
    untilTrue(function() return #S.edits == 1 end)
    assert(next(old.workers) == nil and _G.LRBridgePollingLifecycle ~= old)
    local live = 0
    for _, task in ipairs(S.tasks) do if coroutine.status(task.co) ~= "dead" then live = live + 1 end end
    assert(live == 2, "one command supervisor and one feedback supervisor after enabling")
    advance(0.4); assert(#S.edits == 1)
end)

test("quick Disable and Enable drain an uncertain SDK action before replacement", function()
    S.queue = { commandA, commandB }
    local entered, completed, old
    S.execute = function(command)
        if command.direction == "left" then
            entered = true; coroutine.yield(2.5); completed = true
        else assert(completed, "replacement must wait for the in-flight action to finish") end
    end
    start(); untilTrue(function() return entered end)
    old = _G.LRBridgePollingLifecycle
    pluginEvent("LrDisablePlugin"); pluginEvent("LrEnablePlugin"); pluginEvent("LrEnablePlugin")
    advance(1.2)
    assert(#S.edits == 1 and not completed and _G.LRBridgeCommandBusy,
        "Enable cannot overlap or retry an already dispatched SDK action")
    untilTrue(function() return #S.edits == 2 end)
    assert(completed and next(old.workers) == nil and not _G.LRBridgeCommandBusy)
end)

test("Disable cancels a pending Enable even during repeated draining generations", function()
    S.queue = { commandA, commandB }
    local entered
    S.execute = function() entered = true; coroutine.yield(2); S.execute = nil end
    start(); untilTrue(function() return entered end)
    pluginEvent("LrDisablePlugin"); pluginEvent("LrEnablePlugin")
    pluginEvent("LrDisablePlugin"); pluginEvent("LrEnablePlugin")
    pluginEvent("LrDisablePlugin")
    local lifecycle = require "PollingLifecycle"
    untilTrue(function() return lifecycle.isStopped(_G.LRBridgePollingLifecycle) end)
    assert(#S.edits == 1 and #S.queue == 1, "a cancelled Enable must not resume after draining")
    pluginEvent("LrEnablePlugin")
    untilTrue(function() return #S.edits == 2 end)
end)

for _, endpoint in ipairs({ "/next", "/feedback/next" }) do
    test("Disable discards a late HTTP response " .. endpoint, function()
        local disabled
        S.http = function(route)
            if route == endpoint and not disabled then
                disabled = true; pluginEvent("LrDisablePlugin")
                coroutine.yield(0.2)
                return true, endpoint == "/next" and commandA or '{"treatment":true,"id":1}'
            end
        end
        start(); untilTrue(function() return disabled end)
        untilTrue(function() return require("PollingLifecycle").isStopped(_G.LRBridgePollingLifecycle) end)
        assert(#S.edits == 0 and count("/treatment/result") == 0)
    end)
end

test("disabled SDK state also stops a worker without a delivered callback", function()
    started()
    _PLUGIN.enabled = false
    local before = #S.requests
    S.queue = { commandA }
    untilTrue(function() return require("PollingLifecycle").isStopped(_G.LRBridgePollingLifecycle) end)
    assert(#S.requests == before and #S.edits == 0)
    pluginEvent("LrEnablePlugin")
    untilTrue(function() return #S.edits == 1 end)
end)

test("Disable during failure backoff cannot restart until Enable", function()
    S.http = function() error("offline exception") end
    start(); untilTrue(function() return logged("feedback loop failed") end)
    pluginEvent("LrDisablePlugin")
    local before = #S.requests
    untilTrue(function() return require("PollingLifecycle").isStopped(_G.LRBridgePollingLifecycle) end)
    assert(#S.requests == before)
    S.http = nil; pluginEvent("LrEnablePlugin"); pluginEvent("LrEnablePlugin")
    untilTrue(function() return #S.requests > before end)
end)

test("reload uses a fresh Lua environment and old late responses stay stopped", function()
    S.module = "develop"
    local waiting
    S.http = function(route)
        if route == "/next" and not waiting then
            waiting = true; coroutine.yield(2.5); return true, commandA
        end
    end
    start(); untilTrue(function() return waiting and S.observers == 2 end)
    local old = _G.LRBridgePollingLifecycle
    pluginEvent("LrShutdownPlugin")
    local before = #S.requests
    -- A reload creates a new global/module environment. The old tasks retain
    -- their original environment; clearing fields in the same _G is insufficient.
    local env = setmetatable({ LRBridgePollingLifecycle = false, LRBridgePollingStarted = false,
        LRBridgeFeedbackPollingStarted = false, LRBridgeCommandBusy = false }, { __index = _G })
    env._G = env
    env._PLUGIN = { path = pluginRoot, enabled = true }
    env.dofile = function(file)
        return assert(loadfile(string.gsub(file, "\\", "/"), "t", env))()
    end
    local loaded = {}
    env.require = function(name)
        if name == "PollingLifecycle" or name == "PollingTrace" or name == "ToneCurve" or name == "DevelopPresets" then
            if not loaded[name] then loaded[name] = env.dofile(pluginRoot .. "/" .. name .. ".lua") end
            return loaded[name]
        end
        return require(name)
    end
    local originalHttp = import "LrHttp"
    env.import = function(name)
        if name ~= "LrHttp" then return import(name) end
        return { get = function(...)
            local index = #S.requests + 1
            local body, headers = originalHttp.get(...)
            S.requests[index].generation = "replacement"
            return body, headers
        end }
    end
    env.dofile(pluginRoot .. "/PluginInit.lua")
    env.dofile(pluginRoot .. "/PluginInit.lua")
    S.queue = { commandB }
    advance(3)
    assert(#S.edits == 1 and S.edits[1].direction == "right", "late old command cannot execute after reload")
    assert(next(old.workers) == nil and env.LRBridgePollingStarted and env.LRBridgeFeedbackPollingStarted)
    for index = before + 1, #S.requests do
        assert(S.requests[index].generation == "replacement", "old generation cannot issue requests after reload")
    end
    assert(S.observers == 2 and S.peakObservers == 2, "old adjustment observers must be removed before replacement setup")
    env.dofile(pluginRoot .. "/PluginShutdown.lua")
    untilTrue(function() return env.require("PollingLifecycle").isStopped(env.LRBridgePollingLifecycle) end)
    assert(S.observers == 0)
end)

test("automatic startup, menu and duplicate entry points", function()
    local info = loadPlugin("Info.lua")
    assert(info.LrLibraryMenuItems == nil and info.LrExportMenuItems == nil)
    assert(info.LrInitPlugin == "PluginInit.lua" and info.LrForceInitPlugin)
    assert(info.LrEnablePlugin == "PluginInit.lua" and info.LrDisablePlugin == "PluginShutdown.lua")
    assert(info.LrShutdownPlugin == "PluginShutdown.lua" and info.LrShutdownApp == "PluginShutdown.lua")
    assert(#info.LrHelpMenuItems == 1 and info.LrHelpMenuItems[1].file == "Help.lua")
    start(); start(); loadPlugin("StartPolling.lua")
    assert(#S.tasks == 2 and not _G.LRBridgePollingStarted and not _G.LRBridgeFeedbackPollingStarted)
    untilTrue(function() return count("/feedback/next") > 0 end)
    assert(S.requests[1].time == 1001)
    start(); assert(#S.tasks == 2)
end)

test("normal ordering, polling interval and heartbeat after server reconnect", function()
    S.online = false; started(); advance(0.5)
    assert(#S.edits == 0 and _G.LRBridgePollingStarted and _G.LRBridgeFeedbackPollingStarted)
    local before = count("/context/update")
    S.online = true; S.queue = { commandA, commandB }
    untilTrue(function() return #S.edits == 2 and count("/context/update") > before end)
    assert(S.edits[1].direction == "left" and S.edits[2].direction == "right")
    local last
    for _, r in ipairs(S.requests) do if r.endpoint == "/next" then
        if last then assert(math.abs(r.time - last - 0.1) < 0.000001) end
        last = r.time
    end end
    assert(not logged("loop failed"))
end)

test("settings interval reload and normal feedback order", function()
    started(); S.interval = 0.25; advance(1.4)
    local times = {}
    for _, r in ipairs(S.requests) do if r.endpoint == "/next" then table.insert(times, r.time) end end
    assert(math.abs(times[#times] - times[#times-1] - 0.25) < 0.000001)
    local expected = { "/feedback/next", "/context/update", "/enhance/next", "/point-color/next", "/history/next",
        "/lens-blur/next", "/develop-categorical/next", "/masking/next", "/remove/next", "/reflections/next", "/people/next", "/red-eye/next" }
    local index = 1
    for _, r in ipairs(S.requests) do if r.endpoint ~= "/next" and index <= #expected then
        assert(r.endpoint == expected[index], "feedback endpoint order changed")
        index = index + 1
    end end
    assert(index == #expected + 1)
end)

test("normal asynchronous treatment feedback completes once", function()
    S.feedbackResponse = '{"treatment":true,"id":1}'
    started(); untilTrue(function() return count("/treatment/result") == 1 end); advance(0.5)
    assert(count("/treatment/result") == 1 and _G.LRBridgeFeedbackPollingStarted)
end)

test("legacy generation cannot overlap new supervisors", function()
    _G.LRBridgePollingStarted = true
    start(); loadPlugin("StartPolling.lua")
    assert(#S.tasks == 0 and _G.LRBridgePollingLifecycle == nil)
    assert(logged("legacy polling detected"))
    _G.LRBridgePollingStarted = false -- Simulate a fresh Lightroom process, not a production stop.
    started()
end)

for _, endpoint in ipairs({ "/next", "/feedback/next" }) do
    test("HTTP throw and bounded recovery " .. endpoint, function()
        local attempts = 0
        S.http = function(path) if path == endpoint then attempts = attempts + 1; error("injected HTTP failure") end end
        start(); untilTrue(function() return attempts == 1 end)
        local flag = endpoint == "/next" and "LRBridgePollingStarted" or "LRBridgeFeedbackPollingStarted"
        assert(_G[flag] == false)
        local first = S.now
        start(); loadPlugin("StartPolling.lua"); assert(#S.tasks == 2)
        untilTrue(function() return attempts == 3 end)
        assert(S.now >= first + 2 and logged("retry in 1s"))
        S.http = nil
        untilTrue(function() return _G[flag] == true end)
    end)
end

test("settings failure cannot strand flag or block feedback", function()
    S.settingsFault = true; start()
    untilTrue(function() return count("/feedback/next") > 0 end)
    assert(_G.LRBridgePollingStarted == false and logged("commands loop failed"))
    S.settingsFault = false; untilTrue(function() return count("/next") > 0 end)
end)

for _, file in ipairs({ "AutoStartPolling.lua", "FeedbackPolling.lua" }) do
    test("module loading failure " .. file, function()
        S.loadFault = file; start()
        untilTrue(function() return logged("loop failed") end)
        advance(0.2)
        assert(count(file == "AutoStartPolling.lua" and "/feedback/next" or "/next") > 0)
        S.loadFault = nil
        untilTrue(function() return count("/next") > 0 and count("/feedback/next") > 0 end)
    end)
end

test("uncertain dispatched edit is never retried", function()
    S.queue = { commandA, commandB }
    S.execute = function() error("uncertain SDK result") end
    started(); untilTrue(function() return #S.edits == 2 end); advance(1.1)
    assert(#S.edits == 2 and not _G.LRBridgeCommandBusy and logged("command execution failed"))
end)

test("failure after dispatch restarts with the next command", function()
    S.queue = { commandA, commandB }
    S.execute = function() S.sleepFault = S.interval; S.execute = nil end
    started(); untilTrue(function() return #S.edits == 2 end); advance(1.1)
    assert(#S.edits == 2 and S.edits[1].direction == "left" and S.edits[2].direction == "right")
    assert(logged("commands loop failed"))
end)

test("feedback failure cleans observers before reinstall", function()
    S.module = "develop"; started()
    assert(S.observers == 2)
    S.http = function(path) if path == "/red-eye/next" then return true, '{"request":{}}' end end
    S.snapshot = function() S.snapshot = nil; S.http = nil; error("injected snapshot failure") end
    untilTrue(function() return not _G.LRBridgeFeedbackPollingStarted end)
    assert(S.observers == 0 and logged("feedback loop failed"))
    untilTrue(function() return S.observers == 2 end)
    assert(S.peakObservers == 2)
end)

test("shutdown during startup prevents polling", function()
    start(); untilTrue(shutdown()); assert(#S.requests == 0)
end)

test("direct plug-in unload script signals stop without an app callback", function()
    started()
    local state = _G.LRBridgePollingLifecycle
    local contract = loadPlugin("PluginShutdown.lua")
    assert(type(contract.LrShutdownFunction) == "function" and state.stopping)
    untilTrue(function() return next(state.workers) == nil end)
    assert(not _G.LRBridgePollingStarted and not _G.LRBridgeFeedbackPollingStarted)
    started()
end)

test("late old generation cannot clear replacement flags or dispatch an edit", function()
    local reloaded = false
    S.http = function(path) if path == "/next" and not reloaded then
        reloaded = true
        loadPlugin("PluginShutdown.lua") -- The unload hook runs directly, not its returned callback.
        _G.LRBridgePollingLifecycle, _G.LRBridgePollingStarted, _G.LRBridgeFeedbackPollingStarted = nil, nil, nil
        start() -- Model the new plug-in environment while the old HTTP call is returning.
        coroutine.yield(2)
        return true, commandA
    end end
    start(); untilTrue(function() return reloaded end); advance(2.2)
    assert(#S.edits == 0 and _G.LRBridgePollingStarted and _G.LRBridgeFeedbackPollingStarted)
end)

test("app shutdown reports progress while draining and honors wait cancellation", function()
    S.queue = { commandA }
    S.execute = function() coroutine.yield(12) end
    started()
    local contract = loadPlugin("PluginShutdown.lua")
    local progress, done = 0, false
    contract.LrShutdownFunction(function() done = true end, function(percent, message)
        assert(type(message) == "string")
        if percent == 0 then progress = progress + 1 end
    end)
    advance(10.5)
    assert(not done and progress > 90, "long native calls need continuing shutdown progress")
    untilTrue(function() return done end)
    started()
    S.queue = { commandB }
    untilTrue(function() return #S.edits == 2 end)
    done = false
    loadPlugin("PluginShutdown.lua").LrShutdownFunction(function() done = true end, function() return true end)
    untilTrue(function() return done end)
    assert(_G.LRBridgePollingLifecycle.stopping, "cancelling the wait must not restart polling or replay the edit")
end)

test("shutdown during backoff prevents restart", function()
    S.http = function() error("offline exception") end
    start(); untilTrue(function() return logged("feedback loop failed") end)
    local before = #S.requests
    untilTrue(shutdown()); assert(#S.requests == before)
end)

test("late dequeued command is discarded on shutdown", function()
    local done
    S.http = function(path) if path == "/next" then
        done = shutdown(); coroutine.yield(0.2); return true, commandA
    end end
    start(); untilTrue(function() return done ~= nil end)
    local before = #S.requests
    start(); start()
    assert(#S.tasks == 5 and #S.requests == before,
        "one reserved successor pair may wait for draining, without polling or dispatch")
    untilTrue(done); assert(#S.edits == 0)
end)

test("shutdown drains a dispatched SDK action once, then reload starts fresh", function()
    S.queue = { commandA, commandB }
    local done
    S.execute = function() done = shutdown(); coroutine.yield(0.3); S.execute = nil end
    start(); untilTrue(function() return done ~= nil end)
    assert(not done() and _G.LRBridgeCommandBusy)
    untilTrue(done); assert(#S.edits == 1 and not _G.LRBridgeCommandBusy)
    local old = _G.LRBridgePollingLifecycle
    started(); untilTrue(function() return #S.edits == 2 end)
    assert(_G.LRBridgePollingLifecycle ~= old and S.edits[2].direction == "right")
end)

test("shutdown suppresses a late feedback response", function()
    local done
    S.http = function(path) if path == "/feedback/next" then
        done = shutdown(); coroutine.yield(0.2); return true, '{"treatment":true,"id":1}'
    end end
    start(); untilTrue(function() return done ~= nil end); untilTrue(done)
    assert(count("/treatment/result") == 0 and #S.tasks == 3)
end)

test("shutdown drains treatment child without publishing stale feedback", function()
    S.feedbackResponse = '{"treatment":true,"id":1}'
    local done
    S.readPhoto = function() done = shutdown(); coroutine.yield(0.3) end
    start(); untilTrue(function() return done ~= nil end)
    assert(not done())
    untilTrue(done); assert(count("/treatment/result") == 0)
end)

test("feedback retry drains old treatment child before restarting", function()
    S.feedbackResponse = '{"treatment":true,"id":1}'
    local reading = false
    S.readPhoto = function() reading = true; coroutine.yield(1.5); S.readPhoto = nil end
    started(); untilTrue(function() return reading end)
    S.http = function(path) if path == "/feedback/next" then S.http = nil; error("loop failure with child") end end
    untilTrue(function() return not _G.LRBridgeFeedbackPollingStarted end)
    advance(0.5); assert(not _G.LRBridgeFeedbackPollingStarted and count("/treatment/result") == 0)
    untilTrue(function() return _G.LRBridgeFeedbackPollingStarted end)
    assert(count("/treatment/result") == 0)
end)

test("logging failure cannot defeat recovery", function()
    S.logFault = true; start(); advance(1.1)
    assert(not _G.LRBridgePollingStarted and not _G.LRBridgeFeedbackPollingStarted)
    S.logFault = false; untilTrue(function() return count("/next") > 0 and count("/feedback/next") > 0 end)
end)

test("scheduling failure releases duplicate ownership and flags", function()
    S.scheduleFault = true; start()
    assert(not _G.LRBridgePollingStarted and not _G.LRBridgeFeedbackPollingStarted)
    assert(next(_G.LRBridgePollingLifecycle.workers) == nil)
    S.scheduleFault = false; started()
end)

os.time, os.clock = originalTime, originalClock
return tests
