const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const polling = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
const driver = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Driver.lua"), "utf8");

assert.match(controller, /"label": "Constrain Crop"[\s\S]*?"slider": "CropConstrainToWarp"[\s\S]*?"explicitZeroOne": true/);
assert.match(controller, /"name": "Transform"[\s\S]*?"placement": "before:Effects"/);
assert.match(controller, /explicitZeroOne[\s\S]*?"&value=0"[\s\S]*?"&value=1"/);
assert.doesNotMatch(controller, /CropConstrainToWarp[^\n]*(?:amount|reset)/);

const adapter = polling.match(/local function readFeedbackValue[\s\S]*?\nend/)[0];
assert.match(adapter, /LrDevelopController\.getValue\("CropConstrainToWarp"\)/);
assert.match(adapter, /value == 0 or value == 1/);
assert.doesNotMatch(adapter, /getRange|getDevelopSettings/);
assert.match(polling, /"CropConstrainToWarp"/);
assert.match(driver, /slider == "CropConstrainToWarp" and "CropConstrainToWarp" or sliderMap\[slider\]/);
assert.match(driver, /slider == "CropConstrainToWarp" and value ~= 0 and value ~= 1/);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "CropConstrainToWarp", value: 0 }), true);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "CropConstrainToWarp", value: 1 }), true);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "CropConstrainToWarp", value: -100 }), false);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "CropConstrainToWarp", value: 0.5 }), false);

console.log("Constrain Crop contract tests passed.");
