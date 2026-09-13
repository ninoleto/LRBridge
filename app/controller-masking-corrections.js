(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeMaskingCorrections = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const GROUPS = ["Amount", "Tone", "Color", "Effects", "Detail"];
    // Lightroom Classic 15.3 LrDevelopController.createNewMask catalog.
    // Interactive entries start a native tool, not a completed mask.
    const CREATION_TYPES = Object.freeze([
        ["aiSelection", "subject", "Subject", ""],
        ["aiSelection", "sky", "Sky", ""],
        ["aiSelection", "background", "Background", ""],
        ["aiSelection", "people", "People", "Choose people or features in Lightroom."],
        ["aiSelection", "landscape", "Landscape", "Choose landscape elements in Lightroom."],
        ["aiSelection", "objects", "Objects", "Mark the objects in Lightroom."],
        ["brush", "", "Brush", "Draw in Lightroom to finish."],
        ["gradient", "", "Linear Gradient", "Draw the gradient in Lightroom."],
        ["radialGradient", "", "Radial Gradient", "Draw the ellipse in Lightroom."],
        ["rangeMask", "color", "Color Range", "Select colors in Lightroom."],
        ["rangeMask", "luminance", "Luminance Range", "Select a luminance range in Lightroom."],
        ["rangeMask", "depth", "Depth Range", "Requires a photo with depth data; select the range in Lightroom."]
    ].map(function (entry) {
        return Object.freeze({ maskType: entry[0], maskSubtype: entry[1], label: entry[2], instruction: entry[3] });
    }));

    function creationType(maskType, maskSubtype) {
        return CREATION_TYPES.find(function (entry) {
            return entry.maskType === maskType && entry.maskSubtype === maskSubtype;
        }) || null;
    }
    const SUPPORTED_DEFINITIONS = [
        { parameter: "local_Amount", label: "Amount", group: "Amount" },
        { parameter: "local_Exposure", label: "Exposure", group: "Tone" },
        { parameter: "local_Contrast", label: "Contrast", group: "Tone" },
        { parameter: "local_Highlights", label: "Highlights", group: "Tone" },
        { parameter: "local_Shadows", label: "Shadows", group: "Tone" },
        { parameter: "local_Whites", label: "Whites", group: "Tone" },
        { parameter: "local_Blacks", label: "Blacks", group: "Tone" },
        { parameter: "local_Temperature", label: "Temperature", group: "Color" },
        { parameter: "local_Tint", label: "Tint", group: "Color" },
        { parameter: "local_Hue", label: "Hue", group: "Color" },
        { parameter: "local_Saturation", label: "Saturation", group: "Color" },
        { parameter: "local_RefineSaturation", label: "Refine Saturation", group: "Tone Curve" },
        { parameter: "local_ToningHue", label: "Toning Hue", group: "Color" },
        { parameter: "local_ToningSaturation", label: "Toning Saturation", group: "Color" },
        { parameter: "local_ToningLuminance", label: "Toning Luminance", group: "Color", legacyProcessVersion: 2 },
        { parameter: "local_Texture", label: "Texture", group: "Effects" },
        { parameter: "local_Clarity", label: "Clarity", group: "Effects" },
        { parameter: "local_Dehaze", label: "Dehaze", group: "Effects" },
        { parameter: "local_Grain", label: "Grain Amount", group: "Effects" },
        { parameter: "local_Sharpness", label: "Sharpness", group: "Detail" },
        { parameter: "local_LuminanceNoise", label: "Noise Reduction", group: "Detail" },
        { parameter: "local_Moire", label: "Moiré", group: "Detail" },
        { parameter: "local_Defringe", label: "Defringe", group: "Detail" }
    ];
    const HIDDEN_PARAMETERS = new Set([
        "local_ToningHue", "local_ToningSaturation", "local_ToningLuminance"
    ]);
    const DEFINITIONS = SUPPORTED_DEFINITIONS.filter(function (definition) {
        return !HIDDEN_PARAMETERS.has(definition.parameter);
    });
    const BY_PARAMETER = Object.freeze(SUPPORTED_DEFINITIONS.reduce(function (result, definition) {
        result[definition.parameter] = Object.freeze(Object.assign({}, definition));
        return result;
    }, {}));

    function finiteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function sanitizeCorrection(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) ||
            !Object.prototype.hasOwnProperty.call(BY_PARAMETER, input.parameter) ||
            !finiteNumber(input.value) || !finiteNumber(input.min) || !finiteNumber(input.max) ||
            input.min >= input.max || input.value < input.min || input.value > input.max) return null;
        return { parameter: input.parameter, value: input.value, min: input.min, max: input.max };
    }

    function sanitizeCorrections(input) {
        if (!Array.isArray(input) || input.length > SUPPORTED_DEFINITIONS.length) return null;
        const byParameter = new Map();
        for (const entry of input) {
            const correction = sanitizeCorrection(entry);
            if (!correction || byParameter.has(correction.parameter)) return null;
            byParameter.set(correction.parameter, correction);
        }
        return SUPPORTED_DEFINITIONS.filter(function (definition) {
            return byParameter.has(definition.parameter);
        }).map(function (definition) {
            return byParameter.get(definition.parameter);
        });
    }

    function sameCorrections(left, right) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
            left.every(function (entry, index) {
                const other = right[index];
                return other && entry.parameter === other.parameter && Object.is(entry.value, other.value) &&
                    Object.is(entry.min, other.min) && Object.is(entry.max, other.max);
            });
    }

    function correctionFor(corrections, parameter) {
        if (!Array.isArray(corrections)) return null;
        return corrections.find(function (entry) { return entry.parameter === parameter; }) || null;
    }

    function precisionForRange(minimum, maximum) {
        if (!finiteNumber(minimum) || !finiteNumber(maximum) || maximum <= minimum) return 0;
        return maximum - minimum <= 20 ? 2 : 0;
    }

    return {
        groups: Object.freeze(GROUPS.slice()),
        creationTypes: CREATION_TYPES,
        creationType: creationType,
        supportedDefinitions: Object.freeze(SUPPORTED_DEFINITIONS.map(function (definition) {
            return Object.freeze(Object.assign({}, definition));
        })),
        definitions: Object.freeze(DEFINITIONS.map(function (definition) { return Object.freeze(Object.assign({}, definition)); })),
        byParameter: BY_PARAMETER,
        sanitizeCorrection: sanitizeCorrection,
        sanitizeCorrections: sanitizeCorrections,
        sameCorrections: sameCorrections,
        correctionFor: correctionFor,
        precisionForRange: precisionForRange
    };
});
