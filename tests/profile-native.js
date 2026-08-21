"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const commands = require("../server/commands");
const profileDefinition = require("../server/profile-native-state");
const profileRegistry = require("../server/profile-sdk-registry");
const controllerDefinition = require("../app/controller-develop-categorical");
const createBridge = require("../server/bridge").createBridge;

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

const labels = [
    "Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Standard", "Adobe Vivid", "Artistic 01",
    "Adaptive Color", "Adaptive B&W", "Adobe Monochrome", "B&W 01", "Camera Standard"
];

function rawSnapshot(selectedLabel, snapshotLabels) {
    snapshotLabels = snapshotLabels || labels;
    const selectedIndex = snapshotLabels.indexOf(selectedLabel);
    assert.notEqual(selectedIndex, -1);
    return {
        available: true,
        reason: null,
        processId: 15300,
        mainHwnd: 71001,
        comboHwnd: 71002,
        listHwnd: 71003,
        expanded: false,
        browsePosition: 12,
        browseLabel: "Browse...",
        selectedCount: 1,
        selected: { position: selectedIndex, label: selectedLabel },
        options: snapshotLabels.map(function (label, position) {
            return { position: position, label: label, enabled: true, selectionItem: true };
        }),
        patterns: { selection: true, expandCollapse: true, selectionItem: true }
    };
}

function createClock(initial) {
    let value = initial;
    return {
        now: function () { return value; },
        advance: function (amount) { value += amount; }
    };
}

