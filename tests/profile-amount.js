"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

const commands = require("../server/commands");
const sliders = require("../server/sliders");
const profileRegistry = require("../server/profile-sdk-registry");
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

const controller = read("app/controller.html");
const driver = read("lightroom/LRBridge.lrplugin/Driver.lua");
const luaCommands = read("lightroom/LRBridge.lrplugin/Commands.lua");
const query = read("lightroom/LRBridge.lrplugin/Query.lua");
const feedback = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const metadata = sliders.getById("ProfileAmount");

assert.deepEqual(metadata, {
    id: "ProfileAmount",
    label: "Profile Amount",
    group: "Profile",
    min: 0,
    max: 200,
    default: 100,
    incrementDescription: "Profile amount. Web Controller writes use absolute documented ProfileAmount values only.",
    rangeStep: 1,
    numericStep: 1,
    displayPrecision: 0,
    adjustSupported: false,
    resetSupported: true,
    useRuntimeRangeForAdmission: false,
    authoritativeUnavailableImmediate: true,
    retainAuthoritativeAcrossRender: false,
    feedbackSupported: true
});
for (const boundary of [0, 100, 200]) {
    assert.equal(sliders.parseAbsoluteValue("ProfileAmount", String(boundary)), boundary);
    assert.equal(commands.validateCommand({ command: "develop.set", slider: "ProfileAmount", value: boundary }), true);
}
for (const invalid of ["-1", "201", "99.5", "", " 100"] ) {
    assert.equal(sliders.parseAbsoluteValue("ProfileAmount", invalid), null);
}
assert.equal(commands.validateCommand({ command: "develop.adjust", slider: "ProfileAmount", amount: 1 }), false,
    "Profile Amount must write only through absolute setValue transport");
assert.equal(commands.validateCommand({ command: "develop.reset", slider: "ProfileAmount" }), true);

