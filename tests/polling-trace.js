"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { createPollingTrace } = require("../server/polling-trace");
const { runtime } = require("./masking-create");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-polling-trace-"));
let now = 1000000;
try {
    const trace = createPollingTrace(directory, () => now, true);
    trace.record("disabled"); assert.deepEqual(fs.readdirSync(directory), []);
    const arm = path.join(directory, "sdk-move-trace.arm");
    const observerArm = path.join(directory, "sdk-move-observer-pause.arm");
    assert.equal(trace.readObserverPause().paused, false);
    const sharedArm = path.join(directory, "sdk-move-native-reads-pause.arm");
    assert.equal(trace.readSharedReadPause().paused, false);
    fs.writeFileSync(sharedArm, "1010 shared-off"); now += 501;
    assert.equal(trace.readSharedReadPause().paused, true);
    assert.equal(trace.readObserverPause().paused, false, "The two diagnostic gates are independent");
    fs.writeFileSync(observerArm, "1010 comparison-off"); now += 501;
    assert.equal(trace.readObserverPause().paused, true);
    fs.writeFileSync(observerArm, "invalid"); now += 501;
    assert.equal(trace.readObserverPause().paused, false);
    fs.writeFileSync(observerArm, "1001 expired"); now += 501;
    assert.equal(trace.readObserverPause().paused, false);
    fs.writeFileSync(observerArm, "999999 far-future"); now += 501;
    assert.equal(trace.readObserverPause().paused, false);
    fs.writeFileSync(arm, "1010 test-capture\n"); now += 501;
    const res = new EventEmitter(); res.statusCode = 200;
    let forwarded = 0;
    trace.middleware({ path: "/next", url: "/next?private=never-record" }, res, () => forwarded++);
    trace.record("command_dequeue", { command: "remove.selection.action", operationId: "rb-9" });
    res.writableFinished = true; res.emit("finish"); res.emit("close");
    assert.equal(forwarded, 1);
    const log = path.join(directory, "test-capture-server.jsonl");
    const rows = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(rows.map(r => r.event), ["http_enter", "command_dequeue", "http_finish"]);
    assert.equal(rows[0].startedAt, rows[2].startedAt);
    assert.ok(!fs.readFileSync(log, "utf8").includes("private"));
    const sliderResponse = new EventEmitter(); sliderResponse.statusCode = 400;
    trace.middleware({ path: "/set", query: { slider: "Exposure", value: "1.25", selectedPhotoPath: "private-photo" } }, sliderResponse, () => forwarded++);
    sliderResponse.writableFinished = true; sliderResponse.emit("finish");
    const sliderRows = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse).slice(-2);
    assert.equal(sliderRows[0].slider, "Exposure"); assert.equal(sliderRows[0].value, 1.25);
    assert.equal(sliderRows[1].status, 400, "Rejected requests are distinguishable from successful admission");
    assert.ok(!fs.readFileSync(log, "utf8").includes("private-photo"));
    const resultResponse = new EventEmitter(); resultResponse.statusCode = 200;
    trace.middleware({ path: "/feedback/result", query: { slider: "Exposure", id: "77", value: "1.25" } }, resultResponse, () => {});
    resultResponse.writableFinished = true; resultResponse.emit("finish");
    const resultRow = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse).at(-1);
    assert.equal(resultRow.id, 77); assert.equal(resultRow.available, true); assert.equal(resultRow.value, 1.25);
    const size = fs.statSync(log).size; now = 1011000; trace.record("expired"); assert.equal(fs.statSync(log).size, size);
    assert.equal(trace.readSharedReadPause().paused, false);
    fs.writeFileSync(arm, "1020 ../../escape"); now += 501; trace.record("invalid"); assert.equal(fs.statSync(log).size, size);
    const missing = createPollingTrace(path.join(directory, "missing"), () => now, true);
    missing.middleware({ path: "/next" }, res, () => forwarded++); assert.equal(forwarded, 3);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
