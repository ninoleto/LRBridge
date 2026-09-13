"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pointColor = require("./point-color-state");
const pointCurve = require("./point-curve-state");

const MAX_PRESETS = 512;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_NODES = 4096;
const MAX_DEPTH = 12;
const MAX_PREFERENCES_BYTES = 2 * 1024 * 1024;
const SAFE_FILE = /^[^"\\/\u0000-\u001f\u007f]{1,180}\.lrtemplate$/i;
const SUPPORTED_VALUE_KEYS = new Set([
    "amount", "blacks2012", "bluecurve", "clarity2012", "contrast2012", "defringe", "dehaze",
    "exposure2012", "grain", "greencurve", "highlights2012", "hue", "luminanceNoise", "maincurve",
    "moire", "pointColors", "redcurve", "refineSaturation", "saturation", "shadows2012", "sharpness",
    "temperature", "texture", "tint", "toningHue", "toningSaturation", "whites2012"
]);
const LEGACY_VALUE_PAIRS = Object.freeze({ clarity: "clarity2012", contrast: "contrast2012", exposure: "exposure2012" });
const NATIVE_CORRECTION_PRESETS = Object.freeze([
    { id: "lp-native-temperature", name: "Temp", parameter: "local_Temperature",
        preference: "AgDevelop_localizedTemperatureLast", scale: 100 },
    { id: "lp-native-tint", name: "Tint", parameter: "local_Tint",
        preference: "AgDevelop_localizedTintLast", scale: 100 },
    { id: "lp-native-exposure", name: "Exposure", parameter: "local_Exposure",
        preference: "AgDevelop_localizedExposure2012Last", scale: 4 },
    { id: "lp-native-contrast", name: "Contrast", parameter: "local_Contrast",
        preference: "AgDevelop_localizedContrast2012Last", scale: 100 },
    { id: "lp-native-highlights", name: "Highlights", parameter: "local_Highlights",
        preference: "AgDevelop_localizedHighlights2012Last", scale: 100 },
    { id: "lp-native-shadows", name: "Shadows", parameter: "local_Shadows",
        preference: "AgDevelop_localizedShadows2012Last", scale: 100 },
    { id: "lp-native-whites", name: "Whites", parameter: "local_Whites",
        preference: "AgDevelop_localizedWhites2012Last", scale: 100 },
    { id: "lp-native-blacks", name: "Blacks", parameter: "local_Blacks",
        preference: "AgDevelop_localizedBlacks2012Last", scale: 100 },
    { id: "lp-native-texture", name: "Texture", parameter: "local_Texture",
        preference: "AgDevelop_localizedLocalTextureLast", scale: 100 },
    { id: "lp-native-clarity", name: "Clarity", parameter: "local_Clarity",
        preference: "AgDevelop_localizedClarity2012Last", scale: 100 },
    { id: "lp-native-dehaze", name: "Dehaze", parameter: "local_Dehaze",
        preference: "AgDevelop_localizedLocalDehazeLast", scale: 100 },
    // Native menu capture: this is Grain Amount, not the mask strength slider.
    { id: "lp-native-amount", name: "Amount", parameter: "local_Grain",
        preference: "AgDevelop_localizedGrainLast", scale: 100 },
    { id: "lp-native-hue", name: "Hue", parameter: "local_Hue",
        preference: "AgDevelop_localizedHueLast", scale: 180 },
    { id: "lp-native-saturation", name: "Saturation", parameter: "local_Saturation",
        preference: "AgDevelop_localizedSaturationLast", scale: 100 },
    { id: "lp-native-sharpness", name: "Sharpness", parameter: "local_Sharpness",
        preference: "AgDevelop_localizedSharpnessLast", scale: 100 },
    { id: "lp-native-noise-reduction", name: "Noise Reduction", parameter: "local_LuminanceNoise",
        preference: "AgDevelop_localizedLuminanceNoiseLast", scale: 100 },
    { id: "lp-native-moire", name: "Moiré", parameter: "local_Moire",
        preference: "AgDevelop_localizedMoireLast", scale: 100 },
    { id: "lp-native-defringe", name: "Defringe", parameter: "local_Defringe",
        preference: "AgDevelop_localizedDefringeLast", scale: 100 }
].map(function (entry) { return Object.freeze(entry); }));
const FILE_PRESET_ORDER = Object.freeze([
    "Burn (Darken)", "Dodge (Lighten)", "Iris Enhance", "Soften Skin (Lite)", "Soften Skin", "Teeth Whitening"
]);
const SCALAR_PRESET_MAPPINGS = Object.freeze({
    amount: { parameter: "local_Amount", scale: 100 },
    blacks2012: { parameter: "local_Blacks", scale: 100 },
    clarity2012: { parameter: "local_Clarity", scale: 100 },
    contrast2012: { parameter: "local_Contrast", scale: 100 },
    defringe: { parameter: "local_Defringe", scale: 100 },
    dehaze: { parameter: "local_Dehaze", scale: 100 },
    exposure2012: { parameter: "local_Exposure", scale: 4 },
    grain: { parameter: "local_Grain", scale: 100 },
    highlights2012: { parameter: "local_Highlights", scale: 100 },
    hue: { parameter: "local_Hue", scale: 180 },
    luminanceNoise: { parameter: "local_LuminanceNoise", scale: 100 },
    moire: { parameter: "local_Moire", scale: 100 },
    refineSaturation: { parameter: "local_RefineSaturation", scale: 1, min: 0, max: 100 },
    saturation: { parameter: "local_Saturation", scale: 100 },
    shadows2012: { parameter: "local_Shadows", scale: 100 },
    sharpness: { parameter: "local_Sharpness", scale: 100 },
    temperature: { parameter: "local_Temperature", scale: 100 },
    texture: { parameter: "local_Texture", scale: 100 },
    tint: { parameter: "local_Tint", scale: 100 },
    toningHue: { parameter: "local_ToningHue", scale: 1 },
    toningSaturation: { parameter: "local_ToningSaturation", scale: 100 },
    whites2012: { parameter: "local_Whites", scale: 100 }
});
function defaultPreferencesDirectory(environment) {
    const appData = environment && environment.APPDATA;
    return typeof appData === "string" && appData
        ? path.join(appData, "Adobe", "Lightroom", "Preferences") : null;
}

function parseApplicationPreferences(text) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_PREFERENCES_BYTES) return null;
    const values = Object.create(null);
    const pattern = /^\s*(AgDevelop_localized[A-Za-z0-9_]+)\s*=\s*([+-]?(?:(?:\d+\.?\d*)|(?:\d*\.\d+))(?:[eE][+-]?\d+)?)\s*,\s*$/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const value = Number(match[2]);
        if (Number.isFinite(value)) values[match[1]] = value;
    }
    return values;
}

