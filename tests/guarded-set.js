"use strict";
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const root=process.env.LRBRIDGE_GUARDED_SET_ROOT || path.resolve(__dirname,'..');
const plugin=process.env.LRBRIDGE_GUARDED_SET_PLUGIN || path.join(root,'lightroom/LRBridge.lrplugin');
const commands=require(path.join(root,'server/commands')), context=require(path.join(root,'server/context'));
const definition=require(path.join(root,'server/guarded-set'));
const {createBridge}=require(path.join(root,'server/bridge'));
let serial=0, checks=0;
function runtime(respond){
 let active=true;
 const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
 const run=s=>{if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));};
 const set=(name,value)=>{lua.lua_pushstring(L,to_luastring(value));lua.lua_setglobal(L,to_luastring(name));};
 const get=name=>{lua.lua_getglobal(L,to_luastring(name));const v=lua.lua_isnumber(L,-1)?lua.lua_tonumber(L,-1):to_jsstring(lua.lua_tostring(L,-1));lua.lua_pop(L,1);return v;};
 lua.lua_pushcfunction(L,state=>{const url=to_jsstring(lua.lua_tostring(state,1)),v=respond(url);if(new URL(url).pathname==='/next'&&v.command===null)active=false;lua.lua_pushstring(state,to_luastring(typeof v==='string'?v:JSON.stringify(v)));return 1;});lua.lua_setglobal(L,to_luastring('respond'));
 lua.lua_pushcfunction(L,state=>{lua.lua_pushboolean(state,active);return 1;});lua.lua_setglobal(L,to_luastring('hasCommands'));
 set('pluginRoot',plugin.replaceAll('\\','/'));run(fs.readFileSync(path.join(__dirname,'guarded-set.lua'),'utf8'));
 return{run,set,get,close:()=>lua.lua_close(L)};
}
const request=(c,slider='Contrast',expectedValue=23,value=24)=>({requestId:'guard-'+(++serial),serverEpoch:'guard-epoch',slider,expectedValue,value,
 selectedPhotoUuid:c.selectedPhotoUuid,contextCounter:c.contextCounter,contextChangedAt:c.contextChangedAt});
