"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const commands = require("../server/commands");
const maskingDefinition = require("../server/masking-state");
const localAdjustmentPresets = require("../server/local-adjustment-presets");
const { createBridge } = require("../server/bridge");

function get(port, requestPath) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ host: "127.0.0.1", port: port, path: requestPath }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (error) { /* Preserve a null body for the assertion. */ }
                resolve({ status: response.statusCode, body: parsed });
            });
        });
        request.on("error", reject);
    });
}

function fields(overrides) {
    return Object.assign({
        activeModule: "develop",
        selectedPhotoUuid: "preset-parity-photo",
        contextCounter: 1,
        developCounter: 1,
        contextChangedAt: 1000
    }, overrides || {});
}

function snapshot(overrides) {
    return Object.assign({
        available: true,
        unavailableReason: null,
        active: true,
        maskGroupCount: 2,
        hasSelectedMaskGroup: true,
        selectedMaskGroupIndex: 1,
        selectedMaskGroupId: "mask-a",
        selectedMaskGroupName: "Mask A",
        selectedMaskHidden: false,
        previousAvailable: false,
        nextAvailable: true,
        selectedMaskToolAvailable: true,
        selectedMaskToolId: "brush-a",
        selectedMaskToolName: "Brush 1",
        selectedMaskToolType: "brush",
        selectedMaskToolSubtype: null,
        selectedMaskToolHidden: false,
        selectedMaskToolCount: 1,
        selectedMaskToolIndex: 1,
        previousMaskToolAvailable: false,
        nextMaskToolAvailable: false,
        corrections: [{ parameter: "local_Hue", value: 25, min: -180, max: 180 }],
        pointColor: { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false },
        pointColorPresetCollection: null,
        curves: { available: false }
    }, overrides || {});
}

function publish(machine, context, value) {
    machine.requestRefresh(context, true);
    const request = machine.takeRequest();
    assert.ok(request);
    assert.equal(machine.acceptQueryResult(Object.assign({}, request, { snapshot: value }), context), true);
    return machine.getPublicState();
}

function testNoSyntheticPresetIdentity() {
    const context = fields();
    const machine = maskingDefinition.createMaskingState({
        serverEpoch: "mask-preset-parity",
        presetResolver: function () { throw new Error("obsolete value matcher was invoked"); },
        presetIdentityResolver: function () { throw new Error("obsolete provenance cache was invoked"); }
    });
    machine.syncContext(context);

    let state = publish(machine, context, snapshot());
    assert.equal(state.currentPreset, null);
    assert.equal(state.presetIdentityAvailable, false);
    assert.equal(state.presetIdentityReason, "unsupported_sdk");

    state = publish(machine, context, snapshot({
        corrections: [{ parameter: "local_Moire", value: 25, min: 0, max: 100 }]
    }));
    assert.equal(state.currentPreset, null, "Moiré-like values must not become a claimed native label");

    state = publish(machine, context, snapshot({
        selectedMaskGroupIndex: 2,
        selectedMaskGroupId: "mask-b",
        selectedMaskGroupName: "Mask B",
        previousAvailable: true,
        nextAvailable: false,
        selectedMaskToolId: "sky-b",
        selectedMaskToolName: "Sky 1",
        selectedMaskToolType: "sky"
    }));
    assert.equal(state.currentPreset, null, "mask switches must not restore or transfer a cached preset label");
}

async function testPresetInventoryAndAdmission() {
    commands.resetQueueForTests();
    const nativeValues = Object.create(null);
    localAdjustmentPresets.NATIVE_CORRECTION_PRESETS.forEach(function (entry) {
        if (entry.preference) nativeValues[entry.preference] = 0.25;
    });
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40,
        localAdjustmentPresetDirectory: path.join(__dirname, "fixtures", "masking-local-presets"),
        localAdjustmentNativeValues: nativeValues,
        maskingStateOptions: { serverEpoch: "mask-preset-parity-http" }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    try {
        const inventory = await get(port, "/masking/presets");
        assert.equal(inventory.status, 200);
        assert.equal(inventory.body.presets.filter(entry => entry.kind === "builtin").length, 0);
        assert.ok(inventory.body.presets.some(function (entry) { return entry.name === "Burn (Darken)"; }));
        assert.equal(inventory.body.presets.some(function (entry) { return entry.name === "Custom"; }), false);
        assert.equal(inventory.body.presets.every(function (entry) {
            return entry.supported === true && entry.unavailableReason === null;
        }), true);

        const apply = await get(port, "/masking/preset/apply?preset=lp-native-moire");
        assert.equal(apply.status, 400, "a binding-free apply request must be rejected before admission");
        assert.equal((await get(port, "/next")).body.command, null,
            "unsupported preset selection must not enqueue a correction-writing command");
    } finally {
        commands.resetQueueForTests();
        await bridge.stop();
    }
}

function testSourceExclusions() {
    const stateSource = fs.readFileSync(path.join(__dirname, "..", "server", "masking-state.js"), "utf8");
    const inventorySource = fs.readFileSync(
        path.join(__dirname, "..", "server", "local-adjustment-presets.js"), "utf8");
    const controllerSource = fs.readFileSync(path.join(__dirname, "..", "app", "controller-masking.js"), "utf8");
    assert.doesNotMatch(stateSource, /presetResolver|presetIdentityResolver|presetProvenance|presetSnapshotFingerprint/);
    assert.doesNotMatch(inventorySource, /function reconcile\(|fileMatches\(|nativeMatches\(/);
    assert.match(controllerSource, /api\/masking\/preset\/apply/);
    assert.doesNotMatch(controllerSource, /function currentPreset|Current ·|\(edited\)|current preset/);
    assert.match(controllerSource, /Apply Mask Preset…/);
    assert.match(controllerSource, /updatePresetPickerState/);
}

(async function run() {
    testNoSyntheticPresetIdentity();
    await testPresetInventoryAndAdmission();
    testSourceExclusions();
    console.log("Masking preset action inventory, admission validation, and absence of synthetic identity passed.");
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
