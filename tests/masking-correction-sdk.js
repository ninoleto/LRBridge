"use strict";

// Reuse the selected-photo/mask SDK double, but execute the production regular
// correction handler (not Point Color). No native Lightroom or network calls.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const fixture = fs.readFileSync(path.join(__dirname, "mask-point-color-confirmation.lua"), "utf8");
const luaValue = value => value === null ? "nil" : typeof value !== "object" ? JSON.stringify(value)
    : "{" + Object.entries(value).map(([k, v]) => "[" + JSON.stringify(k) + "]=" + luaValue(v)).join(",") + "}";

function run(kind, options = {}) {
    const command = { command: "masking.correction." + kind, correctionSequence: 140,
        parameter: "local_Grain", expectedSelectedMaskId: "mask-a", expectedActiveModule: "develop",
        expectedSelectedPhotoUuid: "photo-a", expectedContextCounter: 4, expectedDevelopCounter: 7,
        expectedContextChangedAt: 10, expectedServerEpoch: "epoch-a", expectedMaskingRevision: 35,
        ...(kind === "reset" ? {} : { gestureId: "mg-final-grain", value: 10 }) };
    const setup = `
local scalar, requested, writeAt = -67, nil, nil
controller.getRange = function(parameter) if parameter == 'local_Grain' then return -100,100 end end
controller.getValue = function(parameter)
    if parameter ~= 'local_Grain' then return nil end
    if requested and time-writeAt+0.000000001 >= scenario.delay and not scenario.unconfirmed then scalar=requested end
    capture('scalarRead',time,scalar); return scalar
end
controller.startTracking = function(parameter) assert(parameter=='local_Grain');capture('start',time,parameter) end
controller.stopTracking = function(isLocal) assert(isLocal==true);capture('stop',time,isLocal) end
controller.setValue = function(parameter,value)
    assert(parameter=='local_Grain');capture('write',time,value)
    if scenario.sdkError then error('SDK failed') end
    requested=value;writeAt=time
end
controller.resetToDefault = function(parameter) assert(parameter=='local_Grain');capture('reset',time);scalar=7 end
local originalHttp=modules.LrHttp.get
modules.LrHttp.get=function(url)
    if url:find('/masking/correction-result',1,true) then capture('result',time,url);return '{"ok":true}' end
    if url:find('/context',1,true) and scenario.contextJson then return scenario.contextJson end
    return originalHttp(url)
end
`;
    const runtime = lauxlib.luaL_newstate(); lualib.luaL_openlibs(runtime);
    const events = [];
    lua.lua_pushjsfunction(runtime, L => {
        const row = [];
        for (let i = 1; i <= lua.lua_gettop(L); i++) row.push(lua.lua_type(L, i) === lua.LUA_TNUMBER
            ? lua.lua_tonumber(L, i) : lua.lua_type(L, i) === lua.LUA_TBOOLEAN ? lua.lua_toboolean(L, i) : to_jsstring(lua.lua_tostring(L, i)));
        events.push(row); return 0;
    });
    lua.lua_setglobal(runtime, to_luastring("capture"));
    const override = process.env.LRBRIDGE_MASKING_TEST_SOURCE ? "package.preload.Masking=function()\n" +
        fs.readFileSync(process.env.LRBRIDGE_MASKING_TEST_SOURCE, "utf8") + "\nend\n" : "";
    const source = "command=" + luaValue(command) + "\nscenario=" + luaValue({ delay: 0, ...options }) + "\n" + override +
        fixture.replace('local masking = require "Masking"', setup + '\nlocal masking = require "Masking"');
    try {
        if (lauxlib.luaL_dostring(runtime, to_luastring(source)) !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(runtime, -1)));
    } finally { lua.lua_close(runtime); }
    const result = events.find(event => event[0] === "result");
    assert.ok(result, "the production handler must return a result");
    return { events, query: new URL(result[2]).searchParams };
}

for (const delay of [0, 0.15]) {
    const result = run("gesture.end", { delay });
    assert.equal(result.query.get("outcome"), "confirmed", JSON.stringify(result.events));
    assert.deepEqual(result.events.filter(e => ["start", "write", "stop"].includes(e[0])).map(e => e[0]), ["start", "write", "stop"]);
    assert.equal(result.events.filter(e => e[0] === "write").at(-1)[2], 10);
    assert.match(result.query.get("corrections"), /local_Grain,10,-100,100/);
}
const reset = run("reset");
assert.equal(reset.query.get("outcome"), "confirmed");
assert.match(reset.query.get("corrections"), /local_Grain,7,-100,100/, "Reset uses the SDK default, not an assumed zero");
const compatibleContext = '{"activeModule":"develop","selectedPhotoUuid":"photo-a","contextCounter":4,"developCounter":8,"contextChangedAt":10,"maskingCorrectionDevelopFloor":7,"maskingGrainMaskId":"mask-a"}';
assert.equal(run("gesture.end", {contextJson:compatibleContext}).query.get("outcome"),"confirmed",
    "queued correction can execute across an SDK-proven Grain revision");
for(const json of [compatibleContext.replace('Floor":7','Floor":8'),compatibleContext.replace('MaskId":"mask-a','MaskId":"mask-b')]) {
    const stale=run("gesture.end",{contextJson:json});
    assert.equal(stale.query.get("outcome"),"stale"); assert.equal(stale.events.filter(e=>e[0]==="write").length,0);
}
const pointResult = require("./mask-point-color-confirmation").runSdk({command:"masking.point_color.value.set",
    editSequence:1,field:"HueShift",value:0.5,expectedSelectedIndex:1,expectedSelectedMaskId:"mask-a",
    expectedActiveModule:"develop",expectedSelectedPhotoUuid:"photo-a",expectedContextCounter:4,expectedDevelopCounter:7,
    expectedContextChangedAt:10,expectedServerEpoch:"epoch-a",expectedMaskingRevision:35}, {contextJson:compatibleContext});
assert.equal(pointResult.outcome,"stale","Grain exception must not broaden accepted Point Color binding rules");
assert.equal(pointResult.writes.length,0);
for (const change of ["photo", "mask"]) {
    const stale = run("gesture.end", { switch: change, switchBefore: true });
    assert.equal(stale.query.get("outcome"), "stale");
    assert.equal(stale.events.filter(e => e[0] === "write").length, 0);
}
for (const failure of [{ sdkError: true }, { unconfirmed: true }]) {
    const failed = run("gesture.end", failure);
    assert.equal(failed.query.get("outcome"), "failed");
    assert.equal(failed.events.filter(e => e[0] === "write").length, 1, "failed or uncertain edits are never retried");
}
console.log("Regular Masking production Lua: terminal-only gesture tracking, final 10, delayed readback, native Reset default, photo/mask protection and genuine failures passed (simulated).");
