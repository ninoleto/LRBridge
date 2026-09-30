"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const commands = require("../server/commands");
const maskingDefinition = require("../server/masking-state");
const maskingCorrections = require("../app/controller-masking-corrections");
const maskingUi = require("../app/controller-masking");
const localPresets = require("../server/local-adjustment-presets");

const root = path.join(__dirname, "..");

function context(overrides) {
    return Object.assign({
        activeModule: "develop",
        selectedPhotoUuid: "photo-phase4",
        contextCounter: 9,
        developCounter: 14,
        contextChangedAt: 2000
    }, overrides || {});
}

function pointColor(overrides) {
    const range = { LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9 };
    return Object.assign({
        available: true,
        swatchCount: 2,
        selectedIndex: 1,
        selectionTransient: false,
        HueShift: 0,
        SatScale: 0,
        LumScale: 0,
        Variance: 0,
        RangeAmount: 0.5,
        HueRange: Object.assign({}, range),
        SatRange: Object.assign({}, range),
        LumRange: Object.assign({}, range),
        HueRangeMarker: 0.5,
        SatRangeMarker: 0.5,
        LumRangeMarker: 0.5
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
        selectedMaskHidden: false,
        previousAvailable: false,
        nextAvailable: true,
        selectedMaskToolAvailable: true,
        selectedMaskToolId: "brush-a",
        selectedMaskToolHidden: false,
        selectedMaskToolCount: 2,
        selectedMaskToolIndex: 1,
        previousMaskToolAvailable: false,
        nextMaskToolAvailable: true,
        corrections: [{ parameter: "local_RefineSaturation", value: 0, min: -100, max: 100 }],
        pointColor: pointColor(),
        curves: {
            available: true,
            rgb: [0, 0, 255, 255],
            red: [0, 0, 255, 255],
            green: [0, 0, 255, 255],
            blue: [0, 0, 255, 255]
        }
    }, overrides || {});
}

function emptySnapshot() {
    return snapshot({
        maskGroupCount: 0,
        hasSelectedMaskGroup: false,
        selectedMaskGroupIndex: null,
        selectedMaskGroupId: null,
        selectedMaskHidden: null,
        previousAvailable: false,
        nextAvailable: false,
        selectedMaskToolAvailable: false,
        selectedMaskToolId: null,
        selectedMaskToolHidden: null,
        selectedMaskToolCount: null,
        selectedMaskToolIndex: null,
        previousMaskToolAvailable: false,
        nextMaskToolAvailable: false,
        corrections: [],
        pointColor: { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false },
        curves: { available: false }
    });
}

function selectedSnapshot(overrides) {
    return snapshot(Object.assign({
        selectedMaskGroupIndex: 2,
        selectedMaskGroupId: "mask-b",
        previousAvailable: true,
        nextAvailable: false,
        selectedMaskToolId: "brush-b",
        selectedMaskToolCount: 1,
        selectedMaskToolIndex: 1,
        previousMaskToolAvailable: false,
        nextMaskToolAvailable: false
    }, overrides || {}));
}

function hydrate(initialSnapshot, options) {
    let now = 1000;
    const ctx = context(options && options.context);
    const state = maskingDefinition.createMaskingState({ serverEpoch: "mask-phase4", now: function () { return now; } });
    assert.equal(state.requestRefresh(ctx, true), true);
    const request = state.takeRequest();
    assert.ok(request);
    assert.equal(state.acceptQueryResult(Object.assign({}, request, { snapshot: initialSnapshot }), ctx), true);
    return {
        state: state,
        ctx: ctx,
        tick: function (amount) { now += amount; },
        binding: function () {
            const value = state.getPublicState();
            return {
                serverEpoch: value.serverEpoch,
                revision: value.revision,
                selectedPhotoUuid: value.selectedPhotoUuid,
                contextCounter: value.contextCounter,
                developCounter: value.developCounter,
                contextChangedAt: value.contextChangedAt
            };
        },
        publish: function (nextSnapshot) {
            assert.equal(state.requestRefresh(ctx, true), true);
            const nextRequest = state.takeRequest();
            assert.ok(nextRequest);
            assert.equal(state.acceptQueryResult(Object.assign({}, nextRequest, { snapshot: nextSnapshot }), ctx), true);
        }
    };
}

function operationResult(command, resultSnapshot, outcome) {
    return {
        operationId: command.operationId,
        expectedActiveModule: command.expectedActiveModule,
        expectedSelectedPhotoUuid: command.expectedSelectedPhotoUuid,
        expectedContextCounter: command.expectedContextCounter,
        expectedDevelopCounter: command.expectedDevelopCounter,
        expectedContextChangedAt: command.expectedContextChangedAt,
        expectedServerEpoch: command.expectedServerEpoch,
        expectedMaskingRevision: command.expectedMaskingRevision,
        outcome: outcome || "confirmed",
        detail: "",
        snapshot: resultSnapshot
    };
}

