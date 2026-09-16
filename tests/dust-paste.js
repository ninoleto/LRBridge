"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runtime } = require("./masking-create");
const { summarize } = require("../scripts/summarize-dust-paste");
const scenarios = ["success", "library", "cancel", "existing-dust", "pending-ai", "missing-photo", "unreadable", "cycle",
    "large-mask", "large-mask-change", "file-open", "file-write", "file-flush", "file-after-paste", "gate-timeout",
    "photo-in-confirm", "photo-before-gate", "module-before-gate", "stale-settings", "stale-manual", "command-before-gate",
    "photo-in-call", "photo-after-call", "module-after-call", "command-after-call", "duplicate-running",
    "false-return", "sdk-error", "slow-result", "unrelated-change", "manual-change", "manual-id-change",
    "ai-change", "mask-change", "preference-change", "ai-pending-after", "transient-change"];
const requested = process.argv.slice(2);
for (const scenario of requested) assert(scenarios.includes(scenario), "Unknown Dust paste scenario: " + scenario);
const selected = requested.length ? requested : scenarios;
for (const scenario of selected) {
    const sdk = runtime();
    try {
        sdk.set("dustPasteScenario", scenario);
        sdk.run(fs.readFileSync("tests/dust-paste.lua", "utf8"));
        const lines = sdk.result();
        if (!lines.includes('"stage":"baseline"')) continue;
        const report = summarize(lines);
        assert.equal(report.visualRemovalConfirmed, false);
        assert.equal(report.freshDetectionConfirmed, false);
        assert(report.dispatchRecords <= 1);
        if (["success", "library", "large-mask", "slow-result", "duplicate-running"].includes(scenario)) {
            assert.equal(report.finished, true);
            assert.equal(report.sdkReturn.result, true);
            assert.equal(report.clipboardConfirmation.userPreparedDustOnly, true);
            assert.equal(report.clipboardConfirmation.sdkInspectedClipboard, false);
            assert.equal(report.destinationDustBefore.length, 0);
            assert.equal(report.destinationDustLast.length, 1);
            assert.deepEqual(report.destinationDustLast[0].regions[0].bounds, [10, 20, 30, 40]);
            assert.deepEqual(report.preservation.unrelatedDevelopFieldsChanged, []);
            for (const key of ["manualChanges", "preferenceChanges", "nonDustFilterChanges", "filterEnvelopeChanges"]) assert.deepEqual(report.preservation[key], []);
        }
        if (scenario === "cancel") assert(report.cancelled && !report.dispatchRecords);
        if (scenario === "false-return") assert.equal(report.sdkReturn.result, false);
        if (scenario === "sdk-error") {
            assert.equal(report.sdkReturn.returned, false);
            assert.match(report.sdkReturn.failure, /paste failed/); assert.doesNotMatch(report.sdkReturn.failure, /private/);
            assert.equal(report.finished, true, "Observe possible side effects after an ambiguous SDK exception");
        }
        if (scenario === "unrelated-change" || scenario === "transient-change") assert.deepEqual(report.preservation.unrelatedDevelopFieldsChanged, ["Exposure2012"]);
        if (scenario === "mask-change" || scenario === "large-mask-change") assert.deepEqual(report.preservation.unrelatedDevelopFieldsChanged, ["MaskGroupBasedCorrections"]);
        if (scenario === "large-mask" || scenario === "large-mask-change") assert(report.readableSummariesTruncated.includes("MaskGroupBasedCorrections"));
        if (scenario === "manual-change" || scenario === "manual-id-change") assert(report.preservation.manualChanges.length > 0);
        if (scenario === "ai-change") assert(report.preservation.nonDustFilterChanges.length > 0);
        if (scenario === "preference-change") assert(report.preservation.preferenceChanges.length > 0);
        if (scenario === "ai-pending-after") assert.equal(report.aiNeedsUpdateLast, true);
        if (scenario === "success") {
            const source = JSON.parse(lines.trim().split(/\r?\n/).find(line => JSON.parse(line).stage === "sample"));
            source.snapshot.selectedPhotoUuid = "source-photo";
            const paired = summarize(lines, JSON.stringify(source));
            assert.equal(paired.sourceComparison.differentPhoto, true);
            assert.equal(paired.freshDetectionConfirmed, false, "Different identities never prove fresh detection");
        }
    } catch (error) { throw Error(scenario + ": " + error.message); }
    finally { sdk.close(); }
}
const source = fs.readFileSync("lightroom/LRBridge.lrplugin/TestDustPaste.lua", "utf8");
assert.equal((source.match(/photo:pasteSettings\(true\)/g) || []).length, 1);
for (const file of ["TestDustPaste.lua", "DustPasteDiagnostics.lua"]) {
    assert.doesNotMatch(fs.readFileSync("lightroom/LRBridge.lrplugin/" + file, "utf8"),
        /[:.]\s*(applyDevelopSettings|applyDevelopPreset|copySettings|updateAISettings|setValue|selectTool|goToRemove|setRemovePanelPreferences|setSelectedPhotos)\s*\(/);
}
console.log("Dust SDK paste: " + selected.length + " explicit preparation, one-shot dispatch, stale destination, preservation, failure and no-retry scenarios passed.");
