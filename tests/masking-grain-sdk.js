"use strict";
// Actual Driver, receipt classifier and heartbeat functions; only SDK/HTTP are doubles.
const assert=require("node:assert/strict"),fs=require("node:fs");
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require(process.env.LRBRIDGE_LUA_TEST_RUNTIME||"fengari");
const source=fs.readFileSync(process.env.LRBRIDGE_GRAIN_FEEDBACK_SOURCE||"lightroom/LRBridge.lrplugin/FeedbackPolling.lua","utf8");
function between(a,b){const at=source.indexOf(a),end=source.indexOf(b,at);assert.ok(at>=0&&end>at);return source.slice(at,end);}
const captured=[];
const overrides=[['Driver','LRBRIDGE_GRAIN_TEST_SOURCE'],['MaskingGrain','LRBRIDGE_GRAIN_OWNERSHIP_SOURCE']]
    .filter(([,key])=>process.env[key]).map(([name,key])=>"package.preload."+name+"=function()\n"+fs.readFileSync(process.env[key],'utf8')+"\nend\n").join('');
const runtime=lauxlib.luaL_newstate();lualib.luaL_openlibs(runtime);
lua.lua_pushjsfunction(runtime,L=>{captured.push([to_jsstring(lua.lua_tostring(L,1)),to_jsstring(lua.lua_tostring(L,2))]);return 0;});
lua.lua_setglobal(runtime,to_luastring("capture"));
const setup=`
package.path='lightroom/LRBridge.lrplugin/?.lua;'..package.path
local values={GrainSize=64,GrainFrequency=44,Contrast=0}
local photoId,maskId='photo-a','mask-a'
local photo={getRawMetadata=function()return photoId end}
local hook,httpHook,readMissing,writeFailure=nil,nil,false,false
local sdk={getSelectedMask=function()return maskId end,getSelectedTool=function()return 'masking' end,
 revealAdjustedControls=function()end,startTracking=function()end,
 getValue=function(p)if readMissing and p=='GrainSize' then return nil end;return values[p] end,
 setValue=function(p,v)if writeFailure then error('actual SDK failure')end;values[p]=v end,
 resetToDefault=function(p)values[p]=p=='GrainSize' and 25 or 50 end}
local modules={LrTasks={pcall=pcall},LrDevelopController=sdk,
 LrApplication={activeCatalog=function()return{getTargetPhoto=function()return photo end}end},
 LrApplicationView={getCurrentModuleName=function()return'develop'end}}
function import(name)return assert(modules[name],name)end
package.loaded.DevelopCategorical={}
${overrides}
local Driver=require'Driver'
local MaskingGrain=require'MaskingGrain'
local function set(p,v)Driver.setSlider(p,v,{command='develop.set',value=v,preserveMaskingPanel=true,expectedSelectedPhotoUuid=photoId})end
local watchedSliders={'GrainSize','GrainFrequency','Contrast'}
local Trace={mark=function()end}
local previousFingerprintInputs={}
local Query={getDevelopValue=function(p)if hook then local fn=hook;hook=nil;fn()end;return sdk.getValue(p)end}
local getActiveModule=function()return'develop'end
local function getSelectedPhotoIdentity()return{photo=photo,uuid=photoId,key=photoId,path=''}end
local profile='profile';local curve='curve'
local readProfileFeedback=function()return{available=false,fingerprint=profile}end
local ToneCurve={readSnapshot=function()return{fingerprint=curve}end}
local label='baseline'
local LrHttp={get=function(url)
 if url:find('/context/update',1,true)then
  capture(label,url)
  if httpHook then local fn=httpHook;httpHook=nil;fn()end
  return'{"contextCounter":4,"developCounter":7}'
 end
 return'{}'
end}
`;
const body=`
sendContextHeartbeat()
label='size';set('GrainSize',55);sendContextHeartbeat()
label='rapid';for i=1,16 do set('GrainSize',i+30);set('GrainFrequency',i+20)end;sendContextHeartbeat()
label='reset';Driver.resetSlider('GrainSize',{command='develop.reset',preserveMaskingPanel=true,expectedSelectedPhotoUuid=photoId});sendContextHeartbeat()
label='external-before-own';values.GrainSize=60;set('GrainSize',80);sendContextHeartbeat()
label='external-after-own';set('GrainSize',65);values.GrainSize=66;sendContextHeartbeat()
label='other-edit';set('GrainSize',51);values.Contrast=10;sendContextHeartbeat()
label='profile-edit';set('GrainSize',52);profile='other-profile';sendContextHeartbeat()
label='curve-edit';set('GrainSize',53);curve='other-curve';sendContextHeartbeat()
label='mask-change';set('GrainSize',54);maskId='mask-b';sendContextHeartbeat()
label='photo-change';set('GrainSize',55);photoId='photo-b';sendContextHeartbeat()
label='failed-write';writeFailure=true;local ok=pcall(function()set('GrainSize',56)end);assert(not ok);writeFailure=false;sendContextHeartbeat()
label='unavailable-read';readMissing=true;set('GrainSize',57);sendContextHeartbeat();readMissing=false
label='fresh-baseline';sendContextHeartbeat()
label='mixed-read-must-skip';hook=function()set('GrainSize',58)end;sendContextHeartbeat()
label='after-mixed-read';sendContextHeartbeat()
label='write-during-http';set('GrainSize',59);httpHook=function()set('GrainFrequency',47)end;sendContextHeartbeat()
label='after-http';sendContextHeartbeat()
label='overflow';for i=1,129 do set('GrainSize',i%90)end;sendContextHeartbeat()
label='after-overflow';set('GrainSize',61);sendContextHeartbeat()
`;
try {
 const program=setup+between('local function urlEncode(value)','local function getActiveModule()')+
   between('local function getDevelopFingerprint(','local function maybeSendContextHeartbeat(')+body;
 if(lauxlib.luaL_dostring(runtime,to_luastring(program))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(runtime,-1)));
}finally{lua.lua_close(runtime);}
const rows=captured.map(([name,url])=>({name,query:Object.fromEntries(new URL(url).searchParams)}));
assert.equal(rows.some(r=>r.name==='mixed-read-must-skip'),false,'a heartbeat straddling a scoped SDK write must not publish mixed provenance');
const compatible=new Set(['size','rapid','reset','after-mixed-read','write-during-http','after-http','after-overflow']);
for(let i=0;i<rows.length;i++)assert.equal(rows[i].query.maskingGrainFromFingerprint,compatible.has(rows[i].name)?rows[i-1].query.developFingerprint:'',rows[i].name);
console.log('PASS production Grain Driver/heartbeat ownership: rapid chains, Reset, external writes, photo/mask, profile/curve, SDK failure, unavailable reads, mixed reads, HTTP yield and bounded history');
module.exports={rows};
