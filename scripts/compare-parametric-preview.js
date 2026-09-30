"use strict";
// Exportable comparison against recorded native observations, not a formula
// round-trip. The original measurements/tolerances are never generated here.
const fs = require("node:fs"), path = require("node:path");
const after = require("../app/controller-tone-curve");
const observed = require("../tests/fixtures/parametric-lightroom-graphs.json");
const native = require("../tests/fixtures/parametric-lightroom-native-20261001.json").cases;
function at(segments, x) {
    const s = segments.find(s => x <= s.x1) || segments.at(-1), t = (x-s.x0)/(s.x1-s.x0), u = 1-t;
    return (u*u*u*s.y0+3*u*u*t*s.c1y+3*u*t*t*s.c2y+t*t*t*s.y1)/2.55;
}
function compare(before, directory) {
    const fields = Object.values(after.PARAMETRIC_CURVE_FIELDS);
    const cases = observed.concat(native.map(reference => ({ ...reference, id:"Oct 1 " + reference.id, role:"validation" })));
    const metrics = [];
    const height = 116 + Math.ceil(cases.length/3)*360;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="${height}" viewBox="0 0 1260 ${height}"><rect width="100%" height="100%" fill="#111a23"/>
<style>text{font-family:Arial,sans-serif;fill:#edf2f7}.note{fill:#b9c7d5}.before{stroke:#ff846f;stroke-width:1.5;fill:none;stroke-dasharray:4 2}.after{stroke:#41dbc4;stroke-width:1.4;fill:none}.native{stroke:#efc34e;fill:#efc34e}</style>
<text x="24" y="34" font-size="24">Parametric preview — recorded Lightroom references and candidate</text>
<text x="24" y="65" font-size="16">Orange dashed: previous preview · Teal: candidate · Yellow: Lightroom samples (±2.5 output units)</text>
<text x="24" y="91" class="note" font-size="14">C–H calibrated two shared slope-scale constants. A/B/stress and all six October 1 native graphs were excluded from fitting.</text>`;
    for (const [i, f] of cases.entries()) {
        const x=20+(i%3)*415, y=116+Math.floor(i/3)*360;
        const b=before.parametricDisplaySegments(f.values,f.rgbCurve), a=after.parametricDisplaySegments(f.values,f.rgbCurve);
        const score=segments=>f.samples.length?Math.max(...f.samples.map(([x,y])=>Math.abs(at(segments,x*2.55)-y))):null;
        metrics.push({id:f.id,role:f.role,beforeMax:score(b),afterMax:score(a),tolerance:f.tolerance??null});
        const caption=f.samples.length?`Max error: ${score(b).toFixed(2)} → ${score(a).toFixed(2)} / 100`:'No measured graph yet — shape correction is not parity evidence';
        svg+=`<g transform="translate(${x},${y})"><text x="0" y="19" font-size="19">${f.id} · ${f.role.startsWith('validation')?'validation':f.role}</text>
<text x="0" y="42" class="note" font-size="12">S/D/L/H ${fields.slice(0,4).map(k=>f.values[k]).join('/')} · splits ${fields.slice(4).map(k=>f.values[k]).join('/')}</text>
<svg x="32" y="55" width="260" height="260" viewBox="0 0 255 255"><defs><clipPath id="clip-${i}"><rect width="255" height="255"/></clipPath></defs><rect width="255" height="255" fill="#081018" stroke="#7d8b99"/>
<g stroke="#263341" stroke-width=".5">${[63.75,127.5,191.25].map(v=>`<path d="M ${v} 0 V 255 M 0 ${v} H 255"/>`).join('')}<path d="M 0 255 L 255 0" stroke-dasharray="2 3"/></g>
<g clip-path="url(#clip-${i})"><path class="before" d="${before.parametricCurvePathData(f.values,f.rgbCurve)}"/><path class="after" d="${after.parametricCurvePathData(f.values,f.rgbCurve)}"/>
${f.samples.map(([x,y])=>`<path class="native" opacity=".45" stroke-width=".6" d="M ${x*2.55} ${255-(y+f.tolerance)*2.55} V ${255-(y-f.tolerance)*2.55}"/><circle class="native" r="1.8" cx="${x*2.55}" cy="${255-y*2.55}"/>`).join('')}</g></svg>
<text x="0" y="336" class="note" font-size="12">${caption}</text></g>`;
    }
    svg+='</svg>';
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'before-after.svg'),svg);
    fs.writeFileSync(path.join(directory,'comparison.json'),JSON.stringify(metrics,null,2));
    return metrics;
}
module.exports={compare};
if(require.main===module){
    if(!process.argv[2]||!process.argv[3])throw Error('Usage: node scripts/compare-parametric-preview.js <preserved-before-module> <output-directory>');
    console.log(JSON.stringify(compare(require(path.resolve(process.argv[2])),path.resolve(process.argv[3])),null,2));
}
