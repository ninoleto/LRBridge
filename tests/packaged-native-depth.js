"use strict";
// Explicit package gate: real read-only helper lifecycle from packaged Electron
// in Node mode. No desktop launch, live bridge ports, SDK commands or UI input.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const folder = path.resolve(process.argv.at(-1));
const executable = path.join(folder, "LRBridge.exe");
assert(fs.existsSync(executable), "Supply the extracted Windows candidate folder");

function withTimeout(promise, milliseconds, description) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(description + " timed out")), milliseconds);
    })]).finally(() => clearTimeout(timer));
}

if (!process.argv.includes("--inside")) {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete env.LRBRIDGE_DEVELOPER_DIAGNOSTICS;
    const result = cp.spawnSync(executable, [__filename, "--inside", folder], {
        env, windowsHide: true, encoding: "utf8", timeout: 30000
    });
    process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Packaged read-only depth helper lifecycle failed");
} else (async function () {
    assert.equal(process.platform, "win32");
    assert.equal(path.resolve(process.execPath).toLowerCase(), executable.toLowerCase());
    const resources = path.join(folder, "resources");
    const native = require(path.join(resources, "app.asar/server/windows-lightroom-native"));
    const helper = path.join(resources, "native/windows-lightroom-native.ps1");
    const files = ["config/settings.txt", "config/develop-presets.json"];
    const before = files.map(file => fs.readFileSync(path.join(folder, file)));
    const cycles = [];
    // The desktop supplies process.resourcesPath; Electron Node mode can omit it.
    // Use that same package resource directory, without overriding scriptPath.
    if (process.resourcesPath) assert.equal(path.resolve(process.resourcesPath).toLowerCase(), resources.toLowerCase());
    for (let cycle = 0; cycle < 2; cycle++) {
        const children = [], requests = [];
        const backend = native.createWindowsLightroomNativeBackend({ resourcesPath: resources, spawn(command, args, options) {
            assert.equal(command, "powershell.exe");
            assert.equal(path.resolve(args[args.indexOf("-File") + 1]).toLowerCase(), helper.toLowerCase(), "Use the external packaged helper");
            assert.equal(options.windowsHide, true);
            const child = cp.spawn(command, args, options);
            const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
            const write = child.stdin.write.bind(child.stdin);
            child.stdin.write = function (chunk, ...rest) {
                const request = JSON.parse(String(chunk));
                assert.equal(request.operation, "readDepthVisualization", "Only the requested read-only check may reach Lightroom");
                requests.push(request);
                return write(chunk, ...rest);
            };
            children.push({ child, closed }); return child;
        } });
        try {
            const results = [];
            for (let read = 0; read < 2; read++) {
                const result = await withTimeout(backend.readDepthVisualization(), 10000, "Packaged native read");
                assert.equal(typeof result.available, "boolean");
                assert(result.available ? typeof result.value === "boolean" : result.value === null);
                results.push(result);
            }
            const state = backend.getTransportDiagnostics();
            assert.equal(children.length, 1, "Two reads reuse exactly one helper");
            assert.equal(state.helperPid, null, "No unrelated shared action helper was started");
            assert.equal(state.depthObserver.helperPid, children[0].child.pid);
            assert.equal(state.depthObserver.completed, 2);
            assert.equal(state.depthObserver.timedOut, 0);
            assert.equal(state.depthObserver.pendingCount, 0);
            assert.equal(state.depthObserver.queueDepth, 0);
            assert.equal(new Set(requests.map(request => request.id)).size, 2, "Each read obtains a fresh result");
            cycles.push({ cycle: cycle + 1, helperPid: state.depthObserver.helperPid, reads: results });
        } finally {
            await backend.stop();
            try { await withTimeout(Promise.all(children.map(item => item.closed)), 5000, "Packaged helper shutdown"); }
            finally {
                // Fail-safe cleanup is limited to child processes this test created.
                for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill();
            }
            assert.equal(backend.getTransportDiagnostics().depthObserver, undefined);
        }
        assert(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null), "No child helper survives shutdown");
    }
    files.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(folder, file)), before[index]));
    console.log(JSON.stringify({ passed: true, scope: "Packaged Electron Node mode; real read-only depth helper start/reuse/stop/restart; no desktop or SDK edits",
        executable, helper, settingsPreserved: true, cycles }));
})().catch(error => { console.error(error); process.exitCode = 1; });
