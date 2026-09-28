local passed = 0
local function check(condition, message)
    if not condition then error(message, 2) end
end

local function request(id, slider, confirmation)
    return '{"ok":true,"request":{"id":' .. tostring(id) .. ',"slider":"' .. slider .. '"' ..
        (confirmation and ',"confirmation":true' or '') .. '}}'
end

local function run(options)
    options = options or {}
    local now, requests, results, reads, sleeps = options.now or 0, {}, {}, {}, {}
    local active = true
    local env = setmetatable({}, { __index = _G })
    env._G = env
    env._PLUGIN = { path = "/mock/lightroom/LRBridge.lrplugin" }
    env.io = { open = function() return nil end }
    local photo = { getRawMetadata = function(_, key) return key == "uuid" and "test-photo" or "test-photo.raw" end }
    local otherPhoto = { getRawMetadata = function(_, key) return key == "uuid" and "other-photo" or "other-photo.raw" end }
    local selected, module = photo, options.module or "develop"
    local function updateBusy()
        env.LRBridgeCommandBusy = options.stuck == true or
            (options.busyStart ~= nil and now >= options.busyStart and now < options.busyEnd)
        if options.stopAt and now >= options.stopAt then active = false end
    end
    updateBusy()
    local imports = {
        LrTasks = {
            pcall = pcall,
            sleep = function(seconds)
                table.insert(sleeps, seconds)
                now = now + seconds * 1000
                -- The captured 80ms yield resumed later under real host load.
                if #sleeps == 1 and options.firstWakeAt then now = math.max(now, options.firstWakeAt) end
                updateBusy()
            end,
        },
        LrHttp = { get = function(url)
            if string.find(url, "/feedback/next", 1, true) then
                table.insert(requests, now)
                return (options.requests or {})[#requests] or '{"ok":true,"request":null}'
            end
            if string.find(url, "/feedback/result?", 1, true) then
                table.insert(results, { at = now, url = url, slider = string.match(url, "&slider=([^&]+)"),
                    value = tonumber(string.match(url, "&value=([^&]+)")) })
                if #results == 1 and options.afterFirstPostAt then
                    now = options.afterFirstPostAt
                    updateBusy()
                end
                return '{"ok":true}'
            end
            error("Unexpected HTTP route in isolated read cycle: " .. url)
        end },
        LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return selected end } end },
        LrApplicationView = { getCurrentModuleName = function() return module end },
        LrDevelopController = {},
        LrFunctionContext = { callWithContext = function(_, fn) return fn({}) end },
        LrDate = {},
    }
    env.import = function(name) check(imports[name] ~= nil, "Missing mock import " .. name); return imports[name] end
    local modules = {
        PollingTrace = { new = function() return {
            call = function(_, fn, ...) return fn(...) end,
            mark = function(phase, operation)
                -- Stop at the boundary before unrelated background families. This
                -- exercises the real polling loop, not a copied dispatch helper.
                if phase == "enter" and operation == "sdk.observerSetup" then error("CYCLE_BOUNDARY") end
            end,
        } end },
        Query = {
            getDevelopValue = function(slider)
                local value = options.beforeValue or 7
                if options.busyEnd and now >= options.busyEnd then value = options.afterValue end
                table.insert(reads, { at = now, busy = env.LRBridgeCommandBusy, slider = slider, value = value })
                if options.changePhoto then selected = otherPhoto end
                if options.leaveDevelop then module = "library" end
                return value
            end,
            getDevelopRange = function() return -100, 100 end,
        },
    }
    env.require = function(name) return modules[name] or {} end
    local main = assert(load(pollingSource, "@FeedbackPolling.lua", "t", env))()
    local ok, err = pcall(main, function() return active end, function() error("Unexpected child task") end)
    check(not ok and (string.find(tostring(err), "CYCLE_BOUNDARY", 1, true) or
        (not active and string.find(tostring(err), "feedback polling stopped", 1, true))),
        "Unexpected polling outcome: " .. tostring(err))
    return { now = now, requests = requests, results = results, reads = reads, sleeps = sleeps }
end

