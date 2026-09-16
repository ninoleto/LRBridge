local scenario = dustLaunchScenario
local controlsCapture = scenario == "controls" or scenario == "controls-library"
local app, view, sdk, tasks = import "LrApplication", import "LrApplicationView", import "LrDevelopController", import "LrTasks"
local originalImport = import
local module = string.find(scenario, "library", 1, true) and "library" or "develop"
local entryModule = module
local settings = { Exposure2012 = 0.5, TestDustFlag = false }
local preferences = { visualizeSpots = false, visualizationThreshold = 50, brushSize = 85 }
local inTask, waits, samples, reads, navigations = false, 0, 0, 0, 0
local logs, lines, messages = {}, {}, {}
local flushed, closed = 0, false
local photo, other = {}, {}
photo.getRawMetadata = function(_, key) assert(inTask and key == "uuid"); return "original-photo" end
other.getRawMetadata = function(_, key) assert(inTask and key == "uuid"); return "other-photo" end
local selected = scenario == "missing-photo" and nil or photo
if scenario == "missing-photo" then selected = nil end
photo.getDevelopSettings = function()
    assert(inTask and module == "develop" and selected == photo)
    reads = reads + 1
    if scenario == "settings-unavailable" then return nil end
    if scenario == "settings-empty" then return {} end
    if scenario == "settings-throws" then error("settings getter failed at https://private.example/file?token=secret") end
    if scenario == "library-delayed-settings" and waits < 4 then return nil end
    if scenario == "photo-during-baseline" then selected = other end
    return settings
end
local function forbidden() error("Diagnostic must not change edits, tools or selected photos") end
photo.applyDevelopPreset, photo.applyDevelopSettings = forbidden, forbidden
app.activeCatalog = function() return { getTargetPhoto = function() return selected end, setSelectedPhotos = forbidden, pasteSettings = forbidden } end
app.versionTable = function() return { major = 15, minor = 4, revision = 1 } end
view.getCurrentModuleName = function() return module end
view.switchToModule = function(target)
    assert(inTask and target == "develop"); navigations = navigations + 1
    if scenario == "library-navigation-error" then error("module navigation failed C:/private/folder/photo.raw") end
    if scenario == "library-photo-during-navigation" then selected = other end
