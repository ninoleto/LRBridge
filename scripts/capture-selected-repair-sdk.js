"use strict";
// Read-only SDK evidence through LRBridge; no actions, tool changes or native UI access.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const endpoint = "http://127.0.0.1:17891/remove/diagnostics/selected-repair";
const reader = "healing-focus-1";
async function read() {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!response.ok) throw Error("Selected-repair SDK diagnostic endpoint returned HTTP " + response.status + ".");
    return response.json();
}
async function sequence(seconds = 180, label = "window-transition") {
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 900) throw Error("Sequence duration must be 10–900 seconds.");
    const first = await read();
    if (first.expectedReader !== reader || first.repair?.diagnostics?.reader !== reader || first.ageMs > 1500)
        throw Error("The extended diagnostic reader is not loaded or fresh. Verify bridge and plug-in feedback before capture.");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-selected-repair-sequence-"));
    const file = path.join(directory, "sequence.jsonl"), startedAt = Date.now();
    fs.writeFileSync(file, JSON.stringify({ event: "start", label, recordedAt: new Date(startedAt).toISOString(),
        sdkOnly: true, foreground: "not_observed", phaseSource: "User-reported window switches only", seconds }) + "\n");
    console.log(JSON.stringify({ armed: true, file, seconds, message: "Read-only SDK capture is running. Follow only the requested manual comparison." }));
    let samples = 0, previous = null;
    while (Date.now() - startedAt < seconds * 1000) {
        const requestedAt = new Date().toISOString();
        try {
            const current = await read();
            fs.appendFileSync(file, JSON.stringify({ event: "sample", requestedAt, receivedAt: new Date().toISOString(),
                elapsedMs: Date.now() - startedAt, freshNativeSample: current.capturedAt !== previous, ...current }) + "\n");
            previous = current.capturedAt; samples++;
        } catch (error) {
            fs.appendFileSync(file, JSON.stringify({ event: "read_error", requestedAt, receivedAt: new Date().toISOString(), error: error.message }) + "\n");
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    console.log(JSON.stringify({ complete: true, file, samples })); return { file, samples };
}
async function capture(label = "selected-repair") {
    const start = Date.now(); let previous = null;
    while (Date.now() - start < 10000) {
        const current = await read();
        if (current.sdkOnly && current.capturedAt >= start && current.ageMs < 1500 && !current.pendingOperation &&
            current.selectedTool === "dust" && current.repair) {
            const same = previous && previous.capturedAt < current.capturedAt && previous.selectedPhotoUuid === current.selectedPhotoUuid &&
                JSON.stringify(previous.repair) === JSON.stringify(current.repair);
            if (same) {
                const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-selected-repair-sdk-"));
                const file = path.join(directory, "capture.json");
                fs.writeFileSync(file, JSON.stringify({ label, recordedAt: new Date().toISOString(), source: "Lightroom SDK readback", ...current }, null, 2));
                console.log(JSON.stringify({ file, repair: current.repair }, null, 2)); return current;
            }
            previous = current;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error("No stable fresh selected-repair SDK snapshot. Keep one existing repair selected in Lightroom Develop and retry.");
}
function summarize(file) {
    const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch (_) { return []; } });
    const samples = entries.filter(row => row.event === "sample");
    let last = null, firstPhoto = samples[0]?.selectedPhotoUuid;
    const changes = [];
    for (const sample of samples) {
        if (!sample.freshNativeSample) continue;
        const repair = sample.repair || {}, diagnostic = repair.diagnostics || {};
        const errors = Object.fromEntries(Object.entries(diagnostic.getters || {}).filter(([, value]) => !value.ok).map(([key, value]) => [key, value.error]));
        const state = { photoChanged: sample.selectedPhotoUuid !== firstPhoto, module: diagnostic.activeModule || sample.activeModule,
            tool: sample.selectedTool, mode: diagnostic.newSpotType || sample.newSpotType, preferencesAvailable: sample.preferencesAvailable,
            available: repair.available, selected: repair.selected ?? null, index: repair.index, type: repair.spotType,
            useGenAI: repair.useGenAI, count: repair.count, errors, parameterNumbers: diagnostic.parameterNumbers,
            pending: sample.pendingOperation, lastResult: sample.lastResult, ageMs: sample.ageMs > 1500 ? "stale" : "fresh" };
        const key = JSON.stringify(state);
        if (key !== last) { changes.push({ at: new Date(sample.capturedAt).toISOString(), elapsedMs: sample.elapsedMs, ...state }); last = key; }
    }
    const result = { file, samples: samples.length, freshSamples: samples.filter(s => s.freshNativeSample).length,
        readErrors: entries.filter(r => r.event === "read_error"), changes };
    console.log(JSON.stringify(result, null, 2)); return Promise.resolve(result);
}
module.exports = { capture, sequence, summarize };
if (require.main === module) (process.argv[2] === "--summarize" ? summarize(process.argv[3]) :
    process.argv[2] === "--sequence" ? sequence(Number(process.argv[3] || 180), process.argv[4]) : capture(process.argv[2]))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
