"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

const commands = require("../server/commands");
const context = require("../server/context");
const sliders = require("../server/sliders");
const { createBridge } = require("../server/bridge");

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }
function sourceBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert.notEqual(startIndex, -1, "Missing source block start: " + start);
    assert.notEqual(endIndex, -1, "Missing source block end: " + end);
    return source.slice(startIndex, endIndex);
}
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
function drainQueue() { while (commands.getNextCommand() !== null) {} }

const hdrIds = [
    "HDREditMode", "HDRMaxValue", "SDRBrightness", "SDRContrast", "SDRClarity",
    "SDRHighlights", "SDRShadows", "SDRWhites", "SDRBlend"
];
const sdrIds = hdrIds.slice(2);
const metadata = require("../config/sliders.json");
const definitions = metadata.filter(function (item) { return item.group === "HDR / SDR Rendition"; });

assert.deepEqual(definitions.map(function (item) { return item.id; }), hdrIds);
assert.deepEqual(sliders.getContextBoundIds(), hdrIds);
assert.equal(new Set(hdrIds).size, 9);
assert.deepEqual(metadata.filter(function (item) {
    return ["PreviewForSDRDisplay", "VisualizeHDR", "HDRPointCurve"].includes(item.id);
}), [], "Excluded HDR features must not enter the production slider registry");

const modeDefinition = sliders.getById("HDREditMode");
assert.equal(modeDefinition.authoritativeZeroOne, true);
assert.equal(modeDefinition.adjustSupported, false);
assert.equal(modeDefinition.resetSupported, false);
assert.equal(modeDefinition.requireRuntimeRangeForAdmission, true);
assert.equal(modeDefinition.contextBoundRuntimeRange, true);
assert.equal(modeDefinition.default, undefined);

const limitDefinition = sliders.getById("HDRMaxValue");
assert.equal(limitDefinition.label, "HDR Limit");
assert.deepEqual({ min: limitDefinition.min, max: limitDefinition.max }, { min: 1, max: 8 });
assert.equal(limitDefinition.rangeStep, 0.1);
assert.equal(limitDefinition.numericStep, 0.1);
assert.equal(limitDefinition.displayPrecision, 1);
assert.equal(limitDefinition.visualScale, "log2");
assert.equal(limitDefinition.adjustSupported, false);
assert.equal(limitDefinition.resetSupported, true);
assert.equal(limitDefinition.resetDefaultSource, "lightroom");
assert.equal(limitDefinition.default, undefined);

for (const definition of definitions) {
    assert.equal(definition.feedbackSupported, true);
    assert.equal(definition.requireRuntimeRangeForAdmission, true);
    assert.equal(definition.contextBoundRuntimeRange, true);
    assert.equal(definition.authoritativeUnavailableImmediate, true);
    assert.equal(definition.retainAuthoritativeAcrossRender, false);
}
for (const definition of sdrIds.map(function (id) { return sliders.getById(id); })) {
    assert.deepEqual({ min: definition.min, max: definition.max }, { min: -100, max: 100 });
    assert.equal(definition.adjustSupported, false);
    assert.equal(definition.resetSupported, true);
    assert.equal(definition.resetDefaultSource, "lightroom");
    assert.equal(definition.default, undefined);
}
assert.equal(sliders.getById("SDRBlend").label, "Highlight Saturation");
for (const id of ["HDREditMode"].concat(sdrIds)) {
    assert.equal(sliders.getById(id).visualScale, undefined,
        id + " must retain its existing linear/value-independent presentation");
}

sliders.clearContextBoundRuntimeRanges();
for (const id of hdrIds) {
    assert.equal(sliders.getRuntimeRange(id), null);
    assert.equal(sliders.getAdmissionRange(id), null);
}
assert.equal(sliders.parseAbsoluteValue("HDREditMode", "0"), null,
    "HDR mode admission must fail until current-context feedback supplies its range");