function scenario(slider,mode='ordinary',preceding,following){
 commands.resetQueueForTests();context.updateContext({activeModule:'develop',selectedPhotoUuid:'guard-photo',developFingerprint:'guard-'+serial});
 const c=context.getContextFields();let clock=100, result;
 const state=definition.createGuardedSet({getContext:()=>c,serverEpoch:'guard-epoch',now:()=>clock,enqueue:commands.tryEnqueueCommand});
 commands.setGuardedSetAdmissionProvider(state);
 const req=request(c,slider),sdk=runtime(url=>{
  const u=new URL(url),input=Object.fromEntries(u.searchParams);
  if(u.pathname==='/next')return {command:commands.getNextCommand()};
  if(u.pathname==='/set/claim')return{valid:state.claim(input)};
  if(u.pathname==='/set/validate')return state.validate(input);
  if(u.pathname==='/set/operation-result'){
   input.invoked=input.invoked==='true';for(const k of ['contextCounter','contextChangedAt'])input[k]=Number(input[k]);
   result=input; return {ok:state.acceptResult(input)};
  }
  throw Error('Unexpected '+url);
 });
 try{
  if(preceding)assert(commands.enqueueCommand(preceding));
  const admission=state.admit(req);assert.equal(admission.status,202);assert.equal(admission.receipt.result,null);
  assert.equal(state.admit(req).duplicate,true);assert.equal(state.admit({...req,value:25}).status,409);
  if(following)assert(commands.enqueueCommand(following));
  sdk.set('mode',mode);sdk.set('commandJson',JSON.stringify({command:admission.receipt && state.get(req) && {command:'develop.set.guarded',operationId:admission.receipt.operationId,requestId:req.requestId,slider:req.slider,value:req.value,expectedValue:req.expectedValue,expectedServerEpoch:req.serverEpoch,expectedSelectedPhotoUuid:req.selectedPhotoUuid,expectedContextCounter:req.contextCounter,expectedContextChangedAt:req.contextChangedAt,admittedDevelopCounter:c.developCounter}}));
  sdk.run('assert(require("Parser").parse(commandJson), commandJson); runWorker()');
  const receipt=state.get(req);assert.equal(receipt.phase,'complete');assert.equal(receipt.result.requestId,req.requestId);
  const out={...receipt.result,actual:sdk.get('sdkValue'),writes:sdk.get('writes'),resets:sdk.get('resets'),elapsed:sdk.get('elapsed')};
  assert.equal(state.admit(req).duplicate,true);assert.equal(commands.getNextCommand(),null);
  if(out.outcome==='applied'){sdk.run('local seenRead, seenWrite, settled = false, false, false; for _, e in ipairs(events) do if string.sub(e, 1, 5) == "read:" then seenRead = true end; if string.sub(e, 1, 4) == "set:" then assert(seenRead); seenWrite = true end; if e == "settle" then assert(seenWrite); settled = true end end; assert(settled)');assert(!('sdkValue' in out));}
  checks++;return out;
 }finally{sdk.close();state.stop();}
}
async function main(){
 const log=console.log;console.log=()=>{};
 try{
  for(const slider of definition.SLIDERS){
   const a=scenario(slider);assert.equal(a.outcome,'applied');assert.equal(a.actual,24);assert.equal(a.writes,1);
   const coarse=scenario(slider,'ordinary',{command:'develop.adjust',slider,amount:1});assert.equal(coarse.reason,'baseline-mismatch');assert.equal(coarse.actual,28);assert.equal(coarse.writes,0);
   const reset=scenario(slider,'ordinary',{command:'develop.reset',slider});assert.equal(reset.actual,0);assert.equal(reset.resets,1);assert.equal(reset.outcome,'rejected');
   const later=scenario(slider,'ordinary',null,{command:'develop.reset',slider});assert.equal(later.writes,1);assert.equal(later.resets,1);assert.equal(later.actual,0);
  }
  for(const mode of ['prepare-photo','tracking-photo','validate-photo','read-photo','prepare-process','read-process']){
   const r=scenario('Contrast',mode);assert.equal(r.outcome,'rejected',mode);assert.equal(r.writes,0);
  }
  for(const mode of ['read-error','read-nil','range-error']){const r=scenario('Clarity',mode);assert.equal(r.outcome,'rejected');assert.equal(r.invoked,false);assert.equal(r.writes,0);}
  assert.equal(scenario('Contrast','prepare-manual').actual,47);
  for(const mode of ['set-error','set-photo']){const r=scenario('Vibrance',mode);assert.equal(r.outcome,'uncertain');assert.equal(r.invoked,true);assert.equal(r.writes,1);}
  commands.resetQueueForTests();let c={activeModule:'develop',selectedPhotoUuid:'guard-photo',contextCounter:1,contextChangedAt:10,developCounter:2}, clock=0;
  const state=definition.createGuardedSet({getContext:()=>c,serverEpoch:'guard-epoch',now:()=>clock,enqueue:commands.tryEnqueueCommand});commands.setGuardedSetAdmissionProvider(state);
  const a=request(c),b=request(c,'Contrast',24,25);state.admit(a);state.admit(b);
  assert.equal(commands.getStatus().queueLength,2);const ac=commands.getNextCommand(),bc=commands.getNextCommand();assert.notEqual(ac.operationId,bc.operationId);
  assert.equal(state.claim({...a,operationId:bc.operationId}),false);assert(state.claim({...a,operationId:ac.operationId}));assert.equal(state.claim({...a,operationId:ac.operationId}),false);
  clock=definition.TIMEOUT_MS;state.syncAll();assert.equal(state.get(a).result.outcome,'uncertain');assert.equal(state.get(b).result.invoked,false);
  for(const key of ['selectedPhotoUuid','contextCounter','contextChangedAt','activeModule']){
   const req=request(c);state.admit(req);const old=c[key];c[key]=typeof old==='number'?old+1:'changed';assert.equal(commands.getNextCommand(),null);assert.equal(state.get(req).result.invoked,false);c[key]=old;
  }
  const sdk=runtime(()=>({}));const good={...ac};
  for(const json of [JSON.stringify(good),JSON.stringify({command:good})]){sdk.set('json',json);sdk.run('assert(require("Parser").parse(json))');}
  const valid=JSON.stringify({command:good});
  for(const bad of [valid+'junk',valid.replace('"value":24','"value":24,"value":24'),valid.replace('"value":24','"value":24,"extra":1'),valid.replace('"value":24','"value":101'),valid.replace('"value":24','"value":100.5'),valid.replace('"value":24','"value":24 garbage'),valid.replace('"requestId":','"requestId":null,"requestId":'),valid.replace('}}','},"extra":1}'),valid.replace('}}',',} }')]){
   sdk.set('json',bad);sdk.run('assert(require("Parser").parse(json) == nil, "malformed envelope admitted")');checks++;
  }
  sdk.close();state.stop();commands.resetQueueForTests();
  for(const bad of [{value:101},{expectedValue:null},{slider:'Exposure'},{extra:1},{serverEpoch:'old'}])assert(state.admit({...request(c),...bad}).status>=400);
  const full=definition.createGuardedSet({getContext:()=>c,serverEpoch:'guard-epoch',enqueue:()=>({accepted:false})});const fullreq=request(c);assert.equal(full.admit(fullreq).receipt.result.invoked,false);assert.equal(full.admit(fullreq).duplicate,true);full.stop();
  // Exhaustion never evicts a previous ID, including terminal queue refusals.
  const bounded=definition.createGuardedSet({getContext:()=>c,serverEpoch:'guard-epoch',enqueue:()=>({accepted:false})});
  const first=request(c);bounded.admit(first);
  for(let i=1;i<definition.MAX_RECEIPTS;i++)bounded.admit(request(c));
  assert.equal(bounded.admit(request(c)).status,503);assert.equal(bounded.admit(first).duplicate,true);bounded.stop();
  // Both identified Reset and guarded Set retain independent FIFO entries.
  const ordered=definition.createGuardedSet({getContext:()=>c,serverEpoch:'guard-epoch',enqueue:commands.tryEnqueueCommand});
  const resetState=require(path.join(root,'server/reset-completion')).createResetCompletion({getContext:()=>c,serverEpoch:'guard-epoch',enqueue:commands.tryEnqueueCommand});
  commands.setGuardedSetAdmissionProvider(ordered);commands.setResetCompletionAdmissionProvider(resetState);
  const {expectedValue:_expected,value:_value,...resetReq}=request(c);
  assert.equal(resetState.admit(resetReq).status,202);const setReq=request(c);assert.equal(ordered.admit(setReq).status,202);
  assert(commands.enqueueCommand({command:'develop.reset',slider:'Contrast'}));
  assert.deepEqual([commands.getNextCommand().command,commands.getNextCommand().command,commands.getNextCommand().command],['develop.reset.correlated','develop.set.guarded','develop.reset']);
  assert.equal(ordered.get(setReq).phase,'dispatched');ordered.stop();resetState.stop();commands.resetQueueForTests();
  const bridge=createBridge({httpPort:0,wsPort:0,httpHost:'127.0.0.1',wsHost:'127.0.0.1',shutdownGraceMs:20});await bridge.start();
  try{
   const base='http://127.0.0.1:'+bridge.getHttpServer().address().port;
   const call=async(p,opt)=>{const r=await fetch(base+p,opt);return{status:r.status,data:await r.json()};};
   const caps=(await call('/set/capabilities')).data;c=caps.context;const input={...request(c),serverEpoch:caps.serverEpoch};
   const admitted=await call('/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(admitted.status,202);
   const raw=(await call('/next')).data;assert.equal(raw.command.command,'develop.set.guarded');
   const key=new URLSearchParams({serverEpoch:input.serverEpoch,requestId:input.requestId,operationId:raw.command.operationId});
   assert.equal((await call('/set/result?'+new URLSearchParams({serverEpoch:input.serverEpoch,requestId:input.requestId}))).data.receipt.result,null);
   const claimed=(await call('/set/claim?'+key)).data,validated=(await call('/set/validate?'+key)).data;let resultPath;
   const integrated=runtime(url=>{const u=new URL(url);if(u.pathname.endsWith('/claim'))return claimed;if(u.pathname.endsWith('/validate'))return validated;resultPath=u.pathname+u.search;return{ok:true};});
   integrated.set('json',JSON.stringify(raw));integrated.run('execute(json)');assert.equal(integrated.get('sdkValue'),24);assert.equal((await call(resultPath)).status,200);integrated.close();
   assert.equal((await call('/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).data.duplicate,true);
   assert.equal((await call('/next')).data.command,null);
   for(const p of ['/adjust?slider=Contrast&amount=1','/reset?slider=Contrast','/set?slider=Contrast&value=23'])assert.equal((await call(p)).status,200);
  }finally{await bridge.stop();}
 }finally{console.log=log;commands.resetQueueForTests();}
 console.log(`PASS guarded Set: ${checks} SDK/ownership/envelope scenarios; exact HTTP /next → Parser → Commands → Driver → receipt; legacy routes preserved.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
