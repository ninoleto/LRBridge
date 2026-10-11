"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const commands = require("../server/commands"), context = require("../server/context");
const { createBridge } = require("../server/bridge"), { runtime } = require("./masking-create");
const { runtime: nudgeRuntime } = require("./numeric-nudge");
async function verify() {
    const log = console.log, logs = []; console.log = (...args) => logs.push(args);
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20 });
    commands.resetQueueForTests();
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const get = async route => { const r = await fetch(base + route); assert.equal(r.status, 200, route); return r.json(); };
    try {
        context.updateContext({ activeModule: "develop", selectedPhotoUuid: "creation-photo", developFingerprint: "quiet" });
        for (const family of ["clipboard", "export"]) {
            const sdk = runtime(); sdk.run(fs.readFileSync(path.join(__dirname, family + ".lua"), "utf8"));
            try {
                logs.length = 0;
                await get("/" + family + "/state");
                const command = commands.getNextCommand(); assert.equal(command.command, family + ".query");
                assert.equal(logs.filter(args => args[0] === "Queued command:" || args[0] === "Queue length:").length, 0);
                sdk.set("commandJson", JSON.stringify(command)); sdk.run(family + "Run()");
                const url = new URL(sdk.result()); await get(url.pathname + url.search);
                const state = await get("/" + family + "/state");
                assert.equal(state.available, true, "quiet queries still update actual server state");
                assert.equal(state.selectionCount, 2);
                assert.equal(commands.getNextCommand(), null);
            } finally { sdk.close(); }
        }
        logs.length = 0;
        commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: 1 });
        assert.equal(logs.filter(args => args[0] === "Queued command:").length, 1);
        assert.equal(logs.filter(args => args[0] === "Queue length:").length, 1);
        commands.getNextCommand();
        // Exercise the real polling loop: only its two routine receipt logs are
        // suppressed; execution, sleep count, explicit trace and failures survive.
        const sdk = nudgeRuntime();
        try {
            sdk.run(`
                local http, tasks = import "LrHttp", import "LrTasks"
                local frames = {
                    '{"command":"clipboard.query"}', '{"command":"export.query"}',
                    '{"command":"develop.set","slider":"Exposure","value":1}',
                    '{"command":"clipboard.query"}', '{"command":"export.query"}'
                }
                local index, calls, delays, failures, traces = 0, 0, 0, 0, 0
                local lines = {}
                io.open = function() return { write = function(_, text) lines[#lines + 1] = text end, close = function() end } end
                _PLUGIN = { path = "D:/fixture/lightroom/LRBridge.lrplugin" }
                package.loaded.Settings = { load = function() return { pollInterval = 0.1 } end }
                package.loaded.PollingTrace = { new = function() return {
                    mark = function() traces = traces + 1 end,
                    call = function(_, fn, ...) return fn(...) end
                } end }
                package.loaded.Commands = { execute = function(c)
                    calls = calls + 1
                    if calls >= 4 then failures = failures + 1; error("query SDK failure") end
                end }
                http.get = function(url) assert(string.find(url, "/next", 1, true)); index = index + 1; return frames[index] end
                tasks.sleep = function(t) assert(t == 0.1); delays = delays + 1 end
                dofile("lightroom/LRBridge.lrplugin/AutoStartPolling.lua")(function() return index <= #frames end)
                local combined = table.concat(lines)
                assert(calls == 5 and delays == 5 and failures == 2 and traces > 0)
                assert(not string.find(combined, "command received: clipboard.query", 1, true))
                assert(not string.find(combined, "command received: export.query", 1, true))
                assert(string.find(combined, "command received: develop.set", 1, true))
                local count = 0; for _ in string.gmatch(combined, "command execution failed:") do count = count + 1 end
                assert(count == 2, "Both query failures remain logged")
            `);
        } finally { sdk.close(); }
    } finally { await bridge.stop(); commands.resetQueueForTests(); console.log = log; }
    console.log("Quiet clipboard/export queries: real query execution and state updates retained; queue and worker receipt noise suppressed; editing logs, SDK failures, polling cadence and explicit traces retained (isolated).");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verify };
