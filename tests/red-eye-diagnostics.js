"use strict";
const { runtime } = require("./masking-create");
const sdk = runtime();
try {
    sdk.run(`
        local app, view, controller = import "LrApplication", import "LrApplicationView", import "LrDevelopController"
        local tasks = import "LrTasks"
        local photo, current, uuid, tool, module, video, reads, changeOnRead, settings
        local writeCalls = 0
        local function noWrite() writeCalls=writeCalls+1; error("No SDK write is allowed") end
        local function reset()
            uuid, tool, module, video, reads, changeOnRead = "eye-photo", "redeye", "develop", false, 0, nil
            settings = { Exposure2012=0.5, RetouchInfo={saved=true}, RedEyeInfo={
                { CorrectionID="eye-a", PupilSize=32, Darken=70 },
                { CorrectionID="eye-b", PupilSize=51, AddCatchlight=true } } }
            current=photo
        end
        photo={ getRawMetadata=function(_,key) if key=="uuid" then return uuid elseif key=="isVideo" then return video end end,
            getDevelopSettings=function()
                reads=reads+1
                if reads==2 and changeOnRead then changeOnRead() end
                return settings
            end, applyDevelopSettings=noWrite, applyDevelopPreset=noWrite }
        app.activeCatalog=function() return {getTargetPhoto=function() return current end,pasteSettings=noWrite} end
        app.versionTable=function() return {major=15,minor=4,revision=1} end
        view.getCurrentModuleName=function() return module end
        view.switchToModule=noWrite
        controller.getSelectedTool=function() return tool end
        controller.getSelectedSpotIndex=function() error("Remove tool required") end
        controller.getSelectedSpotParams=controller.getSelectedSpotIndex
        controller.getSelectedSpotType=controller.getSelectedSpotIndex
        controller.getValue=function(name) if name=="PupilSize" then return 50 end error("Unknown parameter") end
        controller.getRange=function(name) if name=="PupilSize" then return 0,100 end error("Unknown parameter") end
        for _,name in ipairs({"setValue","setSelectedSpotParams","selectTool","goToEyeCorrection","resetRedeye"}) do controller[name]=noWrite end
        tasks.sleep=noWrite
        local probe=require "RedEyeDiagnostics"
        local diagnostics=require "DustDiagnostics"
        reset()
        local before=diagnostics.json(settings)
        local result=probe.capture(photo,"eye-photo")
        assert(result.available and result.readOnly and reads==2)
        assert(result.settingsComplete and #result.changedSettingsDuringCapture==0)
        assert(not result.selectionGetters.getSelectedSpotParams.ok)
        assert(result.redEyeInfo.data.count==2 and result.eyeSettings.RedEyeInfo)
        assert(result.selectedEyeIdentity=="not established", "Array position and candidate values cannot identify the selected eye")
        assert(result.parameterCandidates.PupilSize.classification:find("unknown",1,true))
        assert(result.parameterCandidates.PupilSize.getValue.ok and not result.parameterCandidates.Darken.getValue.ok)
        assert(diagnostics.json(settings)==before and writeCalls==0)
        settings.RedEyeInfo[1].PupilSize=99
        assert(result.redEyeInfo.data.children["number:1"].children["string:PupilSize"].value==32, "Snapshot must not alias native settings")
        reset(); current=nil; assert(not probe.capture(photo,"eye-photo").available)
        reset(); uuid="other"; assert(not probe.capture(photo,"eye-photo").available)
        reset(); tool="dust"; assert(not probe.capture(photo,"eye-photo").available)
        reset(); module="library"; assert(not probe.capture(photo,"eye-photo").available)
        reset(); video=true; assert(not probe.capture(photo,"eye-photo").available)
        reset(); changeOnRead=function() uuid="other" end; assert(not probe.capture(photo,"eye-photo").available)
        reset(); changeOnRead=function() tool="masking" end; assert(not probe.capture(photo,"eye-photo").available)
        reset(); changeOnRead=function() settings.Exposure2012=0.75 end
        result=probe.capture(photo,"eye-photo"); assert(result.changedSettingsDuringCapture[1]=="Exposure2012")
        reset(); settings.RedEyeInfo=nil
        assert(probe.capture(photo,"eye-photo").redEyeInfo.data.type=="nil")
        reset(); settings.RedEyeInfo={}
        assert(probe.capture(photo,"eye-photo").redEyeInfo.data.count==0)
        reset(); for i=3,600 do settings.RedEyeInfo[i]={PupilSize=i} end
        result=probe.capture(photo,"eye-photo"); assert(result.redEyeInfo.truncated and not result.settingsComplete)
        assert(writeCalls==0)
        local info=dofile("lightroom/LRBridge.lrplugin/Info.lua")
        assert(info.LrExportMenuItems==nil, "Eye capture remains a development utility, not a normal menu command")
        -- Direct development capture completes immediately; no timed observation loop.
        reset()
        local originalImport=import
        local saved, closed, title
        import=function(name)
            if name=="LrDialogs" then return {message=function(t) title=t end} end
            if name=="LrPathUtils" then return {getStandardFilePath=function() return "/temp" end,
                child=function(a,b) return a.."/"..b end} end
            if name=="LrFileUtils" then return {chooseUniqueFileName=function(p) return p end} end
            return originalImport(name)
        end
        io.open=function(path,mode)
            assert(path:find("lrbridge-red-eye-sdk-",1,true) and mode=="w")
            return {write=function(_,text) saved=text;return true end,close=function() closed=true;return true end}
        end
        tasks.startAsyncTask=function(fn) fn() end
        dofile("lightroom/LRBridge.lrplugin/CaptureRedEye.lua")
        assert(saved and closed and title=="Eye SDK snapshot saved" and not _G.LRBridgeRedEyeCaptureRunning)
        assert(writeCalls==0 and reads==2)
        reset(); module="library"; saved=nil
        dofile("lightroom/LRBridge.lrplugin/CaptureRedEye.lua")
        assert(not saved and title=="Eye SDK snapshot stopped" and not _G.LRBridgeRedEyeCaptureRunning)
    `);
    console.log("Read-only eye diagnostic checks passed: context, errors, unclassified values, truncation, no writes, one-shot utility, no normal menu registration.");
} finally { sdk.close(); }