if mode ~= "drain" then
    local f = captured.busyRead
    local replay = run { now = f.readDequeuedAt, busyStart = f.commandBeginAt, busyEnd = f.sdkResetEndAt,
        firstWakeAt = f.preResetReadAt, beforeValue = f.preResetValue, afterValue = f.resetValue,
        requests = { request(f.readId, f.slider, true) } }
    check(#replay.results == 1 and replay.results[1].value == f.resetValue,
        "Captured Reset race: feedback read the pre-Reset -74 while command preparation was busy; expected actual SDK result 0")
    check(replay.reads[1].busy ~= true and replay.reads[1].at >= f.sdkResetEndAt,
        "Confirmation cannot overtake the active Reset")
    check(replay.reads[1].at < f.sdkResetEndAt + 20.001,
        "After the command ends, use the next existing guard tick without another settling delay")
    check(f.preResetValue ~= f.cachedAuthority,
        "Fixture must retain the stale-cache difference that incorrectly retired Reset demand")
    passed = passed + 1

    local middle = captured.midSnapshotRead
    for _, slider in ipairs({ "__many__:SDRWhites,SDRShadows", "__all__" }) do
        local during = run { now = middle.commandBeginAt - 100, busyStart = middle.commandBeginAt,
            busyEnd = middle.sdkResetEndAt, beforeValue = middle.readValue, afterValue = middle.resetValue,
            afterFirstPostAt = middle.readAt, requests = { request(middle.readId, slider, true) } }
        local found = false
        for _, reading in ipairs(during.reads) do
            if reading.slider == middle.slider then
                found = true
                check(reading.busy ~= true and reading.value == middle.resetValue,
                    "Captured mid-snapshot race: posting an earlier value yielded into Reset; the next SDK read must recheck command activity")
                check(reading.at >= middle.sdkResetEndAt and reading.at < middle.sdkResetEndAt + 20.001,
                    "Batched feedback must not introduce an extra settling delay per value")
            end
        end
        check(found, "The production snapshot must contain SDR Shadows")
        passed = passed + 1
    end

    local stuck = run { stuck = true, requests = { request(1, "SDRWhites", true), request(2, "SDRBlend", true) } }
    check(#stuck.reads == 0 and #stuck.results == 0, "A busy timeout must not invent a value or unavailable result")
    check(stuck.now >= 2000 and stuck.now <= 2080.001 and #stuck.requests == 1,
        "A stuck command must leave the confirmation batch at the existing bounded wait limit")
    passed = passed + 1

    local stopped = run { stuck = true, stopAt = 40, requests = { request(1, "SDRWhites", true) } }
    check(#stopped.reads == 0 and #stopped.results == 0 and stopped.now <= 40,
        "Stopping during the wait must not read or publish state")
    passed = passed + 1

    for _, option in ipairs({ "changePhoto", "leaveDevelop" }) do
        local opts = { requests = { request(1, "SDRWhites", true) } }; opts[option] = true
        local changed = run(opts)
        check(#changed.results == 1 and changed.results[1].value == nil and
            string.find(changed.results[1].url, "&available=0", 1, true),
            "Preserve the SDK read's photo/module validation: " .. option)
        passed = passed + 1
    end
    local unavailable = run { module = "library", requests = { request(1, "SDRWhites", true) } }
    check(#unavailable.reads == 0 and #unavailable.results == 1 and unavailable.results[1].value == nil,
        "Unavailable controls must remain unavailable without SDK access")
    passed = passed + 1
end

if mode ~= "busy" then
    local f = captured.backlog
    check(f.waitingReadRequestedAt < f.firstReadDequeuedAt and f.waitingResetSDKEndAt < f.firstReadDequeuedAt,
        "The second captured read and its SDK Reset were already ready for this cycle")
    local replay = run { now = f.firstReadDequeuedAt,
        requests = { request(f.firstReadId, f.firstSlider, true), request(f.waitingReadId, f.waitingSlider, true) } }
    check(#replay.results == 2 and replay.results[2].slider == f.waitingSlider,
        "Captured Reset backlog: a ready confirmation must not wait through a full background polling cycle")
    passed = passed + 1

    local burst = {}
    for i = 1, 6 do burst[i] = request(i, "SDRContrast", true) end
    local bounded = run { requests = burst }
    check(#bounded.requests == 4 and #bounded.results == 4, "Drain at most four confirmations before other families")
    passed = passed + 1

    local ordinary = run { requests = { request(1, "SDRContrast", true), request(2, "SDRClarity", false),
        request(3, "SDRBlend", true) } }
    check(#ordinary.requests == 2 and #ordinary.results == 2 and ordinary.results[2].slider == "SDRClarity",
        "Honor the server's background fairness turn and yield to the other feedback families")
    passed = passed + 1

    local legacy = run { requests = { request(1, "SDRContrast", false), request(2, "SDRClarity", true) } }
    check(#legacy.requests == 1 and #legacy.results == 1, "Unmarked/legacy feedback keeps one request per cycle")
    passed = passed + 1

    local many = run { requests = { request(1, "__many__:SDRWhites,SDRBlend", true), request(2, "SDRContrast", true) } }
    check(#many.results == 3 and many.results[1].slider == "SDRWhites" and many.results[2].slider == "SDRBlend" and
        many.results[3].slider == "SDRContrast", "Preserve many-slider Reset snapshots and FIFO within a confirmation burst")
    passed = passed + 1

    local empty = run {}
    check(#empty.requests == 1 and #empty.results == 0 and #empty.sleeps == 0, "An empty queue cannot busy-poll")
    passed = passed + 1
end

return passed
