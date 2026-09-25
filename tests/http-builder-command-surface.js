const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const builderSource = fs.readFileSync(path.join(root, "app/companion-cheatsheet.html"), "utf8");
const controllerSource = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const backendSource = fs.readFileSync(path.join(root, "server/commands.js"), "utf8");
const packageJson = require("../package.json");
const commands = require("../server/commands");
const sliders = require("../server/sliders");

const scriptSource = builderSource.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptSource, "Builder script is missing");
assert.doesNotThrow(() => new vm.Script(scriptSource[1]), "Builder JavaScript must parse");

function extractValue(source, declaration) {
    const start = source.indexOf(declaration);
    let end = -1, depth = 0, quote = null;
    for (let index = source.indexOf("[", start); index < source.length; index++) {
        const char = source[index];
        if (quote) { if (char === "\\") index++; else if (char === quote) quote = null; continue; }
        if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
        if (char === "[") depth++;
        if (char === "]" && --depth === 0) { end = index + 1; break; }
    }
    assert.notEqual(start, -1, "Missing declaration: " + declaration);
    assert.notEqual(end, -1, "Missing declaration terminator: " + declaration);
    const value = vm.runInNewContext("(" + source.slice(start + declaration.length, end).trim() + ")");
    return JSON.parse(JSON.stringify(value));
}

function extractFunction(source, name, nextName, context = {}) {
    const start = source.indexOf("function " + name + "(");
    assert.notEqual(start, -1, "Missing function: " + name);
    const indent = source.slice(source.lastIndexOf("\n", start) + 1, start);
    const tail = source.slice(start);
    const next = new RegExp("\n" + indent + "(?:async )?function [A-Za-z]").exec(tail);
    assert(next, "Missing function boundary after " + name);
    return vm.runInNewContext("(" + tail.slice(0, next.index).trim() + ")", context);
}

function values(type) {
    return (type.options || []).map((option) => option.value);
}

function sorted(items) {
    return [...items].sort((left, right) => String(left).localeCompare(String(right)));
}

function assertSameValues(actual, expected, message) {
    assert.deepEqual(sorted(actual), sorted(expected), message);
}

function commandFromPath(pathname, type) {
    const params = new URL("http://127.0.0.1" + pathname).searchParams;
    const command = {
        command: params.get("command")
    };
    const value = params.get(type.valueField);
    command[type.valueField] = type.numericValue ? Number(value) : value;

    if (type.amountField) {
        command[type.amountField] = Number(params.get(type.amountField));
    }

    return command;
}

