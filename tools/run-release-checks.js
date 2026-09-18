"use strict";
// Isolated checks only. Never invoke tests/http-smoke.js or the Windows helper.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const root=path.resolve(__dirname,".."),pkg=require("../package.json");
const extra=["clipboard","export","controller-history","controller-tab-actions","masking-create","masking-components",
    "masking-component-delete","masking-component-invert","masking-preset-application","remove-preferences",
    "dust-controls","dust-preset","red-eye","polling-lifecycle","release-preparation"];
const core=pkg.scripts.test.split(" && ").map(s=>pkg.scripts[s.replace("npm run ","")]).flatMap(s=>s.split(" && "));
for(const name of extra) { const file="tests/"+name+".js"; if(!fs.existsSync(path.join(root,file))) throw Error("Missing release check "+file); core.push("node "+file); }
// Legacy TestDustPaste diagnostic scenarios are separate from the shipping runtime gate.
const browser=["--history-only","--favorites-only","--clipboard-only","--export-only","--red-eye-only"].map(mode=>"node tests/controller-browser-lifecycle.js "+mode);
browser.push("node tests/release-docs-browser.js");
const checks=process.argv.includes("--browser")?browser:core;
const logDir=path.join(root,"local-checkpoints","release-checks-"+new Date().toISOString().replace(/[:.]/g,"-"));fs.mkdirSync(logDir,{recursive:true});
const results=[];
for(const command of [...new Set(checks)]) {
    const [binary,...args]=command.split(" "); if(binary!=="node") throw Error("Non-isolated check "+command);
    const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",timeout:240000,maxBuffer:32*1024*1024});
    const file=String(results.length+1).padStart(2,"0")+"-"+path.basename(args[0],".js")+(args[1]||"")+".log";
    fs.writeFileSync(path.join(logDir,file),(r.stdout||"")+(r.stderr||"")+(r.error?String(r.error):""));
    const result={command,passed:r.status===0,exitCode:r.status,log:file};results.push(result);console.log((result.passed?"PASS ":"FAIL ")+command);
    fs.writeFileSync(path.join(logDir,"results.json"),JSON.stringify(results,null,2)+"\n");
}
console.log("Evidence: "+logDir);console.log(results.filter(r=>r.passed).length+"/"+results.length+" passed");
if(results.some(r=>!r.passed)) process.exitCode=1;