function defaultDirectory(environment) {
    const appData = environment && environment.APPDATA;
    return typeof appData === "string" && appData
        ? path.join(appData, "Adobe", "Lightroom", "Local Adjustment Presets") : null;
}

function displayName(text, filename) {
    const internal = text.match(/\binternalName\s*=\s*"([^"\r\n]{1,160})"/);
    if (internal) return internal[1];
    const localized = text.match(/\btitle\s*=\s*ZSTR\s*"[^"\r\n]*=([^"\r\n]{1,160})"/);
    if (localized) return localized[1];
    return path.basename(filename, path.extname(filename));
}

function presetId(filename) {
    return "lp-" + crypto.createHash("sha256").update(filename, "utf8").digest("base64url").slice(0, 24);
}

function tokenize(text) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
        throw new Error("Preset is unavailable or too large");
    }
    const tokens = [];
    let cursor = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    function push(kind, value) {
        tokens.push(value === undefined ? { kind: kind } : { kind: kind, value: value });
        if (tokens.length > MAX_NODES * 4) throw new Error("Preset contains too much data");
    }
    while (cursor < text.length) {
        const remaining = text.slice(cursor);
        const whitespace = remaining.match(/^\s+/);
        if (whitespace) { cursor += whitespace[0].length; continue; }
        if (remaining.startsWith("--[[")) {
            const closing = text.indexOf("]]", cursor + 4);
            if (closing < 0) throw new Error("Unterminated preset comment");
            cursor = closing + 2; continue;
        }
        if (remaining.startsWith("--")) {
            const end = text.indexOf("\n", cursor + 2);
            cursor = end < 0 ? text.length : end + 1; continue;
        }
        const character = text[cursor];
        if ("{}=,;".includes(character)) { push(character); cursor += 1; continue; }
        if (character === '"' || character === "'") {
            const quote = character; cursor += 1; let value = ""; let closed = false;
            while (cursor < text.length) {
                const next = text[cursor++];
                if (next === quote) { closed = true; break; }
                if (next === "\\") {
                    if (cursor >= text.length) throw new Error("Unterminated preset string");
                    const escaped = text[cursor++];
                    const replacements = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"', "'": "'" };
                    if (!Object.prototype.hasOwnProperty.call(replacements, escaped)) {
                        throw new Error("Unsupported preset string escape");
                    }
                    value += replacements[escaped];
                } else {
                    if (/[\u0000-\u001f\u007f]/.test(next)) throw new Error("Invalid preset string");
                    value += next;
                }
            }
            if (!closed) throw new Error("Unterminated preset string");
            push("string", value); continue;
        }
        const number = remaining.match(/^[+-]?(?:(?:\d+\.?\d*)|(?:\d*\.\d+))(?:[eE][+-]?\d+)?/);
        if (number) {
            const value = Number(number[0]);
            if (!Number.isFinite(value)) throw new Error("Invalid preset number");
            push("number", value); cursor += number[0].length; continue;
        }
        const identifier = remaining.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (identifier) { push("identifier", identifier[0]); cursor += identifier[0].length; continue; }
        throw new Error("Unsupported preset syntax");
    }
    push("eof");
    return tokens;
}