const families = extractValue(builderSource, "const builderCommandFamilies =");
const buildCommandPath = extractFunction(builderSource, "buildCommandPath", "parseBuilderAbsoluteValue");
const parseBuilderAbsoluteValue = extractFunction(builderSource, "parseBuilderAbsoluteValue", "parseCustomCropDimension");
const parseCustomCropDimension = extractFunction(builderSource, "parseCustomCropDimension", "buildCustomCropPath");
const buildCustomCropPath = extractFunction(builderSource, "buildCustomCropPath", "renderCustomCropOutput", {
    parseCustomCropDimension,
    encodeURIComponent
});
const parseCropAngleValue = extractFunction(builderSource, "parseCropAngleValue", "buildCropAnglePath");
const buildCropAnglePath = extractFunction(builderSource, "buildCropAnglePath", "renderCropAngleOutput", {
    parseCropAngleValue,
    encodeURIComponent
});
const strictFiniteBuilderNumber = extractFunction(builderSource, "strictFiniteBuilderNumber", "buildColorGradingPath");
const buildColorGradingPath = extractFunction(builderSource, "buildColorGradingPath", "renderColorGradingTargets", {
    strictFiniteBuilderNumber, colorGradingMetadata: require("../server/color-grading").getMetadata()
});
const colorCases = [
    [buildColorGradingPath("wheel", "shadows", "220", "35"), { command: "color_grading.wheel.set", region: "shadows", hue: 220, saturation: 35 }],
    [buildColorGradingPath("scalar", "balance", "-12.5"), { command: "color_grading.value.set", control: "balance", value: -12.5 }],
    [buildColorGradingPath("region-reset", "midtones"), { command: "color_grading.region.reset", region: "midtones" }],
    [buildColorGradingPath("scalar-reset", "blending"), { command: "color_grading.value.reset", control: "blending" }],
    [buildColorGradingPath("view", "3-way"), { command: "color_grading.view.set", view: "3-way" }]
];
for (const [pathname, command] of colorCases) {
    assert.equal(pathname, "/command?" + new URLSearchParams(command).toString());
    assert.equal(commands.validateCommand(command), true);
}
assert.equal(buildColorGradingPath("wheel", "unknown", "0", "0"), null);
assert.equal(buildColorGradingPath("scalar", "balance", "Infinity"), null);
assert.equal(buildColorGradingPath("view", "unknown"), null);
const familyById = Object.fromEntries(families.map((family) => [family.id, family]));
const developTypes = Object.fromEntries(familyById.develop.types.map((type) => [type.id, type]));
const selectionTypes = Object.fromEntries(familyById.selection.types.map((type) => [type.id, type]));
const photoTypes = Object.fromEntries(familyById.photo.types.map((type) => [type.id, type]));
const applicationTypes = Object.fromEntries(familyById.application.types.map((type) => [type.id, type]));
const directFamilies = extractValue(builderSource, "const directCardFamilies =");
const workflows = JSON.parse(JSON.stringify(extractFunction(builderSource, "getWorkflowDefinitions")()));
const executableBuilder = require("./http-builder-recipes");
for (const card of executableBuilder.cards) {
    const recipes = executableBuilder.workflowRecipes(card);
    assert(recipes.length, "A card name alone is not executable coverage: " + card.title);
    for (const recipe of recipes) {
        const values = Object.fromEntries((recipe.inputs || []).map(field => [field.key, String(field.value)]));
        const script = executableBuilder.buildRecipeScript(recipe, values, "http://lrbridge-pc:17891", 4);
        assert(script && script.includes("Invoke-RestMethod"), "Missing executable request: " + card.title);
        assert(script.includes("http://lrbridge-pc:17891"), "Script must use configured Base URL");
        if (recipe.state) assert(script.includes("$s = Invoke-LR '" + recipe.state + "'"), "Missing execution-time state read: " + card.title);
        if (recipe.gesture) for (const phase of ["begin", "end", "cancel"]) assert(script.includes(recipe.route + "/gesture/" + phase), "Owned gesture lifecycle: " + card.title);
    }
}
for (const entry of executableBuilder.recipes.filter(({recipe}) => recipe.inputs?.some(f=>f.type === "number"))) {
    const field = entry.recipe.inputs.find(f=>f.type === "number");
    for (const invalid of ["", "NaN", "Infinity", "1e4", "1;exit", "0x10"]) {
        assert.equal(executableBuilder.buildRecipeScript(entry.recipe, {...entry.values, [field.key]:invalid}, "http://host:17891", 1), null, "Invalid numeric input " + entry.card.title);
    }
}
const brushRecipe = executableBuilder.recipes.find(({recipe})=>recipe.route === "/lens-blur/brush/amount/set").recipe;
assert.equal(executableBuilder.recipePath(brushRecipe,{value:"0.00000001"},1),"/lens-blur/brush/amount/set?value=0.00000001","Keep decimal spelling accepted by the server");
assert.equal(executableBuilder.psLiteral("Nino's & $(throw 'oops')"),"'Nino''s & $(throw ''oops'')'","Escape literals without interpolating PowerShell expressions");
const publicCommands = extractValue(backendSource, "const allowedCommands =");
const excludedCommands = ["develop.get", "export.query", "clipboard.query"];
const representedCommands = new Set([
    ...families.flatMap(family => family.types.map(type => type.command)),
    ...directFamilies.map(family => family.command),
    ...colorCases.map(([, command]) => command.command), "photo.crop_angle.set", "photo.crop_angle.reset",
    ...workflows.flatMap(card => card.commands)
]);
assertSameValues([...representedCommands], publicCommands.filter(command => !excludedCommands.includes(command)), "Every public command must map to a generated action or its owned gesture lifecycle; reads/queries stay out");
const inventory = require("../server/http-operations.json");
const representedRoutes = new Set([...directFamilies.map(family => family.route), ...workflows.flatMap(card => card.routes)]);
for (const operation of inventory.operations.filter(operation => operation.kind === "workflow")) {
    assert(representedRoutes.has(operation.path), "Missing public function route: " + operation.path);
}
for (const route of representedRoutes) {
    assert(inventory.operations.some(operation => operation.path === route && ["ordinary", "workflow"].includes(operation.kind)), "Card must not expose internal, read-only or diagnostic routes: " + route);
}
for (const workflow of workflows) {
    assert.equal(workflow.link, "/reference/HTTP_WORKFLOWS.md");
    assert(workflow.title && workflow.note && workflow.operations.length, "Workflow needs practical, searchable guidance");
}
const categorical = require("../server/develop-categorical-state");
for (const [suffix, allowed] of [["white-balance", categorical.whiteBalanceWritableValues], ["process", categorical.processValues], ["vignette-style", categorical.vignetteStyleValues], ["upright-mode", categorical.uprightModeValues], ["constrain-crop", categorical.constrainCropValues]]) {
    assertSameValues(directFamilies.find(family => family.route === "/develop-categorical/" + suffix).values, allowed, "Categorical options must match public definitions: " + suffix);
}
assertSameValues(directFamilies.find(family => family.route === "/lens-blur/bokeh").values, require("../server/lens-blur-state").bokehValues, "Bokeh options must match public definitions");
const maskDefinitions = require("../app/controller-masking-corrections");
for (const type of maskDefinitions.creationTypes) for (const action of ["Create", "Add", "Subtract"]) {
    assert(workflows.some(card => card.title === action + " " + type.label + " Mask"), "Missing mask action: " + action + " " + type.label);
}
for (const definition of maskDefinitions.supportedDefinitions) assert(workflows.some(card => card.operations.includes(definition.parameter)), "Missing local mask adjustment " + definition.parameter);
for (const field of require("../server/point-color-state").fields) for (const group of ["Point Color", "Masking / Point Color"]) assert(workflows.some(card => card.group === group && card.operations.includes(field)), group + " missing " + field);
for (const control of require("../server/windows-lightroom-native").BRUSH_CONTROLS) assert(workflows.some(card => card.group === "Lens Blur / Brush Refinement" && card.operations.includes(control)), "Missing brush workflow " + control);
console.log("Builder catalog: " + representedCommands.size + " command definitions mapped; all " + workflows.length + " former guidance cards now generate executable requests (" + executableBuilder.recipes.length + " examples). Execution is verified separately by http-builder-executable.js.");

