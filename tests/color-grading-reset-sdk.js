"use strict";
// Execute the production Lua module with SDK doubles. This is not a Lightroom test.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const grading = require("../server/color-grading");
const root = path.join(__dirname, "..");
const metadata = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/color-grading.properties"), "utf8");
const source = fs.readFileSync(process.env.LRBRIDGE_COLOR_GRADING_LUA_SOURCE || path.join(root, "lightroom/LRBridge.lrplugin/ColorGrading.lua"), "utf8");
for (const [control, definition] of Object.entries(grading.metadata.scalarControls).filter(([name]) => name.endsWith("luminance"))) {
    const runtime = lauxlib.luaL_newstate(); lualib.luaL_openlibs(runtime);
    const events = [];
    lua.lua_pushjsfunction(runtime, state => {
        events.push(Array.from({ length: lua.lua_gettop(state) }, (_, i) => lua.lua_type(state, i + 1) === lua.LUA_TNUMBER ?
            lua.lua_tonumber(state, i + 1) : to_jsstring(lua.lua_tostring(state, i + 1)))); return 0;
    });
    lua.lua_setglobal(runtime, to_luastring("capture"));
    const script = `
        _PLUGIN={path='fixture-plugin'}
        package.preload.PollingTrace=function() return {new=function() return {mark=function() end} end} end
        local values={};local unavailable=false;local photo={};local target=photo
        local moduleName='develop';local changeOnSwitch=false;local changeOnRange=false;local resetCount=0;local sleeps=0
        local sdk={getRange=function(parameter) if changeOnRange then target={} end;if unavailable then return nil,nil end return -100,100 end,
            startTracking=function(parameter) capture('tracking',parameter) end,
            setValue=function(parameter,value) values[parameter]=value;capture('set',parameter,value) end,
            resetToDefault=function(parameter) resetCount=resetCount+1;values[parameter]=0;capture('reset',parameter,values[parameter]) end,
            setActiveColorGradingView=function() error('Scalar Reset must not switch region/view') end}
        function import(name)
            if name=='LrDevelopController' then return sdk end
            if name=='LrApplication' then return {activeCatalog=function() return {getTargetPhoto=function() return target end} end} end
            if name=='LrApplicationView' then return {switchToModule=function(module) moduleName=module;if changeOnSwitch then target={} end;capture('module',module) end,getCurrentModuleName=function() return moduleName end} end
            if name=='LrTasks' then return {sleep=function(time) sleeps=sleeps+1;capture('sleep',time) end} end
            if name=='LrPathUtils' then return {child=function(dir,file) return dir..'/'..file end} end
            if name=='LrFileUtils' then return {readFile=function() return [=[${metadata}]=] end} end
            error('Unexpected import: '..name)
        end
        local grading=(function() ${source}\nend)()
        grading.setValue('${control}',37);grading.resetValue('${control}')
        assert(values['${definition.parameter}']==0)
        assert(sleeps==1,'Already-Develop Reset must skip redundant module preparation')
        unavailable=true;assert(not pcall(grading.resetValue,'${control}'))
        unavailable=false;target=nil;assert(not pcall(grading.resetValue,'${control}'))
        target=photo;moduleName='library';grading.resetValue('${control}')
        assert(sleeps==2 and resetCount==2,'Real module transition retains preparation')
        moduleName='library';changeOnSwitch=true;assert(not pcall(grading.resetValue,'${control}'))
        assert(resetCount==2,'Photo changed during module switch must not be reset')
        target=photo;moduleName='develop';changeOnSwitch=false;changeOnRange=true
        assert(not pcall(grading.resetValue,'${control}'))
        assert(resetCount==2,'Photo changed during range validation must not be reset')
    `;
    try {
        const result = lauxlib.luaL_dostring(runtime, to_luastring(script));
        assert.equal(result, lua.LUA_OK, result === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(runtime, -1)));
    } finally { lua.lua_close(runtime); }
    assert.deepEqual(events.filter(e => e[0] === "set"), [["set", definition.parameter, 37]]);
    assert.deepEqual(events.filter(e => e[0] === "reset"), Array.from({ length: 2 }, () => ["reset", definition.parameter, 0]),
        control + " one SDK Reset per valid context, of its own luminance only");
}
console.log("Production Color Grading Lua scalar Reset checks passed: four explicit region parameters, ready-Develop fast path, guarded module transition, unavailable/no-photo/context-change safeguards.");