assert.equal(sliders.setRuntimeRange("HDREditMode", 0, 1), true);
assert.equal(sliders.parseAbsoluteValue("HDREditMode", "0"), 0);
assert.equal(sliders.parseAbsoluteValue("HDREditMode", "1"), 1);
for (const invalid of ["-1", "0.5", "2", "true", ""]) {
    assert.equal(sliders.parseAbsoluteValue("HDREditMode", invalid), null);
}
assert.equal(sliders.setRuntimeRange("HDRMaxValue", 1, 8), true);
for (const value of ["1", "2.3", "2.4", "8"]) {
    assert.equal(sliders.parseAbsoluteValue("HDRMaxValue", value), Number(value));
}
for (const invalid of ["0.9", "2.35", "8.1", "true", ""]) {
    assert.equal(sliders.parseAbsoluteValue("HDRMaxValue", invalid), null);
}
for (const id of sdrIds) {
    assert.equal(sliders.setRuntimeRange(id, -100, 100), true);
    assert.equal(sliders.parseAbsoluteValue(id, "-100"), -100);
    assert.equal(sliders.parseAbsoluteValue(id, "25"), 25);
    assert.equal(sliders.parseAbsoluteValue(id, "100"), 100);
    assert.equal(sliders.parseAbsoluteValue(id, "101"), null);
}
assert.equal(commands.validateCommand({ command: "develop.set", slider: "HDREditMode", value: 0 }), true);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "HDREditMode", value: 1 }), true);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "HDREditMode", value: 0.5 }), false);
assert.equal(commands.validateCommand({ command: "develop.reset", slider: "HDREditMode" }), false);
assert.equal(commands.validateCommand({ command: "develop.adjust", slider: "HDREditMode", amount: 1 }), false);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "HDRMaxValue", value: 2.4 }), true);
assert.equal(commands.validateCommand({ command: "develop.set", slider: "HDRMaxValue", value: 2.35 }), false);
assert.equal(commands.validateCommand({ command: "develop.reset", slider: "HDRMaxValue" }), true);
assert.equal(commands.validateCommand({ command: "develop.adjust", slider: "HDRMaxValue", amount: 1 }), false);

drainQueue();
context.updateContext({
    activeModule: "develop", selectedPhotoKey: "hdr-direct-a", selectedPhotoUuid: "hdr-direct-a",
    selectedPhotoPath: "C:/hdr-direct-a.dng", developFingerprint: "hdr-direct-a-0"
});
const directContext = context.getContextFields();
let admission = commands.tryEnqueueCommand({ command: "develop.set", slider: "HDREditMode", value: 1 });
assert.equal(admission.accepted, true);
assert.deepEqual(commands.getNextCommand(), {
    command: "develop.set", slider: "HDREditMode", value: 1,
    expectedContextCounter: directContext.contextCounter,
    expectedSelectedPhotoKey: directContext.selectedPhotoKey,
    expectedSelectedPhotoUuid: directContext.selectedPhotoUuid
});

admission = commands.tryEnqueueCommand({ command: "develop.set", slider: "HDRMaxValue", value: 2.4 });
assert.equal(admission.accepted, true);
context.updateContext({
    activeModule: "develop", selectedPhotoKey: "hdr-direct-b", selectedPhotoUuid: "hdr-direct-b",
    selectedPhotoPath: "C:/hdr-direct-b.dng", developFingerprint: "hdr-direct-b-0"
});
assert.equal(commands.getNextCommand(), null,
    "A queued HDR write must be discarded after its bound Lightroom context changes");
sliders.clearContextBoundRuntimeRanges();
assert.equal(commands.tryEnqueueCommand({ command: "develop.set", slider: "HDREditMode", value: 1 }).accepted, false);

const driver = read("lightroom/LRBridge.lrplugin/Driver.lua");
const query = read("lightroom/LRBridge.lrplugin/Query.lua");
const feedback = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const controller = read("app/controller.html");
const bridgeSource = read("server/bridge.js");
const setDriver = sourceBlock(driver, "function Driver.setSlider", "function Driver.resetSlider");
const resetDriver = sourceBlock(driver, "function Driver.resetSlider", "local actionMap");
const watchedBlock = sourceBlock(feedback, "local watchedSliders = {", "local lastSentValues");
const fingerprintBlock = sourceBlock(feedback, "local function getDevelopFingerprint", "local function parseJsonInteger");
const feedbackReadBlock = sourceBlock(feedback, "local function readFeedbackValue", "local function sendRequestedValue");
const scaleBlock = sourceBlock(controller, "function formatDevelopSliderValue", "function setDevelopSliderState");
const scaleContext = {
    isParametricCurveSplitControl: function () { return false; },
    parametricCurveSplitOuterBounds: function () { return null; },
    constrainParametricCurveSplitValue: function (_control, value) { return value; }
};
vm.runInNewContext(scaleBlock + "\nthis.scale = { formatDevelopSliderValue, parseDevelopSliderValue, " +
    "actualToDevelopSliderPosition, developSliderPositionToActual, nextDevelopSliderStepValue, " +
    "configureDevelopSliderRange };", scaleContext);
