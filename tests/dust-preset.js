"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const { runtime } = require("./masking-create");
const { summarize } = require("../scripts/summarize-dust-preset");
const scenarios = ["success", "library", "delayed", "void-return", "duplicate-running", "reset-all-healing", "closed-unreadable",
    "no-native-actions", "existing-dust", "pending-ai", "no-manual", "process-version", "missing-photo", "tool-closed",
    "missing-preset", "duplicate-preset", "version", "changed-preset", "preset-extra-edit", "source-photo", "unreadable", "cancel",
    "file-open", "file-write", "file-flush", "file-after-call", "gate-timeout", "gate-photo", "gate-edit", "gate-manual", "gate-preset",
    "gate-command", "no-change", "false-return", "sdk-error", "photo-in-call", "edit-change", "manual-change", "mask-change",
    "ai-change", "preference-change", "ai-pending-after", "transient-edit", "module-after-call"];
const requested = process.argv.slice(2), selected = requested.length ? requested : scenarios;
for (const scenario of selected) {
    assert(scenarios.includes(scenario), "Unknown scenario " + scenario);
    const sdk = runtime();
    try {
        sdk.set("dustPresetScenario", scenario); sdk.run(fs.readFileSync("tests/dust-preset.lua", "utf8"));
        const text = sdk.result();
        if (!text.includes('"stage":"baseline"')) continue;
        const report = summarize(text);
        assert(report.dispatchRecords <= 1); assert.equal(report.freshDetectionConfirmed, false);
        assert.equal(report.visualRemoval, "unassessed");
        assert.equal(report.nativeResetMeaningConfirmed, false); assert.equal(report.nativeCloseMeaningConfirmed, false);
        if (report.onReadbackRecorded) {
            assert.equal(report.finished, true); assert.equal(report.destinationDustOn.length, 1);
            assert(report.sdkComparisons.every(r => r.manualUnchanged && r.otherFiltersUnchanged && !r.unrelatedSettingsChanged.length));
            if (scenario === "reset-all-healing") assert(report.nativeComparisons.some(r => r.manualUnchanged === false));
            else if (scenario === "closed-unreadable") assert(report.nativeComparisons.some(r => r.manualUnchanged === null && r.tool === "loupe"));
            else assert(report.nativeComparisons.every(r => r.manualUnchanged === true));
            if (scenario === "no-native-actions") {
                assert.equal(report.selectedToolChanges.length, 0); assert(report.nativeComparisons.every(r => r.dustCount === 1));
            } else assert.deepEqual(report.selectedToolChanges.map(r => [r.before, r.after]), [["dust", "loupe"]]);
        }
        if (scenario === "void-return") {
            assert.equal(report.sdkReturn.resultType, "nil"); assert.equal(report.sdkReturn.result, undefined);
            assert.equal(report.onReadbackRecorded, true, "SDK void return is not a fabricated false; confirmation needs readback");
        }
        if (scenario === "sdk-error") assert.match(report.sdkReturn.failure, /preset failed/);
        if (scenario === "success") {
            const rows = text.trim().split(/\r?\n/).map(JSON.parse);
            const source = structuredClone(rows.find(r => r.stage === "on_readback"));
            source.snapshot.selectedPhotoUuid = "source-photo";
            const off = rows.filter(r => r.stage === "native_sample").at(-1);
            const paired = summarize(text, JSON.stringify(source) + "\n" + JSON.stringify(off));
            assert(paired.sourceComparison.differentPhoto);
            assert.equal(paired.sourceComparison.sourceDust.length, 1, "Use a Dust-bearing source sample even when its capture ends Off");
        }
    } catch (error) { throw Error(scenario + ": " + error.message); }
    finally { sdk.close(); }
}
const implementation = fs.readFileSync("lightroom/LRBridge.lrplugin/TestDustPreset.lua", "utf8");
assert.equal((implementation.match(/photo:applyDevelopPreset\(preset, nil, nil, true\)/g) || []).length, 1);
assert.doesNotMatch(implementation, /[:.]\s*(pasteSettings|copySettings|applyDevelopSettings|updateAISettings|resetSpotRemoval|resetToDefault|selectTool|setSelectedPhotos|setRemovePanelPreferences)\s*\(/);
console.log("Dust preset: " + selected.length + " one-shot, state/preservation, native-action evidence, stale-context and failure scenarios passed.");
