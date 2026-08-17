"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const definition = require("../server/develop-categorical-state");
const controllerModel = require("../app/controller-develop-categorical");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const polling = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
const driver = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Driver.lua"), "utf8");
const categoricalLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/DevelopCategorical.lua"), "utf8");
const bridge = fs.readFileSync(path.join(root, "server/bridge.js"), "utf8");

assert.deepEqual(Array.from(definition.constrainCropValues), [0, 1]);
assert.match(categoricalLua, /getValue\("CropConstrainToWarp"\)/);
assert.match(categoricalLua, /setValue\("CropConstrainToWarp", value\)/);
assert.match(categoricalLua, /type\(constrainCrop\) == "number"/);
assert.match(categoricalLua, /local constrainCropValues = \{ \[0\] = true, \[1\] = true \}/);
assert.match(bridge, /app\.get\("\/develop-categorical\/constrain-crop"[\s\S]*?availableField: "constrainCropAvailable"[\s\S]*?\^\[01\]\$/);
assert.match(bridge, /current\[specification\.availableField\] !== true[\s\S]*?status\(409\)/,
    "Constrain Crop writes must fail closed before authoritative availability");

const transformRenderer = controller.match(/function createDevelopSectionElement[\s\S]*?function rerenderColorMixerSection/)[0];
assert.match(transformRenderer,
    /section\.items\.forEach[\s\S]*?const sliderControl = createDevelopSliderControl\(item\.definition\);[\s\S]*?groupElement\.appendChild\(sliderControl\);[\s\S]*?if \(section\.id === "transform"\) appendTransformConstrainCropControl\(groupElement\)/,
    "Constrain Crop must render after the final Transform slider");
assert.doesNotMatch(controller, /appendSwitch\(manualPanel, "CropConstrainToWarp"\)/,
    "Constrain Crop must not remain in Lens Corrections");
assert.equal((controller.match(/name\.textContent = "Constrain Crop"/g) || []).length, 1);
assert.match(controller, /\[\[0, "Off", "negative"\], \[1, "On", "positive"\]\]/,
    "Constrain Crop must reuse the touch-friendly Off/On pattern");
assert.match(controller, /submitDevelopCategorical\([\s\S]*?"constrainCrop"[\s\S]*?\/api\/develop-categorical\/constrain-crop/);
assert.match(controller, /syncBinaryButtons\(constrainControl\.buttons, presentation, busy\)/);

function buttonDouble() {
    const classes = new Set();
    const attributes = {};
    return {
        disabled: false,
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attributes[name] = value; },
        getAttribute(name) { return attributes[name]; }
    };
}

const buttons = { "0": buttonDouble(), "1": buttonDouble() };
function assertButtons(activeValue, disabled, pendingValue) {
    for (const value of [0, 1]) {
        const button = buttons[String(value)];
        const active = value === activeValue;
        assert.equal(button.classList.contains("active"), active);
        assert.equal(button.getAttribute("aria-pressed"), String(active));
        assert.equal(button.disabled, disabled);
        assert.equal(button.classList.contains("pending"), value === pendingValue);
    }
}

const available = {
    processAvailable: true, process: "Version 6",
    vignetteStyleAvailable: true, vignetteStyle: 1,
    uprightModeAvailable: true, uprightMode: 0,
    constrainCropAvailable: true, constrainCrop: 0,
    selectedToolAvailable: true, selectedTool: "loupe"
};
const model = controllerModel.createModel();
assert.equal(model.apply(available, 5).accepted, true);
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), false);
assertButtons(0, false, null);

assert.equal(model.apply(Object.assign({}, available, { constrainCrop: 1 }), 6).accepted, true);
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), false);
assertButtons(1, false, null);

assert.equal(model.begin("constrainCrop", 0, 6), true);
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), true);
assertButtons(1, true, 0);
let applied = model.apply(Object.assign({}, available, { constrainCrop: 0 }), 6);
assert.equal(applied.duplicate, true);
assert.ok(model.getPending("constrainCrop"));
applied = model.apply(Object.assign({}, available, { constrainCrop: 0 }), 5);
assert.equal(applied.accepted, false);
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), true);
assertButtons(1, true, 0);

model.cancel("constrainCrop");
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), false);
assertButtons(1, false, null);
assert.equal(model.begin("constrainCrop", 0, 6), true);
applied = model.apply(Object.assign({}, available, { constrainCrop: 0 }), 7);
assert.deepEqual(applied.confirmed, ["constrainCrop"]);
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), false);
assertButtons(0, false, null);

model.reset();
controllerModel.syncBinaryButtons(buttons, model.presentation("constrainCrop"), false);
assertButtons(null, true, null);

assert.match(polling, /LrDevelopController\.getValue\("CropConstrainToWarp"\)/);
assert.match(driver, /slider == "CropConstrainToWarp" and value ~= 0 and value ~= 1/);
assert.equal(commands.validateCommand({ command: "develop_categorical.constrain_crop.set", value: 0 }), true);
assert.equal(commands.validateCommand({ command: "develop_categorical.constrain_crop.set", value: 1 }), true);
assert.equal(commands.validateCommand({ command: "develop_categorical.constrain_crop.set", value: 2 }), false);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "CropConstrainToWarp", value: 0 }), true,
    "Existing public numeric compatibility must remain intact");
assert.equal(commands.validateCommand({ command: "develop.set", slider: "CropConstrainToWarp", value: 1 }), true,
    "Existing public numeric compatibility must remain intact");

console.log("Transform Constrain Crop authoritative synchronization tests passed.");
