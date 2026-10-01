"use strict";
// Runs copied PowerShell against disposable HTTP fixtures. Route parsing and
// command validation are production code; Lightroom/native state is synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const express = require("express");
const builder = require("./http-builder-recipes");
const commands = require("../server/commands");
const curves = require("../server/point-curve-state");
const pointColor = require("../server/point-color-state");
const maskDefs = require("../app/controller-masking-corrections");
const native = require("../server/windows-lightroom-native");
const presetDefs = require("../server/develop-presets");
const bridgeSource = fs.readFileSync(path.join(__dirname,"../server/bridge.js"),"utf8");
const clone = value => JSON.parse(JSON.stringify(value));
let session, serial = 0, fixtureFailure, verified = 0;
const app = express();
const allCases = builder.recipes.map((entry, index) => ({...entry, index}));
function begin(index, mode) {
    const item = allCases[index];
    const token = "fixture-" + (++serial);
    const ctx = {activeModule:"develop",selectedPhotoKey:token+"-key",selectedPhotoUuid:token + "-photo-é&'",contextCounter:serial,developCounter:serial+5,contextChangedAt:100+serial};
    const state = {...ctx,ok:true,available:true,active:true,revision:serial+20,updatedAt:serial,serverEpoch:token,
        selectedMaskGroupId:token+"-mask", selectedMaskToolId:token+"-tool",selectionToken:token+"-selection",selectionCount:2,
        newSpotType:"heal",repair:{token:token+"-repair"},selection:{token:token+"-selected",refinementToken:token+"-refine"},
        pointColor:{available:true,selectedIndex:2},corrections:maskDefs.supportedDefinitions.map(d=>({...d,value:0,min:-200,max:200})),
        curves:{rgb:[0,0,128,120,255,255],red:[0,0,255,255],green:[0,0,255,255],blue:[0,0,255,255]},refineSaturation:{value:75,min:0,max:100},
        options:[{label:"Adobe Color",token:"profile_"+serial.toString(16).padStart(24,"0"),enabled:true,writable:true}],contextCounter:ctx.contextCounter,photoUuid:ctx.selectedPhotoUuid,
        configured:[{uuid:token+"-preset",name:"My preset",alias:"My preset",available:true,amountEnabled:true}],inventoryStatus:"ready",inventoryRequestId:null,
        cursorUuid:token+"-preset",cursorAmountEnabled:true,amountFeedback:{id:serial,available:true,value:75,range:{min:0,max:200}},
        selectedToolAvailable:true,selectedTool:"depth_refinement",focalRangeAvailable:true,focalRange:{nearOuter:0,nearInner:10,farInner:90,farOuter:100},
        selectedIndex:2,HueRange:{LowerNone:0,LowerFull:0.25,UpperFull:0.75,UpperNone:1},SatRange:{LowerNone:0,LowerFull:0.25,UpperFull:0.75,UpperNone:1},LumRange:{LowerNone:0,LowerFull:0.25,UpperFull:0.75,UpperNone:1},
        HueMarker:0.5,SatMarker:0.5,LumMarker:0.5,superResEnabled:true,superResState:item.recipe.params?.enabled === false,denoiseState:false};
    for (const range of pointColor.rangeNames) state[pointColor.markerFields[range]]=0.5;
    session={item,ctx,state,mode,reads:[],writes:[],events:[],nativeCalls:[],sequence:0,result:null,polls:0};
    if(mode==="unavailable")session.state.available=false;
}
function verifySession() {
    const {recipe}=session.item, paths=session.writes.map(w=>w.path), mode=session.mode;
    if(mode==="decline" || mode==="unavailable") assert.equal(paths.length,0,"unavailable/declined commands send no edits");
    else if(mode==="reject") assert.equal(paths.length,1,"rejected edit must not be retried");
    else if(mode==="gesture-reject") assert.deepEqual(paths,[recipe.route+"/gesture/begin",recipe.route+"/gesture/end",recipe.route+"/gesture/cancel"],"owned gesture cleanup without edit retry");
    else {
        const expected=recipe.gesture?[recipe.route+"/gesture/begin",recipe.route+"/gesture/end"]:[recipe.route];
        if(recipe.result?.ack && mode!=="decline-review" && mode!=="timeout")expected.push(recipe.result.ack);
        assert.deepEqual(paths,expected,session.item.card.title+" actual requests");
    }
    if(recipe.state && mode!=="decline") {
        assert(session.reads.includes(recipe.state),"missing runtime state read");
        if(paths.length)assert(session.events.indexOf("read:"+recipe.state)<session.events.indexOf("write:"+paths[0]),"state must be read before edit");
    }
    if(recipe.result && !["decline","unavailable","reject","gesture-reject"].includes(mode)) {
        const state=recipe.result.state||recipe.state;
        assert(session.events.slice(session.events.indexOf("write:"+paths[0])+1).includes("read:"+state),"matching result must be read after admission");
    }
    if(mode==="wrong-result")assert(session.polls>=2,"unrelated result cannot settle this request");
    if(recipe.method && paths.length)assert.equal(session.body.presets[0].alias,"Nino's & ž preset","UTF-8 JSON and literal apostrophes");
    if(recipe.route.startsWith("/lens-blur/brush/"))assert.equal(session.nativeCalls.length,1,"one native call with no controller-created state binding");
    if(recipe.route==="/lens-blur/visualize-depth")assert.deepEqual(session.nativeCalls.map(call=>call.name),["readDepthVisualization"],"explicit depth admission uses the focused read-only path");
    verified++;
}
function current() {
    const s=clone(session.state);
    if(session.result) {
        s.lastResult=s.lastApplication=s.lastEditResult=s.lastCorrectionResult=clone(session.result);
        s.needsReview=session.item.recipe.result?.ack ? !session.acknowledged : false;
    }
    return s;
}
function exact(req, fields) {
    return Object.keys(req.query).length===fields.length && fields.every(k=>typeof req.query[k]==="string");
}
function checkBinding(input, revisionKey="stateRevision") {
    for(const key of ["selectedPhotoUuid","contextCounter","developCounter","contextChangedAt","serverEpoch"])
        assert.equal(input[key],session.state[key],"fresh binding "+key);
    assert.equal(input[revisionKey],session.state.revision,"fresh revision");
}
function maskCommand(spec,binding,kind) {
    checkBinding(binding,"revision");
    if(spec.selectedMaskGroupId!==undefined) assert.equal(spec.selectedMaskGroupId,session.state.selectedMaskGroupId);
    if(spec.selectedMaskToolId!==undefined) assert.equal(spec.selectedMaskToolId,session.state.selectedMaskToolId);
    if(spec.selectedIndex!==undefined && spec.kind!=="pointSelect") assert.equal(spec.selectedIndex,session.state.pointColor.selectedIndex);
    if(spec.kind==="pointValue") assert(pointColor.validValue(spec.field,spec.value));
    if(spec.kind==="pointRange") assert(pointColor.validRangeValue(spec.range,spec.boundary,spec.value));
    if(spec.kind==="pointTranslate") assert(pointColor.validRangeTranslation(spec.range,spec.values));
    if(spec.baseline && Array.isArray(spec.baseline)) assert.deepEqual(Array.from(spec.baseline),session.state.curves[spec.channel||"rgb"]);
    if(spec.parameter) assert(maskDefs.supportedDefinitions.some(d=>d.parameter===spec.parameter));
    const sequence=++session.sequence;
    const c={command:"fixture."+kind,operationId:"op-"+serial,editSequence:sequence,correctionSequence:sequence};
    session.result={operationId:c.operationId,sequence,outcome:"confirmed",detail:"isolated fixture readback"};
    return c;
}
const mockCommands={...commands,tryEnqueueCommand:()=>({accepted:true,status:commands.ADMISSION_ACCEPTED}),getNextCommand:()=>null};
const context={getContextFields:()=>session.ctx,getContext:()=>session.ctx};
const environment={app,console,Date,Set,Map,Buffer,URL,URLSearchParams,Number,Object,Array,JSON,
    pollingTrace:require("../server/polling-trace").createPollingTrace(os.tmpdir(),Date.now,false),
    context,commands:mockCommands,numbers:require("../server/numbers"),
    pointCurveDefinition:curves,pointColorDefinition:pointColor,focalRangeDefinition:require("../server/lens-blur-focal-range"),
    maskingDefinition:require("../server/masking-state"),maskingCorrections:maskDefs,developPresetsDefinition:presetDefs,
    windowsNativeDefinition:native,
    rejectInvalidCommand:res=>res.status(400).json({ok:false,error:"Invalid command"}),
    rejectQueueFull:()=>{throw Error("Unexpected fixture queue failure");},
    queueCommand(command) {
        if(!command.command.startsWith("fixture.")) assert(commands.validateCommand(command),"actual command schema: "+JSON.stringify(command));
        if(command.command.startsWith("tone_curve.") && !command.command.endsWith(".begin")) {
            session.state.updatedAt++;
            if(command.points)session.state.curves[command.channel||"rgb"]=Array.from(command.points);
            if(command.value!==undefined)session.state.refineSaturation.value=command.value;
        }
        return {accepted:true,status:commands.ADMISSION_ACCEPTED};
    },
    queueOrReject(res,command,extra,after) {
        environment.queueCommand(command); if(after)after();
        if(extra?.focalRangeCommitId) {session.focalRangeCommitId=extra.focalRangeCommitId;session.state.focalRange=clone(extra.focalRange);session.state.focalRangeAvailable=true;}
        res.json({ok:true,queued:command,...extra});
    },
    sendNativeFailure(_res,error){throw error;},focalRangeCommitCounter:0,
    lensBlur:{get:()=>session.state,getRevision:()=>session.state.revision,requestRefresh(){},invalidateSelectedTool(){},invalidateFocalRange(){},invalidateFocalRangeSource(){}},
    pointColor:{get:()=>session.state,requestRefresh(){}},
    enhance:{get:()=>session.state,acceptOperation:()=>true,acceptAmountOperation(){},requestRefresh(){}},
    masking:{getPublicState:current,beginOperation:(s,b)=>maskCommand(s,b,"operation"),beginEdit:(s,b)=>maskCommand(s,b,"edit"),beginCorrection:(s,b)=>maskCommand(s,b,"correction")},
    deletionDiagnostics:{record(){}},deletionDiagnosticsDefinition:require("../server/masking-deletion-diagnostics"),
    localAdjustmentPresets:{resolveWithStatus(id){assert.equal(id,session.state.cursorUuid);return {status:"ok",preset:{id,kind:"file",file:"fixture.lrtemplate"}};}},
    profileNativeDefinition:require("../server/profile-native-state"),
    profileContextBinding:c=>c,
    profileNative:{syncContext(){},get:()=>session.state,admitSdkSelection(token){assert.equal(token,session.state.options[0].token);return {label:"Adobe Color",contextCounter:session.ctx.contextCounter,generation:serial,confirmationAfterRevision:session.state.revision};}},
    developPresets:{getPublicState:current,navigationTarget(){return session.state.cursorUuid;}},
    currentPresetAmountFeedback(){return {...session.state.amountFeedback};},
    queueFeedbackRequest:()=>({id:serial+1}),PRESET_AMOUNT_PARAMETER:"PresetAmount",
    developPresetPublicState:current,
    queueDevelopPresetApplication(res,uuid,binding){assert.equal(uuid,session.state.cursorUuid);for(const k of Object.keys(binding))assert.equal(binding[k],session.state[k]);res.json({ok:true,operationId:"op-"+serial,serverEpoch:session.state.serverEpoch});},
    requestDevelopPresetInventory:current,
    parseDevelopPresetConfiguration:express.json(),
    saveDevelopPresetConfiguration(body){session.body=body;return {ok:true,configuration:presetDefs.normalizeConfiguration(body)};}
};
const pc={};
for(const name of ["beginGesture","updateGesture","endGesture","admitReset","admitPreset","beginRefineGesture","updateRefineGesture","endRefineGesture","admitRefineReset"]) pc[name]=(binding,...args)=>{
    for(const k of ["selectedPhotoUuid","contextCounter","developCounter"])assert.equal(binding[k],session.ctx[k]);
    if(name.includes("Refine")) assert(args.includes(session.state.refineSaturation.value));
    else {const baseline=args.find(Array.isArray);assert.deepEqual(Array.from(baseline),session.state.curves[name==="admitPreset"?"rgb":args[0]]);}
    return true;
};
pc.finishGesture=pc.finishRefineGesture=()=>{};
environment.pointCurve=pc;
const nativeState=()=>({...native.unavailableNativeState(),available:true,visualizeDepth:{available:true,value:false},autoMask:{available:true,value:true}});
environment.windowsNativeBackend={};
environment.windowsNativeBackend.readDepthVisualization=async()=>{
    session.nativeCalls.push({name:"readDepthVisualization",args:[]});return nativeState().visualizeDepth;
};
for(const name of ["readState","setBrushValue","adjustBrushValue","resetBrushValue","setCheckbox","setRefinementMode","setRefinementDisclosure","resetRefinement","activateFocusRangeAction"])
    environment.windowsNativeBackend[name]=async(...args)=>{session.nativeCalls.push({name,args});return nativeState();};
