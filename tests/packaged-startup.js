"use strict";
// Launch the packaged Node runtime on ephemeral ports. Never load bridge.js (the native-helper entry point).
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const inside=process.argv.includes("--inside"),folder=path.resolve(process.argv.at(-1));
if(!fs.existsSync(path.join(folder,"LRBridge.exe"))) throw Error("Supply the unpacked candidate folder");
if(!inside) {
    const r=cp.spawnSync(path.join(folder,"LRBridge.exe"),[__filename,"--inside",folder],{
        env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},encoding:"utf8",timeout:30000,windowsHide:true});
    process.stdout.write(r.stdout||"");process.stderr.write(r.stderr||"");
    if(r.error)throw r.error;assert.equal(r.status,0,"packaged runtime smoke failed");
} else (async()=>{
    const archive=path.join(folder,"resources/app.asar");
    const bridge=require(path.join(archive,"server/bridge")).createBridge({httpPort:0,wsPort:0,httpHost:"127.0.0.1",wsHost:"127.0.0.1",shutdownGraceMs:50});
    const settings=fs.readFileSync(path.join(folder,"config/settings.txt"));
    try {
        for(let cycle=0;cycle<2;cycle++) {
            await bridge.start();const base="http://127.0.0.1:"+bridge.getHttpServer().address().port;
            const get=async route=>{const r=await fetch(base+route);assert(r.ok,route+" HTTP "+r.status);return r.json();};
            const help=await get("/help");assert(help.operationInventory.operations.length>=199);
            assert((await get("/sliders")).sliders.length>100);
            assert((await get("/color-grading")).colorGrading);
            // Plug-in poll with no commands, then disconnect/stop and recreate listeners.
            assert.equal((await get("/next")).command,null);
            assert.equal((await get("/status")).queueLength,0);
            await bridge.stop();
        }
        assert.deepEqual(fs.readFileSync(path.join(folder,"config/settings.txt")),settings);
        assert(fs.existsSync(path.join(folder,"resources/native/windows-lightroom-native.ps1")));
        console.log("Packaged Electron Node runtime: module loading, metadata, empty polling, stop/restart/reconnect and settings preservation passed; no Windows helper or Lightroom action invoked.");
    } finally {await bridge.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
