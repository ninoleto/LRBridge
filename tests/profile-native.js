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

function rawLabel(selectedLabel) {
    return {
        available: true,
        processId: 15300,
        mainHwnd: 71001,
        comboHwnd: 71002,
        listHwnd: 71003,
        selectedLabel: selectedLabel,
        patterns: { selection: true, expandCollapse: true }
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise(function (resolvePromise, rejectPromise) {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise: promise, resolve: resolve, reject: reject };
}

function createClock(initial) {
    let value = initial;
    return {
        now: function () { return value; },
        advance: function (amount) { value += amount; }
    };
}

function contextUuidIdentityTests() {
    const contextPath = require.resolve("../server/context");
    delete require.cache[contextPath];
    const isolatedContext = require("../server/context");
    let state = isolatedContext.updateContext({
        activeModule: "develop", selectedPhotoKey: "shared-path.dng", selectedPhotoUuid: "uuid-copy-a",
        selectedPhotoPath: "shared-path.dng", developFingerprint: "profile-a"
    });
    assert.equal(state.selectedPhotoKey, "uuid-copy-a", "UUID must be the Lightroom photo-context identity");
    assert.equal(state.selectedPhotoUuid, "uuid-copy-a");
    assert.equal(state.selectedPhotoPath, "shared-path.dng", "the source path must remain separately available");
    const firstCounter = state.contextCounter;
    state = isolatedContext.updateContext({
        activeModule: "develop", selectedPhotoKey: "shared-path.dng", selectedPhotoUuid: "uuid-copy-b",
        selectedPhotoPath: "shared-path.dng", developFingerprint: "profile-b"
    });
    assert.equal(state.contextCounter, firstCounter + 1,
        "virtual copies sharing a path must advance context when their UUID changes");
    assert.equal(state.selectedPhotoKey, "uuid-copy-b");
    state = isolatedContext.updateContext({
        activeModule: "develop", selectedPhotoKey: "fallback-path.dng", selectedPhotoUuid: "",
        selectedPhotoPath: "fallback-path.dng", developFingerprint: "profile-c"
    });
    assert.equal(state.selectedPhotoKey, "fallback-path.dng", "path must remain the identity fallback without UUID");
    assert.equal(state.selectedPhotoUuid, null);
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
        ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Standard", "Adobe Vivid",
            "Adobe Monochrome", "Artistic 01"]);
    assert.deepEqual(profileRegistry.authoritativeReadOnlyProfiles,
        ["Adaptive Color", "Adaptive B&W"]);
    assert.deepEqual(state.options.filter(function (option) { return option.writable; }).map(function (option) {
        return option.label;
    }), ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Standard", "Adobe Vivid",
        "Artistic 01", "Adobe Monochrome"],
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
    for (const unsupported of ["Adaptive Color", "Adaptive B&W", "B&W 01", "Camera Standard"]) {
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
        option("Adobe Landscape", 2, true), option("Adobe Portrait", 3, true), option("Adobe Standard", 4, true),
        option("Adobe Vivid", 5, true), option("Adaptive Color", 6, false),
        option("Adaptive B&W", 7, false), option("B&W 01", 8, false)];
    function state(revision, selectedLabel, validationGeneration, validationFailedGeneration) {
        const selected = options.find(function (entry) { return entry.label === selectedLabel; });
        return {
            available: true, updating: false, reason: null, revision: revision, optionSnapshotRevision: 1,
            contextCounter: 4, processId: 15300, browsePosition: 12, browseLabel: "Browse...",
            photoKey: "photo-uuid-4", photoUuid: "photo-uuid-4",
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

async function profileContextLatencyTests() {
    const clock = createClock(5000);
    const latePhotoALabel = deferred();
    const latePhotoA = deferred();
    const firstPhotoBInventory = deferred();
    const secondPhotoBInventory = deferred();
    let snapshotRead = 0;
    let labelRead = 0;
    let nativeLabel = "Adobe Color";
    const backend = {
        readProfileLabel: function () {
            labelRead += 1;
            if (labelRead === 1) return latePhotoALabel.promise;
            return Promise.resolve(rawLabel(nativeLabel));
        },
        readProfileSnapshot: function () {
            snapshotRead += 1;
            if (snapshotRead === 1) return latePhotoA.promise;
            if (snapshotRead === 2) return firstPhotoBInventory.promise;
            if (snapshotRead === 3) return secondPhotoBInventory.promise;
            return Promise.resolve(rawSnapshot("Adobe Portrait"));
        }
    };
    const profile = profileDefinition.createProfileNativeState(backend, {
        secret: Buffer.alloc(32, 13), refreshIntervalMs: 1, failureThreshold: 3,
        staleAfterMs: 20, writeTimeoutMs: 8000, now: clock.now
    });

    function binding(contextCounter, uuid, previousDevelopCounter, developCounter, contextChangedAt, developChangedAt) {
        return {
            contextCounter: contextCounter,
            selectedPhotoKey: uuid,
            selectedPhotoUuid: uuid,
            contextChangedAt: contextChangedAt,
            previousDevelopCounter: previousDevelopCounter,
            developCounter: developCounter,
            developChangedAt: developChangedAt
        };
    }
    function feedback(contextCounter, uuid, developCounter, label, source) {
        return {
            contextCounter: contextCounter,
            selectedPhotoKey: uuid,
            selectedPhotoUuid: uuid,
            developCounter: developCounter,
            label: label,
            source: source
        };
    }

    assert.equal(profile.syncContext(binding(6, "uuid-photo-a", 0, 1, 100, 100)), true);
    assert.equal(profile.observeSdkProfile(feedback(6, "uuid-photo-a", 1, "Adobe Color", "Look.Name")), true);
    let state = profile.get();
    assert.equal(state.selectedLabel, "Adobe Color");
    assert.equal(state.available, false, "SDK label publication must not manufacture UIA inventory tokens");
    const staleLabelRead = profile.refreshContextLabel();
    const staleRead = profile.refresh(true);

    assert.equal(profile.syncContext(binding(7, "uuid-photo-b", 1, 1, 200, 100)), true,
        "a virtual-copy UUID change must create a new Profile context even when the source path is shared");
    state = profile.get();
    assert.equal(state.contextCounter, 7);
    assert.equal(state.photoUuid, "uuid-photo-b");
    assert.equal(state.updating, true);
    assert.equal(state.selectedLabel, null,
        "photo A's displayed Profile must disappear synchronously with the context change");
    assert.equal(state.available, false);

    latePhotoALabel.resolve(rawLabel("Adobe Color"));
    latePhotoA.resolve(rawSnapshot("Adobe Color"));
    await Promise.all([staleLabelRead, staleRead]);
    assert.notEqual(profile.get().selectedLabel, "Adobe Color",
        "late UIA label/inventory responses captured for photo A must not repopulate photo A's Profile in photo B's context");
    assert.equal(profile.observeSdkProfile(feedback(6, "uuid-photo-a", 1, "Adobe Color", "Look.Name")), false,
        "a late SDK response from photo A must fail its UUID/context binding");
    assert.equal(profile.observeSdkProfile(feedback(7, "uuid-photo-b", 1, "Adobe Color", "Look.Name")), false,
        "the first stale SDK Profile must not publish before Develop advances for photo B");
    await profile.refreshContextLabel();
    assert.equal(profile.get().selectedLabel, null,
        "an initially stale UIA label must not bypass the unresolved Develop gate");

    assert.equal(profile.syncContext(binding(7, "uuid-photo-b", 1, 2, 200, 220)), false);
    assert.equal(profile.observeSdkProfile(feedback(7, "uuid-photo-b", 2, "Adobe Portrait", "Look.Name")), true,
        "the correct SDK Profile must publish as soon as the new UUID's Develop state advances");
    state = profile.get();
    assert.equal(state.contextCounter, 7);
    assert.equal(state.selectedLabel, "Adobe Portrait",
        "photo B's SDK label must publish before its option inventory completes");
    assert.equal(state.updating, false);
    assert.equal(state.available, false,
        "the Profile inventory must remain unavailable while its first photo B snapshot is pending");
    assert.deepEqual(state.options, []);

    const firstInventoryRead = profile.refresh(true);
    firstPhotoBInventory.resolve(rawSnapshot("Adobe Color"));
    await firstInventoryRead;
    state = profile.get();
    assert.equal(state.selectedLabel, "Adobe Portrait");
    assert.equal(state.available, false,
        "a stale UIA inventory must not override the UUID-bound SDK label or unlock the dropdown");
    assert.deepEqual(state.options, []);

    const secondInventoryRead = profile.refresh(true);
    secondPhotoBInventory.resolve(rawSnapshot("Adobe Portrait"));
    state = await secondInventoryRead;
    assert.equal(state.available, false,
        "one matching photo B inventory sample must not unlock the Profile dropdown");
    state = await profile.refresh(true);
    assert.equal(state.available, true,
        "two matching photo B inventory samples must unlock the Profile dropdown");
    assert.ok(state.options.length > 0);
    assert.equal(profile.syncContext(binding(7, "uuid-photo-b", 1, 3, 200, 230)), false);
    assert.equal(profile.observeSdkProfile(feedback(7, "uuid-photo-b", 3, "Adobe Standard", "CameraProfile")), true,
        "CameraProfile fallback feedback must use the same UUID/Develop gate");
    assert.equal(profile.syncContext(binding(7, "uuid-photo-b", 1, 4, 200, 240)), false);
    assert.equal(profile.observeSdkProfile(feedback(7, "uuid-photo-b", 4, "Adaptive Color", "AILook")), true,
        "active AILook feedback must use the same UUID/Develop gate");
    assert.equal(profile.get().selectedLabel, "Adaptive Color");
    assert.equal(profile.get().available, false,
        "each SDK label change must independently restabilize UIA inventory");

    function controllerOption(label, position) {
        return { token: "profile_" + String(position + 1).padStart(24, "0"), label: label,
            position: position, enabled: true, writable: true };
    }
    function controllerState(contextCounter, revision, selectedLabel, available) {
        const options = [controllerOption("Adobe Color", 0), controllerOption("Adobe Portrait", 1)];
        const selected = options.find(function (option) { return option.label === selectedLabel; });
        if (available === false) {
            return {
                available: false, updating: false, reason: "Profile options are updating", revision: revision,
                optionSnapshotRevision: 1, contextCounter: contextCounter,
                photoKey: "photo-uuid-" + contextCounter, photoUuid: "photo-uuid-" + contextCounter,
                processId: null, browsePosition: null, browseLabel: null, selectedToken: null,
                selectedLabel: selectedLabel, validationGeneration: 0, validationFailedGeneration: 0, options: []
            };
        }
        return {
            available: true, updating: false, reason: null, revision: revision, optionSnapshotRevision: 1,
            contextCounter: contextCounter, processId: 15300, browsePosition: 12, browseLabel: "Browse...",
            photoKey: "photo-uuid-" + contextCounter, photoUuid: "photo-uuid-" + contextCounter,
            selectedToken: selected.token, selectedLabel: selected.label,
            validationGeneration: 0, validationFailedGeneration: 0, options: options
        };
    }
    const model = controllerDefinition.createProfileModel();
    assert.equal(model.apply(controllerState(6, 20, "Adobe Color")).accepted, true);
    assert.equal(model.beginContext(7, "photo-uuid-7", "photo-uuid-7"), true);
    let presentation = model.presentation();
    assert.equal(presentation.updating, true);
    assert.equal(presentation.authoritativeLabel, null,
        "browser context invalidation must synchronously remove photo A's label");
    assert.equal(model.apply(controllerState(6, 21, "Adobe Color")).accepted, false,
        "the browser model must reject a late response from photo A");
    assert.equal(model.apply(controllerState(7, 22, "Adobe Portrait", false)).accepted, true);
    presentation = model.presentation();
    assert.equal(presentation.authoritativeLabel, "Adobe Portrait");
    assert.equal(presentation.inventoryStable, false,
        "photo B's label must not make its incomplete option inventory writable");
    assert.deepEqual(presentation.options, []);
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

function nativeBackend(readProfileSnapshot, writerCounter, readProfileLabel) {
    function unused() { return Promise.reject(new Error("unused native method")); }
    const backend = {
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
    if (typeof readProfileLabel === "function") backend.readProfileLabel = readProfileLabel;
    return backend;
}

async function serverQueueAndReadbackTests() {
    commands.resetQueueForTests();
    const clock = createClock(2000);
    let selected = "Adobe Color";
    let runtimeLabels = labels.filter(function (label) { return label !== "Artistic 01"; });
    const nativeWrites = { count: 0 };
    let profileLabelReads = 0;
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        windowsNativeBackend: nativeBackend(
            async function () { return rawSnapshot(selected, runtimeLabels); },
            nativeWrites,
            async function () { profileLabelReads += 1; return rawLabel(selected); }
        ),
        profileStateOptions: {
            secret: Buffer.alloc(32, 11), refreshIntervalMs: 1, failureThreshold: 3,
            staleAfterMs: 20, writeTimeoutMs: 8000, now: clock.now
        }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    try {
        const initialContext = await requestJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-sdk-profile" +
            "&selectedPhotoUuid=uuid-sdk-profile&selectedPhotoPath=shared-profile.dng" +
            "&developFingerprint=profile-adobe-color");
        const profileContextCounter = initialContext.body.contextCounter;
        let response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.statusCode, 200);
        assert.ok(profileLabelReads >= 1,
            "a Lightroom photo-context change must immediately request a fresh Profile label");
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
        ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Standard", "Adobe Vivid", "Adobe Monochrome"],
        "every supported Profile present in the native list must be writable");
        const token = function (label) {
            return response.body.profile.options.find(function (entry) { return entry.label === label; }).token;
        };

        for (const unsupported of ["Adaptive Color", "Adaptive B&W", "B&W 01", "Camera Standard"]) {
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
            expectedContextCounter: profileContextCounter,
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
            expectedContextCounter: profileContextCounter,
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
            expectedContextCounter: profileContextCounter,
            profileGeneration: 3
        });
        selected = "Adobe Monochrome";
        clock.advance(1);
        response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.body.profile.selectedLabel, "Adobe Monochrome");
        validation = await requestJson(port,
            "/develop-categorical/profile-validation?generation=3&profile=Adobe%20Monochrome&status=confirmed");
        assert.equal(validation.statusCode, 200);

        queued = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Standard"));
        assert.equal(queued.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop_categorical.profile.set",
            profile: "Adobe Standard",
            expectedContextCounter: profileContextCounter,
            profileGeneration: 4
        });
        selected = "Adobe Standard";
        clock.advance(1);
        response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.body.profile.selectedLabel, "Adobe Standard");
        validation = await requestJson(port,
            "/develop-categorical/profile-validation?generation=4&profile=Adobe%20Standard&status=confirmed");
        assert.equal(validation.statusCode, 200);
        assert.equal(nativeWrites.count, 0, "supported SDK Profiles must never call the Windows-native writer");

        await requestJson(port,
            "/context/update?activeModule=library&selectedPhotoKey=uuid-sdk-profile" +
            "&selectedPhotoUuid=uuid-sdk-profile&selectedPhotoPath=shared-profile.dng&developFingerprint=");
        const invalidContext = await requestJson(port, "/develop-categorical/profile?token=" + token("Adobe Landscape"));
        assert.equal(invalidContext.statusCode, 409);
        assert.equal(commands.getNextCommand(), null);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