assert.deepEqual(families.map((family) => family.id), ["develop", "selection", "photo", "application"]);
assert.equal(familyById.develop.types.filter((type) => type.valueSource).length + developTypes.action.options.length, 15);
assert.equal(familyById.selection.types.reduce((total, type) => total + type.options.length, 0), 33);
assert.equal(familyById.photo.types.reduce((total, type) => total + type.options.length, 0), 13);
assert.equal(familyById.application.types.reduce((total, type) => total + type.options.length, 0), 34);
assert.equal(
    sliders.getAll().filter((slider) => slider.id !== "LensProfileChromaticAberrationScale").length +
        sliders.getAll().filter((slider) => slider.id !== "LensProfileChromaticAberrationScale" && slider.adjustSupported !== false).length +
        sliders.getAll().filter((slider) => slider.id !== "LensProfileChromaticAberrationScale" && slider.resetSupported !== false).length +
        developTypes.action.options.length,
    328,
    "Develop concrete Builder combination count changed"
);
assert.match(builderSource, /id="toolbar"/);
assert.match(builderSource, /id="collection"/);
assert.match(builderSource, /id="clearSearch"/);
assert.doesNotMatch(builderSource, /<select|httpInventory|Supported operations and guarded workflows|Fast setup examples|Security and network exposure/);
assert.match(builderSource, /copyText\(value\)/);
assert.match(builderSource, /copyText\(apiBase \+ value\)/);
assert.match(builderSource, /fetch\("\/api\/sliders"\)/);
assert.equal(
    buildCommandPath(developTypes.set, "Exposure", 1.25),
    "/set?slider=Exposure&value=1.25"
);
assert.equal(parseBuilderAbsoluteValue(sliders.getById("Exposure"), "1.25"), 1.25);
assert.equal(parseBuilderAbsoluteValue(sliders.getById("Exposure"), "1.234"), null);
assert.equal(parseBuilderAbsoluteValue(sliders.getById("Contrast"), "1.5"), null);
for (const invalid of ["1e0", "0x1", "+1", ".5", "1.", " 1", "Infinity", "NaN"]) {
    assert.equal(parseBuilderAbsoluteValue(sliders.getById("Exposure"), invalid), null, "Builder must use the server's decimal syntax");
}