const sandbox=vm.createContext(environment);
function loadFunction(name) {
    const start=bridgeSource.indexOf("function "+name+"(");
    const end=bridgeSource.indexOf("\n}",start)+2;
    assert(start>=0 && end>start,name);
    const prefix=bridgeSource.slice(start-6,start)==="async "?"async ":"";
    vm.runInContext(prefix+bridgeSource.slice(start,end),sandbox);
}
for(const name of ["parseStrictFiniteNumber","exactQueryFields","parseMaskingCounter","maskingBindingFromRequest","presetBindingFromRequest",
    "parsePointCurveCounter","parsePointCurveNumber","pointCurveBindingFromQuery","hasExactPointCurveQuery","pointCurveCommandFromQuery",
    "pointCurveCancellationCommand","queuePointCurveCancellation","gestureAdmission","queuePointCurveGesture",
    "refineSaturationCommandFromQuery","refineGestureAdmission","queueRefineSaturationGesture",
    "queueMaskingOperation","queueMaskingEdit","maskingCurveGesture","maskingRefineGesture","queueMaskingCorrection","correctionSpecification",
    "validExplicitBooleanQuery","lensBlurDepthVisualizationBindingMatches","readLensBlurDepthState","currentFocalRangeMatches","queueFocalRange"]) loadFunction(name);
