-- One explicitly prepared clipboard paste. This is a diagnostic, not a controller action.
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDialogs = import "LrDialogs"
local LrTasks = import "LrTasks"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local Diagnostics = require "DustDiagnostics"
local Proof = require "DustPasteDiagnostics"

local function trace(stage, detail)
    pcall(function()
        local root = string.gsub(_PLUGIN.path, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
        local file = io.open(LrPathUtils.child(root, "lrplugin-log.txt"), "a")
        if file then
            pcall(function() file:write(os.date("%Y-%m-%d %H:%M:%S") .. " DustPaste: stage=" .. stage .. " " .. Diagnostics.sanitize(detail) .. "\n") end)
            file:close()
        end
    end)
end

if _G.LRBridgeDustPasteRunning or _G.LRBridgeDustCaptureStarted or _G.LRBridgeCommandBusy then
    LrDialogs.message("Dust SDK paste unavailable", "Another diagnostic or LRBridge command is running. No paste was attempted.", "warning")
    return
end
if _G.LRBridgeDustPasteAttempted then
    LrDialogs.message("Dust SDK paste already attempted", "This plug-in session has already attempted the one-shot paste. Inspect that capture; do not retry.", "warning")
    return
end
local entryOk, entry = pcall(function()
    local catalog = LrApplication.activeCatalog()
    return { catalog = catalog, photo = catalog:getTargetPhoto(), module = LrApplicationView.getCurrentModuleName(),
        commandStamp = _G.LRBridgeLastCommandFinishedAt }
end)
_G.LRBridgeDustPasteRunning = true
LrTasks.startAsyncTask(function()
    local output, path, uuid, baseline, last
    local stage, attempted, cancelled = "menu entry", false, false
    local function record(name, sample, snapshot, detail)
        assert(output:write(Diagnostics.json({ stage = name, sample = sample, at = os.date("%Y-%m-%d %H:%M:%S"),
            snapshot = snapshot, detail = detail }) .. "\n")); assert(output:flush())
    end
    local ok, failure = LrTasks.pcall(function()
        if not entryOk then error(entry, 0) end
        local photo, catalog = entry.photo, entry.catalog
        if not photo then error("No destination photo was selected at menu entry.", 0) end
        stage = "destination identity"
        uuid = photo:getRawMetadata("uuid")
        if type(uuid) ~= "string" or uuid == "" then error("Destination UUID unavailable.", 0) end
        trace("menu_entry", "module=" .. tostring(entry.module) .. " photoUuid=" .. uuid)
        if catalog ~= LrApplication.activeCatalog() or catalog:getTargetPhoto() ~= photo then error("Destination changed after menu entry.", 0) end
        if LrApplicationView.getCurrentModuleName() ~= "develop" then
            stage = "enter Develop"
            LrApplicationView.switchToModule("develop")
        end
        stage = "capture stable destination baseline"
        local previous, latestReason
        for attempt = 1, 100 do
            if catalog:getTargetPhoto() ~= photo or photo:getRawMetadata("uuid") ~= uuid then error("Destination changed during startup.", 0) end
            if LrApplicationView.getCurrentModuleName() == "develop" then
                local snapshot = Proof.capture(photo, uuid, catalog, entry.commandStamp)
                if snapshot.available then
                    Proof.requireEligible(snapshot)
                    if previous and previous.pasteEvidence.beforeToken == snapshot.pasteEvidence.beforeToken then baseline = snapshot; break end
                    previous = snapshot
                else previous = nil; latestReason = snapshot.reason end
            end
            if attempt < 100 then LrTasks.sleep(0.1) end
        end
        if not baseline then error("Stable destination baseline unavailable. " .. (latestReason or "Develop did not become ready."), 0) end
        stage = "create proof capture"
        path = LrFileUtils.chooseUniqueFileName(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"),
            "lrbridge-dust-paste-" .. os.date("%Y%m%d-%H%M%S") .. ".jsonl"))
        output = assert(io.open(path, "w"))
        record("launch", 0, nil, { menuModule = entry.module, destinationUuid = uuid, mode = "single-sdk-paste" })
        record("baseline", 0, baseline)
        stage = "confirm prepared clipboard"
        local answer = LrDialogs.confirm("Dust SDK paste: clipboard prepared?",
            "Confirm ONLY if you copied settings from the Dust-treated source with ONLY Remove > Dust selected, " ..
            "and this is the disposable destination with different dust locations and no prior automatic Dust treatment.\n\n" ..
            "Destination UUID: " .. uuid .. "\nThe clipboard cannot be inspected by this SDK. " ..
            "Choosing Prepared - paste once confirms your preparation and invokes one SDK paste. " ..
            "Do not click native Apply, paste again, use LRBridge controls, switch photos or make edits during the three-minute capture.\n\n" ..
            "Capture file:\n" .. path, "Prepared - paste once", "Cancel test")
        if answer ~= "ok" then
            cancelled = true; record("cancelled", 0, nil, { pasteAttempted = false }); return
        end
        record("clipboard_confirmed", 0, nil, { userPreparedDustOnly = true, sdkInspectedClipboard = false })
        stage = "final validation and SDK paste"
        local invoked, returned, returnValue, callFailure = false, false, nil, nil
        local gateResult = catalog:withWriteAccessDo("LRBridge Dust SDK proof (one paste)", function()
            if invoked or _G.LRBridgeDustPasteAttempted then error("Duplicate SDK paste blocked.", 0) end
            local current = Proof.capture(photo, uuid, catalog, entry.commandStamp)
            Proof.requireEligible(current)
            if current.pasteEvidence.beforeToken ~= baseline.pasteEvidence.beforeToken then
                error("Destination edits, repairs, preferences or tool changed after baseline. Paste was not invoked.", 0)
            end
            record("validated", 0, current)
            Proof.requireContext(photo, uuid, catalog, entry.commandStamp)
            record("paste_invoking", 0, nil, { destinationUuid = uuid, updateAISettings = true, clipboardConfirmed = true })
            -- Latch before dispatch; SDK exceptions/false returns never authorize another attempt.
            invoked, attempted, _G.LRBridgeDustPasteAttempted = true, true, true
            returned, returnValue = LrTasks.pcall(function() return photo:pasteSettings(true) end)
            if not returned then callFailure = Diagnostics.sanitize(returnValue); returnValue = nil end
            -- Do not throw after dispatch inside this write gate: avoid an implicit rollback
            -- merely because result logging or observation fails. No automatic undo or retry.
        end, { timeout = 5, asynchronous = false })
        if not invoked then error("Catalog write access did not invoke paste (" .. tostring(gateResult) .. ").", 0) end
        stage = "record SDK return"
        local reportedValue
        if type(returnValue) == "boolean" then reportedValue = returnValue end
        record("paste_returned", 0, nil, { returned = returned, resultType = type(returnValue),
            result = reportedValue, failure = callFailure,
            gateResult = gateResult, successfulRemovalConfirmed = false })
        trace("paste_returned", "photoUuid=" .. uuid .. " returned=" .. tostring(returned) .. " result=" .. tostring(returnValue) ..
            " failure=" .. tostring(callFailure))
        local previousEncoded
        for sample = 1, 361 do
            stage = "observe destination"
            if sample > 1 then LrTasks.sleep(0.5) end
            last = Proof.capture(photo, uuid, catalog, entry.commandStamp)
            local encoded = Diagnostics.json(last)
            stage = "write observation"
            if sample <= 3 or sample % 20 == 0 or sample == 361 or encoded ~= previousEncoded then record("sample", sample, last) end
            previousEncoded = encoded
            if not last.available then error(last.reason, 0) end
        end
        stage = "write completion"
        record("finished", 362, nil, { pasteAttempted = true, observationWindowEnded = true,
            comparison = Proof.compare(baseline, last), nativeCompletionConfirmed = false })
    end)
    if not ok and output then pcall(function() record("stopped", 0, nil, { step = stage,
        failure = Diagnostics.sanitize(failure), pasteAttempted = attempted, noRetry = true }) end) end
    if output then
        local closeOk, closed, closeError = pcall(function() return output:close() end)
        if ok and (not closeOk or not closed) then ok, stage, failure = false, "close capture", closeError or closed or "File close failed." end
    end
    _G.LRBridgeDustPasteRunning = false
    if not ok then
        local detail = Diagnostics.sanitize(failure)
        trace("stopped", "step=" .. stage .. " attempted=" .. tostring(attempted) .. " failure=" .. detail)
        LrDialogs.message("Dust SDK paste stopped", stage .. ": " .. detail ..
            (attempted and "\nSDK paste was attempted. Its outcome may be incomplete. Do not retry or click native Apply." or "\nNo SDK paste was attempted.") ..
            (path and "\nCapture file (may be incomplete):\n" .. path or ""), "warning")
    elseif not cancelled then
        LrDialogs.message("Dust SDK paste capture finished", "The observation window ended. This does not confirm dust removal. " ..
            "Inspect dust at this destination's own locations and confirm other edits and existing repairs still look correct. " ..
            "Report any native error or AI-update warning. Do not paste again.\n\nCapture file:\n" .. path, "info")
    end
end)
