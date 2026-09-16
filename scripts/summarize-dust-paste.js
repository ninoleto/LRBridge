"use strict";
const fs = require("node:fs");
const { summarize: summarizeCapture } = require("./summarize-dust-capture");

function decode(node) {
    if (node?.type !== "table") return node?.value ?? node;
    return Object.fromEntries(Object.entries(node.children || {}).map(([key, value]) => [key.replace(/^(string|number):/, ""), decode(value)]));
}
function dustRegions(snapshot) {
    const filters = decode(snapshot?.settings?.FilterList?.data)?.Filters || {};
    return Object.values(filters).filter(filter => filter.Name === "Dust Removal").map(filter => ({
        filterId: filter.FilterID, name: filter.Name,
        sourceBounds: [filter.SrcBoundsLeft, filter.SrcBoundsTop, filter.SrcBoundsRight, filter.SrcBoundsBottom],
        regions: Object.values(filter.Images || {}).map(image => ({
            bounds: [image.ReferenceImageAreaLeft, image.ReferenceImageAreaTop, image.ReferenceImageAreaRight, image.ReferenceImageAreaBottom],
            globalInputDigest: image.GlobalInputDigest, localInputDigest: image.LocalInputDigest
        }))
    }));
}
function summarize(text, sourceText) {
    const rows = text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const samples = rows.filter(row => row.snapshot?.available === true && row.snapshot.pasteEvidence);
    if (!samples.length || samples[0].stage !== "baseline") throw Error("No valid SDK proof baseline.");
    const baseline = samples[0].snapshot, last = samples.at(-1).snapshot;
    if (samples.some(row => row.snapshot.selectedPhotoUuid !== baseline.selectedPhotoUuid)) throw Error("Proof contains multiple destination photos.");
    const before = baseline.pasteEvidence;
    const changed = new Set(), manualChanges = [], preferenceChanges = [], filterChanges = [], envelopeChanges = [];
    for (const row of samples.slice(1)) {
        const current = row.snapshot.pasteEvidence;
        for (const key of new Set([...Object.keys(before.settings), ...Object.keys(current.settings)])) {
            if (key !== "FilterList" && before.settings[key] !== current.settings[key]) changed.add(key);
        }
        const stamp = { stage: row.stage, sample: row.sample, at: row.at };
        if (before.manualToken !== current.manualToken) manualChanges.push(stamp);
        if (before.preferencesToken !== current.preferencesToken) preferenceChanges.push(stamp);
        if (before.nonDustFiltersToken !== current.nonDustFiltersToken) filterChanges.push(stamp);
        if (before.filterEnvelopeToken !== current.filterEnvelopeToken) envelopeChanges.push(stamp);
    }
    const captures = summarizeCapture(text);
    const invokes = rows.filter(row => row.stage === "paste_invoking");
    const result = {
        mode: "single-sdk-paste", validBaseline: true, snapshots: samples.length,
        start: samples[0].at, end: samples.at(-1).at, finished: rows.some(row => row.stage === "finished"),
        cancelled: rows.some(row => row.stage === "cancelled"),
        clipboardConfirmation: rows.find(row => row.stage === "clipboard_confirmed")?.detail || null,
        dispatchRecords: invokes.length, sdkReturn: rows.find(row => row.stage === "paste_returned")?.detail || null,
        stopped: rows.find(row => row.stage === "stopped")?.detail || captures.stoppedReason || null,
        developChanges: captures.changes.map(({ sample, at, fields }) => ({ sample, at, fields })),
        readableSummariesTruncated: captures.truncatedFields,
        preservation: { comparison: "full-content fingerprints; any observed difference from baseline is retained",
            unrelatedDevelopFieldsChanged: [...changed].sort(), manualChanges, preferenceChanges, nonDustFilterChanges: filterChanges,
            filterEnvelopeChanges: envelopeChanges },
        aiNeedsUpdateBefore: before.needsAIUpdate, aiNeedsUpdateLast: last.pasteEvidence.needsAIUpdate,
        destinationDustBefore: dustRegions(baseline), destinationDustLast: dustRegions(last),
        visualRemovalConfirmed: false, freshDetectionConfirmed: false,
        limitation: "SDK return, differing IDs/regions and Apply state do not establish fresh detection or visible removal. Compare with the user's native observation."
    };
    if (sourceText) {
        const sourceRows = sourceText.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
        const source = sourceRows.filter(row => row.snapshot?.available === true).at(-1)?.snapshot;
        if (!source) throw Error("Source capture has no valid snapshot.");
        result.sourceComparison = { differentPhoto: source.selectedPhotoUuid !== baseline.selectedPhotoUuid,
            sourceDust: dustRegions(source), destinationDust: dustRegions(last),
            note: "These are repair-data observations, not proof of correct target detection. No source data was applied by this summarizer." };
    }
    return result;
}
if (require.main === module) {
    try {
        const [file, source] = process.argv.slice(2);
        if (!file) throw Error("Usage: node scripts/summarize-dust-paste.js <exact-proof-file> [exact-source-capture]");
        console.log(JSON.stringify({ file, ...summarize(fs.readFileSync(file, "utf8"), source ? fs.readFileSync(source, "utf8") : undefined) }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { summarize, dustRegions };