assert.equal(
    buildCommandPath(developTypes.adjust, "Exposure", -4),
    "/command?command=develop.adjust&slider=Exposure&amount=-4",
    "Develop slider adjust URL changed"
);
assert.equal(
    buildCommandPath(developTypes.adjust, "Exposure", 4),
    "/command?command=develop.adjust&slider=Exposure&amount=4",
    "Positive Develop slider amount changed"
);
assert.equal(
    buildCommandPath(developTypes.reset, "Exposure"),
    "/command?command=develop.reset&slider=Exposure",
    "Develop individual slider reset URL changed"
);
assert.equal(
    buildCommandPath(developTypes.adjust, "Slider A&B", -2),
    "/command?command=develop.adjust&slider=Slider%20A%26B&amount=-2",
    "Builder query parameters must be URL-encoded"
);

const allowedActions = extractValue(backendSource, "const allowedActions =");
assertSameValues(values(developTypes.action), allowedActions, "Develop action contract drifted");
assert.equal(developTypes.action.options.length, 12, "Builder must expose all 12 Develop actions");

const nativeReset = developTypes.action.options.find((option) => option.value === "resetAllDevelopAdjustments");
assert.deepEqual(nativeReset, {
    value: "resetAllDevelopAdjustments",
    label: "Reset",
    description: "Reset all Develop adjustments on the active photo"
});
assert.equal(
    buildCommandPath(developTypes.action, nativeReset.value),
    "/command?command=develop.action&action=resetAllDevelopAdjustments"
);

assert.ok(
    !developTypes.action.options.some((option) => /previous/i.test(option.value) || /previous/i.test(option.label)),
    "Develop Previous must not be exposed"
);

for (const slider of sliders.getAll()) {
    const supportedTypes = [];
    if (slider.adjustSupported !== false) supportedTypes.push(developTypes.adjust);
    if (slider.resetSupported !== false) supportedTypes.push(developTypes.reset);
    for (const type of supportedTypes) {
        const pathname = buildCommandPath(type, slider.id, -3);
        assert.equal(commands.validateCommand(commandFromPath(pathname, type)), true, "Invalid slider command: " + pathname);
    }
}

const normalizeHost = extractFunction(builderSource, "normalizeHost", "normalizeStep", { URL });
for (const [input, expected] of [
    ["127.0.0.1", "127.0.0.1"], ["192.168.1.11", "192.168.1.11"], ["localhost", "localhost"],
    ["lrbridge-pc", "lrbridge-pc"], ["lrbridge.tail.example", "lrbridge.tail.example"],
    [" http://192.168.1.11:17892/ ", "192.168.1.11"], ["192.168.1.11:17891", "192.168.1.11"],
    ["[::1]", "[::1]"], ["http://[fd00::1234]:17892/", "[fd00::1234]"]
]) assert.equal(normalizeHost(input), expected, input);
for (const invalid of ["", "https://example.com", "example.com:80", "example.com:9000", "999.1.1.1", "[broken]", "::1",
    "my pc", "host/path", "host?x=1", "host#frag", "user@host", "host\\path", "-host", "host..com", "host%2ecom", "host:17891/command?x=1"])
    assert.equal(normalizeHost(invalid), null, "Invalid address must not become a copied URL: " + invalid);
