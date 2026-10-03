"use strict";

// Production Masking.lua with the existing SDK confirmation harness. Isolated
// fixtures only: this test neither contacts Lightroom nor edits native photos.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const fixture = require("./fixtures/deep-blue-native-curve.json");

const harness = fs.readFileSync(path.join(__dirname, "mask-tone-curve-confirmation.lua"), "utf8");
const boundary = harness.indexOf("\nreset(); assert(masking.execute(command(\"exact\")))");
assert.ok(boundary > 0, "Existing mask SDK confirmation harness boundary must be present");
const setup = harness.slice(0, boundary).replace(
    'assert(field == "local_Bluecurve")',
    'assert(field == "local_Maincurve" or field == "local_Redcurve" or field == "local_Greencurve" or field == "local_Bluecurve")'
);
const runtime = lauxlib.luaL_newstate();
lualib.luaL_openlibs(runtime);
const traces = [];
lua.lua_pushjsfunction(runtime, state => {
    const line = to_jsstring(lua.lua_tostring(state, 1));
    traces.push(JSON.parse(line.slice(line.indexOf("MaskToneCurveTrace ") + "MaskToneCurveTrace ".length)));
    return 0;
});
lua.lua_setglobal(runtime, to_luastring("captureTrace"));
for (const name of ["nativeBaseline", "nativeTarget"]) {
    lua.lua_newtable(runtime);
    fixture.curves.blue.forEach((value, index) => {
        lua.lua_pushinteger(runtime, value); lua.lua_rawseti(runtime, -2, index + 1);
    });
    lua.lua_setglobal(runtime, to_luastring(name));
}