function presetDiagnostics(command, outcome, pointColorPresent) {
    const pointColorLine = pointColorPresent === false
        ? "preset-settlement-value parameter=local_PointColors kind=pointColors source=absent applied=false " +
            "preserved=<not-written> authoritative=<not-settled> baseline-count=2 baseline-selection=1 " +
            "authoritative-selection=<not-settled> comparison=absent/preserved/not-settled"
        : "preset-settlement-value parameter=local_PointColors kind=pointColors source=present applied=true " +
            "expected={1={HueShift=0.2}} authoritative={1={HueShift=0.2}} baseline-count=2 baseline-selection=1 " +
            "authoritative-selection=1 comparison=present/applied/confirmed";
    return "preset-settlement operation=" + command.operationId + " preset=" + command.preset +
        " file=" + command.presetFile + " photo=" + command.expectedSelectedPhotoUuid +
        " mask=" + command.expectedSelectedMaskId + " component-before=brush-a component-after=brush-a" +
        " context=" + command.expectedContextCounter + " develop=" + command.expectedDevelopCounter +
        " masking=" + command.expectedMaskingRevision + " epoch=" + command.expectedServerEpoch +
        " result=" + outcome + " applied=13 preserved=14\n" + pointColorLine + "\n" +
        "preset-settlement-result ok=" + String(outcome === "confirmed") + " kind=" + outcome + " detail=";
}

function editResult(command, resultSnapshot, outcome) {
    return {
        editSequence: command.editSequence,
        kind: command.command,
        expectedSelectedMaskId: command.expectedSelectedMaskId,
        expectedActiveModule: command.expectedActiveModule,
        expectedSelectedPhotoUuid: command.expectedSelectedPhotoUuid,
        expectedContextCounter: command.expectedContextCounter,
        expectedDevelopCounter: command.expectedDevelopCounter,
        expectedContextChangedAt: command.expectedContextChangedAt,
        expectedServerEpoch: command.expectedServerEpoch,
        outcome: outcome || "confirmed",
        detail: "",
        snapshot: resultSnapshot
    };
}

function testCorrectionOrganization() {
    const detail = maskingCorrections.definitions.filter(function (definition) {
        return definition.group === "Detail";
    }).map(function (definition) { return definition.label; });
    assert.deepEqual(detail, ["Sharpness", "Noise Reduction", "Moiré", "Defringe"]);
    const effects = maskingCorrections.definitions.filter(function (definition) {
        return definition.group === "Effects";
    }).map(function (definition) { return definition.parameter; });
    assert.ok(effects.includes("local_Grain"));
    assert.equal(effects.includes("local_Moire"), false);
    assert.equal(effects.includes("local_Defringe"), false);
    assert.equal(maskingCorrections.byParameter.local_RefineSaturation.group, "Tone Curve");
    assert.deepEqual(maskingCorrections.definitions.filter(function (definition) {
        return definition.parameter.indexOf("local_Toning") === 0;
    }), [], "Toning Hue, Saturation, and Luminance must not be visible Masking rows");
    assert.ok(maskingCorrections.supportedDefinitions.some(function (definition) {
        return definition.parameter === "local_ToningHue";
    }), "legacy preset/runtime Toning Hue compatibility must remain internal");
    assert.ok(maskingCorrections.supportedDefinitions.some(function (definition) {
        return definition.parameter === "local_ToningSaturation";
    }), "legacy preset/runtime Toning Saturation compatibility must remain internal");
    assert.equal(maskingCorrections.byParameter.local_GrainSize, undefined);
    assert.equal(maskingCorrections.byParameter.local_GrainRoughness, undefined);
    const ctx = context();
    const authoritative = Object.assign({ ok: true, serverEpoch: "mask-phase4", revision: 2 }, ctx, snapshot());
    assert.equal(maskingUi.present(authoritative, ctx, { activeOperation: { kind: "deleteAll" } }).status,
        "Deleting all masks…");
    assert.equal(maskingUi.present(authoritative, ctx, { activeOperation: { kind: "resetSelected" } }).status,
        "Resetting mask corrections…");
    assert.equal(maskingUi.present(authoritative, ctx, { activeOperation: { kind: "preset" } }).status,
        "Applying mask preset…");
    assert.equal(maskingUi.present(authoritative, ctx, { activeOperation: { kind: "pointColorPicker" } }).status,
        "Selecting mask Color Picker…");
    assert.equal(maskingUi.present(authoritative, ctx, { activeOperation: { kind: "pointColorVisualize" } }).status,
        "Toggling mask Visualize Range…");
}

