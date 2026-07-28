const sliderMetadata = require("../config/sliders.json");

const sliderMap = {};
const runtimeRanges = {};

for (const slider of sliderMetadata) {
    sliderMap[slider.id] = slider;
}

function getAll() {
    return sliderMetadata.map(function (slider) {
        const range = runtimeRanges[slider.id];
        return range ? Object.assign({}, slider, range) : slider;
    });
}

function getIds() {
    return sliderMetadata.map(function (slider) {
        return slider.id;
    });
}

function getGroups() {
    const groups = [];

    for (const slider of sliderMetadata) {
        if (!groups.includes(slider.group)) {
            groups.push(slider.group);
        }
    }

    return groups;
}

function exists(sliderId) {
    return sliderMap[sliderId] !== undefined;
}

function getById(sliderId) {
    return sliderMap[sliderId] || null;
}

function getDefaultValue(sliderId) {
    const slider = getById(sliderId);

    if (slider === null) {
        return null;
    }

    return slider.default;
}

function setRuntimeRange(sliderId, min, max) {
    if (!exists(sliderId) || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) return false;
    runtimeRanges[sliderId] = { min: min, max: max };
    return true;
}

function getEffectiveRange(sliderId) {
    const slider = getById(sliderId);
    if (slider === null) return null;
    return runtimeRanges[sliderId] || { min: slider.min, max: slider.max };
}

function decimalPlaces(step) {
    const text = String(step);
    return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

function parseAbsoluteValue(sliderId, rawValue) {
    const slider = getById(sliderId);
    if (slider === null || typeof rawValue !== "string") return null;

    const precision = decimalPlaces(slider.numericStep);
    const pattern = precision === 0
        ? /^-?\d+$/
        : new RegExp("^-?\\d+(?:\\.\\d{1," + precision + "})?$");

    if (!pattern.test(rawValue)) return null;

    const value = Number(rawValue);
    return isValidAbsoluteValue(sliderId, value) ? value : null;
}

function isValidAbsoluteValue(sliderId, value) {
    const slider = getById(sliderId);
    const range = getEffectiveRange(sliderId);
    if (
        slider === null ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < range.min ||
        value > range.max
    ) {
        return false;
    }

    const scaled = (value - range.min) / slider.numericStep;
    return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

module.exports = {
    getAll,
    getIds,
    getGroups,
    exists,
    getById,
    getDefaultValue,
    setRuntimeRange,
    getEffectiveRange,
    parseAbsoluteValue,
    isValidAbsoluteValue
};