async function serverEarlyLabelPublicationTests() {
    commands.resetQueueForTests();
    const inventory = deferred();
    const nativeWrites = { count: 0 };
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        windowsNativeBackend: nativeBackend(
            function () { return inventory.promise; },
            nativeWrites,
            async function () { return rawLabel("Adobe Portrait"); }
        ),
        profileStateOptions: {
            secret: Buffer.alloc(32, 17), refreshIntervalMs: 750, failureThreshold: 3,
            staleAfterMs: 15000, writeTimeoutMs: 8000
        }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    try {
        const contextResponse = await requestJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-profile-latency" +
            "&selectedPhotoUuid=uuid-profile-latency&selectedPhotoPath=shared-latency.dng" +
            "&developFingerprint=settled-profile-portrait");
        const feedback = await requestJson(port,
            "/develop-categorical/profile-feedback?contextCounter=" + contextResponse.body.contextCounter +
            "&developCounter=" + contextResponse.body.developCounter +
            "&selectedPhotoKey=uuid-profile-latency&selectedPhotoUuid=uuid-profile-latency" +
            "&label=Adobe%20Portrait&source=Look.Name");
        assert.equal(feedback.statusCode, 200);
        const response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.profile.selectedLabel, "Adobe Portrait",
            "the Profile state endpoint must publish valid SDK feedback without awaiting inventory");
        assert.equal(response.body.profile.updating, false);
        assert.equal(response.body.profile.available, false,
            "the Profile state endpoint must keep an incomplete inventory locked");
        assert.deepEqual(response.body.profile.options, []);
        assert.equal(response.body.profile.photoUuid, "uuid-profile-latency");
        inventory.resolve(rawSnapshot("Adobe Portrait"));
        await new Promise(function (resolve) { setImmediate(resolve); });
    } finally {
        inventory.resolve(rawSnapshot("Adobe Portrait"));
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

async function serverSdkFeedbackBindingTests() {
    commands.resetQueueForTests();
    let selected = "Adobe Color";
    const nativeWrites = { count: 0 };
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        windowsNativeBackend: nativeBackend(
            async function () { return rawSnapshot(selected); },
            nativeWrites,
            async function () { return rawLabel(selected); }
        ),
        profileStateOptions: {
            secret: Buffer.alloc(32, 19), refreshIntervalMs: 1, failureThreshold: 3,
            staleAfterMs: 20, writeTimeoutMs: 8000
        }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    function feedbackPath(contextState, uuid, label, source) {
        return "/develop-categorical/profile-feedback?contextCounter=" + contextState.contextCounter +
            "&developCounter=" + contextState.developCounter + "&selectedPhotoKey=" + uuid +
            "&selectedPhotoUuid=" + uuid + "&label=" + encodeURIComponent(label) + "&source=" + source;
    }
    try {
        const photoA = (await requestJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-copy-a" +
            "&selectedPhotoUuid=uuid-copy-a&selectedPhotoPath=shared-virtual-copy.dng" +
            "&developFingerprint=settled-adobe-color")).body;
        assert.equal((await requestJson(port, feedbackPath(photoA, "uuid-copy-a", "Adobe Color", "Look.Name")))
            .statusCode, 200);

        const photoBStale = (await requestJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-copy-b" +
            "&selectedPhotoUuid=uuid-copy-b&selectedPhotoPath=shared-virtual-copy.dng" +
            "&developFingerprint=settled-adobe-color")).body;
        assert.equal(photoBStale.contextCounter, photoA.contextCounter + 1,
            "a UUID change on the same source path must advance the server context");
        let response = await requestJson(port, feedbackPath(photoA, "uuid-copy-a", "Adobe Color", "Look.Name"));
        assert.equal(response.statusCode, 409, "late feedback from the previous UUID/context must be rejected");
        response = await requestJson(port, feedbackPath(photoBStale, "uuid-copy-b", "Adobe Color", "Look.Name"));
        assert.equal(response.statusCode, 409,
            "an initially stale SDK Profile must remain unresolved without a new Develop revision");
        response = await requestJson(port, "/develop-categorical/state");
        assert.equal(response.body.profile.updating, true);
        assert.equal(response.body.profile.selectedLabel, null);

        selected = "Adobe Portrait";
        const photoBSettled = (await requestJson(port,
            "/context/update?activeModule=develop&selectedPhotoKey=uuid-copy-b" +
            "&selectedPhotoUuid=uuid-copy-b&selectedPhotoPath=shared-virtual-copy.dng" +
            "&developFingerprint=settled-adobe-portrait")).body;
        assert.equal(photoBSettled.contextCounter, photoBStale.contextCounter);
        assert.equal(photoBSettled.developCounter, photoBStale.developCounter + 1);
        response = await requestJson(port,
            feedbackPath(photoBSettled, "uuid-copy-b", "Adobe Portrait", "Look.Name"));
        assert.equal(response.statusCode, 200,
            "valid SDK feedback must publish immediately after Develop advances for the bound UUID");
        assert.equal(response.body.profile.selectedLabel, "Adobe Portrait");
        assert.equal(response.body.profile.available, false,
            "SDK feedback must leave UIA inventory and dropdown tokens independently locked");
        assert.deepEqual(response.body.profile.options, []);
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
    const feedbackPolling = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
    const nativeDiscovery = nativePs.match(
        /function Get-ProfileDiscovery[\s\S]*?(?=\nfunction ConvertTo-ProfileLabelSnapshot)/)[0];
    const adobe = lua.match(/local function adobeColorLook\(\)([\s\S]*?)\nend/)[1];
    const landscape = lua.match(/local function adobeLandscapeLook\(\)([\s\S]*?)\nend/)[1];
    const portrait = lua.match(/local function adobePortraitLook\(\)([\s\S]*?)\nend/)[1];
    const vivid = lua.match(/local function adobeVividLook\(\)([\s\S]*?)\nend/)[1];
    const monochrome = lua.match(/local function adobeMonochromeLook\(\)([\s\S]*?)\nend/)[1];
    const artistic = lua.match(/local function artistic01Look\(\)([\s\S]*?)\nend/)[1];
    const standardTombstone = lua.match(/local function adobeStandardLookTombstone\(\)([\s\S]*?)\nend/)[1];
    const supported = lua.match(/local supportedProfiles = \{([\s\S]*?)\n\}/)[1];
    const unchanged = lua.match(/local function unchangedOutsideProfile[\s\S]*?\nend/)[0];
    const desired = lua.match(/local function desiredState[\s\S]*?\nend/)[0];

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
    assert.equal(standardTombstone.trim(), "return {}",
        "Adobe Standard must use the proven empty Look tombstone and no reconstructed profile data");
    assert.match(supported,
        /\["Adobe Standard"\] = \{[\s\S]*?look = adobeStandardLookTombstone,[\s\S]*?lookAbsent = true,[\s\S]*?cameraProfile = "Adobe Standard",[\s\S]*?grayscale = false[\s\S]*?\}/,
        "Adobe Standard must bind the tombstone to color treatment and strict SDK confirmation metadata");
    assert.doesNotMatch(supported, /Adaptive Color|Adaptive B&W|B&W 01/,
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
        "every supported Profile payload must start with its complete captured Look or proven empty tombstone only");
    assert.match(payloadBuilder, /payload\.ConvertToGrayscale = definition\.grayscale/,
        "treatment transitions must explicitly set only ConvertToGrayscale alongside Look");
    assert.doesNotMatch(payloadBuilder, /AILook|CameraProfile|getDevelopSettings|before\s*[,}]/,
        "payload construction must never include AI data, CameraProfile, or the complete settings graph");
    assert.match(desired, /definition\.cameraProfile ~= nil and settings\.CameraProfile ~= definition\.cameraProfile/,
        "Adobe Standard confirmation must require the authoritative CameraProfile value");
    assert.match(desired, /definition\.lookAbsent[\s\S]*settings\.Look ~= nil/,
        "Adobe Standard confirmation must require complete Look absence");
    assert.match(desired, /settings\.AILook == nil[\s\S]*type\(settings\.AILook\) == "table"[\s\S]*settings\.AILook\.Active ~= true/,
        "Profile confirmation must require AILook to be absent or explicitly inactive");
    assert.match(unchanged, /key == "Look" or key == "AILook"/);
    assert.match(unchanged, /treatmentChanges and treatmentKey\(key\)/,
        "only Profile state and an actual color\/B&W treatment transition may differ");
    assert.match(lua, /if not unchangedOutsideProfile\(before, current, definition\) then[\s\S]*An unrelated Develop setting changed/,
        "every validation poll must reject unrelated Develop-setting changes");
    assert.doesNotMatch(lua, /LrDevelopController|setValue\s*\(\s*"CameraProfile"/,
        "Adobe Standard must never use the failed CameraProfile setter path");
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
        "Adaptive Color", "Adaptive B&W", "B&W 01", "Unknown", "Adobe Color "
    ]) {
        assert.equal(commands.validateCommand({ command: "develop_categorical.profile.set", profile: target,
            expectedContextCounter: 1, profileGeneration: 1 }), false, target + " must never enter the command queue");
    }
    for (const target of ["Adobe Color", "Adobe Landscape", "Adobe Portrait", "Adobe Standard", "Adobe Vivid",
        "Adobe Monochrome", "Artistic 01"]) {
        assert.equal(commands.validateCommand({ command: "develop_categorical.profile.set", profile: target,
            expectedContextCounter: 1, profileGeneration: 1 }), true);
    }
    assert.doesNotMatch(nativeJs + nativePs + server, /selectProfileOption|Select-ProfileOption|\.Pattern\.Select\(\)/,
        "production Profile writing must not retain the Windows-native selection path");
    assert.match(nativeDiscovery, /ControlViewWalker[\s\S]*Browse…?[\s\S]*FindFirst/,
        "Profile discovery must start from the bound Browse item and walk only its list siblings");
    assert.doesNotMatch(nativeDiscovery, /\.FindAll\(/,
        "Profile discovery must not restore the slow desktop-wide full snapshot traversal");
    assert.match(nativeDiscovery, /browseRuntimeId[\s\S]*comboHandle[\s\S]*listRuntimeId/,
        "Browse-first discovery must retain exact ComboBox and list runtime-ID binding");
    assert.match(nativeJs, /const background = operation === "readState";/,
        "full Profile inventory reads must outrank generic native-state polling after a photo-context change");
    assert.doesNotMatch(lua, /WM_COMMAND|SendInput|SendKeys|mouse|keyboard|ComboBox/i);
    assert.match(nativePs, /SelectionItemPattern/, "native Profile discovery/readback must remain intact");
    assert.match(helper, /const PROFILE_CONFIRMATION_TIMEOUT_MS = 8000/);
    assert.doesNotMatch(helper + read("server/profile-sdk-registry.js"), /20000|ADAPTIVE_PROFILE_CONFIRMATION_TIMEOUT_MS/,
        "disabled Adaptive Profiles must not advertise a writable confirmation transaction");
    assert.match(controller, /control\.select\.disabled = !presentation\.inventoryStable \|\| presentation\.pending/);
    assert.match(controller, /control\.select\.value = presentation\.authoritativeToken \|\| ""/,
        "pending Profile writes must keep the latest authoritative label instead of showing an optimistic target");
    assert.match(controller, /presentation\.updating[\s\S]*Updating Profile…/,
        "the Web Controller must show an explicit context-refresh state");
    assert.match(controller, /data\.profile\.contextCounter === lastControllerContextCounter/,
        "the Web Controller must reject stale Profile responses from an earlier photo context");
    assert.match(controller, /data\.profile\.photoUuid === lastControllerSelectedPhotoUuid/,
        "the Web Controller must bind Profile responses to the Lightroom photo UUID");
    assert.match(feedbackPolling, /getRawMetadata\("uuid"\)[\s\S]*getRawMetadata\("path"\)/,
        "the Lightroom heartbeat must use UUID identity while preserving the source path");
    assert.match(feedbackPolling, /local key = uuid ~= "" and uuid or photoPath/,
        "the source path must be the only selected-photo identity fallback when UUID is unavailable");
    assert.doesNotMatch(feedbackPolling, /key\s*=\s*tostring\(photo\)/,
        "a Lightroom object string must not replace the UUID/path photo identity contract");
    assert.match(feedbackPolling, /local contextIntervalSeconds = 0\.75/,
        "Profile feedback must retain the existing global context polling frequency");
    assert.match(feedbackPolling, /settings\.AILook\.Active == true[\s\S]*source = "AILook"[\s\S]*source = "Look\.Name"[\s\S]*source = "CameraProfile"/,
        "SDK Profile derivation must prefer active AILook, then Look.Name, then CameraProfile");
    assert.match(feedbackPolling, /ProfileState=[\s\S]*developFingerprint/,
        "the existing Develop fingerprint must include the SDK Profile graph signal");
    assert.match(feedbackPolling, /develop-categorical\/profile-feedback[\s\S]*contextCounter[\s\S]*developCounter[\s\S]*selectedPhotoUuid/,
        "SDK Profile feedback must carry UUID, context, and Develop revision bindings");
    assert.match(server, /contextDevelopReady[\s\S]*input\.developCounter <= contextDevelopBaseline/,
        "the server must reject SDK Profile feedback until Develop advances for the new context");
    assert.doesNotMatch(server, /PROFILE.*DELAY|setTimeout\([^)]*profile|sdkProfileStableReads/i,
        "SDK Profile admission must not use a fixed delay or repeated-identical-sample heuristic");
    assert.match(nativeJs, /readProfileLabel/);
    assert.match(nativePs, /readProfileLabel/);
    assert.match(controller, /option\.writable !== true/);
    assert.match(controller, /profileApplied\.confirmed \|\| profileApplied\.lateConfirmed[\s\S]*delete developCategoricalErrors\.profile/);
    assert.doesNotMatch(controller + helper, /profileCooldown|PROFILE_COOLDOWN_MS|finishCooldown/);
}

Promise.resolve()
    .then(function () { contextUuidIdentityTests(); })
    .then(stateRegistryAndAdmissionTests)
    .then(function () { controllerConfirmationTests(); })
    .then(profileContextLatencyTests)
    .then(serverQueueAndReadbackTests)
    .then(serverEarlyLabelPublicationTests)
    .then(serverSdkFeedbackBindingTests)
    .then(function () {
        capturedLookAndProductionBoundaryTests();
        console.log("Profile SDK registry, Look-only writes, authoritative confirmation, and readback contracts passed.");
    })
    .catch(function (error) {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
