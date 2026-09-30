"use strict";
// Offline comparison of user-supplied images and their measured graph points.
// No Lightroom connection, screenshot capture, formula fitting or photo edits.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const after = require("../app/controller-tone-curve");
function at(segments, x) {
    const s = segments.find(s => x <= s.x1) || segments.at(-1), t = (x-s.x0)/(s.x1-s.x0), u = 1-t;
    return (u*u*u*s.y0+3*u*u*t*s.c1y+3*u*t*t*s.c2y+t*t*t*s.y1)/2.55;
}
function compare(before, captureDirectory, outputDirectory, measurements) {
    const fields = Object.values(after.PARAMETRIC_CURVE_FIELDS), metrics = [];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="1390" viewBox="0 0 1360 1390">
<rect width="100%" height="100%" fill="#111a23"/>
<style>text{font-family:Arial,sans-serif;fill:#edf2f7}.note{fill:#b9c7d5}.before{stroke:#ff846f;stroke-width:1.5;fill:none;stroke-dasharray:4 2}.after{stroke:#41dbc4;stroke-width:1.3;fill:none}.native{stroke:#efc34e;stroke-width:1.3;fill:none}</style>
<text x="24" y="32" font-size="23">Parametric preview — October 1 native Lightroom comparisons</text>
<text x="24" y="62" font-size="15">Left: supplied Lightroom graph · Right: measured native line (yellow), previous preview (orange), corrected preview (teal)</text>
<text x="24" y="88" class="note" font-size="14">Matching SDK values verified before/after each crop. No model coefficients fitted to these six cases. Errors use the 0–100 output scale.</text>`;
    for (const [i, reference] of measurements.entries()) {
        const bytes = fs.readFileSync(path.join(captureDirectory, reference.id + ".png"));
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== reference.imageSha256) throw Error("Image hash mismatch: " + reference.id);
        const metadata = JSON.parse(fs.readFileSync(path.join(captureDirectory, reference.id + ".json")));
        if (JSON.stringify(metadata.testCase.values) !== JSON.stringify(reference.values) ||
            JSON.stringify(metadata.testCase.rgb) !== JSON.stringify(reference.rgbCurve)) throw Error("Reference metadata mismatch: " + reference.id);
        const a = after.parametricDisplaySegments(reference.values, reference.rgbCurve), b = before.parametricDisplaySegments(reference.values, reference.rgbCurve);
        const score = segments => { const errors = reference.samples.map(([x,y]) => at(segments,x*2.55)-y);
            return { max: Math.max(...errors.map(Math.abs)), rmse: Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length) }; };
        const result = { id: reference.id, measuredColumns: reference.samples.length, before: score(b), after: score(a), tolerance: reference.tolerance };
        metrics.push(result);
        const frame = reference.frame, width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        const nativePath = reference.samples.map(([x,y],i) => `${i?'L':'M'} ${x*2.55} ${255-y*2.55}`).join(" ");
        svg += `<g transform="translate(${20+(i%2)*670},${110+Math.floor(i/2)*425})">
<text x="0" y="20" font-size="20">${reference.id}</text>
<text x="0" y="43" class="note" font-size="13">S/D/L/H ${fields.slice(0,4).map(f=>reference.values[f]).join('/')} · Splits ${fields.slice(4).map(f=>reference.values[f]).join('/')}</text>
<svg x="0" y="62" width="280" height="280" viewBox="${frame.left} ${frame.top} ${frame.right-frame.left} ${frame.bottom-frame.top}"><image width="${width}" height="${height}" href="data:image/png;base64,${bytes.toString('base64')}"/></svg>
<svg x="320" y="62" width="280" height="280" viewBox="0 0 255 255"><defs><clipPath id="c${i}"><rect width="255" height="255"/></clipPath></defs><rect width="255" height="255" fill="#081018" stroke="#7d8b99"/>
<g stroke="#263341" stroke-width=".6">${[63.75,127.5,191.25].map(v=>`<path d="M ${v} 0 V 255 M 0 ${v} H 255"/>`).join('')}<path d="M 0 255 L 255 0" stroke-dasharray="2 3"/></g>
<g clip-path="url(#c${i})"><path class="before" d="${before.parametricCurvePathData(reference.values,reference.rgbCurve)}"/><path class="native" d="${nativePath}"/><path class="after" d="${after.parametricCurvePathData(reference.values,reference.rgbCurve)}"/></g></svg>
<text x="0" y="369" font-size="15">Maximum error: ${result.before.max.toFixed(2)} → ${result.after.max.toFixed(2)} / 100</text>
<text x="0" y="392" class="note" font-size="13">RMS error: ${result.before.rmse.toFixed(2)} → ${result.after.rmse.toFixed(2)} · ${reference.samples.length} measured columns</text></g>`;
    }
    svg += "</svg>";
    fs.mkdirSync(outputDirectory,{recursive:true});
    fs.writeFileSync(path.join(outputDirectory,"native-before-after.svg"),svg);
    fs.writeFileSync(path.join(outputDirectory,"native-comparison.json"),JSON.stringify(metrics,null,2));
    return metrics;
}
module.exports = { compare };
if (require.main === module) {
    const [before, captures, output, measured] = process.argv.slice(2);
    if (!before || !captures || !output) throw Error("Usage: node scripts/compare-parametric-native.js <before-module> <native-capture-dir> <output-dir> [full-measurements-json]");
    const rows = measured ? JSON.parse(fs.readFileSync(measured)) : require("../tests/fixtures/parametric-lightroom-native-20261001.json").cases;
    console.log(JSON.stringify(compare(require(path.resolve(before)),path.resolve(captures),path.resolve(output),rows),null,2));
}
