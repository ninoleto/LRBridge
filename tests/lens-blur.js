"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const lensBlurDefinition = require("../server/lens-blur-state");
const focalRange = require("../server/lens-blur-focal-range");
const nativeDefinition = require("../server/windows-lightroom-native");
const lensBlurUi = require("../app/controller-lens-blur");
const { createBridge } = require("../server/bridge");

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const metadata = require("../config/sliders.json");
const scalarIds = ["LensBlurAmount", "LensBlurCatEye", "LensBlurHighlightsBoost"];
const expectedBokeh = [
    { value: "Circle", label: "Circle" },
    { value: "SoapBubble", label: "Bubble" },
    { value: "Blade", label: "5-Blade" },
    { value: "Ring", label: "Ring" },
    { value: "Anamorphic", label: "Anamorphic" }
];

assert.deepEqual(metadata.filter((item) => item.group === "Lens Blur").map((item) => item.id), scalarIds);
for (const id of scalarIds) {
    const definition = metadata.find((item) => item.id === id);
    assert.deepEqual([definition.min, definition.max, definition.rangeStep, definition.numericStep], [0, 100, 1, 1]);
    assert.equal(definition.feedbackSupported, true);
    assert.equal(definition.adjustSupported, false);
    assert.equal(definition.resetSupported, true);
}

assert.deepEqual(Array.from(lensBlurDefinition.bokehValues), expectedBokeh.map((item) => item.value));
assert.deepEqual(Array.from(lensBlurUi.bokehOptions), expectedBokeh);
assert.equal(commands.validateCommand({ command: "lens_blur.active.set", enabled: false }), true);
assert.equal(commands.validateCommand({ command: "lens_blur.active.set", enabled: 0 }), false);
for (const value of lensBlurDefinition.bokehValues) {
    assert.equal(commands.validateCommand({ command: "lens_blur.bokeh.set", value: value }), true);
}
assert.equal(commands.validateCommand({ command: "lens_blur.depth_visualization.toggle" }), false,
    "The production command surface must not admit blind Visualize Depth toggles");
assert.equal(commands.validateCommand({ command: "lens_blur.depth_refinement.close" }), true);
assert.equal(commands.validateCommand({ command: "lens_blur.depth_refinement.close", target: "loupe" }), false);

const capturedRanges = [
    "-50 30 85 165",
    "-80 0 55 135",
    "-35 45 100 180",
    "-20 60 78 158",
    "-43 37 94 174",
    "-43 37 57 137"
];
for (const value of capturedRanges) {
    const parsed = focalRange.parse(value);
    assert.ok(parsed, value);
    assert.equal(focalRange.format(parsed), value);
    assert.equal(commands.validateCommand({ command: "lens_blur.focal_range.set", value: value }), true);
}
for (const invalid of ["", "-43 37 57", "-43 37 57 137 1", "-43 38 37 137", "-43.5 37 57 137",
    " -43 37 57 137", "-43  37 57 137", "NaN 37 57 137", "-1000001 0 1 2"]) {
    assert.equal(focalRange.parse(invalid), null, invalid);
    assert.equal(commands.validateCommand({ command: "lens_blur.focal_range.set", value: invalid }), false);
}
const originalRange = focalRange.parse("-43 37 57 137");
assert.deepEqual(focalRange.translate(originalRange, "whole", 2), { nearOuter: -41, nearInner: 39, farInner: 59, farOuter: 139 });
assert.deepEqual(focalRange.translate(originalRange, "near", -37), { nearOuter: -80, nearInner: 0, farInner: 57, farOuter: 137 });
assert.deepEqual(focalRange.translate(originalRange, "far", -2), { nearOuter: -43, nearInner: 37, farInner: 55, farOuter: 135 });
assert.equal(focalRange.translate(originalRange, "near", 30), null, "Near movement must not cross the Far inner edge");
assert.deepEqual(lensBlurUi.translateFocalRange(originalRange, "whole", 2), { nearOuter: -41, nearInner: 39, farInner: 59, farOuter: 139 });
assert.deepEqual(lensBlurUi.translateFocalRange(originalRange, "near", -37), { nearOuter: -80, nearInner: 0, farInner: 57, farOuter: 137 });
assert.deepEqual(lensBlurUi.translateFocalRange(originalRange, "far", -2), { nearOuter: -43, nearInner: 37, farInner: 55, farOuter: 135 });
assert.equal(lensBlurUi.translateFocalRange(originalRange, "near", 30), null);
assert.deepEqual(lensBlurUi.focalRangeDeltaBounds(originalRange, "near"), { min: -999957, max: 20 });

