const fs = require("node:fs");
const path = require("node:path");

const regionNames = ["shadows", "midtones", "highlights", "global"];
const scalarSpecs = [
    ["shadow_luminance", "shadows"], ["midtone_luminance", "midtones"],
    ["highlight_luminance", "highlights"], ["global_luminance", "global"],
    ["blending", null], ["balance", null]
];
const expectedViews = ["3-way", "shadow", "midtone", "highlight", "global"];
const metadataPath = path.join(__dirname, "..", "lightroom", "LRBridge.lrplugin", "color-grading.properties");

function parseMetadata(text) {
    if (typeof text !== "string") throw new Error("Invalid Color Grading metadata text");
    const values = Object.create(null);
    const allowed = new Set(["runtimeRangeRequired", "feedbackSupported", "resetSupported"]);
    for (const region of regionNames) for (const field of ["label", "hue", "saturation", "luminance"]) allowed.add(`region.${region}.${field}`);
    for (const [control, region] of scalarSpecs) {
        allowed.add(`scalar.${control}.label`); allowed.add(`scalar.${control}.parameter`);
        if (region) allowed.add(`scalar.${control}.region`);
    }
    for (let index = 1; index <= expectedViews.length; index += 1) allowed.add(`view.${index}`);

    text.split(/\r?\n/).forEach(function (source, index) {
        const line = source.trim();
        if (!line || line.startsWith("#")) return;
        const separator = line.indexOf("=");
        if (separator <= 0 || separator !== line.lastIndexOf("=")) throw new Error(`Malformed Color Grading metadata line ${index + 1}`);
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!/^[A-Za-z0-9_.-]+$/.test(key) || !value) throw new Error(`Malformed Color Grading metadata line ${index + 1}`);
        if (!allowed.has(key)) throw new Error(`Unknown Color Grading metadata key: ${key}`);
        if (Object.hasOwn(values, key)) throw new Error(`Duplicate Color Grading metadata key: ${key}`);
        values[key] = value;
    });
    for (const key of allowed) if (!Object.hasOwn(values, key)) throw new Error(`Missing Color Grading metadata key: ${key}`);

    const metadata = { regions: {}, scalarControls: {}, views: [] };
    const identifiers = new Set();
    for (const region of regionNames) {
        const item = { label: values[`region.${region}.label`] };
        for (const field of ["hue", "saturation", "luminance"]) {
            const parameter = values[`region.${region}.${field}`];
            if (!/^[A-Za-z][A-Za-z0-9]*$/.test(parameter) || identifiers.has(parameter)) throw new Error(`Invalid or duplicate Adobe parameter: ${parameter}`);
            identifiers.add(parameter); item[field] = parameter;
        }
        metadata.regions[region] = item;
    }
    for (const [control, region] of scalarSpecs) {
        const definition = { label: values[`scalar.${control}.label`], parameter: values[`scalar.${control}.parameter`] };
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(definition.parameter)) throw new Error(`Invalid Adobe parameter: ${definition.parameter}`);
        if (region) {
            if (values[`scalar.${control}.region`] !== region || definition.parameter !== metadata.regions[region].luminance) throw new Error(`Invalid regional scalar mapping: ${control}`);
            definition.region = region;
        } else {
            if (identifiers.has(definition.parameter)) throw new Error(`Duplicate Adobe parameter: ${definition.parameter}`);
            identifiers.add(definition.parameter);
        }
        metadata.scalarControls[control] = definition;
    }
    if (identifiers.size !== 14) throw new Error("Color Grading metadata must contain fourteen unique Adobe parameters");
    metadata.views = expectedViews.map(function (view, index) {
        if (values[`view.${index + 1}`] !== view) throw new Error(`Invalid Color Grading view ${index + 1}`);
        return view;
    });
    for (const field of ["runtimeRangeRequired", "feedbackSupported", "resetSupported"]) {
        if (values[field] !== "true" && values[field] !== "false") throw new Error(`Invalid Boolean metadata: ${field}`);
        metadata[field] = values[field] === "true";
    }
    return metadata;
}

const metadata = parseMetadata(fs.readFileSync(metadataPath, "utf8"));

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

module.exports = { metadata, metadataPath, parseMetadata, regions, scalarControls, getParameterIds, setRuntimeRange, getRuntimeRange, clearRuntimeRanges, inRuntimeRange, getMetadata };
