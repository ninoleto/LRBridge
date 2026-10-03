"use strict";
// Production browser math -> HTTP/queue -> Lua, with isolated SDK doubles.
// This does not claim native Lightroom write acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const controller = require("../app/controller-tone-curve"), definition = require("../server/point-curve-state");
const commands = require("../server/commands"), { createBridge } = require("../server/bridge");
const fixture = require("./fixtures/deep-blue-native-curve.json");
const blue = fixture.curves.blue, linear = fixture.curves.rgb;
const variants = [blue, [0,34,...blue.slice(2,-2),253,223], [2,34,...blue.slice(2,-2),253,223]];
function luaValue(value) {
    if (Array.isArray(value)) return "{" + value.map(luaValue).join(",") + "}";
    if (value && typeof value === "object") return "{" + Object.entries(value).map(([key,v]) => key + "=" + luaValue(v)).join(",") + "}";
    return JSON.stringify(value);
}
function execute(queue, binding, curves, target, channel) {
    const source = fs.readFileSync(process.env.LRBRIDGE_TONE_CURVE_LUA_SOURCE || path.join(__dirname, "../lightroom/LRBridge.lrplugin/ToneCurve.lua"), "utf8");
    const methods = { "tone_curve.gesture.begin": "beginGesture", "tone_curve.gesture.update": "updateGesture", "tone_curve.gesture.end": "endGesture", "tone_curve.reset": "resetChannel" };
    const script = `
      local fields={rgb='ToneCurvePV2012',red='ToneCurvePV2012Red',green='ToneCurvePV2012Green',blue='ToneCurvePV2012Blue'}
      local curves=${luaValue(curves)};local writes=0
      local uuid='${binding.selectedPhotoUuid}';local context=${luaValue(binding)}
      local photo={getRawMetadata=function(_,key)if key=='isVirtualCopy'then return true end;return uuid end}
      local sdk={getValue=function(field)for c,f in pairs(fields)do if f==field then return curves[c]end end
        if field=='ToneCurveName2012'then return 'Custom' else return 62 end end,getRange=function()return 0,100 end,
        startTracking=function()end,stopTracking=function()end,
        setValue=function(field,value)assert(field==fields.${channel},'Untouched channel write');writes=writes+1;curves.${channel}=value end,
        resetToDefault=function(field)assert(field==fields.${channel});writes=writes+1;curves.${channel}={5,12,250,244}end}
      local mocks={LrDevelopController=sdk,LrTasks={pcall=pcall},
        LrApplication={activeCatalog=function()return {getTargetPhoto=function()return photo end}end},
        LrApplicationView={getCurrentModuleName=function()return 'develop'end},
        LrHttp={get=function()return string.format('{"activeModule":"develop","selectedPhotoUuid":"%s","contextCounter":%d,"developCounter":%d}',uuid,context.contextCounter,context.developCounter)end}}
      import=function(name)return assert(mocks[name])end
      local curve=(function() ${source}\nend)()
      ${queue.map(command => `assert(curve.${methods[command.command]}(${luaValue(command)}),'Rejected ${command.command}')`).join("\n")}
      assert(writes==1,'Exactly one selected-channel SDK write')
      local actual=curve.readSnapshot();assert(actual and actual.name=='Custom' and actual.refineSaturation==62)
      assert(curve.serializeCurve(actual.curves.${channel})=='${target.join(",")}','Exact inset readback')
      ${Object.entries(curves).filter(([name]) => name !== channel).map(([name,points]) => `assert(curve.serializeCurve(actual.curves.${name})=='${points.join(",")}','Untouched ${name} changed')`).join("\n")}
      local stale=${luaValue({ channel, field: definition.fieldForChannel(channel), gestureId: "stale", expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
        expectedContextCounter: binding.contextCounter, expectedDevelopCounter: binding.developCounter, expectedPoints: curves[channel] })}
      assert(not curve.beginGesture(stale),'Stale native baseline rejected')
      stale.expectedPoints=curves.${channel};stale.expectedContextCounter=stale.expectedContextCounter+1;assert(not curve.beginGesture(stale))
      stale.expectedContextCounter=context.contextCounter;stale.expectedDevelopCounter=context.developCounter+1;assert(not curve.beginGesture(stale))
      stale.expectedDevelopCounter=context.developCounter;stale.expectedSelectedPhotoUuid='other';assert(not curve.beginGesture(stale))
      stale.expectedSelectedPhotoUuid=uuid;stale.expectedPoints={2,34,2,35};assert(not curve.beginGesture(stale))
      assert(writes==1,'Rejected edits must not reach SDK')
    `;
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    try { const code = lauxlib.luaL_dostring(L, to_luastring(script)); assert.equal(code, lua.LUA_OK, code === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(L,-1))); }
    finally { lua.lua_close(L); }
}
async function main() {
    for (const baseline of variants) {
        assert.equal(definition.validCurveArray(baseline), true, "Native inputs are valid editing baselines");
        assert.deepEqual(definition.parseCurve(definition.serializeCurve(baseline)), baseline);
        const added = controller.addPoint(baseline, 100, 140);
        assert.deepEqual(added, { points: [...baseline.slice(0,4),100,140,...baseline.slice(4)], pointIndex: 2 });
        assert.deepEqual(controller.deletePoint(added.points, 2), baseline);
        const moved = baseline.slice(); moved[4]=130; moved[5]=160;
        assert.deepEqual(controller.movePoint(baseline, 2, 130, 160), moved, "Drag changes only the selected pair");
        for (const index of [0, baseline.length/2-1]) {
            assert.equal(controller.deletePoint(baseline,index), null, "Endpoint deletion stays blocked");
            const endpoint = baseline.slice(); endpoint[index*2+1]=50;
            assert.deepEqual(controller.movePoint(baseline,index,128,50), endpoint, "Endpoint input remains its native coordinate");
        }
        for (const x of [0,baseline[0],baseline[baseline.length-2],255,73]) assert.equal(controller.addPoint(baseline,x,100),null);
    }
    const full=Array.from({length:256},(_,x)=>[x,x]).flat();assert.equal(controller.addPoint(full,100,100),null);
    commands.resetQueueForTests();
    const bridge=createBridge({httpPort:0,wsPort:0,httpHost:"127.0.0.1",wsHost:"127.0.0.1",shutdownGraceMs:30});
    try {
        await bridge.start();const origin="http://127.0.0.1:"+bridge.getHttpServer().address().port;
        async function get(route,params){const r=await fetch(origin+route+(params?"?"+new URLSearchParams(params):""));return {status:r.status,body:await r.json()};}
        let sequence=0;
        for(const channel of ["blue","rgb","red","green"])for(const baseline of variants){
            const curves={...fixture.curves,[channel]:baseline};
            const context=(await get("/context/update",{activeModule:"develop",selectedPhotoUuid:"native-edit-fixture",selectedPhotoKey:"native-edit-fixture",developFingerprint:"case-"+(++sequence)})).body;
            const binding={selectedPhotoUuid:context.selectedPhotoUuid,contextCounter:context.contextCounter,developCounter:context.developCounter};
            const feedback={...binding,name:"Custom",refineSaturation:62,refineMin:0,refineMax:100,
                ...Object.fromEntries(Object.entries(curves).map(([c,p])=>[c,p.join(",")]))};
            for(const [operation,target]of [["add",controller.addPoint(baseline,100,140).points],["delete",controller.deletePoint(baseline,2)],["drag",controller.movePoint(baseline,2,130,160)],["reset",[5,12,250,244]]]){
                commands.resetQueueForTests();assert.equal((await get("/tone-curve/feedback",feedback)).status,200);
                const params={...binding,channel,gestureId:"edit_"+sequence+"_"+operation,baseline:baseline.join(",")};
                if(operation==="reset"){
                    const {gestureId,...reset}=params;
                    assert.equal((await get("/tone-curve/reset",reset)).status,200);
                }
                else{
                    assert.equal((await get("/tone-curve/gesture/begin",params)).status,200);
                    assert.equal((await get("/tone-curve/gesture/end",{...params,points:target.join(",")})).status,200);
                }
                const queue=[];for(let c;(c=commands.getNextCommand());)queue.push(c);
                assert.equal(queue.length,operation==="reset"?1:2);execute(queue,binding,curves,target,channel);
                assert.equal((await get("/tone-curve/feedback",{...feedback,[channel]:target.join(",")})).status,200);
                assert.deepEqual((await get("/tone-curve/state")).body.pointCurve.curves[channel],target);
                assert.equal((await get("/tone-curve/gesture/begin",{...params,gestureId:params.gestureId+"_stale"})).status,409);
                // Existing rejection cleanup may enqueue a tracking cancellation,
                // but it must not submit a curve write.
                for(let cancelled;(cancelled=commands.getNextCommand());)assert.equal(cancelled.command,"tone_curve.gesture.cancel");
            }
            for(const invalid of ["2,34,2,50","2,34,255","2,34,255,256","2.5,34,255,223"]){
                assert.equal((await get("/tone-curve/gesture/begin",{...binding,channel,gestureId:"invalid",baseline:invalid})).status,400);
                assert.equal(commands.getNextCommand(),null);
            }
        }
    }finally{await bridge.stop();commands.resetQueueForTests();}
    console.log("Native point editing passed: exact Add/Delete/drag/SDK Reset across four channels and left/right/both inset endpoints; HTTP, queue, Lua write/readback, untouched channels and stale/malformed zero-write guards. SDK doubles only.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