function testLocalPresetInventory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-mask-presets-"));
    try {
        fs.writeFileSync(path.join(directory, "01 valid.lrtemplate"),
            's = { internalName = "Portrait Fine", type = "LocalizedAdjustmentPreset", value = { exposure2012 = 0.25 }, }\n');
        fs.writeFileSync(path.join(directory, "02 localized.lrtemplate"),
            's = { title = ZSTR "$$$/Preset=Soft Light", type = "LocalizedAdjustmentPreset", value = { contrast2012 = 0.1 }, }\n');
        fs.writeFileSync(path.join(directory, "not-local.lrtemplate"), 's = { type = "DevelopPreset", value = {} }\n');
        fs.writeFileSync(path.join(directory, "wrong.txt"),
            's = { type = "LocalizedAdjustmentPreset", value = {} }\n');
        const inventory = localPresets.createInventory({ directory: directory });
        const listed = inventory.list();
        assert.deepEqual(listed.map(function (entry) { return entry.name; }), ["Portrait Fine", "Soft Light"]);
        assert.ok(listed.every(function (entry) { return /^lp-[A-Za-z0-9_-]{24}$/.test(entry.id); }));
        assert.deepEqual(inventory.resolve(listed[0].id), listed[0]);
        assert.equal(inventory.resolve("lp-missing"), null);
        assert.equal(localPresets.presetId("01 valid.lrtemplate"), listed[0].id,
            "local preset IDs must remain stable without revealing a filesystem path");
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

function testDestructiveResetAndPresetOperations() {
    {
        const harness = hydrate(snapshot());
        const specification = { kind: "preset", presetId: "lp-fixture", presetFile: "Fixture.lrtemplate",
            selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" };
        assert.equal(harness.state.beginOperation(Object.assign({}, specification, { selectedMaskToolId: "old-component" }),
            harness.binding(), harness.ctx), null);
        const command = harness.state.beginOperation(specification, harness.binding(), harness.ctx);
        assert.equal(commands.validateCommand(Object.assign({}, command, { expectedSelectedMaskToolId: null })), false);
        assert.equal(harness.state.commandMatches(Object.assign({}, command, { expectedSelectedMaskToolId: "old-component" }), harness.ctx), false);
        assert.equal(harness.state.finishOperation(Object.assign(operationResult(command, snapshot()), { outcome: "no_change" }), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.outcome, "failed", "preset success requires confirmed readback");
    }

    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginOperation({ kind: "pointColorPicker", selectedMaskGroupId: "mask-a" },
            harness.binding(), harness.ctx);
        assert.equal(command.command, "masking.point_color.tool.select");
        assert.equal(command.expectedSelectedMaskId, "mask-a");
        assert.equal(command.expectedSelectedMaskToolId, "brush-a");
        assert.equal(commands.validateCommand(command), true);
        assert.equal(harness.state.commandMatches(command, harness.ctx), true);
        assert.equal(harness.state.commandMatches(command, context({ developCounter: 15 })), false,
            "mask Color Picker selection must be revalidated at queue dequeue");
        commands.resetQueueForTests();
        commands.setMaskingAdmissionProvider({
            matches: function (candidate) { return harness.state.commandMatches(candidate, harness.ctx); },
            onRejected: function (candidate, detail) { harness.state.rejectCommand(candidate, detail); }
        });
        assert.equal(commands.tryEnqueueCommand(command).accepted, true);
        assert.equal(commands.getNextCommand().command, "masking.point_color.tool.select");
        commands.resetQueueForTests();
        commands.setMaskingAdmissionProvider(null);
        assert.equal(harness.state.finishOperation(operationResult(command, snapshot()), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.outcome, "confirmed");
        const visualization = harness.state.beginOperation({ kind: "pointColorVisualize", selectedMaskGroupId: "mask-a" },
            harness.binding(), harness.ctx);
        assert.equal(visualization.command, "masking.point_color.range_visualization.toggle");
        assert.equal(commands.validateCommand(visualization), true);
        commands.setMaskingAdmissionProvider({
            matches: function (candidate) { return harness.state.commandMatches(candidate, harness.ctx); },
            onRejected: function (candidate, detail) { harness.state.rejectCommand(candidate, detail); }
        });
        assert.equal(commands.tryEnqueueCommand(visualization).accepted, true);
        assert.equal(commands.getNextCommand().command, "masking.point_color.range_visualization.toggle");
        commands.resetQueueForTests();
        commands.setMaskingAdmissionProvider(null);
        assert.equal(harness.state.finishOperation(operationResult(visualization, snapshot()), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.outcome, "confirmed");
    }
    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginOperation({ kind: "deleteAll" }, harness.binding(), harness.ctx);
        assert.equal(command.command, "masking.all.delete");
        assert.equal(command.expectedMaskCount, 2);
        assert.equal(commands.validateCommand(command), true);
        assert.equal(harness.state.commandMatches(command, harness.ctx), true);
        assert.equal(harness.state.commandMatches(command, context({ developCounter: 15 })), false,
            "Delete All must be revalidated against Develop context at dequeue");
        assert.equal(harness.state.finishOperation(operationResult(command, emptySnapshot()), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.outcome, "confirmed");
        assert.equal(harness.state.beginOperation({ kind: "deleteAll" }, harness.binding(), harness.ctx), null,
            "Delete All must not admit when Lightroom reports no masks");
    }
    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginOperation({ kind: "resetSelected", selectedMaskGroupId: "mask-a" },
            harness.binding(), harness.ctx);
        assert.equal(command.command, "masking.selected.reset");
        assert.equal(commands.validateCommand(command), true);
        const resultSnapshot = snapshot({
            corrections: [{ parameter: "local_RefineSaturation", value: 1, min: -100, max: 100 }]
        });
        assert.equal(harness.state.finishOperation(operationResult(command, resultSnapshot), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.outcome, "confirmed");
    }
    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginOperation({ kind: "preset", presetId: "lp-fixture",
            presetFile: "Fixture.lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" }, harness.binding(), harness.ctx);
        assert.equal(command.command, "masking.preset.apply");
        assert.equal(command.presetFile, "Fixture.lrtemplate");
        assert.equal(commands.validateCommand(command), true);
        const changedComponent = snapshot({ selectedMaskToolId: "brush-other", selectedMaskToolIndex: 2,
            previousMaskToolAvailable: true, nextMaskToolAvailable: false });
        assert.equal(harness.state.finishOperation(operationResult(command, changedComponent), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.outcome, "failed",
            "preset completion must reject a result that changed the selected component");
    }
    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginOperation({ kind: "preset", presetId: "lp-fixture",
            presetFile: "Fixture.lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" }, harness.binding(), harness.ctx);
        const appliedCurve = [0, 0, 64, 52, 128, 128, 255, 255];
        const applied = snapshot({
            corrections: [
                { parameter: "local_Exposure", value: 1, min: -4, max: 4 },
                { parameter: "local_RefineSaturation", value: 8, min: -100, max: 100 }
            ],
            pointColor: pointColor({ HueShift: 0.2 }),
            curves: { available: true, rgb: appliedCurve, red: [0, 0, 255, 255],
                green: [0, 0, 255, 255], blue: [0, 0, 255, 255] }
        });
        const result = operationResult(command, applied);
        result.presetDiagnostics = presetDiagnostics(command, "confirmed");
        assert.equal(harness.state.finishOperation(result, harness.ctx), true);
        const reconciled = harness.state.getPublicState();
        assert.equal(reconciled.lastResult.outcome, "confirmed");
        assert.equal(reconciled.corrections[0].value, 1);
        assert.equal(reconciled.pointColor.HueShift, 0.2);
        assert.deepEqual(reconciled.curves.rgb, appliedCurve,
            "preset completion must publish scalar, Point Color, and curve authority together");
        const diagnostics = harness.state.getLastPresetDiagnostics();
        assert.equal(diagnostics.operationId, command.operationId);
        assert.equal(diagnostics.outcome, "confirmed");
        assert.equal(diagnostics.report, result.presetDiagnostics,
            "full authoritative preset settlement evidence must survive outside browser state");
        const capture = harness.state.getPresetDiagnosticState();
        assert.deepEqual(capture.state.corrections, reconciled.corrections);
        assert.equal(capture.history.at(-1).operationId, command.operationId);
        assert.equal(capture.history.at(-1).binding.selectedMaskToolId, "brush-a");
        assert.equal(capture.pending, null);
        capture.state.corrections[0].value = 99;
        capture.history[0].outcome = "fabricated";
        assert.equal(harness.state.getPublicState().corrections[0].value, 1);
        assert.equal(harness.state.getPresetDiagnosticState().history[0].outcome, "confirmed",
            "diagnostic consumers must not mutate authoritative state or prior results");
    }
    {
        const harness = hydrate(snapshot());
        const before = harness.state.getPublicState();
        const burn = harness.state.beginOperation({ kind: "preset", presetId: "lp-burnfixture",
            presetFile: "Burn (Darken).lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" },
        harness.binding(), harness.ctx);
        const burnApplied = snapshot({ corrections: [
            { parameter: "local_Exposure", value: -0.300000011920928, min: -4, max: 4 },
            { parameter: "local_RefineSaturation", value: 0, min: -100, max: 100 }
        ] });
        const confirmation = operationResult(burn, burnApplied, "confirmed");
        confirmation.presetDiagnostics = presetDiagnostics(burn, "confirmed", false);
        assert.equal(harness.state.finishOperation(confirmation, harness.ctx), true);
        assert.equal(harness.state.getPublicState().pendingOperation, null,
            "a confirmed Burn operation must release the serialized operation");
        assert.equal(harness.state.getPublicState().lastResult.outcome, "confirmed");
        assert.deepEqual(harness.state.getPublicState().pointColor, before.pointColor,
            "Burn must preserve the existing Point Color sample and selected index");
        assert.equal(harness.state.getPublicState().corrections[0].value, -0.300000011920928,
            "Burn's explicitly stored Exposure value must remain authoritative");
        assert.match(harness.state.getLastPresetDiagnostics().report, /absent\/preserved\/not-settled/);
        assert.ok(harness.state.beginOperation({ kind: "preset", presetId: "lp-retry",
            presetFile: "Retry.lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" }, harness.binding(), harness.ctx),
        "preset admission must recover immediately after successful settlement");
    }
    {
        const harness = hydrate(snapshot());
        const failed = harness.state.beginOperation({ kind: "preset", presetId: "lp-explicit-failure",
            presetFile: "Explicit Failure.lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" },
        harness.binding(), harness.ctx);
        const failure = operationResult(failed, snapshot(), "failed");
        failure.detail = "Preset settlement failure: local_Exposure expected -0.3 but Lightroom returned 0.";
        assert.equal(harness.state.finishOperation(failure, harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastResult.detail, failure.detail,
            "a mismatch in an actually applied field must survive operation settlement verbatim");
        assert.equal(harness.state.getLastPresetDiagnostics().outcome, "failed");
    }
    {
        const harness = hydrate(snapshot());
        const timedOut = harness.state.beginOperation({ kind: "preset", presetId: "lp-timeout",
            presetFile: "Timeout.lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" },
        harness.binding(), harness.ctx);
        assert.ok(timedOut);
        harness.tick(10001);
        assert.equal(harness.state.requestRefresh(harness.ctx, false), true,
            "a timed-out preset must release its operation and request fresh authority");
        let publicState = harness.state.getPublicState();
        assert.equal(publicState.pendingOperation, null);
        assert.equal(publicState.lastResult.outcome, "failed");
        assert.equal(publicState.lastResult.detail, "Lightroom did not confirm the Masking action in time.");
        assert.equal(harness.state.getLastPresetDiagnostics().detail,
            "Lightroom did not confirm the Masking action in time.");
        const refresh = harness.state.takeRequest();
        assert.ok(refresh);
        assert.equal(harness.state.acceptQueryResult(Object.assign({}, refresh, { snapshot: snapshot() }),
            harness.ctx), true);
        publicState = harness.state.getPublicState();
        assert.ok(harness.state.beginOperation({ kind: "preset", presetId: "lp-after-timeout",
            presetFile: "After Timeout.lrtemplate", selectedMaskGroupId: "mask-a", selectedMaskToolId: "brush-a" },
        harness.binding(), harness.ctx), "preset admission must recover after timeout and authoritative refresh");
    }
    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginOperation({ kind: "resetSelected", selectedMaskGroupId: "mask-a" },
            harness.binding(), harness.ctx);
        harness.state.syncContext(context({ selectedPhotoUuid: "photo-other", contextCounter: 10,
            developCounter: 15, contextChangedAt: 2001 }));
        assert.equal(harness.state.commandMatches(command, harness.ctx), false,
            "photo/context changes must invalidate selected-mask Reset before execution");
        assert.equal(harness.state.getPublicState().lastResult.outcome, "stale");
    }
}

function testAdvancedSnapshotReadsAndEdits() {
    const sanitized = maskingDefinition.sanitizeSnapshot(snapshot());
    assert.ok(sanitized);
    assert.equal(sanitized.pointColor.selectedIndex, 1);
    assert.deepEqual(sanitized.curves.rgb, [0, 0, 255, 255]);
    assert.equal(maskingDefinition.sanitizeSnapshot(snapshot({
        curves: { available: true, rgb: [0, 0, 0, 1], red: [0, 0, 255, 255],
            green: [0, 0, 255, 255], blue: [0, 0, 255, 255] }
    })), null, "malformed local curves must fail closed");

    {
        const harness = hydrate(snapshot());
        const value = harness.state.beginEdit({ kind: "pointValue", field: "HueShift", value: 0.2,
            selectedIndex: 1, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(value.command, "masking.point_color.value.set");
        assert.equal(commands.validateCommand(value), true);
        assert.equal(harness.state.commandMatches(value, harness.ctx), true);
        assert.equal(harness.state.acceptEditResult(editResult(value,
            snapshot({ pointColor: pointColor({ HueShift: 0.2 }) })), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastEditResult.outcome, "confirmed");
        assert.equal(harness.state.acceptEditResult(editResult(value, snapshot()), harness.ctx), false,
            "duplicate or older Masking edit feedback must be rejected");
    }
    {
        const harness = hydrate(snapshot());
        const range = harness.state.beginEdit({ kind: "pointRange", range: "HueRange", boundary: "LowerNone",
            value: 0.2, selectedIndex: 1, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        const translated = harness.state.beginEdit({ kind: "pointTranslate", range: "SatRange", selectedIndex: 1,
            values: { LowerNone: 0.2, LowerFull: 0.4, UpperFull: 0.8, UpperNone: 1 },
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        const selected = harness.state.beginEdit({ kind: "pointSelect", selectedIndex: 2,
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(range.command, "masking.point_color.range.set");
        assert.equal(translated.command, "masking.point_color.range.translate");
        assert.equal(selected.command, "masking.point_color.sample.select");
        assert.equal(harness.state.beginEdit({ kind: "pointTranslate", range: "LumRange", selectedIndex: 1,
            values: { LowerNone: 0.4, LowerFull: 0.5, UpperFull: 0.5, UpperNone: 0.6 },
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx), null,
        "unsafe zero-width Point Color ranges must fail before queue admission");
    }
    {
        const harness = hydrate(snapshot());
        const normalized = harness.state.beginEdit({ kind: "pointValue", field: "HueShift", value: 0.2,
            selectedIndex: 1, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(harness.state.acceptEditResult(editResult(normalized,
            snapshot({ pointColor: pointColor({ HueShift: 0.19 }) })), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastEditResult.outcome, "confirmed",
            "a structurally valid Lightroom normalization must remain authoritative for the shared UI to adopt");
        assert.equal(harness.state.getPublicState().pointColor.HueShift, 0.19);
    }
    for (const phase of ["update", "end"]) {
        const harness = hydrate(snapshot());
        const points = [0, 0, 64, 52, 192, 204, 255, 255];
        const command = harness.state.beginEdit({ kind: "curveGesture", phase: phase, channel: "rgb",
            gestureId: "curve_" + phase, baseline: [0, 0, 255, 255], points: points,
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(command.command, "masking.tone_curve.gesture." + phase);
        assert.equal(commands.validateCommand(command), true);
        const next = snapshot({ curves: { available: true, rgb: points, red: [0, 0, 255, 255],
            green: [0, 0, 255, 255], blue: [0, 0, 255, 255] } });
        assert.equal(harness.state.acceptEditResult(editResult(command, next), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastEditResult.outcome, "confirmed",
            "authoritative curve " + phase + " feedback must reconcile against its admitted target");
    }
    {
        const fields = {
            rgb: "local_Maincurve", red: "local_Redcurve",
            green: "local_Greencurve", blue: "local_Bluecurve"
        };
        for (const channel of Object.keys(fields)) {
            const harness = hydrate(snapshot());
            const points = [0, 0, 109, 93, 255, 255];
            const command = harness.state.beginEdit({ kind: "curveGesture", phase: "end", channel: channel,
                gestureId: "curve_" + channel, baseline: [0, 0, 255, 255], points: points,
                selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
            assert.equal(command.field, fields[channel]);
            assert.equal(command.expectedSelectedMaskId, "mask-a");
            assert.equal(command.expectedSelectedPhotoUuid, "photo-phase4");
            assert.equal(command.expectedContextCounter, 9);
            assert.equal(command.expectedDevelopCounter, 14);
            assert.equal(command.expectedContextChangedAt, 2000);
            assert.equal(command.expectedServerEpoch, "mask-phase4");
            assert.deepEqual(command.points, points);
            assert.equal(commands.validateCommand(command), true);
        }
    }
    {
        const harness = hydrate(snapshot());
        const refine = harness.state.beginEdit({ kind: "refine", phase: "update", gestureId: "refine_update",
            baseline: 0, value: 12, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        const next = snapshot({ corrections: [{ parameter: "local_RefineSaturation", value: 12,
            min: -100, max: 100 }] });
        assert.equal(harness.state.acceptEditResult(editResult(refine, next), harness.ctx), true);
        assert.equal(harness.state.getPublicState().lastEditResult.outcome, "confirmed",
            "authoritative Refine update feedback must reconcile against its admitted value");
    }
    {
        const harness = hydrate(snapshot());
        const refine = harness.state.beginEdit({ kind: "refine", phase: "end", gestureId: "refine_one",
            baseline: 0, value: 12, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(refine.command, "masking.tone_curve.refine_saturation.gesture.end");
        const next = snapshot({ corrections: [{ parameter: "local_RefineSaturation", value: 12,
            min: -100, max: 100 }] });
        assert.equal(harness.state.acceptEditResult(editResult(refine, next), harness.ctx), true);
        const reset = harness.state.beginEdit({ kind: "refine", phase: "reset", baseline: 12,
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(reset.command, "masking.tone_curve.refine_saturation.reset");
    }
    {
        const harness = hydrate(snapshot());
        const command = harness.state.beginEdit({ kind: "pointValue", field: "Variance", value: 0.3,
            selectedIndex: 1, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        harness.publish(selectedSnapshot());
        assert.equal(harness.state.commandMatches(command, harness.ctx), false,
            "mask selection changes must cancel an admitted Point Color edit");
        assert.equal(harness.state.rejectCommand(command, "Mask selection changed."), true);
        assert.equal(harness.state.getPublicState().lastEditResult.outcome, "stale");
    }
}

function testAdvancedQueueCoalescingAndCancellation() {
    commands.resetQueueForTests();
    try {
        const harness = hydrate(snapshot());
        commands.setMaskingAdmissionProvider({
            matches: function (command) { return harness.state.commandMatches(command, harness.ctx); },
            onRejected: function (command, detail) { harness.state.rejectCommand(command, detail); }
        });
        const first = harness.state.beginEdit({ kind: "pointValue", field: "SatScale", value: 0.1,
            selectedIndex: 1, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        const final = harness.state.beginEdit({ kind: "pointValue", field: "SatScale", value: 0.4,
            selectedIndex: 1, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(commands.tryEnqueueCommand(first).accepted, true);
        assert.equal(commands.tryEnqueueCommand(final).coalesced, true);
        assert.equal(commands.getQueueDiagnostics().queue.length, 1);
        assert.equal(commands.getNextCommand().value, 0.4,
            "rapid Point Color input must dequeue only the final same-target value");

        commands.resetQueueForTests();
        const baseline = [0, 0, 255, 255];
        const updated = [0, 0, 128, 140, 255, 255];
        const finished = [0, 0, 128, 150, 255, 255];
        const begin = harness.state.beginEdit({ kind: "curveGesture", phase: "begin", channel: "red",
            gestureId: "curve_rapid", baseline: baseline, selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        const update = harness.state.beginEdit({ kind: "curveGesture", phase: "update", channel: "red",
            gestureId: "curve_rapid", baseline: baseline, points: updated,
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        const end = harness.state.beginEdit({ kind: "curveGesture", phase: "end", channel: "red",
            gestureId: "curve_rapid", baseline: baseline, points: finished,
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(commands.tryEnqueueCommand(begin).accepted, true);
        assert.equal(commands.tryEnqueueCommand(update).coalesced, true);
        assert.equal(commands.tryEnqueueCommand(end).coalesced, true);
        assert.equal(commands.getQueueDiagnostics().queue.length, 1);
        const dequeued = commands.getNextCommand();
        assert.equal(dequeued.command, "masking.tone_curve.gesture.end");
        assert.deepEqual(dequeued.points, finished);

        commands.resetQueueForTests();
        const stale = harness.state.beginEdit({ kind: "curveReset", channel: "blue", baseline: baseline,
            selectedMaskGroupId: "mask-a" }, harness.binding(), harness.ctx);
        assert.equal(commands.tryEnqueueCommand(stale).accepted, true);
        harness.state.syncContext(context({ selectedPhotoUuid: "photo-replaced", contextCounter: 10,
            developCounter: 15, contextChangedAt: 2001 }));
        assert.equal(commands.getNextCommand(), null,
            "queue dequeue must discard local-curve work after a photo/context change");
    } finally {
        commands.resetQueueForTests();
        commands.setMaskingAdmissionProvider(null);
    }
}

function testProductionSourceContracts() {
    const maskingLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Masking.lua"), "utf8");
    const presetLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/MaskPresets.lua"), "utf8");
    const parserLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Parser.lua"), "utf8");
    const commandsLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Commands.lua"), "utf8");
    const bridgeSource = fs.readFileSync(path.join(root, "server/bridge.js"), "utf8");
    const maskingStateSource = fs.readFileSync(path.join(root, "server/masking-state.js"), "utf8");
    const controllerSource = fs.readFileSync(path.join(root, "app/controller-masking.js"), "utf8");
    const controllerHtml = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
    const sharedPointColorSource = fs.readFileSync(path.join(root, "app/controller-point-color.js"), "utf8");
    const sharedToneCurveSource = fs.readFileSync(path.join(root, "app/controller-tone-curve.js"), "utf8");
    const pointColorLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/PointColor.lua"), "utf8");
    const toneCurveLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/ToneCurve.lua"), "utf8");

    const resetBlock = maskingLua.slice(maskingLua.indexOf("local RESET_PARAMETERS"),
        maskingLua.indexOf("local POINT_COLOR_RANGES"));
    maskingCorrections.definitions.filter(function (definition) {
        return definition.parameter !== "local_ToningLuminance";
    }).forEach(function (definition) {
        assert.match(resetBlock, new RegExp('"' + definition.parameter + '"'));
    });
    ["local_PointColors", "local_Maincurve", "local_Redcurve", "local_Greencurve", "local_Bluecurve"]
        .forEach(function (parameter) { assert.match(resetBlock, new RegExp('"' + parameter + '"')); });
    assert.match(maskingLua, /LrDevelopController\.resetMasking\(\)/);
    assert.match(maskingLua, /PointColor\.updateContextValue[\s\S]*true\)/,
        "mask-local Point Color writes must use the shared global implementation with local=true");
    assert.match(pointColorLua, /updateSelectedPointColorSwatch\(completeSwatch, isForMasking == true\)/);
    assert.match(pointColorLua, /deletePointColorSwatch\(true, 1, isForMasking == true\)/,
        "explicit Point Color collection replacement must use Adobe's mask-local delete-all API");
    assert.match(pointColorLua, /addPointColorSwatch\([\s\S]*isForMasking == true\)/,
        "preset Point Color restoration/application must use Adobe's mask-local add API");
    assert.match(maskingLua, /selectPointColorSwatch\(command\.selectedIndex, true\)/);
    assert.match(maskingLua, /selectTool\("local_point_color"\)/,
        "the documented mask-local picker tool must back Select Color Picker");
    assert.match(maskingLua, /local_Maincurve/);
    assert.match(maskingLua, /local_RefineSaturation/);
    assert.match(maskingLua, /ToneCurve\.normalizeCurveValue/);
    assert.match(maskingLua, /local function curveForWrite\(points\)[\s\S]*ToneCurve\.copyCurve\(points\)/,
        "mask-local curves must use the same flat numeric write representation as the proven global writer");
    assert.doesNotMatch(maskingLua, /local function curveForWrite\(points\)[\s\S]*?ToneCurve\.curveForLocalWrite\(points\)/);
    assert.match(maskingLua,
        /masking\.tone_curve\.preset\.set[\s\S]*startTracking\(field\)[\s\S]*setValue\(field, curveForWrite\(command\.points\)\)[\s\S]*stopActiveCorrectionGesture\(trace\)/,
        "mask curve presets must close a local tracking transaction before authoritative settlement");
    assert.match(maskingLua,
        /masking\.tone_curve\.reset[\s\S]*startTracking\(field\)[\s\S]*resetToDefault\(field\)[\s\S]*stopActiveCorrectionGesture\(trace\)/,
        "mask curve reset must close a local tracking transaction before authoritative settlement");
    assert.match(toneCurveLua, /function ToneCurve\.normalizeCurveValue/);
    assert.match(maskingLua, /togglePointColorRangeVisualization\(true\)/,
        "mask Visualize Range must reuse Lightroom's documented momentary operation");
    for (const unsafe of ["loadstring", "loadfile", "dofile", "SendKeys", "keystroke", "mouse_event"]) {
        assert.equal(maskingLua.includes(unsafe), false);
        assert.equal(presetLua.includes(unsafe), false);
    }
    assert.match(presetLua, /LocalizedAdjustmentPreset/);
    assert.match(presetLua, /LrDevelopController\.setValue/);
    const filePresetApplySource = presetLua.slice(
        presetLua.indexOf("function MaskPresets.apply(filename"),
        presetLua.indexOf("function MaskPresets.applyBuiltin"));
    assert.doesNotMatch(filePresetApplySource, /entry\.reset|resetToDefault\(entry\.parameter\)/,
        "local preset omission must never be converted into a reset");
    assert.doesNotMatch(presetLua, /LrDevelopController\.resetToDefault\(/,
        "single adjustments must validate the independently expected native values");
    assert.match(presetLua, /return applyValues\(values, stillValid, trace, parameter\)/,
        "single adjustments share the validated writer and restoration path");
    assert.match(presetLua,
        /comparisonsFor\(readable\)[\s\S]*firstMismatch[\s\S]*mismatchDetail\(firstMismatch\)/,
        "preset settlement must compare applied fields, annotate preserved fields, and report the first actual mismatch");
    assert.match(maskingLua,
        /formatSettlementDiagnostics\(applied,[\s\S]*operationId = command\.operationId[\s\S]*componentBefore = before\.selectedMaskToolId[\s\S]*componentAfter = after\.selectedMaskToolId[\s\S]*serverEpoch = command\.expectedServerEpoch/,
        "Burn diagnostics must bind values to the preset operation, photo, mask/component, revisions, and epoch");
    assert.doesNotMatch(presetLua, /key = "toningLuminance", parameter = "local_ToningLuminance"/,
        "legacy Color luminance readback must not introduce a preset write mapping");
    assert.match(parserLua, /presetFile/);
    assert.match(parserLua, /editSequence/);
    assert.match(commandsLua, /masking\.all\.delete/);
    assert.match(commandsLua, /masking\.selected\.reset/);
    assert.match(commandsLua, /masking\.preset\.apply/);
    ["/masking/all/delete", "/masking/selected/reset", "/masking/preset/apply", "/masking/presets",
        "/masking/point-color/value", "/masking/point-color/range", "/masking/point-color/sample",
        "/masking/point-color/tool/select", "/masking/point-color/range-visualization/toggle",
        "/masking/tone-curve/state", "/masking/tone-curve/gesture/end"]
        .forEach(function (route) { assert.ok(bridgeSource.includes(route), route + " route missing"); });
    assert.match(controllerSource, /confirmImpl\("Delete all " \+ count \+ " mask" \+ \(count === 1 \? "" : "s"\) \+ " from this photograph\?"\)/,
        "Delete All must confirm the captured mask count and photo scope");
    assert.match(controllerSource, /Delete All Masks/);
    assert.match(controllerSource, /Apply Mask Preset/);
    assert.match(controllerSource, /masking-preset-button/);
    assert.match(controllerSource, /aria-haspopup", "dialog"/);
    assert.doesNotMatch(controllerSource, /masking-preset-select|Save Current Settings as New Preset|Restore Default Presets/,
        "Mask presets must use the controller-native picker and omit unavailable native commands");
    assert.match(controllerSource, /api\/masking\/preset\/apply/);
    assert.match(bridgeSource, /resolveWithStatus/);
    assert.doesNotMatch(maskingStateSource, /presetResolver|presetIdentityResolver|presetProvenance|edited:\s*edited/,
        "Masking state must not guess preset identity or synthesize edited provenance");
    assert.match(controllerSource, /Reset/);
    assert.match(controllerSource, /pointColorModule\.createController/);
    assert.match(controllerSource, /sendOperation\("pointColorPicker"\)/);
    assert.match(controllerSource, /sendOperation\("pointColorVisualize"\)/);
    assert.doesNotMatch(controllerSource, /pickerAction:\s*false/,
        "mask Point Color must use the documented local picker instead of a disabled imitation");
    assert.match(controllerSource, /toneCurveModule\.createController/);
    assert.match(controllerSource, /createMaskingContextAdapter/);
    assert.match(controllerHtml, /LRBridgePointColor\.createController/);
    assert.match(sharedPointColorSource, /Select Color Picker/);
    assert.match(sharedPointColorSource, /develop-slider-row point-color-slider-row/);
    assert.match(sharedToneCurveSource, /editFeedbackSequence/);
    assert.match(controllerHtml, /button\.masking-delete-all-button[\s\S]*background:\s*#612d35/);
    const order = [
        '["Amount", "Tone", "Color"].forEach',
        "corrections.appendChild(createPointColorSection())",
        'textContent = "Tone Curve"',
        '["Effects", "Detail"].forEach'
    ].map(function (needle) { return controllerSource.indexOf(needle); });
    assert.ok(order.every(function (index) { return index >= 0; }));
    assert.ok(order.every(function (index, position) { return position === 0 || order[position - 1] < index; }),
        "advanced correction groups must retain the required Masking UI order");
    assert.match(controllerSource, /body\.appendChild\(actionRow\);[\s\S]*body\.appendChild\(corrections\);/,
        "Mask actions must be mounted before the correction controls");
    for (const unsupportedLabel of ["Auto Mask"] ) {
        assert.equal(maskingCorrections.definitions.some(definition => definition.label === unsupportedLabel), false,
            unsupportedLabel + " remains an explanation, not a correction control");
    }
    for (const explanation of ["Reset Sliders Automatically", "Use Fine Adjustment"]) {
        assert(controllerSource.includes("<strong>" + explanation + "</strong>"));
        assert(!maskingCorrections.definitions.some(definition => definition.label === explanation));
    }
    for (const misleadingLabel of ["Toning Hue", "Toning Saturation", "Toning Luminance"]) {
        assert.equal(maskingCorrections.definitions.some(function (definition) {
            return definition.label === misleadingLabel;
        }), false, misleadingLabel + " must not render as a Lightroom-parity slider");
    }
    assert(!maskingCorrections.definitions.some(definition => /Brush Size|Brush Feather|Brush Flow|Brush Density/.test(definition.label)),
        "Brush tool settings remain explanations without correction controls");
}

(function run() {
    testCorrectionOrganization();
    testLocalPresetInventory();
    testDestructiveResetAndPresetOperations();
    testAdvancedSnapshotReadsAndEdits();
    testAdvancedQueueCoalescingAndCancellation();
    testProductionSourceContracts();
    console.log("Masking Phase 4 completion operations, presets, Point Color, Tone Curve, and safety tests passed.");
})()
