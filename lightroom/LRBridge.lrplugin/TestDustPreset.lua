-- One native On-preset application, followed by read-only native Reset/Close evidence.
local App = import "LrApplication"
local View = import "LrApplicationView"
local SDK = import "LrDevelopController"
local Dialogs = import "LrDialogs"
local Tasks = import "LrTasks"
local Paths = import "LrPathUtils"
local Files = import "LrFileUtils"
local Diagnostics = require "DustDiagnostics"
local Proof = require "DustPasteDiagnostics"
local Preset = require "DustOnPreset"

-- Share the existing diagnostic exclusion flag, but keep a separate attempt latch.
if _G.LRBridgeDustPasteRunning or _G.LRBridgeDustCaptureStarted or _G.LRBridgeCommandBusy then
    Dialogs.message("Dust preset test unavailable", "Another diagnostic or LRBridge command is running. No preset was applied.", "warning")
    return
end
if _G.LRBridgeDustPresetAttempted then
    Dialogs.message("Dust preset already attempted", "Inspect the existing capture. This session will not retry the preset.", "warning")
    return
end
local entryOk, entry = pcall(function()
    local catalog = App.activeCatalog()
    return { catalog = catalog, photo = catalog:getTargetPhoto(), module = View.getCurrentModuleName(),
        commandStamp = _G.LRBridgeLastCommandFinishedAt }
end)
_G.LRBridgeDustPasteRunning = true
Tasks.startAsyncTask(function()
    local output, path, baseline, onSnapshot, last, uuid
    local stage, attempted, cancelled = "menu entry", false, false
    local function record(name, sample, snapshot, detail)
        assert(output:write(Diagnostics.json({ stage = name, sample = sample, at = os.date("%Y-%m-%d %H:%M:%S"),
            snapshot = snapshot, detail = detail }) .. "\n")); assert(output:flush())
    end
    local function eligible(snapshot, photo)
        if not snapshot.available then error(snapshot.reason or "Destination settings unavailable.", 0) end
        if type(photo.applyDevelopPreset) ~= "function" then error("Preset application API unavailable.", 0) end
        if snapshot.pasteEvidence.dustCount ~= 0 then error("Destination already has Dust. Use an untreated disposable photo or virtual copy.", 0) end
        if snapshot.pasteEvidence.needsAIUpdate then error("Destination has pending AI updates.", 0) end
        if snapshot.selectedTool ~= "dust" then error("Open native Healing with Dust Apply off before starting this test.", 0) end
        if not snapshot.settings.ProcessVersion or snapshot.settings.ProcessVersion.data.value ~= "15.4" then
            error("Destination ProcessVersion must already be 15.4; the test must not change it.", 0)
        end
        if #SDK.getAllSpots("manualRemove") == 0 then
            error("Add one ordinary manual Healing repair to the disposable test photo first; it is needed to determine native Reset scope.", 0)
        end
    end
    local function preserved(comparison)
        return comparison.available and #comparison.unrelatedSettingsChanged == 0 and comparison.manualSpotsUnchanged and
            comparison.removePreferencesUnchanged and comparison.nonDustFiltersUnchanged and comparison.filterEnvelopeUnchanged
    end
    local ok, failure = Tasks.pcall(function()
        if not entryOk then error(entry, 0) end
        local photo, catalog = entry.photo, entry.catalog
        if not photo then error("No destination photo was selected at menu entry.", 0) end
        stage = "destination identity"
        uuid = photo:getRawMetadata("uuid")
        if type(uuid) ~= "string" or uuid == "" then error("Destination UUID unavailable.", 0) end
        if uuid == Preset.sourceUuid then error("Use a different disposable destination, not the preset's source photo.", 0) end
        if catalog ~= App.activeCatalog() or catalog:getTargetPhoto() ~= photo then error("Destination changed after menu entry.", 0) end
        if View.getCurrentModuleName() ~= "develop" then
            stage = "enter Develop"; View.switchToModule("develop")
        end
        stage = "capture stable destination baseline"
        local previous, reason
        for attempt = 1, 100 do
            if catalog ~= App.activeCatalog() or catalog:getTargetPhoto() ~= photo or photo:getRawMetadata("uuid") ~= uuid then
                error("Destination changed during startup.", 0)
            end
            if View.getCurrentModuleName() == "develop" then
                local snapshot = Proof.capture(photo, uuid, catalog, entry.commandStamp)
                if snapshot.available then
                    eligible(snapshot, photo)
                    if previous and previous.pasteEvidence.beforeToken == snapshot.pasteEvidence.beforeToken then baseline = snapshot; break end
                    previous = snapshot
                else previous = nil; reason = snapshot.reason end
            end
            if attempt < 100 then Tasks.sleep(0.1) end
        end
        if not baseline then error("Stable destination baseline unavailable. " .. (reason or "Develop did not become ready."), 0) end
        stage = "inspect saved Dust On preset"
        local preset = Preset.resolve()
        local presetUuid = preset:getUuid()
        if type(presetUuid) ~= "string" or presetUuid == "" then error("Dust On preset identity unavailable.", 0) end
        stage = "create capture file"
        path = Files.chooseUniqueFileName(Paths.child(Paths.getStandardFilePath("temp"),
            "lrbridge-dust-preset-" .. os.date("%Y%m%d-%H%M%S") .. ".jsonl"))
        output = assert(io.open(path, "w"))
        record("launch", 0, nil, { mode = "sdk-preset-and-native-buttons", menuModule = entry.module,
            destinationUuid = uuid, presetName = preset:getName(), presetUuid = presetUuid, presetDigest = Preset.digest, sourceUuid = Preset.sourceUuid })
        record("baseline", 0, baseline)
        stage = "confirm disposable destination"
        if Dialogs.confirm("Dust preset test: disposable destination?",
            "This applies the inspected LRBridge Dust On preset ONCE, with SDK AI updating. No clipboard is used. " ..
            "Its native behavior is still being tested. Use a disposable different photo or virtual copy with Dust off, " ..
            "one existing ordinary manual Healing repair, and your other edits already in place.\n\n" ..
            "Keep this photo selected. Do not edit until the next instruction. " ..
            "After Apply readback is recorded, you will be asked to press native Reset and Close. " ..
            "Reset's scope is unknown; this is why the destination must be disposable.\n\nCapture file:\n" .. path,
            "Apply preset once", "Cancel test") ~= "ok" then
            cancelled = true; record("cancelled", 0, nil, { presetAttempted = false }); return
        end
        stage = "final validation and preset application"
        local invoked, returned, returnValue, callFailure = false, false, nil, nil
        local gateResult = catalog:withWriteAccessDo("LRBridge Dust On preset proof (one application)", function()
            if invoked or _G.LRBridgeDustPresetAttempted then error("Duplicate preset application blocked.", 0) end
            local checked = Preset.resolve()
            if checked:getUuid() ~= presetUuid then error("Dust On preset identity changed.", 0) end
            preset = checked
            local current = Proof.capture(photo, uuid, catalog, entry.commandStamp)
            eligible(current, photo)
            if current.pasteEvidence.beforeToken ~= baseline.pasteEvidence.beforeToken then error("Destination changed after baseline; preset was not applied.", 0) end
            record("validated", 0, current)
            Proof.requireContext(photo, uuid, catalog, entry.commandStamp)
            record("preset_invoking", 0, nil, { updateAISettings = true, presetDigest = Preset.digest, clipboardUsed = false })
            invoked, attempted, _G.LRBridgeDustPresetAttempted = true, true, true
            returned, returnValue = Tasks.pcall(function() return photo:applyDevelopPreset(preset, nil, nil, true) end)
            if not returned then callFailure = Diagnostics.sanitize(returnValue); returnValue = nil end
            -- Do not throw after dispatch in the write gate. No automatic undo or retry.
        end, { timeout = 5, asynchronous = false })
        if not invoked then error("Catalog write access did not invoke the preset (" .. tostring(gateResult) .. ").", 0) end
        stage = "record SDK return"
        local reportedValue
        if type(returnValue) == "boolean" then reportedValue = returnValue end
        record("preset_returned", 0, nil, { returned = returned, resultType = type(returnValue),
            result = reportedValue, failure = callFailure, gateResult = gateResult })
        local previousEncoded, stableToken, stableReads = nil, nil, 0
        for sample = 1, 241 do
            stage = "observe SDK Apply state"
            if sample > 1 then Tasks.sleep(0.5) end
            last = Proof.capture(photo, uuid, catalog, entry.commandStamp)
            local encoded = Diagnostics.json(last)
            if sample <= 3 or sample % 20 == 0 or sample == 241 or encoded ~= previousEncoded then record("sdk_sample", sample, last) end
            previousEncoded = encoded
            if not last.available then error(last.reason, 0) end
            local comparison = Proof.compare(baseline, last)
            if not preserved(comparison) then error("Other edits, manual repairs or preferences changed during preset application. Inspect the capture; no retry.", 0) end
            if returned and returnValue ~= false and last.pasteEvidence.dustCount == 1 and not last.pasteEvidence.needsAIUpdate then
                if stableToken == last.pasteEvidence.beforeToken then stableReads = stableReads + 1
                else stableToken, stableReads = last.pasteEvidence.beforeToken, 1 end
                if stableReads >= 3 then onSnapshot = last; record("on_readback", sample, last, comparison); break end
            else stableToken, stableReads = nil, 0 end
        end
        if not onSnapshot then error("No stable Dust On readback with preserved edits after the SDK call. Do not retry. " .. (callFailure or ""), 0) end
        stage = "native button instructions"
        Dialogs.message("Dust On readback recorded - native buttons next",
            "The SDK now reports Dust applied and the monitored edits unchanged. This does not confirm fresh detection or image quality.\n\n" ..
            "Check whether native Dust Apply is checked. If it is not, do nothing and report that mismatch.\n\n" ..
            "If checked: dismiss this message, press the native Reset button at the bottom of the Dust panel ONCE, " ..
            "wait five seconds, then press its native Close ONCE. Do not use a whole-photo Reset. " ..
            "Keep this photo selected, without any other edits, until capture finishes in two minutes. " ..
            "Note whether the existing manual repair survives Reset and what Close closes.", "info")
        record("native_actions_begin", 0, onSnapshot)
        previousEncoded = nil
        for sample = 1, 241 do
            stage = "observe native Reset and Close"
            if sample > 1 then Tasks.sleep(0.5) end
            -- Read context even if closing a native tool makes preservation APIs unavailable.
            local context = { module = View.getCurrentModuleName(), selectedTool = SDK.getSelectedTool() }
            last = Proof.capture(photo, uuid, catalog, entry.commandStamp)
            if not last.available then
                context.preservationUnavailable = last.reason
                Proof.requireContext(photo, uuid, catalog, entry.commandStamp)
                last = Diagnostics.capture(photo, uuid)
            end
            local encoded = Diagnostics.json({ last, context })
            if sample <= 3 or sample % 20 == 0 or sample == 241 or encoded ~= previousEncoded then record("native_sample", sample, last, context) end
            previousEncoded = encoded
            if not last.available then error(last.reason, 0) end
        end
        stage = "write completion"
        record("finished", 242, nil, { presetAttempted = true, onReadbackRecorded = true, observationWindowEnded = true,
            nativeResetMeaningConfirmed = false, nativeCloseMeaningConfirmed = false, freshDetectionConfirmed = false,
            visualRemoval = "unassessed" })
    end)
    if not ok and output then pcall(function() record("stopped", 0, nil, { step = stage,
        failure = Diagnostics.sanitize(failure), presetAttempted = attempted, noRetry = true }) end) end
    if output then
        local closeOk, closed, closeError = pcall(function() return output:close() end)
        if ok and (not closeOk or not closed) then ok, stage, failure = false, "close capture", closeError or closed or "File close failed." end
    end
    _G.LRBridgeDustPasteRunning = false
    if not ok then
        Dialogs.message("Dust preset test stopped", stage .. ": " .. Diagnostics.sanitize(failure) ..
            (attempted and "\nPreset application was attempted. Do not retry or click Apply." or "\nNo preset was applied.") ..
            (path and "\nCapture file (may be incomplete):\n" .. path or ""), "warning")
    elseif not cancelled then
        Dialogs.message("Dust preset and buttons capture finished", "Report whether Apply was checked, what Reset affected, and what Close closed. " ..
            "Visual dust-removal quality is unassessed and not required. The capture still needs inspection.\n\nCapture file:\n" .. path, "info")
    end
end)
