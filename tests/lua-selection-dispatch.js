const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const selection = read("lightroom/LRBridge.lrplugin/Selection.lua");
const application = read("lightroom/LRBridge.lrplugin/Application.lua");
const parser = read("lightroom/LRBridge.lrplugin/Parser.lua");
const dispatcher = read("lightroom/LRBridge.lrplugin/Commands.lua");
const automaticPolling = read("lightroom/LRBridge.lrplugin/AutoStartPolling.lua");
const manualPolling = read("lightroom/LRBridge.lrplugin/StartPolling.lua");
const contract = JSON.parse(read("tests/contract-fixture.json"));

const exactMappings = {
    next: "nextPhoto",
    previous: "previousPhoto",
    first: "selectFirstPhoto",
    last: "selectLastPhoto",
    pick: "flagAsPick",
    reject: "flagAsReject",
    none: "removeFlag",
    increase: "increaseRating",
    decrease: "decreaseRating",
    red: "toggleRedLabel",
    yellow: "toggleYellowLabel",
    green: "toggleGreenLabel",
    blue: "toggleBlueLabel",
    purple: "togglePurpleLabel",
    select_all: "selectAll",
    select_none: "selectNone",
    select_inverse: "selectInverse",
    deselect_active: "deselectActive",
    deselect_others: "deselectOthers"
};

assert.match(selection, /^local LrSelection = import "LrSelection"/m);
for (const [value, method] of Object.entries(exactMappings)) {
    assert.match(selection, new RegExp("\\b" + value + "\\s*=\\s*LrSelection\\." + method + "\\b"));
}
assert.match(selection, /LrSelection\.setRating\(rating\)/);
assert.match(selection, /LrSelection\.setColorLabel\(label\)/);
assert.match(selection, /error\("Unknown selection " \..*operation\)/);

assert.doesNotMatch(selection, /LrSelection\.(?:firstPhoto|lastPhoto|removeColorLabel)\b/);
assert.doesNotMatch(selection, /LrApplicationView|switchToModule|keyboard|AutoHotkey|shortcut|shell|menu|mouse|automation/i);

for (const field of ["action", "direction", "flag", "rating", "label", "operation", "module", "view"]) {
    assert.match(parser, new RegExp("local " + field + " = string\\.match"));
    assert.match(parser, new RegExp(field + " = " + field));
}

const commandDispatch = {
    "selection.navigate": "Selection.navigate(command.direction)",
    "selection.flag": "Selection.setFlag(command.flag)",
    "selection.rating.set": "Selection.setRating(command.rating)",
    "selection.rating.adjust": "Selection.adjustRating(command.direction)",
    "selection.label.set": "Selection.setLabel(command.label)",
    "selection.label.toggle": "Selection.toggleLabel(command.label)",
    "selection.operation": "Selection.runOperation(command.operation)",
    "application.module": "Application.switchModule(command.module)",
    "application.view": "Application.showView(command.view)",
    "application.action": "Application.runAction(command.action)",
    "application.secondary_view": "Application.showSecondaryView(command.view)"
};
for (const [command, call] of Object.entries(commandDispatch)) {
    assert.match(dispatcher, new RegExp("command\\.command == \"" + command.replaceAll(".", "\\.") + "\""));
    assert.ok(dispatcher.includes(call));
}

const applicationActionMappings = {
    toggle_zoom: "toggleZoom",
    zoom_in: "zoomIn",
    zoom_out: "zoomOut",
    zoom_100: "zoomToOneToOne",
    fullscreen_preview: "fullscreenPreview",
    fullscreen_hide_panels: "fullscreenHidePanels",
    next_screen_mode: "nextScreenMode",
    cycle_loupe_info: "cycleLoupeViewInfo",
    toggle_secondary_display: "toggleSecondaryDisplay",
    toggle_secondary_fullscreen: "toggleSecondaryDisplayFullscreen"
};
assert.deepEqual(Object.keys(applicationActionMappings), contract.applicationActions);
assert.deepEqual(
    Object.keys(exactMappings).slice(-contract.selectionOperations.length),
    contract.selectionOperations
);
for (const [value, method] of Object.entries(applicationActionMappings)) {
    assert.match(application, new RegExp("\\b" + value + "\\s*=\\s*LrApplicationView\\." + method + "\\b"));
}
assert.match(application, /LrApplicationView\.switchToModule\(module\)/);
assert.match(application, /LrApplicationView\.showView\(view\)/);
assert.match(application, /LrApplicationView\.showSecondaryView\(view\)/);
assert.doesNotMatch(application, /Driver|LrDevelopController|keyboard|AutoHotkey|shortcut|shell|menu|mouse|automation/i);
assert.doesNotMatch(application, /zoomInSome|zoomOutSome|goToHealing|goToSpotRemoval/);
assert.equal((application.match(/LrApplicationView\.switchToModule\(/g) || []).length, 1);

const developMappings = [
    /Driver\.adjustSlider\(\s*command\.slider,\s*command\.amount\s*\)/,
    /Driver\.setSlider\(\s*command\.slider,\s*command\.value\s*\)/,
    /Driver\.resetSlider\(\s*command\.slider\s*\)/,
    /Driver\.runAction\(\s*command\.action\s*\)/,
    /Query\.getDevelopValue\(command\.slider\)/
];
for (const mapping of developMappings) {
    assert.match(dispatcher, mapping, "Existing Develop mapping changed: " + mapping);
}

for (const polling of [automaticPolling, manualPolling]) {
    assert.match(polling, /LrTasks\.pcall\(Commands\.execute, command\)/);
    assert.match(polling, /executeCommand\(command\)[\s\S]*LrTasks\.sleep\(config\.pollInterval\)/);
}

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.scripts["test:lua-selection"], "node tests/lua-selection-dispatch.js");
assert.equal(packageJson.scripts.test.split(" && ").filter((entry) => entry === "npm run test:lua-selection").length, 1);
assert.equal(packageJson.version, "0.6.0");

console.log("Lua selection dispatch source tests passed. Source-level tests do not prove Lightroom runtime semantics; manual Lightroom testing is still required.");
