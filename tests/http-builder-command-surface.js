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
    const end = source.indexOf(";", start);
    assert.notEqual(start, -1, "Missing declaration: " + declaration);
    assert.notEqual(end, -1, "Missing declaration terminator: " + declaration);
    const value = vm.runInNewContext("(" + source.slice(start + declaration.length, end).trim() + ")");
    return JSON.parse(JSON.stringify(value));
}

function extractFunction(source, name, nextName, context = {}) {
    const start = source.indexOf("function " + name + "(");
    const end = source.indexOf("function " + nextName + "(", start);
    assert.notEqual(start, -1, "Missing function: " + name);
    assert.notEqual(end, -1, "Missing following function: " + nextName);
    return vm.runInNewContext("(" + source.slice(start, end).trim() + ")", context);
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
const familyById = Object.fromEntries(families.map((family) => [family.id, family]));
const developTypes = Object.fromEntries(familyById.develop.types.map((type) => [type.id, type]));
const selectionTypes = Object.fromEntries(familyById.selection.types.map((type) => [type.id, type]));
const photoTypes = Object.fromEntries(familyById.photo.types.map((type) => [type.id, type]));
const applicationTypes = Object.fromEntries(familyById.application.types.map((type) => [type.id, type]));

assert.deepEqual(families.map((family) => family.id), ["develop", "selection", "photo", "application"]);
assert.equal(familyById.develop.types.filter((type) => type.valueSource).length + developTypes.action.options.length, 15);
assert.equal(familyById.selection.types.reduce((total, type) => total + type.options.length, 0), 33);
assert.equal(familyById.photo.types.reduce((total, type) => total + type.options.length, 0), 13);
assert.equal(familyById.application.types.reduce((total, type) => total + type.options.length, 0), 34);
assert.equal(
    sliders.getAll().filter((slider) => slider.id !== "LensProfileChromaticAberrationScale").length * 3 +
        developTypes.action.options.length,
    303,
    "Develop concrete Builder combination count changed"
);
assert.match(builderSource, /id="builderFamily"/);
assert.match(builderSource, /id="builderType"/);
assert.match(builderSource, /id="builderValue"/);
assert.match(builderSource, /id="builderPath"/);
assert.match(builderSource, /builderFamily\.addEventListener\("change", renderBuilderTypes\)/);
assert.match(builderSource, /builderType\.addEventListener\("change", renderBuilderValues\)/);
assert.match(builderSource, /builderValue\.addEventListener\("change", renderBuilderSliderSelection\)/);
assert.match(builderSource, /builderAmount\.addEventListener\("input", renderBuilderOutput\)/);
assert.match(builderSource, /customCropWidth\.addEventListener\("input", renderCustomCropOutput\)/);
assert.match(builderSource, /customCropHeight\.addEventListener\("input", renderCustomCropOutput\)/);
assert.match(builderSource, /copyText\(builderPath\.textContent\)/);
assert.match(builderSource, /copyText\(apiBase \+ builderPath\.textContent\)/);
assert.match(builderSource, /copyText\(path\)/, "Card Copy path behavior changed");
assert.match(builderSource, /copyText\(apiBase \+ path\)/, "Card Copy full URL behavior changed");
assert.match(builderSource, /fetch\("\/api\/sliders"\)/, "Slider choices must use current slider metadata");
assert.equal(
    buildCommandPath(developTypes.set, "Exposure", 1.25),
    "/api/set?slider=Exposure&value=1.25"
);
assert.equal(parseBuilderAbsoluteValue(sliders.getById("Exposure"), "1.25"), 1.25);
assert.equal(parseBuilderAbsoluteValue(sliders.getById("Exposure"), "1.234"), null);
assert.equal(parseBuilderAbsoluteValue(sliders.getById("Contrast"), "1.5"), null);
assert.match(builderSource, /copyBuilderPath"\)\.disabled = !valid/);
assert.match(builderSource, /copyBuilderFull"\)\.disabled = !valid/);

assert.equal(
    buildCommandPath(developTypes.adjust, "Exposure", -4),
    "/api/command?command=develop.adjust&slider=Exposure&amount=-4",
    "Develop slider adjust URL changed"
);
assert.equal(
    buildCommandPath(developTypes.adjust, "Exposure", 4),
    "/api/command?command=develop.adjust&slider=Exposure&amount=4",
    "Positive Develop slider amount changed"
);
assert.equal(
    buildCommandPath(developTypes.reset, "Exposure"),
    "/api/command?command=develop.reset&slider=Exposure",
    "Develop individual slider reset URL changed"
);
assert.equal(
    buildCommandPath(developTypes.adjust, "Slider A&B", -2),
    "/api/command?command=develop.adjust&slider=Slider%20A%26B&amount=-2",
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
    "/api/command?command=develop.action&action=resetAllDevelopAdjustments"
);

const renderedCards = [];
const renderContainer = {
    innerHTML: "",
    appendChild(card) {
        renderedCards.push(card);
    }
};
const renderSimple = extractFunction(builderSource, "renderSimple", "groupBy", {
    apiBase: "http://127.0.0.1:17891",
    document: {
        getElementById() {
            return renderContainer;
        }
    },
    makeCard(...args) {
        return args;
    }
});
const standaloneActions = developTypes.action.options.map((option) => [
    option.label,
    buildCommandPath(developTypes.action, option.value),
    option.description || ""
]);
renderSimple("actions", standaloneActions);

assert.equal(renderedCards.length, 12);
for (let index = 0; index < standaloneActions.length; index += 1) {
    const item = standaloneActions[index];
    assert.deepEqual(
        JSON.parse(JSON.stringify(renderedCards[index])),
        [
            item[0],
            [["Path", item[1]]],
            "http://127.0.0.1:17891" + item[1],
            item[2] || ""
        ],
        "Standalone Develop action card copy/display data drifted: " + item[0]
    );
}

const renderedReset = renderedCards.find((card) => card[0] === "Reset");
assert.deepEqual(JSON.parse(JSON.stringify(renderedReset)), [
    "Reset",
    [["Path", "/api/command?command=develop.action&action=resetAllDevelopAdjustments"]],
    "http://127.0.0.1:17891/api/command?command=develop.action&action=resetAllDevelopAdjustments",
    "Reset all Develop adjustments on the active photo"
]);
assert.match(builderSource, /descriptionEl\.className = "meta description"/);
assert.match(builderSource, /descriptionEl\.textContent = description/);
assert.doesNotMatch(
    builderSource,
    /makeCard\(item\[0\],\s*\[\["Path", item\[1\]\]\],\s*item\[2\]/,
    "Description must not occupy the full-URL/copy slot"
);

renderedCards.length = 0;
const getQuickCommands = extractFunction(builderSource, "getQuickCommands", "normalizeHost", { stepSize: 1 });
const quickCommands = getQuickCommands();
renderSimple("quick", quickCommands);
assert.equal(renderedCards.length, quickCommands.length);
for (let index = 0; index < quickCommands.length; index += 1) {
    assert.equal(renderedCards[index][2], "http://127.0.0.1:17891" + quickCommands[index][1]);
    assert.equal(renderedCards[index][3], "");
}
assert.ok(
    !developTypes.action.options.some((option) => /previous/i.test(option.value) || /previous/i.test(option.label)),
    "Develop Previous must not be exposed"
);

for (const slider of sliders.getAll()) {
    for (const type of [developTypes.adjust, developTypes.reset]) {
        const pathname = buildCommandPath(type, slider.id, -3);
        assert.equal(commands.validateCommand(commandFromPath(pathname, type)), true, "Invalid slider command: " + pathname);
    }
}

for (const slider of sliders.getAll().filter((item) => item.id !== "LensProfileChromaticAberrationScale")) {
    const rawValue = String(slider.default);
    const pathname = buildCommandPath(developTypes.set, slider.id, rawValue);
    assert.equal(pathname, "/api/set?slider=" + encodeURIComponent(slider.id) + "&value=" + encodeURIComponent(rawValue));
    assert.equal(parseBuilderAbsoluteValue(slider, rawValue), slider.default);
    assert.equal(commands.validateCommand({
        command: "develop.set",
        slider: slider.id,
        value: slider.default
    }), true, "Invalid absolute Builder command: " + pathname);
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
    "/api/command?command=selection.extend&direction=left&amount=25"
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
    "/api/command?command=photo.crop_aspect&mode=16x10"
);
for (const [width, height, expected] of [
    ["16", "10", "/api/command?command=photo.crop_aspect&mode=custom&w=16&h=10"],
    ["3", "2", "/api/command?command=photo.crop_aspect&mode=custom&w=3&h=2"],
    ["1", "1", "/api/command?command=photo.crop_aspect&mode=custom&w=1&h=1"],
    ["10000", "10000", "/api/command?command=photo.crop_aspect&mode=custom&w=10000&h=10000"]
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
assert.match(builderSource, /copyCustomCropPath\.disabled = !valid/);
assert.match(builderSource, /copyCustomCropFull\.disabled = !valid/);
for (const [value, expected] of [
    ["-45", "/api/command?command=photo.crop_angle.set&value=-45"],
    ["45", "/api/command?command=photo.crop_angle.set&value=45"],
    ["0", "/api/command?command=photo.crop_angle.set&value=0"],
    ["-2.5", "/api/command?command=photo.crop_angle.set&value=-2.5"],
    ["12.25", "/api/command?command=photo.crop_angle.set&value=12.25"]
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
assert.match(builderSource, /copyCropAnglePath\.disabled = !valid/);
assert.match(builderSource, /copyCropAngleFull\.disabled = !valid/);
assert.match(builderSource, /copyText\("\/api\/command\?command=photo\.crop_angle\.reset"\)/);
assert.deepEqual(photoTypes.reveal.options, [
    { value: "active", label: "Show in Explorer" }
]);
assert.equal(
    buildCommandPath(photoTypes.rotate, "left"),
    "/api/command?command=photo.rotate&direction=left",
    "Existing Rotate Left URL changed"
);
assert.equal(
    buildCommandPath(photoTypes.rotate, "right"),
    "/api/command?command=photo.rotate&direction=right",
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
assert.equal(controllerSelection.length, 33, "Main Web Controller Selection count changed");
assert.equal(controllerCrop.length, 11, "Main Web Controller Crop count changed");
assert.equal(controllerApplication.length, 34, "Main Web Controller Application count changed");
assert.ok(!controllerSelection.some((item) => item.command === "selection.label.toggle"), "Main controller must continue hiding label toggle");
assert.equal(commands.validateCommand({ command: "selection.label.toggle", label: "red" }), true, "Backend label toggle support was removed");

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
