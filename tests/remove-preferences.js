"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const { runtime } = require("./masking-create");
const definition = require("../server/remove-state");
async function scenario(mode, field, name, requested = 41.5) {
    const originalLog = console.log; console.log = () => {};
    commands.resetQueueForTests();
    const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
    sdk.set("removeMode", mode); sdk.run("removePreferences.newSpotType = removeMode");
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (suffix, code = 200) => { const r = await fetch(base + suffix); assert.equal(r.status, code, name + " " + suffix); return r.json(); };
    const resultPath = () => { const url = new URL(sdk.result()); return url.pathname + url.search; };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: name });
        if (name === "fractional-native") sdk.run("removePreferences.brushSize=25.49; removePreferences.brushFeather=50.1; removePreferences.visualizationThreshold=37.4");
        if (name.startsWith("read-")) {
            sdk.set("removeScenario", name.slice(5));
            if (name === "read-closed") sdk.run("removeTool = 'masking'");
        }
        await get("/remove/state"); const { request } = await get("/remove/next"); assert.ok(request);
        assert.equal((await get("/remove/next")).request, null, "query dispatched once");
        sdk.set("queryJson", JSON.stringify({ request })); sdk.run("removeQuery()");
        const queryPath = resultPath(); await get(queryPath); await get(queryPath, 409);
        const before = await get("/remove/state");
        if (name.startsWith("read-")) { assert.equal(before.available, false); sdk.run("assert(removeCalls == 0)"); return; }
        assert.equal(before.available, true); assert.equal(before.newSpotType, mode); assert.equal(before.brushSize, name === "fractional-native" ? 25.49 : 25);
        const binding = Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, before[k]]));
        const query = new URLSearchParams({ ...binding, stateRevision: before.revision, mode, field, value: requested });
        const route = "/remove/brush?" + query;
        for (const value of ["NaN", "101", "-1", "01x"]) { const bad = new URLSearchParams(query); bad.set("value", value); await get("/remove/brush?" + bad, 400); }
        await get(route + "&extra=1", 400); await get(route + "&value=40", 400);
        if (!definition.fieldSupported(field, mode, before)) { await get(route, 409); sdk.run("assert(removeCalls == 0)"); return; }
        if (name.startsWith("queue-")) {
            await get(route); const part = name.slice(6);
            context.updateContext({ activeModule: part === "module" ? "library" : "develop",
                selectedPhotoUuid: part === "photo" ? "another-photo" : "creation-photo", developFingerprint: part === "develop" ? "changed" : name });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(removeCalls == 0)"); return;
        }
        const admitted = await get(route); assert.equal(admitted.brushSize, before.brushSize, "admission does not fabricate state");
        assert.equal(admitted.pendingOperation.field, field); await get(route, 409);
        const command = commands.getNextCommand(); assert.ok(command); assert.equal(command.field, field);
        assert.equal(command.expectedRemoveMode, mode); assert.equal(commands.getNextCommand(), null);
        assert.equal(command.expectedValue, before[field], "retain raw fractional native baseline");
        assert.equal(commands.tryEnqueueCommand(command).accepted, false, "same envelope cannot be queued twice");
        assert.equal(commands.tryEnqueueBatch([command]).accepted, false, "batch admission cannot bypass single-operation ownership");
        for (const change of [{ expectedRemoveMode: "bad" }, { value: null }, { extra: 1 }, { expectedValue: NaN }]) {
            assert.equal(commands.validateCommand({ ...command, ...change }), false);
        }
        const validate = new URLSearchParams({ operationId: command.operationId });
        for (const field of definition.bindingFields) validate.set(field, command[field]);
        assert.equal((await get("/remove/validate?" + validate)).valid, true);
        sdk.set("removeScenario", name); sdk.set("commandJson", JSON.stringify(command)); sdk.run("removeExecute()");
        let result = resultPath();
        if (name === "forged-result") { await get(result.replace("field=brushSize", "field=brushFeather"), 409); }
        await get(result); await get(result, 409);
        const after = await get("/remove/state");
        const expected = ["ordinary", "forged-result", "fractional-native"].includes(name) ? "confirmed" :
            name.endsWith("before") || name.endsWith("after") && !["unrelated-after", "future-after", "shared-future-after"].includes(name) || name === "invalid-binding" ? "stale" : "failed";
        assert.equal(after.lastResult.outcome, expected, name + ": " + after.lastResult.detail);
        const calls = name.endsWith("before") || ["invalid-binding", "getter-error", "getter-nil", "malformed"].includes(name) ? 0 : 1;
        sdk.run("assert(removeCalls == " + calls + ")");
        if (expected === "confirmed") {
            assert.equal(after[field], requested); sdk.run("assertOtherPreferences()");
            for (const other of definition.preferenceFields) if (other !== field) assert.equal(after[other], before[other], "preserve " + other);
        }
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = originalLog; }
}
async function verifyModeReplacement(dispatched) {
    const log = console.log; console.log = () => {};
    commands.resetQueueForTests();
    const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (route, status = 200) => { const r = await fetch(base + route); assert.equal(r.status, status, route); return r.json(); };
    const resultPath = () => { const url = new URL(sdk.result()); return url.pathname + url.search; };
    const binding = state => Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, state[k]]));
    const write = (state, field, value) => get("/remove/brush?" + new URLSearchParams({ ...binding(state), stateRevision: state.revision, mode: state.newSpotType, field, value }));
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: "replace-" + dispatched });
        await get("/remove/state"); const { request } = await get("/remove/next");
        sdk.set("queryJson", JSON.stringify({ request })); sdk.run("removeQuery()"); await get(resultPath());
        const original = await get("/remove/state"), pending = await write(original, "brushSize", 70);
        const oldCommand = dispatched ? commands.getNextCommand() : null;
        await write(pending, "newSpotType", "clone");
        if (oldCommand) {
            const validate = new URLSearchParams({ operationId: oldCommand.operationId });
            for (const field of definition.bindingFields) validate.set(field, oldCommand[field]);
            assert.equal((await get("/remove/validate?" + validate)).valid, false, "mode intent revokes old SDK write ownership");
            sdk.set("removeScenario", "invalid-binding"); sdk.set("commandJson", JSON.stringify(oldCommand)); sdk.run("removeExecute()");
            await get(resultPath(), 409);
        }
        const next = commands.getNextCommand(); assert.equal(next.field, "newSpotType"); assert.equal(next.value, "clone");
        assert.equal(commands.getNextCommand(), null, "obsolete queued envelope was removed");
        sdk.set("removeScenario", "ordinary"); sdk.set("commandJson", JSON.stringify(next)); sdk.run("removeExecute()");
        const result = resultPath(); await get(result); await get(result, 409);
        const after = await get("/remove/state"); assert.equal(after.newSpotType, "clone"); assert.equal(after.lastResult.outcome, "confirmed");
        for (const field of definition.preferenceFields) if (field !== "newSpotType") assert.equal(after[field], original[field]);
        sdk.run("assert(removeCalls == 1); assertOtherPreferences()");
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
async function verifyPanel(name, tool = "dust") {
    const log = console.log; console.log = () => {}; commands.resetQueueForTests();
    const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
    sdk.set("removeTool", tool); sdk.run("removePanelAllowed=true");
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (route, status = 200) => { const r = await fetch(base + route); assert.equal(r.status, status, name + " " + route); return r.json(); };
    const resultPath = () => { const u = new URL(sdk.result()); return u.pathname + u.search; };
    const client = state => Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, state[k]]));
    const write = (state, field, value, route) => "/remove/" + route + "?" + new URLSearchParams({ ...client(state), stateRevision: state.revision,
        mode: state.newSpotType || null, field, value });
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: "panel-" + name + tool });
        await get("/remove/state"); const { request } = await get("/remove/next");
        sdk.set("queryJson", JSON.stringify({ request })); sdk.run("removeQuery()"); await get(resultPath());
        let before = await get("/remove/state"); assert.equal(before.selectedTool, tool); assert.equal(before.available, tool === "dust");
        let obsolete;
        if (name.startsWith("cancel-")) {
            before = await get(write(before, "brushSize", 70, "brush"));
            if (name === "cancel-dispatched") obsolete = commands.getNextCommand();
        }
        const value = tool === "dust" ? "loupe" : "dust", route = write(before, "selectedTool", value, "panel");
        await get(route + "&extra=1", 400); await get(route.replace("/panel?", "/brush?"), 400);
        const admitted = await get(route); assert.equal(admitted.selectedTool, tool, "HTTP acknowledgement is not native feedback");
        await get(route, 409);
        if (obsolete) {
            const validation = new URLSearchParams({ operationId: obsolete.operationId });
            for (const k of definition.bindingFields) validation.set(k, obsolete[k]);
            assert.equal((await get("/remove/validate?" + validation)).valid, false, "Close revokes pending preference validation");
            sdk.set("removeScenario", "invalid-binding"); sdk.set("commandJson", JSON.stringify(obsolete)); sdk.run("removeExecute()");
            await get(resultPath(), 409);
            sdk.run("removeValidations=0");
        }
        if (name === "queue-photo") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "another-photo", developFingerprint: name });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(removePanelCalls==0 and removeCalls==0)"); return;
        }
        const command = commands.getNextCommand(); assert.ok(command); assert.equal(command.command, "remove.panel.set");
        assert.equal(command.expectedValue, tool); assert.equal(command.value, value); assert.equal(commands.getNextCommand(), null);
        assert.equal(commands.tryEnqueueCommand(command).accepted, false); assert.equal(commands.tryEnqueueBatch([command]).accepted, false);
        assert.equal(commands.validateCommand({ ...command, value: tool }), false);
        sdk.set("removeScenario", name); sdk.set("commandJson", JSON.stringify(command)); sdk.run("removeExecute()");
        let result = resultPath();
        await get(result.replace("field=selectedTool", "field=newSpotType"), 409);
        if (name === "forged-state") result = result.replace("&selectedTool=" + value, "&selectedTool=" + tool);
        await get(result); await get(result, 409);
        const after = await get("/remove/state");
        const expected = ["setter-error", "no-change", "forged-state", "wrong-mode", "getter-error", "open-unrelated"].includes(name) ? "failed" :
            name.endsWith("before") || name.endsWith("after") || name === "invalid-binding" ? "stale" : "confirmed";
        assert.equal(after.lastResult.outcome, expected, name + " " + after.lastResult.detail);
        if (expected === "confirmed") {
            assert.equal(after.selectedTool, value);
            if (value === "dust") { assert.equal(after.newSpotType, "heal_patchmatch"); assert.equal(after.available, true); }
        }
        sdk.run("assert(removeCalls==0); assert(removePreferences.brushSize==25); assertOtherPreferences()");
        if (name !== "open-unrelated") sdk.run("assert(removePreferences.brushFeather==50)");
        sdk.run("assert(removePanelCalls==" + (name.endsWith("before") || name === "invalid-binding" ? 0 : 1) + ")");
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
async function verifyRepair(action, name, parameterName = "Opacity") {
    const parameter=typeof action === "number", fill=!parameter && !["refresh","delete"].includes(action), field=parameter?"selectedRepair"+parameterName:fill?"selectedRepairFill":"selectedRepair";
    const log=console.log;console.log=()=>{};commands.resetQueueForTests();
    const sdk=runtime();sdk.run(fs.readFileSync(path.join(__dirname,"remove-preferences.lua"),"utf8"));
    sdk.run(fs.readFileSync(path.join(__dirname,"remove-repair-fixture.lua"),"utf8"));
    if(fill) sdk.run("repairFillAllowed=true");
    if(parameter) {sdk.run("repairParameterAllowed=true");sdk.set("repairParameterName",parameterName);}
    const bridge=createBridge({httpPort:0,wsPort:0,httpHost:"127.0.0.1",wsHost:"127.0.0.1",shutdownGraceMs:20});
    await bridge.start(); const base="http://127.0.0.1:"+bridge.getHttpServer().address().port;
    const get=async(route,status=200)=>{const r=await fetch(base+route);assert.equal(r.status,status,name+" "+route);return r.json();};
    const resultPath=()=>{const u=new URL(sdk.result());return u.pathname+u.search;};
    try {
        context.updateContext({activeModule:"develop",selectedPhotoUuid:"creation-photo",developFingerprint:"repair-"+name});
        if(name==="last") sdk.run("removeSpots={removeSpots[1]}");
        if(name==="none") sdk.run("removeSpotIndex=nil");
        if(name==="fractional") sdk.run("removeSpots[1]."+parameterName+"=0.756");
        if(name==="parameter-missing") sdk.run("removeSpots[1]."+parameterName+"=nil");
        if(name==="irrelevant-genai") sdk.run('local sdk=import "LrDevelopController"; local extra=false; sdk.getSelectedSpotType=function() extra=not extra; return removeSpotType, removeSpotType=="heal_patchmatch" and removeSpotGenAI or extra end');
        if(name==="parameter-recovery") sdk.run('local sdk=import "LrDevelopController";local get=sdk.getSelectedSpotParams;local n=0;sdk.getSelectedSpotParams=function(feature) n=n+1;if n==2 then removeSpots[1].Feather=0.6 end;return get(feature) end');
        if(name==="nil-evidence") sdk.run('removeSpotIndex=nil; (import "LrDevelopController").getSelectedSpotParams=function() return removeSpots[1] end');
        if(name==="index-error" || name==="index-recovery") sdk.run('savedIndexGetter=(import "LrDevelopController").getSelectedSpotIndex; (import "LrDevelopController").getSelectedSpotIndex=function() error("index unavailable while application inactive") end');
        await get("/remove/state");const {request}=await get("/remove/next");
        sdk.set("queryJson",JSON.stringify({request}));sdk.run("removeQuery()");await get(resultPath());
        const before=await get("/remove/state");assert.equal(before.repair.available,!["index-error","index-recovery","parameter-recovery"].includes(name));
        const diagnostic=await get("/remove/diagnostics/selected-repair");assert.deepEqual(diagnostic.repair,before.repair);
        assert.equal(diagnostic.expectedReader,"healing-focus-1");
        assert.equal(diagnostic.repair.diagnostics.foreground,"not_observed");
        if(["none","nil-evidence","index-error","index-recovery","parameter-recovery"].includes(name)) {
            assert.equal(before.repair.count,2,"inventory count remains available independently of selected-index readback");
            assert.equal(before.repair.spotType,"heal","type evidence is not discarded on nil/error index");
            assert.equal(before.repair.diagnostics.getters.getAllSpots.ok,true);
            if(name.startsWith("index-") || name==="parameter-recovery") {
                assert.equal(before.repair.token,undefined,"failed readback never enables a cached repair target");
                if(name==="parameter-recovery") {
                    assert.match(before.repair.diagnostics.identityError,/Selection changed/);
                    assert.equal(Object.values(before.repair.diagnostics.getters).every(getter=>getter.ok),true,"unstable readback is separate from getter failure");
                } else assert.match(before.repair.diagnostics.getters.getSelectedSpotIndex.error,/index unavailable/);
            } else assert.equal(before.repair.selected,false);
            if(name!=="none") assert.equal(before.repair.diagnostics.parameterNumbers['/fixtureValue'],0.5);
            if(name==="index-recovery" || name==="parameter-recovery") {
                if(name==="index-recovery") sdk.run('(import "LrDevelopController").getSelectedSpotIndex=savedIndexGetter');
                await new Promise(resolve=>setTimeout(resolve,450));await get("/remove/state");
                const next=await get("/remove/next");sdk.set("queryJson",JSON.stringify(next));sdk.run("removeQuery()");await get(resultPath());
                const after=await get("/remove/state");if(name==="parameter-recovery") assert.equal(after.selectedRepairFeather,0.6);assert.equal(after.repair.available,true);assert.equal(after.repair.selected,true);
                assert.equal(after.repair.diagnostics.getters.getSelectedSpotIndex.ok,true,"readback recovers without a tool or selection action");
                sdk.run("assert(removeCalls==0 and removePanelCalls==0 and repairCalls==0)");
            }
            return;
        }
        assert.equal(before.repair.spotType,"heal");assert.match(before.repair.paramsDiagnostic,/fixtureValue/);
        const client=Object.fromEntries(["selectedPhotoUuid","contextCounter","developCounter","contextChangedAt","serverEpoch"].map(k=>[k,before[k]]));
        const route="/remove/repair?"+new URLSearchParams({...client,stateRevision:before.revision,mode:before.newSpotType,
            field,value:action,repairToken:before.repair.token});
        if(parameter) {
            assert.equal(before[field],name==="fractional"?0.756:name==="parameter-missing"?null:parameterName==="Opacity"?0.5:0.33);
            if(name==="parameter-missing") {await get(route,409);sdk.run("assert(repairCalls==0)");return;}
            await get(route.replace("value="+action,"value=1.1"),400);
        }
        const bad=new URL(base+route);bad.searchParams.set("repairToken","invalid");await get(bad.pathname+bad.search,409);
        const admitted=await get(route);assert.equal(admitted.repair.token,before.repair.token);
        assert.equal(admitted.pendingOperation.targetRepairToken,before.repair.token,"admission publishes the original repair target");await get(route,409);
        const command=commands.getNextCommand();assert.equal(command.command,parameter?"remove.repair.param.set":fill?"remove.repair.fill.set":"remove.repair.action");assert.equal(command.expectedValue,before.repair.token);
        assert.equal(commands.tryEnqueueCommand(command).accepted,false);assert.equal(commands.tryEnqueueBatch([command]).accepted,false);
        sdk.set("repairScenario",name);sdk.set("commandJson",JSON.stringify(command));sdk.run("removeExecute()");
        let result=resultPath();
        if(name==="missing-proof") result=result.replace("repairEditConfirmed=true","repairEditConfirmed=false");
        const forged=new URL(base+result);forged.searchParams.set("targetRepairToken","invalid");
        await get(forged.pathname+forged.search,409);await get(result);await get(result,409);
        const after=await get("/remove/state");
        const expected=name.endsWith("before")||["photo-after","selection-after"].includes(name)?"stale":["sdk-error","no-change","wrong-delete","other-repair","preference-after","wrong-genai","missing-proof","rounded-mismatch","other-parameter","nested-parameter","readback-replacement"].includes(name)?"failed":action==="refresh"?"requested":"confirmed";
        assert.equal(after.lastResult.outcome,expected,name+": "+after.lastResult.detail);
        assert.equal(after.lastResult.targetRepairToken,before.repair.token);
        sdk.run("assert(removeCalls==0 and removePanelCalls==0)");
        if(name!=="preference-after") sdk.run("assertOtherPreferences()");
        if(name.endsWith("before")) sdk.run("assert(repairCalls==0)");else sdk.run("assert(repairCalls==1)");
        if(expected==="confirmed") {
            assert.equal(after.repair.count,before.repair.count-(fill||parameter?0:1));assert.equal(after.repair.selected,fill||parameter);
            if(parameter) {assert.equal(after[field],action);assert.equal(after.repair.index,before.repair.index);assert.equal(after.newSpotType,before.newSpotType);sdk.run("assert(removeSpots[1]."+(parameterName==="Opacity"?"Feather==0.33":"Opacity==0.5")+" and removeSpots[1].Masks[1].Flow==1)");}
            if(fill) {assert.equal(after.selectedRepairFill,action);assert.equal(after.repair.index,before.repair.index);assert.equal(after.newSpotType,before.newSpotType);}
        }
    } finally {sdk.close();await bridge.stop();commands.resetQueueForTests();console.log=log;}
}
function verifyStateLifecycle() {
    let clock = 1000;
    const ctx = { activeModule: "develop", selectedPhotoUuid: "one", contextCounter: 1, developCounter: 1, contextChangedAt: 1 };
    const preferences = { available: true, selectedTool: "dust", newSpotType: "heal", brushSize: 25, brushFeather: 50, useGenerativeAI: false,
        detectObjects: false, toolOverlay: "auto", visualizeSpots: false, visualizationThreshold: 20 };
    const state = definition.createRemoveState({ now: () => clock, getContext: () => ({ ...ctx }), serverEpoch: "test-epoch" });
    state.get(true); const oldQuery = state.takeRequest();
    ctx.selectedPhotoUuid = "two"; ctx.contextCounter++;
    assert.equal(state.acceptQuery({ ...oldQuery, ...preferences }), false, "old-photo query cannot populate current preferences");
    state.get(true); const currentQuery = state.takeRequest();
    assert.equal(state.acceptQuery({ ...currentQuery, ...preferences, expectedServerEpoch: "old-epoch" }), false);
    assert.equal(state.acceptQuery({ ...currentQuery, ...preferences }), true);
    const original = state.get(false);
    assert.equal(original.ageMs, 0);
    clock += 600; assert.equal(state.get(false).ageMs, 600, "server reports freshness without requiring synchronized browser clocks");
    state.get(true); const repeatedQuery = state.takeRequest();
    assert.equal(state.acceptQuery({ ...repeatedQuery, ...preferences }), true);
    assert.equal(state.get(false).revision, original.revision, "unchanged native reads retain semantic revision");
    assert.ok(state.get(false).capturedAt > original.capturedAt, "unchanged reads renew freshness");
    clock += 600; state.get(true); const changedQuery = state.takeRequest();
    assert.equal(state.acceptQuery({ ...changedQuery, ...preferences, newSpotType: "clone", brushFeather: 60 }), true);
    const client = s => ({ ...s, stateRevision: s.revision, mode: s.newSpotType });
    assert.equal(state.admit("brushSize", 40, client(original)), null, "native mode/value refresh invalidates old admission");
    const command = state.admit("brushSize", 40, client(state.get(false)));
    assert.ok(command); assert.equal(state.matches(command, "admit"), true); assert.equal(state.matches(command, "dequeue"), true);
    clock += 10001;
    assert.equal(state.validateBinding(command), false, "expired operation loses write ownership");
    assert.equal(state.get(false).lastResult.outcome, "failed");
    assert.equal(state.acceptResult({ ...command, ...preferences, outcome: "confirmed", otherPreferencesPreserved: true }), false,
        "late confirmation cannot revive an expired operation");
}
async function verify() {
    verifyStateLifecycle();
    await verifyModeReplacement(false); await verifyModeReplacement(true);
    let count = 2;
    for(const parameterName of ["Opacity","Feather"]) {
    for(const value of [0,parameterName==="Opacity"?0.75:0.6,1]) {await verifyRepair(value,"ordinary",parameterName);count++;}
    for(const name of ["fractional","parameter-missing","selection-before","inventory-before","type-before","photo-before","photo-after","selection-after","sdk-error","no-change","other-repair","preference-after","missing-proof","rounded-mismatch","other-parameter","nested-parameter","readback-replacement"]) {await verifyRepair(parameterName==="Opacity"?0.75:0.6,name,parameterName);count++;}
    }
    for(const name of ["ordinary","last","none","nil-evidence","index-error","index-recovery","parameter-recovery","selection-before","inventory-before","type-before","photo-before","photo-after","sdk-error","no-change","wrong-delete"]) {await verifyRepair("delete",name);count++;}
    for(const name of ["ordinary","selection-before","sdk-error"]) {await verifyRepair("refresh",name);count++;}
    for(const choice of ["remove","heal","clone","generative_remove"]) {await verifyRepair(choice,"ordinary");count++;}
    await verifyRepair("clone","irrelevant-genai");count++;
    for(const name of ["selection-before","inventory-before","type-before","photo-before","photo-after","selection-after","sdk-error","no-change","other-repair","preference-after","wrong-genai","missing-proof"]) {
        await verifyRepair("generative_remove",name);count++;
    }
    for (const tool of ["dust", "loupe", "crop", "masking"]) { await verifyPanel("ordinary", tool); count++; }
    for (const name of ["wrong-mode", "getter-error", "open-unrelated", "setter-error", "no-change"]) { await verifyPanel(name, "loupe"); count++; }
    for (const name of ["cancel-queued", "cancel-dispatched", "queue-photo", "tool-before", "photo-before", "module-before",
        "tool-after", "photo-after", "invalid-binding", "setter-error", "no-change", "forged-state"]) { await verifyPanel(name); count++; }
    for (const field of ["brushSize", "brushFeather", "visualizationThreshold"]) { await scenario("heal", field, "fractional-native", 42); count++; }
    for (const mode of ["heal_patchmatch", "heal", "clone"]) for (const field of ["brushSize", "brushFeather"]) { await scenario(mode, field, "ordinary"); count++; }
    for (const mode of ["heal_patchmatch", "heal", "clone"]) {
        for (const [field, value] of [["useGenerativeAI", false], ["detectObjects", true], ["visualizeSpots", false],
            ["visualizationThreshold", 62.5], ["newSpotType", mode === "clone" ? "heal_patchmatch" : "clone"]]) {
            await scenario(mode, field, "ordinary", value); count++;
        }
        for (const overlay of ["always", "auto", "selected", "never"]) { await scenario(mode, "toolOverlay", "ordinary", overlay); count++; }
    }
    for (const [field, value] of Object.entries(require("../app/controller-remove").defaults)) {
        await scenario("heal", field, "ordinary", value); count++;
    }
    for (const name of ["rounded-mismatch", "mode-before", "photo-before", "module-before", "tool-before", "value-before", "invalid-binding",
        "mode-after", "photo-after", "tool-after", "unrelated-after", "future-after", "shared-future-after", "setter-false", "setter-error", "no-change",
        "read-getter-error", "read-getter-nil", "read-malformed", "read-closed", "queue-photo", "queue-module", "queue-develop", "forged-result"]) {
        await scenario("heal", "brushSize", name); count++;
    }
    console.log("Remove brush preferences: " + count + " HTTP/queue/Parser/Commands/Lua scenarios plus query/revision/expiry lifecycle passed (mock SDK).");
}
module.exports = { verify };
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