const scale = scaleContext.scale;

function expectedHDRLimitPosition(value) {
    return (Math.log2(value) - Math.log2(limitDefinition.min)) /
        (Math.log2(limitDefinition.max) - Math.log2(limitDefinition.min));
}

assert.equal(scale.actualToDevelopSliderPosition(limitDefinition, 1), 0);
assert.equal(scale.actualToDevelopSliderPosition(limitDefinition, 8), 1000);
assert.equal(scale.developSliderPositionToActual(limitDefinition, 0), 1);
assert.equal(scale.developSliderPositionToActual(limitDefinition, 1000), 8);
for (const value of [2, 2.9, 4]) {
    const position = scale.actualToDevelopSliderPosition(limitDefinition, value);
    assert.ok(Math.abs(position / 1000 - expectedHDRLimitPosition(value)) < 1e-12,
        "HDR Limit forward logarithmic mapping drifted at " + value);
    assert.equal(scale.developSliderPositionToActual(limitDefinition, position), value,
        "HDR Limit inverse logarithmic mapping drifted at " + value);
}
assert.ok(Math.abs(scale.actualToDevelopSliderPosition(limitDefinition, 2) / 1000 - 1 / 3) < 1e-12);
assert.ok(Math.abs(scale.actualToDevelopSliderPosition(limitDefinition, 4) / 1000 - 2 / 3) < 1e-12);
for (let value = 1; value <= 8 + 1e-9; value += 0.1) {
    const actual = Number(value.toFixed(1));
    const roundTrip = scale.developSliderPositionToActual(
        limitDefinition,
        scale.actualToDevelopSliderPosition(limitDefinition, actual)
    );
    assert.ok(Math.abs(roundTrip - actual) < 1e-9,
        "HDR Limit round trip exceeded 0.1-value precision at " + actual);
}
const limitRange = { min: "", max: "", step: "" };
scale.configureDevelopSliderRange({ definition: limitDefinition, range: limitRange });
assert.deepEqual(limitRange, { min: "0", max: "1000", step: "1" });
assert.equal(scale.formatDevelopSliderValue(limitDefinition, 2.9), "2.9");
assert.equal(scale.parseDevelopSliderValue(limitDefinition, "2.9"), 2.9);
assert.equal(scale.parseDevelopSliderValue(limitDefinition, "2,9"), 2.9);
assert.equal(scale.parseDevelopSliderValue(limitDefinition, "2.95"), null);
const limitStepControl = {
    definition: limitDefinition,
    desiredValue: null,
    localValue: 2.9,
    authoritativeValue: 2.9
};
assert.equal(scale.nextDevelopSliderStepValue(limitStepControl, -1), 2.8);
assert.equal(scale.nextDevelopSliderStepValue(limitStepControl, 1), 3);

for (const id of hdrIds) {
    assert.match(driver, new RegExp(id + " = \\\"" + id + "\\\""));
    assert.match(query, new RegExp(id + " = \\\"" + id + "\\\""));
    assert.match(watchedBlock, new RegExp("\\\"" + id + "\\\""));
}
assert.match(driver, /developSlider == "HDREditMode" or developSlider == "HDRMaxValue" or[\s\S]*string\.sub\(developSlider, 1, 3\) == "SDR"[\s\S]*revealPanel\("adjustPanel"\)/);
assert.match(setDriver, /if slider == "HDREditMode" and value ~= 0 and value ~= 1 then[\s\S]*return false/);
assert.match(setDriver,
    /if slider == "HDRMaxValue" then[\s\S]*startTracking\(developSlider\)[\s\S]*setValue\(developSlider, value\)[\s\S]*stopTracking\(false\)[\s\S]*return setOk == true and stopOk == true/,
    "HDR Limit must use the fully proven tracked write sequence and close tracking");