const decimalEditor = lensBlurUi.createNumericEditor({ precision: 1, min: 0.1, max: 100 });
assert.equal(decimalEditor.applyAuthoritative(42, true, 0.1, 100).text, "42.0");
decimalEditor.begin("42.0");
decimalEditor.change("3");
let editorState = decimalEditor.applyAuthoritative(43, true, 0.1, 100);
assert.equal(editorState.authoritative, 43, "Polling must continue updating the authoritative editor model");
assert.equal(editorState.text, "3", "Polling must not overwrite actively edited text");
assert.equal(editorState.dirty, true);
assert.equal(decimalEditor.cancel().text, "43.0", "Escape semantics restore the latest authoritative value");
decimalEditor.begin("43.0");
decimalEditor.change("31.0");
const preparedDecimal = decimalEditor.prepareCommit("31.0");
assert.deepEqual({ ok: preparedDecimal.ok, submit: preparedDecimal.submit, value: preparedDecimal.value },
    { ok: true, submit: true, value: 31 });
decimalEditor.applyAuthoritative(43, true, 0.1, 100);
assert.equal(decimalEditor.get().text, "31.0", "Committed text remains visible while submission is in flight");
decimalEditor.acceptSubmission();
assert.equal(decimalEditor.get().pending, true, "Accepted submission remains dirty until authoritative confirmation");
editorState = decimalEditor.applyAuthoritative(31, true, 0.1, 100);
assert.equal(editorState.pending, false);
assert.equal(editorState.text, "31.0");
decimalEditor.begin("31.0");
decimalEditor.change("500");
assert.equal(decimalEditor.prepareCommit("500").ok, false, "Out-of-range Brush values must be rejected explicitly");
assert.equal(decimalEditor.rejectSubmission("Invalid numeric value").text, "31.0");

const integerEditor = lensBlurUi.createNumericEditor({ integer: true, min: -1000000, max: 1000000 });
integerEditor.applyAuthoritative(-43, true, -1000000, 1000000);
integerEditor.begin("-43");
integerEditor.change("-80");
assert.equal(integerEditor.prepareCommit("-80").value, -80, "Negative Focus Range integers remain valid");

function runDelayedStepBurst(step, precision, directions, expected) {
    const interaction = lensBlurUi.createStepInteraction({ step: step, precision: precision });
    interaction.applyAuthoritative(50);
    const submitted = [];
    let result = interaction.click(directions[0], 50, 0, 100);
    assert.equal(result.accepted, true);
    assert.ok(Number.isFinite(result.target) && result.target !== 0);
    let request = interaction.takeNextRequest();
    submitted.push(request.target);
    for (let index = 1; index < directions.length; index += 1) {
        interaction.applyAuthoritative(index % 2 === 0 ? 49 : 50);
        result = interaction.click(directions[index], null, 0, 100);
        assert.equal(result.accepted, true);
        assert.ok(Number.isFinite(result.state.pendingTarget) && result.state.pendingTarget !== 0);
        assert.equal(interaction.takeNextRequest(), null, "Only one delayed native request may be in flight");
    }
    interaction.markIdle();
    assert.equal(interaction.takeNextRequest(), null);
    interaction.completeRequest(request, true, request.target);
    request = interaction.takeNextRequest();
    submitted.push(request.target);
    assert.equal(request.final, true);
    assert.equal(request.target, expected);
    interaction.completeRequest(request, true, expected);
    assert.equal(interaction.get().active, false);
    assert.equal(interaction.get().authoritative, expected);
    for (const value of submitted) assert.ok(Number.isFinite(value) && value !== 0 && value !== null);
}

runDelayedStepBurst(1, 0, [1, 1, 1, 1, 1, -1, -1, -1], 52);
runDelayedStepBurst(0.1, 1, [1, 1, 1, 1, 1, -1, -1, -1], 50.2);
runDelayedStepBurst(1, 0, [1, -1, 1, -1], 50);
runDelayedStepBurst(1, 0, [1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1], 54);
runDelayedStepBurst(0.1, 1, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1], 50);

const midBurst = lensBlurUi.createStepInteraction({ step: 1, precision: 0 });
midBurst.applyAuthoritative(50);
midBurst.click(1, 50, 0, 100);
const midFirst = midBurst.takeNextRequest();
midBurst.click(1, null, 0, 100);
midBurst.applyAuthoritative(49);
midBurst.click(1, undefined, 0, 100);
midBurst.completeRequest(midFirst, true, 51);
const midSecond = midBurst.takeNextRequest();
assert.deepEqual({ target: midSecond.target, final: midSecond.final }, { target: 53, final: false });
for (const direction of [1, 1, -1, -1, -1]) {
    midBurst.applyAuthoritative(50);
    midBurst.click(direction, "", 0, 100);
}
midBurst.markIdle();
midBurst.completeRequest(midSecond, true, 53);
const midFinal = midBurst.takeNextRequest();
assert.deepEqual({ target: midFinal.target, final: midFinal.final }, { target: 52, final: true });
midBurst.completeRequest(midFinal, true, 52);
assert.equal(midBurst.get().authoritative, 52);

