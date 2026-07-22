const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pollingFiles = [
    "lightroom/LRBridge.lrplugin/AutoStartPolling.lua",
    "lightroom/LRBridge.lrplugin/StartPolling.lua"
];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function functionBlock(source, declaration) {
    const start = source.indexOf(declaration);
    assert.notEqual(start, -1, "Missing " + declaration);

    const lines = source.slice(start).split(/\r?\n/);
    let depth = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].replace(/--.*$/, "");
        const opens = (line.match(/\bfunction\b|\bif\b[^\n]*\bthen\b|\bwhile\b[^\n]*\bdo\b|\bfor\b[^\n]*\bdo\b/g) || []).length;
        const closes = (line.match(/^\s*end\)?\s*$/g) || []).length;
        depth += opens - closes;
        if (index > 0 && depth === 0) return lines.slice(0, index + 1).join("\n");
    }

    assert.fail("Unterminated " + declaration);
}

function compact(value) {
    return value.replace(/\s+/g, " ").trim();
}

function validatePollingFile(relativePath) {
    const source = read(relativePath);
    const helper = functionBlock(source, "local function executeCommand(command)");
    const loop = functionBlock(source, "LrTasks.startAsyncTask(function()");

    assert.equal((source.match(/Commands\.execute/g) || []).length, 1, relativePath + " must execute a command exactly once");
    assert.match(source, /local LrTasks = import "LrTasks"/, relativePath + " must import LrTasks");
    assert.match(helper, /local success, failure = LrTasks\.pcall\(Commands\.execute, command\)/, relativePath + " must protect the actual Commands.execute call with Lightroom's yield-safe pcall");
    assert.doesNotMatch(source, /(?<![.\w])pcall\s*\(\s*Commands\.execute\s*,\s*command\s*\)/, relativePath + " must not protect Commands.execute with standard Lua pcall");

    const busyStart = helper.indexOf("_G.LRBridgeCommandBusy = true");
    const execution = helper.indexOf("LrTasks.pcall(Commands.execute, command)");
    const busyEnd = helper.indexOf("_G.LRBridgeCommandBusy = false");
    const clock = helper.indexOf("pcall(os.clock)");
    const completion = helper.indexOf("_G.LRBridgeLastCommandFinishedAt = finishedAt");
    const failureLog = helper.indexOf("pcall(function()");
    assert.ok(busyStart < execution && execution < busyEnd, relativePath + " must clear busy after the protected attempt");
    assert.ok(busyEnd < clock && clock < completion, relativePath + " must keep completion bookkeeping reachable after failure");
    assert.ok(completion < failureLog, relativePath + " must complete cleanup before failure logging");
    assert.match(helper.slice(failureLog), /pcall\(function\(\)[\s\S]*log\("command execution failed: " \.\. formatExecutionError\(failure\)\)[\s\S]*end\)/, relativePath + " must protect error formatting and logging");

    assert.doesNotMatch(helper, /retry|requeue|enqueue/i, relativePath + " must not retry or requeue failures");
    assert.match(loop, /executeCommand\(command\)[\s\S]*LrTasks\.sleep\(config\.pollInterval\)/, relativePath + " must continue to the existing polling sleep");
    assert.match(source, /if _G\.LRBridgePollingStarted == true then[\s\S]*return[\s\S]*_G\.LRBridgePollingStarted = true/, relativePath + " must retain duplicate-polling prevention");
    assert.equal((source.match(/LrHttp\.get\("http:\/\/127\.0\.0\.1:17891\/next"\)/g) || []).length, 1, relativePath + " polling endpoint changed");
    assert.equal((source.match(/LrTasks\.sleep\(config\.pollInterval\)/g) || []).length, 1, relativePath + " polling interval behavior changed");

    const formatter = functionBlock(source, "local function formatExecutionError(failure)");
    assert.match(formatter, /\[redacted URL\]/);
    assert.match(formatter, /\[redacted path\]/);
    assert.doesNotMatch(helper, /json|serialize|stringify|command\.slider|command\.photo|command\.path|tostring\(command\)/i, relativePath + " failure logging must not serialize command or photo context");

    return { helper: compact(helper), formatter: compact(formatter) };
}

const automatic = validatePollingFile(pollingFiles[0]);
const manual = validatePollingFile(pollingFiles[1]);
assert.equal(manual.helper, automatic.helper, "Automatic and manual command failure containment must remain equivalent");
assert.equal(manual.formatter, automatic.formatter, "Automatic and manual error redaction must remain equivalent");

const packageJson = JSON.parse(read("package.json"));
const chain = packageJson.scripts.test.split(" && ");
assert.equal(chain.filter((entry) => entry === "npm run test:lua-polling").length, 1, "test:lua-polling must occur exactly once");
assert.equal(chain[chain.indexOf("npm run test:controller-shutdown") + 1], "npm run test:lua-polling", "test:lua-polling must immediately follow test:controller-shutdown");
assert.equal(chain[chain.indexOf("npm run test:lua-polling") + 1], "npm run test:lua-selection", "selection source checks must follow polling resilience checks");
assert.equal(packageJson.scripts["test:lua-polling"], "node tests/lua-polling-resilience.js");
assert.equal(packageJson.scripts["test:lua-selection"], "node tests/lua-selection-dispatch.js");
assert.equal(packageJson.version, "0.6.0", "Application version changed");
assert.match(read("lightroom/LRBridge.lrplugin/Info.lua"), /VERSION = \{ major = 1, minor = 0, revision = 0 \}/, "Plugin version changed");

console.log("Lua polling resilience tests passed (source tests cannot prove Lightroom yield behavior; Lightroom runtime testing is still required).");