for(const name of ["MASKING_COMMAND_BINDING_FIELDS","MASKING_EDIT_FIELDS","MASKING_TONE_BINDING_FIELDS","MASKING_CORRECTION_FIELDS"]) {
    const start=bridgeSource.indexOf("const "+name+" ="),end=bridgeSource.indexOf(";",start)+1;
    vm.runInContext(bridgeSource.slice(start,end),sandbox);
}
// Reads are controlled fixtures. They do not call Lightroom, its native helper,
// or protocol endpoints. Mutations below use the actual registered handlers.
app.get("/fixture/begin",(req,res)=>{begin(Number(req.query.index),req.query.mode);res.json({ok:true});});
app.get("/fixture/verify",(_req,res)=>{verifySession();res.json({ok:true});});
app.use((req,res,next)=>{
    if(!session) return res.status(500).json({error:"missing fixture"});
    if(req.path.endsWith("/state") || req.path==="/context" || req.path==="/masking/presets") {
        session.reads.push(req.path);
        session.events.push("read:"+req.path);
        const s=current();
        if(session.writes.length) {
            session.polls++;
            if(session.mode==="timeout" || session.mode==="wrong-result" && session.polls===1) {
                for(const field of ["lastResult","lastApplication","lastEditResult","lastCorrectionResult"])if(s[field]){s[field].operationId="unrelated";s[field].requestId="unrelated";s[field].sequence=-1;}
            }
            if(session.mode==="uncertain" || session.mode==="decline-review") {s.lastResult.outcome="uncertain";s.needsReview=true;}
        }
        if(req.path==="/context")return res.json(session.ctx);
        if(req.path==="/masking/presets")return res.json({ok:true,presets:[{id:s.cursorUuid,name:"Preset name",kind:"file",supported:true}]});
        if(req.path.includes("tone-curve"))return res.json({ok:true,pointCurve:s});
        if(req.path==="/lens-blur/state")return res.json({ok:true,state:s,context:session.ctx,focalRangeCommitId:session.focalRangeCommitId});
        if(req.path==="/develop-categorical/state") {
            if(session.writes.length){s.validationGeneration=serial;s.selectedLabel="Adobe Color";s.revision++;}
            return res.json({ok:true,profile:s});
        }
        if(session.writes.some(w=>w.path==="/develop-presets/amount")) {s.amountFeedback.id++;s.amountFeedback.value=Number(session.writes.at(-1).query.presetAmount);}
        return res.json(s);
    }
    session.writes.push({path:req.path,query:clone(req.query),method:req.method});
    session.events.push("write:"+req.path);
    if(session.mode==="reject" || session.mode==="gesture-reject" && req.path.endsWith("/gesture/end"))return res.status(409).json({ok:false,error:"fixture stale context"});
    const json=res.json.bind(res);
    res.json=body=>{
        if(body.ok && req.path.endsWith("/acknowledge"))session.acknowledged=true;
        if(body.ok && !session.result) session.result={operationId:body.operationId||body.pendingOperation?.operationId||"op-"+serial,requestId:req.query.requestId,outcome:"confirmed",detail:"isolated fixture"};
        return json(body);
    };
    next();
});
const registered = new Set();
function registerAt(start) {
    for(let end=bridgeSource.indexOf(");",start);end>=0;end=bridgeSource.indexOf(");",end+2)) {
        const code=bridgeSource.slice(start,end+2);
        try {new vm.Script(code);} catch {continue;}
        vm.runInContext(code,sandbox);return;
    }
    throw Error("Cannot extract registered handler");
}
for(const match of bridgeSource.matchAll(/app\.(get|post)\("([^"]+)"/g)) {
    const route=match[2];
    if(!allCases.some(({recipe:r})=>r.route===route || r.route.replace(/\/brush\/[^/]+\//,"/brush/:control/")===route || r.gesture && route.startsWith(r.route+"/gesture/")))continue;
    if(route==="/command")continue;
    registerAt(match.index);registered.add(route);
}
const loop=bridgeSource.indexOf('["add", "subtract"].forEach(function (kind)');
registerAt(loop);registered.add("/masking/component/add");registered.add("/masking/component/subtract");
app.get("/command",(req,res)=>{assert(commands.validateCommand(req.query));res.json({ok:true,queued:req.query});});
for(const family of ["remove","reflections","people","red-eye","clipboard","export"]) {
    const state={get:current,recordActionRequest(){},traceRefinement(){},refreshSelection(){},
        admit(action,value,input){
            if(!["remove","reflections"].includes(family)){input=value;value=null;}
            checkBinding(input);
            if(family==="remove") {
                assert.equal(input.mode,session.state.newSpotType);
                if(input.repairToken!==undefined)assert.equal(input.repairToken,session.state.repair.token);
                if(input.selectionToken!==undefined)assert.equal(input.selectionToken,["add","subtract"].includes(value)?session.state.selection.refinementToken:session.state.selection.token);
            }
            if(["clipboard","export"].includes(family)) {
                assert.equal(input.selectionToken,session.state.selectionToken);assert.equal(input.activeModule,session.ctx.activeModule);
                assert.match(input.requestId,/^[a-f0-9]{32}$/);
            }
            const command={command:action,operationId:"op-"+serial,requestId:input.requestId};
            session.state.pendingOperation=["clipboard","export"].includes(family)?{command:action,requestId:input.requestId}:{operationId:command.operationId};
            return ["clipboard","export"].includes(family)?{command}:command;
        },acknowledge(input){assert.equal(input.serverEpoch,session.state.serverEpoch);assert.equal(input.operationId,"op-"+serial);return true;}};
    state.admitDetailed=function(action,input){return {command:state.admit(action,input)};};
    require("../server/"+family+"-routes")(app,state,mockCommands,exact,v=>Number(v));
}
app.use((error,_req,res,_next)=>{fixtureFailure=error;res.status(500).json({ok:false,error:error.message});});
app.use((req,res)=>res.status(404).json({ok:false,error:"Uncovered route "+req.path}));
function runPS(file) {
    return new Promise((resolve,reject)=>{
        const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",file],{windowsHide:true});
        let out="";child.stdout.on("data",c=>out+=c);child.stderr.on("data",c=>out+=c);
        const timer=setTimeout(()=>{child.kill();reject(Error("PowerShell fixture timeout\n"+out.slice(-3500)));},60000);
        child.on("error",reject);child.on("exit",code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(out.slice(-5000)));});
    });
}
async function main() {
    const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"lrbridge-builder-executable-"));
    try {
        const base="http://127.0.0.1:"+server.address().port;
        const lines=["$ErrorActionPreference = 'Stop'", "$script:fixtureMode = ''", "function Read-Host([string]$prompt) { if ($script:fixtureMode -eq 'decline' -or $script:fixtureMode -eq 'decline-review') { 'NO' } elseif ($prompt -like '*REVIEWED*') { 'REVIEWED' } else { 'YES' } }"];
        for(const item of allCases) {
            const {recipe,values}=item;
            // Keep Point Color marker/full-width constraints valid in this fixture.
            if(recipe.params?.boundary)values[recipe.inputs[0].key]=String({LowerNone:0,LowerFull:0.25,UpperFull:0.75,UpperNone:1}[recipe.params.boundary]);
            if(recipe.method)values.body=JSON.stringify({version:1,presets:[{uuid:"fixture-preset",alias:"Nino's & ž preset",amountEnabled:true,updateAISettings:false}]});
            const code=builder.buildRecipeScript(recipe,values,base,3);
            assert(code,item.card.title);
            assert(!code.includes("/api/"));
            lines.push("Write-Output " + builder.psLiteral("CASE "+item.index+" "+item.card.title+" "+recipe.label),
                "Invoke-RestMethod -Uri " + builder.psLiteral(base+"/fixture/begin?index="+item.index)+" | Out-Null",
                "& {\n"+code+"\n} | Out-Null",
                "Invoke-RestMethod -Uri "+builder.psLiteral(base+"/fixture/verify")+" | Out-Null");
        }
        for(const [test,mode] of [
            [r=>r.result?.ack,"wrong-result"], [r=>r.result?.ack,"uncertain"], [r=>r.result?.ack,"decline-review"],
            [r=>r.result?.ack,"timeout"], [r=>r.state==="/remove/state","unavailable"], [r=>r.state==="/remove/state","reject"],
            [r=>r.gesture && r.route==="/tone-curve","gesture-reject"], [r=>r.gesture && r.route==="/masking/correction","gesture-reject"],
            [r=>r.confirm && r.route.includes("refinement-reset"),"decline"], [r=>r.method==="POST","decline"]
        ]) {
            const item=allCases.find(({recipe})=>test(recipe));assert(item);
            let code=builder.buildRecipeScript(item.recipe,item.values,base,3);
            if(mode==="timeout")code=code.replace("AddSeconds(120)","AddSeconds(0)");
            lines.push("Write-Output "+builder.psLiteral("NEGATIVE "+mode+" "+item.card.title),
                "$script:fixtureMode = "+builder.psLiteral(mode),
                "Invoke-RestMethod -Uri "+builder.psLiteral(base+"/fixture/begin?index="+item.index+"&mode="+mode)+" | Out-Null",
                "$caught = $false\ntry { & {\n"+code+"\n} | Out-Null } catch { $caught = $true }",
                mode==="wrong-result" ? "if ($caught) { throw 'Matching later result was not accepted' }" : "if (-not $caught) { throw 'Failure must stop the script' }",
                "Invoke-RestMethod -Uri "+builder.psLiteral(base+"/fixture/verify")+" | Out-Null");
        }
        const file=path.join(directory,"requests.ps1");fs.writeFileSync(file,"\ufeff"+lines.join("\n"));
        const output=await runPS(file);
        if(fixtureFailure)throw fixtureFailure;
        assert.equal(verified,allCases.length+10);
        console.log("Executed "+allCases.length+" generated PowerShell examples and 10 failure/result scenarios through isolated production route handlers; fresh bindings, JSON, confirmations, matching results, cancellation and no edit retries verified. No live Lightroom requests.");
        assert(output.includes("CASE "+(allCases.length-1)));
    } finally {
        await new Promise(resolve=>server.close(resolve));
        assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
        assert(path.basename(directory).startsWith("lrbridge-builder-executable-"));
        fs.rmSync(directory,{recursive:true,force:true});
    }
}
main().catch(error=>{console.error(fixtureFailure||error);process.exitCode=1;});
