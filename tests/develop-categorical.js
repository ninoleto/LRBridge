"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const commands = require("../server/commands");
const definition = require("../server/develop-categorical-state");
const controller = require("../app/controller-develop-categorical");
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

const expectedProcesses = [
    { value: "Version 6", label: "Version 6 (Current)" },
    { value: "Version 5", label: "Version 5" },
    { value: "Version 4", label: "Version 4" },
    { value: "Version 3", label: "Version 3 (2012)" },
    { value: "Version 2", label: "Version 2 (2010)" },
    { value: "Version 1", label: "Version 1 (2003)" }
];
const expectedStyles = [
    { value: 1, label: "Highlight Priority" },
    { value: 2, label: "Color Priority" },
    { value: 3, label: "Paint Overlay" }
];
const expectedUpright = [
    { value: 0, label: "Off" },
    { value: 1, label: "Auto" },
    { value: 5, label: "Guided" },
    { value: 3, label: "Level" },
    { value: 4, label: "Vertical" },
    { value: 2, label: "Full" }
];

assert.deepEqual(Array.from(definition.processOptions), expectedProcesses);
assert.deepEqual(Array.from(definition.vignetteStyleOptions), expectedStyles);
assert.deepEqual(Array.from(definition.uprightModeOptions), expectedUpright);
assert.deepEqual(Array.from(controller.processOptions), expectedProcesses);
assert.deepEqual(Array.from(controller.vignetteStyleOptions), expectedStyles);
assert.deepEqual(Array.from(controller.uprightModeOptions), expectedUpright);
assert.deepEqual(definition.capabilities.transformUpdate.available, false);
assert.deepEqual(definition.capabilities.transformUpdate.enabled, false);

const availableState = {
    whiteBalanceAvailable: true, whiteBalance: "As Shot",
    processAvailable: true, process: "Version 6",
    vignetteStyleAvailable: true, vignetteStyle: 1,
    uprightModeAvailable: true, uprightMode: 0,
    constrainCropAvailable: true, constrainCrop: 0,
    selectedToolAvailable: true, selectedTool: "loupe"
};
assert.deepEqual(definition.sanitizeState(availableState), availableState);
assert.equal(definition.sanitizeState(Object.assign({}, availableState, { process: "Version 7" })), null);
assert.equal(definition.sanitizeState(Object.assign({}, availableState, { vignetteStyle: 0 })), null);
assert.equal(definition.sanitizeState(Object.assign({}, availableState, { uprightMode: 6 })), null);
assert.equal(definition.sanitizeState(Object.assign({}, availableState, { constrainCrop: 2 })), null);

const model = controller.createModel();
assert.equal(model.apply(availableState, 4).accepted, true);
assert.equal(model.begin("process", "Version 5", 4), true);
let applied = model.apply(Object.assign({}, availableState, { process: "Version 5" }), 4);
assert.equal(applied.duplicate, true);
assert.ok(model.getPending("process"), "A duplicate revision must not confirm a Web change");
applied = model.apply(availableState, 5);
assert.deepEqual(applied.confirmed, []);
assert.ok(model.getPending("process"), "A fresh mismatching revision must remain pending");
applied = model.apply(Object.assign({}, availableState, { process: "Version 5" }), 6);
assert.deepEqual(applied.confirmed, ["process"]);
assert.equal(model.getPending("process"), null);
assert.equal(model.begin("uprightMode", 5, 6), true);
applied = model.apply(Object.assign({}, availableState, { uprightMode: 5 }), 7);
assert.deepEqual(applied.confirmed, ["uprightMode"]);
assert.equal(model.begin("uprightMode", 6, 7), false);

function createButtonDouble() {
    const classes = new Set(["command-neutral"]);
    const attributes = {};
    return {
        disabled: false,
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attributes[name] = value; },
        getAttribute(name) { return attributes[name]; }
    };
}