async function stateRegistryAndAdmissionTests() {
    const clock = createClock(1000);
    let selected = "Adobe Color";
    let nativeLabels = labels;
    const backend = { readProfileSnapshot: async function () { return rawSnapshot(selected, nativeLabels); } };
    const profile = profileDefinition.createProfileNativeState(backend, {
        secret: Buffer.alloc(32, 7), refreshIntervalMs: 1, failureThreshold: 3,
        staleAfterMs: 20, writeTimeoutMs: 8000, now: clock.now
    });

    let state = await profile.refresh();
    assert.deepEqual(profileRegistry.supportedProfiles,
        ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Vivid", "Adobe Monochrome", "Artistic 01"]);
    assert.deepEqual(profileRegistry.authoritativeReadOnlyProfiles,
        ["Adobe Standard", "Adaptive Color", "Adaptive B&W"]);
    assert.deepEqual(state.options.filter(function (option) { return option.writable; }).map(function (option) {
        return option.label;
    }), ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Vivid", "Artistic 01", "Adobe Monochrome"],
    "only proven SDK Profiles may be writable");
    assert.deepEqual(state.options.map(function (option) { return option.label; }), labels,
        "native Profile readback must retain every quick-option label");

    for (const label of labels) {
        selected = label;
        clock.advance(1);
        state = await profile.refresh();
        assert.equal(state.selectedLabel, label, "authoritative readback must work for " + label);
    }

    const tokenFor = function (label) {
        return state.options.find(function (option) { return option.label === label; }).token;
    };
    for (const unsupported of ["Adobe Standard", "Adaptive Color", "Adaptive B&W", "B&W 01", "Camera Standard"]) {
        assert.throws(function () { profile.admitSdkSelection(tokenFor(unsupported)); },
            /readback-only|stale/, unsupported + " must fail closed");
    }

    let admission = profile.admitSdkSelection(tokenFor("Artistic 01"));
    assert.equal(admission.label, "Artistic 01");
    assert.equal(profile.getSdkWritePending().label, "Artistic 01");
    assert.throws(function () { profile.admitSdkSelection(tokenFor("Adobe Color")); },
        /already awaiting/, "rapid conflicting submissions must be rejected");

    selected = "Artistic 01";
    nativeLabels = labels;
    clock.advance(1);
    state = await profile.refresh();
    assert.equal(state.selectedLabel, "Artistic 01");
    assert.notEqual(profile.getSdkWritePending(), null,
        "native readback alone must not confirm before SDK graph validation");
    assert.equal(profile.recordSdkValidation(admission.generation, "Artistic 01", "confirmed"), true);
    assert.equal(profile.getSdkWritePending(), null,
        "matching native readback plus SDK graph validation confirms the write");

    admission = profile.admitSdkSelection(tokenFor("Adobe Color"));
    clock.advance(8000);
    assert.equal(profile.getSdkWritePending(), null, "the server admission lock must expire at eight seconds");
    assert.equal(profile.getDiagnostics().sdkWritesTimedOut, 1);
    assert.equal(admission.label, "Adobe Color");

    nativeLabels = labels.filter(function (label) { return label !== "Artistic 01"; });
    selected = "Adobe Color";
    clock.advance(1);
    state = await profile.refresh();
    assert.deepEqual(state.options.map(function (option) { return option.label; }), nativeLabels,
        "the Web Controller Profile list must mirror the native quick list exactly");
    assert.equal(state.options.some(function (option) { return option.label === "Artistic 01"; }), false,
        "Artistic 01 must not be injected when Lightroom omits it from the quick list");
}

function controllerConfirmationTests() {
    function option(label, position, writable) {
        return { token: "profile_" + String(position + 1).padStart(24, "0"), label: label,
            position: position, enabled: true, writable: writable };
    }
    const options = [option("Adobe Color", 0, true), option("Artistic 01", 1, true),
        option("Adobe Landscape", 2, true), option("Adobe Portrait", 3, true), option("Adobe Standard", 4, false),
        option("Adobe Vivid", 5, true), option("Adaptive Color", 6, false),
        option("Adaptive B&W", 7, false), option("B&W 01", 8, false)];
    function state(revision, selectedLabel, validationGeneration, validationFailedGeneration) {
        const selected = options.find(function (entry) { return entry.label === selectedLabel; });
        return {
            available: true, reason: null, revision: revision, optionSnapshotRevision: 1,
            contextCounter: 4, processId: 15300, browsePosition: 12, browseLabel: "Browse...",
            selectedToken: selected.token, selectedLabel: selected.label,
            validationGeneration: validationGeneration || 0,
            validationFailedGeneration: validationFailedGeneration || 0,
            options: options.map(function (entry) { return Object.assign({}, entry); })
        };
    }

    const model = controllerDefinition.createProfileModel();
    assert.equal(model.apply(state(10, "Adobe Color")).accepted, true);
    const artisticToken = options[1].token;
    const adobeToken = options[0].token;
    assert.equal(model.begin(options[6].token, 1), false, "Adaptive Color must be readback-only");
    assert.equal(model.begin(artisticToken, 1), true);
    assert.equal(model.presentation().pending, true, "dropdown must lock immediately while pending");
    assert.equal(model.begin(adobeToken, 2), false, "rapid conflicting selections must not start a second write");
    assert.equal(model.setConfirmationAfterRevision(1, 10, 41), true);
    assert.equal(model.apply(state(11, "Adobe Color")).confirmed, false,
        "an SDK return or unrelated poll must not report success");
    assert.equal(model.apply(state(12, "Adobe Color")).confirmed, false,
        "delayed confirmation may span multiple authoritative polls");
    assert.equal(model.apply(state(13, "Artistic 01")).confirmed, false,
        "native target alone must wait for SDK graph validation");
    const confirmed = model.apply(state(14, "Artistic 01", 41));
    assert.equal(confirmed.confirmed, true);
    assert.equal(model.getPending(), null);

    assert.equal(model.begin(adobeToken, 2), true);
    assert.equal(model.setConfirmationAfterRevision(2, 14, 42), true);
    assert.equal(model.timeout(2), true);
    assert.equal(model.presentation().pending, false);
    assert.equal(model.getTimedOut().label, "Adobe Color");
    const late = model.apply(state(15, "Adobe Color", 42));
    assert.equal(late.lateConfirmed, true, "late authoritative state must clear stale timeout presentation");
    assert.equal(model.getTimedOut(), null);

    assert.equal(model.begin(options[2].token, 3), true);
    assert.equal(model.setConfirmationAfterRevision(3, 15, 43), true);
    const failed = model.apply(state(16, "Adobe Landscape", 42, 43));
    assert.equal(failed.rejected, true, "an SDK graph-validation failure must reject native-label-only success");
    assert.equal(failed.rejectionReason, "sdk-validation-failed");
}

function requestJson(port, requestPath) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ host: "127.0.0.1", port: port, path: requestPath }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (error) {}
                resolve({ statusCode: response.statusCode, body: parsed });
            });
        });
        request.on("error", reject);
    });
}