const rejectedStep = lensBlurUi.createStepInteraction({ step: 1, precision: 0 });
rejectedStep.applyAuthoritative(50);
rejectedStep.click(1, 50, 0, 100);
const rejectedRequest = rejectedStep.takeNextRequest();
rejectedStep.applyAuthoritative(49);
const rejectedOutcome = rejectedStep.completeRequest(rejectedRequest, false, 49);
assert.equal(rejectedOutcome.rollback, 49);
assert.equal(rejectedOutcome.state.active, false);

const model = lensBlurUi.createModel();
let presentation = lensBlurUi.presentationFor(model.get());
assert.equal(presentation.applyAvailable, false);
assert.equal(presentation.focalRangeAvailable, false);
assert.equal(presentation.refinementMode, "unknown");
model.applyAuthoritative({
    activeAvailable: true,
    active: true,
    bokehAvailable: true,
    bokeh: "Circle",
    selectedToolAvailable: true,
    selectedTool: "depth_refinement",
    focalRangeAvailable: true,
    focalRange: originalRange,
    windowsNative: {
        available: true,
        brush: {
            amount: { available: true, value: 100, min: 0, max: 100 },
            size: { available: true, value: 42, min: 0.1, max: 100 },
            feather: { available: true, value: 100, min: 0, max: 100 },
            flow: { available: true, value: 100, min: 1, max: 100 }
        },
        visualizeDepth: { available: true, value: false },
        autoMask: { available: true, value: false },
        refinementMode: "focus",
        refinementModeTargetsAvailable: true,
        refinementDisclosure: { available: true, value: true },
        refinementReset: { available: true, enabled: false }
    }
});
presentation = lensBlurUi.presentationFor(model.get());
assert.equal(presentation.applyOnSelected, true);
assert.equal(presentation.refinementActive, true);
assert.equal(presentation.focalRange.nearOuter, -43);
assert.equal(presentation.brush.size.value, 42);
assert.equal(presentation.visualizeDepth.value, false);
assert.equal(presentation.refinementMode, "focus");
assert.equal(presentation.refinementModeTargetsAvailable, true);
assert.deepEqual(presentation.refinementDisclosure, { available: true, value: true });
assert.deepEqual(presentation.refinementReset, { available: true, enabled: false });
model.applyWindowsNative(null);
assert.equal(lensBlurUi.presentationFor(model.get()).focalRangeAvailable, true, "Native invalidation must preserve SDK state");
assert.equal(lensBlurUi.presentationFor(model.get()).brush.size.available, false);

const driver = read("lightroom/LRBridge.lrplugin/Driver.lua");
const query = read("lightroom/LRBridge.lrplugin/Query.lua");
const feedback = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const luaCommands = read("lightroom/LRBridge.lrplugin/Commands.lua");
const lensBlurLua = read("lightroom/LRBridge.lrplugin/LensBlur.lua");
const controller = read("app/controller.html");
const bridgeSource = read("server/bridge.js");
const nativeSource = read("server/windows-lightroom-native.ps1");
const nativeJsSource = read("server/windows-lightroom-native.js");

for (const id of scalarIds) {
    assert.match(driver, new RegExp(id + " = \"" + id + "\""));
    assert.match(query, new RegExp(id + " = \"" + id + "\""));
    assert.match(feedback, new RegExp("\"" + id + "\""));
}
assert.match(lensBlurLua, /LrDevelopController\.setValue\("LensBlurFocalRange", value\)/);
assert.match(lensBlurLua, /LrDevelopController\.getValue\("LensBlurFocalRange"\)/);
assert.match(luaCommands, /lens_blur\.focal_range\.set[\s\S]*LensBlur\.setFocalRange\(command\.value\)[\s\S]*LensBlur\.sendCurrentState\(\)/);
assert.match(lensBlurLua, /function LensBlur\.closeDepthRefinement\(\)[\s\S]*getSelectedTool\(\)[\s\S]*selectTool\("loupe"\)[\s\S]*settled ~= "loupe"/,
    "The proposed Close writer must be target-aware and self-verify with authoritative selected-tool readback");
assert.match(luaCommands, /lens_blur\.depth_refinement\.close[\s\S]*LensBlur\.closeDepthRefinement\(\)[\s\S]*LensBlur\.sendCurrentState\(\)/);
assert.doesNotMatch(lensBlurLua + luaCommands, /toggleLensBlurDepthVisualization|depth_visualization\.toggle/);
assert.doesNotMatch(lensBlurLua + controller + bridgeSource, /selectTool\("focal_range"\)/);
assert.doesNotMatch(lensBlurLua, /getRange\("LensBlurFocalRange"\)/);

