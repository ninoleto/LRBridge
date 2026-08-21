"use strict";

const crypto = require("node:crypto");
const profileSdkRegistry = require("./profile-sdk-registry");

const TOKEN_PATTERN = /^profile_[a-f0-9]{24}$/;
const MAX_OPTIONS = 64;
const MAX_LABEL_LENGTH = 160;
const DEFAULT_REFRESH_INTERVAL_MS = 750;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_STALE_AFTER_MS = 15000;
const DEFAULT_WRITE_TIMEOUT_MS = 8000;
const PUBLIC_UNAVAILABLE_REASON = "Lightroom Profile control is temporarily unavailable";

class ProfileUnavailableError extends Error {
    constructor(message) {
        super(message || "Lightroom Profile control unavailable");
        this.name = "ProfileUnavailableError";
        this.code = "LIGHTROOM_PROFILE_UNAVAILABLE";
    }
}

class ProfileRejectedError extends Error {
    constructor(message) {
        super(message || "Lightroom Profile selection rejected");
        this.name = "ProfileRejectedError";
        this.code = "LIGHTROOM_PROFILE_REJECTED";
    }
}

function boundedReason(reason) {
    if (typeof reason !== "string" || reason.trim() === "") return "Unavailable";
    return reason.trim().slice(0, 240);
}