function parseLocalAdjustmentPreset(text) {
    const tokens = tokenize(text);
    let cursor = 0;
    let nodes = 0;
    function peek() { return tokens[cursor]; }
    function take(kind) {
        const token = tokens[cursor++];
        if (!token || token.kind !== kind) throw new Error("Invalid local adjustment preset");
        return token;
    }
    function parseValue(depth) {
        if (depth > MAX_DEPTH) throw new Error("Preset nesting is too deep");
        const token = peek();
        if (token.kind === "{") return parseTable(depth + 1);
        cursor += 1;
        if (token.kind === "number" || token.kind === "string") return token.value;
        if (token.kind === "identifier" && (token.value === "true" || token.value === "false")) {
            return token.value === "true";
        }
        if (token.kind === "identifier" && token.value === "ZSTR") return take("string").value;
        throw new Error("Invalid preset value");
    }
    function parseTable(depth) {
        if (depth > MAX_DEPTH) throw new Error("Preset nesting is too deep");
        take("{");
        const result = Object.create(null);
        let nextIndex = 1;
        let named = false;
        while (peek().kind !== "}") {
            if (peek().kind === "," || peek().kind === ";") { cursor += 1; continue; }
            const start = cursor;
            const first = tokens[cursor++];
            if ((first.kind === "identifier" || first.kind === "string" || first.kind === "number") && peek().kind === "=") {
                cursor += 1;
                if (Object.prototype.hasOwnProperty.call(result, first.value)) throw new Error("Duplicate preset field");
                result[first.value] = parseValue(depth);
                named = true;
            } else {
                cursor = start;
                if (Object.prototype.hasOwnProperty.call(result, nextIndex)) throw new Error("Duplicate preset field");
                result[nextIndex++] = parseValue(depth);
            }
            nodes += 1;
            if (nodes > MAX_NODES) throw new Error("Preset contains too much data");
            if (peek().kind !== "}" && peek().kind !== "," && peek().kind !== ";") {
                throw new Error("Invalid preset table separator");
            }
        }
        take("}");
        if (!named) {
            const array = [];
            for (let index = 1; index < nextIndex; index += 1) array.push(result[index]);
            return array;
        }
        return result;
    }
    const rootName = take("identifier").value;
    if (rootName !== "s") throw new Error("Invalid local adjustment preset");
    take("=");
    const preset = parseTable(1);
    take("eof");
    if (!preset || preset.type !== "LocalizedAdjustmentPreset" || !preset.value ||
        typeof preset.value !== "object" || Array.isArray(preset.value)) {
        throw new Error("Not a local adjustment preset");
    }
    return preset;
}