assert.match(setDriver, /if slider ~= "HDREditMode" then[\s\S]*startTracking\(developSlider\)[\s\S]*setValue\(developSlider, value\)/,
    "HDR mode must use the probed direct explicit setValue path");
assert.match(resetDriver, /if slider == "HDREditMode" then[\s\S]*return false/);
assert.match(resetDriver, /resetToDefault\(developSlider\)/,
    "HDR Limit and the seven SDR controls must retain Lightroom's native reset path");
assert.match(query, /if slider == "HDREditMode" then\s*return 0, 1/);
assert.doesNotMatch(query, /if slider == "HDRMaxValue" then[\s\S]*return 1, 8/,
    "HDR Limit must obtain its range from Lightroom rather than a hard-coded query branch");
assert.doesNotMatch(resetDriver, /2\.3/,
    "The observed virtual-copy reset value must not become a production default");
assert.match(fingerprintBlock, /for i, slider in ipairs\(watchedSliders\)[\s\S]*Query\.getDevelopValue\(slider\)/,
    "All nine watched HDR values must feed the canonical Develop fingerprint");
assert.match(feedbackReadBlock,
    /contextBoundSliders\[slider\] == true[\s\S]*Query\.getDevelopValue\(slider\)[\s\S]*Query\.getDevelopRange\(slider\)/,
    "Live HDR feedback must come directly from LrDevelopController queries");
assert.doesNotMatch(feedbackReadBlock, /getDevelopSettings/,
    "Production HDR feedback must not wait for the lagging Develop-settings snapshot");
assert.match(feedbackReadBlock, /after\.photo ~= before\.photo[\s\S]*after\.uuid ~= before\.uuid/,
    "Each HDR feedback read must remain bound to one selected-photo identity");
assert.match(bridgeSource, /invalidateContextBoundFeedback\(\)/);
assert.match(bridgeSource, /Stale context-bound feedback/);

