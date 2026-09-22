-- Development diagnosis only: bounded SDK reads, no navigation or photo writes.
-- Not registered in the normal menu or included in the distributable.
if os.getenv("LRBRIDGE_DEVELOPER_DIAGNOSTICS") ~= "1" then return end
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrDialogs = import "LrDialogs"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local Diagnostics = require "DustDiagnostics"

if _G.LRBridgeProfileCaptureRunning then return end
local photo = LrApplication.activeCatalog():getTargetPhoto()
_G.LRBridgeProfileCaptureRunning = true
LrTasks.startAsyncTask(function()
    local output, path
    local ok, failure = LrTasks.pcall(function()
        if not photo or LrApplicationView.getCurrentModuleName() ~= "develop" then
            error("Select the affected still photo in Develop.", 0)
        end
        local uuid = photo:getRawMetadata("uuid")
        local format = photo:getRawMetadata("fileFormat")
        if format == "VIDEO" then error("A still photo is required.", 0) end
        local samples = {}
        for i = 1, 5 do
            local snapshot = Diagnostics.capture(photo, uuid)
            if not snapshot.available then error(snapshot.reason, 0) end
            snapshot.fileFormat = format
            snapshot.lensBlurGetters = {}
            for _, parameter in ipairs({ "LensBlurActive", "LensBlurAmount", "LensBlurFocalRange", "LensBlurCatEye", "LensBlurHighlightsBoost" }) do
                local readOk, value = LrTasks.pcall(function() return LrDevelopController.getValue(parameter) end)
                snapshot.lensBlurGetters[parameter] = { ok = readOk,
                    result = Diagnostics.summarize(value) }
            end
            snapshot.lensBlurRanges = {}
            for _, parameter in ipairs({ "LensBlurAmount", "LensBlurCatEye", "LensBlurHighlightsBoost" }) do
                local rangeOk, minimum, maximum = LrTasks.pcall(function() return LrDevelopController.getRange(parameter) end)
                snapshot.lensBlurRanges[parameter] = { ok = rangeOk,
                    minimum = Diagnostics.summarize(minimum), maximum = Diagnostics.summarize(maximum) }
            end
            samples[i] = snapshot
            if i < 5 then LrTasks.sleep(0.35) end
        end
        if LrApplication.activeCatalog():getTargetPhoto() ~= photo or photo:getRawMetadata("uuid") ~= uuid or
            LrApplicationView.getCurrentModuleName() ~= "develop" then error("Photo context changed during capture.", 0) end
        path = LrFileUtils.chooseUniqueFileName(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"),
            "lrbridge-profile-sdk-" .. os.date("%Y%m%d-%H%M%S") .. ".json"))
        output = assert(io.open(path, "w"))
        assert(output:write(Diagnostics.json({ readOnly = true, capturedAt = os.date("%Y-%m-%d %H:%M:%S"), samples = samples })))
        assert(output:close()); output = nil
    end)
    if output then pcall(function() output:close() end) end
    _G.LRBridgeProfileCaptureRunning = false
    if ok then
        LrDialogs.message("SDK state saved", "Five read-only samples were saved. No photo settings changed.\n\n" .. path, "info")
    else
        LrDialogs.message("SDK capture stopped", Diagnostics.sanitize(failure) .. "\nNo photo settings changed.", "warning")
    end
end)