const normalizeStep = extractFunction(builderSource, "normalizeStep", "setBaseHost");
for (const input of ["1", "4", "9007199254740991"]) assert.equal(normalizeStep(input), Number(input));
for (const invalid of ["", "0", "-1", "1.5", "1e2", "NaN", "Infinity", "9007199254740992"]) assert.equal(normalizeStep(invalid), null);
for (const slider of sliders.getAll().filter((item) => item.id !== "LensProfileChromaticAberrationScale")) {
    if (slider.requireRuntimeRangeForAdmission === true) {
        assert.equal(sliders.setRuntimeRange(slider.id, slider.min, slider.max), true);
    }
    const validExample = Number.isFinite(slider.default) ? slider.default : slider.min;
    const rawValue = String(validExample);
    const pathname = buildCommandPath(developTypes.set, slider.id, rawValue);
    assert.equal(pathname, "/set?slider=" + encodeURIComponent(slider.id) + "&value=" + encodeURIComponent(rawValue));
    assert.equal(parseBuilderAbsoluteValue(slider, rawValue), validExample);
    assert.equal(commands.validateCommand({
        command: "develop.set",
        slider: slider.id,
        value: validExample
    }), true, "Invalid absolute Builder command: " + pathname);
    if (slider.requireRuntimeRangeForAdmission === true) sliders.clearRuntimeRange(slider.id);
}

for (const option of developTypes.action.options) {
    const pathname = buildCommandPath(developTypes.action, option.value);
    assert.equal(commands.validateCommand(commandFromPath(pathname, developTypes.action)), true, "Invalid Develop action: " + pathname);
}

const selectionContracts = [
    ["navigate", "allowedSelectionDirections"],
    ["extend", "allowedExtendDirections"],
    ["flag", "allowedFlags"],
    ["rating-adjust", "allowedRatingDirections"],
    ["label-set", "allowedLabels"],
    ["label-toggle", "allowedToggleLabels"],
    ["operation", "allowedSelectionOperations"]
];

for (const [typeId, backendName] of selectionContracts) {
    assertSameValues(values(selectionTypes[typeId]), extractValue(backendSource, "const " + backendName + " ="), "Selection contract drifted: " + typeId);
}
assert.deepEqual(values(selectionTypes["rating-set"]), [0, 1, 2, 3, 4, 5]);
assert.equal(selectionTypes["label-toggle"].label, "Toggle Color Label");
assert.equal(selectionTypes.extend.amountMin, 1);
assert.equal(selectionTypes.extend.amountMax, 100);
assert.equal(selectionTypes.extend.description, "Follows Lightroom's current Filmstrip/Grid ordering.");

for (const type of familyById.selection.types) {
    for (const option of type.options) {
        const pathname = buildCommandPath(type, option.value, type.amountField ? 1 : undefined);
        assert.equal(commands.validateCommand(commandFromPath(pathname, type)), true, "Invalid Selection command: " + pathname);
    }
}
assert.equal(
    buildCommandPath(selectionTypes.extend, "left", 25),
    "/command?command=selection.extend&direction=left&amount=25"
);

