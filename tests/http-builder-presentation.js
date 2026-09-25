"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const builder = require("./http-builder-recipes");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const bridge = read("server/bridge.js");
const dispatcher = read("lightroom/LRBridge.lrplugin/Commands.lua");

// These are execution mappings, not URL-family guesses. Verify each Windows
// action against its real native call; in particular, the SDK queue does not
// make Remove -> Selected an SDK edit.
const nativeCalls = {
    "/lens-blur/auto-mask": "setCheckbox",
    "/lens-blur/refinement-mode": "setRefinementMode",
    "/lens-blur/refinement-disclosure": "setRefinementDisclosure",
    "/lens-blur/refinement-reset": "resetRefinement",
    "/lens-blur/focus-action": "activateFocusRangeAction"
};
for (const control of ["amount", "size", "feather", "flow"]) for (const [operation, method] of [["set", "setBrushValue"], ["adjust", "adjustBrushValue"], ["reset", "resetBrushValue"]]) {
    nativeCalls["/lens-blur/brush/" + control + "/" + operation] = method;
}
for (const [route, method] of Object.entries(nativeCalls)) {
    const registered = route.replace(/\/brush\/[^/]+\//, "/brush/:control/");
    const start = bridge.indexOf('app.get("' + registered + '"');
    assert(start >= 0, registered);
    const handler = bridge.slice(start, bridge.indexOf("\n});", start));
    assert(handler.includes("windowsNativeBackend." + method + "("), "Windows executor changed: " + route);
}
const removal = read("lightroom/LRBridge.lrplugin/Remove.lua");
assert(removal.includes('get("selection-refinement-native?action=invoke")'));
assert(removal.includes('native("invoke")'));
const removalServer = read("server/remove-state.js");
assert(removalServer.includes("options.nativeBackend.actRemoveSelection("));
assert(removalServer.includes("options.nativeBackend.actRemoveSelectionRefinement("));

let nativeCount = 0;
for (const {card, recipe} of builder.recipes) {
    const expected = nativeCalls[recipe.route] || recipe.route === "/remove/selection" ? "win-ui" : "sdk";
    assert.equal(builder.recipeExecution(recipe), expected, card.title + " / " + recipe.label);
    if (expected === "win-ui") nativeCount++;
}
assert.equal(nativeCount, 29, "Windows requests remain confined to their actual implementation");
for (const [command, file, sdkCall] of [
    ["lens_blur.active.set", "LensBlur", 'LrDevelopController.setValue("LensBlurActive"'],
    ["lens_blur.bokeh.set", "LensBlur", "LrDevelopController.setLensBlurBokeh("],
    ["lens_blur.focal_range.set", "LensBlur", 'LrDevelopController.setValue("LensBlurFocalRange"'],
    ["lens_blur.depth_visualization.toggle", "LensBlur", "LrDevelopController.toggleLensBlurDepthVisualization("],
    ["lens_blur.depth_refinement.select", "LensBlur", 'LrDevelopController.selectTool("depth_refinement")'],
    ["lens_blur.depth_refinement.close", "LensBlur", 'LrDevelopController.selectTool("loupe")'],
    ["develop_preset.amount.set", "DevelopPresets", "LrDevelopController.setValue(presetAmountParameter"],
    ["remove.brush.set", "Remove", "LrDevelopController.setRemovePanelPreferences("],
    ["reflections.set", "Reflections", "SDK.changeReflectionRemovalAmount("],
    ["people.action", "People", "SDK.applyRemovalOnDetectedDistractingPeople("],
    ["red_eye.action", "RedEye", "SDK.resetRedeye()"]
]) {
    assert(dispatcher.includes('command.command == "' + command + '"'), command);
    assert(read("lightroom/LRBridge.lrplugin/" + file + ".lua").includes(sdkCall), command + " SDK execution");
    for (const {recipe} of builder.recipes.filter(({card}) => card.commands.includes(command))) assert.equal(builder.recipeExecution(recipe), "sdk");
}
assert.equal(builder.recipeExecution({route:"/develop-categorical/profile"}), "sdk");
assert(read("lightroom/LRBridge.lrplugin/Profile.lua").includes("applyDevelopSettings("));
assert(builder.source.includes("available choices and the selected label are read from Lightroom’s interface"));
assert(builder.source.includes("current checkbox state is read from Lightroom’s interface"));
const partitioned = builder.partitionRecipes([{route:"/lens-blur/visualize-depth"}, {route:"/lens-blur/auto-mask"}]);
assert.deepEqual([...partitioned.keys()], ["sdk", "win-ui"], "mixed action cards must split by executor");
assert.deepEqual([...partitioned.values()].map(items=>items.length),[1,1]);

// Freeze the previously checked request output. This test only generates text;
// it never invokes PowerShell, Lightroom, or the HTTP mutation fixtures.
const outputs = builder.recipes.map(({card, recipe, values}) => [card.title, recipe.label,
    builder.recipePath(recipe, values, 4), builder.buildRecipeScript(recipe, values, "http://lrbridge-pc:17891", 4)]);
const digest = crypto.createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
assert.equal(digest, "754f0d37e4b19552a0988892e6840cfe04d60bfb547a13eda65ef2e526e3d8d6", "presentation changes must preserve complete request/script output");
assert.doesNotMatch(builder.source, /Workflow instructions|Open Web Controller|Apply step/);
console.log("Builder presentation: execution classification, mixed-card splitting and all 268 existing request/script outputs preserved. No scripts executed.");