end
sdk.getSelectedTool = function() return "dust" end
sdk.getRemovePanelPreferences = function() return preferences end
sdk.setValue, sdk.selectTool, sdk.goToRemove, sdk.setRemovePanelPreferences = forbidden, forbidden, forbidden, forbidden
_PLUGIN = { path = "D:/fixture/lightroom/LRBridge.lrplugin" }
local file = {
    write = function(_, text)
        if scenario == "file-write" then return nil, "disk full at C:/private/capture.jsonl" end
        lines[#lines + 1] = text; return true
    end,
    flush = function()
        if scenario == "file-flush" then return nil, "capture flush denied" end
        flushed = flushed + 1; return true
    end,
    close = function()
        closed = true
        if scenario == "file-close" then return nil, "capture close failed" end
        return true
    end
}
io.open = function(path, mode)
    if mode == "a" then
        assert(path == "D:/fixture/lrplugin-log.txt")
        return { write = function(_, text)
            if scenario == "logging-error" then error("log disk failed") end
            logs[#logs + 1] = text; return true
        end, close = function() return true end }
    end
    assert(mode == "w" and string.find(path, controlsCapture and "lrbridge-dust-controls-" or "lrbridge-dust-capture-", 1, true))
    if scenario == "file-open" then return nil, "capture open denied C:/private/capture.jsonl" end
    return file
end
import = function(name)
    if name == "LrDialogs" then return { message = function(title, text)
        messages[#messages + 1] = { title = title, text = text }
        if title == "Dust capture ready" or title == "Dust controls capture ready" then
            assert(module == "develop" and selected == photo and reads >= 2)
            assert(flushed >= 2 and string.find(table.concat(lines), '"stage":"baseline"', 1, true), "Ready requires a saved valid baseline")
            assert(string.find(text, controlsCapture and "uncheck Dust Apply once" or "Apply once", 1, true))
            if controlsCapture then assert(string.find(text, "Dust Size to 37", 1, true) and string.find(text, "threshold to 64", 1, true)) end
        end
    end } end
    if name == "LrPathUtils" then return { getStandardFilePath = function(which) assert(which == "temp"); return "/temp" end,
        child = function(parent, child) if child == "CaptureDust.lua" then return "lightroom/LRBridge.lrplugin/CaptureDust.lua" end; return parent .. "/" .. child end } end
    if name == "LrFileUtils" then return { chooseUniqueFileName = function(path) return path end } end
    return originalImport(name)
end
tasks.startAsyncTask = function(fn)
    inTask = true
    if scenario == "module-before-task" then module = "library" end
    if scenario == "photo-before-task" then selected = other end
    fn(); inTask = false
end
tasks.sleep = function(seconds)
    if seconds == 0.1 then
        waits = waits + 1
        if navigations > 0 and waits >= 2 and scenario ~= "library-navigation-timeout" then module = "develop" end
    else
        assert(seconds == 0.5); samples = samples + 1
        if controlsCapture then
            if samples == 1 then preferences.brushSize = 37 end
            if samples == 2 then preferences.visualizeSpots = true; preferences.visualizationThreshold = 64 end
        end
        if samples == 1 then settings.TestDustFlag = true end -- simulated user action, never diagnostic code
        if scenario == "photo-after-ready" then selected = other end
    end
end
dofile("lightroom/LRBridge.lrplugin/" .. (controlsCapture and "CaptureDustControls.lua" or "CaptureDust.lua"))
assert(not _G.LRBridgeDustCaptureStarted)
local success = scenario == "develop" or scenario == "library" or scenario == "library-delayed-settings" or
    scenario == "module-before-task" or scenario == "logging-error" or controlsCapture
if success then
    assert(#messages == (controlsCapture and 2 or 1) and messages[1].title == (controlsCapture and "Dust controls capture ready" or "Dust capture ready"), scenario)
    if controlsCapture then
        assert(messages[2].title == "Dust controls capture finished")
        assert(string.find(table.concat(lines), '"value":37', 1, true) and string.find(table.concat(lines), '"value":64', 1, true))
    end
    assert(samples == 360 and closed and settings.Exposure2012 == 0.5)
else
    local last = messages[#messages]
    assert(last and last.title == "Dust capture stopped", scenario)
    local expected = {
        ["missing-photo"] = "No selected test photo", ["photo-before-task"] = "Selected test photo changed",
        ["photo-during-baseline"] = "Selected test photo changed", ["library-photo-during-navigation"] = "Selected test photo changed",
        ["library-navigation-timeout"] = "Could not enter or remain in Develop",
        ["library-navigation-error"] = "module navigation failed",
        ["settings-unavailable"] = "Develop settings unavailable or empty", ["settings-empty"] = "Develop settings unavailable or empty",
        ["settings-throws"] = "settings getter failed", ["file-open"] = "capture open denied",
        ["file-write"] = "disk full", ["file-flush"] = "capture flush denied", ["file-close"] = "capture close failed",
        ["photo-after-ready"] = "Selected test photo changed"
    }
    assert(string.find(last.text, expected[scenario], 1, true), last.text)
    local afterReady = scenario == "photo-after-ready" or scenario == "file-close"
    assert(#messages == (afterReady and 2 or 1), "Startup failure must not show Ready: " .. scenario)
    assert(not string.find(last.text, "private", 1, true) and not string.find(last.text, "token=secret", 1, true), last.text)
    assert(string.find(table.concat(logs), "stage=failed", 1, true), "Sanitized actual failure must be logged")
end
assert(navigations <= 1, "Never retry module navigation")
if entryModule == "develop" and scenario ~= "module-before-task" then assert(navigations == 0) end
if scenario == "library" or scenario == "library-delayed-settings" or scenario == "module-before-task" then assert(navigations == 1) end
if scenario == "settings-unavailable" or scenario == "settings-empty" or scenario == "settings-throws" or scenario == "library-navigation-timeout" then assert(waits == 99) end
if scenario ~= "logging-error" then
    local trace = table.concat(logs)
    assert(string.find(trace, "stage=menu_entry module=" .. entryModule, 1, true))
    if scenario ~= "missing-photo" then assert(string.find(trace, "stage=menu_photo module=" .. entryModule .. " photoUuid=original-photo", 1, true)) end
    if scenario == "module-before-task" then assert(string.find(trace, "stage=task_start module=library photoUuid=original-photo", 1, true)) end
    assert(not string.find(trace, "private", 1, true))
end
