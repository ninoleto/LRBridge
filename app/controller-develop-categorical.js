(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeDevelopCategorical = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const whiteBalanceOptions = Object.freeze([
        Object.freeze({ value: "As Shot", label: "As Shot", writable: false }),
        Object.freeze({ value: "Auto", label: "Auto", writable: true }),
        Object.freeze({ value: "Daylight", label: "Daylight", writable: true }),
        Object.freeze({ value: "Cloudy", label: "Cloudy", writable: true }),
        Object.freeze({ value: "Shade", label: "Shade", writable: true }),
        Object.freeze({ value: "Tungsten", label: "Tungsten", writable: true }),
        Object.freeze({ value: "Fluorescent", label: "Fluorescent", writable: true }),
        Object.freeze({ value: "Flash", label: "Flash", writable: true }),
        Object.freeze({ value: "Custom", label: "Custom", writable: false })
    ]);
    const processOptions = Object.freeze([
        Object.freeze({ value: "Version 6", label: "Version 6 (Current)" }),
        Object.freeze({ value: "Version 5", label: "Version 5" }),
        Object.freeze({ value: "Version 4", label: "Version 4" }),
        Object.freeze({ value: "Version 3", label: "Version 3 (2012)" }),
        Object.freeze({ value: "Version 2", label: "Version 2 (2010)" }),
        Object.freeze({ value: "Version 1", label: "Version 1 (2003)" })
    ]);
    const vignetteStyleOptions = Object.freeze([
        Object.freeze({ value: 1, label: "Highlight Priority" }),
        Object.freeze({ value: 2, label: "Color Priority" }),
        Object.freeze({ value: 3, label: "Paint Overlay" })
    ]);
    const uprightModeOptions = Object.freeze([
        Object.freeze({ value: 0, label: "Off" }),
        Object.freeze({ value: 1, label: "Auto" }),
        Object.freeze({ value: 5, label: "Guided" }),
        Object.freeze({ value: 3, label: "Level" }),
        Object.freeze({ value: 4, label: "Vertical" }),
        Object.freeze({ value: 2, label: "Full" })
    ]);

    const definitions = Object.freeze({
        whiteBalance: Object.freeze({
            available: "whiteBalanceAvailable",
            value: "whiteBalance",
            values: whiteBalanceOptions.map(function (option) { return option.value; }),
            writableValues: whiteBalanceOptions.filter(function (option) { return option.writable; })
                .map(function (option) { return option.value; })
        }),
        process: Object.freeze({ available: "processAvailable", value: "process", values: processOptions.map(function (option) { return option.value; }) }),
        vignetteStyle: Object.freeze({ available: "vignetteStyleAvailable", value: "vignetteStyle", values: vignetteStyleOptions.map(function (option) { return option.value; }) }),
        uprightMode: Object.freeze({ available: "uprightModeAvailable", value: "uprightMode", values: uprightModeOptions.map(function (option) { return option.value; }) }),
        constrainCrop: Object.freeze({ available: "constrainCropAvailable", value: "constrainCrop", values: [0, 1] }),
        uprightTool: Object.freeze({ available: "selectedToolAvailable", value: "selectedTool", values: ["upright"] })
    });

    function unavailableState() {
        return {
            whiteBalanceAvailable: false, whiteBalance: null,
            processAvailable: false, process: null,
            vignetteStyleAvailable: false, vignetteStyle: null,
            uprightModeAvailable: false, uprightMode: null,
            constrainCropAvailable: false, constrainCrop: null,
            selectedToolAvailable: false, selectedTool: null
        };
    }

    function validState(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) return false;
        for (const control of ["whiteBalance", "process", "vignetteStyle", "uprightMode", "constrainCrop", "uprightTool"]) {
            const definition = definitions[control];
            if (typeof input[definition.available] !== "boolean") return false;
            if (input[definition.available]) {
                if (control === "uprightTool") {
                    if (typeof input[definition.value] !== "string" || input[definition.value].length === 0) return false;
                } else if (!definition.values.includes(input[definition.value])) return false;
            } else if (input[definition.value] !== null && input[definition.value] !== undefined) return false;
        }
        return true;
    }

    function syncUprightButtons(buttons, presentation, busy) {
        const available = !!presentation && presentation.available === true;
        const authoritativeValue = available ? presentation.authoritativeValue : null;
        const pending = !!presentation && presentation.pending === true;
        const desiredValue = pending ? presentation.desiredValue : null;
        uprightModeOptions.forEach(function (option) {
            const button = buttons && buttons[String(option.value)];
            if (!button) return;
            const active = available && authoritativeValue === option.value;
            button.disabled = !available || busy === true;
            button.classList.toggle("active", active);
            button.classList.toggle("pending", pending && desiredValue === option.value);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function syncBinaryButtons(buttons, presentation, busy) {
        const available = !!presentation && presentation.available === true;
        const authoritativeValue = available ? presentation.authoritativeValue : null;
        const pending = !!presentation && presentation.pending === true;
        const desiredValue = pending ? presentation.desiredValue : null;
        [0, 1].forEach(function (value) {
            const button = buttons && buttons[String(value)];
            if (!button) return;
            const active = available && authoritativeValue === value;
            button.disabled = !available || busy === true;
            button.classList.toggle("active", active);
            button.classList.toggle("pending", pending && desiredValue === value);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function createModel() {
        let state = unavailableState();
        let revision = 0;
        const pending = {};

        function validDesired(control, value) {
            const definition = definitions[control];
            const allowed = definition && (definition.writableValues || definition.values);
            return !!allowed && allowed.includes(value);
        }

        return {
            reset: function () {
                state = unavailableState();
                revision = 0;
                Object.keys(pending).forEach(function (control) { delete pending[control]; });
            },
            apply: function (nextState, nextRevision) {
                if (!validState(nextState) || !Number.isSafeInteger(nextRevision) || nextRevision < 0 || nextRevision < revision) {
                    return { accepted: false, confirmed: [], rejected: [] };
                }
                if (nextRevision === revision && revision !== 0) {
                    return { accepted: true, duplicate: true, confirmed: [], rejected: [] };
                }
                state = Object.assign({}, nextState);
                revision = nextRevision;
                const confirmed = [];
                const rejected = [];
                Object.keys(pending).forEach(function (control) {
                    const transaction = pending[control];
                    const definition = definitions[control];
                    if (revision > transaction.afterRevision && state[definition.available] === true &&
                        state[definition.value] === transaction.value) {
                        delete pending[control];
                        confirmed.push(control);
                    }
                });
                return { accepted: true, confirmed: confirmed, rejected: rejected };
            },
            begin: function (control, value, afterRevision, generation) {
                if (!validDesired(control, value) || !Number.isSafeInteger(afterRevision) || afterRevision < revision) return false;
                if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) return false;
                if (control === "whiteBalance" && pending[control] && generation !== undefined &&
                    pending[control].generation !== undefined && generation < pending[control].generation) return false;
                pending[control] = { value: value, afterRevision: afterRevision };
                if (generation !== undefined) pending[control].generation = generation;
                return true;
            },
            cancel: function (control, generation) {
                if (!pending[control]) return false;
                if (generation !== undefined && pending[control].generation !== generation) return false;
                delete pending[control];
                return true;
            },
            getPending: function (control) {
                return pending[control] ? Object.assign({}, pending[control]) : null;
            },
            getRevision: function () { return revision; },
            getState: function () { return Object.assign({}, state); },
            presentation: function (control) {
                const definition = definitions[control];
                if (!definition) return null;
                const transaction = pending[control] || null;
                return {
                    available: state[definition.available] === true,
                    authoritativeValue: state[definition.available] === true ? state[definition.value] : null,
                    pending: transaction !== null,
                    desiredValue: transaction ? transaction.value : null
                };
            }
        };
    }

    return Object.freeze({
        whiteBalanceOptions,
        processOptions,
        vignetteStyleOptions,
        uprightModeOptions,
        unavailableState,
        validState,
        syncUprightButtons,
        syncBinaryButtons,
        createModel
    });
}));
