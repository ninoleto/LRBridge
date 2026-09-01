const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const commands = require("../server/commands");
const controllerScript = source.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(controllerScript, "Controller script is missing");
assert.doesNotThrow(() => new vm.Script(controllerScript[1]), "Controller JavaScript must parse");

function extractJavaScriptValue(declaration) {
    const start = source.indexOf(declaration);
    const end = source.indexOf(";", start);
    assert.notEqual(start, -1, "Missing controller declaration: " + declaration);
    assert.notEqual(end, -1, "Missing declaration terminator: " + declaration);
    const value = vm.runInNewContext("(" + source.slice(start + declaration.length, end).trim() + ")");
    return JSON.parse(JSON.stringify(value));
}

function extractJavaScriptFunction(name, nextName, context) {
    const start = source.indexOf("function " + name + "(");
    const end = source.indexOf("function " + nextName + "(", start);
    assert.notEqual(start, -1, "Missing controller function: " + name);
    assert.notEqual(end, -1, "Missing following controller function: " + nextName);
    return vm.runInNewContext("(" + source.slice(start, end).trim() + ")", context);
}

function flatten(groups) {
    return groups.flatMap((group) => group.commands);
}

function normalizedCommand(item) {
    return {
        command: item.command,
        [item.field]: item.value,
        ...(item.params || {})
    };
}

function commandPath(item) {
    const parameters = [
        ["command", item.command],
        [item.field, item.value],
        ...Object.entries(item.params || {})
    ];
    return "/api/command?" + parameters.map(([key, value]) =>
        encodeURIComponent(key) + "=" + encodeURIComponent(String(value))
    ).join("&");
}

const selectionGroups = extractJavaScriptValue("const selectionGroups =");
const cropGroups = extractJavaScriptValue("const cropGroups =");
const applicationGroups = extractJavaScriptValue("const applicationGroups =");
const sliderActionGroups = extractJavaScriptValue("const sliderActionGroups =");
const toolTabs = extractJavaScriptValue("const toolTabs =");
const selectionItems = flatten(selectionGroups);
const cropItems = flatten(cropGroups);
const applicationItems = flatten(applicationGroups);
const allItems = selectionItems.concat(cropItems, applicationItems);

const visibleWebControllerActions = extractJavaScriptFunction(
    "visibleWebControllerActions", "renderActionGroup", {}
);
const colorActions = sliderActionGroups.find((group) => group.name === "Color Actions");
assert.ok(colorActions, "The underlying Color Actions registration must remain available");
assert.deepEqual(colorActions.actions.map((item) => item.action), ["setAutoWhiteBalance"],
    "Auto White Balance must remain registered for non-Web consumers");
assert.deepEqual(Array.from(visibleWebControllerActions(colorActions)), [],
    "The Web Controller must filter the duplicate Auto White Balance row");

const renderedActionSections = [];
const renderedActionRows = [];
const actionRenderContext = {
    visibleWebControllerActions,
    document: {
        createElement(tagName) {
            return {
                tagName,
                className: "",
                textContent: "",
                children: [],
                appendChild(child) { this.children.push(child); }
            };
        }
    },
    content: { appendChild(section) { renderedActionSections.push(section); } },
    addActionRow(section, item) { renderedActionRows.push({ section, item }); }
};
const renderActionGroup = extractJavaScriptFunction(
    "renderActionGroup", "renderSwitchGroup", actionRenderContext
);
assert.equal(renderActionGroup(colorActions), false);
assert.equal(renderedActionSections.length, 0,
    "An empty Color Actions heading must not enter the rendered DOM");
assert.equal(renderedActionRows.length, 0,
    "Auto White Balance must not enter the rendered Web Controller DOM");
const developActions = sliderActionGroups.find((group) => group.name === "Develop Actions");
assert.equal(renderActionGroup(developActions), true);
assert.equal(renderedActionSections.length, 1,
    "Visible action groups must continue rendering normally");
assert.equal(renderedActionRows.length, 1);

assert.match(source, /id:\s*"selection",\s*label:\s*"Selection"/, "Selection tab is missing");
assert.match(source, /id:\s*"crop",\s*label:\s*"Crop"/, "Crop tab is missing");
assert.match(source, /id:\s*"application",\s*label:\s*"Application"/, "Application tab is missing");
assert.match(source, /activeTab === "selection"[\s\S]*renderCommandGroups\(selectionGroups\)/, "Selection tab renderer is missing");
assert.match(source, /activeTab === "crop"[\s\S]*renderCommandGroups\(cropGroups\)/, "Crop tab renderer is missing");
assert.match(source, /activeTab === "application"[\s\S]*renderCommandGroups\(applicationGroups\)/, "Application tab renderer is missing");
assert.equal((source.match(/label: "Retouching"/g) || []).length, 1, "Retouching must appear exactly once in main navigation");
assert.doesNotMatch(source.match(/const allTabs = \[[\s\S]*?\];/)[0], /label: "(?:Healing|Red Eye|Masking)"/,
    "Legacy tools must not remain separate main tabs");
assert.match(source, /function renderRetouchingTab\(\)[\s\S]*\["healing", "redEye", "masking"\]\.forEach[\s\S]*if \(tab\) renderToolTab\(tab\)/,
    "Retouching must reuse the existing tool renderer in Healing, Red Eye, Masking order");