assertSameValues(
    values(photoTypes.rotate),
    extractValue(backendSource, "const allowedPhotoRotateDirections ="),
    "Photo rotation contract drifted"
);
const photoContracts = [
    ["rotate", "allowedPhotoRotateDirections"],
    ["treatment", "allowedPhotoTreatments"],
    ["crop-aspect", "allowedPhotoCropAspects"],
    ["reveal", "allowedPhotoRevealScopes"]
];
for (const [typeId, backendName] of photoContracts) {
    assertSameValues(values(photoTypes[typeId]), extractValue(backendSource, "const " + backendName + " ="), "Photo contract drifted: " + typeId);
}
for (const type of familyById.photo.types) {
    for (const option of type.options) {
        const pathname = buildCommandPath(type, option.value);
        assert.equal(commands.validateCommand(commandFromPath(pathname, type)), true, "Invalid Photo command: " + pathname);
    }
}
assert.deepEqual(
    photoTypes.rotate.options.map((option) => option.label),
    ["Rotate Left", "Rotate Right"]
);
assert.deepEqual(photoTypes.treatment.options, [
    { value: "grayscale", label: "Black & White" },
    { value: "color", label: "Color" }
]);
assert.deepEqual(photoTypes["crop-aspect"].options, [
    { value: "original", label: "Original Aspect" },
    {
        value: "asshot",
        label: "Camera Crop",
        description: "Uses the crop ratio recorded by the camera when available. It may match Original."
    },
    { value: "1x1", label: "1:1" },
    { value: "2x3", label: "2:3" },
    { value: "4x5", label: "4:5" },
    { value: "5x7", label: "5:7" },
    { value: "16x9", label: "16:9" },
    { value: "16x10", label: "16:10" }
]);
assert.equal(
    buildCommandPath(photoTypes["crop-aspect"], "16x10"),
    "/command?command=photo.crop_aspect&mode=16x10"
);
for (const [width, height, expected] of [
    ["16", "10", "/command?command=photo.crop_aspect&mode=custom&w=16&h=10"],
    ["3", "2", "/command?command=photo.crop_aspect&mode=custom&w=3&h=2"],
    ["1", "1", "/command?command=photo.crop_aspect&mode=custom&w=1&h=1"],
    ["10000", "10000", "/command?command=photo.crop_aspect&mode=custom&w=10000&h=10000"]
]) {
    assert.equal(buildCustomCropPath(width, height), expected);
    const params = new URL("http://127.0.0.1" + expected).searchParams;
    assert.equal(commands.validateCommand({
        command: params.get("command"),
        mode: params.get("mode"),
        w: Number(params.get("w")),
        h: Number(params.get("h"))
    }), true);
}
for (const invalid of ["", "0", "-1", "1.5", " 16", "16 ", "10001", "abc"]) {
    assert.equal(parseCustomCropDimension(invalid), null);
    assert.equal(buildCustomCropPath(invalid, "10"), null);
    assert.equal(buildCustomCropPath("16", invalid), null);
}
for (const [value, expected] of [
    ["-45", "/command?command=photo.crop_angle.set&value=-45"],
    ["45", "/command?command=photo.crop_angle.set&value=45"],
    ["0", "/command?command=photo.crop_angle.set&value=0"],
    ["-2.5", "/command?command=photo.crop_angle.set&value=-2.5"],
    ["12.25", "/command?command=photo.crop_angle.set&value=12.25"]
]) {
    assert.equal(buildCropAnglePath(value), expected);
    assert.equal(commands.validateCommand({
        command: "photo.crop_angle.set",
        value: Number(value)
    }), true);
}
for (const invalid of ["", "-45.01", "45.01", "1.234", " 1", "NaN", "Infinity"]) {
    assert.equal(parseCropAngleValue(invalid), null);
    assert.equal(buildCropAnglePath(invalid), null);
}
assert.equal(commands.validateCommand({ command: "photo.crop_angle.reset" }), true);
assert.match(builderSource, /"\/command\?command=photo\.crop_angle\.reset"/);
assert.deepEqual(photoTypes.reveal.options, [
    { value: "active", label: "Show in Explorer" }
]);
assert.equal(
    buildCommandPath(photoTypes.rotate, "left"),
    "/command?command=photo.rotate&direction=left",
    "Existing Rotate Left URL changed"
);
assert.equal(
    buildCommandPath(photoTypes.rotate, "right"),
    "/command?command=photo.rotate&direction=right",
    "Existing Rotate Right URL changed"
);

