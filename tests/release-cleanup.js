"use strict";
// Source/staging checks only: never build a package, start a native helper or use Lightroom.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), cp = require("node:child_process");
const { stageProject, walk, defaults } = require("../tools/build-windows-candidate");
const { createPollingTrace } = require("../server/polling-trace");
const { runtime } = require("./masking-create");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-cleanup-"));
async function main() {
    try {
        const stage = path.join(temp, "stage"), staged = stageProject(stage), files = walk(stage);
        assert(staged.luaModules > 25);
        assert(!files.some(file => /(?:^|\/)(?:tests|scripts|local-checkpoints|backups|\.codex|\.git)\/|CODEX_HANDOFF|Research|Prototype|Capture\w*\.lua|Test\w*\.lua|Observe\w*\.lua|\.local\.|\.(?:log|jsonl|tsv|arm)$/i.test(file)));
        assert.equal(fs.readFileSync(path.join(stage, "config/settings.txt"), "utf8"), defaults);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stage, "config/develop-presets.json"))).presets, []);
        const manifest = require("../tools/release-runtime-files.json");
        assert.equal(new Set(manifest).size, manifest.length);
        for (const file of manifest) assert(files.includes(file), "Missing reviewed runtime dependency " + file);
        for (const file of files.filter(file => /\.(?:lua|js|ps1|html|json|txt|yml)$/.test(file))) {
            const source = fs.readFileSync(path.join(stage, file), "utf8");
            assert(!/SelectedPrototype|selected-refinement-prototype|remove-selected-targets\.local|resetTrace|127\.0\.0\.1:17893/.test(source), "Development dependency in " + file);
            assert(!/[CD]:[\\/]+(?:Projects[\\/]+LRBridge|Users[\\/]+nino)/i.test(source), "Machine-specific path in " + file);
        }
        const builder = fs.readFileSync(path.join(stage, "electron-builder.yml"), "utf8");
        for (const name of ["windows-lightroom-native.ps1", "windows-remove-selected-identification.ps1"]) {
            assert(builder.includes("from: server/" + name + "\n    to: native/" + name) ||
                builder.includes("from: server/" + name + "\r\n    to: native/" + name), "Packaged native sibling " + name);
            assert(fs.existsSync(path.join(stage, "server", name)));
        }
        assert.match(fs.readFileSync(path.join(stage, "server/windows-lightroom-native.ps1"), "utf8"), /Join-Path \$PSScriptRoot 'windows-remove-selected-identification\.ps1'/);
        // Normal diagnostics must ignore even an armed developer capture without disk I/O.
        const disabled = createPollingTrace(temp, () => 1000000, false);
        fs.writeFileSync(path.join(temp, "sdk-move-trace.arm"), "1010 cleanup");
        let reads = 0, forwarded = 0;
        const read = fs.readFileSync;
        fs.readFileSync = function (...args) { reads++; return read.apply(this, args); };
        try {
            disabled.record("ignored"); disabled.middleware({ path: "/next" }, {}, () => forwarded++);
            assert.equal(disabled.readObserverPause().paused, false);
            assert.equal(disabled.readSharedReadPause().paused, false);
        } finally { fs.readFileSync = read; }
        assert.equal(reads, 0); assert.equal(forwarded, 1);
        assert(!fs.existsSync(path.join(temp, "cleanup-server.jsonl")));
        const sdk = runtime();
        try {
            sdk.run("os.getenv=nil; io.open=function() error('Unexpected diagnostic file access') end");
            sdk.run("local info=(function()\n" + fs.readFileSync(path.join(stage, "lightroom/LRBridge.lrplugin/Info.lua"), "utf8") + "\nend)(); assert(info.LrExportMenuItems==nil); assert(#info.LrHelpMenuItems==1); assert(info.LrInitPlugin=='PluginInit.lua')");
            sdk.run("Trace=(function()\n" + fs.readFileSync(path.join(stage, "lightroom/LRBridge.lrplugin/PollingTrace.lua"), "utf8") + "\nend)()");
            sdk.run(`local t=Trace.new('normal'); t.mark('enter','ignored')
                local a,b,c=t.call('returns',function() return 7,nil,9 end); assert(a==7 and b==nil and c==9)
                local co=coroutine.create(function() return t.call('yield',function() coroutine.yield(1);return 2 end) end)
                local ok,v=coroutine.resume(co); assert(ok and v==1); ok,v=coroutine.resume(co); assert(ok and v==2)
                ok,v=pcall(function() t.call('failure',function() error('unchanged failure') end) end); assert(not ok and tostring(v):find('unchanged failure'))`);
            sdk.run("(function()\n" + fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/CaptureProfile.lua"), "utf8") + "\nend)()");
            for (const file of files.filter(file => file.startsWith("lightroom/") && file.endsWith(".lua"))) {
                sdk.set("source", fs.readFileSync(path.join(stage, file), "utf8"));
                sdk.run("assert((loadstring or load)(source))");
            }
        } finally { sdk.close(); }
        // This child has only staged runtime/config files and installed dependencies.
        // SelectedPrototype, ignored config and diagnostic servers are not available.
        const startup = `const assert=require('node:assert/strict');
            const bridge=require(${JSON.stringify(path.join(stage, "server/bridge.js"))}).createBridge({httpPort:0,wsPort:0,httpHost:'127.0.0.1',wsHost:'127.0.0.1'});
            (async()=>{try{await bridge.start();const base='http://127.0.0.1:'+bridge.getHttpServer().address().port;
                const get=async route=>{const r=await fetch(base+route);assert(r.ok,route);return r.json()};
                assert.equal((await get('/next')).command,null);
                assert((await get('/sliders')).sliders.length>100);
                const diagnostics=await get('/diagnostics/polling');assert.equal(diagnostics.developerDiagnostics,false);assert.equal(diagnostics.comparison.paused,false);
                assert.equal((await get('/status')).queueLength,0);
                console.log('Staged runtime starts with no prototype, diagnostic server or private config.');
            }finally{await bridge.stop()}})().catch(error=>{console.error(error);process.exitCode=1});`;
        const child = cp.spawnSync(process.execPath, ["-e", startup], { cwd: stage, encoding: "utf8", timeout: 15000, windowsHide: true,
            env: { ...process.env, NODE_PATH: path.join(root, "node_modules"), LRBRIDGE_DEVELOPER_DIAGNOSTICS: "0" } });
        assert.equal(child.status, 0, (child.stdout || "") + (child.stderr || "") + (child.error || ""));
        console.log("Release cleanup: explicit runtime allowlist, native Selected dependencies, sanitized defaults, no developer menu/browser hook, disabled diagnostics, Lua syntax and isolated staged startup passed. No package built.");
    } finally {
        const resolved = fs.realpathSync(temp), allowed = fs.realpathSync(os.tmpdir()) + path.sep;
        if (!resolved.startsWith(allowed) || !path.basename(resolved).startsWith("lrbridge-cleanup-")) throw Error("Unsafe temporary cleanup path");
        fs.rmSync(resolved, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
