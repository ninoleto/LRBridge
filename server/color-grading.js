const metadata = require("../lightroom/LRBridge.lrplugin/color-grading.json");

const runtimeRanges = Object.create(null);
const regions = Object.keys(metadata.regions);
const scalarControls = Object.keys(metadata.scalarControls);

function getParameterIds() {
    const ids = [];
    for (const region of regions) {
        const item = metadata.regions[region];
        ids.push(item.hue, item.saturation, item.luminance);
    }
    ids.push(metadata.scalarControls.blending.parameter, metadata.scalarControls.balance.parameter);
    return ids;
}

function setRuntimeRange(parameter, min, max) {
    if (!getParameterIds().includes(parameter) || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) return false;
    runtimeRanges[parameter] = { min, max };
    return true;
}

function getRuntimeRange(parameter) { return runtimeRanges[parameter] || null; }
function clearRuntimeRanges() { for (const key of Object.keys(runtimeRanges)) delete runtimeRanges[key]; }
function validNumber(value) { return typeof value === "number" && Number.isFinite(value); }
function inRuntimeRange(parameter, value) {
    if (!validNumber(value)) return false;
    const range = getRuntimeRange(parameter);
    return !range || (value >= range.min && value <= range.max);
}
function getMetadata() {
    const copy = JSON.parse(JSON.stringify(metadata));
    for (const parameter of getParameterIds()) {
        const range = getRuntimeRange(parameter);
        if (range) {
            if (!copy.runtimeRanges) copy.runtimeRanges = {};
            copy.runtimeRanges[parameter] = range;
        }
    }
    return copy;
}

module.exports = { metadata, regions, scalarControls, getParameterIds, setRuntimeRange, getRuntimeRange, clearRuntimeRanges, inRuntimeRange, getMetadata };
