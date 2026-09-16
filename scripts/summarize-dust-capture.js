"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function summarize(text) {
    const records = text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const samples = records.filter(record => record.snapshot?.available === true);
    if (!samples.length) throw Error("No valid native Dust samples were captured.");
    const first = samples[0].snapshot;
    const changes = [];
    const preferenceChanges = [], selectedToolChanges = [];
    let previous = first;
    for (const record of samples.slice(1)) {
        const current = record.snapshot;
        if (current.selectedPhotoUuid !== first.selectedPhotoUuid) throw Error("Capture contains more than one photo.");
        const fields = [...new Set([...Object.keys(previous.settings), ...Object.keys(current.settings)])].sort();
        const changed = fields.filter(key => previous.settings[key]?.hash !== current.settings[key]?.hash);
        if (changed.length) changes.push({ sample: record.sample, at: record.at, fields: changed,
            values: Object.fromEntries(changed.map(key => [key, { before: previous.settings[key], after: current.settings[key] }])) });
        if (previous.preferences?.hash !== current.preferences?.hash) preferenceChanges.push({ sample: record.sample, at: record.at,
            before: previous.preferences, after: current.preferences });
        if (previous.selectedTool !== current.selectedTool) selectedToolChanges.push({ sample: record.sample, at: record.at,
            before: previous.selectedTool, after: current.selectedTool });
        previous = current;
    }
    return { samples: samples.length, finished: records.some(record => record.stage === "finished"),
        version: first.sdkVersion, methods: first.methods, changes, preferenceChanges, selectedToolChanges,
        presetCaptures: records.filter(record => record.stage === "dust_presets").map(record => ({ at: record.at, ...record.snapshot?.presetInventory })),
        truncatedFields: [...new Set(samples.flatMap(record => Object.entries(record.snapshot.settings)
            .filter(([, value]) => value.truncated).map(([key]) => key)))],
        stoppedReason: records.find(record => record.snapshot?.available === false)?.snapshot.reason || null };
}
if (require.main === module) {
    try {
        const file = process.argv[2] || fs.readdirSync(os.tmpdir()).filter(name => /^lrbridge-dust-capture-.*\.jsonl$/.test(name))
            .map(name => path.join(os.tmpdir(), name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
        if (!file) throw Error("No Dust capture found. Run the read-only Lightroom plug-in capture first.");
        console.log(JSON.stringify({ file, ...summarize(fs.readFileSync(file, "utf8")) }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { summarize };
