"use strict";
const fs = require("node:fs");
const { summarize: summarizeCapture } = require("./summarize-dust-capture");
const { dustRegions } = require("./summarize-dust-paste");
const parse = text => text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
function compare(before, row) {
    const a = before.pasteEvidence, b = row.snapshot.pasteEvidence;
    return { stage: row.stage, at: row.at, sample: row.sample, tool: row.snapshot.selectedTool,
        dustCount: b?.dustCount ?? null,
        unrelatedSettingsChanged: b ? [...new Set([...Object.keys(a.settings), ...Object.keys(b.settings)])]
            .filter(k => k !== "FilterList" && a.settings[k] !== b.settings[k]).sort() : null,
        manualUnchanged: b ? a.manualToken === b.manualToken : null,
        preferencesUnchanged: b ? a.preferencesToken === b.preferencesToken : null,
        otherFiltersUnchanged: b ? a.nonDustFiltersToken === b.nonDustFiltersToken : null,
        filterEnvelopeUnchanged: b ? a.filterEnvelopeToken === b.filterEnvelopeToken : null,
        needsAIUpdate: b?.needsAIUpdate ?? null,
        preservationUnavailable: row.detail?.preservationUnavailable ?? null };
}
function summarize(text, sourceText) {
    const rows = parse(text), baseline = rows.find(r => r.stage === "baseline")?.snapshot;
    if (!baseline?.available || !baseline.pasteEvidence) throw Error("No valid preset proof baseline.");
    const capture = summarizeCapture(text);
    const on = rows.find(r => r.stage === "on_readback");
    const sdk = rows.filter(r => ["validated", "sdk_sample", "on_readback"].includes(r.stage) && r.snapshot?.available);
    const native = rows.filter(r => r.stage === "native_sample" && r.snapshot?.available);
    const report = { mode: "sdk-preset-and-native-buttons", validBaseline: true,
        finished: rows.some(r => r.stage === "finished"), cancelled: rows.some(r => r.stage === "cancelled"),
        stopped: rows.find(r => r.stage === "stopped")?.detail ?? null,
        dispatchRecords: rows.filter(r => r.stage === "preset_invoking").length,
        sdkReturn: rows.find(r => r.stage === "preset_returned")?.detail ?? null,
        onReadbackRecorded: Boolean(on), sdkComparisons: sdk.map(r => compare(baseline, r)),
        nativeComparisons: on ? native.map(r => compare(on.snapshot, r)) : [],
        developChanges: capture.changes.map(({ sample, at, fields }) => ({ sample, at, fields })),
        preferenceChanges: capture.preferenceChanges, selectedToolChanges: capture.selectedToolChanges,
        destinationDustOn: on ? dustRegions(on.snapshot) : [],
        nativeResetMeaningConfirmed: false, nativeCloseMeaningConfirmed: false,
        freshDetectionConfirmed: false, visualRemoval: "unassessed",
        limitation: "Interpret native actions with the user's observed sequence. SDK return and filter presence alone do not prove fresh detection or the native checkbox. No photo-quality verdict is required." };
    if (sourceText) {
        // The controls capture finishes with Apply OFF: compare against its last Dust-bearing sample.
        const source = parse(sourceText).filter(r => r.snapshot?.available && dustRegions(r.snapshot).length).at(-1);
        if (!source) throw Error("Source capture has no valid Dust-bearing sample.");
        report.sourceComparison = { sourceAt: source.at, sourceSample: source.sample,
            differentPhoto: source.snapshot.selectedPhotoUuid !== baseline.selectedPhotoUuid,
            sourceDust: dustRegions(source.snapshot), destinationDust: report.destinationDustOn };
    }
    return report;
}
if (require.main === module) {
    try {
        const [file, source] = process.argv.slice(2);
        if (!file) throw Error("Usage: node scripts/summarize-dust-preset.js <exact-preset-capture> [exact-controls-source-capture]");
        console.log(JSON.stringify({ file, ...summarize(fs.readFileSync(file, "utf8"), source ? fs.readFileSync(source, "utf8") : undefined) }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { summarize, compare };
