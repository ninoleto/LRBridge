"use strict";
// Real native Curve coordinates; isolated HTTP and SDK doubles. No Lightroom edits.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const fixture = require("./fixtures/deep-blue-native-curve.json");
const definition = require("../server/point-curve-state"), controller = require("../app/controller-tone-curve");
const { createBridge } = require("../server/bridge"), commands = require("../server/commands");
const blue = fixture.curves.blue, linear = fixture.curves.rgb;
const binding = { selectedPhotoUuid: "isolated-native-curve-photo", contextCounter: 7, developCounter: 40 };
const refine = { value: 62, min: 0, max: 100 }; // SDK double; fresh native Refine read was verified separately.
function sdkCheck() {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    const source = fs.readFileSync(process.env.LRBRIDGE_TONE_CURVE_LUA_SOURCE || path.join(__dirname, "../lightroom/LRBridge.lrplugin/ToneCurve.lua"), "utf8");
    const tables = Object.entries(fixture.curves).map(([channel, points]) => `${channel}={${points.join(",")}}`).join(",");
    const script = `
      local curves={${tables}}
      local fields={ToneCurvePV2012='rgb',ToneCurvePV2012Red='red',ToneCurvePV2012Green='green',ToneCurvePV2012Blue='blue'}
      local values={ToneCurveName2012='Custom',CurveRefineSaturation=62}
      local writes,reads,tracks=0,{},0
      local photo={getRawMetadata=function()return '${binding.selectedPhotoUuid}' end}
      local sdk={getValue=function(field) reads[#reads+1]=field;return fields[field] and curves[fields[field]] or values[field] end,
        getRange=function()return 0,100 end,setValue=function(field,value)
          writes=writes+1;if fields[field] then curves[fields[field]]=value else values[field]=value end end,
        resetToDefault=function(field)writes=writes+1;if fields[field] then curves[fields[field]]={0,0,255,255} else values[field]=100 end end,
        startTracking=function()tracks=tracks+1 end,stopTracking=function()end}
      local mocks={LrTasks={pcall=pcall},LrDevelopController=sdk,
        LrApplication={activeCatalog=function()return {getTargetPhoto=function()return photo end}end},
        LrApplicationView={getCurrentModuleName=function()return 'develop' end},
        LrHttp={get=function()return [=[${JSON.stringify({ activeModule: "develop", ...binding })}]=] end}}
      import=function(name)return assert(mocks[name])end
      local curve=(function() ${source}\nend)()
      local snapshot=curve.readSnapshot()
      assert(snapshot,'The real Deep Blue array must not discard native Curve Name and Refine feedback')
      assert(snapshot.name=='Custom' and snapshot.refineSaturation==62 and snapshot.refineMin==0 and snapshot.refineMax==100)
      assert(snapshot.blueSerialized=='${blue.join(",")}')
      assert(#snapshot.curves.blue==10 and snapshot.curves.blue[1]==2 and snapshot.curves.blue[10]==223)
      local command={channel='blue',field='ToneCurvePV2012Blue',gestureId='guarded',
        expectedSelectedPhotoUuid='${binding.selectedPhotoUuid}',expectedContextCounter=7,expectedDevelopCounter=40,
        expectedPoints=curves.blue}
      command.expectedPoints=curves.rgb
      assert(curve.beginGesture(command)==false,'Stale standard baseline cannot authorize a native Blue write')
      assert(curve.resetChannel(command)==false)
      assert(writes==0 and tracks==0,'Stale baseline must not reach SDK edits or tracking')
      command.expectedPoints=curves.blue
      assert(curve.beginGesture(command),'Inset native baseline is editable')
      command.points={2,34,73,119,139,180,171,200,255,223}
      assert(curve.endGesture(command))
      assert(curve.readSnapshot().blueSerialized=='2,34,73,119,139,180,171,200,255,223')
      curves.blue={2,34,73,119,139,177,171,200,255,223}
      command.channel='rgb';command.field='ToneCurvePV2012';command.expectedPoints=curves.rgb;command.points=nil
      assert(curve.resetChannel(command))
      local refineCommand={field='CurveRefineSaturation',gestureId='refine-supported',
        expectedSelectedPhotoUuid='${binding.selectedPhotoUuid}',expectedContextCounter=7,expectedDevelopCounter=40,expectedValue=62,value=70}
      assert(curve.beginRefineSaturationGesture(refineCommand))
      assert(curve.endRefineSaturationGesture(refineCommand))
      assert(curve.readSnapshot().refineSaturation==70 and curves.blue[1]==2)
      refineCommand.expectedValue=70;assert(curve.resetRefineSaturation(refineCommand))
      assert(curve.readSnapshot().refineSaturation==100 and curves.blue[1]==2)
      values.ToneCurveName2012=nil;assert(curve.readSnapshot()==nil,'Unavailable Curve Name remains unavailable')
      values.ToneCurveName2012='Custom';values.CurveRefineSaturation=101;assert(curve.readSnapshot()==nil)
      values.CurveRefineSaturation=62
      local readRange=sdk.getRange;sdk.getRange=function()error('range unavailable')end
      assert(curve.readSnapshot()==nil);sdk.getRange=readRange
      local malformed={ {2,34,73,119,73,177,255,223}, {2,34,255,256}, {2,34,255}, {'2',34,255,223}, {-1,34,255,223} }
      for _,invalid in ipairs(malformed)do curves.blue=invalid;assert(curve.readSnapshot()==nil)end
      curves.blue={2,34,255,223,extra=3};assert(curve.readSnapshot()==nil)
      curves.blue={[1]=2,[2]=34,[4]=223};assert(curve.readSnapshot()==nil)
      curves.blue={};for i=1,514 do curves.blue[i]=0 end;assert(curve.readSnapshot()==nil)
      curves.blue={2,34,254,223};assert(curve.readSnapshot().blueSerialized=='2,34,254,223')
      curves.blue={0,0,255,255};assert(curve.readSnapshot())
      assert(curve.serializeCurve({${blue.join(",")}})=='${blue.join(",")}','Native write serialization preserves coordinates')
    `;
    try { const status = lauxlib.luaL_dostring(L, to_luastring(script)); assert.equal(status, lua.LUA_OK, status === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(L, -1))); }
    finally { lua.lua_close(L); }
}
async function main() {
    sdkCheck();
    for (const module of [definition, controller]) {
        assert.equal(module.validNativeCurveArray(blue), true);
        assert.equal(module.validCurveArray(blue), true, "Native endpoints are valid write baselines");
        assert.equal(module.validCurveArray(linear), true);
        for (const inset of [[0,34,254,223], [2,34,254,223]]) {
            assert.equal(module.validNativeCurveArray(inset), true);
            assert.equal(module.validCurveArray(inset), true);
        }
        const sparse = linear.slice(); delete sparse[1];
        for (const value of [null, {}, [], [2,34,255], [2,34,73,119,73,177,255,223], [2,34,255,256],
            ["2",34,255,223], [2.1,34,255,223], [2,NaN,255,223], [2,Infinity,255,223], sparse, Array(514).fill(0)]) {
            assert.equal(module.validNativeCurveArray(value), false);
        }
    }
    assert.match(controller.curvePathData(blue), /^M 2 221 C /);
    assert.deepEqual(controller.selectedPointValues(blue, 0), { input: 2, output: 34 });
    assert.deepEqual(controller.addPoint(blue, 100, 100).points, [2,34,73,119,100,100,139,177,171,200,255,223]);
    assert.deepEqual(controller.movePoint(blue, 0, 0, 50), [2,50,73,119,139,177,171,200,255,223]);
    assert.deepEqual(controller.deletePoint(blue, 1), [2,34,139,177,171,200,255,223]);
    assert.equal(controller.curvesEqual(blue, blue.slice()), true);
    assert.deepEqual(controller.movePoint(linear, 0, 90, 20), [0,20,255,255]);
    const html = fs.readFileSync(path.join(__dirname, "../app/controller.html"), "utf8");
    const wrapper = html.match(/function authoritativeParametricPointCurve\(\)[\s\S]*?(?=function renderParametricCurveSplitTargets)/)[0];
    const nativeRgb = new Function("LRBridgeToneCurve", "pointCurveController", wrapper + "return authoritativeParametricPointCurve();")(
        controller, { getState: () => ({ authoritative: { name: "Custom", curves: { rgb: blue } } }) });
    assert.deepEqual(nativeRgb.rgbCurve, blue); assert.notEqual(nativeRgb.rgbCurve, blue, "Read gate must keep its existing copy ownership");
    const vm = require("node:vm");
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    const state = definition.createPointCurveState(), fields = { activeModule: "develop", ...binding };
    state.syncContext(fields);
    const feedback = { ...binding, name: fixture.name, curves: fixture.curves, refineSaturation: refine };
    assert.equal(state.acceptFeedback(feedback, fields), true);
    assert.deepEqual(state.get(fields).curves.blue, blue);
    assert.equal(controller.normalizeSnapshot(state.get(fields)).name, "Custom");
    assert.equal(state.beginGesture(binding, "blue", "native", blue, fields), true);
    state.finishGesture(binding, "blue", "native");
    assert.equal(state.admitReset(binding, "blue", blue, fields), true);
    assert.equal(state.beginGesture(binding, "rgb", "supported", linear, fields), true);
    state.finishGesture(binding, "rgb", "supported");
    assert.equal(state.beginRefineGesture(binding, "refine", 62, fields), true);
    state.finishRefineGesture(binding, "refine");
    assert.equal(state.admitRefineReset(binding, 62, fields), true);
    assert.equal(state.admitPreset(binding, "Strong Contrast", linear, fields), true);
    assert.equal(state.acceptFeedback({ ...feedback, contextCounter: 6 }, fields), false);
    assert.equal(state.acceptFeedback({ ...feedback, selectedPhotoUuid: "other-photo" }, fields), false);
    assert.equal(state.acceptFeedback({ ...feedback, developCounter: 39 }, fields), false);
    const editCommand = { command: "tone_curve.gesture.begin", channel: "blue", field: "ToneCurvePV2012Blue", gestureId: "guarded",
        expectedSelectedPhotoUuid: binding.selectedPhotoUuid, expectedContextCounter: 7, expectedDevelopCounter: 40, expectedPoints: blue };
    assert.equal(commands.validateCommand(editCommand), true);
    assert.equal(commands.validateCommand({ ...editCommand, command: "tone_curve.gesture.end", points: blue }), true);
    commands.resetQueueForTests();
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 30 });
    try {
        await bridge.start();
        const origin = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        async function get(route, params) { const r = await fetch(origin + route + (params ? "?" + new URLSearchParams(params) : "")); return { status: r.status, body: await r.json() }; }
        const context = (await get("/context/update", { activeModule: "develop", selectedPhotoKey: binding.selectedPhotoUuid,
            selectedPhotoUuid: binding.selectedPhotoUuid, developFingerprint: "native-fixture" })).body;
        const bound = { selectedPhotoUuid: binding.selectedPhotoUuid, contextCounter: context.contextCounter, developCounter: context.developCounter };
        const params = { ...bound, name: "Custom", refineSaturation: 62, refineMin: 0, refineMax: 100,
            ...Object.fromEntries(Object.entries(fixture.curves).map(([channel, points]) => [channel, points.join(",")])) };
        assert.equal((await get("/tone-curve/feedback", params)).status, 200);
        assert.deepEqual((await get("/tone-curve/state")).body.pointCurve.curves.blue, blue);
        assert.equal((await get("/tone-curve/feedback", { ...params, blue: "2,34,255,256" })).status, 400);
        assert.equal((await get("/tone-curve/feedback", { ...params, contextCounter: bound.contextCounter + 1 })).status, 409);
        const guarded = { ...bound, channel: "blue", gestureId: "guarded", baseline: blue.join(",") };
        assert.equal((await get("/tone-curve/gesture/begin", guarded)).status, 200);
        assert.equal((await get("/tone-curve/gesture/end", { ...guarded, points: blue.join(",") })).status, 200);
        const { gestureId, ...reset } = guarded;
        assert.equal((await get("/tone-curve/reset", reset)).status, 200);
        const queued=[]; for(let c; (c=commands.getNextCommand());)queued.push(c);
        assert.deepEqual(queued.map(c=>c.command), ["tone_curve.gesture.begin","tone_curve.gesture.end","tone_curve.reset"]);
    } finally { await bridge.stop(); commands.resetQueueForTests(); }
    console.log("Native Curve compatibility: real SDK array read/feedback/drawing, Name/Refine SDK doubles, native edit admission, malformed/stale feedback and stale zero-write paths passed (SDK doubles).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