const applicationContracts = [
    ["module", "allowedApplicationModules"],
    ["view", "allowedApplicationViews"],
    ["secondary-view", "allowedSecondaryViews"]
];

for (const [typeId, backendName] of applicationContracts) {
    assertSameValues(values(applicationTypes[typeId]), extractValue(backendSource, "const " + backendName + " ="), "Application contract drifted: " + typeId);
}

const allowedApplicationActions = extractValue(backendSource, "const allowedApplicationActions =");
assertSameValues(
    values(applicationTypes.action),
    allowedApplicationActions.filter((action) => action !== "cycle_loupe_info"),
    "Runtime-usable Application action contract drifted"
);
assert.ok(!values(applicationTypes.action).includes("cycle_loupe_info"), "cycle_loupe_info must not be exposed");
assert.ok(values(applicationTypes["secondary-view"]).includes("slideshow"), "Secondary slideshow must be exposed");

for (const type of familyById.application.types) {
    for (const option of type.options) {
        const pathname = buildCommandPath(type, option.value);
        assert.equal(commands.validateCommand(commandFromPath(pathname, type)), true, "Invalid Application command: " + pathname);
    }
}

for (const [value, label] of [
    ["toggle_zoom", "Fit / Fill Zoom"],
    ["next_screen_mode", "Cycle Screen Modes"],
    ["toggle_secondary_display", "Show / Hide Display"],
    ["toggle_secondary_fullscreen", "Full Screen / Windowed"]
]) {
    assert.equal(applicationTypes.action.options.find((option) => option.value === value).label, label);
}

const controllerSelection = extractValue(controllerSource, "const selectionGroups =")
    .flatMap((group) => group.commands);
const controllerCrop = extractValue(controllerSource, "const cropGroups =")
    .flatMap((group) => group.commands);
const controllerApplication = extractValue(controllerSource, "const applicationGroups =")
    .flatMap((group) => group.commands);
assert.equal(controllerSelection.length, 31, "Main Web Controller Selection count changed");
assert.equal(controllerCrop.length, 11, "Main Web Controller Crop count changed");
assert.equal(controllerApplication.length, 34, "Main Web Controller Application count changed");
assert.ok(!controllerSelection.some((item) => item.command === "selection.label.toggle"), "Main controller must continue hiding label toggle");
assert.ok(!controllerSelection.some((item) => item.command === "photo.treatment"),
    "Main Selection UI must continue hiding the removed Treatment section");
assert.equal(commands.validateCommand({ command: "selection.label.toggle", label: "red" }), true, "Backend label toggle support was removed");
assert.equal(commands.validateCommand({ command: "photo.treatment", value: "grayscale" }), true,
    "Treatment backend compatibility must remain available");

assert.ok(packageJson.scripts.test.includes("test:http-builder"), "Focused HTTP Builder test is not in npm test");
assert.ok(packageJson.scripts.test.includes("test:controller-commands"), "Controller prohibition tests must remain active");

for (const forbidden of ["AppActivate", "SendKeys", "AutoHotkey", "WScript.Shell"]) {
    assert.ok(!builderSource.includes(forbidden), "Builder introduced keyboard/focus automation: " + forbidden);
    assert.ok(!controllerSource.includes(forbidden), "Controller keyboard/focus prohibition regressed: " + forbidden);
}
const removedGroupResetToken = "reset-" + "group";
assert.ok(!builderSource.toLowerCase().includes(removedGroupResetToken), "Unsafe group-reset surface remains in Builder");

console.log("HTTP Builder v0.6 command-surface tests passed.");
console.log("Validated absolute Set, relative Adjust, individual Reset, 12 Develop actions, 33 Selection values, 13 fixed Photo values, a Custom Crop generator, and 34 Application values.");

