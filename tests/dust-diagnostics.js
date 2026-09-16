"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runtime } = require("./masking-create");
const sdk = runtime();
try {
    sdk.run(`
        local info=dofile("lightroom/LRBridge.lrplugin/Info.lua")
        assert(#info.LrExportMenuItems==6 and info.LrExportMenuItems[1].file=="CaptureDust.lua",
            "Dust capture must register under File > Plug-in Extras for access in Develop")
        assert(info.LrExportMenuItems[1].title=="Capture automatic Dust settings (read-only)")
        assert(info.LrExportMenuItems[2].file=="TestDustPaste.lua" and info.LrExportMenuItems[2].title=="Test Dust-only SDK paste (one shot)")
        assert(info.LrExportMenuItems[3].file=="CaptureDustControls.lua" and info.LrExportMenuItems[3].title=="Capture Dust controls (read-only)")
        assert(info.LrExportMenuItems[4].file=="TestDustPreset.lua" and info.LrExportMenuItems[4].title=="Test Dust preset, Reset and Close (one shot)")
        assert(info.LrExportMenuItems[5].file=="ObserveDustReset.lua" and info.LrExportMenuItems[5].title=="Start/finish Dust Reset observation (read-only)")
        assert(info.LrExportMenuItems[6].file=="ObserveDustClose.lua" and info.LrExportMenuItems[6].title=="Start/finish Dust Close observation (read-only)")
        assert(#info.LrLibraryMenuItems==1 and info.LrLibraryMenuItems[1].file=="StartPolling.lua",
            "Keep existing Library polling entry; do not duplicate Dust capture there")
        local app, view, controller = import "LrApplication", import "LrApplicationView", import "LrDevelopController"
        dustUuid, dustModule, dustReadSwitch = "dust-test-photo", "develop", false
        dustSettings = { Exposure2012 = 0.5, TestDustFlag = false, UnknownEdit = { retained = true }, Opaque = string.rep("x", 400) }
        dustPhoto = {
            getRawMetadata = function(_, key) assert(key=="uuid"); return dustUuid end,
            getDevelopSettings = function() if dustReadSwitch then dustUuid="other-photo" end return dustSettings end,
            applyDevelopSettings = function() error("diagnostics must never write settings") end,
            applyDevelopPreset = function() error("diagnostics must never apply presets") end
        }
        app.activeCatalog = function() return { getTargetPhoto=function() return dustPhoto end,
            pasteSettings=function() error("diagnostics must never paste") end } end
        app.versionTable = function() return { major=15, minor=4, revision=1 } end
        view.getCurrentModuleName = function() return dustModule end
        controller.getSelectedTool = function() return "dust" end
        controller.getRemovePanelPreferences = function() return { visualizeSpots=false, visualizationThreshold=37.4 } end
        controller.setRemovePanelPreferences = function() error("diagnostics must never write preferences") end
        controller.goToRemove = function() error("diagnostics must never navigate") end
        dustDiagnostics = require "DustDiagnostics"
        dustBefore=dustDiagnostics.capture(dustPhoto,"dust-test-photo")
        assert(dustBefore.available and dustBefore.sdkVersion.data.children["string:revision"].value==1)
        assert(dustBefore.settings.TestDustFlag.data.value==false)
        assert(dustBefore.settings.Opaque.data.hash and not dustBefore.settings.Opaque.data.value)
        assert(dustBefore.preferences.data.children["string:visualizationThreshold"].value==37.4)
        dustSettings.TestDustFlag=true
        dustAfter=dustDiagnostics.capture(dustPhoto,"dust-test-photo")
        assert(dustAfter.settings.TestDustFlag.hash~=dustBefore.settings.TestDustFlag.hash)
        assert(dustAfter.settings.Exposure2012.hash==dustBefore.settings.Exposure2012.hash)
        assert(dustBefore.settings.TestDustFlag.data.value==false, "capture must not alias getter tables")
        dustSettings.Exposure2012=0.75
        assert(dustDiagnostics.capture(dustPhoto,"dust-test-photo").settings.Exposure2012.hash~=dustBefore.settings.Exposure2012.hash)
        local big={}; for i=1,600 do big[i]=i end
        assert(dustDiagnostics.summarize(big).truncated)
        local cycle={}; cycle.self=cycle; assert(dustDiagnostics.summarize(cycle).truncated)
        dustUuid="other-photo"; assert(not dustDiagnostics.capture(dustPhoto,"dust-test-photo").available)
        dustUuid="dust-test-photo"; dustModule="library"; assert(not dustDiagnostics.capture(dustPhoto,"dust-test-photo").available)
        dustModule="develop"; dustReadSwitch=true; assert(not dustDiagnostics.capture(dustPhoto,"dust-test-photo").available)
        dustReadSwitch=false; dustUuid="dust-test-photo"; dustSettings=nil
        assert(not dustDiagnostics.capture(dustPhoto,"dust-test-photo").available)
        function takeResultUrl() return dustDiagnostics.json(dustBefore) end
    `);
    const snapshot = JSON.parse(sdk.result());
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.selectedTool, "dust");
    assert.equal(snapshot.settings.TestDustFlag.data.value, false);
    const { summarize } = require("../scripts/summarize-dust-capture");
    const after = structuredClone(snapshot);
    after.settings.TestDustFlag = { data: { type: "boolean", value: true }, hash: "changed", truncated: false };
    const lines = [{ stage: "baseline", sample: 0, snapshot }, { stage: "sample", sample: 1, snapshot: after },
        { stage: "finished", sample: 361, snapshot: { readOnly: true } }].map(JSON.stringify).join("\n");
    const report = summarize(lines);
    assert.equal(report.finished, true);
    assert.deepEqual(report.changes[0].fields, ["TestDustFlag"]);
    assert.deepEqual(report.preferenceChanges, []);
    const controlsAfter = structuredClone(after);
    controlsAfter.preferences.hash = "native-size-and-visualization-change";
    controlsAfter.selectedTool = "loupe";
    const controlsReport = summarize([snapshot, controlsAfter].map(snapshot => JSON.stringify({ snapshot })).join("\n"));
    assert.equal(controlsReport.preferenceChanges.length, 1);
    assert.equal(controlsReport.selectedToolChanges[0].after, "loupe");
    assert.deepEqual(report.truncatedFields, []);
    after.selectedPhotoUuid = "other-photo";
    assert.throws(() => summarize([snapshot, after].map(snapshot => JSON.stringify({ snapshot })).join("\n")), /more than one photo/);
    sdk.run(`
        dustSettings={TestDustFlag=false}; dustUuid="dust-test-photo"; dustModule="develop"
        local originalImport=import
        dustCaptureLines, dustMessages, dustSleeps = {}, {}, 0
        local output={write=function(_,text) dustCaptureLines[#dustCaptureLines+1]=text; return true end,
            flush=function() return true end, close=function() dustCaptureClosed=true; return true end}
        io.open=function(path, mode) assert(string.find(path,"lrbridge-dust-capture-",1,true) and mode=="w"); return output end
        import=function(name)
            if name=="LrDialogs" then return {message=function(title) dustMessages[#dustMessages+1]=title end} end
            if name=="LrPathUtils" then return {getStandardFilePath=function(which) assert(which=="temp");return "/temp" end,
                child=function(parent,child) return parent.."/"..child end} end
            if name=="LrFileUtils" then return {chooseUniqueFileName=function(path) return path end} end
            return originalImport(name)
        end
        local tasks=import "LrTasks"
        tasks.startAsyncTask=function(fn) fn() end
        tasks.sleep=function(seconds)
            if seconds==0.1 then return end
            assert(seconds==0.5); dustSleeps=dustSleeps+1
            if dustSleeps==1 then dustSettings.TestDustFlag=true end
            if dustSleeps==5 then dustUuid="other-photo" end
        end
        dofile("lightroom/LRBridge.lrplugin/CaptureDust.lua")
        assert(dustMessages[1]=="Dust capture ready" and dustMessages[2]=="Dust capture stopped")
        assert(dustCaptureClosed and not _G.LRBridgeDustCaptureStarted and dustSleeps==5)
        function takeResultUrl() return table.concat(dustCaptureLines) end
    `);
    const captureReport = summarize(sdk.result());
    assert.equal(captureReport.finished, false);
    assert.deepEqual(captureReport.changes[0].fields, ["TestDustFlag"]);
    assert.match(captureReport.stoppedReason, /Selected photo changed/);
    sdk.run(`
        local app = import "LrApplication"
        app.developPresetFolders = function() return {{ getDevelopPresets = function() return {
            { getName = function() return "Unrelated preset" end, getSetting = function() error("Do not inspect unrelated settings") end },
            { getName = function() return "LRBridge Dust On" end, getUuid = function() return "dust-on" end,
                getFile = function() return "/fixture/dust-on.xmp" end, getSetting = function() return { DustExample = "native-test-fixture" } end },
            { getName = function() return "LRBridge Dust Off" end, getUuid = function() return "dust-off" end,
                getFile = function() return "/fixture/dust-off.xmp" end, getSetting = function() return {} end }
        } end }} end
        local presets = require "DustPresetDiagnostics"
        local result = presets.capture()
        assert(result.available and #result.presets == 2 and result.readOnly)
        assert(result.presets[1].settings.DustExample.data.value == "native-test-fixture")
        app.developPresetFolders = function() error("preset lookup failed C:/private/folder") end
        result = presets.capture(); assert(not result.available and not string.find(result.reason, "private", 1, true))
    `);
    for (const file of ["DustDiagnostics.lua", "CaptureDust.lua", "CaptureDustControls.lua", "DustPresetDiagnostics.lua"]) {
        const source = fs.readFileSync("lightroom/LRBridge.lrplugin/" + file, "utf8");
        assert.doesNotMatch(source, /[:.]\s*(applyDevelopSettings|applyDevelopPreset|pasteSettings|setValue|selectTool|goToRemove|setRemovePanelPreferences|setSelectedPhotos)\s*\(/,
            file + " must remain read-only");
    }
    console.log("Dust diagnostics: bounded detached evidence, raw preferences, photo/module isolation and read-only checks passed.");
} finally { sdk.close(); }

const launchScenarios = ["develop", "library", "library-delayed-settings", "module-before-task", "missing-photo", "photo-before-task",
    "photo-during-baseline", "library-photo-during-navigation", "library-navigation-timeout", "library-navigation-error",
    "settings-unavailable", "settings-empty", "settings-throws", "file-open", "file-write", "file-flush", "file-close",
    "photo-after-ready", "logging-error", "controls", "controls-library"];
for (const scenario of launchScenarios) {
    const launchSdk = runtime();
    try {
        launchSdk.set("dustLaunchScenario", scenario);
        launchSdk.run(fs.readFileSync("tests/dust-capture-startup.lua", "utf8"));
    } catch (error) { throw Error(scenario + ": " + error.message); }
    finally { launchSdk.close(); }
}
console.log("Dust startup: " + launchScenarios.length + " Library/Develop, photo binding, readiness, sanitized SDK/file errors and no-edit scenarios passed.");