function nativeBackend(readProfileSnapshot, writerCounter) {
    function unused() { return Promise.reject(new Error("unused native method")); }
    return {
        readState: unused,
        setBrushValue: unused,
        resetBrushValue: unused,
        adjustBrushValue: unused,
        setCheckbox: unused,
        setRefinementMode: unused,
        setRefinementDisclosure: unused,
        resetRefinement: unused,
        activateFocusRangeAction: unused,
        readProfileSnapshot: readProfileSnapshot,
        selectProfileOption: function () { writerCounter.count += 1; return Promise.resolve(); },
        stop: function () { return Promise.resolve(); }
    };
}

async function serverQueueAndReadbackTests() {
    commands.resetQueueForTests();
    const clock = createClock(2000);
    let selected = "Adobe Color";
    let runtimeLabels = labels.filter(function (label) { return label !== "Artistic 01"; });
    const nativeWrites = { count: 0 };
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        windowsNativeBackend: nativeBackend(async function () { return rawSnapshot(selected, runtimeLabels); }, nativeWrites),
        profileStateOptions: {
            secret: Buffer.alloc(32, 11), refreshIntervalMs: 1, failureThreshold: 3,
            staleAfterMs: 20, writeTimeoutMs: 8000, now: clock.now
        }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    try {
        await requestJson(port, "/context/update?activeModule=develop&selectedPhotoKey=photo-sdk-profile");
        let response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.statusCode, 200);
        runtimeLabels.forEach(function (label) {
            assert.ok(response.body.profile.options.some(function (entry) { return entry.label === label; }),
                "native readback label was removed: " + label);
        });
        assert.deepEqual(response.body.profile.options.map(function (entry) { return entry.label; }), runtimeLabels,
            "the public Profile list must contain native quick options only");
        assert.equal(response.body.profile.options.some(function (entry) {
            return entry.label === "Artistic 01";
        }), false, "Artistic 01 must not be injected when absent from native quick options");
        assert.deepEqual(response.body.profile.options.filter(function (entry) { return entry.writable; })
            .map(function (entry) { return entry.label; }),
        ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Vivid", "Adobe Monochrome"],
        "every supported Profile present in the native list must be writable");
        const token = function (label) {
            return response.body.profile.options.find(function (entry) { return entry.label === label; }).token;
        };

        for (const unsupported of ["Adobe Standard", "Adaptive Color", "Adaptive B&W", "B&W 01", "Camera Standard"]) {
            const rejected = await requestJson(port, "/develop-categorical/profile?token=" + token(unsupported));
            assert.equal(rejected.statusCode, 409, unsupported + " must submit nothing");
            assert.equal(commands.getNextCommand(), null);
        }
        const unknown = await requestJson(port,
            "/develop-categorical/profile?token=profile_ffffffffffffffffffffffff");
        assert.equal(unknown.statusCode, 409);
        assert.equal(commands.getNextCommand(), null);

        let queued = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Vivid"));
        assert.equal(queued.statusCode, 200);
        assert.equal(queued.body.ok, true);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop_categorical.profile.set",
            profile: "Adobe Vivid",
            expectedContextCounter: 1,
            profileGeneration: 1
        });
        const rapid = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Color"));
        assert.equal(rapid.statusCode, 409, "a pending Profile write must reject conflicting submissions");
        assert.equal(commands.getNextCommand(), null);

        selected = "Adobe Vivid";
        runtimeLabels = labels;
        clock.advance(1);
        response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.body.profile.selectedLabel, "Adobe Vivid");
        let validation = await requestJson(port,
            "/develop-categorical/profile-validation?generation=1&profile=Adobe%20Vivid&status=confirmed");
        assert.equal(validation.statusCode, 200);
        queued = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Color"));
        assert.equal(queued.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop_categorical.profile.set",
            profile: "Adobe Color",
            expectedContextCounter: 1,
            profileGeneration: 2
        });
        selected = "Adobe Color";
        clock.advance(1);
        response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.body.profile.selectedLabel, "Adobe Color");
        validation = await requestJson(port,
            "/develop-categorical/profile-validation?generation=2&profile=Adobe%20Color&status=confirmed");
        assert.equal(validation.statusCode, 200);

        queued = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Monochrome"));
        assert.equal(queued.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop_categorical.profile.set",
            profile: "Adobe Monochrome",
            expectedContextCounter: 1,
            profileGeneration: 3
        });
        selected = "Adobe Monochrome";
        clock.advance(1);
        response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.body.profile.selectedLabel, "Adobe Monochrome");
        validation = await requestJson(port,
            "/develop-categorical/profile-validation?generation=3&profile=Adobe%20Monochrome&status=confirmed");
        assert.equal(validation.statusCode, 200);
        assert.equal(nativeWrites.count, 0, "supported SDK Profiles must never call the Windows-native writer");

        await requestJson(port, "/context/update?activeModule=library&selectedPhotoKey=photo-sdk-profile");
        const invalidContext = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Landscape"));
        assert.equal(invalidContext.statusCode, 409);
        assert.equal(commands.getNextCommand(), null);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