// Exercise copied paths through real HTTP admission on disposable ports. No Lightroom or native helper.
async function verifyGeneratedHttpRequests() {
    const bridge = require("../server/bridge").createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    const originalLog = console.log;
    console.log = function () {};
    try {
        await bridge.start();
        const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const cases = [
            ...colorCases,
            [buildCommandPath(developTypes.set, "Exposure", 1.25), { command: "develop.set", slider: "Exposure", value: 1.25 }],
            [buildCommandPath(developTypes.adjust, "Contrast", -3), { command: "develop.adjust", slider: "Contrast", amount: -3 }],
            [buildCommandPath(developTypes.reset, "Contrast"), { command: "develop.reset", slider: "Contrast" }],
            [buildCustomCropPath("16", "10"), { command: "photo.crop_aspect", mode: "custom", w: 16, h: 10 }],
            [buildCropAnglePath("-2.5"), { command: "photo.crop_angle.set", value: -2.5 }],
            ["/command?command=photo.crop_angle.reset", { command: "photo.crop_angle.reset" }],
            ["/command?command=develop.action&action=selectCropTool&target=loupe", { command: "develop.action", action: "selectCropTool", target: "loupe" }]
        ];
        for (const family of families) for (const type of family.types.filter(type => type.options)) {
            for (const option of type.options) {
                const pathname = buildCommandPath(type, option.value, type.amountField ? 1 : undefined);
                cases.push([pathname, commandFromPath(pathname, type)]);
            }
        }
        for (const [pathname, expected] of cases) {
            const response = await fetch(base + pathname);
            assert.equal(response.status, 200, "Copied request must reach a supported route: " + pathname);
            const body = await response.json();
            assert.deepEqual(body, { ok: true, queued: expected }, "Admission confirms queueing only: " + pathname);
            assert.deepEqual(commands.getNextCommand(), expected, "Queued parameters must match copied request");
            assert.equal(commands.getNextCommand(), null, "Exactly one command per request");
        }
        let extraCount = 0;
        for (const family of directFamilies) for (const value of family.values) {
            // Seed feedback only in this disposable bridge, never the running LRBridge.
            if (family.route.startsWith("/develop-categorical/")) {
                const feedback = await fetch(base + "/develop-categorical/result?whiteBalanceAvailable=true&whiteBalance=As%20Shot&processAvailable=true&process=Version%206&vignetteStyleAvailable=true&vignetteStyle=1&uprightModeAvailable=true&uprightMode=0&constrainCropAvailable=true&constrainCrop=0&selectedToolAvailable=true&selectedTool=loupe");
                assert.equal(feedback.status, 200);
            }
            if (family.route === "/lens-blur/bokeh") {
                const feedback = await fetch(base + "/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Circle&selectedToolAvailable=true&selectedTool=loupe&focalRangeAvailable=false");
                assert.equal(feedback.status, 200);
            }
            const pathname = family.route + (family.field ? "?" + encodeURIComponent(family.field) + "=" + encodeURIComponent(String(value)) : "");
            const expected = { command: family.command, ...(family.field ? { [family.field]: value } : {}) };
            const response = await fetch(base + pathname);
            assert.equal(response.status, 200, "Simple card route admission: " + pathname);
            const body = await response.json();
            assert.equal(body.ok, true);
            assert.deepEqual(body.queued, expected);
            assert.deepEqual(commands.getNextCommand(), expected);
            assert.equal(commands.getNextCommand(), null);
            extraCount++;
        }
        const wrongPrefix = await fetch(base + "/api/command?command=develop.adjust&slider=Exposure&amount=1");
        assert.equal(wrongPrefix.status, 404, "Direct API must not be confused with the controller proxy");
        assert.equal(commands.getNextCommand(), null);
        originalLog("Copied Builder paths passed real isolated HTTP admission: " + (cases.length + extraCount) + " requests; no Lightroom execution claimed.");
    } finally {
        await bridge.stop();
        console.log = originalLog;
    }
}
verifyGeneratedHttpRequests().catch(error => { console.error(error); process.exitCode = 1; });