assert.deepEqual(toolTabs.map((tab) => tab.title), ["Healing", "Red Eye", "Masking"]);
assert.deepEqual(toolTabs.map((tab) => tab.actions.map((action) => [action.label, action.action, action.button])), [
    [["Healing Tool", "selectHealingTool", "Select"], ["Reset Spot Removal", "resetSpotRemoval", "Reset"]],
    [["Red Eye Tool", "selectRedEyeTool", "Select"], ["Reset Red Eye", "resetRedeye", "Reset"]],
    [["Masking Tool", "selectMaskingTool", "Select"]]
], "Retouching action definitions or command payloads drifted");
const normalizeControllerTab = extractJavaScriptFunction("normalizeControllerTab", "tabFromLocation", {});
for (const legacyTab of ["healing", "redEye", "masking"]) {
    assert.equal(normalizeControllerTab(legacyTab), "retouching", "Legacy tab did not migrate: " + legacyTab);
}
assert.equal(normalizeControllerTab("tone-curve"), "tone-curve");
const tabsCss = source.match(/\.tabs\s*\{[\s\S]*?\}/)[0];
const tabButtonCss = source.match(/\.tab-button\s*\{[\s\S]*?\}/)[0];
assert.match(tabsCss, /flex-wrap:\s*wrap/, "Main tabs must continue wrapping");
assert.match(tabButtonCss, /min-height:\s*(?:4[89]|5\d)px/, "Main tabs require at least a 48px touch target");
assert.match(tabButtonCss, /align-items:\s*center/, "Main tab labels must remain vertically centered");
assert.match(source, /\.tab-button\.active\s*\{[\s\S]*box-shadow:\s*inset 0 -3px 0 #ffb454/,
    "Active-tab underline styling must remain intact");
assert.match(source, /sendCommand\(commandPath\(item\)\)/, "Command buttons must reuse sendCommand()");
assert.match(
    source,
    /<header class="controller-header">\s*<h1>LRBridge Web Controller<\/h1>\s*<a class="header-help-button" href="\/help" target="_blank" rel="noopener">Open Help<\/a>\s*<\/header>/,
    "Compact title and human-help link must share the controller header"
);
assert.doesNotMatch(source, /This page only sends commands to Lightroom Classic|Open API Help|class="toolbar"|\.toolbar\s*\{/);
assert.match(source, /mainButton\.textContent = "Slider Group ▾"/, "Slider jump menu label is missing");
assert.doesNotMatch(source, /mainButton\.textContent = "Section ▾"/, "Old slider jump menu label must not be visible");

const nativeDevelopReset = sliderActionGroups
    .flatMap((group) => group.actions)
    .filter((item) => item.action === "resetAllDevelopAdjustments");
assert.deepEqual(
    nativeDevelopReset,
    [{
        label: "Reset all Develop adjustments on the active photo",
        action: "resetAllDevelopAdjustments",
        button: "Reset",
        className: "reset"
    }],
    "Native Develop Reset controller button drifted"
);

const placementCalls = [];
const developSectionDisplayOrder = vm.runInNewContext("(" + source.match(
    /const developSectionDisplayOrder = Object\.freeze\((\[[\s\S]*?\])\);/
)[1] + ")");
const developSectionIds = Array.from(developSectionDisplayOrder, (section) => section.id);
assert.deepEqual(
    developSectionIds.slice(-5),
    ["lens-corrections", "transform", "lens-blur", "effects", "calibration"],
    "Develop panels must end in Lightroom's Lens Corrections, Transform, Lens Blur, Effects, Calibration order"
);
assert.match(
    source,
    /function getSliderJumpSections\(\)[\s\S]*developSectionDisplayOrder\.forEach/,
    "Jump To must derive its Develop entries from the corrected section order"
);
assert.match(source,
    /section\.id === "presence"[\s\S]*tab: "tone-curve", label: "Tone Curve"[\s\S]*section\.id === "color-mixer"[\s\S]*tab: "color-grading", label: "Color Grading"/,
    "Jump To must insert the two dedicated navigation links at their requested positions");
const sliderRenderContext = {
    developSliderDefinitions: [{ id: "Exposure", group: "Basic" }],
    developSectionDisplayOrder,
    sliderActionGroups,
    switchGroups: extractJavaScriptValue("const switchGroups ="),
    treatmentAuthoritativeState: false,
    treatmentHasAuthoritativeState: true,
    developRenderedSections: {},
    renderActionsForPlacement(placement) {
        placementCalls.push(["actions", placement]);
    },
    renderSwitchesForPlacement(placement) {
        placementCalls.push(["switches", placement]);
    },
    document: {
        createElement() {
            return {
                appendChild() {}
            };
        }
    },
    content: {
        appendChild() {}
    },
    createDevelopSliderControl() {
        return {};
    },
    setTimeout() {
        // Snapshot scheduling is covered by the focused generic-slider tests.
    },
    setStatus() {}
};
sliderRenderContext.renderBasicControlsRow = function () {};
sliderRenderContext.renderEnhanceSection = function () {};
sliderRenderContext.updateDevelopCategoricalControls = function () {};
sliderRenderContext.requestDevelopCategoricalState = function () {};
sliderRenderContext.getDevelopSectionDisplayLabel = function (section) { return section.label; };
sliderRenderContext.createDevelopSectionElement = function () { return {}; };
sliderRenderContext.selectDevelopSectionDefinitions = extractJavaScriptFunction(
    "selectDevelopSectionDefinitions", "updateTreatmentButton", sliderRenderContext
);
sliderRenderContext.validateDevelopSectionMapping = extractJavaScriptFunction(
    "validateDevelopSectionMapping", "createDevelopCategoricalSelector", sliderRenderContext
);
const renderSlidersTab = extractJavaScriptFunction("renderSlidersTab", "renderToneCurveTab", sliderRenderContext);
renderSlidersTab();
assert.deepEqual(placementCalls[0], ["actions", "top"], "Develop Actions must remain first");
assert.ok(!placementCalls.some((entry) => entry[0] === "actions" && entry[1] === "before:Basic"),
    "Auto Tone must not be duplicated through the old Basic Actions placement");
assert.match(source, /basicActions\.actions\.find\(function \(item\) \{ return item\.action === "setAutoTone"; \}\)/,
    "Compact Auto must reuse the existing Auto Tone action definition");
assert.match(source, /row\.appendChild\(autoButton\)[\s\S]*row\.appendChild\(treatmentButton\)/,
    "Compact Basic controls must render Auto before B&W");
{
    function treatmentClassList() {
        const values = new Set();
        return {
            toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
            has(value) { return values.has(value); }
        };
    }
    const attributes = {};
    const button = {
        disabled: false,
        classList: treatmentClassList(),
        title: "",
        setAttribute(name, value) { attributes[name] = value; }
    };
    const status = { textContent: "" };
    const treatmentPresentationContext = {
        treatmentButton: button,
        treatmentStatus: status,
        treatmentPending: false,
        treatmentHasAuthoritativeState: true,
        treatmentAuthoritativeState: false,
        treatmentStateFresh: true,
        selectedProfileLabel: "Adaptive Color"
    };
    const updateTreatmentButton = extractJavaScriptFunction(
        "updateTreatmentButton",
        "invalidateTreatmentState",
        treatmentPresentationContext
    );
    function assertTreatmentPresentation(grayscale, expectedText) {
        treatmentPresentationContext.treatmentAuthoritativeState = grayscale;
        updateTreatmentButton();
        assert.equal(button.classList.has("bw-treatment-active"), grayscale,
            expectedText + " treatment button color drifted");
        assert.equal(attributes["aria-pressed"], String(grayscale),
            expectedText + " treatment aria-pressed drifted");
        assert.equal(status.textContent, expectedText,
            "Button and adjacent status must share the authoritative treatment boolean");
    }
    assertTreatmentPresentation(false, "Color");
    assertTreatmentPresentation(true, "Black & White");
    treatmentPresentationContext.selectedProfileLabel = "Adobe Color";
    assertTreatmentPresentation(true, "Black & White");
    treatmentPresentationContext.selectedProfileLabel = "Adaptive Color";
    assertTreatmentPresentation(true, "Black & White");
    treatmentPresentationContext.selectedProfileLabel = "Adobe Monochrome";
    assertTreatmentPresentation(true, "Black & White");
    assertTreatmentPresentation(false, "Color");
    treatmentPresentationContext.selectedProfileLabel = "Adaptive B&W";
    assertTreatmentPresentation(false, "Color");
    assertTreatmentPresentation(true, "Black & White");
    assertTreatmentPresentation(false, "Color");
    treatmentPresentationContext.treatmentPending = true;
    treatmentPresentationContext.treatmentDesiredState = true;
    updateTreatmentButton();
    assert.equal(button.classList.has("bw-treatment-active"), false,
        "A Web Controller click must not optimistically activate B&W presentation");
    assert.equal(attributes["aria-pressed"], "false");
    assert.equal(status.textContent, "Applying…");
}
const treatmentPresentationSource = source.slice(
    source.indexOf("function updateTreatmentButton("),
    source.indexOf("function invalidateTreatmentState(")
);
assert.doesNotMatch(treatmentPresentationSource, /profile/i,
    "B&W button presentation must not inspect Profile labels or families");
assert.match(source,
    /treatmentAuthoritativeState = snapshot\.grayscale;[\s\S]*treatmentHasAuthoritativeState = true;[\s\S]*updateTreatmentButton\(\)/,
    "Direct authoritative Lightroom treatment feedback must update the B&W button");
assert.equal(new Set(placementCalls.map((entry) => entry.join(":"))).size, placementCalls.length,
    "Develop action or switch placements must not be duplicated by multi-source sections");

assert.match(
    source,
    /makeButton\(item\.button \|\| "Send",\s*item\.className \|\| "positive"[\s\S]*?sendCommand\("\/api\/action\?action=" \+ encodeURIComponent\(item\.action\)\)/,
    "Develop action buttons must send their validated convenience action route"
);
assert.ok(
    !sliderActionGroups.flatMap((group) => group.actions)
        .some((item) => /previous/i.test(item.action) || /previous/i.test(item.label) || /previous/i.test(item.button)),
    "Develop Previous must not be exposed in the Web Controller"
);

const expectedSelection = [
    ["selection.navigate", "direction", "first"],
    ["selection.navigate", "direction", "previous"],
    ["selection.navigate", "direction", "next"],
    ["selection.navigate", "direction", "last"],
    ["selection.extend", "direction", "left"],
    ["selection.extend", "direction", "right"],
    ["photo.treatment", "value", "grayscale"],
    ["photo.treatment", "value", "color"],
    ["photo.rotate", "direction", "left"],
    ["photo.rotate", "direction", "right"],
    ["photo.reveal", "scope", "active"],
    ["selection.flag", "flag", "pick"],
    ["selection.flag", "flag", "reject"],
    ["selection.flag", "flag", "none"],
    ...[0, 1, 2, 3, 4, 5].map((rating) => ["selection.rating.set", "rating", rating]),
    ["selection.rating.adjust", "direction", "decrease"],
    ["selection.rating.adjust", "direction", "increase"],
    ...["red", "yellow", "green", "blue", "purple", "none"].map((label) => ["selection.label.set", "label", label]),
    ...["select_all", "select_none", "select_inverse", "deselect_active", "deselect_others"]
        .map((operation) => ["selection.operation", "operation", operation])
];

const expectedApplication = [
    ...["library", "develop", "map", "book", "slideshow", "print", "web"]
        .map((module) => ["application.module", "module", module]),
    ...["loupe", "grid", "compare", "survey", "people", "develop_loupe",
        "develop_before_after_horiz", "develop_before_after_vert", "develop_before",
        "develop_reference_horiz", "develop_reference_vert"]
        .map((view) => ["application.view", "view", view]),
    ...["toggle_zoom", "zoom_in", "zoom_out", "zoom_100", "fullscreen_preview",
        "fullscreen_hide_panels", "next_screen_mode", "toggle_secondary_display",
        "toggle_secondary_fullscreen"]
        .map((action) => ["application.action", "action", action]),
    ...["loupe", "live_loupe", "locked_loupe", "grid", "compare", "survey", "slideshow"]
        .map((view) => ["application.secondary_view", "view", view])
];

assert.deepEqual(
    selectionItems.map((item) => [item.command, item.field, item.value]),
    expectedSelection,
    "Selection controller commands drifted"
);
assert.equal(selectionItems.length, 33, "Selection tab must expose exactly 33 buttons");
assert.equal(cropItems.length, 11, "Crop tab must expose exactly 11 controls");
assert.equal(applicationItems.length, 34, "Application tab must expose exactly 34 buttons");
assert.deepEqual(
    cropGroups.filter((group) => !group.actionBar).map((group) => group.name),
    ["Aspect Ratio", "Angle"],
    "Visible Crop groups must follow Lightroom's order"
);
assert.equal(cropGroups.at(-1).name, "Crop Actions");
assert.equal(cropGroups.at(-1).actionBar, true, "Crop actions must render only in the bottom action bar");
assert.deepEqual(
    cropItems.map((item) => [item.label, item.customCrop ? "modal" : commandPath(item)]),
    [
        ["Original Aspect", "/api/command?command=photo.crop_aspect&mode=original"],
        ["1:1", "/api/command?command=photo.crop_aspect&mode=1x1"],
        ["2:3", "/api/command?command=photo.crop_aspect&mode=2x3"],
        ["4:5", "/api/command?command=photo.crop_aspect&mode=4x5"],
        ["5:7", "/api/command?command=photo.crop_aspect&mode=5x7"],
        ["16:9", "/api/command?command=photo.crop_aspect&mode=16x9"],
        ["16:10", "/api/command?command=photo.crop_aspect&mode=16x10"],
        ["Custom…", "modal"],
        ["Camera Crop", "/api/command?command=photo.crop_aspect&mode=asshot"],
        ["Reset Crop", "/api/command?command=develop.action&action=resetCrop"],
        ["Crop Tool", "/api/command?command=develop.action&action=selectCropTool"]
    ],
    "Crop tab controls drifted"
);
assert.equal(
    cropGroups.find((group) => group.name === "Aspect Ratio").commands.at(-1).value,
    "asshot",
    "Camera Crop must remain in the first Aspect Ratio block"
);
for (const cropValue of ["selectCropTool", "resetCrop", "original", "1x1", "2x3", "4x5", "5x7", "16x9", "16x10", "asshot"]) {
    assert.equal(allItems.filter((item) => item.value === cropValue).length, 1, cropValue + " must appear exactly once");
    assert.ok(!selectionItems.concat(applicationItems).some((item) => item.value === cropValue), cropValue + " leaked into another command tab");
}
assert.equal(cropItems.filter((item) => item.customCrop).length, 1, "Custom Crop modal control must appear once");
const angleGroup = cropGroups.find((group) => group.name === "Angle");
assert.equal(angleGroup.angleControl, true);
assert.deepEqual(angleGroup.commands, []);
assert.equal(angleGroup.note, "Reset Angle resets only straightening. Reset Crop resets the entire crop state.");
for (const unsupportedLabel of ["Auto", "Auto Straighten", "Constrain to Image", "Tool Overlay"]) {
    assert.ok(!cropItems.some((item) => item.label === unsupportedLabel),
        unsupportedLabel + " must not be exposed as a fake Crop control");
}
assert.ok(!cropGroups.some((group) => group.name === "Constrain to Image" || group.name === "Tool Overlay"),
    "Unsupported Crop settings must not render as separate sections");
const consolidatedCropLimitation =
    "Auto Straighten, Constrain to Image, and Tool Overlay must be controlled manually in Lightroom because they are not exposed through the SDK.";
assert.ok(source.includes("const cropSdkLimitations = " + JSON.stringify(consolidatedCropLimitation) + ";"),
    "The consolidated Crop SDK limitation text drifted");
const cropLimitationsCss = source.match(/\.crop-sdk-limitations\s*\{[\s\S]*?\}/)[0];
assert.match(cropLimitationsCss, /color:\s*#9fb0bf/);
assert.match(cropLimitationsCss, /font-size:\s*13px/);
assert.doesNotMatch(cropLimitationsCss, /background|border/,
    "The consolidated Crop limitation must remain subdued informational text");
assert.doesNotMatch(source, /manualOnly|crop-manual-only/);
assert.match(source, /if \(group\.actionBar\) continue;/, "The former top Crop Tool action group must not render");
assert.match(source, /function renderCropTab\([\s\S]*renderCommandGroups\(cropGroups\);[\s\S]*createElement\("p"\)[\s\S]*limitations\.className = "crop-sdk-limitations"[\s\S]*content\.appendChild\(limitations\);[\s\S]*actionBar\.appendChild\(resetButton\);[\s\S]*actionBar\.appendChild\(cropToolButton\);[\s\S]*content\.appendChild\(actionBar\)/,
    "The consolidated SDK note must render after Angle and before the bottom Crop action bar");
assert.match(source, /\.crop-tool-action\s*\{\s*margin-left:\s*auto/,
    "The Crop Tool action must align to the bottom-right on wide layouts");
assert.match(source, /@media \(max-width: 760px\)[\s\S]*\.crop-action-bar\s*\{[\s\S]*grid-template-columns:[\s\S]*\.crop-action-bar button\s*\{[\s\S]*min-width:\s*0/,
    "Crop actions must retain a touch-sized responsive layout");
assert.match(source, /angleRange\.type = "range"/);
assert.match(source, /angleRange\.min = "-45"/);
assert.match(source, /angleRange\.max = "45"/);
assert.match(source, /angleRange\.step = "0\.1"/);
assert.match(source, /angleNumber\.type = "text"/);
assert.match(source, /angleNumber\.inputMode = "decimal"/);
assert.match(source, /angleNumber\.autocomplete = "off"/);
assert.match(source, /angleNumber\.spellcheck = false/);
assert.doesNotMatch(source, /angleNumber\.type = "number"/);
assert.match(source, /makeButton\("−", "develop-slider-step"[\s\S]*makeButton\("\+", "develop-slider-step"[\s\S]*makeButton\("Reset", "reset"/);
assert.match(source, /row\.appendChild\(name\);\s*row\.appendChild\(angleRange\);\s*row\.appendChild\(angleNumber\);\s*row\.appendChild\(angleDecrementButton\);\s*row\.appendChild\(angleIncrementButton\);\s*row\.appendChild\(angleResetButton\)/);
assert.match(source, /angleResetButton = makeButton\("Reset", "reset"[\s\S]*showLocalAngle\(0\)[\s\S]*photo\.crop_angle\.reset/);
assert.match(source, /angleRange\.addEventListener\("input"[\s\S]*showLocalAngle\(value\)[\s\S]*scheduleAngleValue\(value\)/);
assert.match(source, /setTimeout\(function \(\)[\s\S]*\}, 100\)/);
assert.match(source, /angleRange\.addEventListener\("pointerup"[\s\S]*flushAngleValue/);
assert.match(source, /if \(angleDragging[\s\S]*return/);
assert.match(source, /applyAuthoritativeAngleFeedback\(result\.value\)/);
assert.match(source, /sliderFeedbackElements\.CropAngle = angleValueLabel/);
const angleStepBlock = source.match(/function stepAngleValue\(direction\)[\s\S]*?async function submitAngleValue/)[0];
assert.match(angleStepBlock, /direction \* 0\.1/);
assert.match(angleStepBlock, /Math\.max\(-45, Math\.min\(45,/);
assert.match(angleStepBlock, /showLocalAngle\(value\)[\s\S]*scheduleAngleValue\(value\)/);
assert.match(source, /angleDecrementButton\.disabled = Number\(value\) <= -45/);
assert.match(source, /angleIncrementButton\.disabled = Number\(value\) >= 45/);
assert.match(source, /function markAngleUnavailable[\s\S]*angleDecrementButton\.disabled = true[\s\S]*angleIncrementButton\.disabled = true[\s\S]*angleResetButton\.disabled = true/);
assert.match(source, /\.develop-slider-row,\s*\.angle-control\s*\{[\s\S]*grid-template-columns:\s*minmax\(140px, 210px\) minmax\(180px, 1fr\) 92px 44px 44px auto[\s\S]*min-width:\s*0/);
assert.match(source, /\.angle-control button\s*\{\s*min-height:\s*44px/);
assert.match(source, /\.angle-control input\[type="text"\][\s\S]*min-height:\s*44px/);
assert.match(source, /@media \(max-width: 760px\)[\s\S]*\.angle-control\s*\{[\s\S]*grid-template-columns:\s*minmax\(92px, 1fr\) 44px 44px minmax\(70px, auto\)[\s\S]*\.angle-control input\[type="range"\]\s*\{\s*grid-column:\s*1 \/ -1/);
assert.match(source, /\.angle-value\s*\{[\s\S]*height:\s*16px[\s\S]*visibility:\s*hidden/);
assert.match(source, /\.angle-value:not\(:empty\)\s*\{\s*visibility:\s*visible/);
const parseAngleValue = extractJavaScriptFunction("parseAngleValue", "angleCommandPath", { Number });
const angleCommandPath = extractJavaScriptFunction("angleCommandPath", "showLocalAngle", {
    encodeURIComponent
});
const cropToolCommandPath = extractJavaScriptFunction("cropToolCommandPath", "cropToolPresentation", {
    encodeURIComponent
});
const cropToolPresentation = extractJavaScriptFunction("cropToolPresentation", "updateCropToolPresentation", {});
assert.equal(parseAngleValue("-2.5"), -2.5);
assert.equal(parseAngleValue("12.25"), 12.25);
assert.equal(parseAngleValue("12,25"), 12.25);
assert.equal(parseAngleValue("12."), 12);
assert.equal(parseAngleValue("1.234"), null);
for (const intermediate of ["", "-", ".", "-."]) assert.equal(parseAngleValue(intermediate), null);
assert.match(source, /angleNumber\.addEventListener\("focus"[\s\S]*angleEditing = true/);
assert.doesNotMatch(source, /angleNumber\.addEventListener\("input"/);
assert.match(source, /event\.key === "Enter"[\s\S]*commitNumericAngle\(\)/);
assert.match(source, /event\.key === "Escape"[\s\S]*showLocalAngle\(authoritativeAngleValue\)[\s\S]*angleNumber\.blur\(\)/);
assert.match(source, /angleNumber\.addEventListener\("blur"[\s\S]*if \(angleEditing\) commitNumericAngle\(\)/);
assert.match(source, /if \(value === null\)[\s\S]*showLocalAngle\(authoritativeAngleValue\)/);
assert.equal(angleCommandPath(-2.5), "/api/command?command=photo.crop_angle.set&value=-2.5");
assert.equal(cropToolCommandPath("crop"),
    "/api/command?command=develop.action&action=selectCropTool&target=crop");
assert.equal(cropToolCommandPath("loupe"),
    "/api/command?command=develop.action&action=selectCropTool&target=loupe");
assert.equal(cropToolCommandPath("upright"), null);
assert.deepEqual(Object.assign({}, cropToolPresentation({ selectedToolAvailable: true, selectedTool: "loupe" })), {
    available: true, active: false, label: "Open Crop Tool", status: "Crop tool inactive"
});
assert.deepEqual(Object.assign({}, cropToolPresentation({ selectedToolAvailable: true, selectedTool: "crop" })), {
    available: true, active: true, label: "Close Crop Tool", status: "Crop tool active"
});
assert.deepEqual(Object.assign({}, cropToolPresentation({ selectedToolAvailable: false, selectedTool: null })), {
    available: false, active: false, label: "Open Crop Tool", status: "Selected Lightroom tool unavailable"
});
assert.match(source, /function submitCropToolAction\([\s\S]*selectedToolAvailable !== true[\s\S]*selectedTool === "crop"\) path = cropToolCommandPath\("loupe"\)[\s\S]*else path = cropToolCommandPath\("crop"\)/,
    "Crop Tool action must choose explicit crop/loupe targets from authoritative selected-tool state");
const cropToolSubmitBlock = source.match(/function submitCropToolAction\([\s\S]*?\n\s*}\n\n\s*function renderCropTab/)[0];
assert.doesNotMatch(cropToolSubmitBlock, /textContent|classList|\.apply\(|selectedTool\s*=(?!=)/,
    "Crop Tool submission must not optimistically change the selected-tool presentation");
assert.match(source, /isGenericDevelopFeedbackTab\(tab\)[\s\S]*tab === "crop"/);
assert.match(source, /activeTab === "sliders" \|\| activeTab === "crop"\) requestDevelopCategoricalState\(\)/);
assert.match(source, /activeTab === "crop" \? \["CropAngle"\]/,
    "Crop feedback polling must request authoritative Angle immediately");
assert.match(source, /function updateDevelopCategoricalControls\([\s\S]*updateCropToolPresentation\(\)/,
    "Authoritative selected-tool feedback must update the Crop Tool button");
const cropToolPresentationUpdateBlock = source.match(
    /function updateCropToolPresentation\([\s\S]*?\n\s*}\n\n\s*function submitCropToolAction/
)[0];
assert.doesNotMatch(cropToolPresentationUpdateBlock, /aria-pressed/,
    "Open/Close Crop Tool must remain an explicit action rather than expose toggle semantics");
assert.match(source, /activeTab === "crop"\)[\s\S]*renderCropTab\(\);\s*if \(genericFeedbackActive\) requestLiveFeedbackSnapshot\(true\);\s*else activateDevelopFeedbackPolling\(\)/,
    "Crop must request one immediate snapshot whether polling is newly activated or already active");
assert.equal(commands.validateCommand({ command: "develop.action", action: "selectCropTool" }), true,
    "Legacy selectCropTool calls must remain valid");
assert.equal(commands.validateCommand({ command: "develop.action", action: "selectCropTool", target: "crop" }), true);
assert.equal(commands.validateCommand({ command: "develop.action", action: "selectCropTool", target: "loupe" }), true);
assert.equal(commands.validateCommand({ command: "develop.action", action: "selectCropTool", target: "upright" }), false);
assert.equal(commands.validateCommand({ command: "develop.action", action: "resetCrop", target: "loupe" }), false);
assert.equal(commands.validateCommand({ command: "develop.action", action: "selectCropTool", target: "crop", extra: true }), false);
assert.equal(commands.validateCommand({ command: "selection.navigate", direction: "next", target: "crop" }), false);
assert.equal(commands.validateCommand({ command: "selection.navigate", direction: "next", target: undefined }), false);

{
    let visibleValue = 0;
    const scheduled = [];
    const angleStepContext = {
        Math,
        angleNumber: { value: "0" },
        parseAngleValue(value) { return Number(value); },
        showLocalAngle(value) { visibleValue = value; angleStepContext.angleNumber.value = String(value); },
        scheduleAngleValue(value) { scheduled.push(value); },
        numericAngleCommittedValue: null
    };
    const stepStart = source.indexOf("function stepAngleValue(");
    const stepEnd = source.indexOf("function submitAngleValue(", stepStart);
    const stepAngleValue = vm.runInNewContext(
        "(" + source.slice(stepStart, stepEnd).replace(/\s*async\s*$/, "").trim() + ")",
        angleStepContext
    );
    stepAngleValue(-1);
    assert.equal(visibleValue, -0.1, "Minus must immediately decrease Angle by 0.1 degrees");
    stepAngleValue(1);
    assert.equal(visibleValue, 0, "Plus must immediately increase Angle by 0.1 degrees");
    thisAngleTest(stepAngleValue, -45, -1, -45);
    thisAngleTest(stepAngleValue, 45, 1, 45);
    assert.deepEqual(scheduled.slice(0, 2), [-0.1, 0]);

    function thisAngleTest(step, start, direction, expected) {
        visibleValue = start;
        angleStepContext.angleNumber.value = String(start);
        step(direction);
        assert.equal(visibleValue, expected);
    }
}

{
    const timers = [];
    const submitted = [];
    const scheduleAngleValue = extractJavaScriptFunction("scheduleAngleValue", "flushAngleValue", {
        pendingAngleValue: null,
        angleThrottleTimer: null,
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return 1;
        },
        submitAngleValue(value) { submitted.push(value); }
    });
    scheduleAngleValue(0.1);
    scheduleAngleValue(0.2);
    scheduleAngleValue(0.3);
    assert.equal(timers.length, 1, "Rapid Angle steps must share the existing throttle timer");
    assert.equal(timers[0].delay, 100);
    timers[0].callback();
    assert.deepEqual(submitted, [0.3], "Only the newest rapidly stepped Angle value should be submitted");
}
assert.match(source, /<h2 id="customCropTitle">Custom Crop Ratio<\/h2>/);
assert.match(source, /id="customCropWidth"[^>]*value="16"/);
assert.match(source, /id="customCropHeight"[^>]*value="10"/);
assert.match(source, /if \(item\.customCrop\)[\s\S]*openCustomCropModal\(\)/);
assert.match(source, /customCropForm\.addEventListener\("submit"[\s\S]*applyCustomCrop\(\)/);
assert.match(source, /event\.key === "Escape"[\s\S]*closeCustomCropModal\(\)/);
assert.match(source, /const accepted = await sendCommand\(customCropCommandPath\(dimensions\.width, dimensions\.height\)\)/);
assert.match(source, /if \(accepted\)[\s\S]*customCropModal\.hidden = true/);

const parseCustomCropDimension = extractJavaScriptFunction(
    "parseCustomCropDimension",
    "customCropCommandPath",
    { Number }
);
const customCropCommandPath = extractJavaScriptFunction(
    "customCropCommandPath",
    "validateCustomCropModal",
    { encodeURIComponent }
);
assert.equal(parseCustomCropDimension("16"), 16);
assert.equal(parseCustomCropDimension("10000"), 10000);
for (const invalid of ["", "0", "-1", "1.5", " 16", "10001"]) {
    assert.equal(parseCustomCropDimension(invalid), null);
}
assert.equal(
    customCropCommandPath(16, 10),
    "/api/command?command=photo.crop_aspect&mode=custom&w=16&h=10"
);
assert.deepEqual(
    selectionGroups.find((group) => group.name === "Extend Selection").commands
        .map((item) => [item.label, item.command, item.value, item.params]),
    [
        ["Extend Left", "selection.extend", "left", { amount: 1 }],
        ["Extend Right", "selection.extend", "right", { amount: 1 }]
    ],
    "Extend Selection buttons must use amount=1"
);
assert.deepEqual(
    selectionGroups.find((group) => group.name === "Treatment").commands
        .map((item) => [item.label, item.command, item.value]),
    [
        ["Black & White", "photo.treatment", "grayscale"],
        ["Color", "photo.treatment", "color"]
    ],
    "Photo treatment controls drifted"
);
assert.deepEqual(
    selectionGroups.find((group) => group.name === "Photo").commands
        .map((item) => [item.label, item.command, item.value]),
    [
        ["Rotate Left", "photo.rotate", "left"],
        ["Rotate Right", "photo.rotate", "right"],
        ["Show in Explorer", "photo.reveal", "active"]
    ],
    "Photo rotation controls drifted"
);
assert.equal(
    commands.validateCommand({ command: "selection.label.toggle", label: "red" }),
    true,
    "Backend selection.label.toggle support must remain available"
);
const colorLabelCommands = selectionGroups.find((group) => group.name === "Color Label").commands;
assert.deepEqual(
    colorLabelCommands.map((item) => item.label),
    ["Red", "Yellow", "Green", "Blue", "Purple", "None"],
    "Color Label controls drifted"
);
assert.ok(
    colorLabelCommands.every((item) => item.command === "selection.label.set"),
    "Every Color Label button must use selection.label.set"
);
assert.deepEqual(
    selectionItems.map((item) => [item.label, item.className]),
    [
        ...["First", "Previous", "Next", "Last"].map((label) => [label, "command-primary"]),
        ["Extend Left", "command-primary"],
        ["Extend Right", "command-primary"],
        ["Black & White", "command-neutral"],
        ["Color", "command-primary"],
        ["Rotate Left", "command-primary"],
        ["Rotate Right", "command-primary"],
        ["Show in Explorer", "command-neutral"],
        ["Pick", "command-success"],
        ["Reject", "command-danger"],
        ["Unflag", "command-neutral"],
        ["0 Stars", "command-neutral"],
        ...["1 Star", "2 Stars", "3 Stars", "4 Stars", "5 Stars"].map((label) => [label, "command-warning"]),
        ["Decrease Rating", "command-neutral"],
        ["Increase Rating", "command-primary"],
        ["Red", "label-red"],
        ["Yellow", "label-yellow"],
        ["Green", "label-green"],
        ["Blue", "label-blue"],
        ["Purple", "label-purple"],
        ["None", "label-none"],
        ["Select All", "command-primary"],
        ["Select None", "command-neutral"],
        ["Invert Selection", "command-purple"],
        ["Deselect Active", "command-warning"],
        ["Deselect Others", "command-warning"]
    ],
    "Selection semantic button classes drifted"
);
assert.doesNotMatch(source, /selection\.label\.toggle/, "selection.label.toggle must not be exposed in the Web Controller");
assert.deepEqual(
    applicationItems.map((item) => [item.command, item.field, item.value]),
    expectedApplication,
    "Application controller commands drifted"
);
assert.deepEqual(
    applicationItems
        .filter((item) => ["toggle_zoom", "next_screen_mode", "toggle_secondary_display", "toggle_secondary_fullscreen"].includes(item.value))
        .map((item) => [item.label, item.command, item.value]),
    [
        ["Fit / Fill Zoom", "application.action", "toggle_zoom"],
        ["Cycle Screen Modes", "application.action", "next_screen_mode"],
        ["Show / Hide Display", "application.action", "toggle_secondary_display"],
        ["Full Screen / Windowed", "application.action", "toggle_secondary_fullscreen"]
    ],
    "Application screen and Secondary Display labels drifted"
);
assert.deepEqual(
    applicationItems
        .filter((item) => item.className)
        .map((item) => [item.label, item.className]),
    [
        ["Fullscreen Preview", "command-purple"],
        ["Fullscreen + Hide Panels", "command-purple"],
        ["Show / Hide Display", "command-neutral"],
        ["Full Screen / Windowed", "command-purple"]
    ],
    "Application semantic button classes drifted"
);
assert.ok(
    applicationItems.every((item) => (item.className || "command-primary") ===
        (["fullscreen_preview", "fullscreen_hide_panels", "toggle_secondary_fullscreen"].includes(item.value)
            ? "command-purple"
            : item.value === "toggle_secondary_display" ? "command-neutral" : "command-primary")),
    "Application command button hierarchy drifted"
);
assert.match(
    source,
    /makeButton\(item\.label,\s*item\.className \|\| "command-primary"/,
    "Generated command buttons must use their configured class with a command-primary fallback"
);

for (const className of [
    "command-primary", "command-neutral", "command-success", "command-danger", "command-warning",
    "command-purple", "label-red", "label-yellow", "label-green", "label-blue", "label-purple", "label-none"
]) {
    assert.ok(source.includes("button." + className), "Missing button style: " + className);
    assert.ok(source.includes("button." + className + ":hover"), "Missing hover style: " + className);
}

for (const item of allItems.filter((candidate) => !candidate.customCrop)) {
    const path = commandPath(item);
    const query = new URL("http://127.0.0.1" + path).searchParams;
    const parsed = {
        command: query.get("command"),
        [item.field]: item.field === "rating" ? Number(query.get(item.field)) : query.get(item.field),
        ...Object.fromEntries(Object.keys(item.params || {}).map((key) => [key, Number(query.get(key))]))
    };

    assert.equal(path.startsWith("/api/command?"), true, "Controller button must use the command endpoint: " + path);
    assert.deepEqual(parsed, normalizedCommand(item), "Controller path payload drifted: " + path);
    assert.equal(commands.validateCommand(parsed), true, "Invalid controller command: " + path);
}

assert.ok(!applicationItems.some((item) => item.value === "cycle_loupe_info"), "Failed cycle_loupe_info action must not be exposed");
assert.ok(!source.includes('"value": "cycle_loupe_info"'), "Failed cycle_loupe_info action leaked into controller definitions");

for (const existingControl of [
    "const sliderGroups =",
    "const sliderActionGroups =",
    "const switchGroups =",
    "const toolTabs =",
    "/api/adjust?slider=",
    "/api/reset?slider=",
    "/api/action?action="
]) {
    assert.ok(source.includes(existingControl), "Existing controller control is missing: " + existingControl);
}

for (const forbidden of ["AppActivate", "SendKeys", "AutoHotkey", "WScript.Shell"]) {
    assert.ok(!source.includes(forbidden), "Keyboard/focus automation must not be introduced: " + forbidden);
}

console.log("Web Controller Selection, Crop, and Application command-tab tests passed.");
console.log(
    "Validated " + selectionItems.length + " Selection buttons, " +
    cropItems.length + " Crop buttons, and " +
    applicationItems.length + " Application buttons."
);