const cases = `
local native = copy(baseline)
local fields = {rgb='local_Maincurve',red='local_Redcurve',green='local_Greencurve',blue='local_Bluecurve'}
local function equal(left,right)
    assert(type(left)=='table' and type(right)=='table' and #left==#right,'Curve pair count differs')
    for index=1,#left do assert(left[index]==right[index],'Curve coordinate changed at '..index) end
end
local function serialized(points)
    local parts={};for index=1,#points do parts[index]=tostring(points[index]) end
    return table.concat(parts,','):gsub(',', '%%2C')
end
local function unchanged(before,changed)
    for channel,field in pairs(fields)do
        if channel~=changed then equal(values[field],before[field]) end
    end
end
local writeLog={}
local originalSet=controller.setValue
controller.setValue=function(field,points)
    writeLog[#writeLog+1]={field=field,points=copy(points)}
    return originalSet(field,points)
end
local function prepare(points)
    baseline=copy(points);target=copy(points);reset();writeLog={}
end
local function edit(id,points,changed)
    target=copy(points)
    local before=copy(values)
    local cmd=command(id)
    local channel=changed or 'blue';cmd.channel=channel;cmd.field=fields[channel]
    cmd.expectedPoints=copy(values[cmd.field])
    assert(masking.execute(cmd),'Native inset mask edit must be admitted: '..id)
    outcome('confirmed')
    equal(values[cmd.field],points)
    assert(#writeLog==1 and writes==1,'One-shot point edit must have one SDK write')
    assert(writeLog[1].field==cmd.field);equal(writeLog[1].points,points)
    unchanged(before,channel)
    local responseField=({rgb='localCurveRgb',red='localCurveRed',green='localCurveGreen',blue='localCurveBlue'})[channel]
    assert(response:find('&'..responseField..'='..serialized(points),1,true),'Confirmed feedback must preserve exact native pairs')
end
for _,kind in ipairs({'first_inset','last_inset','both_inset'})do
    local points=copy(native)
    if kind=='last_inset' then points[1]=0 end
    if kind~='first_inset' then points[#points-1]=253 end
    -- Interior insertion keeps both native endpoint pairs and every prior pair.
    prepare(points)
    local added=copy(points);table.insert(added,5,100);table.insert(added,6,145)
    edit(kind..'_add',added)
    -- Delete only the inserted interior point, restoring the exact SDK baseline.
    prepare(added)
    edit(kind..'_delete',points)
    -- An interior drag changes precisely one pair.
    prepare(points)
    local moved=copy(points);moved[5]=143;moved[6]=180
    edit(kind..'_drag',moved)
    -- Selected endpoints retain their actual input coordinates, not 0/255.
    prepare(points)
    local endpoint=copy(points);endpoint[2]=35
    edit(kind..'_first_output',endpoint)
    prepare(points)
    endpoint=copy(points);endpoint[#endpoint]=222
    edit(kind..'_last_output',endpoint)
    -- SDK string-pair readback must normalize without rebuilding the endpoints.
    prepare(points);representation='strings'
    edit(kind..'_strings',moved)
    -- A tracked gesture accepts successive exact baselines and confirms its end.
    prepare(points)
    local before=copy(values)
    local cmd=command(kind..'_gesture');cmd.command='masking.tone_curve.gesture.begin';cmd.points=nil
    assert(masking.execute(cmd),'Inset gesture begin must retain native baseline')
    cmd.command='masking.tone_curve.gesture.update';cmd.points=copy(moved)
    assert(masking.execute(cmd));outcome('confirmed')
    cmd.command='masking.tone_curve.gesture.end';cmd.expectedPoints=copy(moved)
    local final=copy(moved);final[6]=181;cmd.points=final
    assert(masking.execute(cmd));outcome('confirmed')
    assert(writes==2 and #writeLog==2);equal(writeLog[1].points,moved);equal(writeLog[2].points,final)
    equal(values.local_Bluecurve,final);unchanged(before,'blue')
end
-- Existing standard RGB/Red/Green writes remain supported with the native Blue
-- channel untouched, using the same production selected-mask handler.
for _,channel in ipairs({'rgb','red','green'})do
    prepare(native);edit('standard_'..channel,{0,0,120,145,255,255},channel)
end
local malformed={
    {2,34,73,119,73,177,255,223}, {2,34,255,256}, {2,34,255},
    {'2',34,255,223}, {-1,34,255,223}, {2.5,34,255,223}, {2,0/0,255,223},
    {[1]=2,[2]=34,[4]=223}, {2,34,255,223,extra=3}
}
local oversized={};for index=1,514 do oversized[index]=0 end
malformed[#malformed+1]=oversized
for index,invalid in ipairs(malformed)do
    prepare(native);local before=copy(values);local cmd=command('malformed_'..index);cmd.points=invalid
    assert(not masking.execute(cmd),'Malformed target must be rejected');outcome('failed')
    assert(writes==0 and #writeLog==0);unchanged(before,nil)
end
for _,kind in ipairs({'photo','context','develop','mask','stale_baseline'})do
    prepare(native);local before=copy(values);local cmd=command('reject_'..kind)
    if kind=='photo' then cmd.expectedSelectedPhotoUuid='photo-b'
    elseif kind=='context' then cmd.expectedContextCounter=2
    elseif kind=='develop' then cmd.expectedDevelopCounter=2
    elseif kind=='mask' then selectedMask='mask-b'
    else cmd.expectedPoints[2]=35 end
    assert(not masking.execute(cmd),'Changed ownership/baseline must be rejected: '..kind);outcome('stale')
    assert(writes==0 and #writeLog==0);unchanged(before,nil)
end
`;
try {
    const status = lauxlib.luaL_dostring(runtime, to_luastring(setup + "\n" + cases));
    assert.equal(status, lua.LUA_OK, status === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(runtime, -1)));
} finally {
    lua.lua_close(runtime);
}
const confirmed = traces.filter(trace => trace.events.some(event => event.event === "editResult" && event.data.outcome === "confirmed"));
assert.equal(confirmed.length, 27, "Every inset operation and standard-channel edit must return production confirmation");
assert.ok(confirmed.some(trace => trace.command.gestureId === "curve_first_inset_add" &&
    trace.events.some(event => event.event === "getValue" && event.data.channel === "blue" && event.data.normalized[0] === 2)));
assert.ok(confirmed.some(trace => trace.command.gestureId === "curve_both_inset_strings" &&
    trace.events.some(event => event.event === "getValue" && event.data.channel === "blue" && typeof event.data.raw[0] === "string" &&
        event.data.normalized[0] === 2 && event.data.normalized.at(-2) === 253)));
console.log("Mask native curve editing: inset Add/Delete/drag, endpoint preservation, tracked gestures, exact confirmations, standard channels, malformed/context/stale rejection and untouched channels passed (SDK doubles only).");
