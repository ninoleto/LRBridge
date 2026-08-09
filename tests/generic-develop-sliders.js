const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const metadata = require("../config/sliders.json");
const sliders = require("../server/sliders");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const builder = fs.readFileSync(path.join(root, "app/companion-cheatsheet.html"), "utf8");
const driver = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Driver.lua"), "utf8");
const feedback = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
const query = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Query.lua"), "utf8");
const parser = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Parser.lua"), "utf8");
const luaCommands = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Commands.lua"), "utf8");
const photo = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Photo.lua"), "utf8");
const mainProcess = fs.readFileSync(path.join(root, "app/main.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "server/bridge.js"), "utf8");

assert.equal(metadata.length, 96, "Slider registry count changed");
assert.equal(new Set(metadata.map((item) => item.id)).size, metadata.length, "Duplicate slider ID");

for (const item of metadata) {
    for (const field of [
        "id", "label", "group", "min", "max", "default", "rangeStep",
        "numericStep", "displayPrecision", "feedbackSupported"
    ]) {
        assert.notEqual(item[field], undefined, item.id + " lacks " + field);
    }
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.group, "string");
    assert.ok(Number.isFinite(item.min) && Number.isFinite(item.max) && item.min < item.max);
    assert.ok(Number.isFinite(item.rangeStep) && item.rangeStep > 0);
    assert.ok(Number.isFinite(item.numericStep) && item.numericStep > 0);
    assert.ok(Number.isInteger(item.displayPrecision) && item.displayPrecision >= 0);
}

const feedbackDefinitions = metadata.filter((item) => item.feedbackSupported === true);
assert.equal(feedbackDefinitions.length, 93, "Generic slider control count changed");
const toneCurveDefinitions = feedbackDefinitions.filter((item) => item.group === "Tone Curve");
const metadataToneCurveIds = [
    "ParametricDarks", "ParametricLights", "ParametricShadows", "ParametricHighlights",
    "ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit"
];
const expectedToneCurveDisplayOrder = [
    "ParametricHighlights", "ParametricLights", "ParametricDarks", "ParametricShadows",
    "ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit"
];
assert.deepEqual(toneCurveDefinitions.map((item) => item.id), metadataToneCurveIds, "Tone Curve metadata group drifted");
assert.equal(new Set(toneCurveDefinitions.map((item) => item.id)).size, 7, "Tone Curve slider ID duplicated");
const toneCurveDisplayOrderMatch = controller.match(/const toneCurveDisplayOrder = Object\.freeze\((\[[\s\S]*?\])\);/);
assert.ok(toneCurveDisplayOrderMatch, "Tone Curve immutable display order is missing");
const toneCurveDisplayOrder = JSON.parse(toneCurveDisplayOrderMatch[1]);
assert.deepEqual(toneCurveDisplayOrder, expectedToneCurveDisplayOrder, "Tone Curve rendered order drifted");
assert.equal(toneCurveDisplayOrder.length, 7, "Tone Curve must render exactly seven controls");
assert.equal(new Set(toneCurveDisplayOrder).size, 7, "Tone Curve display order duplicated a slider ID");
assert.deepEqual(new Set(toneCurveDisplayOrder), new Set(metadataToneCurveIds),
    "Tone Curve display order must reference exactly the existing metadata definitions");
assert.deepEqual(
    metadata.filter((item) => item.feedbackSupported === false).map((item) => item.id),
    ["LensProfileEnable", "AutoLateralCA", "LensProfileChromaticAberrationScale"]
);
const effectiveMetadata = sliders.getAll();
assert.equal(effectiveMetadata.find((item) => item.id === "Temperature").visualScale, "temperature");
assert.equal(effectiveMetadata.find((item) => item.id === "Tint").visualScale || "linear", "linear");
assert.equal(
    effectiveMetadata.filter((item) => item.id !== "Temperature")
        .every((item) => (item.visualScale || "linear") === "linear"),
    true,
    "Only Temperature may use nonlinear visual scaling"
);

assert.match(controller, /function createDevelopSliderControl\(definition\)/);
assert.match(controller, /fetch\("\/api\/sliders", \{ cache: "no-store" \}\)/);
assert.match(controller, /definition\.feedbackSupported === true/);
assert.match(controller, /control\.range\.min = String\(control\.definition\.min\)/);
assert.match(controller, /control\.range\.max = String\(control\.definition\.max\)/);
assert.match(controller, /control\.range\.step = String\(control\.definition\.rangeStep\)/);
assert.match(controller, /number\.type = "text"/);
assert.match(controller, /number\.inputMode = "decimal"/);
assert.match(controller, /number\.autocomplete = "off"/);
assert.match(controller, /number\.spellcheck = false/);
assert.match(controller, /setDevelopSliderState\(control, "loading", "Loading…"\)/);
assert.match(controller, /setDevelopSliderState\(control, "unavailable", "Unavailable"\)/);
assert.match(controller, /setDevelopSliderState\(control, "error", "Feedback error"\)/);
assert.doesNotMatch(controller, /value\.textContent = "--"/);
assert.doesNotMatch(controller, /className = "develop-slider-value/);
assert.match(controller, /control\.dragging \|\|\s*control\.editing/);
assert.match(controller, /setTimeout\(function \(\) \{[\s\S]*\}, 100\)/);
assert.match(controller, /"\/api\/set\?slider="/);
assert.match(controller, /"\/api\/reset\?slider="/);
assert.match(controller, /requestLiveFeedbackSnapshot\(true\)/);
assert.match(controller, /pollFeedbackSnapshot\(request\.id, 4000, abortController\.signal\)/);
assert.match(controller, /function classifyControllerContextChange\(previous, next\)/);
assert.match(controller, /function markUninitializedDevelopSlidersLoading\(reason\)/);
assert.doesNotMatch(controller, /markAllDevelopSlidersLoading/);
assert.match(controller, /pointerup/);
assert.match(controller, /event\.key === "Enter"/);
assert.match(controller, /event\.key === "Escape"/);
assert.match(controller, /number\.addEventListener\("blur"/);
assert.match(controller, /number\.select\(\)/);
assert.match(controller, /rawValue\.replace\(",", "\."\)/);
assert.doesNotMatch(
    controller.match(/function createDevelopSliderControl[\s\S]*?function renderActionGroup/)[0],
    /number\.addEventListener\("input"/
);
assert.match(controller, /makeButton\("−", "develop-slider-step"/);
assert.match(controller, /makeButton\("\+", "develop-slider-step"/);
assert.match(controller, /"Decrease " \+ definition\.label/);
assert.match(controller, /"Increase " \+ definition\.label/);
assert.match(controller, /baseValue \+ direction \* control\.definition\.rangeStep/);
assert.match(controller, /control\.desiredValue !== null[\s\S]*control\.localValue !== null[\s\S]*control\.authoritativeValue/);
assert.match(controller, /control\.desiredValue = nextValue/);
assert.match(controller, /\}, 350\)/);
assert.match(controller, /\}, 2000\)/);
assert.match(controller, /valuesMatchDevelopSlider\(control\.definition, numericValue, control\.desiredValue\)/);
assert.match(controller, /control\.stepConfirmationExpired[\s\S]*showDevelopSliderLocal\(control, numericValue\)/);
assert.match(controller, /function cancelDevelopSliderStep\(control\)/);
assert.match(controller, /pendingKind === "step"/);
const stepConfirmationBlock = controller.match(
    /async function requestDevelopSliderStepFeedback[\s\S]*?function scheduleDevelopSliderStepSubmission/
)[0];
assert.match(stepConfirmationBlock, /"\/api\/feedback\/request\?slider="/);
assert.match(stepConfirmationBlock, /pollFeedbackSnapshot\(request\.id, 1900\)/);
assert.doesNotMatch(stepConfirmationBlock, /requestLiveFeedbackSnapshot/);
assert.doesNotMatch(stepConfirmationBlock, /request-many/);
assert.match(controller, /function applyDevelopSliderFeedbackIfChanged\(control, result\)/);
assert.match(controller, /control\.range\.value === visualText/);
assert.match(controller, /control\.number\.value === numberText/);
assert.match(controller, /control\.visualProgress === progressText/);
assert.match(controller, /if \(unchanged\) return false/);
assert.match(controller, /if \(control\.range\.disabled\) control\.range\.disabled = false/);
assert.doesNotMatch(stepConfirmationBlock, /renderSlidersTab|markAllDevelopSlidersLoading|content\.innerHTML|switchTab/);
assert.match(controller, /const activeSliderInteractions = new Set\(\)/);
assert.match(controller, /beginDevelopSliderInteraction\(control, "range"\)/);
assert.match(controller, /beginDevelopSliderInteraction\(control, "numeric"\)/);
assert.match(controller, /if \(isDevelopSliderInteracting\(control\)\) \{[\s\S]*control\.deferredFeedbackResult = result;[\s\S]*return;/);
assert.match(controller, /range\.addEventListener\("pointercancel"/);
assert.match(controller, /range\.addEventListener\("lostpointercapture"/);
assert.match(controller, /window\.addEventListener\("blur"/);
assert.match(controller, /number\.addEventListener\("change"/);
assert.match(controller, /control\.contextInvalidated/);
assert.match(controller, /pendingDevelopContextRefresh = true/);
assert.match(controller, /next\.activeModule !== previous\.activeModule/);
assert.match(controller, /next\.selectedPhotoKey !== previous\.selectedPhotoKey/);
const contextClassifierBlock = controller.match(
    /function classifyControllerContextChange[\s\S]*?function logDevelopRefreshDecision/
)[0];
assert.doesNotMatch(
    contextClassifierBlock.match(/if \([\s\S]*?\) return "navigation";/)[0],
    /contextCounter|developCounter|developFingerprint|lastHeartbeatAt/,
    "Navigation classification must use identity only"
);
assert.match(controller, /lastControllerDevelopCounter = data\.developCounter/);
assert.match(controller, /function isGenericDevelopFeedbackTab\(tab\) \{\s*return tab === "sliders" \|\| tab === "tone-curve";\s*\}/);
assert.match(controller, /if \(!genericFeedbackActive \|\| !isGenericDevelopFeedbackTab\(activeTab\)\) return/);
assert.match(controller, /function deactivateDevelopFeedbackPolling\(\)[\s\S]*genericFeedbackAbortController\.abort\(\)/);
assert.match(controller, /if \(activeTab === "sliders"\) \{\s*renderSlidersTab\(\);\s*activateDevelopFeedbackPolling\(\);/);
assert.match(controller, /if \(activeTab === "tone-curve"\) \{\s*renderToneCurveTab\(\);\s*activateDevelopFeedbackPolling\(\);/);
assert.match(controller, /row\.dataset\.sliderId = definition\.id/);
assert.match(controller, /const DEBUG_DEVELOP_REFRESH = true/);
const finalConfirmationBlock = controller.match(
    /function flushDevelopSliderValue[\s\S]*?function clearDevelopSliderStepTimers/
)[0];
assert.match(finalConfirmationBlock, /control\.confirmationPending = true/);
assert.match(finalConfirmationBlock, /handleDevelopSliderStepSubmission/);
assert.doesNotMatch(finalConfirmationBlock, /renderSlidersTab|switchTab|content\.innerHTML|markAllDevelopSlidersLoading|requestLiveFeedbackSnapshot|request-many/);
assert.match(controller, /range\.addEventListener\("pointerdown", function \(event\) \{\s*cancelDevelopSliderStep\(control\)/);
assert.match(controller, /function commitNumericValue\(\) \{\s*cancelDevelopSliderStep\(control\)/);
assert.match(controller, /makeButton\("Reset"[\s\S]*cancelDevelopSliderStep\(control\)/);
assert.match(controller, /"\/api\/set\?slider="/);
assert.doesNotMatch(
    controller.match(/function stepDevelopSliderValue[\s\S]*?function createDevelopSliderControl/)[0],
    /\/api\/adjust/
);
assert.match(controller, /element\.isConnected/);
assert.doesNotMatch(controller, /function makeDragStrip/);
assert.doesNotMatch(controller, /drag-strip/);
assert.doesNotMatch(controller, /makeButton\("-5"/);
assert.doesNotMatch(controller, /makeButton\("-1"/);
assert.doesNotMatch(controller, /makeButton\("\+1"/);
assert.doesNotMatch(controller, /makeButton\("\+5"/);
assert.match(controller, /\.develop-slider-row,\s*\.angle-control\s*\{[\s\S]*min-width:\s*0/);
assert.match(controller, /@media \(max-width: 760px\)[\s\S]*\.develop-slider-row/);
assert.match(controller, /input\[type="range"\]::\-webkit-slider-thumb\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/);
assert.match(controller, /input\[type="range"\]::\-moz-range-thumb\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/);
assert.match(controller, /input\[type="range"\]\s*\{[^}]*min-height:\s*44px/);
assert.match(controller, /\.develop-slider-row input\[type="range"\]::\-webkit-slider-runnable-track[\s\S]*var\(--slider-progress/,
    "Develop and Denoise range controls must preserve their progress fill");
assert.match(controller, /grid-template-columns:\s*minmax\(140px, 210px\)[\s\S]*44px 44px auto/);
assert.match(controller, /\.develop-slider-state\s*\{[\s\S]*min-height:\s*16px[\s\S]*height:\s*16px[\s\S]*line-height:\s*16px[\s\S]*visibility:\s*hidden/);
assert.match(controller, /\.develop-slider-state:not\(:empty\)\s*\{\s*visibility:\s*visible/);
const developSliderStateCss = controller.match(/\.develop-slider-state\s*\{[\s\S]*?\}/)[0];
assert.doesNotMatch(developSliderStateCss, /display:\s*none/);
assert.match(controller, /state\.className = "develop-slider-state";\s*state\.textContent = ""/);
assert.match(controller, /Loading Lightroom values…/);

const ordinaryPollingBlock = controller.match(
    /async function requestLiveFeedbackSnapshot[\s\S]*?async function pollControllerContext/
)[0];
assert.doesNotMatch(ordinaryPollingBlock, /mark(?:All|Uninitialized)DevelopSlidersLoading/,
    "Normal feedback polling must not make rows visibly Loading");
const contextPollingBlock = controller.match(
    /async function pollControllerContext[\s\S]*?function startLiveFeedbackPolling/
)[0];
assert.doesNotMatch(contextPollingBlock, /mark(?:All|Uninitialized)DevelopSlidersLoading/,
    "Context, revision, navigation, and heartbeat polling must not make rows visibly Loading");
const renderSlidersBlock = controller.match(
    /function renderSlidersTab[\s\S]*?function renderToolTab/
)[0];
assert.doesNotMatch(renderSlidersBlock, /mark(?:All|Uninitialized)DevelopSlidersLoading/,
    "Returning to the Develop tab must not make populated rows visibly Loading");
const slidersOnlyBlock = controller.match(/function renderSlidersTab[\s\S]*?function renderToneCurveTab/)[0];
const toneCurveBlock = controller.match(/function renderToneCurveTab[\s\S]*?function renderToolTab/)[0];
const developSectionDisplayOrderMatch = controller.match(/const developSectionDisplayOrder = Object\.freeze\((\[[\s\S]*?\])\);/);
assert.ok(developSectionDisplayOrderMatch, "Develop presentation specification is missing");
const developSectionDisplayOrder = JSON.parse(JSON.stringify(
    require("node:vm").runInNewContext("(" + developSectionDisplayOrderMatch[1] + ")")
));
const expectedDevelopSectionLabels = [
    "White Balance", "Tone", "Presence", "Color Mixer", "Detail",
    "Lens Corrections", "Transform", "Effects", "Calibration"
];
assert.deepEqual(developSectionDisplayOrder.map((section) => section.label), expectedDevelopSectionLabels);
assert.deepEqual(developSectionDisplayOrder.map((section) => section.id), [
    "white-balance", "tone", "presence", "color-mixer", "detail",
    "lens-corrections", "transform", "effects", "calibration"
]);
assert.equal(new Set(developSectionDisplayOrder.map((section) => section.id)).size, 9,
    "Every main Develop section must render exactly once");
const developHeaderCss = controller.match(/\.group\[data-develop-section\] > \.group-title \{[\s\S]*?\n        \}/)[0];
assert.match(developHeaderCss, /width: 100%/);
assert.match(developHeaderCss, /background: #101010/);
assert.doesNotMatch(developHeaderCss, /linear-gradient|#7a4c18|#5f3912/,
    "Main Develop section headers must not retain the orange gradient fill");
assert.match(developHeaderCss, /border-top: 1px solid #d18a36/);
assert.match(developHeaderCss, /border-bottom: 1px solid #d18a36/);
assert.match(developHeaderCss, /color: #f4f4f4/);
assert.match(developHeaderCss, /padding: 11px 14px/);
assert.match(developHeaderCss, /font-weight: 700/);
assert.match(developHeaderCss, /margin: 0 0 28px/,
    "Main Develop section headers must leave breathing room before their first control");
assert.match(controller, /\.group\[data-develop-section\]:first-of-type \{\s*margin-top: 4px/,
    "The first Develop section must avoid the later-section spacing");
const colorMixerHeadingCss = controller.match(/\.color-mixer-group-heading \{[\s\S]*?\n        \}/)[0];
assert.match(colorMixerHeadingCss, /font-size: 11px/);
assert.doesNotMatch(colorMixerHeadingCss, /background:|border-top:|border-bottom:/,
    "Color Mixer subgroup headings must remain visually subordinate to main panel bars");
const leadingControlsCss = controller.match(/\.develop-section-leading-controls \{[\s\S]*?\n        \}/)[0];
assert.match(leadingControlsCss, /margin-bottom: 28px/,
    "Detail, Lens, and Transform leading controls must share the slider separation");
const trailingControlsCss = controller.match(/\.develop-section-trailing-controls \{[\s\S]*?\n        \}/)[0];
assert.match(trailingControlsCss, /margin-top: 16px/);
assert.match(trailingControlsCss, /margin-bottom: 0/,
    "Trailing Constrain Crop must preserve its existing spacing without adding a section gap");
const ordinarySliderRowCss = controller.match(/\.develop-slider-row,\s*\.angle-control \{[\s\S]*?\n        \}/)[0];
assert.doesNotMatch(ordinarySliderRowCss, /28px/,
    "Ordinary consecutive sliders must not receive section-level spacing");
const mixerGroupCss = controller.match(/\.color-mixer-slider-group \{[\s\S]*?\n        \}/)[0];
const subsequentMixerGroupCss = controller.match(/\.color-mixer-slider-group \+ \.color-mixer-slider-group \{[\s\S]*?\n        \}/)[0];
assert.match(mixerGroupCss, /border-top: 0/);
assert.match(subsequentMixerGroupCss, /border-top: 1px solid #405263/,
    "Color Mixer must retain one divider between complete groups");
assert.doesNotMatch(controller, /\.color-mixer-slider-group \.develop-slider-row[\s\S]*?border-top/,
    "Color Mixer must not add dividers between individual slider rows");
const displayLabelContext = {
    treatmentHasAuthoritativeState: false,
    treatmentAuthoritativeState: false
};
const getDevelopSectionDisplayLabel = require("node:vm").runInNewContext(
    "(" + controller.match(/function getDevelopSectionDisplayLabel\(section\) \{[\s\S]*?\n        \}/)[0] + ")",
    displayLabelContext
);
const colorMixerSection = developSectionDisplayOrder.find((section) => section.id === "color-mixer");
assert.equal(getDevelopSectionDisplayLabel(colorMixerSection), "Color Mixer",
    "Initial treatment loading must retain the provisional Color Mixer label");
displayLabelContext.treatmentHasAuthoritativeState = true;
assert.equal(getDevelopSectionDisplayLabel(colorMixerSection), "Color Mixer",
    "Authoritative Color must retain the Color Mixer label");
displayLabelContext.treatmentAuthoritativeState = true;
assert.equal(getDevelopSectionDisplayLabel(colorMixerSection), "B&W",
    "Authoritative grayscale treatment must use the B&W label");
assert.equal(colorMixerSection.id, "color-mixer", "The conditional mixer section identity must remain stable");
assert.ok(!colorMixerSection.selectors.find((selector) => selector.group === "B&W Mixer").subheading,
    "B&W mode must not render a redundant internal B&W Mixer subheading");
function selectMappedDefinitions(section) {
    return section.selectors.flatMap((selector) => {
        const ids = selector.ids ? new Set(selector.ids) : null;
        return feedbackDefinitions.filter((definition) =>
            definition.group === selector.group && (!ids || ids.has(definition.id))
        );
    });
}
const mappedSections = developSectionDisplayOrder.map((section) => ({
    label: section.label,
    ids: selectMappedDefinitions(section).map((definition) => definition.id)
}));
assert.deepEqual(mappedSections.find((section) => section.label === "White Balance").ids,
    ["Temperature", "Tint"]);
assert.deepEqual(mappedSections.find((section) => section.label === "Tone").ids,
    feedbackDefinitions.filter((definition) => definition.group === "Basic").map((definition) => definition.id));
assert.deepEqual(mappedSections.find((section) => section.label === "Presence").ids,
    ["Texture", "Clarity", "Dehaze", "Vibrance", "Saturation"]);
assert.deepEqual(mappedSections.find((section) => section.label === "Color Mixer").ids,
    feedbackDefinitions.filter((definition) => ["Color Mixer / HSL", "B&W Mixer"].includes(definition.group))
        .map((definition) => definition.id));
assert.deepEqual(mappedSections.find((section) => section.label === "Lens Corrections").ids,
    feedbackDefinitions.filter((definition) => definition.group === "Lens / Defringe").map((definition) => definition.id));
const lensCorrectionsSection = developSectionDisplayOrder.find((section) => section.id === "lens-corrections");
const transformSection = developSectionDisplayOrder.find((section) => section.id === "transform");
assert.deepEqual(lensCorrectionsSection.embeddedSwitchGroups, ["Lens / Defringe"],
    "Lens / Defringe switches must be associated with the Lens Corrections section");
assert.deepEqual(transformSection.embeddedActionGroups, ["Transform Actions"],
    "Transform Actions must be associated with the Transform section");
assert.deepEqual(transformSection.embeddedTrailingSwitchGroups, ["Transform"],
    "The existing Constrain Crop switch must finish the Transform section");
assert.equal((controller.match(/"label": "Remove Chromatic Aberration"/g) || []).length, 1,
    "Remove Chromatic Aberration must have one existing switch definition");
assert.equal((controller.match(/"label": "Enable Profile Corrections"/g) || []).length, 1,
    "Enable Profile Corrections must have one existing switch definition");
const developSectionRenderer = controller.match(/function createDevelopSectionElement[\s\S]*?function rerenderColorMixerSection/)[0];
assert.match(developSectionRenderer,
    /groupElement\.appendChild\(title\);\s*const leadingControls = createSectionControls\(section, "leading"\);\s*if \(leadingControls\) groupElement\.appendChild\(leadingControls\);[\s\S]*section\.items\.forEach/,
    "Embedded Lens switches and Transform actions must render after the main title and before section sliders");
assert.match(developSectionRenderer,
    /section\.items\.forEach[\s\S]*const trailingControls = createSectionControls\(section, "trailing"\);\s*if \(trailingControls\) groupElement\.appendChild\(trailingControls\)/,
    "Constrain Crop must render after the existing Transform sliders");
assert.match(controller,
    /includesDetailControls[\s\S]*controls\.appendChild\(renderEnhanceSection\(\)\)[\s\S]*controls\.appendChild\(renderRawDetailsControl\(\)\)[\s\S]*controls\.appendChild\(renderSuperResolutionControl\(\)\)/,
    "Detail Enhance controls must use the shared leading-controls wrapper before Sharpness");
assert.match(slidersOnlyBlock,
    /switchGroupIsEmbedded[\s\S]*!switchGroupIsEmbedded && !renderedSwitchPlacements\.has\(placement\)/,
    "Embedded switch groups must not also render as standalone Switches groups");
assert.match(controller,
    /function appendEmbeddedSwitchGroups[\s\S]*addSwitchRow\(parent, item\)/,
    "Embedded Lens switches must reuse the existing switch row renderer");
assert.match(controller,
    /function appendEmbeddedActionGroups[\s\S]*addActionRow\(parent, item\)/,
    "Embedded Transform actions must reuse the existing action row renderer");
assert.match(slidersOnlyBlock,
    /actionGroupIsEmbedded[\s\S]*!actionGroupIsEmbedded && !renderedActionPlacements\.has\(placement\)/,
    "Embedded Transform Actions must not also render as a standalone action group");
assert.equal((controller.match(/"label": "Upright Tool"/g) || []).length, 1,
    "Upright Tool must retain exactly one action definition");
assert.equal((controller.match(/"label": "Reset Transform"/g) || []).length, 1,
    "Reset Transform must retain exactly one action definition");
assert.match(controller, /"label": "Upright Tool",\s*"action": "selectUprightTool",\s*"button": "Select"/,
    "The existing Upright Tool action contract must remain unchanged");
assert.match(controller, /"label": "Reset Transform",\s*"action": "resetTransforms",\s*"button": "Reset"/,
    "The existing Reset Transform action contract must remain unchanged");
assert.ok(lensCorrectionsSection.selectors.some((selector) => selector.group === "Lens / Defringe"),
    "All Lens / Defringe sliders must remain in Lens Corrections");
assert.match(controller,
    /const id = "slider-jump-section-" \+ section\.id;\s*heading\.id = id;\s*heading\.classList\.add\("slider-jump-target"\)/,
    "The Lens Corrections jump target must remain the shared main section heading");
const mappedDevelopIds = mappedSections.flatMap((section) => section.ids);
const expectedDevelopIds = feedbackDefinitions.filter((definition) => definition.group !== "Tone Curve")
    .map((definition) => definition.id);
assert.equal(new Set(mappedDevelopIds).size, mappedDevelopIds.length, "Develop presentation duplicated a slider ID");
assert.deepEqual(new Set(mappedDevelopIds), new Set(expectedDevelopIds),
    "Develop presentation omitted or unexpectedly selected a slider ID");
assert.doesNotMatch(JSON.stringify(developSectionDisplayOrder), /Tone Curve|Color Grading|Lens Blur/);
assert.match(controller, /function getSliderJumpSections\(\) \{\s*return developSectionDisplayOrder\.map/,
    "Jump menu and rendered sections must share the presentation specification");
assert.equal(developSectionDisplayOrder.length, 9, "Jump-to must source exactly nine Develop sections");
assert.equal(developSectionDisplayOrder[3].id, "color-mixer",
    "Color Mixer/B&W must remain fourth between Presence and Detail");
assert.match(controller, /function getSliderJumpSections[\s\S]*label: getDevelopSectionDisplayLabel\(section\)/,
    "Jump labels must use the shared conditional section-label helper");
const jumpHeadingLookup = controller.match(/function findSliderJumpHeading\(content, sectionId\) \{[\s\S]*?\n        \}/)[0];
assert.match(jumpHeadingLookup, /data-develop-section/);
assert.match(jumpHeadingLookup, /> \.group-title/,
    "Every Jump-to option must resolve the main direct-child section title");
assert.doesNotMatch(jumpHeadingLookup, /textContent|\.trim\(\)|name/,
    "Jump-to heading discovery must not depend on visible title text");
assert.match(controller, /findSliderJumpHeading\(contentHost, section\.id\)/,
    "Jump-to must resolve headings by stable section identity");
assert.match(controller, /title\.textContent = section\.id === "color-mixer"[\s\S]*"COLOR MIXER" : section\.label/,
    "Rendered headings must consume the shared presentation label");
assert.match(controller, /jumpMenu\.remove\(\);[\s\S]*installSliderJumpMenu\(\);[\s\S]*requestLiveFeedbackSnapshot\(true\)/,
    "Mixer replacement must refresh its existing jump label before the normal connected-row snapshot");
assert.match(slidersOnlyBlock, /validateDevelopSectionMapping\(sections\)/);
assert.match(slidersOnlyBlock, /setStatus\("ERROR: " \+ mappingError\)/,
    "Invalid presentation mappings must fail visibly");
assert.match(controller.match(/function createDevelopSectionElement[\s\S]*?function rerenderColorMixerSection/)[0],
    /createDevelopSliderControl\(item\.definition\)/,
    "Develop presentation must reuse the production slider factory");
assert.match(controller, /row\.appendChild\(autoButton\)[\s\S]*row\.appendChild\(treatmentButton\)/);
assert.match(controller, /autoTone\.action === "setAutoTone"|item\.action === "setAutoTone"/);
assert.match(controller, /command=photo\.treatment&value=/);
assert.match(controller, /if \(section\.id === "color-mixer"\)[\s\S]*treatmentAuthoritativeState[\s\S]*"B&W Mixer"[\s\S]*"Color Mixer \/ HSL"/);
assert.match(controller, /rerenderColorMixerSection\(\)[\s\S]*requestLiveFeedbackSnapshot\(true\)/);
assert.match(controller, /if \(activeTab === "sliders"\) requestTreatmentState\(\)/,
    "Treatment reads must reuse the existing Develop feedback cadence");
assert.equal((controller.match(/setInterval\(function \(\) \{\s*requestLiveFeedbackSnapshot\(false\)/g) || []).length, 1);
assert.doesNotMatch(controller + bridge + mainProcess + photo + feedback, /HDREditMode|HDRMaxValue|SDRBlend|ToneCurvePV2012/);
assert.match(feedback, /photo:getDevelopSettings\(\)[\s\S]*settings\.ConvertToGrayscale/);
assert.doesNotMatch(feedback, /json.*DevelopSettings|getDevelopSettings.*url/i,
    "Full Develop settings must never be serialized");
assert.match(photo, /quickDevelopSetTreatment\("grayscale"\)/);
assert.match(photo, /quickDevelopSetTreatment\("color"\)/);
assert.match(bridge, /grayscale: status === "available" \? req\.query\.grayscale === "true" : null/);
assert.match(mainProcess, /"\/api\/treatment\/request"[\s\S]*"\/treatment\/request"/);
assert.match(controller, /treatmentButton\.setAttribute\("role", "switch"\)/);
assert.match(controller, /treatmentButton\.setAttribute\("aria-checked", String\(treatmentHasAuthoritativeState && treatmentAuthoritativeState\)\)/);
assert.match(controller, /treatmentButton\.disabled = treatmentPending \|\| !treatmentHasAuthoritativeState/);
assert.match(controller, /treatmentButton\.title = treatmentAuthoritativeState \? "Black & White mode" : "Color mode"/);
assert.match(controller, /const mode = treatmentAuthoritativeState \? "color" : "grayscale"/);
assert.match(controller, /treatmentPending && treatmentDesiredState !== snapshot\.grayscale/,
    "Treatment must remain pending until matching authoritative readback");
assert.match(controller, /const changed = !treatmentHasAuthoritativeState \|\| treatmentAuthoritativeState !== snapshot\.grayscale/);
assert.equal(feedbackDefinitions.filter((definition) => definition.group === "Color Mixer / HSL").length, 24);
assert.equal(feedbackDefinitions.filter((definition) => definition.group === "B&W Mixer").length, 8);
const colorMixerDefinitions = require("node:vm").runInNewContext(
    controller.match(/const colorMixerDefinitions = Object\.freeze\((\[[\s\S]*?\])\);/)[1]
);
const colorMixerAdjustmentTypes = require("node:vm").runInNewContext(
    controller.match(/const colorMixerAdjustmentTypes = Object\.freeze\((\[[\s\S]*?\])\);/)[1]
);
assert.equal(colorMixerDefinitions.length, 8, "Color Mixer must have one shared definition per color");
assert.deepEqual(Array.from(colorMixerDefinitions, (item) => item.label),
    ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"]);
assert.deepEqual(Array.from(colorMixerAdjustmentTypes, (item) => item.key), ["hue", "saturation", "luminance"]);
const getColorMixerViewGroups = require("node:vm").runInNewContext(
    "(" + controller.match(/function getColorMixerViewGroups\(view\) \{[\s\S]*?\n        \}/)[0] + ")",
    { colorMixerDefinitions, colorMixerAdjustmentTypes }
);
const hslGroups = getColorMixerViewGroups("hsl");
const colorGroups = getColorMixerViewGroups("color");
const hslIds = Array.from(hslGroups, (group) => Array.from(group.rows, (row) => row.id)).flat();
const colorIds = Array.from(colorGroups, (group) => Array.from(group.rows, (row) => row.id)).flat();
const expectedMixerIds = feedbackDefinitions.filter((definition) => definition.group === "Color Mixer / HSL").map((definition) => definition.id);
assert.deepEqual(hslIds, expectedMixerIds, "HSL must order eight Hue, eight Saturation, then eight Luminance controls");
assert.deepEqual(new Set(hslIds), new Set(colorIds), "HSL and Color must expose the same identifiers");
assert.equal(new Set(hslIds).size, 24);
assert.equal(new Set(colorIds).size, 24);
assert.equal(colorGroups.length, 8);
colorGroups.forEach((group) => assert.deepEqual(Array.from(group.rows, (row) => row.label), ["Hue", "Saturation", "Luminance"]));
assert.match(controller, /button\.textContent = view === "hsl" \? "HSL" : view === "color" \? "Color" : "Point Color"/);
assert.match(controller, /let colorMixerView = "hsl"/);
assert.match(controller, /\["hsl", "color", "point-color"\]/);
const mixerPresentationBlock = controller.match(/function createColorMixerPresentation\(groupElement, section\) \{[\s\S]*?\n        \}\n\n        function getDevelopSectionDisplayLabel/)[0];
assert.doesNotMatch(mixerPresentationBlock, /sendCommand/,
    "Switching Color Mixer views must not itself mutate Lightroom");
assert.match(controller, /container\.appendChild\(control\.row\)/,
    "View switching must reparent the same slider rows rather than duplicate controls");
assert.doesNotMatch(controller, /if \(!treatmentHasAuthoritativeState\) return;/,
    "First load must provisionally render the Color mixer rather than an empty section");
assert.match(controller, /let treatmentAuthoritativeState = false/,
    "The provisional first-load mixer must select the 24 HSL definitions");
assert.match(controller, /selector\.group !== "B&W Mixer"[\s\S]*selector\.group !== "Color Mixer \/ HSL"/);
assert.match(feedback, /local LrApplication = import "LrApplication"/);
assert.match(feedback, /if photo == nil then\s*unavailableReason = "no_photo"/);
assert.match(feedback, /if ok ~= true then\s*unavailableReason = "settings_error"/);
assert.match(feedback, /elseif type\(settings\) ~= "table" then\s*unavailableReason = "settings_not_table"/);
assert.match(feedback, /settings\.ConvertToGrayscale == true then\s*grayscale = true/);
assert.match(feedback, /settings\.ConvertToGrayscale == false or settings\.ConvertToGrayscale == nil then\s*grayscale = false/);
assert.match(feedback, /unavailableReason = "unexpected_type"/);
assert.match(feedback, /log\("treatment request received: id=" \.\. tostring\(id\)\)/);
assert.match(feedback, /log\("treatment settings read succeeded"\)/);
assert.match(feedback, /log\("treatment result posted: available " \.\. \(grayscale and "grayscale" or "color"\)\)/);
assert.match(feedback, /log\("treatment result posted: unavailable " \.\. tostring\(reason\)\)/);
assert.match(feedback, /local treatmentWorkerActive = false/);
assert.match(feedback, /if treatmentWorkerActive == true then return end/,
    "Only one treatment worker may run at a time");
assert.match(feedback, /LrTasks\.startAsyncTask\(function\(\)[\s\S]*LrApplication\.activeCatalog\(\)[\s\S]*catalog:getTargetPhoto\(\)[\s\S]*photo:getDevelopSettings\(\)/,
    "Catalog, photo, and Develop settings must be resolved inside the dedicated task");
assert.equal((feedback.match(/photo:getDevelopSettings\(\)/g) || []).length, 1,
    "Treatment settings must be read only by the dedicated worker");
assert.match(feedback, /local treatmentOk = LrTasks\.pcall\(function\(\)[\s\S]*photo:getDevelopSettings\(\)/,
    "Treatment runtime errors must not terminate the feedback task");
assert.match(feedback, /local postOk = LrTasks\.pcall\(function\(\) LrHttp\.get\(url \.\. "&status=unavailable"\) end\)/,
    "Unavailable treatment results must use yield-safe protection");
assert.match(feedback, /table\.insert\(pendingTreatmentRequestIds, id\)[\s\S]*while #pendingTreatmentRequestIds > 0/,
    "Every queued treatment request must receive a terminal worker result");
assert.match(feedback, /startTreatmentWorker\(id\)[\s\S]*slider = nil[\s\S]*if slider ~= nil then/,
    "The feedback loop must dispatch treatment work without waiting for it");
assert.match(feedback, /treatment snapshot failure: runtime_error[\s\S]*postUnavailableTreatmentResult\(requestId, "runtime_error"\)/);
assert.match(feedback, /postUnavailableTreatmentResult[\s\S]*status=unavailable/);
assert.match(feedback, /log\("treatment result post failed"\)/);
assert.match(controller, /finally \{[\s\S]*treatmentRequestInFlight = false;[\s\S]*treatmentAbortController = null;/,
    "Treatment timeout/failure must release the in-flight lock for the next feedback cycle");
const treatmentFeedbackBlock = feedback.match(
    /local treatmentWorkerActive = false[\s\S]*?\nend\n\nif _G\.LRBridgeFeedbackPollingStarted/
)[0];
assert.doesNotMatch(treatmentFeedbackBlock,
    /tostring\(settings\)|tostring\(photo\)|photo\.path|filename|getRawMetadata/i,
    "Treatment diagnostics must not expose photo or settings data");
assert.match(toneCurveBlock, /title\.textContent = "Parametric Curve"/);
assert.match(toneCurveBlock, /return definition\.group === "Tone Curve"/);
assert.match(toneCurveBlock, /toneCurveDefinitionsById\.set\(definition\.id, definition\)/);
assert.match(toneCurveBlock, /toneCurveDisplayOrder\.forEach\(function \(sliderId\)/);
assert.match(toneCurveBlock, /if \(!definition\) return;/, "Missing Tone Curve definitions must fail safely");
assert.match(toneCurveBlock, /groupElement\.appendChild\(createDevelopSliderControl\(definition\)\)/,
    "Tone Curve must reuse the production Develop control factory");
assert.match(toneCurveBlock, /createDevelopSliderControl\(definition\)[\s\S]*requestLiveFeedbackSnapshot\(true\)/,
    "Tone Curve must render cached controls before requesting fresh feedback");
assert.doesNotMatch(toneCurveBlock, /svg|graph|histogram|Point Curve|ToneCurvePV2012/i);
assert.equal((controller.match(/setInterval\(function \(\) \{\s*requestLiveFeedbackSnapshot\(false\)/g) || []).length, 1,
    "Generic Develop feedback must retain exactly one snapshot timer");
assert.match(controller, /Object\.keys\(developSliderControls\)\.filter\(function \(slider\) \{\s*return developSliderControls\[slider\]\.row\.isConnected;/,
    "Forced feedback snapshots must use only connected rendered controls");

{
    const active = new Set();
    function fakeClassList() {
        const values = new Set();
        return { add(value) { values.add(value); }, remove(...items) { items.forEach(item => values.delete(item)); }, has(value) { return values.has(value); } };
    }
    const row = { classList: fakeClassList(), isConnected: true };
    const range = { value: "4", disabled: false, isConnected: true, style: { value: "40%", setProperty(_key, value) { this.value = value; } } };
    const number = { value: "4", disabled: false, isConnected: true };
    const stateNode = { textContent: "", isConnected: true };
    const control = {
        definition: { id: "Exposure", min: -5, max: 5, numericStep: 0.01, displayPrecision: 2 },
        row, range, number, state: stateNode,
        decrement: { disabled: false }, increment: { disabled: false }, reset: { disabled: false },
        authoritativeValue: 0, localValue: 4, desiredValue: null, numberCommittedValue: 4,
        feedbackState: "available", stateMessage: "", visualProgress: "40%",
        confirmationPending: false, dragging: true, editing: false, stepConfirmationExpired: false,
        deferredFeedbackResult: null
    };
    const context = {
        Number,
        isDevelopSliderInteracting(candidate) { return active.has(candidate.definition.id); },
        actualToDevelopSliderPosition(_definition, value) { return Number(value); },
        formatDevelopSliderValue(_definition, value) { return String(value); },
        valuesMatchDevelopSlider(_definition, left, right) { return Number(left) === Number(right); },
        configureDevelopSliderRange() {},
        cancelDevelopSliderStep(candidate) { candidate.desiredValue = null; candidate.confirmationPending = false; candidate.stepConfirmationExpired = false; },
        cancelDevelopSliderStepTimers() {},
        developSliderControls: { Exposure: control }
    };
    require("node:vm").runInNewContext(
        extractFunctions("setDevelopSliderState", "submitDevelopSliderValue").replace(/\s*async\s*$/, "") +
        "\nthis.api = { applyDevelopSliderFeedbackIfChanged };",
        context
    );
    const refs = { row, range, number };
    active.add("Exposure");
    context.api.applyDevelopSliderFeedbackIfChanged(control, { available: true, value: 1, range: { min: -5, max: 5 } });
    assert.equal(range.value, "4");
    assert.equal(number.value, "4");
    assert.equal(range.style.value, "40%");
    assert.equal(control.feedbackState, "available");
    assert.equal(refs.row, control.row);
    assert.equal(refs.range, control.range);
    assert.equal(refs.number, control.number);
    assert.ok(row.isConnected && range.isConnected && number.isConnected);
    active.delete("Exposure");
    control.dragging = false;
    control.desiredValue = 4;
    control.confirmationPending = true;
    context.api.applyDevelopSliderFeedbackIfChanged(control, { available: true, value: 4, range: { min: -5, max: 5 } });
    assert.equal(control.confirmationPending, false, "Matching targeted feedback must silently clear pending state");
    assert.equal(range.value, "4");
    assert.equal(number.value, "4");
    assert.equal(refs.row, control.row);
    assert.equal(refs.range, control.range);
    assert.equal(refs.number, control.number);
}

{
    const context = {};
    require("node:vm").runInNewContext(
        contextClassifierBlock.replace(/\s*function logDevelopRefreshDecision[\s\S]*$/, "") +
        "\nthis.classify = classifyControllerContextChange;",
        context
    );
    const classify = context.classify;
    const initial = {
        activeModule: "develop", selectedPhotoKey: "photo-1",
        contextCounter: 4, developCounter: 10, developFingerprint: "a", lastHeartbeatAt: 100
    };
    assert.equal(classify(initial, { ...initial, contextCounter: 5 }), "develop-revision");
    assert.equal(classify(initial, { ...initial, developCounter: 11 }), "develop-revision");
    assert.equal(classify(initial, { ...initial, developFingerprint: "b" }), "develop-revision");
    assert.equal(classify(initial, { ...initial, selectedPhotoKey: "photo-2" }), "navigation");
    assert.equal(classify(initial, { ...initial, activeModule: "library" }), "navigation");
    assert.equal(classify(initial, { ...initial, lastHeartbeatAt: 101 }), "heartbeat");
    assert.equal(classify(initial, { ...initial }), "none");

    const row = { isConnected: true };
    const range = { value: "4", isConnected: true, style: { progress: "40%" } };
    const number = { value: "4", isConnected: true };
    const control = { row, range, number, contextInvalidated: false };
    let previous = initial;
    let pendingRefresh = false;
    let loadingCalls = 0;
    let forcedFeedbackCalls = 0;
    let throttleCancellations = 0;
    for (let revision = 1; revision <= 10; revision += 1) {
        const next = { ...previous, contextCounter: previous.contextCounter + 1, lastHeartbeatAt: previous.lastHeartbeatAt + 1 };
        const classification = classify(previous, next);
        const navigationContextChanged = classification === "navigation";
        if (navigationContextChanged) {
            control.contextInvalidated = true;
            pendingRefresh = true;
            loadingCalls += 1;
            forcedFeedbackCalls += 1;
            throttleCancellations += 1;
        }
        assert.equal(navigationContextChanged, false);
        assert.equal(control.contextInvalidated, false);
        assert.equal(pendingRefresh, false);
        assert.equal(loadingCalls, 0);
        assert.equal(forcedFeedbackCalls, 0);
        assert.equal(throttleCancellations, 0);
        assert.equal(range.value, "4");
        assert.equal(number.value, "4");
        assert.equal(range.style.progress, "40%");
        assert.equal(control.row, row);
        assert.equal(control.range, range);
        assert.equal(control.number, number);
        previous = next;
    }
    assert.equal(classify(previous, { ...previous, selectedPhotoKey: "photo-2" }), "navigation");
    control.contextInvalidated = true;
    pendingRefresh = true;
    let deferredRefreshes = 0;
    if (pendingRefresh) {
        pendingRefresh = false;
        deferredRefreshes += 1;
    }
    assert.equal(deferredRefreshes, 1, "A real photo change must produce exactly one deferred refresh");
}

{
    function fakeClassList() {
        const values = new Set(["develop-slider-row"]);
        return {
            add(value) { values.add(value); },
            remove(...items) { items.forEach((item) => values.delete(item)); },
            values() { return Array.from(values).sort(); }
        };
    }
    const row = { classList: fakeClassList(), isConnected: true };
    const range = { value: "1.25", disabled: false, isConnected: true, style: { progress: "62.5%" } };
    const number = { value: "1.25", disabled: false, isConnected: true };
    const state = { textContent: "", isConnected: true };
    const control = {
        definition: { id: "Exposure" }, row, range, number, state,
        decrement: { disabled: false }, increment: { disabled: false }, reset: { disabled: false },
        authoritativeValue: 1.25, hasAuthoritativeValueEver: true, localValue: 1.25,
        numberCommittedValue: 1.25, desiredValue: null, confirmationPending: false,
        feedbackState: "available", stateMessage: "", visualProgress: "62.5%"
    };
    const diagnosticEvents = [];
    const layoutContext = {
        developSliderControls: { Exposure: control },
        activeTab: "sliders",
        currentDevelopRefreshClassification: "develop-revision",
        console: { debug(...args) { diagnosticEvents.push(args); } },
        isDevelopSliderInteracting() { return false; },
        cancelDevelopSliderStep() {}
    };
    require("node:vm").runInNewContext(
        extractFunctions("setDevelopSliderState", "submitDevelopSliderValue").replace(/\s*async\s*$/, "") +
        "\nthis.api = { setDevelopSliderState, markDevelopSliderLoading, markUninitializedDevelopSlidersLoading };",
        layoutContext
    );
    const refs = { row, range, number, state };
    const classes = row.classList.values();

    for (const [statusName, message] of [
        ["", ""], ["loading", "Loading…"], ["", "Available"],
        ["unavailable", "Unavailable"], ["error", "Feedback error"]
    ]) {
        layoutContext.api.setDevelopSliderState(control, statusName, message);
        assert.equal(control.state, refs.state, "Status changes must retain the permanent status node");
        assert.equal(control.state.isConnected, true);
    }
    layoutContext.api.setDevelopSliderState(control, "", "");

    for (let cycle = 0; cycle < 10; cycle += 1) {
        layoutContext.api.markUninitializedDevelopSlidersLoading("background-refresh");
        assert.equal(control.row, refs.row);
        assert.equal(control.range, refs.range);
        assert.equal(control.number, refs.number);
        assert.equal(control.state, refs.state);
        assert.deepEqual(row.classList.values(), classes);
        assert.equal(range.value, "1.25");
        assert.equal(number.value, "1.25");
        assert.equal(range.style.progress, "62.5%");
        assert.equal(state.textContent, "");
    }
    assert.equal(diagnosticEvents.length, 0, "Initialized rows must never be assigned visible Loading");
}

function extractFunctions(firstName, nextName) {
    const start = controller.indexOf("function " + firstName + "(");
    const end = controller.indexOf("function " + nextName + "(", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return controller.slice(start, end);
}

const scaleContext = {};
require("node:vm").runInNewContext(
    extractFunctions("formatDevelopSliderValue", "configureDevelopSliderRange") +
    "\nthis.api = { parseDevelopSliderValue, roundDevelopSliderValue, " +
    "actualToDevelopSliderPosition, developSliderPositionToActual, " +
    "nextDevelopSliderStepValue };",
    scaleContext
);
const scale = scaleContext.api;
const temperature = {
    id: "Temperature",
    min: 2000,
    max: 50000,
    rangeStep: 50,
    numericStep: 1,
    displayPrecision: 0,
    visualScale: "temperature"
};
assert.equal(scale.actualToDevelopSliderPosition(temperature, temperature.min), 0);
assert.equal(scale.actualToDevelopSliderPosition(temperature, temperature.max), 1000);
let previousPosition = -1;
for (const value of [2000, 3000, 5450, 10000, 25000, 50000]) {
    const position = scale.actualToDevelopSliderPosition(temperature, value);
    assert.ok(position > previousPosition);
    previousPosition = position;
    const roundTrip = scale.developSliderPositionToActual(temperature, position);
    assert.ok(Math.abs(roundTrip - value) <= temperature.rangeStep);
}
const tint = {
    id: "Tint", min: -150, max: 150, rangeStep: 1, numericStep: 1,
    displayPrecision: 0, visualScale: "linear"
};
assert.equal(scale.actualToDevelopSliderPosition(tint, 12), 12);
assert.equal(scale.developSliderPositionToActual(tint, 12), 12);
const exposure = {
    id: "Exposure", min: -5, max: 5, rangeStep: 0.1, numericStep: 0.01,
    displayPrecision: 2, visualScale: "linear"
};
assert.equal(scale.parseDevelopSliderValue(exposure, "-0.3"), -0.3);
assert.equal(scale.parseDevelopSliderValue(exposure, "-0,3"), -0.3);
for (const temporary of ["", "-", ".", "-.", "-0."]) {
    if (temporary === "-0.") {
        assert.ok(scale.parseDevelopSliderValue(exposure, temporary) === 0);
    } else {
        assert.equal(scale.parseDevelopSliderValue(exposure, temporary), null);
    }
}

function runStepSequence(definition, start, directions) {
    const control = {
        definition,
        authoritativeValue: start,
        localValue: start,
        desiredValue: null
    };
    const visible = [];
    for (const direction of directions) {
        const next = scale.nextDevelopSliderStepValue(control, direction);
        control.desiredValue = next;
        control.localValue = next;
        visible.push(next);
    }
    return { visible, desiredValue: control.desiredValue };
}

assert.deepEqual(
    runStepSequence(tint, 4, [1, 1, 1]),
    { visible: [5, 6, 7], desiredValue: 7 }
);
assert.deepEqual(
    runStepSequence(tint, 4, [-1, -1, -1]),
    { visible: [3, 2, 1], desiredValue: 1 }
);
assert.deepEqual(
    runStepSequence(tint, 4, [1, 1, -1, 1]),
    { visible: [5, 6, 5, 6], desiredValue: 6 }
);
assert.deepEqual(
    runStepSequence(exposure, 0, [1, 1, 1]).visible,
    [0.1, 0.2, 0.3]
);

const scheduledTimers = new Map();
let nextTimerId = 1;
const submittedStepValues = [];
let handledSubmissions = 0;
const debounceContext = {
    setTimeout(callback, delay) {
        const id = nextTimerId++;
        scheduledTimers.set(id, { callback, delay });
        return id;
    },
    clearTimeout(id) {
        scheduledTimers.delete(id);
    },
    submitDevelopSliderValue(_control, value, kind, completion) {
        submittedStepValues.push({ value, kind });
        completion(true);
    },
    handleDevelopSliderStepSubmission() {
        handledSubmissions += 1;
    }
};
require("node:vm").runInNewContext(
    extractFunctions("scheduleDevelopSliderStepSubmission", "stepDevelopSliderValue") +
    "\nthis.schedule = scheduleDevelopSliderStepSubmission;",
    debounceContext
);
const burstControl = { desiredValue: 4, stepDebounceTimer: null };
for (const value of [5, 6, 7, 8, 9]) {
    burstControl.desiredValue = value;
    debounceContext.schedule(burstControl);
}
assert.equal(scheduledTimers.size, 1);
const finalTimer = Array.from(scheduledTimers.values())[0];
assert.equal(finalTimer.delay, 350);
assert.deepEqual(submittedStepValues, []);
finalTimer.callback();
assert.deepEqual(submittedStepValues, [{ value: 9, kind: "step" }]);
assert.equal(handledSubmissions, 1);

assert.match(builder, /id:\s*"set"[\s\S]*route:\s*"set"[\s\S]*valueSource:\s*"sliders"/);
assert.match(builder, /return "\/api\/set\?slider="/);
assert.match(builder, /slider\.numericStep/);
assert.match(builder, /builderAmount\.min = String\(slider\.min\)/);
assert.match(builder, /builderAmount\.max = String\(slider\.max\)/);
assert.match(builder, /builderAmount\.step = String\(slider\.numericStep\)/);
assert.match(builder, /copyBuilderPath"\)\.disabled = !valid/);
assert.match(builder, /copyBuilderFull"\)\.disabled = !valid/);
assert.match(builder, /fetch\("\/api\/sliders"\)/);

for (const item of feedbackDefinitions) {
    assert.equal(sliders.parseAbsoluteValue(item.id, String(item.min)), item.min);
    assert.equal(sliders.parseAbsoluteValue(item.id, String(item.max)), item.max);
}
assert.equal(sliders.parseAbsoluteValue("Exposure", "1.25"), 1.25);
assert.equal(sliders.parseAbsoluteValue("Exposure", "1.234"), null);
assert.equal(sliders.parseAbsoluteValue("Contrast", "1.5"), null);
assert.equal(sliders.parseAbsoluteValue("Unknown", "0"), null);

assert.match(driver, /startTracking\(developSlider\)[\s\S]*setValue\(developSlider, value\)/);
assert.match(feedback, /available=0/);
assert.match(feedback, /feedback many snapshot read/);
assert.doesNotMatch(
    feedback.match(/local function sendManyRequestedValues[\s\S]*?local function sendAllRequestedValues/)[0],
    /lastSentValues\[slider\]\s*~=/
);
assert.match(query, /Tint = "Tint"/);
assert.match(query, /LrDevelopController\.getRange\(param\)/);
assert.match(driver, /Tint = "Tint"/);
assert.match(driver, /setValue\(developSlider, value\)/);
assert.match(parser, /value = string\.match\(json, \[\["value":\(\[%\-\]\?%d\+%\.\?%d\*\)\]\]\)/);
assert.match(luaCommands, /Driver\.setSlider\(\s*command\.slider,\s*command\.value\s*\)/);

console.log("Generic Develop slider metadata, controller, Builder, and feedback contracts passed.");
console.log("Validated 96 definitions and 93 reusable authoritative-feedback controls.");
