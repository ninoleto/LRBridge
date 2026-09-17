-- One user-triggered SDK snapshot. No polling window and no Lightroom writes.
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrTasks = import "LrTasks"
local LrDialogs = import "LrDialogs"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local Diagnostics = require "DustDiagnostics"
local Probe = require "RedEyeDiagnostics"
if _G.LRBridgeRedEyeCaptureRunning then return end
local entryPhoto = LrApplication.activeCatalog():getTargetPhoto()
local entryModule = LrApplicationView.getCurrentModuleName()
_G.LRBridgeRedEyeCaptureRunning = true
LrTasks.startAsyncTask(function()
    local output, path
    local ok, failure = LrTasks.pcall(function()
        if not entryPhoto or entryModule ~= "develop" then error("Select a still photo in Develop with Red Eye open.", 0) end
        local uuid = entryPhoto:getRawMetadata("uuid")
        if type(uuid) ~= "string" or uuid == "" then error("Selected photo identity unavailable.", 0) end
        local snapshot = Probe.capture(entryPhoto, uuid)
        if not snapshot.available then error(snapshot.reason, 0) end
        path = LrFileUtils.chooseUniqueFileName(LrPathUtils.child(LrPathUtils.getStandardFilePath("temp"),
            "lrbridge-red-eye-sdk-" .. os.date("%Y%m%d-%H%M%S") .. ".json"))
        output = assert(io.open(path, "w"))
        assert(output:write(Diagnostics.json({ capturedAt = os.date("%Y-%m-%d %H:%M:%S"), snapshot = snapshot })))
        assert(output:close()); output = nil
    end)
    if output then pcall(function() output:close() end) end
    _G.LRBridgeRedEyeCaptureRunning = false
    if ok then
        LrDialogs.message("Eye SDK snapshot saved", "One read-only snapshot was saved. No correction was changed.\n\n" .. path, "info")
    else
        LrDialogs.message("Eye SDK snapshot stopped", Diagnostics.sanitize(failure) .. "\nNo correction was changed.", "warning")
    end
end)
