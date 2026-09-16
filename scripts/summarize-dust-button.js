"use strict";
const fs = require("node:fs");
const { summarize: summarizeCapture } = require("./summarize-dust-capture");
const { compare } = require("./summarize-dust-preset");
function summarize(text) {
    // An active observation is flushed per record. Mark an incomplete final write explicitly.
    const incompleteTail = Boolean(text && !text.endsWith("\n"));
    const completeText = incompleteTail ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
    const rows = completeText.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const launch = rows.find(r => r.stage === "launch"), baseline = rows.find(r => r.stage === "baseline")?.snapshot;
    if (launch?.detail?.mode !== "read-only-single-button" || !baseline?.available || !baseline.pasteEvidence) {
        throw Error("No valid read-only button observation baseline.");
    }
    const capture = summarizeCapture(completeText);
    return { mode: launch.detail.mode, intendedButton: launch.detail.intendedButton, validBaseline: true,
        records: rows.length, start: launch.at, last: rows.at(-1)?.at, incompleteTail,
        finished: rows.some(r => r.stage === "finished"), stopped: rows.find(r => r.stage === "stopped")?.detail ?? null,
        comparisons: rows.filter(r => ["sample", "final"].includes(r.stage) && r.snapshot?.available).map(r => compare(baseline, r)),
        developChanges: capture.changes.map(({ sample, at, fields }) => ({ sample, at, fields })),
        preferenceChanges: capture.preferenceChanges, selectedToolChanges: capture.selectedToolChanges,
        truncatedFields: capture.truncatedFields,
        buttonClickConfirmed: false, meaningConfirmed: false,
        limitation: "The menu names the intended button only. Confirm the user's actual action before interpreting its scope; no change or a finished file does not prove a click." };
}
if (require.main === module) {
    try {
        const file = process.argv[2];
        if (!file) throw Error("Usage: node scripts/summarize-dust-button.js <exact-reset-or-close-capture>");
        console.log(JSON.stringify({ file, ...summarize(fs.readFileSync(file, "utf8")) }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { summarize };
