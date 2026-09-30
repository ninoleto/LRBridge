"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const root=path.resolve(__dirname,".."),build=require("../tools/build-windows-candidate");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"lrbridge-release-check-"));
function run(command,args,expected=0) { const r=cp.spawnSync(command,args,{cwd:root,encoding:"utf8"});assert.equal(r.status,expected,(r.stdout||"")+(r.stderr||"")+(r.error||""));return r; }
try {
    run(process.execPath,["tools/generate-http-reference.js","--check"]);
    const inventory=require("../server/http-operations.json"), keys=inventory.operations.map(o=>o.method+" "+o.path);
    assert.equal(keys.length,new Set(keys).size,"each route has one inventory entry");
    for(const p of ["/clipboard/action","/export/action"]) {
        const item=inventory.operations.find(o=>o.path===p);
        assert.equal(item.kind,"workflow");
    }
    for(const file of fs.readdirSync(path.join(root,"server")).filter(n=>n.endsWith(".js"))) {
        const s=fs.readFileSync(path.join(root,"server",file),"utf8");
        for(const m of s.matchAll(/app\.(get|post)\(\s*["']([^"']+)["']\s*,/g)) assert(keys.includes(m[1].toUpperCase()+" "+m[2]),"unindexed route "+m[2]);
    }
    assert.deepEqual([...new Set(inventory.operations.map(o=>o.path))].sort(),require("./contract-fixture.json").routes.slice().sort(),"inventory must cover captured runtime route registrations, including dynamic families");
    for(const item of inventory.operations.filter(o=>o.path.includes("/gesture/") && !o.path.endsWith("/state"))) assert.notEqual(item.kind,"ordinary");
    for(const p of ["/remove/selection-native", "/remove/selection-refinement-native", "/remove/selection-validate", "/remove/selection-guard",
        "/masking/correction-result", "/masking/edit-result", "/enhance/amount-result", "/color-grading/view-result", "/tone-curve/feedback",
        "/develop-presets/inventory/item", "/develop-presets/inventory/complete", "/develop-presets/inventory/fail"]) {
        assert.equal(inventory.operations.find(o=>o.path===p)?.kind,"internal","plug-in protocol is not a client action: "+p);
    }
    assert.equal(inventory.operations.find(o=>o.path==="/remove/selection")?.kind,"workflow");
    for(const p of ["/color-grading", "/color-grading/metadata", "/feedback/request-many", "/feedback/snapshot", "/remove/diagnostics/refinement"]) {
        assert.equal(inventory.operations.find(o=>o.path===p)?.kind,"read","state/discovery classification: "+p);
    }
    const stage=path.join(temp,"stage"); const result=build.stageProject(stage);
    assert(result.luaModules>25,"transitive runtime dependencies including dofile loops must be staged");
    for(const f of ["AutoStartPolling.lua","FeedbackPolling.lua","SettingsClipboard.lua","Export.lua","DustOnPreset.lua","DustPasteDiagnostics.lua","People.lua","Remove.lua"]) assert(fs.existsSync(path.join(stage,"lightroom/LRBridge.lrplugin",f)),"missing "+f);
    const files=build.walk(stage);
    for(const file of files.filter(f=>f.endsWith(".md"))) {
        const source=fs.readFileSync(path.join(stage,file),"utf8");
        for(const match of source.matchAll(/\[[^\]\r\n]*\]\(([^)\s]+)\)/g)) {
            const target=match[1].split("#")[0];
            if(!target || /^[a-z]+:|^\//i.test(target)) continue;
            const resolved=path.resolve(stage,path.dirname(file),decodeURIComponent(target));
            assert(resolved.startsWith(stage+path.sep),"Reference escapes package: "+file+" -> "+target);
            assert(fs.existsSync(resolved),"Missing packaged reference: "+file+" -> "+target);
        }
    }
    const {lua,lauxlib,to_luastring}=require("fengari");
    for(const f of files.filter(f=>f.startsWith("lightroom/") && f.endsWith(".lua"))) {
        const state=lauxlib.luaL_newstate();
        const parsed=lauxlib.luaL_loadstring(state,to_luastring(fs.readFileSync(path.join(stage,f),"utf8")));
        assert.equal(parsed,lua.LUA_OK,"Lua syntax: "+f);
        lua.lua_close(state);
    }
    assert(!files.some(f=>/CODEX_HANDOFF|ftp-backup|Research|local-checkpoints|CaptureDust|TestDust/.test(f)));
    assert.equal(fs.readFileSync(path.join(stage,"config/settings.txt"),"utf8"),build.defaults);
    const installer=path.join(stage,"tools/install-runtime-presets.ps1"),target=path.join(temp,"installed presets");
    const args=["-NoProfile","-ExecutionPolicy","Bypass","-File",installer,"-TargetDirectory",target];
    run("powershell.exe",args);run("powershell.exe",args);
    const preset=path.join(target,"LRBridge Dust On.xmp"), original=build.sha(preset);
    assert.equal(original,require("../resources/presets/manifest.json").files[0].sha256);
    // Group-only migration keeps filenames and Lightroom preset UUIDs, and backs
    // up only the exact known legacy bytes without adding another XMP preset.
    for (const item of require("../resources/presets/manifest.json").files) {
        const file = path.join(target, item.name);
        const updated = fs.readFileSync(file, "utf8");
        const legacy = updated.replace('<rdf:li xml:lang="x-default">LRBridge Dust Helpers</rdf:li>',
            '<rdf:li xml:lang="x-default">LRBridge TEST</rdf:li>');
        fs.writeFileSync(file, legacy);
        assert.equal(build.sha(file), item.legacySha256);
    }
    run("powershell.exe", args); run("powershell.exe", args);
    for (const item of require("../resources/presets/manifest.json").files) {
        assert.equal(build.sha(path.join(target, item.name)), item.sha256);
        assert.equal(build.sha(path.join(target, item.name + ".lrbridge-legacy.bak")), item.legacySha256);
    }
    assert.equal(fs.readdirSync(target).filter(f => f.endsWith(".xmp")).length, 2);
    fs.writeFileSync(preset,"a user's existing different preset");run("powershell.exe",args,1);
    assert.equal(fs.readFileSync(preset,"utf8"),"a user's existing different preset");
    fs.writeFileSync(path.join(stage,"resources/presets/LRBridge Dust Off.xmp"),"corrupt bundle");
    const untouched=path.join(temp,"must remain absent");run("powershell.exe",[...args.slice(0,-1),untouched],1);
    assert(!fs.existsSync(untouched));
    const info=fs.readFileSync(path.join(stage,"lightroom/LRBridge.lrplugin/Info.lua"),"utf8");
    assert.match(info,/LrSdkMinimumVersion = 15\.3/);assert.match(info,/major = 0, minor = 6/);
    console.log("Release staging, route coverage, safe defaults and preset install/idempotence/conflict/integrity checks passed.");
} finally {
    const resolved=fs.realpathSync(temp),allowed=fs.realpathSync(os.tmpdir())+path.sep;
    if(!resolved.startsWith(allowed)||!path.basename(resolved).startsWith("lrbridge-release-check-")) throw Error("Unsafe cleanup target");
    fs.rmSync(resolved,{recursive:true,force:true});
}
