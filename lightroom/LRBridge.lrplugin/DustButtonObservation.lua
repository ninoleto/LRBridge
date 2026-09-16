-- Read-only observation of ONE user-native button. No preset, edit or tool writes.
-- The same menu starts and finishes the observation; there is no action deadline.
local App = import "LrApplication"
local View = import "LrApplicationView"
local Tasks = import "LrTasks"
local Dialogs = import "LrDialogs"
local Paths = import "LrPathUtils"
local Files = import "LrFileUtils"
local Diagnostics = require "DustDiagnostics"
local Proof = require "DustPasteDiagnostics"
local Observation = {}

local function menuTitle(action)
    return "Start/finish Dust " .. (action == "reset" and "Reset" or "Close") .. " observation (read-only)"
end
function Observation.run(action)
    assert(action == "reset" or action == "close", "Unknown Dust button")
    local active = _G.LRBridgeDustButtonObservation
    if active then
        if active.action == action then
            active.finishRequested = true
        else
            Dialogs.message("Dust observation already running", "Finish the current observation using File > Plug-in Extras > " ..
                menuTitle(active.action) .. ". Only one native button is observed at a time.", "info")
        end
        return
    end
    if _G.LRBridgeDustPasteRunning or _G.LRBridgeDustCaptureStarted or _G.LRBridgeCommandBusy then
        Dialogs.message("Dust observation unavailable", "Another diagnostic or LRBridge command is running.", "warning")
        return
    end
    local entryOk, entry = pcall(function()
        local catalog = App.activeCatalog()
        return { catalog = catalog, photo = catalog:getTargetPhoto(), module = View.getCurrentModuleName(),
            commandStamp = _G.LRBridgeLastCommandFinishedAt }
    end)
    local session = { action = action, finishRequested = false }
    _G.LRBridgeDustButtonObservation, _G.LRBridgeDustCaptureStarted = session, true
    Tasks.startAsyncTask(function()
        local output, path, baseline, uuid
        local stage, sample = "menu entry", 0
        local function record(name, snapshot, detail)
            assert(output:write(Diagnostics.json({ stage = name, sample = sample, at = os.date("%Y-%m-%d %H:%M:%S"),
                snapshot = snapshot, detail = detail }) .. "\n")); assert(output:flush())
        end
        local ok, failure = Tasks.pcall(function()
            if not entryOk then error(entry, 0) end
            local photo, catalog = entry.photo, entry.catalog
            if not photo then error("No selected test photo at menu entry.", 0) end
            stage = "selected photo identity"
            uuid = photo:getRawMetadata("uuid")
            if type(uuid) ~= "string" or uuid == "" then error("Selected photo UUID unavailable.", 0) end
            if catalog ~= App.activeCatalog() or catalog:getTargetPhoto() ~= photo then error("Selected test photo changed after menu entry.", 0) end
            if View.getCurrentModuleName() ~= "develop" then stage = "enter Develop"; View.switchToModule("develop") end
            stage = "capture stable baseline"
            local previous, reason
            for attempt = 1, 100 do
                if catalog ~= App.activeCatalog() or catalog:getTargetPhoto() ~= photo or photo:getRawMetadata("uuid") ~= uuid then
                    error("Selected test photo changed during startup.", 0)
                end
                if View.getCurrentModuleName() == "develop" then
                    local current = Proof.capture(photo, uuid, catalog, entry.commandStamp)
                    if current.available then
                        if current.selectedTool ~= "dust" then error("Native Healing must be open before observing its button.", 0) end
                        if current.pasteEvidence.needsAIUpdate then error("Selected photo has pending AI updates.", 0) end
                        if action == "reset" then
                            if current.pasteEvidence.dustCount ~= 1 then error("Reset observation needs the already Dust-treated photo. No treatment will be applied.", 0) end
                            if current.pasteEvidence.manualSpots.data.count < 1 then
                                error("The existing manual Healing repair is missing; Reset scope cannot be distinguished on this photo.", 0)
                            end
                        end
                        if previous and previous.pasteEvidence.beforeToken == current.pasteEvidence.beforeToken then baseline = current; break end
                        previous = current
                    else previous = nil; reason = current.reason end
                end
                if session.finishRequested then error("Observation cancelled during startup.", 0) end
                if attempt < 100 then Tasks.sleep(0.1) end
            end
            if not baseline then error("Stable baseline unavailable. " .. (reason or "Develop did not become ready."), 0) end
            stage = "create read-only capture"
            path = Files.chooseUniqueFileName(Paths.child(Paths.getStandardFilePath("temp"),
                "lrbridge-dust-" .. action .. "-" .. os.date("%Y%m%d-%H%M%S") .. ".jsonl"))
            session.path = path
            output = assert(io.open(path, "w"))
            record("launch", nil, { mode = "read-only-single-button", intendedButton = action, menuModule = entry.module,
                selectedPhotoUuid = uuid, automaticDeadline = false, editCalls = 0 })
            record("baseline", baseline)
            stage = "ready message"
            Dialogs.message("Dust " .. (action == "reset" and "Reset" or "Close") .. " observation ready",
                "The baseline is saved. Dismiss this message and tell your assistant you are ready. " ..
                "Wait for the single-button instruction before clicking anything. There is no countdown.\n\n" ..
                "Keep this photo selected in Develop. This diagnostic never applies Dust or changes photo edits. " ..
                "When asked to finish, run the SAME menu command again:\nFile > Plug-in Extras > " .. menuTitle(action) ..
                "\n\nCapture file:\n" .. path, "info")
            local previousEncoded = Diagnostics.json(baseline)
            while true do
                stage = "observe selected photo"
                local current = Proof.capture(photo, uuid, catalog, entry.commandStamp)
                local detail
                if not current.available then
                    -- Tool closure may make manual inventory unreadable. Retain other readback,
                    -- with an explicit preservation gap, only while the original context holds.
                    detail = { preservationUnavailable = current.reason }
                    Proof.requireContext(photo, uuid, catalog, entry.commandStamp)
                    current = Diagnostics.capture(photo, uuid)
                end
                sample = sample + 1
                local encoded = Diagnostics.json({ snapshot = current, detail = detail })
                stage = "write observation"
                if sample == 1 or encoded ~= previousEncoded or sample % 120 == 0 or session.finishRequested then
                    record(session.finishRequested and "final" or "sample", current, detail)
                end
                previousEncoded = encoded
                if not current.available then error(current.reason, 0) end
                if session.finishRequested then
                    record("finished", nil, { userEndedObservation = true, intendedButton = action,
                        buttonClickConfirmed = false, meaningConfirmed = false, editCalls = 0,
                        comparison = current.pasteEvidence and Proof.compare(baseline, current) or
                            { available = false, reason = detail and detail.preservationUnavailable } })
                    break
                end
                -- No elapsed-time cutoff. Only the user, context loss or a read/write failure ends this.
                Tasks.sleep(0.5)
            end
        end)
        if not ok and output then pcall(function() record("stopped", nil, { step = stage,
            failure = Diagnostics.sanitize(failure), editCalls = 0, buttonClickConfirmed = false }) end) end
        if output then
            local closeOk, closed, closeError = pcall(function() return output:close() end)
            if ok and (not closeOk or not closed) then ok, stage, failure = false, "close capture", closeError or closed or "File close failed." end
        end
        _G.LRBridgeDustButtonObservation, _G.LRBridgeDustCaptureStarted = nil, false
        if not ok then
            Dialogs.message("Dust button observation stopped", stage .. ": " .. Diagnostics.sanitize(failure) ..
                "\nThis diagnostic made no photo edits." .. (path and "\nCapture file (may be incomplete):\n" .. path or ""), "warning")
        else
            Dialogs.message("Dust button observation finished", "The read-only observation is saved. " ..
                "Report which native button you actually clicked, or that you clicked none. " ..
                "Finishing the capture does not prove a button was used.\n\nCapture file:\n" .. path, "info")
        end
    end)
end
return Observation
