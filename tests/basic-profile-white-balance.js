"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const commands = require("../server/commands");
const definition = require("../server/develop-categorical-state");
const controllerModel = require("../app/controller-develop-categorical");
const { createBridge } = require("../server/bridge");

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }
function drainQueue() { while (commands.getNextCommand() !== null) {} }
function getJson(port, requestPath) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ hostname: "127.0.0.1", port: port, path: requestPath }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                try { resolve({ statusCode: response.statusCode, body: JSON.parse(body) }); }
                catch (error) { reject(error); }
            });
        });
        request.once("error", reject);
    });
}

const controller = read("app/controller.html");
const categoricalLua = read("lightroom/LRBridge.lrplugin/DevelopCategorical.lua");
const driverLua = read("lightroom/LRBridge.lrplugin/Driver.lua");
const categoricalServer = read("server/develop-categorical-state.js") + read("server/bridge.js") + read("server/commands.js");

// Profile selection remains deliberately fail-closed until Lightroom exposes a reliable current-photo list.
assert.doesNotMatch(controller + categoricalServer, /develop-categorical\/(?:profile)(?:[/?"']|$)/i,
    "The Web Controller must not expose Profile selection without an authoritative current-photo option-list API");
assert.doesNotMatch(categoricalLua, /CameraProfile/,
    "Production Lua must not contain speculative Profile writes");
assert.doesNotMatch(controller, /Adobe Color|Camera Matching|Artistic|Vintage/,
    "Profile choices must never be hard-coded as a universal list");

const expectedOptions = [
    { value: "As Shot", label: "As Shot", writable: false },
    { value: "Auto", label: "Auto", writable: true },
    { value: "Daylight", label: "Daylight", writable: true },
    { value: "Cloudy", label: "Cloudy", writable: true },
    { value: "Shade", label: "Shade", writable: true },
    { value: "Tungsten", label: "Tungsten", writable: true },
    { value: "Fluorescent", label: "Fluorescent", writable: true },
    { value: "Flash", label: "Flash", writable: true },
    { value: "Custom", label: "Custom", writable: false }
];
const expectedReadValues = expectedOptions.map(function (option) { return option.value; });
const expectedWriteValues = expectedOptions.filter(function (option) { return option.writable; })
    .map(function (option) { return option.value; });
assert.deepEqual(Array.from(definition.whiteBalanceOptions), expectedOptions);
assert.deepEqual(Array.from(controllerModel.whiteBalanceOptions), expectedOptions);
assert.deepEqual(Array.from(definition.whiteBalanceValues), expectedReadValues);
assert.deepEqual(Array.from(definition.whiteBalanceWritableValues), expectedWriteValues);

assert.match(categoricalLua, /getDevelopSettings\(\)[\s\S]*settings\.WhiteBalance/,
    "White Balance must be read authoritatively from the current photo develop settings");
assert.match(categoricalLua, /local LrTasks = import "LrTasks"[\s\S]*LrTasks\.pcall\(function\(\)[\s\S]*photo:getDevelopSettings\(\)/,
    "White Balance readback must use Lightroom's yield-safe protected call");
assert.doesNotMatch(categoricalLua, /local whiteBalanceOk, whiteBalance = pcall\(/,
    "White Balance readback must not use Lua pcall around the yielding SDK snapshot");
assert.match(categoricalLua, /photo:quickDevelopSetWhiteBalance\(value\)/,
    "Documented preset writes must use Lightroom's dedicated White Balance API");
assert.doesNotMatch(categoricalLua, /LrDevelopController\.(?:getValue|setValue)\("WhiteBalance"/,
    "The verified Lightroom 15.3 As Shot compatibility failure must remain readback-only");
assert.match(categoricalLua,
    /setValue\("WhiteBalance", "As Shot"\) changes[\s\S]*Temperature\/Tint[\s\S]*authoritatively resolves to Custom[\s\S]*As Shot is readback-only/,
    "Production source must preserve the verified Lightroom 15.3 limitation");
assert.match(categoricalLua, /if value == "Auto" then return DevelopCategorical\.setAutoWhiteBalance\(\) end/);
assert.match(driverLua, /setAutoWhiteBalance = function\(\)[\s\S]*DevelopCategorical\.setAutoWhiteBalance\(\)/,
    "The existing Auto White Balance command and selector must share one implementation");
assert.match(controller, /const autoActionCooldownActions = new Set\(\["setAutoTone", "setAutoWhiteBalance"\]\)/,
    "The existing Auto White Balance cooldown protection must remain intact");
assert.match(controller, /isAutoActionCooldownActiveFor\(item\.action\)/,
    "The existing Auto White Balance action must continue to use the guarded action path");

const sectionCategorical = controller.match(/function appendSectionCategoricalControls[\s\S]*?function createDevelopSectionElement/)[0];
assert.match(sectionCategorical,
    /sectionId === "white-balance"[\s\S]*?"whiteBalance", "WB"[\s\S]*?\/api\/develop-categorical\/white-balance/,
    "WB must render in the White Balance section");
const sectionRenderer = controller.match(/function createDevelopSectionElement[\s\S]*?function rerenderColorMixerSection/)[0];
assert.ok(sectionRenderer.indexOf("appendSectionCategoricalControls") < sectionRenderer.indexOf("section.items.forEach"),
    "WB must render immediately above Temperature and Tint");
assert.match(controller, /element\.disabled = option\.writable === false/,
    "As Shot and Custom must remain visible authoritative readback options without becoming writable");
assert.match(controller, /temperatureTintInteractionInProgress\(\)/);
assert.match(controller, /whiteBalanceCommandInProgress\(\)/);
assert.match(controller, /whiteBalanceQueuedSelection = \{ value: value, path: path, generation: generation \}/,
    "The newest unsent WB selection must replace the previous queued selection");
assert.match(controller, /while \(whiteBalanceQueuedSelection !== null\)/,
    "WB selections must use one bounded serial dispatcher");
assert.match(controller, /request\.generation === whiteBalanceSelectionGeneration/,
    "Only the newest WB selection may own confirmation or error feedback");
assert.match(controller, /latest White Balance selection before the timeout/,
    "The latest unconfirmed WB selection must have a bounded timeout");
assert.match(controller, /controlName === "whiteBalance" \? whiteBalanceSelectionBlockedByOtherControl\(\) : busy/,
    "A pending WB request must not disable the responsive selector");
assert.match(controller, /"action": "setAutoWhiteBalance",[\s\S]*?"hiddenInWebController": true/,
    "The duplicate Auto White Balance action must be hidden only in the Web Controller");
assert.match(controller, /function visibleWebControllerActions\(group\)[\s\S]*?item\.hiddenInWebController !== true/,
    "Every action renderer must share one Web-only visibility filter");
assert.match(controller, /const visibleActions = visibleWebControllerActions\(group\);[\s\S]*?if \(visibleActions\.length === 0\) return false/,
    "An action group with no visible rows must not render an empty heading");
const categoricalSelectorFactory = controller.match(/function createDevelopCategoricalSelector[\s\S]*?function appendTransformCategoricalControls/)[0];
assert.match(categoricalSelectorFactory,
    /controlName === "whiteBalance" \|\| controlName === "process" \|\| controlName === "vignetteStyle"[\s\S]*?develop-categorical-subsection-gap/,
    "WB must receive the same 40px subsection gap as Process and Style");

const availableState = {
    whiteBalanceAvailable: true, whiteBalance: "Auto",
    processAvailable: true, process: "Version 6",
    vignetteStyleAvailable: true, vignetteStyle: 1,
    uprightModeAvailable: true, uprightMode: 0,
    constrainCropAvailable: true, constrainCrop: 0,
    selectedToolAvailable: true, selectedTool: "loupe"
};
const model = controllerModel.createModel();
assert.equal(model.apply(availableState, 10).accepted, true);
assert.equal(model.presentation("whiteBalance").authoritativeValue, "Auto");
for (const value of expectedWriteValues) {
    assert.equal(model.begin("whiteBalance", value, 10), true, value + " must be writable");
    model.cancel("whiteBalance");
}
for (const value of ["As Shot", "Custom", "Unknown", "auto", ""]) {
    assert.equal(model.begin("whiteBalance", value, 10), false, value + " must fail closed");
}

assert.equal(model.begin("whiteBalance", "Auto", 10, 1), true);
assert.equal(model.begin("whiteBalance", "Daylight", 10, 2), true);
assert.equal(model.begin("whiteBalance", "Cloudy", 10, 3), true);
assert.deepEqual(model.getPending("whiteBalance"), { value: "Cloudy", afterRevision: 10, generation: 3 },
    "Rapid Auto -> Daylight -> Cloudy must leave only Cloudy owning pending state");
let applied = model.apply(Object.assign({}, availableState, { whiteBalance: "Auto" }), 11);
assert.deepEqual(applied.rejected, [], "Older Auto feedback must not reject Cloudy");
assert.equal(model.getPending("whiteBalance").value, "Cloudy");
applied = model.apply(Object.assign({}, availableState, { whiteBalance: "Daylight" }), 12);
assert.deepEqual(applied.rejected, [], "Older Daylight feedback must not reject Cloudy");
assert.equal(model.getPending("whiteBalance").value, "Cloudy");
assert.equal(model.begin("whiteBalance", "Daylight", 12, 2), false,
    "A stale response must not restore an older WB generation");
assert.equal(model.cancel("whiteBalance", 2), false,
    "A stale failure must not cancel the newest WB generation");
applied = model.apply(Object.assign({}, availableState, { whiteBalance: "Cloudy" }), 13);
assert.deepEqual(applied.confirmed, ["whiteBalance"]);
assert.equal(model.getPending("whiteBalance"), null);
assert.equal(model.presentation("whiteBalance").authoritativeValue, "Cloudy");

assert.equal(model.begin("whiteBalance", "Shade", 13, 4), true);
assert.equal(model.cancel("whiteBalance", 4), true,
    "An explicit failure for the latest WB generation must clear it immediately");
assert.equal(model.begin("whiteBalance", "Flash", 13, 5), true);
assert.equal(model.cancel("whiteBalance", 5), true,
    "The confirmation timeout must be able to expire the latest WB generation");

applied = model.apply(Object.assign({}, availableState, { whiteBalance: "Custom" }), 14);
assert.equal(applied.accepted, true);
assert.equal(model.presentation("whiteBalance").authoritativeValue, "Custom",
    "Manual Temperature/Tint readback must switch WB to Custom");
applied = model.apply(Object.assign({}, availableState, { whiteBalance: "Tungsten" }), 15);
assert.equal(model.presentation("whiteBalance").authoritativeValue, "Tungsten",
    "Direct Lightroom changes must update immediately when no Web request is pending");
const unavailableState = Object.assign({}, availableState, { whiteBalanceAvailable: false, whiteBalance: null });
assert.equal(model.apply(unavailableState, 16).accepted, true);
assert.equal(model.presentation("whiteBalance").available, false);
assert.equal(model.presentation("whiteBalance").authoritativeValue, null);

for (const value of expectedWriteValues) {
    assert.equal(commands.validateCommand({ command: "develop_categorical.white_balance.set", value: value }), true);
}
for (const value of ["As Shot", "Custom", "Unknown", "Auto ", 1, null]) {
    assert.equal(commands.validateCommand({ command: "develop_categorical.white_balance.set", value: value }), false);
}
assert.equal(commands.validateCommand({ command: "develop_categorical.white_balance.set", value: "Auto", extra: true }), false);

function resultPath(whiteBalanceAvailable, whiteBalance) {
    return "/develop-categorical/result?whiteBalanceAvailable=" + String(whiteBalanceAvailable) +
        (whiteBalanceAvailable ? "&whiteBalance=" + encodeURIComponent(whiteBalance) : "") +
        "&processAvailable=true&process=Version%206&vignetteStyleAvailable=true&vignetteStyle=1" +
        "&uprightModeAvailable=true&uprightMode=0&constrainCropAvailable=true&constrainCrop=0" +
        "&selectedToolAvailable=true&selectedTool=loupe";
}

async function runTransportTests() {
    drainQueue();
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40 });
    const originalLog = console.log;
    console.log = function () {};
    try {
        await bridge.start();
        const port = bridge.getHttpServer().address().port;
        let response = await getJson(port, "/develop-categorical/white-balance?value=Daylight");
        assert.equal(response.statusCode, 409, "WB writes must fail closed before authoritative availability");

        response = await getJson(port, resultPath(true, "As Shot"));
        assert.equal(response.statusCode, 200);
        response = await getJson(port, "/develop-categorical/state");
        assert.equal(response.body.state.whiteBalance, "As Shot");

        for (const value of ["As%20Shot", "Custom", "Unknown", "Auto%20", ""] ) {
            response = await getJson(port, "/develop-categorical/white-balance?value=" + value);
            assert.equal(response.statusCode, 400, value + " must not reach Lightroom");
        }

        const beforeRapid = commands.getQueueDiagnostics();
        for (const value of ["Auto", "Daylight", "Cloudy"]) {
            response = await getJson(port, "/develop-categorical/white-balance?value=" + value);
            assert.equal(response.statusCode, 200, value + " must be admitted during rapid WB selection");
        }
        response = await getJson(port, "/develop-categorical/state");
        assert.equal(response.body.state.whiteBalanceAvailable, true,
            "Queue admission must preserve the last authoritative WB state");
        assert.equal(response.body.state.whiteBalance, "As Shot");
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop_categorical.white_balance.set",
            value: "Cloudy"
        }, "Only the latest unsent WB command may remain queued");
        const afterRapid = commands.getQueueDiagnostics();
        assert.equal(afterRapid.counters.coalescedCommands, beforeRapid.counters.coalescedCommands + 2);

        response = await getJson(port, resultPath(true, "Cloudy"));
        assert.equal(response.statusCode, 200);

        response = await getJson(port, resultPath(true, "Custom"));
        assert.equal(response.statusCode, 200);
        response = await getJson(port, "/develop-categorical/state");
        assert.equal(response.body.state.whiteBalance, "Custom");

        response = await getJson(port, resultPath(false, null));
        assert.equal(response.statusCode, 200);
        response = await getJson(port, "/develop-categorical/state");
        assert.equal(response.body.state.whiteBalanceAvailable, false);
        assert.equal(response.body.state.whiteBalance, null);

        response = await getJson(port, resultPath(true, "Arbitrary"));
        assert.equal(response.statusCode, 400, "Unknown authoritative strings must be rejected");
    } finally {
        console.log = originalLog;
        await bridge.stop();
        drainQueue();
    }
}

runTransportTests().then(function () {
    console.log("Profile fail-closed and White Balance production tests passed.");
}).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