function titleFromParsed(preset, filename) {
    const title = typeof preset.internalName === "string" && preset.internalName ? preset.internalName : preset.title;
    if (typeof title === "string" && title) {
        const separator = title.lastIndexOf("=");
        return (separator >= 0 ? title.slice(separator + 1) : title).slice(0, 160);
    }
    return path.basename(filename, path.extname(filename));
}

function inspectFile(directory, filename) {
    if (!SAFE_FILE.test(filename)) return null;
    const fullPath = path.join(directory, filename);
    let stat;
    try { stat = fs.lstatSync(fullPath); } catch (error) { return null; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES) return null;
    let text;
    try { text = fs.readFileSync(fullPath, "utf8"); } catch (error) { return null; }
    let parsed;
    try { parsed = parseLocalAdjustmentPreset(text); } catch (error) { return null; }
    const keys = Object.keys(parsed.value);
    const supported = keys.some(key => SUPPORTED_VALUE_KEYS.has(key)) && keys.every(function (key) {
        const value = parsed.value[key];
        // Adobe's legacy zero is accepted only with an SDK equality check in Lua.
        // It has no supported write mapping; a nonzero value cannot be applied.
        if (key === "toningLuminance") return value === 0;
        // Paired legacy process fields are inactive on PV2012+; Lua verifies the photo's process version.
        if (Object.prototype.hasOwnProperty.call(LEGACY_VALUE_PAIRS, key)) {
            return Number.isFinite(value) && Number.isFinite(parsed.value[LEGACY_VALUE_PAIRS[key]]);
        }
        if (!SUPPORTED_VALUE_KEYS.has(key)) return false;
        if (SCALAR_PRESET_MAPPINGS[key]) {
            const mapping = SCALAR_PRESET_MAPPINGS[key];
            return Number.isFinite(value) && Number.isFinite(value * mapping.scale) &&
                (mapping.min === undefined || value >= mapping.min) &&
                (mapping.max === undefined || value <= mapping.max);
        }
        if (key === "pointColors") {
            const sanitized = pointColor.sanitizePointColorCollection(value);
            return Boolean(sanitized && value.length > 0 && value.every(function (swatch, index) {
                return Object.keys(swatch).every(field => Object.prototype.hasOwnProperty.call(sanitized[index], field));
            }));
        }
        if (!Array.isArray(value)) return false;
        const points = typeof value[0] === "string" ? value.flatMap(function (pair) {
            return typeof pair === "string" && /^\d+,\d+$/.test(pair) ? pair.split(",").map(Number) : [NaN];
        }) : value;
        return pointCurve.validCurveArray(points);
    });
    return Object.freeze({ id: presetId(filename), name: titleFromParsed(parsed, filename), kind: "file",
        file: filename, value: Object.freeze(parsed.value), supported: supported, unavailableReason: null });
}

