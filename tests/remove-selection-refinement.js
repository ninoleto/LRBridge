"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { runtime } = require("./masking-create");
const definition = require("../server/remove-state"), commands = require("../server/commands");
const token = "1:2:3:4:5:6:7:8", target = token + ":12:13";
const preferences = { available: true, selectedTool: "dust", newSpotType: "heal_patchmatch", brushSize: 25, brushFeather: 50,
    useGenerativeAI: true, detectObjects: false, toolOverlay: "selected", visualizeSpots: true, visualizationThreshold: 37,
    repair: { available: true, selected: false, count: 0 } };
const nativeState = () => ({ available: true, active: true, token, refinementToken: target, canAdd: true, canSubtract: true,
    canCancel: true, canRemove: true, sizeAvailable: true });
const pause = () => new Promise(r => setTimeout(r, 2));
async function fixture() {
    let time = 1000, selection = nativeState(), invokes = 0, nativeResult = null;
    const context = { activeModule: "develop", selectedPhotoUuid: "creation-photo", contextCounter: 1, developCounter: 2, contextChangedAt: 3 };
    const state = definition.createRemoveState({ now: () => time, serverEpoch: "refinement-test", getContext: () => ({ ...context }),
        nativeBackend: { readRemoveSelection: async () => selection, actRemoveSelectionRefinement: async (action, identity, url) => {
            invokes++; assert.ok(["add", "subtract"].includes(action)); assert.equal(identity, target);
            const input = Object.fromEntries(new URL(url).searchParams);
            for (const field of ["expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt", "expectedRemoveRevision"]) input[field] = Number(input[field]);
            const valid = await state.challengeSelection(input);
            return nativeResult || (valid ? { sent: true, inputStatus: "sent" } : { sent: false, inputStatus: "not_sent", reason: "SDK guard rejected" });
        } } });
    state.get(true); const query = state.takeRequest(); assert.equal(state.acceptQuery({ ...query, ...preferences }), true);
    await state.refreshSelection();
    const admit = action => { const s = state.get(false); return state.admit("selectedSelection", action, { ...context, serverEpoch: s.serverEpoch,
        stateRevision: s.revision, mode: s.newSpotType, selectionToken: target }); };
    const dequeue = c => { assert.equal(commands.validateCommand(c), true); assert.equal(state.matches(c, "admit"), true); assert.equal(state.matches(c, "dequeue"), true); };
    const wait = async (c, field) => { for (let i = 0; i < 100; i++) { const s = state.refinementStatus(c); if (s?.[field]) return s; await pause(); } throw Error("Missing " + field); };
    return { state, context, admit, dequeue, wait, invokes: () => invokes, advance: ms => time += ms,
        selection: value => selection = value, nativeResult: value => nativeResult = value };
}
async function stateChecks() {
    for (const action of ["add", "subtract"]) {
        const f = await fixture(), c = f.admit(action); assert.ok(c); f.dequeue(c);
        assert.equal(f.admit(action), null); assert.equal(f.state.invokeRefinement(c), true);
        assert.equal(f.state.invokeRefinement(c), false); assert.equal(await f.state.invokeSelection(c), false);
        await f.wait(c, "requested"); assert.equal(f.state.refinementStatus(c).complete, false, "Queue acknowledgement precedes the SDK reply");
        assert.equal(f.state.selectionGuard(c, "confirm", true), true); assert.equal(f.state.selectionGuard(c, "confirm", true), false);
        await f.wait(c, "complete");
        const result = { ...c, ...preferences, outcome: "requested", detail: "Sent", otherPreferencesPreserved: true };
        assert.equal(f.state.acceptResult(result), true); assert.equal(f.state.acceptResult(result), false);
        const s = f.state.get(false); assert.equal(s.pendingOperation, null); assert.equal(s.lastResult.outcome, "requested");
        assert.equal(s.selection.active, true); assert.equal(s.selection.canRemove, true, "Refining does not quarantine selection submission");
        assert.equal(s.selection.mode, null); assert.equal(s.selection.canSetMode, false); assert.equal(f.invokes(), 1);
        const events = f.state.refinementDiagnostics().events.filter(e => e.operationId === c.operationId).map(e => e.event);
        for (const event of ["admitted", "dequeued", "sdk_invoke", "sdk_guard_requested", "sdk_guard_reply", "sdk_guard_completed", "native_return", "sdk_result_received", "settled"])
            assert.ok(events.includes(event), "Operation trace includes " + event);
    }
    for (const value of [{ ...nativeState(), canAdd: false }, { ...nativeState(), refinementToken: "bad" },
        { ...nativeState(), refinementToken: "9:2:3:4:5:6:7:8:12:13" }, { ...nativeState(), active: false }, { available: false }]) {
        const f = await fixture(); f.selection(value); await f.state.refreshSelection(); assert.equal(f.admit("add"), null);
    }
    {
        const f = await fixture(); f.advance(2600); assert.equal(f.admit("add"), null);
    }
    for (const field of ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"]) {
        const f = await fixture(), c = f.admit("add"); f.dequeue(c); f.state.invokeRefinement(c); await f.wait(c, "requested");
        f.context[field] = typeof f.context[field] === "number" ? f.context[field] + 1 : "other-photo";
        assert.equal(f.state.selectionGuard(c, "confirm", true), false); assert.equal(f.state.refinementStatus(c), null);
        assert.equal(f.state.invokeRefinement(c), false); assert.equal(f.state.acceptResult({ ...c, ...preferences, outcome: "requested" }), false);
        await pause(); assert.equal(f.invokes(), 1);
    }
    for (const status of ["not_sent", "unknown"]) {
        const f = await fixture(), c = f.admit("subtract"); f.dequeue(c);
        f.nativeResult({ sent: false, inputStatus: status, reason: "Control identity changed" }); f.state.invokeRefinement(c); await f.wait(c, "requested");
        f.state.selectionGuard(c, "confirm", false); await f.wait(c, "complete");
        assert.equal(f.state.acceptResult({ ...c, ...preferences, outcome: "unknown", detail: "Unknown" }), true);
        assert.equal(f.state.get(false).lastResult.outcome, status === "not_sent" ? "failed" : "unknown");
        assert.equal(f.state.get(false).pendingOperation, null); assert.equal(f.invokes(), 1);
    }
    {
        const f = await fixture(), c = f.admit("add"); f.dequeue(c); f.state.invokeRefinement(c); await f.wait(c, "requested");
        f.advance(15001); assert.equal(f.state.get(false).pendingOperation, null);
        assert.equal(f.state.selectionGuard(c, "confirm", true), false); await pause(); assert.equal(f.invokes(), 1);
    }
}
async function luaChecks() {
    const scenarios = ["ordinary", "photo", "tool", "mode", "preferences", "settings", "read-error", "after-photo", "execute-lost", "guard-lost", "result-lost"];
    for (const action of ["add", "subtract"]) for (const scenario of scenarios) {
        const f = await fixture(), c = f.admit(action), sdk = runtime();
        try {
            sdk.run(fs.readFileSync(path.join(__dirname, "remove-preferences.lua"), "utf8"));
            sdk.set("refineScenario", scenario); sdk.set("commandJson", JSON.stringify(c));
            sdk.run(`
removePreferences.newSpotType="heal_patchmatch"
local photo=(import "LrApplication").activeCatalog():getTargetPhoto()
local exposure=0
photo.getDevelopSettings=function()if refineScenario=="read-error"then error("SDK settings failed")end return{Exposure2012=exposure}end
local tasks=import "LrTasks";tasks.startAsyncTask=function()error("Refinement must use one sequential HTTP caller")end
local http=import "LrHttp";local original=http.get
refineInvokes,refineGuards,refineResults=0,0,0
local approved=false
http.get=function(url)
 if string.find(url,"/selection-refinement-native?",1,true)then
  if string.find(url,"action=invoke",1,true)then
   refineInvokes=refineInvokes+1;assert(refineInvokes==1,"No dispatch retry")
   if refineScenario=="execute-lost"then return nil,nil end
   if refineScenario=="photo"then removeUuid="other-photo"elseif refineScenario=="tool"then removeTool="crop"elseif refineScenario=="mode"then removePreferences.newSpotType="clone"elseif refineScenario=="preferences"then removePreferences.brushSize=81 elseif refineScenario=="settings"then exposure=1 end
   return'{"ok":true,"queued":true}',{status=200}
  end
  if refineGuards==0 then return'{"ok":true,"requested":true,"complete":false}',{status=200}end
  if refineScenario=="after-photo"then removeUuid="other-photo"end
  return'{"ok":true,"complete":true,"sent":'..tostring(approved)..'}',{status=200}
 end
 if string.find(url,"/selection-guard?",1,true)then
  refineGuards=refineGuards+1;assert(refineGuards==1,"No guard retry")
  approved=string.find(url,"valid=true",1,true)~=nil
  if refineScenario=="guard-lost"then return nil,nil end
  return'{"ok":true,"accepted":true}',{status=200}
 end
 if string.find(url,"/operation-result?",1,true)then
  refineResults=refineResults+1;assert(refineResults==1,"No uncertain result retry")
  local response=original(url)
  if refineScenario=="result-lost"then return nil,nil end
  return response,{status=200}
 end
 return original(url),{status=200}
end
removeExecute()
assert(refineInvokes==(refineScenario=="read-error"and 0 or 1))
assert(refineResults==1)
`);
            const result = new URL(sdk.result());
            assert.equal(result.searchParams.get("outcome"), ["ordinary", "result-lost"].includes(scenario) ? "requested" : "unknown", action + ":" + scenario);
            assert.equal(result.searchParams.get("selectionCompletionConfirmed"), "false");
        } finally { sdk.close(); }
    }
}
async function httpChecks() {
    const f = await fixture(), app = require("express")(); let dispatched;
    require("../server/remove-routes")(app, f.state, { ADMISSION_ACCEPTED: "accepted", tryEnqueueCommand(c) {
        f.dequeue(c); dispatched = c; return { status: "accepted" };
    } }, (req, keys) => Object.keys(req.query).sort().join("|") === [...keys].sort().join("|"), value => Number(value));
    const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = "http://127.0.0.1:" + server.address().port;
    const get = async (route, status = 200) => { const r = await fetch(base + route); assert.equal(r.status, status, route); return r.json(); };
    try {
        const s = f.state.get(false), client = new URLSearchParams({ ...f.context, serverEpoch: s.serverEpoch,
            stateRevision: s.revision, mode: s.newSpotType, selectionToken: target, field: "selectedSelection", value: "add" });
        client.delete("activeModule");
        await get("/remove/brush?" + client, 400); await get("/remove/selection?" + client + "&extra=1", 400);
        await get("/remove/selection?" + client); await get("/remove/selection?" + client, 409);
        const envelope = new URLSearchParams({ operationId: dispatched.operationId });
        for (const k of definition.bindingFields) envelope.set(k, dispatched[k]);
        assert.equal((await get("/remove/selection-refinement-native?action=invoke&" + envelope)).queued, true);
        await get("/remove/selection-refinement-native?action=invoke&" + envelope, 409);
        const status = await get("/remove/selection-refinement-native?action=status&" + envelope);
        assert.equal(status.requested, true); assert.equal(status.complete, false, "HTTP execute acknowledgement must not await SDK challenge completion");
        await get("/remove/selection-guard?phase=confirm&valid=true&" + envelope);
        await f.wait(dispatched, "complete");
        assert.equal((await get("/remove/selection-refinement-native?action=status&" + envelope)).sent, true);
        assert.equal(f.invokes(), 1);
        assert.equal(f.state.acceptResult({ ...dispatched, ...preferences, outcome: "requested", detail: "Sent", otherPreferencesPreserved: true }), true);
        const diagnostics = await get("/remove/diagnostics/refinement");
        assert.ok(diagnostics.events.some(e => e.event === "http_request" && e.value === "add"));
        assert.ok(diagnostics.events.some(e => e.event === "http_rejected" && e.status === 409));
        assert.ok(diagnostics.events.some(e => e.event === "settled" && e.operationId === dispatched.operationId));
        await get("/remove/selection-refinement-native?action=status&" + envelope, 409);
    } finally { await new Promise(resolve => server.close(resolve)); }
}
stateChecks().then(luaChecks).then(httpChecks).then(() => console.log("Selected refinement: command-only settlement, captured target capability, single sequential SDK dispatch, 22 Lua success/context/transport cases, HTTP queue acknowledgement/duplicates, failed/unknown distinction, late/expired ownership passed (simulated)."))
    .catch(error => { console.error(error); process.exitCode = 1; });
