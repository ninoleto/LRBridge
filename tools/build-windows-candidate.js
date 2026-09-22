"use strict";
// Build only from a new allowlisted staging tree. Never build from private config.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./release-runtime-files.json");
const publicDocs = ["WINDOWS_BETA.md", "RELEASE_REVIEW.md", "HTTP_WORKFLOWS.md", "HTTP_OPERATIONS.md", "COMPANION_HTTP_CHEATSHEET.md",
    "COPY_PASTE_SETTINGS.md", "CONTROLLER_FAVORITES.md", "EXPORT_CONTROLS.md", "REMOVE_BRUSH_PREFERENCES.md"];
const defaults = "poll_interval_ms=100\n";
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function copy(relative, stage) {
    const destination = path.join(stage, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, relative), destination);
}
function walk(dir, prefix = "") {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
        ? walk(path.join(dir,e.name), prefix+e.name+"/") : [prefix+e.name]);
}
function stageProject(stage) {
    if (fs.existsSync(stage)) throw Error("Refusing to reuse staging: " + stage);
    fs.mkdirSync(stage, { recursive: true });
    // Reviewed runtime files only: adding a tracked probe must never make it ship.
    for (const file of runtimeFiles) {
        if (!/^(app|server)\/[A-Za-z0-9_.-]+$/.test(file) || /(?:prototype|capture|\.local\.)/i.test(file)) {
            throw Error("Invalid runtime allowlist entry: " + file);
        }
    }
    const allow = new Set([...runtimeFiles,
        "package.json", "package-lock.json", "electron-builder.yml", "bridge.js", "build/icon.ico", "config/sliders.json",
        "README.md", "llms.txt", "Install Dust Presets.cmd", "tools/install-runtime-presets.ps1",
        ...publicDocs.map(n => "docs/"+n), ...["manifest.json", "LRBridge Dust On.xmp", "LRBridge Dust Off.xmp"].map(n => "resources/presets/"+n)]);
    const luaRoot = "lightroom/LRBridge.lrplugin/";
    const queue = ["Info", "PluginInit", "PluginShutdown", "Help"], seen = new Set();
    while(queue.length) {
        const name = queue.shift(); if(seen.has(name)) continue; seen.add(name);
        const relative = luaRoot+name+".lua"; allow.add(relative);
        const source = fs.readFileSync(path.join(root,relative),"utf8");
        for(const m of source.matchAll(/require\s*(?:\(\s*)?["']([\w-]+)["']/g)) queue.push(m[1]);
        for(const m of source.matchAll(/dofile\(_PLUGIN\.path\s*\.\.\s*["'][\\/]+([\w-]+)\.lua["']/g)) queue.push(m[1]);
    }
    allow.add(luaRoot+"color-grading.properties");
    for(const relative of allow) copy(relative,stage);
    fs.writeFileSync(path.join(stage,"config/settings.txt"), defaults);
    fs.writeFileSync(path.join(stage,"config/develop-presets.json"), JSON.stringify({version:1,presets:[]},null,2)+"\n");
    // extraFiles source paths must not overlap ASAR inputs: electron-builder excludes overlaps.
    for (const directory of ["config", "lightroom"]) {
        fs.cpSync(path.join(stage,directory),path.join(stage,"runtime",directory),{recursive:true});
    }
    fs.writeFileSync(path.join(stage,"staging-manifest.json"),JSON.stringify({files:walk(stage).sort()},null,2)+"\n");
    return { files: allow.size, luaModules: seen.size };
}
function run(command,args,options={}) {
    const r=cp.spawnSync(command,args,{cwd:root,stdio:"inherit",...options});
    if(r.error) throw r.error; if(r.status!==0) throw Error(command+" failed ("+r.status+")");
}
function inspectCandidate(folder) {
    const files=walk(folder).sort();
    for(const f of files) if(/(^|\/)(\.codex|\.git|local-checkpoints|tests|scripts|backups)(\/|$)|ftp-backup|CODEX_HANDOFF|Research|prototype|capture[-_]|\.local\.|\.(log|jsonl|tsv|arm)$/i.test(f)) throw Error("Unexpected release file: "+f);
    if(fs.readFileSync(path.join(folder,"config/settings.txt"),"utf8")!==defaults) throw Error("Non-default settings in package");
    if(JSON.parse(fs.readFileSync(path.join(folder,"config/develop-presets.json"))).presets.length) throw Error("Private preset config in package");
    const asar=require("@electron/asar"), archive=path.join(folder,"resources/app.asar"), entries=asar.listPackage(archive);
    for(const entry of entries) if(/(?:^|[\\/])(?:\.codex|tests|local-checkpoints|backups|fengari|electron-builder)(?:[\\/]|$)|ftp-backup|settings\.txt|develop-presets\.json|Research|CODEX_HANDOFF|SelectedPrototype|capture[-_]|\.local\.|\.(log|jsonl|tsv|arm)$/i.test(entry)) throw Error("Unexpected ASAR entry: "+entry);
    for(const f of ["lightroom/LRBridge.lrplugin/color-grading.properties","config/sliders.json","app/main.js","app/controller-http-inventory.js","server/http-operations.json","server/clipboard-routes.js","server/export-routes.js"]) asar.extractFile(archive,path.join(...f.split("/")));
    for(const f of ["LRBridge.exe","resources/native/windows-lightroom-native.ps1","resources/native/windows-remove-selected-identification.ps1","Install Dust Presets.cmd","lightroom/LRBridge.lrplugin/SettingsClipboard.lua","lightroom/LRBridge.lrplugin/DustOnPreset.lua","resources/presets/manifest.json"]) if(!files.includes(f)) throw Error("Missing runtime file: "+f);
    const presets=JSON.parse(fs.readFileSync(path.join(folder,"resources/presets/manifest.json")));
    for(const p of presets.files) if(sha(path.join(folder,"resources/presets",p.name))!==p.sha256) throw Error("Packaged preset mismatch");
    const manifest={version:1,files:files.map(file=>({file,bytes:fs.statSync(path.join(folder,file)).size,sha256:sha(path.join(folder,file))})),asarEntries:entries.length};
    fs.writeFileSync(path.join(folder,"release-manifest.json"),JSON.stringify(manifest,null,2)+"\n");
    return manifest;
}
async function main() {
    const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+Z/,"Z"), output=path.join(root,"dist","beta-"+stamp), stage=path.join(output,"stage");
    console.log("Sanitized stage:",stage,stageProject(stage));
    if(process.argv.includes("--stage-only")) return;
    const npmCli=process.env.npm_execpath || path.join(path.dirname(process.execPath),"node_modules/npm/bin/npm-cli.js");
    run(process.execPath,[npmCli,"ci","--omit=dev","--ignore-scripts","--no-audit","--no-fund"],{cwd:stage});
    run(process.execPath,[path.join(root,"node_modules/electron-builder/cli.js"),"--projectDir",stage,"--win","--x64","--dir","--publish","never",
        "-c.electronVersion="+require("../node_modules/electron/package.json").version,"-c.directories.output="+path.join(output,"package"),"-c.electronDist="+path.join(root,"node_modules/electron/dist")],{env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:"false"}});
    const folder=path.join(output,"package/win-unpacked"),manifest=inspectCandidate(folder);
    const version=JSON.parse(fs.readFileSync(path.join(root,"package.json"))).version;
    const zip=path.join(output,"LRBridge-"+version+"-beta-win-x64-portable.zip");
    // Paths are data, not interpolated shell expressions.
    run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"tools/package-windows-zip.ps1"),"-Source",folder,"-ZipPath",zip]);
    run("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"tools/verify-windows-zip.ps1"),"-ZipPath",zip]);
    const result={folder,zip,sha256:sha(zip),files:manifest.files.length,asarEntries:manifest.asarEntries,stage};
    fs.writeFileSync(path.join(output,"candidate.json"),JSON.stringify(result,null,2)+"\n");
    fs.writeFileSync(zip+".sha256",result.sha256+"  "+path.basename(zip)+"\n");
    console.log(JSON.stringify(result,null,2));
}
module.exports={stageProject,inspectCandidate,walk,sha,defaults};
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