assert.match(nativeSource, /TBM_SETPOS/);
assert.match(nativeSource, /TB_THUMBTRACK[\s\S]*TB_THUMBPOSITION[\s\S]*TB_ENDTRACK/);
assert.match(nativeSource, /BM_GETCHECK/);
assert.match(nativeSource, /if \(\$current\.value -ne \$Enabled\)[\s\S]*BM_CLICK/);
assert.match(nativeSource, /Discover-NativeControls/);
assert.match(nativeSource, /Get-TrackbarWriteDiscovery[\s\S]*Refresh-RefinementDiscovery/,
    "A Brush drag may reuse only a transaction-scoped root with fresh subtree discovery");
assert.match(nativeSource, /Get-NativeStateFromDiscovery \$discovery/,
    "A native write must reuse only its freshly discovered, revalidated controls for authoritative readback");
assert.match(nativeSource, /TB_ENDTRACK[\s\S]*RedrawWindow/,
    "Native trackbar writes must explicitly repaint after Lightroom processes the notifications");
assert.match(nativeSource, /Refresh-TrackbarPaint[\s\S]*GetClientRect[\s\S]*WM_MOUSEMOVE[\s\S]*RedrawWindow/,
    "Frozen Lightroom thumbs require a target-local client-relative hover repaint trigger");
assert.doesNotMatch(nativeSource, /TBM_GETTHUMBRECT|0x0419/,
    "Pointer-bearing trackbar messages must never cross the Lightroom process boundary");
assert.match(nativeSource, /Find-ModeActivationTarget[\s\S]*Focus \(Bridge View\)[\s\S]*Blur \(Bridge View\)/);
assert.match(nativeSource, /GetClientRect[\s\S]*PostMessage[\s\S]*WM_LBUTTONDOWN[\s\S]*WM_LBUTTONUP/,
    "Mode activation must remain target-local and use verified client-relative coordinates");
assert.match(nativeSource, /Set-RefinementMode[\s\S]*if \(\$state\.refinementMode -eq \$Mode\)[\s\S]*Post-ModeClientActivation[\s\S]*if \(\$state\.refinementMode -ne \$Mode\)/,
    "Mode writes must be target-aware and accepted only after authoritative branch readback");
assert.match(nativeSource, /Read-RefinementModeTargetsAvailable[\s\S]*Find-ModeActivationTarget \$Discovery "focus"[\s\S]*Find-ModeActivationTarget \$Discovery "blur"/,
    "Mode target availability must be independent of initially unknown branch visibility");
assert.doesNotMatch(nativeSource.match(/function Set-RefinementMode[\s\S]*?^}/m)[0], /Authoritative Brush Refinement mode is unknown/,
    "An unknown mode must not deadlock two verified mode targets");
assert.match(nativeSource, /Find-RefinementDisclosure[\s\S]*Brush Refinement[\s\S]*ControlId -eq 65535/,
    "The disclosure must be rediscovered structurally beside Lightroom's Brush Refinement label");
assert.match(nativeSource, /Set-RefinementDisclosure[\s\S]*if \(\$current\.value -eq \$Open\)[\s\S]*Post-VerifiedClientClick[\s\S]*state\.refinementDisclosure\.value -ne \$Open/,
    "Disclosure writes must no-op at target and verify visible/hidden Brush controls afterward");
assert.match(nativeSource, /Read-RefinementDisclosureState[\s\S]*Read-RefinementModeTargetsAvailable \$Discovery[\s\S]*rootVisible -and \$modeTargetsAvailable[\s\S]*value=\$true/,
    "Verified Focus/Blur targets must prove that Brush Refinement is expanded without an active mode or slider branch");
assert.match(nativeSource, /Find-RefinementResetTarget[\s\S]*Class -eq "Static"[\s\S]*Text -eq "Reset"[\s\S]*SS_NOTIFY/,
    "Reset Depth Refinement must be discovered as Lightroom's unique notifying Static target");
assert.match(nativeSource, /Invoke-RefinementReset[\s\S]*Post-VerifiedClientClick[\s\S]*refinementReset\.enabled -eq \$false/,
    "Reset Depth Refinement must use its verified target and require authoritative disabled readback");
assert.match(nativeSource, /Reset-Trackbar[\s\S]*Get-ResetTrackbarContext[\s\S]*Post-TrackbarClientDoubleClick[\s\S]*Refresh-RefinementDiscovery[\s\S]*Refresh-TrackbarPaint/,
    "Each Brush reset must double-click its verified trackbar and repaint authoritative output");
assert.match(nativeSource, /TBM_GETTHUMBLENGTH[\s\S]*NativeMax-\$Control\.NativeMin[\s\S]*WM_LBUTTONDBLCLK/,
    "Reset coordinates must derive from safe scalar trackbar geometry and native position");
assert.match(nativeJsSource, /result\.affected[\s\S]*state\.brush\[control\] = affected[\s\S]*refreshStateInBackground\(\)/,
    "Reset must return the affected authoritative value before refreshing the remaining native state");