const uprightButtons = Object.fromEntries(expectedUpright.map((option) => [String(option.value), createButtonDouble()]));
function assertUprightButtonPresentation(activeValue, disabled, pendingValue) {
    for (const option of expectedUpright) {
        const button = uprightButtons[String(option.value)];
        const active = option.value === activeValue;
        assert.equal(button.classList.contains("active"), active, option.label + " active class drifted");
        assert.equal(button.getAttribute("aria-pressed"), String(active), option.label + " aria-pressed drifted");
        assert.equal(button.disabled, disabled, option.label + " disabled state drifted");
        assert.equal(button.classList.contains("pending"), option.value === pendingValue, option.label + " pending class drifted");
    }
}

const buttonModel = controller.createModel();
assert.equal(buttonModel.apply(Object.assign({}, availableState, { uprightMode: 3 }), 20).accepted, true);
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), false);
assertUprightButtonPresentation(3, false, null);

assert.equal(buttonModel.apply(Object.assign({}, availableState, { uprightMode: 4 }), 21).accepted, true);
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), false);
assertUprightButtonPresentation(4, false, null);

assert.equal(buttonModel.apply(Object.assign({}, availableState, { uprightMode: 3 }), 20).accepted, false);
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), false);
assertUprightButtonPresentation(4, false, null);
const duplicate = buttonModel.apply(Object.assign({}, availableState, { uprightMode: 3 }), 21);
assert.equal(duplicate.duplicate, true);
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), false);
assertUprightButtonPresentation(4, false, null);

assert.equal(buttonModel.begin("uprightMode", 3, 21), true);
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), true);
assertUprightButtonPresentation(4, true, 3);
buttonModel.cancel("uprightMode");
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), false);
assertUprightButtonPresentation(4, false, null);

buttonModel.reset();
controller.syncUprightButtons(uprightButtons, buttonModel.presentation("uprightMode"), false);
assertUprightButtonPresentation(null, true, null);

const binaryButtons = { "0": createButtonDouble(), "1": createButtonDouble() };
function assertConstrainCropPresentation(activeValue, disabled, pendingValue) {
    for (const value of [0, 1]) {
        const button = binaryButtons[String(value)];
        const active = value === activeValue;
        assert.equal(button.classList.contains("active"), active, "Constrain Crop " + value + " active class drifted");
        assert.equal(button.getAttribute("aria-pressed"), String(active), "Constrain Crop " + value + " aria drifted");
        assert.equal(button.disabled, disabled, "Constrain Crop " + value + " disabled state drifted");
        assert.equal(button.classList.contains("pending"), value === pendingValue, "Constrain Crop " + value + " pending state drifted");
    }
}
const constrainModel = controller.createModel();
assert.equal(constrainModel.apply(availableState, 30).accepted, true);
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), false);
assertConstrainCropPresentation(0, false, null);
assert.equal(constrainModel.begin("constrainCrop", 1, 30), true);
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), true);
assertConstrainCropPresentation(0, true, 1);
let constrainApplied = constrainModel.apply(Object.assign({}, availableState, { constrainCrop: 1 }), 30);
assert.equal(constrainApplied.duplicate, true);
assert.ok(constrainModel.getPending("constrainCrop"), "Duplicate feedback must not confirm Constrain Crop");
constrainApplied = constrainModel.apply(Object.assign({}, availableState, { constrainCrop: 1 }), 31);
assert.deepEqual(constrainApplied.confirmed, ["constrainCrop"]);
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), false);
assertConstrainCropPresentation(1, false, null);
assert.equal(constrainModel.apply(Object.assign({}, availableState, { constrainCrop: 0 }), 32).accepted, true);
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), false);
assertConstrainCropPresentation(0, false, null);
assert.equal(constrainModel.apply(Object.assign({}, availableState, { constrainCrop: 1 }), 31).accepted, false);
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), false);
assertConstrainCropPresentation(0, false, null);
assert.equal(constrainModel.begin("constrainCrop", 1, 32), true);
constrainModel.cancel("constrainCrop");
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), false);
assertConstrainCropPresentation(0, false, null);
constrainModel.reset();
controller.syncBinaryButtons(binaryButtons, constrainModel.presentation("constrainCrop"), false);
assertConstrainCropPresentation(null, true, null);