// Lightroom's actual restricted Lua environment has no os.getenv. Exercise
// unavailable/disabled/failing optional configuration without replacing it with
// a successful stub, and require diagnostics to leave the operation untouched.
for (const environment of ["nil", "function() return nil end", "function() return '0' end", "function() error('environment unavailable') end"]) {
    const disabledSdk = runtime();
    try {
        disabledSdk.run("os.getenv=" + environment + "; io.open=function() error('Unexpected diagnostic I/O') end");
        disabledSdk.run("PollingTrace=(function()\n" + fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin/PollingTrace.lua"), "utf8") + "\nend)()");
        disabledSdk.run(`local t=PollingTrace.new('disabled'); local calls=0
            t.mark('enter','ignored')
            local function pack(...) return { n=select('#',...), ... } end
            local result=pack(t.call('arguments',function(...)
                calls=calls+1; local args=pack(...)
                assert(args.n==4 and args[1]==7 and args[2]==nil and args[3]==9 and args[4]==nil)
                return ...
            end,7,nil,9,nil))
            assert(calls==1 and result.n==4 and result[1]==7 and result[2]==nil and result[3]==9 and result[4]==nil)
            assert(select('#',t.call('noReturns',function() end))==0)
            local failure={}; local ok,err=pcall(function() t.call('failure',function() error(failure) end) end)
            assert(not ok and err==failure)
            local co=coroutine.create(function() return t.call('yield',function(value)
                local a,b,c=coroutine.yield(value,nil,3); return a,b,c
            end,7) end)
            local yielded=pack(coroutine.resume(co)); assert(yielded.n==4 and yielded[1] and yielded[2]==7 and yielded[3]==nil and yielded[4]==3)
            local returned=pack(coroutine.resume(co,8,nil,10)); assert(returned.n==4 and returned[1] and returned[2]==8 and returned[3]==nil and returned[4]==10)
            import=function() return {} end
            require=function(name) assert(name=='DustPasteDiagnostics'); return {fingerprint=function() end} end`);
        disabledSdk.run("Dust=(function()\n" + fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin/Dust.lua"), "utf8") + "\nend)(); Dust.trace({},'ignored')");
        disabledSdk.run("import=function() error('Disabled capture must not import SDK') end; (function()\n" + fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin/CaptureProfile.lua"), "utf8") + "\nend)()");
    } finally { disabledSdk.close(); }
}
const sdk = runtime();
try {
    sdk.run(`_PLUGIN={path='D:/Projects/LRBridge/lightroom/LRBridge.lrplugin'}; unpack=table.unpack or unpack
        os.getenv=function(name) if name=='LRBRIDGE_DEVELOPER_DIAGNOSTICS' then return '1' end end
        traceFiles={}; traceNow=1000; armLine='1010 test-capture'; reads=0
        os.time=function() return traceNow end; os.clock=function() return 1 end
        io.open=function(p,mode)
          if mode=='r' then reads=reads+1; if not armLine then return nil end
            return {read=function() return armLine end,close=function() end}
          end
          return {write=function(_,s) traceFiles[#traceFiles+1]=s end,close=function() end}
        end`);
    sdk.run("PollingTrace=(function()\n" + fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin/PollingTrace.lua"), "utf8") + "\nend)()");
    sdk.run(`local t=PollingTrace.new('feedback'); local calls=0
        local a,b,c=t.call('nilResults',function(x) calls=calls+1;return x,nil,3 end,7)
        assert(a==7 and b==nil and c==3 and calls==1 and #traceFiles==2 and reads==1)
        local co=coroutine.create(function() return t.call('yield',function() coroutine.yield('paused'); return 'done' end) end)
        local ok,v=coroutine.resume(co);assert(ok and v=='paused'); assert(traceFiles[#traceFiles]:find('enter\tyield'))
        ok,v=coroutine.resume(co);assert(ok and v=='done');assert(traceFiles[#traceFiles]:find('return\tyield'))
        ok,v=pcall(function() t.call('error',function() error('original failure') end) end)
        assert(not ok and tostring(v):find('original failure'));assert(traceFiles[#traceFiles]:find('enter\terror'))
        local before=#traceFiles; traceNow=1011;t.mark('enter','expired');assert(#traceFiles==before)
        traceNow=1012;armLine='1020 ../../escape';t.mark('enter','invalid');assert(#traceFiles==before)
        io.open=function() error('disk unavailable') end;traceNow=1013
        assert(t.call('ioFailure',function() return 9 end)==9)
        traceNow=1014;assert(t.call('disabled',function() return 10 end)==10)`);
    for (const name of ["AutoStartPolling.lua", "FeedbackPolling.lua"]) {
        sdk.set("loopSource", fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin", name), "utf8"));
        sdk.run("assert((loadstring or load)(loopSource))");
    }
} finally { sdk.close(); }
console.log("Polling diagnostics: bounded opt-in capture, HTTP/dequeue ordering, expiry, privacy, nil/multiple returns, yielding, original errors and I/O failure isolation passed (simulated).");