assert.match(driver, /ProfileAmount = "ProfileAmount"/);
const setSliderDriver = sourceBlock(driver, "function Driver.setSlider", "function Driver.resetSlider");
const resetSliderDriver = sourceBlock(driver, "function Driver.resetSlider", "local actionMap");
const profileAmountResetDriver = sourceBlock(
    resetSliderDriver,
    'if slider == "ProfileAmount" then',
    "local developSlider = sliderMap[slider]"
);
assert.match(luaCommands,
    /if command\.command == "develop\.reset" then[\s\S]*Driver\.resetSlider\([\s\S]*command\.slider/,
    "Every reset surface must reach the shared Driver reset command");
assert.match(profileAmountResetDriver, /return Driver\.setSlider\(slider, 100\)/,
    "Profile Amount Reset must delegate to one absolute value-100 write");
assert.equal((profileAmountResetDriver.match(/Driver\.setSlider\(slider, 100\)/g) || []).length, 1,
    "Profile Amount Reset must delegate exactly once");
assert.doesNotMatch(profileAmountResetDriver, /resetToDefault/,
    "Profile Amount Reset must not use Lightroom's ineffective generic reset operation");
assert.equal((setSliderDriver.match(/LrDevelopController\.setValue\(developSlider, value\)/g) || []).length, 1,
    "The shared absolute SDK writer must issue exactly one setValue call");
assert.match(resetSliderDriver, /LrDevelopController\.resetToDefault\(developSlider\)/,
    "Other slider resets must retain the generic Lightroom reset behavior");
assert.match(query, /ProfileAmount = "ProfileAmount"/);
assert.match(query, /LrDevelopController\.getValue\(param\)/);
assert.match(query, /if slider == "ProfileAmount" then\s*return 0, 200/,
    "Profile Amount feedback must retain its fixed 0-200 range");
assert.match(feedback, /"ProfileAmount"/);
assert.match(feedback, /if slider == "ProfileAmount" then[\s\S]*Query\.getDevelopValue\(slider\)/,
    "Profile Amount must use the generic authoritative Lightroom read path");
assert.match(feedback, /after\.photo ~= before\.photo[\s\S]*after\.uuid ~= before\.uuid/,
    "A Profile Amount read must stay bound to one Lightroom photo identity");
assert.match(feedback, /normalizeProfileSupportsAmount[\s\S]*value == true or value == "true"[\s\S]*value == false or value == "false"/,
    "Profile Amount capability must normalize Lightroom boolean and string values");
const capabilitySource = sourceBlock(feedback, "local supportsAmount = nil", "local parts =");
assert.match(capabilitySource,
    /source == "AILook"[\s\S]*type\(settings\.AILook\) == "table"[\s\S]*settings\.AILook\.SupportsAmount/,
    "Adaptive Profile capability must use the active authoritative AILook.SupportsAmount");
assert.match(capabilitySource,
    /source == "Look\.Name" and type\(settings\.Look\) == "table"[\s\S]*settings\.Look\.SupportsAmount/,
    "creative Profile capability must use the authoritative Look.SupportsAmount");
assert.match(feedback,
    /"supportsAmountSource=" \.\. supportsAmountSource[\s\S]*"supportsAmountValue=" \.\. profileScalar\(supportsAmount\)/,
    "the Profile fingerprint must include the selected capability source and normalized value");

const profileRowFactory = sourceBlock(controller, "function createProfileAmountSlider()", "function appendTransformCategoricalControls");
assert.match(profileRowFactory, /item\.id === "ProfileAmount"/);
assert.match(profileRowFactory, /createDevelopSliderControl\(definition\)/,
    "Profile Amount must reuse the normal LRBridge slider control");
const genericSliderFactory = sourceBlock(controller, "function createDevelopSliderControl(definition)", "function updateLensBlurExplicitSwitch");
assert.match(genericSliderFactory, /range\.addEventListener\("input"[\s\S]*stageDevelopSliderRangeValue/,
    "Profile Amount slider movement must use coalesced generic writes");
assert.match(genericSliderFactory, /function commitNumericValue\([\s\S]*flushDevelopSliderValue/,
    "Profile Amount numeric entry must use the generic absolute writer");
assert.match(genericSliderFactory, /makeButton\("−"[\s\S]*stepDevelopSliderValue\(control, -1\)/);
assert.match(genericSliderFactory, /makeButton\("\+"[\s\S]*stepDevelopSliderValue\(control, 1\)/);
assert.match(genericSliderFactory, /makeButton\("Reset"[\s\S]*\/api\/reset\?slider=/);
assert.match(genericSliderFactory,
    /const authoritativeResetValue = beginDevelopSliderReset\(control\)[\s\S]*handleDevelopSliderStepSubmission\(control, authoritativeResetValue, accepted\)/,
    "Profile Amount Reset must use the normal reset endpoint and authoritative confirmation path");

const resetPreparationSource = sourceBlock(
    controller,
    "function beginDevelopSliderReset",
    "function createDevelopSliderControl"
);
let resetCancellationCount = 0;
const resetPreparationContext = {
    cancelDevelopSliderStep(control) {
        resetCancellationCount += 1;
        control.desiredValue = null;
        control.confirmationPending = false;
        control.stepConfirmationExpired = false;
    }
};
vm.runInNewContext(
    resetPreparationSource + "\nthis.beginDevelopSliderReset = beginDevelopSliderReset;",
    resetPreparationContext
);
const profileAmountResetControl = {
    definition: { id: "ProfileAmount" },
    desiredValue: 75,
    confirmationPending: false,
    stepConfirmationExpired: true
};
assert.equal(resetPreparationContext.beginDevelopSliderReset(profileAmountResetControl), 100);
assert.equal(resetCancellationCount, 1);
assert.equal(profileAmountResetControl.desiredValue, 100);
assert.equal(profileAmountResetControl.confirmationPending, true,
    "Profile Amount must remain pending while Lightroom has not reported 100");
assert.equal(profileAmountResetControl.stepConfirmationExpired, false);
const ordinaryResetControl = {
    definition: { id: "Exposure" },
    desiredValue: 4,
    confirmationPending: true,
    stepConfirmationExpired: true
};
assert.equal(resetPreparationContext.beginDevelopSliderReset(ordinaryResetControl), null);
assert.equal(resetCancellationCount, 2);
assert.equal(ordinaryResetControl.desiredValue, null,
    "Other slider Reset must retain its existing cancellation behavior");
assert.equal(ordinaryResetControl.confirmationPending, false);

{
    function feedbackClassList() {
        const values = new Set();
        return {
            add(value) { values.add(value); },
            remove(...items) { items.forEach(function (item) { values.delete(item); }); }
        };
    }
    const amountControl = {
        definition: {
            id: "ProfileAmount", min: 0, max: 200,
            rangeStep: 1, numericStep: 1, displayPrecision: 0
        },
        row: { classList: feedbackClassList(), hidden: false },
        range: {
            value: "75", min: "0", max: "200", disabled: false,
            style: { setProperty() {} }
        },
        number: { value: "75", disabled: false },
        state: { textContent: "" },
        decrement: { disabled: false }, increment: { disabled: false }, reset: { disabled: false },
        authoritativeValue: 75, hasAuthoritativeValueEver: true,
        localValue: 75, numberCommittedValue: 75,
        desiredValue: 100, confirmationPending: true, stepConfirmationExpired: false,
        profileAmountEnabled: true,
        dragging: false, editing: false, deferredFeedbackResult: null,
        feedbackState: "available", stateMessage: "", visualProgress: "37.5%"
    };
    const feedbackContext = {
        Number,
        hasReceivedAnyAuthoritativeDevelopValue: false,
        isDevelopSliderInteracting() { return false; },
        actualToDevelopSliderPosition(_definition, value) { return Number(value); },
        formatDevelopSliderValue(_definition, value) { return String(value); },
        valuesMatchDevelopSlider(_definition, left, right) { return Number(left) === Number(right); },
        configureDevelopSliderRange() {},
        isParametricCurveSplitControl() { return false; },
        updateParametricCurveSplitConstraints() {},
        updateCompoundDevelopRange() {},
        cancelDevelopSliderStep(control) {
            control.desiredValue = null;
            control.confirmationPending = false;
            control.stepConfirmationExpired = false;
        }
    };
    const feedbackFunctions = sourceBlock(
        controller,
        "function setDevelopSliderState",
        "async function submitDevelopSliderValue"
    );
    vm.runInNewContext(
        feedbackFunctions + "\nthis.applyDevelopSliderFeedbackIfChanged = applyDevelopSliderFeedbackIfChanged;",
        feedbackContext
    );
    feedbackContext.applyDevelopSliderFeedbackIfChanged(amountControl, {
        available: true, value: 75, range: { min: 0, max: 200 }
    });
    assert.equal(amountControl.confirmationPending, true,
        "Non-matching feedback must keep Profile Amount Reset pending");
    assert.equal(amountControl.desiredValue, 100);
    assert.equal(amountControl.localValue, 75,
        "Reset must not optimistically display 100 before Lightroom confirms it");
    feedbackContext.applyDevelopSliderFeedbackIfChanged(amountControl, {
        available: true, value: 100, range: { min: 0, max: 200 }
    });
    assert.equal(amountControl.confirmationPending, false,
        "Authoritative ProfileAmount=100 feedback must clear pending state");
    assert.equal(amountControl.desiredValue, null);
    assert.equal(amountControl.authoritativeValue, 100);
    assert.equal(amountControl.localValue, 100);
    assert.equal(amountControl.range.value, "100");
    assert.equal(amountControl.number.value, "100");
}

const whiteBalanceSection = sourceBlock(controller, "function appendSectionCategoricalControls", "function createDevelopSectionElement");
const profileIndex = whiteBalanceSection.indexOf("createProfileSelector()");
const amountIndex = whiteBalanceSection.indexOf("createProfileAmountSlider()");
const whiteBalanceIndex = whiteBalanceSection.indexOf('whiteBalanceTitle.textContent = "WHITE BALANCE"');
assert.ok(profileIndex >= 0 && profileIndex < amountIndex && amountIndex < whiteBalanceIndex,
    "Profile Amount must render immediately below Profile and before WHITE BALANCE");

const gateSource = sourceBlock(controller, "function profileAmountSupported", "function updateProfileControl");
function fakeClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(...items) { items.forEach(function (item) { values.delete(item); }); },
        toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
        has(value) { return values.has(value); }
    };
}
let sliderProgress = "50%";
const profileAmountControl = {
    definition: metadata,
    row: { hidden: true, classList: fakeClassList() },
    range: {
        disabled: true,
        value: "100",
        style: { setProperty(_name, value) { sliderProgress = value; } }
    },
    number: { disabled: true, value: "100" },
    state: { textContent: "" },
    decrement: { disabled: true },
    increment: { disabled: true },
    reset: { disabled: true },
    feedbackState: "available",
    stateMessage: "",
    authoritativeValue: 100,
    hasAuthoritativeValueEver: true,
    localValue: 100,
    numberCommittedValue: 100,
    desiredValue: null,
    confirmationPending: false,
    stepConfirmationExpired: false,
    dragging: false,
    editing: false,
    interactionKind: null,
    throttleTimer: null,
    stepDebounceTimer: null,
    stepConfirmationTimer: null,
    pendingValue: null,
    pendingKind: null,
    pendingCompletion: null,
    deferredFeedbackResult: null,
    visualProgress: "50%",
    profileAmountEnabled: false,
    profileAmountPresentationIdentity: null
};
const profileControl = { row: { classList: fakeClassList() } };
let refreshCalls = 0;
const gateContext = {
    Number,
    String,
    developSliderControls: { ProfileAmount: profileAmountControl },
    developCategoricalControls: { profile: profileControl },
    activeSliderInteractions: new Set(),
    cancelDevelopSliderThrottle(control) {
        control.throttleTimer = null;
        if (control.pendingKind === "range") {
            control.pendingValue = null;
            control.pendingKind = null;
            control.pendingCompletion = null;
        }
    },
    cancelDevelopSliderStep(control) {
        control.desiredValue = null;
        control.confirmationPending = false;
        control.stepConfirmationExpired = false;
    },
    setDevelopSliderState(control, state, message) {
        control.feedbackState = state || "available";
        control.stateMessage = message || "";
        control.state.textContent = message || "";
    },
    requestLiveFeedbackSnapshot() { refreshCalls += 1; }
};
vm.runInNewContext(gateSource + "\nthis.profileAmountGate = { profileAmountSupported, updateProfileAmountControl };", gateContext);
const mountedProfileAmountRow = profileAmountControl.row;
const adaptivePresentation = {
    authoritativeToken: "profile_adaptive_color",
    authoritativeSource: "AILook",
    supportsAmount: true,
    pending: false,
    updating: false
};
gateContext.profileAmountGate.updateProfileAmountControl(adaptivePresentation);
assert.equal(profileAmountControl.row.hidden, false);
assert.equal(profileAmountControl.range.disabled, true,
    "A changed supported Profile must wait for current authoritative amount feedback");
assert.equal(profileAmountControl.number.value, "", "A changed Profile must clear the previous numeric value");
assert.equal(profileAmountControl.state.textContent, "Updating Profile Amount…");
assert.equal(refreshCalls, 1);

function restoreAvailableAmount(value) {
    profileAmountControl.feedbackState = "available";
    profileAmountControl.stateMessage = "";
    profileAmountControl.authoritativeValue = value;
    profileAmountControl.hasAuthoritativeValueEver = true;
    profileAmountControl.localValue = value;
    profileAmountControl.numberCommittedValue = value;
    profileAmountControl.number.value = String(value);
    profileAmountControl.range.value = String(value);
}
restoreAvailableAmount(100);
gateContext.profileAmountGate.updateProfileAmountControl(adaptivePresentation);
assert.equal(profileAmountControl.row.hidden, false);
assert.equal(profileAmountControl.range.disabled, false);
assert.equal(profileAmountControl.number.disabled, false);
assert.equal(profileAmountControl.decrement.disabled, false);
assert.equal(profileAmountControl.increment.disabled, false);
assert.equal(profileAmountControl.reset.disabled, false);
assert.equal(profileAmountControl.state.textContent, "");

gateContext.profileAmountGate.updateProfileAmountControl({
    authoritativeToken: "profile_adobe_color", authoritativeSource: "Look.Name", supportsAmount: false,
    pending: false, updating: false
});
assert.strictEqual(profileAmountControl.row, mountedProfileAmountRow,
    "Capability changes must preserve the mounted Profile Amount DOM row");
assert.equal(profileAmountControl.row.hidden, false,
    "Unsupported Profiles must leave the complete Profile Amount row visible");
assert.equal(profileAmountControl.authoritativeValue, null,
    "explicit SupportsAmount=false must not retain the previous Profile Amount");
assert.equal(profileAmountControl.localValue, null);
assert.equal(profileAmountControl.number.value, "",
    "Unsupported Profiles must clear the previous Profile's displayed numeric amount");
assert.equal(sliderProgress, "0%", "Unsupported Profiles must clear the previous slider position");
assert.equal(profileAmountControl.state.textContent, "Unavailable for this profile");
for (const element of [
    profileAmountControl.range,
    profileAmountControl.number,
    profileAmountControl.decrement,
    profileAmountControl.increment,
    profileAmountControl.reset
]) assert.equal(element.disabled, true, "Every unsupported Profile Amount control must be disabled");
assert.equal(profileControl.row.classList.has("develop-profile-section-gap"), false,
    "The permanently mounted Profile Amount row must always own the section spacing");

gateContext.profileAmountGate.updateProfileAmountControl({
    authoritativeToken: null, authoritativeSource: null, supportsAmount: null,
    pending: false, updating: true
});
assert.equal(profileAmountControl.row.hidden, false, "Capability updates must keep the row visible");
assert.equal(profileAmountControl.range.disabled, true);
assert.equal(profileAmountControl.state.textContent, "Updating Profile Amount…");

const artisticPresentation = {
    authoritativeToken: "profile_artistic_02",
    authoritativeSource: "Look.Name",
    supportsAmount: null,
    pending: false,
    updating: false
};
gateContext.profileAmountGate.updateProfileAmountControl(artisticPresentation);
assert.equal(profileAmountControl.row.hidden, false,
    "nil SupportsAmount from authoritative Look.Name must keep Profile Amount visible");
assert.equal(profileAmountControl.range.disabled, true,
    "Supported capability alone must not enable controls before amount feedback");
assert.equal(profileAmountControl.state.textContent, "Updating Profile Amount…");
assert.equal(refreshCalls, 2);
restoreAvailableAmount(125);
gateContext.profileAmountGate.updateProfileAmountControl(artisticPresentation);
for (const element of [
    profileAmountControl.range,
    profileAmountControl.number,
    profileAmountControl.decrement,
    profileAmountControl.increment,
    profileAmountControl.reset
]) assert.equal(element.disabled, false, "Authoritative amount feedback must re-enable every control");
assert.strictEqual(profileAmountControl.row, mountedProfileAmountRow);

assert.equal(gateContext.profileAmountGate.profileAmountSupported({
    authoritativeSource: "CameraProfile", supportsAmount: true
}), true, "explicit SupportsAmount=true must show regardless of source");
assert.equal(gateContext.profileAmountGate.profileAmountSupported({
    authoritativeSource: "AILook", supportsAmount: false
}), false, "explicit SupportsAmount=false must hide regardless of source");
assert.doesNotMatch(controller, /adaptiveProfileAmountLabels|isAdaptiveProfileAmountProfile/,
    "No Profile Amount name allowlist may remain");
assert.doesNotMatch(gateSource, /authoritativeLabel/,
    "Profile Amount availability must not inspect the active Profile label");
assert.doesNotMatch(gateSource, /row\.hidden\s*=\s*true/,
    "Profile Amount presentation must never hide its mounted row");
assert.doesNotMatch(gateSource, /appendChild|removeChild|\.remove\(/,
    "Profile capability changes must never add or remove layout rows");
assert.match(profileRowFactory, /row\.hidden = false/);
assert.doesNotMatch(profileRowFactory, /row\.hidden = true/);
assert.match(controller,
    /\.develop-profile-amount-row \.develop-slider-state \{[\s\S]*min-height:\s*16px;[\s\S]*height:\s*16px;/,
    "Profile Amount must reserve a fixed-height status area");

const submissionGateSource = sourceBlock(
    controller,
    "function isProfileAmountControl",
    "function notifyDevelopSliderPresentation"
);
const submissionGateContext = { Number };
vm.runInNewContext(
    submissionGateSource + "\nthis.profileAmountSubmissionBlocked = profileAmountSubmissionBlocked;",
    submissionGateContext
);
assert.equal(submissionGateContext.profileAmountSubmissionBlocked(profileAmountControl), false,
    "Supported Profile Amount with authoritative feedback must accept commands");
profileAmountControl.profileAmountEnabled = false;
profileAmountControl.range.disabled = true;
profileAmountControl.number.disabled = true;
profileAmountControl.decrement.disabled = true;
profileAmountControl.increment.disabled = true;
profileAmountControl.reset.disabled = true;
assert.equal(submissionGateContext.profileAmountSubmissionBlocked(profileAmountControl), true,
    "Unsupported Profile Amount must reject slider, numeric, step, and Reset submissions");
const absoluteSubmissionSource = sourceBlock(
    controller,
    "async function submitDevelopSliderValue",
    "function scheduleDevelopSliderValue"
);
assert.match(absoluteSubmissionSource,
    /if \(profileAmountSubmissionBlocked\(control\)\)[\s\S]*return;[\s\S]*\/api\/set\?slider=/,
    "All Profile Amount slider, numeric, and step writes must pass the disabled submission guard");
assert.match(genericSliderFactory,
    /makeButton\("Reset"[\s\S]*if \(profileAmountSubmissionBlocked\(control\)\) return;[\s\S]*\/api\/reset\?slider=/,
    "Profile Amount Reset must pass the same disabled presentation guard");

assert.deepEqual(profileRegistry.authoritativeReadOnlyProfiles, ["Adaptive Color", "Adaptive B&W"],
    "Adaptive Profiles must remain readback-only in the existing Profile dropdown");

const originalLog = console.log;
console.log = function () {};
commands.resetQueueForTests();
try {
    assert.equal(commands.tryEnqueueCommand({ command: "develop.set", slider: "ProfileAmount", value: 0 }).accepted, true);
    assert.equal(commands.tryEnqueueCommand({ command: "develop.set", slider: "ProfileAmount", value: 100 }).status,
        commands.ADMISSION_COALESCED);
    assert.equal(commands.tryEnqueueCommand({ command: "develop.set", slider: "ProfileAmount", value: 200 }).status,
        commands.ADMISSION_COALESCED);
    assert.deepEqual(commands.getNextCommand(), { command: "develop.set", slider: "ProfileAmount", value: 200 },
        "Rapid Profile Amount movement must leave only the newest absolute value");
    commands.tryEnqueueCommand({ command: "develop.set", slider: "ProfileAmount", value: 0 });
    assert.equal(commands.tryEnqueueCommand({ command: "develop.reset", slider: "ProfileAmount" }).status,
        commands.ADMISSION_COALESCED);
    assert.deepEqual(commands.getNextCommand(), { command: "develop.reset", slider: "ProfileAmount" },
        "Individual Reset must supersede a pending Profile Amount write");
    assert.equal(commands.getNextCommand(), null,
        "Profile Amount Reset must leave exactly one queued reset command");
    commands.tryEnqueueCommand({ command: "develop.reset", slider: "Exposure" });
    assert.deepEqual(commands.getNextCommand(), { command: "develop.reset", slider: "Exposure" },
        "Other slider Reset commands must remain unchanged");
    assert.equal(commands.getNextCommand(), null);
} finally {
    commands.resetQueueForTests();
    console.log = originalLog;
}

async function runFeedbackContextTests() {
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40
    });
    const savedLog = console.log;
    console.log = function () {};
    try {
        await bridge.start();
        const port = bridge.getHttpServer().address().port;
        let response = await getJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-photo-a&selectedPhotoUuid=uuid-photo-a" +
            "&selectedPhotoPath=C%3A%5Cphoto-a.dng&developFingerprint=revision-a");
        assert.equal(response.statusCode, 200);
        const photoAContext = response.body;

        response = await getJson(port,
            "/develop-categorical/profile-feedback?contextCounter=" + photoAContext.contextCounter +
            "&developCounter=" + photoAContext.developCounter +
            "&selectedPhotoKey=uuid-photo-a&selectedPhotoUuid=uuid-photo-a" +
            "&label=Third%20Party%20Solar%20Chrome&source=Look.Name&supportsAmount=true");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.profile.supportsAmount, true,
            "authoritative SupportsAmount=true must enter the UUID-bound Profile state");

        response = await getJson(port, "/feedback/request?slider=ProfileAmount");
        const staleRequestId = response.body.request.id;

        response = await getJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-photo-b&selectedPhotoUuid=uuid-photo-b" +
            "&selectedPhotoPath=C%3A%5Cphoto-b.dng&developFingerprint=revision-b");
        assert.equal(response.statusCode, 200);
        const photoBContext = response.body;

        response = await getJson(port,
            "/develop-categorical/profile-feedback?contextCounter=" + photoAContext.contextCounter +
            "&developCounter=" + photoAContext.developCounter +
            "&selectedPhotoKey=uuid-photo-a&selectedPhotoUuid=uuid-photo-a" +
            "&label=Third%20Party%20Solar%20Chrome&source=Look.Name&supportsAmount=true");
        assert.equal(response.statusCode, 409,
            "previous-photo Profile Amount capability must fail its UUID/context binding");
        response = await getJson(port,
            "/develop-categorical/profile-feedback?contextCounter=" + photoBContext.contextCounter +
            "&developCounter=" + photoBContext.developCounter +
            "&selectedPhotoKey=uuid-photo-b&selectedPhotoUuid=uuid-photo-b" +
            "&label=Adobe%20Color&source=Look.Name&supportsAmount=false");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.profile.supportsAmount, false,
            "the current photo's false capability must replace—not retain—the previous photo's true value");

        response = await getJson(port,
            "/feedback/result?id=" + staleRequestId +
            "&slider=ProfileAmount&value=75&min=0&max=200" +
            "&selectedPhotoKey=uuid-photo-a&selectedPhotoUuid=uuid-photo-a");
        assert.equal(response.statusCode, 409, "Previous-photo Profile Amount feedback must be rejected");
        response = await getJson(port, "/feedback/snapshot?id=" + staleRequestId);
        assert.equal(response.body.snapshot.complete, false);
        assert.equal(response.body.snapshot.results.ProfileAmount, undefined);

        for (const value of [0, 100, 200]) {
            response = await getJson(port, "/feedback/request?slider=ProfileAmount");
            const requestId = response.body.request.id;
            response = await getJson(port,
                "/feedback/result?id=" + requestId +
                "&slider=ProfileAmount&value=" + value + "&min=0&max=200" +
                "&selectedPhotoKey=uuid-photo-b&selectedPhotoUuid=uuid-photo-b");
            assert.equal(response.statusCode, 200, "Authoritative Profile Amount boundary rejected: " + value);
            response = await getJson(port, "/feedback/snapshot?id=" + requestId);
            assert.equal(response.body.snapshot.complete, true);
            assert.equal(response.body.snapshot.results.ProfileAmount.value, value);
        }
        response = await getJson(port, "/feedback/request?slider=ProfileAmount");
        response = await getJson(port,
            "/feedback/result?id=" + response.body.request.id +
            "&slider=ProfileAmount&value=201&min=0&max=200" +
            "&selectedPhotoKey=uuid-photo-b&selectedPhotoUuid=uuid-photo-b");
        assert.equal(response.statusCode, 400, "Authoritative Profile Amount feedback must enforce 0-200");
    } finally {
        console.log = savedLog;
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

runFeedbackContextTests().then(function () {
    console.log("Profile Amount boundaries, controls, reset, coalescing, SDK capability gating, and UUID-bound feedback passed.");
}).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
