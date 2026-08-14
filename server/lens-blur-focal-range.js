"use strict";

const COMPONENTS = Object.freeze([
    "nearOuter",
    "nearInner",
    "farInner",
    "farOuter"
]);
const PARTS = Object.freeze(["whole", "near", "far"]);
const TOKEN_PATTERN = /^[+-]?\d+$/;
const MAX_ABSOLUTE_COMPONENT = 1_000_000;

function parseComponent(value) {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && Math.abs(value) <= MAX_ABSOLUTE_COMPONENT ? value : null;
    }
    if (typeof value !== "string" || value === "" || value.trim() !== value || !TOKEN_PATTERN.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && Math.abs(parsed) <= MAX_ABSOLUTE_COMPONENT ? parsed : null;
}

function isOrdered(range) {
    return range.nearOuter <= range.nearInner &&
        range.nearInner <= range.farInner &&
        range.farInner <= range.farOuter;
}

function create(values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) return null;
    const range = {};
    for (const component of COMPONENTS) {
        const parsed = parseComponent(values[component]);
        if (parsed === null) return null;
        range[component] = parsed;
    }
    return isOrdered(range) ? range : null;
}

function parse(value) {
    if (typeof value !== "string" || value === "" || value.trim() !== value ||
        !/^[+-]?\d+(?: [+-]?\d+){3}$/.test(value)) return null;
    const tokens = value.split(" ");
    if (tokens.length !== COMPONENTS.length) return null;
    const input = {};
    COMPONENTS.forEach(function (component, index) { input[component] = tokens[index]; });
    return create(input);
}

function format(value) {
    const range = create(value);
    return range === null ? null : COMPONENTS.map(function (component) { return range[component]; }).join(" ");
}

function equal(left, right) {
    const leftString = typeof left === "string" ? format(parse(left)) : format(left);
    const rightString = typeof right === "string" ? format(parse(right)) : format(right);
    return leftString !== null && leftString === rightString;
}

function translate(value, part, delta) {
    const range = typeof value === "string" ? parse(value) : create(value);
    const amount = parseComponent(delta);
    if (range === null || amount === null || !PARTS.includes(part)) return null;
    const translated = Object.assign({}, range);
    if (part === "whole" || part === "near") {
        translated.nearOuter += amount;
        translated.nearInner += amount;
    }
    if (part === "whole" || part === "far") {
        translated.farInner += amount;
        translated.farOuter += amount;
    }
    return create(translated);
}

module.exports = Object.freeze({
    COMPONENTS,
    PARTS,
    MAX_ABSOLUTE_COMPONENT,
    parseComponent,
    isOrdered,
    create,
    parse,
    format,
    equal,
    translate
});
