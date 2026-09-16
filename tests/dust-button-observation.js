"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const { runtime } = require("./masking-create");
const { summarize } = require("../scripts/summarize-dust-button");
const scenarios = ["no-click", "long-wait-no-click", "library", "reset-dust-only", "reset-all-healing", "close", "close-unreadable",
    "close-after-reset", "other-menu", "finish-at-ready", "competing-diagnostic", "photo-change", "module-change", "command-change",
    "missing-photo", "no-dust", "no-manual", "tool-closed", "pending-ai", "settings-unavailable", "file-open", "file-write",
    "file-flush", "file-close", "busy"];
const requested = process.argv.slice(2), selected = requested.length ? requested : scenarios;
for (const name of selected) {
    assert(scenarios.includes(name));
    const sdk = runtime();
    try {
        sdk.set("dustButtonScenario", name); sdk.run(fs.readFileSync("tests/dust-button-observation.lua", "utf8"));
        const text = sdk.result();
        if (!text.includes('"stage":"baseline"')) continue;
        const report = summarize(text);
        assert.equal(report.buttonClickConfirmed, false); assert.equal(report.meaningConfirmed, false);
        if (["no-click", "long-wait-no-click", "finish-at-ready"].includes(name)) {
            assert(report.finished); assert.deepEqual(report.developChanges, []); assert.deepEqual(report.selectedToolChanges, []);
            assert(report.comparisons.every(r => r.dustCount === 1 && r.manualUnchanged));
            const partial = summarize(text + '{"stage":');
            assert(partial.incompleteTail); assert.deepEqual(partial.developChanges, []);
        }
        if (name.startsWith("reset-")) {
            assert(report.finished); assert.equal(report.comparisons.at(-1).dustCount, 0);
            assert.equal(report.comparisons.at(-1).manualUnchanged, name === "reset-dust-only");
        }
        if (name.startsWith("close")) {
            assert(report.finished); assert.deepEqual(report.selectedToolChanges.map(r => [r.before, r.after]), [["dust", "loupe"]]);
            if (name === "close-unreadable") assert.equal(report.comparisons.at(-1).manualUnchanged, null);
            else assert.equal(report.comparisons.at(-1).manualUnchanged, true);
        }
        if (["photo-change", "module-change", "command-change"].includes(name)) {
            assert(!report.finished); assert(report.stopped);
        }
    } catch (error) { throw Error(name + ": " + error.message); }
    finally { sdk.close(); }
}
for (const file of ["DustButtonObservation.lua", "ObserveDustReset.lua", "ObserveDustClose.lua"]) {
    assert.doesNotMatch(fs.readFileSync("lightroom/LRBridge.lrplugin/" + file, "utf8"),
        /[:.]\s*(applyDevelopPreset|applyDevelopSettings|pasteSettings|copySettings|updateAISettings|selectTool|goToRemove|resetSpotRemoval|resetToDefault|setValue|setSelectedPhotos|setRemovePanelPreferences)\s*\(/);
}
console.log("Dust button observation: " + selected.length + " read-only, user-ended, no-click, individual-action, context and failure cases passed.");
