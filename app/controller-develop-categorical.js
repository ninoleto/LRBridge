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
    const profileTokenPattern = /^profile_[a-f0-9]{24}$/;
    const PROFILE_CONFIRMATION_TIMEOUT_MS = 8000;

    function profileConfirmationTimeoutMs() {
        return PROFILE_CONFIRMATION_TIMEOUT_MS;
    }

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

    function unavailableProfileState(contextCounter, updating, photoKey, photoUuid) {
        return {
            available: false,
            updating: updating === true,
            reason: updating === true ? "Waiting for the current Lightroom photograph Profile" : "Unavailable",
            revision: 0,
            optionSnapshotRevision: 0,
            contextCounter: Number.isSafeInteger(contextCounter) && contextCounter >= 0 ? contextCounter : 0,
            photoKey: typeof photoKey === "string" && photoKey.length > 0 ? photoKey : null,
            photoUuid: typeof photoUuid === "string" && photoUuid.length > 0 ? photoUuid : null,
            processId: null,
            browsePosition: null,
            browseLabel: null,
            selectedToken: null,
            selectedLabel: null,
            validationGeneration: 0,
            validationFailedGeneration: 0,
            options: []
        };
    }

    function validProfileState(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.available !== "boolean" ||
            typeof input.updating !== "boolean" ||
            !Number.isSafeInteger(input.revision) || input.revision < 0 ||
            !Number.isSafeInteger(input.optionSnapshotRevision) || input.optionSnapshotRevision < 0 ||
            !Number.isSafeInteger(input.contextCounter) || input.contextCounter < 0 ||
            (input.photoKey !== null && (typeof input.photoKey !== "string" || input.photoKey.length < 1 ||
                input.photoKey.length > 1024)) ||
            (input.photoUuid !== null && (typeof input.photoUuid !== "string" || input.photoUuid.length < 1 ||
                input.photoUuid.length > 160)) ||
            !Number.isSafeInteger(input.validationGeneration) || input.validationGeneration < 0 ||
            !Number.isSafeInteger(input.validationFailedGeneration) || input.validationFailedGeneration < 0 ||
            !Array.isArray(input.options)) return false;
        if (!input.available) {
            if (typeof input.reason !== "string" || input.reason.length < 1 || input.reason.length > 240 ||
                input.browsePosition !== null || input.browseLabel !== null || input.selectedToken !== null ||
                input.options.length !== 0) return false;
            if (input.selectedLabel === null) return input.processId === null;
            return input.updating === false && (input.processId === null ||
                (Number.isSafeInteger(input.processId) && input.processId > 0)) &&
                typeof input.selectedLabel === "string" && input.selectedLabel.trim() === input.selectedLabel &&
                input.selectedLabel.length > 0 && input.selectedLabel.length <= 160;
        }
        if (input.updating || input.reason !== null || !Number.isSafeInteger(input.processId) || input.processId < 1 ||
            !Number.isSafeInteger(input.browsePosition) || input.browsePosition < 1 || input.browsePosition > 255 ||
            typeof input.browseLabel !== "string" || !/^Browse(?:\.{3}|\u2026)$/i.test(input.browseLabel) ||
            typeof input.selectedToken !== "string" ||
            !profileTokenPattern.test(input.selectedToken) || typeof input.selectedLabel !== "string" ||
            input.selectedLabel.length < 1 || input.selectedLabel.length > 160 ||
            input.options.length < 1 || input.options.length > 64) return false;
        const tokens = new Set();
        const positions = new Set();
        const labels = new Set();
        let selectedMatches = 0;
        for (const option of input.options) {
            if (!option || typeof option !== "object" || Array.isArray(option) ||
                typeof option.token !== "string" || !profileTokenPattern.test(option.token) || tokens.has(option.token) ||
                typeof option.label !== "string" || option.label.trim() !== option.label || option.label.length < 1 ||
                option.label.length > 160 || /^Browse(?:\.{3}|\u2026)$/i.test(option.label) ||
                !Number.isSafeInteger(option.position) || option.position < 0 || option.position >= input.browsePosition ||
                positions.has(option.position) ||
                typeof option.enabled !== "boolean" || typeof option.writable !== "boolean") return false;
            const foldedLabel = option.label.toLocaleLowerCase("en-US");
            if (labels.has(foldedLabel)) return false;
            tokens.add(option.token);
            positions.add(option.position);
            labels.add(foldedLabel);
            if (option.token === input.selectedToken && option.label === input.selectedLabel) selectedMatches += 1;
        }
        return selectedMatches === 1;
    }

    function cloneProfileState(input) {
        return {
            available: input.available,
            updating: input.updating,
            reason: input.reason,
            revision: input.revision,
            optionSnapshotRevision: input.optionSnapshotRevision,
            contextCounter: input.contextCounter,
            photoKey: input.photoKey,
            photoUuid: input.photoUuid,
            processId: input.processId,
            browsePosition: input.browsePosition,
            browseLabel: input.browseLabel,
            selectedToken: input.selectedToken,
            selectedLabel: input.selectedLabel,
            validationGeneration: input.validationGeneration,
            validationFailedGeneration: input.validationFailedGeneration,
            options: input.options.map(function (option) { return Object.assign({}, option); })
        };
    }

    function createProfileModel() {
        let state = unavailableProfileState();
        let lastAvailableState = null;
        let pending = null;
        let timedOut = null;
        let expectedContextCounter = null;
        let expectedPhotoKey = null;
        let expectedPhotoUuid = null;

        function matchesTarget(target) {
            return state.available && state.contextCounter === target.contextCounter &&
                state.photoKey === target.photoKey && state.photoUuid === target.photoUuid &&
                state.processId === target.processId && state.revision > target.afterRevision &&
                state.selectedLabel === target.label && target.serverGeneration !== null &&
                state.validationGeneration === target.serverGeneration;
        }

        return {
            reset: function () {
                state = unavailableProfileState();
                lastAvailableState = null;
                pending = null;
                timedOut = null;
                expectedContextCounter = null;
                expectedPhotoKey = null;
                expectedPhotoUuid = null;
            },
            beginContext: function (contextCounter, photoKey, photoUuid) {
                if (!Number.isSafeInteger(contextCounter) || contextCounter < 0 ||
                    (photoKey !== null && (typeof photoKey !== "string" || photoKey.length < 1)) ||
                    (photoUuid !== null && (typeof photoUuid !== "string" || photoUuid.length < 1))) return false;
                state = unavailableProfileState(contextCounter, true, photoKey, photoUuid);
                lastAvailableState = null;
                pending = null;
                timedOut = null;
                expectedContextCounter = contextCounter;
                expectedPhotoKey = photoKey;
                expectedPhotoUuid = photoUuid;
                return true;
            },
            apply: function (nextState) {
                if (!validProfileState(nextState) ||
                    (expectedContextCounter !== null && (nextState.contextCounter !== expectedContextCounter ||
                        nextState.photoKey !== expectedPhotoKey || nextState.photoUuid !== expectedPhotoUuid)) ||
                    nextState.revision < state.revision) {
                    return { accepted: false, confirmed: false, lateConfirmed: false, rejected: false };
                }
                if (nextState.revision === state.revision && state.revision !== 0) {
                    return { accepted: true, duplicate: true, confirmed: false, lateConfirmed: false, rejected: false };
                }
                const contextChanged = state.contextCounter !== nextState.contextCounter;
                state = cloneProfileState(nextState);
                expectedContextCounter = state.contextCounter;
                expectedPhotoKey = state.photoKey;
                expectedPhotoUuid = state.photoUuid;
                if (contextChanged) lastAvailableState = null;
                if (state.available) lastAvailableState = cloneProfileState(state);
                let confirmed = false;
                let lateConfirmed = false;
                let rejected = false;
                let rejectionReason = null;
                if (pending) {
                    if (state.contextCounter !== pending.contextCounter ||
                        state.photoKey !== pending.photoKey || state.photoUuid !== pending.photoUuid ||
                        (state.available && state.processId !== pending.processId)) {
                        pending = null;
                        rejected = true;
                        rejectionReason = "context-changed";
                    } else if (pending.serverGeneration !== null &&
                        state.validationFailedGeneration === pending.serverGeneration) {
                        pending = null;
                        rejected = true;
                        rejectionReason = "sdk-validation-failed";
                    } else if (matchesTarget(pending)) {
                        pending = null;
                        timedOut = null;
                        confirmed = true;
                    } else if (state.available) {
                        const target = state.options.find(function (option) {
                            return option.label === pending.label && option.enabled && option.writable;
                        });
                        if (!target) {
                            pending = null;
                            rejected = true;
                            rejectionReason = "option-unavailable";
                        } else {
                            pending.token = target.token;
                        }
                    }
                }
                if (!pending && timedOut) {
                    if (state.contextCounter !== timedOut.contextCounter ||
                        state.photoKey !== timedOut.photoKey || state.photoUuid !== timedOut.photoUuid ||
                        (state.available && state.processId !== timedOut.processId)) {
                        timedOut = null;
                    } else if (timedOut.serverGeneration !== null &&
                        state.validationFailedGeneration === timedOut.serverGeneration) {
                        timedOut = null;
                    } else if (matchesTarget(timedOut)) {
                        timedOut = null;
                        lateConfirmed = true;
                    }
                }
                return {
                    accepted: true,
                    confirmed: confirmed,
                    lateConfirmed: lateConfirmed,
                    rejected: rejected,
                    rejectionReason: rejectionReason
                };
            },
            begin: function (token, generation) {
                if (typeof token !== "string" || !profileTokenPattern.test(token) ||
                    !Number.isSafeInteger(generation) || generation < 1 || !state.available || pending !== null) return false;
                const option = state.options.find(function (entry) {
                    return entry.token === token && entry.enabled && entry.writable;
                });
                if (!option) return false;
                pending = {
                    token: token,
                    label: option.label,
                    position: option.position,
                    generation: generation,
                    contextCounter: state.contextCounter,
                    photoKey: state.photoKey,
                    photoUuid: state.photoUuid,
                    processId: state.processId,
                    afterRevision: state.revision,
                    serverGeneration: null
                };
                timedOut = null;
                return true;
            },
            setConfirmationAfterRevision: function (generation, afterRevision, serverGeneration) {
                if (!pending || pending.generation !== generation || !Number.isSafeInteger(afterRevision) ||
                    afterRevision < pending.afterRevision || !Number.isSafeInteger(serverGeneration) ||
                    serverGeneration < 1) return false;
                pending.afterRevision = afterRevision;
                pending.serverGeneration = serverGeneration;
                return true;
            },
            cancel: function (generation) {
                if (!pending || (generation !== undefined && pending.generation !== generation)) return false;
                pending = null;
                return true;
            },
            timeout: function (generation) {
                if (!pending || pending.generation !== generation) return false;
                timedOut = Object.assign({}, pending);
                pending = null;
                return true;
            },
            getPending: function () { return pending ? Object.assign({}, pending) : null; },
            getTimedOut: function () { return timedOut ? Object.assign({}, timedOut) : null; },
            getState: function () { return cloneProfileState(state); },
            getRevision: function () { return state.revision; },
            presentation: function () {
                const displayState = pending && !state.available && lastAvailableState ? lastAvailableState : state;
                const draftOption = pending && displayState.available ? displayState.options.find(function (option) {
                    return option.label === pending.label && option.enabled && option.writable;
                }) : null;
                return {
                    available: displayState.available,
                    inventoryStable: displayState.available,
                    updating: state.updating,
                    reason: state.reason,
                    revision: state.revision,
                    optionSnapshotRevision: displayState.optionSnapshotRevision,
                    authoritativeToken: displayState.available ? displayState.selectedToken : null,
                    authoritativeLabel: typeof displayState.selectedLabel === "string" ? displayState.selectedLabel : null,
                    options: displayState.options.map(function (option) { return Object.assign({}, option); }),
                    pending: pending !== null,
                    desiredToken: pending ? pending.token : null,
                    draftToken: draftOption ? draftOption.token : null,
                    desiredLabel: pending ? pending.label : null
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
        createModel,
        profileTokenPattern,
        unavailableProfileState,
        validProfileState,
        profileConfirmationTimeoutMs,
        PROFILE_CONFIRMATION_TIMEOUT_MS,
        createProfileModel
    });
}));