for (const command of [
    { command: "develop_categorical.white_balance.set", value: "Daylight" },
    { command: "develop_categorical.process.set", value: "Version 6" },
    { command: "develop_categorical.vignette_style.set", value: 3 },
    { command: "develop_categorical.upright_mode.set", value: 5 },
    { command: "develop_categorical.constrain_crop.set", value: 1 },
    { command: "develop_categorical.upright_tool.select" }
]) assert.equal(commands.validateCommand(command), true, JSON.stringify(command));
for (const command of [
    { command: "develop_categorical.white_balance.set", value: "Custom" },
    { command: "develop_categorical.white_balance.set", value: "Arbitrary" },
    { command: "develop_categorical.process.set", value: "Version 7" },
    { command: "develop_categorical.vignette_style.set", value: 0 },
    { command: "develop_categorical.upright_mode.set", value: 6 },
    { command: "develop_categorical.constrain_crop.set", value: 2 },
    { command: "develop_categorical.upright_tool.select", value: "upright" }
]) assert.equal(commands.validateCommand(command), false, JSON.stringify(command));

const lua = read("lightroom/LRBridge.lrplugin/DevelopCategorical.lua");
const polling = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const dispatch = read("lightroom/LRBridge.lrplugin/Commands.lua");
assert.match(lua, /getProcessVersion\(\)/);
assert.match(lua, /getDevelopSettings\(\)[\s\S]*?settings\.WhiteBalance/);
assert.match(lua, /quickDevelopSetWhiteBalance\(value\)/);
assert.doesNotMatch(lua, /LrDevelopController\.setValue\("WhiteBalance"/,
    "As Shot must remain readback-only after the verified Lightroom 15.3 runtime failure");
assert.match(lua, /setProcessVersion\(value\)/);
for (let version = 1; version <= 6; version += 1) assert.ok(lua.includes('["Version ' + version + '"] = true'));
assert.match(lua, /getValue\("PostCropVignetteStyle"\)/);
assert.match(lua, /setValue\("PostCropVignetteStyle", value\)/);
assert.match(lua, /local vignetteStyleValues = \{ \[1\] = true, \[2\] = true, \[3\] = true \}/);
assert.match(lua, /getValue\("PerspectiveUpright"\)/);
assert.match(lua, /setValue\("PerspectiveUpright", value\)/);
assert.match(lua, /local uprightModeValues = \{ \[0\] = true, \[1\] = true, \[2\] = true, \[3\] = true, \[4\] = true, \[5\] = true \}/);
assert.match(lua, /getValue\("CropConstrainToWarp"\)/);
assert.match(lua, /setValue\("CropConstrainToWarp", value\)/);
assert.match(lua, /type\(constrainCrop\) == "number"/);
assert.match(lua, /local constrainCropValues = \{ \[0\] = true, \[1\] = true \}/);
assert.match(lua, /selectTool\("upright"\)/);
assert.doesNotMatch(lua, /SendInput|SetCursorPos|keybd_event|mouse_event|Update\s*\(/i);
assert.match(polling, /require "DevelopCategorical"/);
assert.match(polling, /develop-categorical\/next/);
for (const name of ["develop_categorical.white_balance.set", "develop_categorical.process.set", "develop_categorical.vignette_style.set",
    "develop_categorical.upright_mode.set", "develop_categorical.constrain_crop.set",
    "develop_categorical.upright_tool.select"]) assert.ok(dispatch.includes(name));

const html = read("app/controller.html");
const inlineController = html.match(/<script>\s*(const sliderGroups =[\s\S]*?)<\/script>/)[1];
assert.doesNotThrow(function () { new Function(inlineController); }, "Web Controller inline JavaScript must parse");
assert.match(html, /"vignetteStyle", "Style"[\s\S]*?\/api\/develop-categorical\/vignette-style/);
assert.match(html, /"whiteBalance", "WB"[\s\S]*?\/api\/develop-categorical\/white-balance/);
assert.match(html, /"process", "Process"[\s\S]*?\/api\/develop-categorical\/process/);
assert.match(html, /toolName\.textContent = "Upright Tool"/);
assert.match(html, /updateName\.textContent = "Upright Update"/);
assert.match(html, /updateButton\.textContent = "Update";[\s\S]*?updateButton\.disabled = true/);
assert.match(html, /updateControl\.button\.disabled = capability\.available !== true \|\| capability\.enabled !== true/);
assert.match(html, /"Unavailable through Lightroom SDK 15\.3"/,
    "Unsupported Upright Update must use a short, unobtrusive capability note");
assert.match(html, /developCategoricalHelper\.syncUprightButtons\(uprightControl\.buttons, presentation, busy\)/,
    "Every categorical presentation refresh must synchronize Upright buttons directly");
assert.match(html, /\.develop-categorical-options button\.active:hover[\s\S]*?background:\s*#2a6f97/,
    "Sticky touch hover must not hide an authoritative active Upright button");
const transformCategoricalBlock = html.match(/function appendTransformCategoricalControls[\s\S]*?function appendConstrainCropControl/)[0];
assert.match(transformCategoricalBlock, /modeRow\.className = "develop-categorical-upright touch-group-gap"/);
assert.doesNotMatch(transformCategoricalBlock, /modeName|textContent = "Mode"/,
    "Upright must not render the redundant boxed Mode label");
assert.doesNotMatch(transformCategoricalBlock, /heading\.textContent = "UPRIGHT"|textContent = "UPRIGHT"/,
    "Transform must not render a redundant standalone UPRIGHT subsection heading");
assert.match(transformCategoricalBlock, /modeStatus\.setAttribute\("aria-live", "polite"\)/);
const transformLayoutMarkers = [
    'toolName.textContent = "Upright Tool"',
    'updateName.textContent = "Upright Update"',
    'modeRow.className = "develop-categorical-upright touch-group-gap"'
];
let transformLayoutIndex = -1;
for (const marker of transformLayoutMarkers) {
    const index = transformCategoricalBlock.indexOf(marker);
    assert.ok(index > transformLayoutIndex, "Transform categorical layout drifted at " + marker);
    transformLayoutIndex = index;
}
assert.match(html, /\.develop-categorical-options\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/,
    "Upright modes must use three columns and two rows");
assert.match(html, /\.touch-group-gap\s*\{\s*margin-bottom:\s*18px;\s*\}/,
    "Categorical and action blocks must share one touch-safe spacing token");
assert.match(html, /row\.className = "develop-categorical-row touch-group-gap"/,
    "Categorical rows must retain the shared touch-safe spacing");
assert.match(html, /\.develop-categorical-subsection-gap\s*\{\s*margin-bottom:\s*40px;\s*\}/,
    "WB, Process, and Style must have the larger subsection separation requested for touchscreens");
assert.match(html, /controlName === "whiteBalance" \|\| controlName === "process" \|\| controlName === "vignetteStyle"\)[\s\S]*?row\.classList\.add\("develop-categorical-subsection-gap"\)/,
    "The larger subsection gap must apply specifically to WB, Process, and Style");
assert.equal((html.match(/classList\.add\("develop-categorical-subsection-gap"\)/g) || []).length, 1,
    "The larger subsection gap must have only one guarded assignment path");
assert.doesNotMatch(html, /sliderControl\.classList\.add\("develop-categorical-subsection-gap"\)|develop-slider-row[^"\n]*develop-categorical-subsection-gap/,
    "The larger subsection gap must not be applied to ordinary slider rows");
assert.match(transformCategoricalBlock, /toolRow\.className = "develop-categorical-row touch-group-gap"[\s\S]*?updateRow\.className = "develop-categorical-row touch-group-gap"[\s\S]*?modeRow\.className = "develop-categorical-upright touch-group-gap"/,
    "Each Upright block must keep independent touch-safe separation");
assert.match(html, /status\.classList\.add\("visually-hidden"\)[\s\S]*?Current Upright mode:/,
    "Confirmed Upright text must remain accessible without a redundant visible mode word");
const sectionFunction = html.match(/function createDevelopSectionElement[\s\S]*?function rerenderColorMixerSection/)[0];
assert.ok(sectionFunction.indexOf("appendSectionCategoricalControls") < sectionFunction.indexOf("section.items.forEach"),
    "Categorical controls must render above their section sliders");
assert.ok(sectionFunction.indexOf("appendSectionCategoricalControls") < sectionFunction.indexOf("createSectionControls(section, \"leading\")"),
    "Upright Tool, Update, and modes must render before Reset Transform");
assert.ok(sectionFunction.indexOf("createSectionControls(section, \"leading\")") < sectionFunction.indexOf("section.items.forEach"),
    "Reset Transform must render before the Transform sliders");
assert.ok(sectionFunction.indexOf("section.items.forEach") < sectionFunction.indexOf("appendConstrainCropControl"),
    "Constrain Crop must remain after the final Transform slider");
assert.match(sectionFunction, /section\.id === "transform"\) leadingControls\.classList\.add\("transform-reset-subsection-gap"\)/,
    "Reset Transform must have the larger subsection separation from the first Transform slider");
assert.match(html, /\.transform-reset-subsection-gap\s*\{\s*margin-bottom:\s*40px;\s*\}/,
    "Reset Transform subsection spacing must render a 40px gap");
assert.equal((html.match(/classList\.add\("transform-reset-subsection-gap"\)/g) || []).length, 1,
    "The larger Transform reset gap must have exactly one assignment path");
assert.doesNotMatch(html, /sliderControl\.classList\.add\("transform-reset-subsection-gap"\)|develop-slider-row[^"\n]*transform-reset-subsection-gap/,
    "The larger Transform reset gap must not be applied to slider rows");
assert.match(sectionFunction, /section\.id === "transform" && itemIndex === section\.items\.length - 1[\s\S]*?sliderControl\.classList\.add\("touch-group-gap"\)/,
    "The final Transform slider must remain separated from Constrain Crop");
const lensBlurBlock = html.match(/function renderLensBlurSection[\s\S]*?let lensCorrectionsView/)[0];
const lensBlurOrder = [
    'applyName.textContent = "Apply"', 'definitions.has("LensBlurAmount")',
    'appendLensBlurSubheading(groupElement, "BOKEH")', '["LensBlurCatEye", "LensBlurHighlightsBoost"]',
    'appendLensBlurSubheading(groupElement, "FOCUS RANGE")', 'createLensBlurExplicitSwitch("Visualize Depth"',
    'appendLensBlurSubheading(groupElement, "BRUSH REFINEMENT")'
];
let priorIndex = -1;
for (const marker of lensBlurOrder) {
    const index = lensBlurBlock.indexOf(marker);
    assert.ok(index > priorIndex, "Lens Blur order drifted at " + marker);
    priorIndex = index;
}

async function runTransportTests() {
    drainQueue();
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40 });
    const originalLog = console.log;
    console.log = function () {};
    try {
        await bridge.start();
        const port = bridge.getHttpServer().address().port;
        let response = await getJson(port, "/develop-categorical/process?value=Version%206");
        assert.equal(response.statusCode, 409, "Writes must fail closed before authoritative availability");
        response = await getJson(port, "/develop-categorical/constrain-crop?value=1");
        assert.equal(response.statusCode, 409, "Constrain Crop must fail closed before authoritative availability");
        response = await getJson(port, "/develop-categorical/result?whiteBalanceAvailable=true&whiteBalance=As%20Shot&processAvailable=true&process=Version%206&vignetteStyleAvailable=true&vignetteStyle=1&uprightModeAvailable=true&uprightMode=0&constrainCropAvailable=true&constrainCrop=0&selectedToolAvailable=true&selectedTool=loupe");
        assert.equal(response.statusCode, 200);
        const revision = response.body.revision;

        response = await getJson(port, "/develop-categorical/process?value=Version%205");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.confirmationAfterRevision, revision);
        assert.deepEqual(commands.getNextCommand(), { command: "develop_categorical.process.set", value: "Version 5" });

        await getJson(port, "/develop-categorical/result?whiteBalanceAvailable=true&whiteBalance=As%20Shot&processAvailable=true&process=Version%205&vignetteStyleAvailable=true&vignetteStyle=1&uprightModeAvailable=true&uprightMode=0&constrainCropAvailable=true&constrainCrop=0&selectedToolAvailable=true&selectedTool=loupe");
        response = await getJson(port, "/develop-categorical/vignette-style?value=3");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "develop_categorical.vignette_style.set", value: 3 });

        await getJson(port, "/develop-categorical/result?whiteBalanceAvailable=true&whiteBalance=As%20Shot&processAvailable=true&process=Version%205&vignetteStyleAvailable=true&vignetteStyle=3&uprightModeAvailable=true&uprightMode=0&constrainCropAvailable=true&constrainCrop=0&selectedToolAvailable=true&selectedTool=loupe");
        response = await getJson(port, "/develop-categorical/upright-mode?value=5");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "develop_categorical.upright_mode.set", value: 5 });

        await getJson(port, "/develop-categorical/result?whiteBalanceAvailable=true&whiteBalance=As%20Shot&processAvailable=true&process=Version%205&vignetteStyleAvailable=true&vignetteStyle=3&uprightModeAvailable=true&uprightMode=5&constrainCropAvailable=true&constrainCrop=0&selectedToolAvailable=true&selectedTool=loupe");
        response = await getJson(port, "/develop-categorical/constrain-crop?value=1");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "develop_categorical.constrain_crop.set", value: 1 });

        await getJson(port, "/develop-categorical/result?whiteBalanceAvailable=true&whiteBalance=As%20Shot&processAvailable=true&process=Version%205&vignetteStyleAvailable=true&vignetteStyle=3&uprightModeAvailable=true&uprightMode=5&constrainCropAvailable=true&constrainCrop=1&selectedToolAvailable=true&selectedTool=loupe");
        response = await getJson(port, "/command?command=develop.action&action=selectCropTool&target=crop");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "develop.action", action: "selectCropTool", target: "crop" });
        response = await getJson(port, "/develop-categorical/state");
        assert.equal(response.body.state.selectedToolAvailable, true,
            "Crop Tool submission must preserve the last authoritative selected-tool availability");
        assert.equal(response.body.state.selectedTool, "loupe",
            "Crop Tool submission must not optimistically replace authoritative selected-tool feedback");

        response = await getJson(port, "/develop-categorical/upright-tool");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "develop_categorical.upright_tool.select" });

        for (const invalidPath of [
            "/develop-categorical/process?value=Version%207",
            "/develop-categorical/vignette-style?value=0",
            "/develop-categorical/vignette-style?value=01",
            "/develop-categorical/upright-mode?value=6",
            "/develop-categorical/upright-mode?value=05",
            "/develop-categorical/constrain-crop?value=2",
            "/develop-categorical/constrain-crop?value=01",
            "/develop-categorical/upright-tool?extra=1"
        ]) {
            response = await getJson(port, invalidPath);
            assert.equal(response.statusCode, 400, invalidPath);
        }
    } finally {
        console.log = originalLog;
        await bridge.stop();
        drainQueue();
    }
}

runTransportTests().then(function () {
    console.log("Develop categorical control tests passed.");
}).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