assert.match(nativeSource, /LensBlurContents/);
assert.match(nativeSource, /LensBlurRefinement/);
assert.match(nativeSource, /\$visualizeButton = Add-AnchorIdentity \(Find-UniqueButtonInRoot \$windows \$lensRoot "Visualize Depth"\)/);
assert.match(nativeSource, /\$autoMaskButton = Add-AnchorIdentity \(Find-UniqueButtonInRoot \$windows \$refinementRoot "Auto Mask"\)/);
assert.doesNotMatch(nativeSource, /Discover-Panel|Build-PanelCandidate/,
    "Native controls must not be coupled to one all-or-nothing panel candidate");
assert.match(nativeSource, /Assert-TrackIdentity/);
assert.match(nativeSource, /Assert-ButtonIdentity/);
assert.doesNotMatch(nativeSource, /HWND\s*0x[0-9a-f]+/i, "Runtime HWNDs must never be stored in production source");
assert.doesNotMatch(nativeSource + bridgeSource, /SendInput|keybd_event|mouse_event|SetCursorPos/i);

assert.match(controller, /FOCUS RANGE/);
assert.match(controller, /Visualize Depth/);
assert.match(controller, /modeFocus = makeButton\("Focus"[\s\S]*modeBlur = makeButton\("Blur"/);
assert.match(controller, /Auto Mask/);
assert.match(controller, /\[\["amount", "Amount"[\s\S]*\["size", "Size"[\s\S]*\["feather", "Feather"[\s\S]*\["flow", "Flow"/);
assert.match(controller, /\/api\/lens-blur\/visualize-depth\?enabled=/);
assert.match(controller, /\/api\/lens-blur\/auto-mask\?enabled=/);
assert.doesNotMatch(controller, /\/api\/lens-blur\/depth-visualization\/toggle/);
const lensBlurUiBlock = controller.match(/function renderLensBlurSection[\s\S]*?let lensCorrectionsView/)[0];
const lensBlurControllerBlock = controller.match(/function updateLensBlurExplicitSwitch[\s\S]*?let lensCorrectionsView/)[0];
for (const unsupported of ["Subject Focus", "Point / Area Focus", "Reset Lens Blur"]) {
    assert.equal(lensBlurUiBlock.includes(unsupported), false, "Unsupported Lens Blur control exposed: " + unsupported);
}
assert.match(lensBlurControllerBlock, /setLensBlurRefinementMode[\s\S]*\/api\/lens-blur\/refinement-mode\?value=/,
    "Runtime-proven Focus/Blur buttons must dispatch explicit native mode targets");
assert.match(lensBlurControllerBlock, /modeAvailable = presentation\.refinementModeTargetsAvailable === true/,
    "Verified Focus/Blur targets must remain clickable while selected mode is unknown");
assert.match(lensBlurControllerBlock, /if \(!native \|\| native\.refinementModeTargetsAvailable !== true\) return false;[\s\S]*if \(native\.refinementMode === mode\) return true;/,
    "Unknown mode must activate an explicit verified target; only an authoritative match may no-op");
assert.match(lensBlurControllerBlock, /setLensBlurRefinementDisclosure[\s\S]*\/api\/lens-blur\/refinement-disclosure\?open=/,
    "Brush Refinement disclosure must dispatch an explicit native target state");
assert.match(lensBlurControllerBlock, /lensBlurRefinementButton\.textContent = lensBlurDisclosureRequestInFlight[\s\S]*"Closing…"[\s\S]*"Opening…"[\s\S]*"Close Brush Refinement"[\s\S]*"Open Brush Refinement"/,
    "Disclosure text must follow authoritative native subtree visibility");
assert.match(lensBlurControllerBlock, /classList\.toggle\("command-primary", !danger\)[\s\S]*classList\.toggle\("command-danger", danger\)/,
    "Collapsed/Opening must be primary blue while Expanded/Closing must be danger red");
assert.match(lensBlurControllerBlock, /setAttribute\("aria-pressed", String\(disclosureOpen\)\)/,
    "Disclosure aria-pressed must reflect only authoritative expanded state");
assert.doesNotMatch(lensBlurUiBlock, /depth-refinement\/(?:select|close)/,
    "The disclosure button must not switch Lightroom's selected tool");
assert.match(lensBlurControllerBlock, /modeAvailable[\s\S]*focus\.disabled = !modeAvailable[\s\S]*blur\.disabled = !modeAvailable/,
    "Mode buttons must fail closed when authoritative branch visibility is unknown");
assert.doesNotMatch(lensBlurControllerBlock, /\.type\s*=\s*"number"/,
    "Lens Blur exact-value editors must not expose browser number spinners");
assert.match(lensBlurControllerBlock, /number\.type = "text";[\s\S]*number\.inputMode = "decimal"/);
assert.match(lensBlurControllerBlock, /input\.type = "text";[\s\S]*input\.inputMode = "numeric";[\s\S]*input\.pattern = "-\?\[0-9\]\*"/);
assert.match(lensBlurControllerBlock, /number\.addEventListener\("keydown"[\s\S]*event\.key === "Enter"[\s\S]*commitLensBlurNativeEditor/,
    "Brush Enter must commit through the guarded editor");
assert.match(lensBlurControllerBlock, /number\.addEventListener\("blur"[\s\S]*commitLensBlurNativeEditor/,
    "Brush blur must commit through the guarded editor");
assert.match(lensBlurControllerBlock, /event\.key === "Escape"[\s\S]*control\.editor\.cancel\(\)/,
    "Brush Escape must restore authoritative state");
assert.match(lensBlurControllerBlock, /input\.addEventListener\("keydown"[\s\S]*event\.key === "Enter"[\s\S]*commitLensBlurFocalField/,
    "Focus Range Enter must commit through the guarded editor");
assert.match(lensBlurControllerBlock, /input\.addEventListener\("blur"[\s\S]*commitLensBlurFocalField/,
    "Focus Range blur must commit through the guarded editor");
assert.match(lensBlurControllerBlock, /event\.key === "Escape"[\s\S]*field\.editor\.cancel\(\)/,
    "Focus Range Escape must restore authoritative state");
assert.match(lensBlurControllerBlock, /selection\.style\.left = nearOuter[\s\S]*selection\.style\.width = Math\.max\(0, farOuter - nearOuter\)/,
    "The outlined Focus Range must retain all four authoritative boundaries");
assert.match(lensBlurControllerBlock, /nearHandle\.style\.left = nearOuter[\s\S]*farHandle\.style\.left = farOuter/,
    "Focus Range edge grips must manipulate the outer Near and Far pair boundaries");
assert.match(lensBlurControllerBlock, /target\.setPointerCapture/);
assert.match(lensBlurControllerBlock, /scheduleLensBlurFocalDragFlush\(140\)/,
    "Focus Range dragging must coalesce raw pointer movement");
assert.match(lensBlurControllerBlock, /pendingRange = Object\.assign\(\{\}, range\)/,
    "Focus Range must retain one complete optimistic four-component value");
assert.match(lensBlurControllerBlock, /const sentRange = Object\.assign\(\{\}, drag\.desired\)/,
    "Each coalesced Focus Range write must send a complete range snapshot");
assert.match(lensBlurControllerBlock, /const finalWrite = drag\.released[\s\S]*setLensBlurFocalRange\(sentRange\)/,
    "Pointer release must perform an authoritative complete Focus Range write");
assert.match(lensBlurControllerBlock, /createElement\("details"\)[\s\S]*Advanced values/,
    "Internal Focus Range values must be hidden in a collapsed Advanced disclosure by default");
assert.match(lensBlurControllerBlock, /row\.className = "develop-slider-row lens-blur-native-row unavailable"/,
    "Brush controls must use the standard LRBridge slider component");
assert.match(lensBlurControllerBlock, /scheduleLensBlurNativeValue[\s\S]*}, 100\)/,
    "Brush slider movement must be locally optimistic and coalesced");
assert.match(lensBlurControllerBlock, /pointerup[\s\S]*finishLensBlurNativeRange\(control, event, true\)/,
    "Brush slider release must force a final native write");
assert.doesNotMatch(lensBlurControllerBlock, /Waiting for Lightroom/,
    "Optimistic Brush and Focus Range controls must not display blocking wait text");
assert.match(lensBlurControllerBlock, /const reset = makeButton\("Reset", "reset", function \(\) \{ resetLensBlurNativeValue\(control\); \}\)/,
    "Every generated native Brush row must use Lightroom's per-trackbar reset path");
assert.match(lensBlurControllerBlock, /row\.appendChild\(increment\);[\s\S]*row\.appendChild\(reset\);/,
    "Brush Reset belongs directly after + in the standard row layout");
assert.match(lensBlurUiBlock, /modeRow[\s\S]*makeButton\("Reset Refinement", "reset"[\s\S]*modeRow\.appendChild\(refinementReset\)/,
    "Reset Refinement must appear beside Focus and Blur while preserving per-row resets");
assert.match(lensBlurControllerBlock, /Available after Focus or Blur refinements have been painted\./,
    "Disabled Reset Refinement must explain Lightroom's native enable condition");
assert.match(lensBlurControllerBlock, /window\.confirm\("Remove all painted Lens Blur refinements from this photo\?"\)[\s\S]*\/api\/lens-blur\/refinement-reset\?confirmed=true/,
    "Reset Refinement must require explicit destructive confirmation");
assert.doesNotMatch(lensBlurControllerBlock, /(?:amount|size|feather|flow)[\s\S]{0,80}(?:100|42)[\s\S]{0,80}reset/i,
    "Production must not encode guessed Brush reset defaults");
assert.match(lensBlurControllerBlock, /stepInteraction\.click[\s\S]*showLensBlurNativeLocal\(control, result\.target\)[\s\S]*pumpLensBlurNativeStep\(control\)/,
    "Rapid +/- clicks must use the finite accumulator and dispatch the first absolute target immediately");
assert.match(lensBlurControllerBlock, /stepInteraction: lensBlurHelper\.createStepInteraction\(\{ step: step, precision: precision \}\)/);
assert.doesNotMatch(lensBlurControllerBlock, /stepTimer = setTimeout[\s\S]{0,300}submitLensBlurNativeValue/,
    "No delayed callback may normalize a cleared desired value into zero");
assert.match(lensBlurControllerBlock, /typeof value !== "number" && typeof value !== "string"[\s\S]*value\.trim\(\) === ""[\s\S]*return null/,
    "Native value normalization must reject null, undefined, and empty input before numeric conversion");
assert.match(lensBlurControllerBlock, /control\.reset\.disabled = control\.resetInFlight === true;[\s\S]*Resetting…/,
    "Reset must acknowledge immediately without disabling the entire Brush row");

const initialNativeState = {
    available: true,
    reason: null,
    brush: {
        amount: { available: true, value: 100, min: 0, max: 100 },
        size: { available: true, value: 42, min: 0.1, max: 100 },
        feather: { available: true, value: 100, min: 0, max: 100 },
        flow: { available: true, value: 100, min: 1, max: 100 }
    },
    visualizeDepth: { available: true, value: false },
    autoMask: { available: true, value: false },
    refinementMode: "focus",
    refinementModeTargetsAvailable: true,
    refinementDisclosure: { available: true, value: true },
    refinementReset: { available: true, enabled: false }
};

const partialNativeState = nativeDefinition.sanitizeNativeState({
    available: true,
    brush: {
        amount: { available: false },
        size: { available: false },
        feather: { available: false },
        flow: { available: false }
    },
    visualizeDepth: { available: true, value: true },
    autoMask: { available: false },
    refinementMode: "unknown",
    refinementModeTargetsAvailable: true,
    refinementDisclosure: { available: true, value: false },
    refinementReset: { available: false, enabled: false }
});
assert.equal(partialNativeState.available, true, "A partial native result must keep the backend healthy");
assert.deepEqual(partialNativeState.visualizeDepth, { available: true, value: true });
assert.equal(partialNativeState.brush.size.available, false);
assert.equal(partialNativeState.autoMask.available, false);
assert.deepEqual(partialNativeState.refinementDisclosure, { available: true, value: false });
assert.deepEqual(partialNativeState.refinementReset, { available: false, enabled: false });
assert.equal(partialNativeState.refinementMode, "unknown");
assert.equal(partialNativeState.refinementModeTargetsAvailable, true);

function createFakeNativeBackend() {
    let state = clone(initialNativeState);
    const calls = [];
    return {
        calls: calls,
        readState: async function () { calls.push(["readState"]); return clone(state); },
        setBrushValue: async function (control, value, options) {
            calls.push(["setBrushValue", control, value, options]); state.brush[control].value = value; return clone(state);
        },
        resetBrushValue: async function (control) {
            calls.push(["resetBrushValue", control]); state.brush[control].value = control === "size" ? 25 : 50; return clone(state);
        },
        adjustBrushValue: async function (control, amount) {
            calls.push(["adjustBrushValue", control, amount]); state.brush[control].value += amount; return clone(state);
        },
        setCheckbox: async function (control, enabled) {
            calls.push(["setCheckbox", control, enabled]); state[control].value = enabled; return clone(state);
        },
        setRefinementMode: async function (mode) {
            calls.push(["setRefinementMode", mode]); state.refinementMode = mode; return clone(state);
        },
        setRefinementDisclosure: async function (open) {
            calls.push(["setRefinementDisclosure", open]); state.refinementDisclosure.value = open; return clone(state);
        },
        resetRefinement: async function () {
            calls.push(["resetRefinement"]); state.refinementReset = { available: true, enabled: false }; return clone(state);
        },
        stop: async function () { calls.push(["stop"]); }
    };
}

async function request(base, pathname) {
    const response = await fetch(base + pathname);
    const body = await response.json();
    return { response: response, body: body };
}

(async function () {
    commands.resetQueueForTests();
    const fakeNative = createFakeNativeBackend();
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        windowsNativeBackend: fakeNative
    });
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    try {
        let result = await request(base, "/lens-blur/state");
        assert.deepEqual(result.body.state.windowsNative, initialNativeState);
        assert.equal(result.body.state.focalRangeAvailable, false);

        result = await request(base, "/lens-blur/brush/size/set?value=31.0");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setBrushValue", "size", 31, undefined]);
        assert.equal(result.body.windowsNative.brush.size.value, 31);
        result = await request(base, "/lens-blur/brush/size/set?value=32&interaction=drag-one&final=false");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setBrushValue", "size", 32, { interaction: "drag-one", final: false }]);
        result = await request(base, "/lens-blur/brush/size/set?value=33&interaction=drag-one&final=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setBrushValue", "size", 33, { interaction: "drag-one", final: true }]);
        result = await request(base, "/lens-blur/brush/size/set?value=34&interaction=bad%20id&final=false");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/brush/flow/adjust?amount=-1");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["adjustBrushValue", "flow", -1]);
        result = await request(base, "/lens-blur/brush/reset/set?value=1");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/brush/size/reset");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["resetBrushValue", "size"]);
        assert.equal(result.body.windowsNative.brush.size.value, 25);
        result = await request(base, "/lens-blur/brush/reset/reset");
        assert.equal(result.response.status, 400);

        result = await request(base, "/lens-blur/visualize-depth?enabled=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setCheckbox", "visualizeDepth", true]);
        assert.equal(result.body.windowsNative.visualizeDepth.value, true);
        result = await request(base, "/lens-blur/auto-mask?enabled=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setCheckbox", "autoMask", true]);
        result = await request(base, "/lens-blur/refinement-mode?value=blur");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setRefinementMode", "blur"]);
        assert.equal(result.body.windowsNative.refinementMode, "blur");
        result = await request(base, "/lens-blur/refinement-disclosure?open=false");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setRefinementDisclosure", false]);
        assert.equal(result.body.windowsNative.refinementDisclosure.value, false);
        result = await request(base, "/lens-blur/refinement-disclosure?open=toggle");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/refinement-reset");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/refinement-reset?confirmed=false");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/refinement-reset?confirmed=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["resetRefinement"]);
        assert.deepEqual(result.body.windowsNative.refinementReset, { available: true, enabled: false });
        result = await request(base, "/lens-blur/depth-visualization/toggle");
        assert.equal(result.response.status, 410);
        assert.equal(commands.getNextCommand(), null);

        const stateQuery = "/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Circle" +
            "&selectedToolAvailable=true&selectedTool=depth_refinement&focalRangeAvailable=true&focalRange=" +
            encodeURIComponent("-43 37 57 137");
        result = await request(base, stateQuery);
        assert.equal(result.response.status, 200);
        result = await request(base, "/lens-blur/state");
        assert.deepEqual(result.body.state.focalRange, originalRange);

        result = await request(base, "/lens-blur/focal-range/set?nearOuter=-80&nearInner=0&farInner=55&farOuter=135&expected=" +
            encodeURIComponent("-43 37 57 137"));
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.focal_range.set", value: "-80 0 55 135" });
        result = await request(base, "/lens-blur/state");
        assert.equal(result.body.state.focalRangeAvailable, false, "Accepted writes invalidate state until Lightroom reports readback");

        await request(base, stateQuery);
        result = await request(base, "/lens-blur/focal-range/adjust?part=near&amount=-1&expected=" +
            encodeURIComponent("-43 37 57 137"));
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.focal_range.set", value: "-44 36 57 137" });
        await request(base, stateQuery);
        result = await request(base, "/lens-blur/focal-range/adjust?part=far&amount=50&expected=" +
            encodeURIComponent("-43 37 57 137"));
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.focal_range.set", value: "-43 37 107 187" });
        await request(base, stateQuery);
        result = await request(base, "/lens-blur/focal-range/set?nearOuter=-80&nearInner=0&farInner=55&farOuter=135&expected=stale");
        assert.equal(result.response.status, 409);
        assert.equal(commands.getNextCommand(), null);

        result = await request(base, "/lens-blur/apply?enabled=false");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.active.set", enabled: false });
        result = await request(base, "/lens-blur/bokeh?value=SoapBubble");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.bokeh.set", value: "SoapBubble" });
        result = await request(base, "/lens-blur/depth-refinement/select");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.depth_refinement.select" });
        result = await request(base, "/lens-blur/depth-refinement/close");
        assert.equal(result.response.status, 409, "Close must fail closed while selected-tool authority is invalidated");
        await request(base, stateQuery);
        result = await request(base, "/lens-blur/depth-refinement/close");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.depth_refinement.close" });
    } finally {
        await bridge.stop();
    }
    assert.deepEqual(fakeNative.calls.at(-1), ["stop"]);

    const nonWindows = nativeDefinition.createWindowsLightroomNativeBackend({ platform: "linux" });
    const unavailable = await nonWindows.readState();
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.refinementMode, "unknown");
    assert.deepEqual(unavailable.refinementReset, { available: false, enabled: false });
    await assert.rejects(nonWindows.setBrushValue("size", 31), { code: "LIGHTROOM_NATIVE_UNAVAILABLE" });
    await assert.rejects(nonWindows.resetRefinement(), { code: "LIGHTROOM_NATIVE_UNAVAILABLE" });
    await nonWindows.stop();

    console.log("Lens Blur native backend, Focus Range, state, transport, and UI contract tests passed.");
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