function unavailableProfileState(reason, revision, optionSnapshotRevision, contextCounter) {
    return {
        available: false,
        reason: boundedReason(reason),
        revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
        optionSnapshotRevision: Number.isSafeInteger(optionSnapshotRevision) && optionSnapshotRevision >= 0
            ? optionSnapshotRevision
            : 0,
        contextCounter: Number.isSafeInteger(contextCounter) && contextCounter >= 0 ? contextCounter : 0,
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

function isBrowseLabel(label) {
    return typeof label === "string" && /^Browse(?:\.{3}|\u2026)$/i.test(label.trim());
}

function validHandle(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function positiveIntegerOption(options, name, defaultValue) {
    const value = options[name] === undefined ? defaultValue : options[name];
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(name + " must be a positive integer");
    return value;
}

function normalizeRawSnapshot(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.available !== true) {
        throw new ProfileUnavailableError(input && input.reason);
    }
    if (!Number.isSafeInteger(input.processId) || input.processId <= 0 ||
        !validHandle(input.mainHwnd) || !validHandle(input.comboHwnd) || !validHandle(input.listHwnd) ||
        !input.patterns || input.patterns.selection !== true || input.patterns.expandCollapse !== true ||
        input.patterns.selectionItem !== true || typeof input.expanded !== "boolean" ||
        !Number.isSafeInteger(input.browsePosition) || input.browsePosition < 1 || input.browsePosition > 255 ||
        !isBrowseLabel(input.browseLabel) || !Array.isArray(input.options) ||
        input.options.length < 1 || input.options.length > MAX_OPTIONS || !input.selected ||
        typeof input.selected !== "object" || Array.isArray(input.selected) || input.selectedCount !== 1) {
        throw new ProfileUnavailableError("Malformed Lightroom Profile accessibility snapshot");
    }

    const positions = new Set();
    const labels = new Set();
    const options = input.options.map(function (option) {
        if (!option || typeof option !== "object" || Array.isArray(option)) {
            throw new ProfileUnavailableError("Malformed Lightroom Profile option object");
        }
        if (!Number.isSafeInteger(option.position) || option.position < 0 || option.position >= input.browsePosition ||
            positions.has(option.position)) {
            throw new ProfileUnavailableError("Malformed Lightroom Profile option position");
        }
        if (typeof option.label !== "string") {
            throw new ProfileUnavailableError("Malformed Lightroom Profile option label type at position " + option.position);
        }
        if (option.label.trim() !== option.label || option.label.length < 1) {
            throw new ProfileUnavailableError("Empty or padded Lightroom Profile option label at position " + option.position);
        }
        if (option.label.length > MAX_LABEL_LENGTH) {
            throw new ProfileUnavailableError("Oversized Lightroom Profile option label at position " + option.position);
        }
        if (isBrowseLabel(option.label)) {
            throw new ProfileUnavailableError("Browse was exposed as a Lightroom Profile option at position " + option.position);
        }
        if (typeof option.enabled !== "boolean" || option.selectionItem !== true) {
            throw new ProfileUnavailableError("Malformed Lightroom Profile option accessibility state");
        }
        const foldedLabel = option.label.toLocaleLowerCase("en-US");
        if (labels.has(foldedLabel)) throw new ProfileUnavailableError("Duplicate Lightroom Profile labels are ambiguous");
        positions.add(option.position);
        labels.add(foldedLabel);
        return { position: option.position, label: option.label, enabled: option.enabled };
    }).sort(function (left, right) { return left.position - right.position; });

    if (!Number.isSafeInteger(input.selected.position) || typeof input.selected.label !== "string") {
        throw new ProfileUnavailableError("Malformed selected Lightroom Profile");
    }
    const selectedMatches = options.filter(function (option) {
        return option.position === input.selected.position && option.label === input.selected.label;
    });
    if (selectedMatches.length !== 1) {
        throw new ProfileUnavailableError("Selected Lightroom Profile is not a unique quick option");
    }

    return {
        processId: input.processId,
        mainHwnd: input.mainHwnd,
        comboHwnd: input.comboHwnd,
        listHwnd: input.listHwnd,
        expanded: input.expanded,
        browsePosition: input.browsePosition,
        browseLabel: input.browseLabel,
        selected: { position: input.selected.position, label: input.selected.label },
        options: options
    };
}

function publicClone(state) {
    return {
        available: state.available,
        reason: state.reason,
        revision: state.revision,
        optionSnapshotRevision: state.optionSnapshotRevision,
        contextCounter: state.contextCounter,
        processId: state.processId,
        browsePosition: state.browsePosition,
        browseLabel: state.browseLabel,
        selectedToken: state.selectedToken,
        selectedLabel: state.selectedLabel,
        validationGeneration: state.validationGeneration,
        validationFailedGeneration: state.validationFailedGeneration,
        options: state.options.map(function (option) { return Object.assign({}, option); })
    };
}

function createProfileNativeState(backend, options) {
    options = options || {};
    if (!backend || typeof backend.readProfileSnapshot !== "function") {
        throw new TypeError("Profile native readback backend interface is incomplete");
    }
    const secret = Buffer.isBuffer(options.secret) && options.secret.length >= 16
        ? Buffer.from(options.secret)
        : crypto.randomBytes(32);
    const refreshIntervalMs = positiveIntegerOption(options, "refreshIntervalMs", DEFAULT_REFRESH_INTERVAL_MS);
    const failureThreshold = positiveIntegerOption(options, "failureThreshold", DEFAULT_FAILURE_THRESHOLD);
    const staleAfterMs = positiveIntegerOption(options, "staleAfterMs", DEFAULT_STALE_AFTER_MS);
    const writeTimeoutMs = positiveIntegerOption(options, "writeTimeoutMs", DEFAULT_WRITE_TIMEOUT_MS);
    const now = options.now === undefined ? Date.now : options.now;
    if (typeof now !== "function") throw new TypeError("now must be a function");

    let revision = 0;
    let optionSnapshotRevision = 0;
    let optionSignature = null;
    let contextCounter = 0;
    let privateSnapshot = null;
    let state = unavailableProfileState(
        "Lightroom Profile state has not been read yet", revision, optionSnapshotRevision, contextCounter
    );
    let refreshInFlight = null;
    let lastRefreshStartedAt = null;
    let lastSuccessfulRefreshAt = null;
    let consecutiveRefreshFailures = 0;
    let sdkWritePending = null;
    let sdkWriteRecord = null;
    let sdkWriteGeneration = 0;
    let sdkValidationGeneration = 0;
    let sdkValidationFailedGeneration = 0;
    const diagnostics = {
        refreshRequests: 0,
        nativeReads: 0,
        sharedRefreshes: 0,
        cachedRefreshes: 0,
        refreshFailures: 0,
        refreshRecoveries: 0,
        sdkWritesAdmitted: 0,
        sdkWritesRejected: 0,
        sdkWritesConfirmed: 0,
        sdkWritesTimedOut: 0,
        sdkWritesCanceled: 0
    };

    function signatureFor(snapshot) {
        return JSON.stringify({
            contextCounter: contextCounter,
            processId: snapshot.processId,
            mainHwnd: snapshot.mainHwnd,
            comboHwnd: snapshot.comboHwnd,
            listHwnd: snapshot.listHwnd,
            browsePosition: snapshot.browsePosition,
            options: snapshot.options
        });
    }

    function tokenFor(snapshot, option) {
        return "profile_" + crypto.createHmac("sha256", secret)
            .update(String(optionSnapshotRevision)).update("\0")
            .update(String(contextCounter)).update("\0")
            .update(String(snapshot.processId)).update("\0")
            .update(String(snapshot.mainHwnd)).update("\0")
            .update(String(snapshot.comboHwnd)).update("\0")
            .update(String(snapshot.listHwnd)).update("\0")
            .update(String(option.position)).update("\0")
            .update(option.label)
            .digest("hex").slice(0, 24);
    }

    function expireSdkWritePending(observedAt) {
        if (!sdkWritePending || observedAt < sdkWritePending.expiresAt) return false;
        sdkWritePending = null;
        diagnostics.sdkWritesTimedOut += 1;
        return true;
    }

    function makeUnavailable(reason) {
        revision += 1;
        if (optionSignature !== null || privateSnapshot !== null) optionSnapshotRevision += 1;
        optionSignature = null;
        privateSnapshot = null;
        state = unavailableProfileState(reason, revision, optionSnapshotRevision, contextCounter);
        return publicClone(state);
    }

    function applyNormalized(normalized) {
        const nextSignature = signatureFor(normalized);
        if (nextSignature !== optionSignature) {
            optionSnapshotRevision += 1;
            optionSignature = nextSignature;
        }
        revision += 1;
        const publicOptions = normalized.options.map(function (option) {
            return {
                token: tokenFor(normalized, option),
                label: option.label,
                position: option.position,
                enabled: option.enabled,
                writable: profileSdkRegistry.isSupportedProfile(option.label)
            };
        });
        const selectedOption = publicOptions.find(function (option) {
            return option.position === normalized.selected.position && option.label === normalized.selected.label;
        });
        privateSnapshot = normalized;
        state = {
            available: true,
            reason: null,
            revision: revision,
            optionSnapshotRevision: optionSnapshotRevision,
            contextCounter: contextCounter,
            processId: normalized.processId,
            browsePosition: normalized.browsePosition,
            browseLabel: normalized.browseLabel,
            selectedToken: selectedOption.token,
            selectedLabel: selectedOption.label,
            validationGeneration: sdkValidationGeneration,
            validationFailedGeneration: sdkValidationFailedGeneration,
            options: publicOptions
        };

        expireSdkWritePending(now());
        if (sdkWritePending) {
            if (sdkWritePending.contextCounter !== contextCounter || sdkWritePending.processId !== normalized.processId) {
                sdkWritePending = null;
                diagnostics.sdkWritesCanceled += 1;
            } else if (revision > sdkWritePending.confirmationAfterRevision &&
                selectedOption.label === sdkWritePending.label &&
                sdkValidationGeneration === sdkWritePending.generation) {
                sdkWritePending = null;
                diagnostics.sdkWritesConfirmed += 1;
            }
        }
        return publicClone(state);
    }

    function applySuccessfulRaw(input) {
        const applied = applyNormalized(normalizeRawSnapshot(input));
        if (consecutiveRefreshFailures > 0) diagnostics.refreshRecoveries += 1;
        consecutiveRefreshFailures = 0;
        lastSuccessfulRefreshAt = now();
        lastRefreshStartedAt = lastSuccessfulRefreshAt;
        return applied;
    }

    function recordRefreshFailure(error, capturedContextCounter) {
        if (capturedContextCounter !== contextCounter) return publicClone(state);
        diagnostics.refreshFailures += 1;
        consecutiveRefreshFailures += 1;
        const failedAt = now();
        lastRefreshStartedAt = failedAt;
        expireSdkWritePending(failedAt);
        const staleFor = lastSuccessfulRefreshAt === null ? Infinity : failedAt - lastSuccessfulRefreshAt;
        const sustained = consecutiveRefreshFailures >= failureThreshold && staleFor >= staleAfterMs;
        if (!sustained) return publicClone(state);
        if (!state.available && state.reason === PUBLIC_UNAVAILABLE_REASON) return publicClone(state);
        return makeUnavailable(PUBLIC_UNAVAILABLE_REASON);
    }

    function syncContext(nextContextCounter) {
        if (!Number.isSafeInteger(nextContextCounter) || nextContextCounter < 0) {
            throw new TypeError("Invalid Profile context counter");
        }
        if (nextContextCounter === contextCounter) return false;
        contextCounter = nextContextCounter;
        if (sdkWritePending) diagnostics.sdkWritesCanceled += 1;
        sdkWritePending = null;
        sdkWriteRecord = null;
        sdkValidationGeneration = 0;
        sdkValidationFailedGeneration = 0;
        makeUnavailable("Waiting for the current Lightroom photograph Profile options");
        lastRefreshStartedAt = null;
        lastSuccessfulRefreshAt = null;
        consecutiveRefreshFailures = 0;
        return true;
    }

    function refresh() {
        diagnostics.refreshRequests += 1;
        if (refreshInFlight !== null) {
            diagnostics.sharedRefreshes += 1;
            return refreshInFlight;
        }
        const requestedAt = now();
        expireSdkWritePending(requestedAt);
        if (lastRefreshStartedAt !== null && requestedAt - lastRefreshStartedAt < refreshIntervalMs) {
            diagnostics.cachedRefreshes += 1;
            return Promise.resolve(publicClone(state));
        }
        const capturedContextCounter = contextCounter;
        diagnostics.nativeReads += 1;
        const work = Promise.resolve()
            .then(function () { return backend.readProfileSnapshot(); })
            .then(function (raw) {
                if (capturedContextCounter !== contextCounter) return publicClone(state);
                try { return applySuccessfulRaw(raw); }
                catch (error) { return recordRefreshFailure(error, capturedContextCounter); }
            }, function (error) {
                return recordRefreshFailure(error, capturedContextCounter);
            });
        let sharedWork = null;
        sharedWork = work.finally(function () {
            if (refreshInFlight === sharedWork) refreshInFlight = null;
        });
        refreshInFlight = sharedWork;
        return sharedWork;
    }

    function admitSdkSelection(token) {
        expireSdkWritePending(now());
        if (sdkWritePending) {
            diagnostics.sdkWritesRejected += 1;
            throw new ProfileRejectedError("A Profile change is already awaiting authoritative confirmation");
        }
        if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
            diagnostics.sdkWritesRejected += 1;
            throw new ProfileRejectedError("Malformed Profile option token");
        }
        if (!state.available || !privateSnapshot) throw new ProfileUnavailableError(state.reason);
        const matches = state.options.filter(function (option) { return option.token === token; });
        if (matches.length !== 1 || matches[0].enabled !== true || matches[0].writable !== true ||
            !profileSdkRegistry.isSupportedProfile(matches[0].label)) {
            diagnostics.sdkWritesRejected += 1;
            throw new ProfileRejectedError("Profile is readback-only or the option token is stale");
        }
        sdkWriteGeneration += 1;
        sdkWritePending = {
            generation: sdkWriteGeneration,
            token: token,
            label: matches[0].label,
            position: matches[0].position,
            contextCounter: contextCounter,
            processId: state.processId,
            confirmationAfterRevision: state.revision,
            expiresAt: now() + profileSdkRegistry.confirmationTimeoutMs(matches[0].label, writeTimeoutMs)
        };
        sdkWriteRecord = Object.assign({}, sdkWritePending);
        diagnostics.sdkWritesAdmitted += 1;
        return Object.assign({}, sdkWritePending);
    }

    function cancelSdkSelection(generation) {
        if (!sdkWritePending || sdkWritePending.generation !== generation) return false;
        sdkWritePending = null;
        if (sdkWriteRecord && sdkWriteRecord.generation === generation) sdkWriteRecord = null;
        diagnostics.sdkWritesCanceled += 1;
        return true;
    }

    function recordSdkValidation(generation, label, status) {
        if (!Number.isSafeInteger(generation) || generation < 1 || typeof label !== "string" ||
            (status !== "confirmed" && status !== "failed") || generation !== sdkWriteGeneration ||
            !sdkWriteRecord || sdkWriteRecord.generation !== generation || sdkWriteRecord.label !== label ||
            sdkWriteRecord.contextCounter !== contextCounter ||
            (state.available && sdkWriteRecord.processId !== state.processId) ||
            sdkValidationGeneration === generation || sdkValidationFailedGeneration === generation) return false;
        revision += 1;
        if (status === "confirmed") sdkValidationGeneration = generation;
        else sdkValidationFailedGeneration = generation;
        state = Object.assign({}, state, {
            revision: revision,
            validationGeneration: sdkValidationGeneration,
            validationFailedGeneration: sdkValidationFailedGeneration
        });
        if (status === "failed") {
            if (sdkWritePending && sdkWritePending.generation === generation) {
                sdkWritePending = null;
                diagnostics.sdkWritesCanceled += 1;
            }
            return true;
        }
        if (sdkWritePending && sdkWritePending.generation === generation && state.available &&
            state.revision > sdkWritePending.confirmationAfterRevision && state.selectedLabel === label) {
            sdkWritePending = null;
            diagnostics.sdkWritesConfirmed += 1;
        }
        return true;
    }

    return Object.freeze({
        get: function () { return publicClone(state); },
        refresh: refresh,
        syncContext: syncContext,
        admitSdkSelection: admitSdkSelection,
        cancelSdkSelection: cancelSdkSelection,
        recordSdkValidation: recordSdkValidation,
        getSdkWritePending: function () {
            expireSdkWritePending(now());
            return sdkWritePending ? Object.assign({}, sdkWritePending) : null;
        },
        getDiagnostics: function () {
            return Object.assign({
                refreshInFlight: refreshInFlight !== null,
                consecutiveRefreshFailures: consecutiveRefreshFailures,
                lastRefreshStartedAt: lastRefreshStartedAt,
                lastSuccessfulRefreshAt: lastSuccessfulRefreshAt,
                refreshIntervalMs: refreshIntervalMs,
                failureThreshold: failureThreshold,
                staleAfterMs: staleAfterMs,
                writeTimeoutMs: writeTimeoutMs,
                sdkWritePending: sdkWritePending !== null,
                sdkWriteGeneration: sdkWriteGeneration
            }, diagnostics);
        },
        resetForTests: function () {
            revision = 0;
            optionSnapshotRevision = 0;
            optionSignature = null;
            contextCounter = 0;
            privateSnapshot = null;
            state = unavailableProfileState("Lightroom Profile state has not been read yet", 0, 0, 0);
            refreshInFlight = null;
            lastRefreshStartedAt = null;
            lastSuccessfulRefreshAt = null;
            consecutiveRefreshFailures = 0;
            sdkWritePending = null;
            sdkWriteRecord = null;
            sdkWriteGeneration = 0;
            sdkValidationGeneration = 0;
            sdkValidationFailedGeneration = 0;
            Object.keys(diagnostics).forEach(function (key) { diagnostics[key] = 0; });
        }
    });
}

module.exports = Object.freeze({
    TOKEN_PATTERN,
    MAX_OPTIONS,
    DEFAULT_REFRESH_INTERVAL_MS,
    DEFAULT_FAILURE_THRESHOLD,
    DEFAULT_STALE_AFTER_MS,
    DEFAULT_WRITE_TIMEOUT_MS,
    PUBLIC_UNAVAILABLE_REASON,
    ProfileUnavailableError,
    ProfileRejectedError,
    isBrowseLabel,
    unavailableProfileState,
    normalizeRawSnapshot,
    createProfileNativeState
});