function createInventory(options) {
    options = options || {};
    const directory = options.directory === undefined ? defaultDirectory(process.env) : options.directory;
    const preferencesDirectory = options.preferencesDirectory === undefined
        ? defaultPreferencesDirectory(process.env) : options.preferencesDirectory;
    const configuredPreferencesPath = options.preferencesPath;

    function preferencesPath() {
        if (typeof configuredPreferencesPath === "string" && configuredPreferencesPath) {
            return configuredPreferencesPath;
        }
        if (typeof preferencesDirectory !== "string" || !preferencesDirectory) return null;
        let entries;
        try { entries = fs.readdirSync(preferencesDirectory); } catch (error) { return null; }
        const candidates = entries.filter(function (filename) {
            return /Preferences\.agprefs$/i.test(filename) && !/^Lightroom .*Startup Preferences\.agprefs$/i.test(filename);
        }).map(function (filename) {
            const fullPath = path.join(preferencesDirectory, filename);
            try {
                const stat = fs.lstatSync(fullPath);
                return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_PREFERENCES_BYTES
                    ? { path: fullPath, modified: stat.mtimeMs } : null;
            } catch (error) { return null; }
        }).filter(Boolean).sort(function (left, right) { return right.modified - left.modified; });
        return candidates.length > 0 ? candidates[0].path : null;
    }

    function nativeValues() {
        if (options.nativeValues && typeof options.nativeValues === "object") {
            return Object.assign(Object.create(null), options.nativeValues);
        }
        const filename = preferencesPath();
        if (!filename) return null;
        let text;
        try { text = fs.readFileSync(filename, "utf8"); } catch (error) { return null; }
        return parseApplicationPreferences(text);
    }

    function nativePresets() {
        const values = nativeValues();
        return NATIVE_CORRECTION_PRESETS.map(function (definition) {
            const source = definition.preference === null ? null : values && values[definition.preference];
            const supported = Number.isFinite(source) && Number.isFinite(source * definition.scale);
            return Object.freeze({
                id: definition.id,
                name: definition.name,
                kind: "builtin",
                parameter: definition.parameter,
                target: supported ? source * definition.scale : null,
                supported: supported,
                unavailableReason: supported ? null :
                    "Lightroom's persisted last-used value for this correction is unavailable."
            });
        });
    }

    function list() {
        if (typeof directory !== "string" || !directory) return [];
        let entries;
        try { entries = fs.readdirSync(directory); } catch (error) { return []; }
        return entries.slice(0, MAX_PRESETS * 4).map(function (filename) {
            return inspectFile(directory, filename);
        }).filter(function (entry) { return entry && entry.supported; }).sort(function (left, right) {
            const leftRank = FILE_PRESET_ORDER.indexOf(left.name);
            const rightRank = FILE_PRESET_ORDER.indexOf(right.name);
            if (leftRank >= 0 || rightRank >= 0) {
                if (leftRank < 0) return 1;
                if (rightRank < 0) return -1;
                if (leftRank !== rightRank) return leftRank - rightRank;
            }
            return left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.file.localeCompare(right.file);
        }).slice(0, MAX_PRESETS);
    }

    function menu() {
        return list();
    }

    function resolve(id) {
        return typeof id === "string" ? menu().find(function (entry) { return entry.id === id; }) || null : null;
    }

    function resolveWithStatus(id) {
        if (typeof id !== "string" || !/^lp-[A-Za-z0-9_-]{1,76}$/.test(id)) {
            return { status: "unavailable", preset: null };
        }
        if (id.startsWith("lp-native-")) return { status: "unsupported_preset", preset: null };
        if (typeof directory !== "string" || !directory) return { status: "unavailable", preset: null };
        let entries;
        try { entries = fs.readdirSync(directory); } catch (error) { return { status: "unavailable", preset: null }; }
        const filename = entries.find(function (candidate) {
            return SAFE_FILE.test(candidate) && presetId(candidate) === id;
        });
        if (!filename) return { status: "unavailable", preset: null };
        const preset = inspectFile(directory, filename);
        if (!preset) return { status: "parse_failure", preset: null };
        if (!preset.supported) return { status: "unsupported_preset", preset: preset };
        return { status: "ok", preset: preset };
    }

    return Object.freeze({ directory: directory, list: list, menu: menu, nativePresets: nativePresets,
        resolve: resolve, resolveWithStatus: resolveWithStatus });
}

module.exports = {
    MAX_PRESETS,
    MAX_FILE_BYTES,
    MAX_NODES,
    MAX_DEPTH,
    MAX_PREFERENCES_BYTES,
    SAFE_FILE,
    SUPPORTED_VALUE_KEYS,
    NATIVE_CORRECTION_PRESETS,
    validBuiltinPreset: function () {
        // Retain the old definitions as evidence, but exclude emulation at queue/state admission too.
        return false;
    },
    FILE_PRESET_ORDER,
    SCALAR_PRESET_MAPPINGS,
    defaultDirectory,
    defaultPreferencesDirectory,
    parseApplicationPreferences,
    displayName,
    presetId,
    parseLocalAdjustmentPreset,
    inspectFile,
    createInventory
};