const sectionOrderMatch = controller.match(/const developSectionDisplayOrder = Object\.freeze\((\[[\s\S]*?\])\);/);
assert.ok(sectionOrderMatch);
const sectionOrder = vm.runInNewContext(sectionOrderMatch[1]);
const hdrSection = sectionOrder.find(function (section) { return section.id === "hdr-sdr-rendition"; });
assert.deepEqual(JSON.parse(JSON.stringify(hdrSection)), {
    id: "hdr-sdr-rendition",
    label: "HDR / SDR Rendition",
    selectors: [{ group: "HDR / SDR Rendition" }]
});
assert.equal(sectionOrder.findIndex(function (section) { return section.id === "hdr-sdr-rendition"; }), 2);
const modeControlBlock = sourceBlock(controller, "async function requestHDRModeFeedback", "function createDevelopSliderControl");
const modeSubmitBlock = sourceBlock(modeControlBlock, "function submit(value)", "const offButton");
assert.match(modeSubmitBlock, /control\.desiredValue = value/);
assert.match(modeSubmitBlock, /sendCommand\("\/api\/set\?slider=HDREditMode&value=" \+ String\(value\)\)/);
assert.doesNotMatch(modeSubmitBlock, /authoritativeValue\s*=(?!=)|classList\.toggle\("active"/,
    "HDR mode intent must not optimistically change the rendered authoritative state");
assert.match(modeControlBlock,
    /classList\.toggle\("active", available && control\.authoritativeValue === 0\)[\s\S]*classList\.toggle\("active", available && control\.authoritativeValue === 1\)/);
assert.match(modeControlBlock, /pollFeedbackSnapshot\(request\.id, 1900\)/);
assert.match(modeControlBlock, /value === control\.desiredValue/);
assert.doesNotMatch(modeControlBlock, /\/api\/reset/);
assert.match(controller,
    /Preview for SDR Display must be enabled manually in Lightroom\. LRBridge cannot observe or control that preview setting\./);
assert.match(controller, /item\.definition\.id === "HDREditMode"[\s\S]*createHDRModeControl\(item\.definition\)[\s\S]*createDevelopSliderControl\(item\.definition\)/);
assert.match(controller, /"HDREditMode",\s*"HDRMaxValue",\s*"SDRBrightness"/,
    "HDR Limit must render directly after HDR Edit Mode and before SDR Rendition controls");
const sliderControlBlock = sourceBlock(controller, "function createDevelopSliderControl", "function updateLensBlurExplicitSwitch");
const sliderPresentationBlock = sourceBlock(controller, "function showDevelopSliderLocal", "function applyDevelopSliderFeedback");
assert.match(sliderPresentationBlock,
    /visualPosition = actualToDevelopSliderPosition\(control\.definition, value\)[\s\S]*numberText = formatDevelopSliderValue\(control\.definition, value\)[\s\S]*control\.localValue = numericValue/,
    "Authoritative feedback must map only the range position while retaining the actual SDK value and numeric text");
assert.match(sliderControlBlock,
    /developSliderControlPositionToActual\(control, Number\(range\.value\)\)/,
    "Only range-thumb positions may be converted back to SDK values");
assert.match(sliderControlBlock,
    /parseDevelopSliderValue\([\s\S]*number\.value[\s\S]*flushDevelopSliderValue\(control, nextValue, "numeric"\)/,
    "Numeric entry must continue submitting actual SDK values");
assert.match(sliderControlBlock,
    /sendCommand\("\/api\/reset\?slider=" \+ encodeURIComponent\(definition\.id\)\)/,
    "HDR Limit must retain the generic native Reset route");

function fakeElement(tagName) {
    return {
        tagName: tagName,
        className: "",
        textContent: "",
        dataset: {},
        attributes: {},
        children: [],
        classList: { add: function () {} },
        setAttribute: function (name, value) { this.attributes[name] = value; },
        appendChild: function (child) { this.children.push(child); return child; },
        append: function () { this.children.push.apply(this.children, arguments); }
    };
}
const sectionContext = {
    document: {
        createElement: fakeElement,
        createDocumentFragment: function () { return fakeElement("fragment"); }
    },
    treatmentAuthoritativeState: true,
    renderLensCorrectionsSection: function () {},
    renderLensBlurSection: function () {},
    appendSectionCategoricalControls: function () {},
    createSectionControls: function () { return null; },
    createColorMixerPresentation: function () {},
    createHDRModeControl: function (definition) {
        const row = fakeElement("control"); row.dataset.sliderId = definition.id; return row;
    },
    createDevelopSliderControl: function (definition) {
        const row = fakeElement("control"); row.dataset.sliderId = definition.id; return row;
    },
    appendTransformConstrainCropControl: function () {}
};
const sectionRenderBlock = sourceBlock(controller, "function createDevelopSectionElement", "function invalidateHDRRenditionControls");
vm.runInNewContext(sectionRenderBlock + "\nthis.createDevelopSectionElement = createDevelopSectionElement;", sectionContext);
const renderedHDR = sectionContext.createDevelopSectionElement({
    id: "hdr-sdr-rendition", label: "HDR / SDR Rendition",
    items: definitions.map(function (definition) { return { definition: definition }; })
});
assert.deepEqual(renderedHDR.children.map(function (child) {
    return child.dataset.sliderId || child.className || child.textContent;
}), [
    "group-title", "HDREditMode", "hdr-section-divider", "HDRMaxValue",
    "command-group-note hdr-visualize-note", "hdr-section-divider",
    "hdr-sdr-rendition-subheading", "command-group-note hdr-sdr-rendition-note"
].concat(sdrIds));
assert.equal(renderedHDR.children.find(function (child) {
    return child.className === "hdr-sdr-rendition-subheading";
}).textContent, "SDR RENDITION SETTINGS");
assert.equal(renderedHDR.children.find(function (child) {
    return child.className === "command-group-note hdr-sdr-rendition-note";
}).textContent, "Preview for SDR Display must be enabled manually in Lightroom. LRBridge cannot observe or control that preview setting.");
assert.equal(renderedHDR.children.find(function (child) {
    return child.className === "command-group-note hdr-visualize-note";
}).textContent, "Visualize HDR must be enabled manually in Lightroom; LRBridge cannot observe or control it.");
const renderedOrdinary = sectionContext.createDevelopSectionElement({
    id: "presence", label: "Presence",
    items: [{ definition: { id: "Clarity", label: "Clarity" } }]
});
assert.equal(renderedOrdinary.children.some(function (child) {
    return /hdr-|SDR RENDITION SETTINGS|Preview for SDR Display|Visualize HDR/.test(
        child.className + " " + child.textContent
    );
}), false, "HDR-only dividers, notes, and subheading leaked into another section");
assert.match(controller, /\.group\[data-develop-section="hdr-sdr-rendition"\] \.hdr-section-divider/);
assert.match(controller, /\.group\[data-develop-section="hdr-sdr-rendition"\] \.hdr-sdr-rendition-subheading/);
assert.doesNotMatch(controller, /slider=VisualizeHDR|data-slider-id=["']VisualizeHDR|id=["']VisualizeHDR/,
    "Visualize HDR must remain an informational manual limitation, not a Web Controller toggle");
assert.doesNotMatch(driver + query + feedback + bridgeSource + JSON.stringify(metadata), /VisualizeHDR|HDRPointCurve|PreviewForSDRDisplay/);

async function main() {
    drainQueue();
    sliders.clearContextBoundRuntimeRanges();
    const bridge = createBridge({
        httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40
    });
    const originalLog = console.log;
    console.log = function () {};
    try {
        await bridge.start();
        const port = bridge.getHttpServer().address().port;
        const photoA = "HDR-INTEGRATION-A";
        let result = await getJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=" + photoA +
            "&selectedPhotoUuid=" + photoA + "&selectedPhotoPath=C%3A%2Fhdr-a.dng&developFingerprint=hdr-a-0");
        assert.equal(result.statusCode, 200);
        const contextA = result.body;

        result = await getJson(port, "/set?slider=HDREditMode&value=1");
        assert.equal(result.statusCode, 400, "No HDR write may use a metadata fallback range");

        result = await getJson(port, "/feedback/request?slider=HDREditMode");
        const modeRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + modeRequestId + "&slider=HDREditMode&value=1&min=0&max=1" +
            "&selectedPhotoKey=" + photoA + "&selectedPhotoUuid=" + photoA);
        assert.equal(result.statusCode, 200);
        assert.deepEqual(sliders.getRuntimeRange("HDREditMode"), { min: 0, max: 1 });

        result = await getJson(port, "/set?slider=HDREditMode&value=1");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.set", slider: "HDREditMode", value: 1,
            expectedContextCounter: contextA.contextCounter,
            expectedSelectedPhotoKey: photoA,
            expectedSelectedPhotoUuid: photoA
        });
        result = await getJson(port, "/reset?slider=HDREditMode");
        assert.equal(result.statusCode, 400, "HDR Edit Mode must never admit Reset");

        result = await getJson(port, "/feedback/request?slider=HDRMaxValue");
        const limitRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + limitRequestId + "&slider=HDRMaxValue&value=2.3&min=1&max=8" +
            "&selectedPhotoKey=" + photoA + "&selectedPhotoUuid=" + photoA);
        assert.equal(result.statusCode, 200);
        assert.deepEqual(sliders.getRuntimeRange("HDRMaxValue"), { min: 1, max: 8 });
        result = await getJson(port, "/feedback/value?slider=HDRMaxValue");
        assert.equal(result.body.result.value, 2.3);
        result = await getJson(port, "/set?slider=HDRMaxValue&value=2.4");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.set", slider: "HDRMaxValue", value: 2.4,
            expectedContextCounter: contextA.contextCounter,
            expectedSelectedPhotoKey: photoA,
            expectedSelectedPhotoUuid: photoA
        });
        result = await getJson(port, "/reset?slider=HDRMaxValue");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.reset", slider: "HDRMaxValue",
            expectedContextCounter: contextA.contextCounter,
            expectedSelectedPhotoKey: photoA,
            expectedSelectedPhotoUuid: photoA
        });

        result = await getJson(port, "/feedback/request?slider=SDRBrightness");
        const brightnessRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + brightnessRequestId + "&slider=SDRBrightness&value=25&min=-100&max=100" +
            "&selectedPhotoKey=" + photoA + "&selectedPhotoUuid=" + photoA);
        assert.equal(result.statusCode, 200);
        result = await getJson(port, "/reset?slider=SDRBrightness");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.reset", slider: "SDRBrightness",
            expectedContextCounter: contextA.contextCounter,
            expectedSelectedPhotoKey: photoA,
            expectedSelectedPhotoUuid: photoA
        });

        result = await getJson(port, "/feedback/request?slider=SDRBrightness");
        const unavailableRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + unavailableRequestId + "&slider=SDRBrightness&available=0" +
            "&selectedPhotoKey=" + photoA + "&selectedPhotoUuid=" + photoA);
        assert.equal(result.statusCode, 200);
        assert.equal(sliders.getRuntimeRange("SDRBrightness"), null,
            "An unavailable current-context result must clear the prior runtime range immediately");
        result = await getJson(port, "/set?slider=SDRBrightness&value=25");
        assert.equal(result.statusCode, 400);

        result = await getJson(port, "/feedback/request?slider=SDRContrast");
        const contrastCurrentRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + contrastCurrentRequestId + "&slider=SDRContrast&value=0&min=-100&max=100" +
            "&selectedPhotoKey=" + photoA + "&selectedPhotoUuid=" + photoA);
        assert.equal(result.statusCode, 200);
        assert.deepEqual(sliders.getRuntimeRange("SDRContrast"), { min: -100, max: 100 });
        result = await getJson(port, "/feedback/request?slider=SDRContrast");
        const identityMismatchRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + identityMismatchRequestId + "&slider=SDRContrast&value=0&min=-100&max=100" +
            "&selectedPhotoKey=WRONG-PHOTO&selectedPhotoUuid=WRONG-PHOTO");
        assert.equal(result.statusCode, 409);
        assert.equal(sliders.getRuntimeRange("SDRContrast"), null,
            "Identity-mismatched feedback must revoke prior range authority even before the next heartbeat");

        result = await getJson(port, "/feedback/request?slider=HDRMaxValue");
        const staleRequestId = result.body.request.id;
        const photoB = "HDR-INTEGRATION-B";
        result = await getJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=" + photoB +
            "&selectedPhotoUuid=" + photoB + "&selectedPhotoPath=C%3A%2Fhdr-b.dng&developFingerprint=hdr-b-0");
        assert.equal(result.statusCode, 200);
        for (const id of hdrIds) assert.equal(sliders.getRuntimeRange(id), null);
        result = await getJson(port, "/feedback/value?slider=HDRMaxValue");
        assert.equal(result.body.result, null, "Photo-context invalidation must clear HDR Limit feedback value");
        result = await getJson(port,
            "/feedback/result?id=" + staleRequestId + "&slider=HDRMaxValue&value=2.3&min=1&max=8" +
            "&selectedPhotoKey=" + photoA + "&selectedPhotoUuid=" + photoA);
        assert.equal(result.statusCode, 409, "HDR Limit feedback from an invalidated photo context must be rejected");

        result = await getJson(port,
            "/context/update?activeModule=library&selectedPhotoKey=" + photoB +
            "&selectedPhotoUuid=" + photoB + "&selectedPhotoPath=C%3A%2Fhdr-b.dng&developFingerprint=");
        assert.equal(result.statusCode, 200);
        for (const id of hdrIds) assert.equal(sliders.getRuntimeRange(id), null);
        result = await getJson(port, "/feedback/value?slider=HDRMaxValue");
        assert.equal(result.body.result, null, "Module invalidation must clear HDR Limit feedback value");
        result = await getJson(port, "/feedback/request?slider=HDRMaxValue");
        const libraryRequestId = result.body.request.id;
        result = await getJson(port,
            "/feedback/result?id=" + libraryRequestId + "&slider=HDRMaxValue&available=0" +
            "&selectedPhotoKey=" + photoB + "&selectedPhotoUuid=" + photoB);
        assert.equal(result.statusCode, 200, "A matching Library nil read must settle as authoritative unavailability");
        assert.equal(result.body.result.available, false);
        result = await getJson(port, "/set?slider=HDRMaxValue&value=2.4");
        assert.equal(result.statusCode, 400, "Module-unavailable HDR Limit must remain fail-closed");
    } finally {
        console.log = originalLog;
        await bridge.stop();
        drainQueue();
        sliders.clearContextBoundRuntimeRanges();
    }

    console.log("HDR / SDR Rendition authoritative contracts passed.");
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