function capturedLookAndProductionBoundaryTests() {
    const lua = read("lightroom/LRBridge.lrplugin/Profile.lua");
    const dispatch = read("lightroom/LRBridge.lrplugin/Commands.lua");
    const parser = read("lightroom/LRBridge.lrplugin/Parser.lua");
    const server = read("server/bridge.js") + read("server/profile-native-state.js");
    const nativeJs = read("server/windows-lightroom-native.js");
    const nativePs = read("server/windows-lightroom-native.ps1");
    const controller = read("app/controller.html");
    const helper = read("app/controller-develop-categorical.js");
    const adobe = lua.match(/local function adobeColorLook\(\)([\s\S]*?)\nend/)[1];
    const landscape = lua.match(/local function adobeLandscapeLook\(\)([\s\S]*?)\nend/)[1];
    const portrait = lua.match(/local function adobePortraitLook\(\)([\s\S]*?)\nend/)[1];
    const vivid = lua.match(/local function adobeVividLook\(\)([\s\S]*?)\nend/)[1];
    const monochrome = lua.match(/local function adobeMonochromeLook\(\)([\s\S]*?)\nend/)[1];
    const artistic = lua.match(/local function artistic01Look\(\)([\s\S]*?)\nend/)[1];
    const supported = lua.match(/local supportedProfiles = \{([\s\S]*?)\n\}/)[1];

    for (const [block, expected] of [[adobe, [
        'Amount = 1', 'Copyright = "© 2018 Adobe Systems, Inc."', 'Group = { ["x-default"] = "Profiles" }',
        'Name = "Adobe Color"', 'CameraProfile = "Adobe Standard"', 'ConvertToGrayscale = false',
        'FilterList = {}', 'LookTable = "E1095149FDB39D7A057BAB208837E2E1"', 'PointColors = {}',
        'ProcessVersion = "15.4"', 'ToneCurveName2012 = ""',
        'ToneCurvePV2012 = { 0, 0, 22, 16, 40, 35, 127, 127, 224, 230, 240, 246, 255, 255 }',
        'ToneCurvePV2012Blue = { 0, 0, 255, 255 }', 'ToneCurvePV2012Green = { 0, 0, 255, 255 }',
        'ToneCurvePV2012Red = { 0, 0, 255, 255 }', 'Version = "18.3"', 'SupportsAmount = false',
        'SupportsMonochrome = false', 'SupportsOutputReferred = false',
        'UUID = "B952C231111CD8E0ECCF14B86BAA7077"'
    ]], [landscape, [
        'Amount = 1', 'Copyright = "© 2018 Adobe Systems, Inc."', 'Group = { ["x-default"] = "Profiles" }',
        'Name = "Adobe Landscape"', 'CameraProfile = "Adobe Standard"', 'Clarity2012 = 10',
        'ConvertToGrayscale = false', 'FilterList = {}', 'Highlights2012 = -12',
        'LookTable = "0B3BFB5CFB7DBF7FF175E98F24D316B0"', 'PointColors = {}', 'ProcessVersion = "15.4"',
        'Shadows2012 = 12', 'ToneCurveName2012 = ""',
        'ToneCurvePV2012 = { 0, 0, 64, 60, 128, 128, 192, 196, 255, 255 }',
        'ToneCurvePV2012Blue = {}', 'ToneCurvePV2012Green = {}', 'ToneCurvePV2012Red = {}',
        'Version = "18.3"', 'SupportsAmount = false', 'SupportsMonochrome = false',
        'SupportsOutputReferred = false', 'UUID = "6F9C877E84273F4E8271E6B91BEB36A1"'
    ]], [portrait, [
        'Amount = 1', 'Copyright = "© 2018 Adobe Systems, Inc."', 'Group = { ["x-default"] = "Profiles" }',
        'Name = "Adobe Portrait"', 'CameraProfile = "Adobe Standard"', 'ConvertToGrayscale = false',
        'FilterList = {}', 'LookTable = "E5A76DBB8B3F132A04C01AF45DC2EF1B"', 'PointColors = {}',
        'ProcessVersion = "15.4"', 'ToneCurveName2012 = ""',
        'ToneCurvePV2012 = { 0, 0, 66, 64, 190, 192, 255, 255 }',
        'ToneCurvePV2012Blue = {}', 'ToneCurvePV2012Green = {}', 'ToneCurvePV2012Red = {}',
        'Version = "18.3"', 'SupportsAmount = false', 'SupportsMonochrome = false',
        'SupportsOutputReferred = false', 'UUID = "D6496412E06A83789C499DF9540AA616"'
    ]], [vivid, [
        'Amount = 1', 'Copyright = "© 2018 Adobe Systems, Inc."', 'Group = { ["x-default"] = "Profiles" }',
        'Name = "Adobe Vivid"', 'CameraProfile = "Adobe Standard"', 'Clarity2012 = 10',
        'ConvertToGrayscale = false', 'FilterList = {}',
        'LookTable = "2FE663AB0D3CE5DA7B9F657BBCD66DFE"', 'PointColors = {}', 'ProcessVersion = "15.4"',
        'ToneCurveName2012 = ""',
        'ToneCurvePV2012 = { 0, 0, 32, 22, 64, 56, 128, 128, 224, 232, 240, 246, 255, 255 }',
        'ToneCurvePV2012Blue = {}', 'ToneCurvePV2012Green = {}', 'ToneCurvePV2012Red = {}',
        'Version = "18.3"', 'SupportsAmount = false', 'SupportsMonochrome = false',
        'SupportsOutputReferred = false', 'UUID = "EA1DE074F188405965EF399C72C221D9"'
    ]], [monochrome, [
        'Amount = 1', 'Copyright = "© 2018 Adobe Systems, Inc."', 'Group = { ["x-default"] = "Profiles" }',
        'Name = "Adobe Monochrome"', 'CameraProfile = "Adobe Standard"', 'Clarity2012 = 8',
        'ConvertToGrayscale = true', 'FilterList = {}',
        'LookTable = "73ED6C18DDE909DD7EA2D771F5AC282D"', 'PointColors = {}', 'ProcessVersion = "15.4"',
        'ToneCurveName2012 = ""',
        'ToneCurvePV2012 = { 0, 0, 64, 56, 128, 128, 192, 197, 255, 255 }',
        'ToneCurvePV2012Blue = { 0, 0, 255, 255 }', 'ToneCurvePV2012Green = { 0, 0, 255, 255 }',
        'ToneCurvePV2012Red = { 0, 0, 255, 255 }', 'Version = "18.3"', 'SupportsAmount = false',
        'SupportsMonochrome = false', 'SupportsOutputReferred = false',
        'UUID = "0CFE8F8AB5F63B2A73CE0B0077D20817"'
    ]], [artistic, [
        'Amount = 1', 'Cluster = "Adobe"', 'Copyright = "© 2018 Adobe Systems, Inc."',
        'Group = { ["x-default"] = "Artistic" }', 'Name = "Artistic 01"', 'ConvertToGrayscale = false',
        'FilterList = {}', 'LookTable = "E1095149FDB39D7A057BAB208837E2E1"', 'PointColors = {}',
        'ProcessVersion = "15.4"', 'RGBTable = "BD510A12D9BF555B0328CD473B1392E0"',
        'RGBTableAmount = 0.5', 'Version = "18.3"', 'SupportsMonochrome = false',
        'UUID = "DEA6FAEE53043AC17C1EB384D11F32F7"'
    ]]]) {
        expected.forEach(function (fragment) { assert.ok(block.includes(fragment), "missing captured Look field: " + fragment); });
    }

    for (const mapping of [
        '["Adobe Color"] = { look = adobeColorLook, grayscale = false }',
        '["Adobe Landscape"] = { look = adobeLandscapeLook, grayscale = false }',
        '["Adobe Portrait"] = { look = adobePortraitLook, grayscale = false }',
        '["Adobe Vivid"] = { look = adobeVividLook, grayscale = false }',
        '["Adobe Monochrome"] = { look = adobeMonochromeLook, grayscale = true, includeTreatment = true }',
        '["Artistic 01"] = { look = artistic01Look, grayscale = false }'
    ]) assert.ok(supported.includes(mapping), "missing exact SDK Profile registry mapping: " + mapping);
    assert.doesNotMatch(supported, /Adobe Standard|Adaptive Color|Adaptive B&W|B&W 01/,
        "unproven Profiles must remain outside the SDK write registry");

    assert.equal((lua.match(/applyDevelopSettings\(/g) || []).length, 1, "Profile SDK write must occur exactly once");
    assert.match(lua, /photo:applyDevelopSettings\(\s*payload,\s*"LRBridge: Profile - " \.\. requestedProfile,\s*false\s*\)/);
    const payloadBuilder = lua.match(/local function buildPayload[\s\S]*?\nend/)[0];
    assert.equal(payloadBuilder, [
        "local function buildPayload(definition, before)",
        "    local payload = { Look = definition.look() }",
        "    if definition.includeTreatment or before.ConvertToGrayscale ~= definition.grayscale then",
        "        payload.ConvertToGrayscale = definition.grayscale",
        "    end",
        "    return payload",
        "end"
    ].join("\n"), "the production payload builder must have no additional Profile keys or fallback payloads");
    assert.match(payloadBuilder, /local payload = \{ Look = definition\.look\(\) \}/,
        "every supported Profile payload must start with its complete captured Look only");
    assert.match(payloadBuilder, /payload\.ConvertToGrayscale = definition\.grayscale/,
        "treatment transitions must explicitly set only ConvertToGrayscale alongside Look");
    assert.doesNotMatch(payloadBuilder, /AILook|CameraProfile|getDevelopSettings|before\s*[,}]/,
        "payload construction must never include AI data, CameraProfile, or the complete settings graph");
    assert.doesNotMatch(lua + dispatch + read("server/commands.js"),
        /Profile\.capture|profile\.capture|__TEMP_ProfileCapture/,
        "temporary Profile capture instrumentation must be absent from production");
    assert.match(lua, /local before = photo:getDevelopSettings\(\)/);
    assert.match(lua, /getRawMetadata\("fileFormat"\)[\s\S]*== "VIDEO"/);
    assert.match(lua, /catalog:getTargetPhoto\(\) ~= photo/);
    assert.match(dispatch, /develop_categorical\.profile\.set[\s\S]*Profile\.set\(command\.profile, command\.profileGeneration\)/);
    assert.match(parser, /local profile = string\.match/);
    assert.match(parser, /local profileGeneration = string\.match/);

    for (const target of [
        "Adobe Standard", "Adaptive Color", "Adaptive B&W", "B&W 01", "Unknown", "Adobe Color "
    ]) {
        assert.equal(commands.validateCommand({ command: "develop_categorical.profile.set", profile: target,
            expectedContextCounter: 1, profileGeneration: 1 }), false, target + " must never enter the command queue");
    }
    for (const target of ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Vivid", "Adobe Monochrome", "Artistic 01"]) {
        assert.equal(commands.validateCommand({ command: "develop_categorical.profile.set", profile: target,
            expectedContextCounter: 1, profileGeneration: 1 }), true);
    }
    assert.doesNotMatch(nativeJs + nativePs + server, /selectProfileOption|Select-ProfileOption|\.Pattern\.Select\(\)/,
        "production Profile writing must not retain the Windows-native selection path");
    assert.doesNotMatch(lua, /WM_COMMAND|SendInput|SendKeys|mouse|keyboard|ComboBox/i);
    assert.match(nativePs, /SelectionItemPattern/, "native Profile discovery/readback must remain intact");
    assert.match(helper, /const PROFILE_CONFIRMATION_TIMEOUT_MS = 8000/);
    assert.doesNotMatch(helper + read("server/profile-sdk-registry.js"), /20000|ADAPTIVE_PROFILE_CONFIRMATION_TIMEOUT_MS/,
        "disabled Adaptive Profiles must not advertise a writable confirmation transaction");
    assert.match(controller, /control\.select\.disabled = !presentation\.available \|\| presentation\.pending/);
    assert.match(controller, /option\.writable !== true/);
    assert.match(controller, /profileApplied\.confirmed \|\| profileApplied\.lateConfirmed[\s\S]*delete developCategoricalErrors\.profile/);
    assert.doesNotMatch(controller + helper, /profileCooldown|PROFILE_COOLDOWN_MS|finishCooldown/);
}

Promise.resolve()
    .then(stateRegistryAndAdmissionTests)
    .then(function () { controllerConfirmationTests(); })
    .then(serverQueueAndReadbackTests)
    .then(function () {
        capturedLookAndProductionBoundaryTests();
        console.log("Profile SDK registry, Look-only writes, authoritative confirmation, and readback contracts passed.");
    })
    .catch(function (error) {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
