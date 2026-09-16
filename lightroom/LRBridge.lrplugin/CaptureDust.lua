local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local Diagnostics = require "DustDiagnostics"
local captureOptions = ...
local controlsCapture = type(captureOptions) == "table" and captureOptions.purpose == "controls"

local function trace(stage, detail)
    -- Logging cannot turn a read-only diagnostic into a failed SDK operation.
    pcall(function()
        local root = string.gsub(_PLUGIN.path, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
        local file = io.open(LrPathUtils.child(root, "lrplugin-log.txt"), "a")
        if file then
            pcall(function() file:write(os.date("%Y-%m-%d %H:%M:%S") .. " DustCapture: stage=" .. stage ..
                " " .. Diagnostics.sanitize(detail) .. "\n") end)
            file:close()
        end
    end)
end

if _G.LRBridgeDustPasteRunning then
    LrDialogs.message("Dust capture", "The one-shot SDK paste proof is running. Let its capture finish before starting another diagnostic.", "warning")
    return
end
if _G.LRBridgeDustCaptureStarted then
    LrDialogs.message("Dust capture", "A read-only Dust capture is already running.", "info")
    return
end
-- Bind the actual menu-entry photo before scheduling a task. Metadata reads belong
-- inside LrTasks; the retained photo object's UUID is read there, before navigation.
local entryOk, entry = pcall(function()
    return { module = LrApplicationView.getCurrentModuleName(), photo = LrApplication.activeCatalog():getTargetPhoto() }
end)
trace("menu_entry", entryOk and ("module=" .. tostring(entry.module) .. " photoPresent=" .. tostring(entry.photo ~= nil)) or entry)
_G.LRBridgeDustCaptureStarted = true
LrTasks.startAsyncTask(function()
    local output, path
    local failureKind, stage = "sdk_unavailable", "menu entry"
    local launch, taskContext
    local function fail(kind, message)
        failureKind = kind; error(message, 0)
    end
    local function context()
        local photo = LrApplication.activeCatalog():getTargetPhoto()
        return { module = LrApplicationView.getCurrentModuleName(), photo = photo,
            uuid = photo and photo:getRawMetadata("uuid") or nil }
    end
    local function describe(c)
        return "module=" .. tostring(c.module) .. " photoUuid=" .. tostring(c.uuid)
    end
    local ok, failure = LrTasks.pcall(function()
        if not entryOk then error(entry, 0) end
        stage = "photo identity"
        local photo = entry.photo
        if not photo then fail("missing_photo", "No photo was selected when the capture menu command started.") end
        local uuid = photo:getRawMetadata("uuid")
        if type(uuid) ~= "string" or uuid == "" then fail("missing_identity", "The selected photo's UUID is unavailable.") end
        launch = { module = entry.module, uuid = uuid }
        trace("menu_photo", describe(launch))
        taskContext = context()
        trace("task_start", describe(taskContext))
        local function samePhoto(current)
            if not current.photo or current.photo ~= photo or current.uuid ~= uuid then trace("context_rejected", describe(current)) end
            if not current.photo then fail("missing_photo", "The selected test photo is no longer available.") end
            if current.photo ~= photo or current.uuid ~= uuid then
                fail("photo_changed", "Selected photo changed after menu entry; no different photo was selected by this diagnostic.")
            end
        end
        samePhoto(taskContext)
        if taskContext.module ~= "develop" then
            stage = "switchToModule(develop)"
            failureKind = "wrong_module"
            trace("navigation_request", describe(taskContext) .. " requested=develop")
            LrApplicationView.switchToModule("develop")
        end
        local baseline, lastUnavailable, readyReads = nil, nil, 0
        stage = "wait for Develop settings"
        failureKind = "sdk_unavailable"
        for attempt = 1, 100 do
            local current = context()
            samePhoto(current)
            if current.module == "develop" then
                local snapshot = Diagnostics.capture(photo, uuid)
                if snapshot.available then
                    readyReads = readyReads + 1
                    if readyReads >= 2 then baseline = snapshot; break end
                else
                    readyReads = 0; lastUnavailable = snapshot
                    if snapshot.failureKind == "photo_changed" or snapshot.failureKind == "missing_photo" then
                        fail(snapshot.failureKind, snapshot.reason)
                    end
                end
            else readyReads = 0 end
            if attempt < 100 then LrTasks.sleep(0.1) end
        end
        local current = context()
        samePhoto(current)
        if current.module ~= "develop" then fail("wrong_module", "Develop did not become active; current module is " .. tostring(current.module) .. ".") end
        if not baseline then fail("sdk_unavailable", "Develop settings did not become readable within 10 seconds. " ..
            (lastUnavailable and lastUnavailable.reason or "No valid baseline was captured.")) end
        trace("context_ready", describe(current))
        stage = "create capture file"
        failureKind = "file_write_failed"
        path = LrFileUtils.chooseUniqueFileName(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"),
            (controlsCapture and "lrbridge-dust-controls-" or "lrbridge-dust-capture-") .. os.date("%Y%m%d-%H%M%S") .. ".jsonl"))
        output = assert(io.open(path, "w"))
        local function record(stage, sample, snapshot)
            assert(output:write(Diagnostics.json({ stage = stage, sample = sample, at = os.date("%Y-%m-%d %H:%M:%S"),
                snapshot = snapshot }) .. "\n")); assert(output:flush())
        end
        stage = "write baseline"
        record("launch", 0, { menu = launch, taskStart = { module = taskContext.module, uuid = taskContext.uuid } })
        record("baseline", 0, baseline)
        if controlsCapture then record("dust_presets", 0, { presetInventory = (require "DustPresetDiagnostics").capture() }) end
        trace("baseline_saved", "module=" .. baseline.activeModule .. " photoUuid=" .. baseline.selectedPhotoUuid)
        stage = "ready dialog"
        failureKind = "sdk_unavailable"
        if controlsCapture then
            LrDialogs.message("Dust controls capture ready", "With native Dust already applied on this same test photo: " ..
                "set Dust Size to 37, wait three seconds; turn Visualize Spots on and set its threshold to 64, wait three seconds; " ..
                "then uncheck Dust Apply once. If you saved LRBridge Dust On with only Dust selected before starting, " ..
                "now save LRBridge Dust Off with only Dust selected. Do not reapply, paste or make other photo edits. Keep this photo selected for three minutes. " ..
                "This reads control/settings changes; photographic quality is not being tested.\n\nCapture file:\n" .. path, "info")
        else
            LrDialogs.message("Dust capture ready", "On this same test photo, check native Distraction Removal > Dust > Apply once. " ..
                "Leave all other edits unchanged and keep this photo selected. This capture reads SDK settings only and stops after three minutes.\n\n" ..
                "Capture file:\n" .. path, "info")
        end
        local previous = Diagnostics.json(baseline)
        for sample = 1, 360 do
            stage = "sample read"; failureKind = "sdk_unavailable"
            LrTasks.sleep(0.5)
            local snapshot = Diagnostics.capture(photo, uuid)
            local encoded = Diagnostics.json(snapshot)
            stage = "write sample"; failureKind = "file_write_failed"
            if sample <= 3 or sample % 20 == 0 or encoded ~= previous then record("sample", sample, snapshot) end
            previous = encoded
            if not snapshot.available then
                stage = "sample read"
                fail(snapshot.failureKind, snapshot.reason)
            end
        end
        stage = "write completion"
        if controlsCapture then record("dust_presets", 361, { presetInventory = (require "DustPresetDiagnostics").capture() }) end
        record("finished", 361, { readOnly = true })
    end)
    if output then
        local closeOk, closed, closeError = pcall(function() return output:close() end)
        if ok and (not closeOk or not closed) then
            ok, failureKind, stage, failure = false, "file_write_failed", "close capture file", closeError or closed or "File close failed."
        end
    end
    _G.LRBridgeDustCaptureStarted = false
    if not ok then
        local detail = Diagnostics.sanitize(failure)
        trace("failed", "kind=" .. tostring(failureKind) .. " step=" .. stage .. " failure=" .. detail)
        local labels = { missing_photo = "No selected test photo.", missing_identity = "Selected-photo identity unavailable.",
            photo_changed = "Selected test photo changed.", wrong_module = "Could not enter or remain in Develop.",
            sdk_unavailable = "Lightroom SDK settings or context unavailable.", file_write_failed = "Capture file could not be written." }
        LrDialogs.message("Dust capture stopped", (labels[failureKind] or "Diagnostic failed.") .. "\n" .. stage .. ": " .. detail ..
            (launch and "\nMenu entry: " .. describe(launch) or "\nMenu entry: module=" .. tostring(entryOk and entry.module)) ..
            "\nNo photo edits were attempted." .. (path and "\nCapture file (may be incomplete):\n" .. path or ""), "warning")
    elseif controlsCapture then
        LrDialogs.message("Dust controls capture finished", "The read-only control capture is complete.\n\nCapture file:\n" .. path, "info")
    end
end)
