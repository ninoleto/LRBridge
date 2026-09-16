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
async function verifyReflections(field, value, name) {
    const log = console.log; console.log = () => {};
    commands.resetQueueForTests();
    const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
    sdk.run("takeResultUrl=takeReflectionsResultUrl");
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (route, status = 200) => { const response = await fetch(base + route); assert.equal(response.status, status, name + " " + route); return response.json(); };
    const result = () => { const url = new URL(sdk.result()); return { route: url.pathname + url.search, phase: url.searchParams.get("outcome"), callback: url.searchParams.get("callbackCompleted") }; };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: "reflections-" + name + field + value });
        if (name.startsWith("apply-off")) sdk.run("reflectionState.checkboxState=true");
        if (["unsupported", "disabled", "malformed"].includes(name)) sdk.run(name === "unsupported" ? "reflectionState.isSupported=false" : name === "disabled" ? "reflectionState.enabled=false" : 'reflectionState.amount="bad"');
        if (name.startsWith("read-")) sdk.set("reflectionScenario", name);
        await get("/reflections/state"); const query = await get("/reflections/next");
        sdk.set("queryJson", JSON.stringify(query)); sdk.run("reflectionsQuery()"); await get(result().route);
        const before = await get("/reflections/state"); sdk.run("assert(reflectionCalls==0)");
        const binding = Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(k => [k, before[k]]));
        const route = "/reflections/set?" + new URLSearchParams({ ...binding, stateRevision: before.revision, field, value });
        await get(route + "&field=amount", 400);
        if (["unsupported", "disabled", "malformed", "read-error", "read-nil"].includes(name)) { await get(route, 409); return; }
        assert.equal(before.amount, 37.4, "native fractional baseline is retained");
        const admitted = await get(route); assert.equal(admitted.pendingOperation.phase, "queued"); await get(route, 409);
        if (name === "queue-photo" || name === "queue-develop") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: name === "queue-photo" ? "other-photo" : "creation-photo", developFingerprint: "new-context" });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(reflectionCalls==0)"); return;
        }
        const command = commands.getNextCommand(); assert.equal(command.command, "reflections.set");
        assert.equal(commands.tryEnqueueCommand(command).accepted, false); assert.equal(commands.tryEnqueueBatch([command]).accepted, false);
        assert.equal(commands.validateCommand({ ...command, value: "invented" }), false);
        sdk.set("commandJson", JSON.stringify(command)); sdk.set("reflectionScenario", name); sdk.run("reflectionsExecute()");
        let event = result(), callbackWaiting = false, nativeBeforeCallback = false;
        while (event.phase === "requested") {
            await get(event.route); const progress = await get("/reflections/state");
            assert.ok(progress.pendingOperation, "neither request delivery nor callback alone settles an operation");
            callbackWaiting ||= event.callback === "true"; nativeBeforeCallback ||= event.callback === "false" && progress[field] === value;
            if (["async-task", "photo-task"].includes(name)) {
                sdk.run("assert(reflectionCalls==1 and reflectionTask~=nil); runReflectionsTask()");
            }
            event = result();
        }
        if (name === "forged-callback") await get(event.route.replace("callbackCompleted=true", "callbackCompleted=false"), 409);
        await get(event.route); await get(event.route, 409);
        const after = await get("/reflections/state");
        const stale = ["photo-before", "module-before", "settings-before", "disabled-before", "invalid-binding", "photo-after", "photo-callback", "photo-task"].includes(name);
        const failed = ["sdk-error", "no-change", "other-setting", "no-callback", "apply-off-no-callback"].includes(name);
        assert.equal(after.lastResult.outcome, stale ? "stale" : failed ? "failed" : "confirmed", name + ": " + after.lastResult.detail);
        if (name === "apply-off-no-callback") {
            assert.match(after.lastResult.detail, /Apply=off, Amount=37\.4, Quality=standard, panel enabled=false, supported=true; SDK callback not received/,
                "Apply-off timeout preserves the exact final SDK state and callback condition for manual diagnosis");
        }
        if (!stale && !failed) {
            assert.equal(after[field], value);
            for (const other of ["checkboxState", "amount", "quality"].filter(k => k !== field)) assert.equal(after[other], before[other]);
        }
        if (name === "delayed-callback") assert.ok(nativeBeforeCallback, "native target alone must await the SDK callback");
        if (name === "delayed-readback" && field !== "amount") assert.ok(callbackWaiting, "callback alone must await actual native readback");
        const calls = stale && !["photo-after", "photo-callback", "photo-task"].includes(name) || name === "desired-before" ? 0 : 1;
        sdk.run("assert(reflectionCalls==" + calls + "); assert(removeCalls==0 and removePanelCalls==0); assertOtherPreferences()");
        sdk.run("lateReflectionCallback(); assert(#reflectionResults==0)");
        sdk.run("reflectionsExecute(); assert(reflectionCalls==" + calls + ")");
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
function verifyReflectionsTimeout() {
    const definition = require("../server/reflections-state"); let time = 1000;
    const ctx = { activeModule: "develop", selectedPhotoUuid: "test-photo", contextCounter: 1, developCounter: 1, contextChangedAt: 1 };
    const state = definition.createReflectionsState({ now: () => time, getContext: () => ctx });
    state.get(true); const q = state.takeRequest();
    const snapshot = { available: true, checkboxState: false, amount: 17, quality: "best", enabled: true, isSupported: true };
    assert.equal(state.acceptQuery({ ...q, ...snapshot }), true);
    const before = state.get(false); const c = state.admit("checkboxState", true, { ...before, stateRevision: before.revision });
    assert.ok(state.matches(c, "admit")); assert.ok(state.matches(c, "dequeue"));
    time += 120001; assert.equal(state.get(true).pendingOperation, null); assert.equal(state.get(false).available, false);
    assert.equal(state.acceptResult({ ...c, ...snapshot, outcome: "confirmed", callbackCompleted: true, invoked: true, preserved: true }), false, "late callback cannot revive expired operation");
    const fresh = state.takeRequest(); assert.equal(state.acceptQuery({ ...fresh, ...snapshot }), true);
    const recovered = state.get(false); assert.ok(state.admit("checkboxState", true, { ...recovered, stateRevision: recovered.revision }), "fresh native readback permits a new explicit request after timeout");
}
const peopleDiagnosticCases = {
    "reflections-nil": { setup: 'sdk.getReflectionRemovalPanelState=function() return nil end', detail: /getReflectionRemovalPanelState expected table; got nil:nil/ },
    "reflections-throw": { setup: 'sdk.getReflectionRemovalPanelState=function() error("cold getter exception") end', detail: /getReflectionRemovalPanelState:.*cold getter exception/ },
    "reflections-checkbox": { setup: 'reflectionState.checkboxState=nil', detail: /getReflectionRemovalPanelState.checkboxState expected boolean; got nil:nil/ },
    "reflections-amount": { setup: 'reflectionState.amount=nil', detail: /getReflectionRemovalPanelState.amount expected number; got nil:nil/ },
    "reflections-quality": { setup: 'reflectionState.quality=false', detail: /getReflectionRemovalPanelState.quality expected string; got boolean:false/ },
    "reflections-supported": { setup: 'reflectionState.isSupported="false"', detail: /getReflectionRemovalPanelState.isSupported expected boolean; got string:false/ },
    "preferences-nil": { setup: 'sdk.getRemovePanelPreferences=function() return nil end', detail: /getRemovePanelPreferences expected table; got nil:nil/ },
    "preferences-throw": { setup: 'sdk.getRemovePanelPreferences=function() error("inactive preferences") end', detail: /getRemovePanelPreferences:.*inactive preferences/ },
    "manual-nil": { setup: 'local original=sdk.getAllSpots; sdk.getAllSpots=function(f) if f=="manualRemove" then return nil end return original(f) end', detail: /getAllSpots\(manualRemove\) expected table; got nil:nil/ },
    "manual-throw": { setup: 'local original=sdk.getAllSpots; sdk.getAllSpots=function(f) if f=="manualRemove" then error("manual getter exception") end return original(f) end', detail: /getAllSpots\(manualRemove\):.*manual getter exception/ },
    "manual-token": { setup: 'manualPeopleSpots={{unknown=function() end}}', detail: /getAllSpots\(manualRemove\).token:.*Unsupported People inventory value/ },
    "people-nil": { setup: 'local original=sdk.getAllSpots; sdk.getAllSpots=function(f) if f=="distractingPeopleRemoval" then return nil end return original(f) end', detail: /getAllSpots\(People\) expected table; got nil:nil/ },
    "people-throw": { setup: 'sdk.getAllSpots=function() error("People inventory exception") end', detail: /getAllSpots\(People\):.*People inventory exception/ },
    "selected-token": { setup: 'sdk.getSelectedSpotParams=function() return {unknown=function() end} end', detail: /getSelectedSpotParams\(People\).token:.*Unsupported People inventory value: function/ },
    "final-reflections-nil": { setup: 'local original=sdk.getReflectionRemovalPanelState; sdk.getReflectionRemovalPanelState=function() if peopleValidations==2 then return nil end return original() end', detail: /final: Preservation read unavailable:.*getReflectionRemovalPanelState expected table; got nil:nil/ },
    "people-count": { setup: 'sdk.countAllSpots=function() return "0" end', detail: /countAllSpots\(People\) expected number; got string:0/ },
    "count-mismatch": { setup: 'peopleSpots={}', detail: /People count expected number:2; got number:0/ },
    "token-mismatch": { setup: 'peopleSpots[1].id="changed"', detail: /People inventory token mismatch; expected=.*; got=/ },
    "tool-mismatch": { setup: 'removeTool="crop"', detail: /toolOpen expected boolean:true; got boolean:false/ },
    "binding": { setup: 'peopleScenario="invalid-binding"', detail: /Initial server operation binding validation rejected/ },
    "reflections-off": { setup: 'reflectionState.checkboxState=false; reflectionState.enabled=false; reflectionState.isSupported=false', succeeds: true },
    "log-open-error": { setup: 'io.open=function() error("log unavailable") end', succeeds: true, noTrace: true },
    "log-write-error": { setup: 'io.open=function() return {write=function() error("disk full") end,close=function() end} end', succeeds: true, noTrace: true }
};
async function verifyPeopleAction(operationKind, name, diagnosticName, inventoryCase) {
    const diagnosticCase = diagnosticName && peopleDiagnosticCases[diagnosticName];
    const log = console.log; console.log = () => {}; commands.resetQueueForTests();
    const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
    sdk.run("takeResultUrl=takePeopleResultUrl; peoplePanelAllowed=true");
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async (route, status = 200) => { const response = await fetch(base + route); assert.equal(response.status, status, name + " " + route); return response.json(); };
    const result = () => { const url = new URL(sdk.result()); return { route: url.pathname + url.search,
        outcome: url.searchParams.get("outcome"), callback: url.searchParams.get("callbackCompleted"),
        inventoryChanged: url.searchParams.get("inventoryChanged") }; };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: "people-" + operationKind + "-" + name });
        sdk.set("peopleScenario", name);
        sdk.run((operationKind === "open" ? 'removeTool="loupe";' : 'removeTool="dust";') +
            ' peopleSpots={{id="person-a"},{id="person-b"}}; peopleSelectedIndex=1');
        if (inventoryCase) sdk.run("installPeopleInventoryRegression()");
        if (inventoryCase && inventoryCase.count === 1) sdk.run("table.remove(peopleSpots,2)");
        if (name === "unsupported") sdk.run(operationKind === "detect" ?
            '(import "LrDevelopController").detectDistractingPeople=nil' :
            '(import "LrDevelopController").applyRemovalOnDetectedDistractingPeople=nil');
        if (name === "query-inventory-nil") sdk.run('(import "LrDevelopController").getAllSpots=function() return nil end');
        await get("/people/state"); const query = await get("/people/next");
        sdk.set("queryJson", JSON.stringify(query)); sdk.run("peopleQuery()"); await get(result().route);
        let before = await get("/people/state");
        if (name === "query-inventory-nil") {
            assert.equal(before.available, false);
            assert.match(before.reason, /getAllSpots\(People\) expected table; got nil:nil/);
            const queryBinding = Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(key => [key, before[key]]));
            const rejected = await get("/people/action?" + new URLSearchParams({ ...queryBinding, stateRevision: before.revision, operationKind }), 409);
            assert.equal(rejected.error, before.reason, "uninitialized inventory currently blocks even Open, with an actionable reason");
            sdk.run("assert(peoplePanelCalls==0 and peopleDetectCalls==0 and peopleRemoveCalls==0)");
            return;
        }
        const expectedCount = inventoryCase && inventoryCase.count || 2;
        assert.equal(before.available, true); assert.equal(before.count, expectedCount); assert.match(before.inventoryToken, /^[0-9a-f]{64}$/);
        assert.equal(before.selectionReadable, operationKind !== "open", "selection getters are only used while Remove is open");
        const binding = Object.fromEntries(["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch"].map(key => [key, before[key]]));
        const route = "/people/action?" + new URLSearchParams({ ...binding, stateRevision: before.revision, operationKind });
        for (const unsupported of ["return", "close", "cancel"]) await get("/people/action?" +
            new URLSearchParams({ ...binding, stateRevision: before.revision, operationKind: unsupported }), 400);
        await get(route + "&operationKind=detect", 400);
        if (name === "unsupported") {
            const rejected = await get(route, 409); assert.match(rejected.error, /unavailable in this Lightroom SDK/);
            const diagnostic = await get("/diagnostics/people");
            assert.ok(diagnostic.events.some(event => event.stage === "action_received" && event.operationKind === operationKind));
            assert.ok(diagnostic.events.some(event => event.stage === "admission_rejected" && event.operationKind === operationKind));
            sdk.run("assert(peopleDetectCalls==0 and peopleRemoveCalls==0)"); return;
        }
        const admitted = await get(route); assert.equal(admitted.pendingOperation.operationKind, operationKind); await get(route, 409);
        if (name === "queue-photo") {
            context.updateContext({ activeModule: "develop", selectedPhotoUuid: "other-photo", developFingerprint: "people-queue-photo" });
            assert.equal(commands.getNextCommand(), null); sdk.run("assert(peoplePanelCalls==0 and peopleDetectCalls==0 and peopleRemoveCalls==0)"); return;
        }
        const command = commands.getNextCommand(); assert.equal(command.command, "people.action"); assert.equal(command.operationKind, operationKind);
        assert.equal(command.expectedPeopleCount, expectedCount); assert.equal(command.expectedPeopleInventoryToken, before.inventoryToken);
        assert.equal(commands.tryEnqueueCommand(command).accepted, false); assert.equal(commands.tryEnqueueBatch([command]).accepted, false);
        assert.equal(commands.validateCommand({ ...command, operationKind: "invented" }), false);
        for (const unsupported of ["return", "close", "cancel"]) {
            assert.equal(commands.validateCommand({ ...command, operationKind: unsupported }), false);
        }
        if (diagnosticCase) sdk.run('capturePeopleTrace(); local sdk=import "LrDevelopController"; ' + diagnosticCase.setup);
        if (inventoryCase) sdk.run("peopleInventoryChangePhase=" + inventoryCase.phase +
            "; peopleInventoryChange=function(spots) " + inventoryCase.change + " end; " + (inventoryCase.setup || ""));
        sdk.set("commandJson", JSON.stringify(command)); sdk.run("peopleExecute()");
        let event = result();
        while (event.outcome === "requested" && operationKind === "remove") {
            await get(event.route); const progress = await get("/people/state");
            assert.ok(progress.pendingOperation, "People removal delivery does not settle before its callback result");
            if (["delayed-task", "photo-task"].includes(name)) sdk.run("runPeopleTask()");
            event = result();
        }
        await get(event.route); await get(event.route, 409);
        const after = await get("/people/state");
        if (inventoryCase) {
            assert.equal(after.lastResult.outcome, inventoryCase.outcome, inventoryCase.label + ": " + after.lastResult.detail);
            const invoked = inventoryCase.outcome !== "stale";
            assert.equal(after.lastResult.invoked, invoked, inventoryCase.label);
            if (inventoryCase.outcome === "confirmed") {
                assert.equal(after.inventoryToken, before.inventoryToken, "snapshot and execution share the stable inventory comparison");
                assert.notEqual(after.selectedToken, before.selectedToken, "selected-spot tokens still include raw IDs");
                assert.equal(after.lastResult.inventoryChanged, false, "ID regeneration alone is not removal evidence");
                assert.match(after.lastResult.detail, /inventory was unchanged.*unconfirmed/);
                sdk.run("assert(peopleInventoryReads>=4 and peopleValidations>=3 and peopleRemoveCalls==1)");
            } else {
                const diagnostics = await get("/diagnostics/people");
                assert.match(diagnostics.lastResult.detail, inventoryCase.reason, inventoryCase.label);
                sdk.run("assert(peopleRemoveCalls==" + (invoked ? 1 : 0) + ")");
            }
            sdk.run("peopleExecute(); assert(peopleRemoveCalls==" + (invoked ? 1 : 0) +
                "); peopleResults={}; latePeopleCallback(); assert(#peopleResults==0)");
            assert.equal(commands.getNextCommand(), null, "no automatic removal retry");
            return;
        }
        if (diagnosticCase) {
            const diagnostics = await get("/diagnostics/people");
            assert.equal(after.lastResult.outcome, diagnosticCase.succeeds ? "requested" : "stale", diagnosticName);
            assert.equal(after.lastResult.invoked, Boolean(diagnosticCase.succeeds), diagnosticName);
            if (diagnosticCase.detail) assert.match(diagnostics.lastResult.detail, diagnosticCase.detail, diagnosticName);
            assert.doesNotMatch(after.lastResult.detail, /[0-9a-f]{64}/, "raw inventory hashes belong only in diagnostics");
            sdk.run('assert(reflectionCalls==0 and removeCalls==0, "diagnostics must never initialize Reflections or preferences")');
            sdk.run('assert(peopleDetectCalls==' + (diagnosticCase.succeeds ? 1 : 0) + ' and peopleRemoveCalls==0)');
            if (!diagnosticCase.noTrace) {
                sdk.set("diagnosticEpoch", command.expectedServerEpoch); sdk.set("diagnosticOperation", command.operationId);
                sdk.run('assert(#peopleTrace>0 and #peopleTrace<64); for _,line in ipairs(peopleTrace) do ' +
                    'assert(#line<550 and string.find(line,"epoch="..diagnosticEpoch,1,true) and string.find(line,"operation="..diagnosticOperation,1,true)) end');
                if (diagnosticName === "reflections-off") sdk.run('local trace=table.concat(peopleTrace); ' +
                    'for _,field in ipairs({"checkboxState","enabled","isSupported"}) do assert(string.find(trace,field.."=boolean:false",1,true)) end');
            }
            assert.equal(diagnostics.serverEpoch, command.expectedServerEpoch);
            assert.ok(diagnostics.events.some(event => event.operationId === command.operationId && event.stage === "finished" &&
                event.reason === diagnostics.lastResult.detail), "precise Lua rejection reaches existing diagnostics");
            if (diagnosticName === "token-mismatch") sdk.run('local trace=table.concat(peopleTrace); ' +
                'assert(string.find(trace,"spots[number:1][string:id] before=string:person-a after=string:changed",1,true)); ' +
                'assert(string.find(trace,"source=pq-",1,true))');
            return;
        }
        if (operationKind === "remove" && name === "ordinary") {
            const diagnostic = await get("/diagnostics/people"), stages = diagnostic.events.map(event => event.stage);
            for (const stage of ["action_received", "admitted", "queue_admitted", "dequeued", "result_accepted", "finished", "result_rejected"])
                assert.ok(stages.includes(stage), "People diagnostics record " + stage);
            assert.equal(diagnostic.lastResult.operationId, after.lastResult.operationId);
        }
        const stale = ["photo-before", "photo-after", "photo-task"].includes(name) || name === "inventory-before" && operationKind === "remove";
        const failed = ["sdk-error", "no-callback", "manual-change", "preference-change", "reflection-change"].includes(name);
        assert.equal(after.lastResult.outcome, stale ? "stale" : failed ? "failed" : operationKind === "remove" ? "confirmed" : "requested",
            name + ": " + after.lastResult.detail);
        if (operationKind === "detect") {
            if (!stale) assert.match(after.lastResult.detail, /readiness is not exposed/);
            sdk.run("assert(peopleDetectCalls==" + (stale ? 0 : 1) + " and peopleRemoveCalls==0 and peoplePanelCalls==0)");
        } else if (operationKind === "open") {
            sdk.run("assert(peoplePanelCalls==" + (stale ? 0 : 1) + " and peopleDetectCalls==0 and peopleRemoveCalls==0)");
            if (name === "navigation-detection") assert.equal(after.lastResult.inventoryChanged, true,
                "navigation-observed inventory change is evidence only and does not cause a second detection request");
        } else {
            if (!stale && name !== "sdk-error") sdk.run("assert(peopleRemoveCalls==1)");
            if (!stale && !failed) assert.equal(after.lastResult.callbackCompleted, true);
            if (name === "removal-unchanged") { assert.equal(after.lastResult.inventoryChanged, false); assert.match(after.lastResult.detail, /inventory was unchanged/); }
            sdk.run("latePeopleCallback(); assert(#peopleResults==0)");
        }
        sdk.run("peopleExecute(); assert(peoplePanelCalls<2 and peopleDetectCalls<2 and peopleRemoveCalls<2)");
        if (operationKind === "open" && name === "ordinary") for (const unsupported of ["return", "close", "cancel"]) {
            sdk.set("commandJson", JSON.stringify({ ...command, operationKind: unsupported })); sdk.run("peopleExecute()");
            const rejected = result(); assert.equal(rejected.outcome, "stale");
            assert.match(new URLSearchParams(rejected.route.split("?")[1]).get("detail"), /Unsupported People operation kind/);
            sdk.run("assert(peoplePanelCalls==1 and peopleDetectCalls==0 and peopleRemoveCalls==0)");
        }
    } finally { sdk.close(); await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
}
function verifyPeopleTimeout() {
    const definition = require("../server/people-state"); let time = 1000;
    const contextFields = { activeModule: "develop", selectedPhotoUuid: "people-photo", contextCounter: 1, developCounter: 1, contextChangedAt: 1 };
    const state = definition.createPeopleState({ now: () => time, getContext: () => contextFields, serverEpoch: "people-test" });
    const snapshot = { available: true, toolOpen: true, count: 1, inventoryToken: "a".repeat(64), selectionReadable: false,
        selectedIndex: null, selectedToken: null, navigationSupported: true, detectSupported: true, removeSupported: true };
    state.get(true); const query = state.takeRequest(); assert.equal(state.acceptQuery({ ...query, ...snapshot }), true);
    const before = state.get(false); const command = state.admit("remove", { ...before, stateRevision: before.revision });
    assert.ok(state.matches(command, "admit")); assert.ok(state.matches(command, "dequeue"));
    assert.equal(state.acceptResult({ ...command, ...snapshot, outcome: "requested", detail: "Delivered.", callbackCompleted: false,
        invoked: true, inventoryChanged: false, manualRepairsPreserved: true, removePreferencesPreserved: true, reflectionsPreserved: true }), true);
    time += 120001; assert.equal(state.get(true).pendingOperation, null); assert.equal(state.get(false).available, false);
    assert.equal(state.acceptResult({ ...command, ...snapshot, outcome: "confirmed", detail: "Late.", callbackCompleted: true,
        invoked: true, inventoryChanged: true, manualRepairsPreserved: true, removePreferencesPreserved: true, reflectionsPreserved: true }), false,
    "late People callbacks cannot revive expired operations");
    const fresh = state.takeRequest(); assert.ok(fresh); assert.equal(state.acceptQuery({ ...fresh, ...snapshot }), true);
    const recovered = state.get(false); assert.ok(state.admit("detect", { ...recovered, stateRevision: recovered.revision }),
        "fresh authoritative People state replaces timeout state and permits a new explicit action");
}
function verifyPeopleWorkflowState() {
    let time = 5000;
    const contextFields = { activeModule: "develop", selectedPhotoUuid: "people-workflow-photo", contextCounter: 3,
        developCounter: 4, contextChangedAt: 2 };
    const state = require("../server/people-state").createPeopleState({ now: () => time, getContext: () => contextFields,
        serverEpoch: "people-workflow-test" });
    const closed = { available: true, toolOpen: false, count: 1, inventoryToken: "b".repeat(64), selectionReadable: false,
        selectedIndex: null, selectedToken: null, navigationSupported: true, detectSupported: true, removeSupported: true };
    state.get(true); let query = state.takeRequest(); assert.ok(state.acceptQuery({ ...query, ...closed }));
    let before = state.get(false), command = state.admit("open", { ...before, stateRevision: before.revision });
    assert.ok(state.matches(command, "admit")); assert.ok(state.matches(command, "dequeue"));
    const opened = { ...closed, toolOpen: true };
    assert.ok(state.acceptResult({ ...command, ...opened, outcome: "requested", detail: "Opened.", callbackCompleted: false,
        invoked: true, inventoryChanged: false, manualRepairsPreserved: true, removePreferencesPreserved: true, reflectionsPreserved: true }));
    assert.equal(state.get(false).controllerWorkflowOpen, true);
    time += 500; state.get(true); query = state.takeRequest(); assert.ok(state.acceptQuery({ ...query, ...closed }));
    assert.equal(state.get(false).controllerWorkflowOpen, false, "native tool close clears obsolete Controller People workflow state");
    assert.ok(state.diagnostics().events.some(event => event.stage === "workflow_cleared"));
}
function verifyPeopleRefresh() {
    let time = 5000;
    const contextFields = { activeModule: "develop", selectedPhotoUuid: "people-refresh-photo", contextCounter: 1,
        developCounter: 1, contextChangedAt: 1 };
    const state = require("../server/people-state").createPeopleState({ now: () => time, getContext: () => contextFields, serverEpoch: "refresh-test" });
    const empty = { available: true, toolOpen: true, count: 0, inventoryToken: "a".repeat(64), selectionReadable: false,
        selectedIndex: null, selectedToken: null, navigationSupported: true, detectSupported: true, removeSupported: true };
    function read(snapshot) {
        time += 500; state.get(true); const query = state.takeRequest(); assert.ok(query);
        assert.ok(state.acceptQuery({ ...query, ...snapshot })); return query;
    }
    function admit(kind) {
        const before = state.get(false), command = state.admit(kind, { ...before, stateRevision: before.revision });
        assert.ok(command); assert.ok(state.matches(command, "admit")); assert.ok(state.matches(command, "dequeue")); return command;
    }
    read(empty); assert.equal(state.get(false).removalAvailable, false, "empty inventory never enables removal");
    const detect = admit("detect");
    assert.ok(state.acceptResult({ ...detect, ...empty, outcome: "requested", detail: "Detection sent.", invoked: true,
        callbackCompleted: false, inventoryChanged: false, manualRepairsPreserved: true, removePreferencesPreserved: true, reflectionsPreserved: true }));
    assert.equal(state.get(false).removalAvailable, false, "SDK return with immediate empty inventory is not detection readiness");
    const denied = state.get(false);
    assert.equal(state.admit("remove", { ...denied, stateRevision: denied.revision }), null);
    const freshQuery = state.takeRequest(); assert.ok(freshQuery, "rejection requests a new native snapshot");
    assert.ok(state.acceptQuery({ ...freshQuery, ...empty }));
    assert.equal(state.get(false).removalAvailable, false);
    const targets = { ...empty, count: 4, inventoryToken: "b".repeat(64) };
    const targetQuery = read(targets);
    assert.equal(state.get(false).removalAvailable, true, "fresh nonempty detection inventory reaches Controller state before removal");
    const remove = admit("remove");
    const changed = { ...targets, inventoryToken: "c".repeat(64) };
    assert.ok(state.acceptResult({ ...remove, ...changed, outcome: "stale", invoked: false, callbackCompleted: false,
        inventoryChanged: false, manualRepairsPreserved: false, removePreferencesPreserved: false, reflectionsPreserved: false,
        detail: "before: People inventory token mismatch; expected=" + targets.inventoryToken + "; got=" + changed.inventoryToken }));
    assert.equal(state.get(false).removalAvailable, false, "a changed target cannot be removed until new readback");
    assert.match(state.get(false).lastResult.detail, /People detections changed/);
    assert.doesNotMatch(state.get(false).lastResult.detail, /[0-9a-f]{64}/);
    const admission = state.diagnostics().events.find(event => event.stage === "admitted" && event.operationId === remove.operationId);
    assert.equal(admission.snapshotSource, targetQuery.requestId);
    assert.equal(admission.expectedPeopleInventoryToken, targets.inventoryToken);
    assert.match(state.diagnostics().lastResult.detail, new RegExp(changed.inventoryToken));
    read(changed); assert.equal(state.get(false).removalAvailable, true);
    assert.equal(state.get(false).pendingOperation, null, "readback never retries the rejected removal");
}
async function verify({ peopleOnly = false } = {}) {
    verifyPeopleRefresh();
    verifyPeopleTimeout();
    verifyPeopleWorkflowState();
    await verifyPeopleAction("open", "ordinary");
    await verifyPeopleAction("open", "navigation-detection");
    await verifyPeopleAction("open", "queue-photo");
    await verifyPeopleAction("open", "query-inventory-nil");
    await verifyPeopleAction("detect", "ordinary");
    await verifyPeopleAction("detect", "detection-change");
    await verifyPeopleAction("detect", "unsupported");
    await verifyPeopleAction("detect", "inventory-before");
    for (const name of ["ordinary", "removal-unchanged", "delayed-callback", "delayed-task", "no-callback", "manual-change",
        "preference-change", "reflection-change", "sdk-error", "photo-after", "photo-task", "unsupported", "queue-photo"]) await verifyPeopleAction("remove", name);
    for (const name of Object.keys(peopleDiagnosticCases)) await verifyPeopleAction(
        ["count-mismatch", "token-mismatch"].includes(name) ? "remove" : "detect", "ordinary", name);
    for (const kind of ["open", "remove"]) await verifyPeopleAction(kind, "ordinary", "reflections-nil");
    await verifyPeopleAction("remove", "inventory-before");
    await verifyPeopleAction("remove", "removal-unchanged", null,
        { label: "regenerated IDs only", change: "", phase: 1, outcome: "confirmed" });
    await verifyPeopleAction("remove", "removal-unchanged", null,
        { label: "one target with regenerated IDs (pp-594)", count: 1, change: "", phase: 1, outcome: "confirmed" });
    for (const phase of [1, 2]) {
        const prefix = phase === 1 ? "before" : "final";
        for (const [label, change] of Object.entries({
            amount: "spots[1].CorrectionAmount=0.75",
            exclusion: "spots[1].CorrectionMasks[1].MaskActive=false",
            geometry: "spots[1].CorrectionMasks[1].Geometry.x=0.75",
            payload: 'spots[2].CorrectionMasks[1].Payload="changed"',
            maskCount: "table.remove(spots[1].CorrectionMasks,2)",
            unknownData: 'spots[1].FutureData.extra="changed"',
            nestedCorrectionID: 'spots[1].FutureData.CorrectionID="changed"',
            nestedMaskID: 'spots[1].FutureData.MaskID="changed"',
            spotMaskID: 'spots[1].MaskID="retained-outside-mask"',
            maskCorrectionID: 'spots[1].CorrectionMasks[1].CorrectionID="retained-outside-spot"'
        })) await verifyPeopleAction("remove", "removal-unchanged", null,
            { label: prefix + " " + label, change, phase, outcome: "stale", reason: new RegExp(prefix + ": People inventory token mismatch") });
        await verifyPeopleAction("remove", "removal-unchanged", null, { label: prefix + " photo change with regenerated IDs",
            change: 'removeUuid="other-photo"', phase, outcome: "stale", reason: /photo\/module identity changed during People read/ });
        await verifyPeopleAction("remove", "removal-unchanged", null, { label: prefix + " count change with regenerated IDs",
            change: "", phase, outcome: "stale", reason: new RegExp(prefix + ": People count expected"),
            setup: 'local sdk=import "LrDevelopController"; local original=sdk.countAllSpots; sdk.countAllSpots=function(feature) ' +
                'if feature=="distractingPeopleRemoval" and peopleValidations>=peopleInventoryChangePhase then return 3 end return original(feature) end' });
    }
    for (const field of ["CorrectionID", "CorrectionMasks[1].MaskID"]) await verifyPeopleAction("remove", "removal-unchanged", null,
        { label: "manual " + field + " still preserved", change: "", phase: 1, outcome: "failed", reason: /manualRepairsPreserved=false/,
            setup: 'local sdk=import "LrDevelopController"; local original=sdk.applyRemovalOnDetectedDistractingPeople; ' +
                'sdk.applyRemovalOnDetectedDistractingPeople=function(callback,args) original(callback,args); manualPeopleSpots[1].' + field + '="changed" end' });
    console.log("People: HTTP/queue/Parser/Commands/Lua detection-removal, callback, preservation, duplicate and late-result scenarios passed (mock SDK).");
    if (peopleOnly) return;
    verifyReflectionsTimeout();
    let reflectionsCount = 0;
    for (const [field, values] of [["checkboxState", [true]], ["amount", [-100, 0, 100]], ["quality", ["preview", "best"]]]) {
        for (const value of values) { await verifyReflections(field, value, "ordinary"); reflectionsCount++; }
    }
    await verifyReflections("checkboxState", false, "apply-off"); reflectionsCount++;
    await verifyReflections("checkboxState", false, "apply-off-disabled"); reflectionsCount++;
    await verifyReflections("checkboxState", false, "apply-off-no-callback"); reflectionsCount++;
    for (const name of ["unsupported", "disabled", "malformed", "read-error", "read-nil", "queue-photo", "queue-develop", "photo-before", "module-before", "settings-before", "disabled-before", "invalid-binding", "desired-before", "sdk-error", "no-change", "other-setting", "no-callback", "photo-after", "photo-callback", "delayed-callback", "delayed-readback", "forged-callback", "async-task", "photo-task"]) {
        await verifyReflections("checkboxState", true, name); reflectionsCount++;
    }
    for (const field of ["amount", "quality"]) for (const name of ["photo-before", "other-setting", "sdk-error", "no-change", "delayed-readback", ...(field === "quality" ? ["delayed-callback", "no-callback", "photo-callback"] : [])]) {
        await verifyReflections(field, field === "amount" ? 100 : "best", name); reflectionsCount++;
    }
    console.log("Reflections: " + reflectionsCount + " HTTP/queue/Parser/Commands/Lua scenarios plus expiry/recovery passed (mock SDK).");
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
        if (field.startsWith("selectedRepair")) {
            assert.equal(value, field === "selectedRepairOpacity" ? 100 : 50, "intentional LRBridge selected-repair default");
            for (const name of ["ordinary", "selection-before", "inventory-before", "photo-before", "selection-after", "other-parameter", "other-repair", "preference-after"]) {
                await verifyRepair(value / 100, name, field.slice("selectedRepair".length)); count++;
            }
        } else { await scenario("heal", field, "ordinary", value); count++; }
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
