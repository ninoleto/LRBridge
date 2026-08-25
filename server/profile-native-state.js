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
const DEFAULT_CONTEXT_INVENTORY_STABLE_READS = 2;
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

function unavailableProfileState(reason, revision, optionSnapshotRevision, contextCounter, updating, photoKey, photoUuid) {
    return {
        available: false,
        updating: updating === true,
        reason: boundedReason(reason),
        revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
        optionSnapshotRevision: Number.isSafeInteger(optionSnapshotRevision) && optionSnapshotRevision >= 0
            ? optionSnapshotRevision
            : 0,
        contextCounter: Number.isSafeInteger(contextCounter) && contextCounter >= 0 ? contextCounter : 0,
        photoKey: typeof photoKey === "string" && photoKey.length > 0 ? photoKey : null,
        photoUuid: typeof photoUuid === "string" && photoUuid.length > 0 ? photoUuid : null,
        processId: null,
        browsePosition: null,
        browseLabel: null,
        selectedToken: null,
        selectedLabel: null,
        source: null,
        supportsAmount: null,
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

function normalizeRawLabel(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.available !== true) {
        throw new ProfileUnavailableError(input && input.reason);
    }
    const selectedLabel = typeof input.selectedLabel === "string"
        ? input.selectedLabel
        : input.selected && typeof input.selected.label === "string" ? input.selected.label : null;
    if (!Number.isSafeInteger(input.processId) || input.processId <= 0 ||
        !validHandle(input.mainHwnd) || !validHandle(input.comboHwnd) || !validHandle(input.listHwnd) ||
        !input.patterns || input.patterns.selection !== true || input.patterns.expandCollapse !== true ||
        typeof selectedLabel !== "string" || selectedLabel.trim() !== selectedLabel || selectedLabel.length < 1 ||
        selectedLabel.length > MAX_LABEL_LENGTH || isBrowseLabel(selectedLabel)) {
        throw new ProfileUnavailableError("Malformed Lightroom Profile label snapshot");
    }
    return {
        processId: input.processId,
        mainHwnd: input.mainHwnd,
        comboHwnd: input.comboHwnd,
        listHwnd: input.listHwnd,
        selectedLabel: selectedLabel
    };
}

function publicClone(state) {
    return {
        available: state.available,
        updating: state.updating,
        reason: state.reason,
        revision: state.revision,
        optionSnapshotRevision: state.optionSnapshotRevision,
        contextCounter: state.contextCounter,
        photoKey: state.photoKey,
        photoUuid: state.photoUuid,
        processId: state.processId,
        browsePosition: state.browsePosition,
        browseLabel: state.browseLabel,
        selectedToken: state.selectedToken,
        selectedLabel: state.selectedLabel,
        source: state.source,
        supportsAmount: state.supportsAmount,
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
    const contextInventoryStableReads = positiveIntegerOption(
        options, "contextInventoryStableReads", DEFAULT_CONTEXT_INVENTORY_STABLE_READS
    );
    const now = options.now === undefined ? Date.now : options.now;
    if (typeof now !== "function") throw new TypeError("now must be a function");

    let revision = 0;
    let optionSnapshotRevision = 0;
    let optionSignature = null;
    let contextCounter = 0;
    let photoKey = null;
    let photoUuid = null;
    let contextChangedAt = null;
    let contextDevelopBaseline = 0;
    let currentDevelopCounter = 0;
    let currentDevelopChangedAt = null;
    let contextDevelopReady = false;
    let sdkLabelAccepted = null;
    let sdkSourceAccepted = null;
    let sdkSupportsAmountAccepted = null;
    let uiaFallbackLabel = null;
    let privateSnapshot = null;
    let state = unavailableProfileState(
        "Lightroom Profile state has not been read yet", revision, optionSnapshotRevision, contextCounter
    );
    let refreshInFlight = null;
    let labelRefreshInFlight = null;
    let contextRefreshInFlight = null;
    let contextInventoryPending = false;
    let contextInventorySignature = null;
    let contextInventoryMatches = 0;
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
        labelRefreshRequests: 0,
        nativeLabelReads: 0,
        sharedLabelRefreshes: 0,
        contextRefreshRequests: 0,
        sdkFeedbackAccepted: 0,
        sdkFeedbackRejected: 0,
        developContextReady: 0,
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
            photoKey: photoKey,
            photoUuid: photoUuid,
            processId: snapshot.processId,
            mainHwnd: snapshot.mainHwnd,
            comboHwnd: snapshot.comboHwnd,
            listHwnd: snapshot.listHwnd,
            browsePosition: snapshot.browsePosition,
            options: snapshot.options
        });
    }

    function contextStabilitySignature(snapshot) {
        return JSON.stringify({
            contextCounter: contextCounter,
            photoKey: photoKey,
            photoUuid: photoUuid,
            processId: snapshot.processId,
            mainHwnd: snapshot.mainHwnd,
            comboHwnd: snapshot.comboHwnd,
            listHwnd: snapshot.listHwnd,
            expanded: snapshot.expanded,
            browsePosition: snapshot.browsePosition,
            browseLabel: snapshot.browseLabel,
            selected: snapshot.selected,
            options: snapshot.options
        });
    }

    function tokenFor(snapshot, option) {
        return "profile_" + crypto.createHmac("sha256", secret)
            .update(String(optionSnapshotRevision)).update("\0")
            .update(String(contextCounter)).update("\0")
            .update(String(photoKey)).update("\0")
            .update(String(photoUuid)).update("\0")
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

    function makeUnavailable(reason, updating) {
        revision += 1;
        if (optionSignature !== null || privateSnapshot !== null) optionSnapshotRevision += 1;
        optionSignature = null;
        privateSnapshot = null;
        state = unavailableProfileState(
            reason, revision, optionSnapshotRevision, contextCounter, updating, photoKey, photoUuid
        );
        return publicClone(state);
    }

    function applyNormalizedLabel(normalized) {
        if (!contextInventoryPending || !contextDevelopReady) return publicClone(state);
        uiaFallbackLabel = normalized.selectedLabel;
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
        const sdkFeedbackMatches = sdkLabelAccepted === selectedOption.label;
        const source = sdkFeedbackMatches ? sdkSourceAccepted : null;
        const supportsAmount = sdkFeedbackMatches ? sdkSupportsAmountAccepted : null;
        privateSnapshot = normalized;
        state = {
            available: true,
            updating: false,
            reason: null,
            revision: revision,
            optionSnapshotRevision: optionSnapshotRevision,
            contextCounter: contextCounter,
            photoKey: photoKey,
            photoUuid: photoUuid,
            processId: normalized.processId,
            browsePosition: normalized.browsePosition,
            browseLabel: normalized.browseLabel,
            selectedToken: selectedOption.token,
            selectedLabel: selectedOption.label,
            source: source,
            supportsAmount: supportsAmount,
            validationGeneration: sdkValidationGeneration,
            validationFailedGeneration: sdkValidationFailedGeneration,
            options: publicOptions
        };
        if (sdkLabelAccepted !== selectedOption.label) {
            sdkLabelAccepted = null;
            sdkSourceAccepted = null;
            sdkSupportsAmountAccepted = null;
        }
        uiaFallbackLabel = selectedOption.label;

        expireSdkWritePending(now());
        if (sdkWritePending) {
            if (sdkWritePending.contextCounter !== contextCounter || sdkWritePending.photoKey !== photoKey ||
                sdkWritePending.photoUuid !== photoUuid || sdkWritePending.processId !== normalized.processId) {
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
        const normalized = normalizeRawSnapshot(input);
        let applied;
        if (contextInventoryPending) {
            if (!contextDevelopReady) return publicClone(state);
            const confirmationLabel = sdkLabelAccepted !== null ? sdkLabelAccepted : uiaFallbackLabel;
            if (confirmationLabel !== null && normalized.selected.label !== confirmationLabel) {
                contextInventorySignature = null;
                contextInventoryMatches = 0;
                return publicClone(state);
            }
            const nextStabilitySignature = contextStabilitySignature(normalized);
            if (nextStabilitySignature === contextInventorySignature) contextInventoryMatches += 1;
            else {
                contextInventorySignature = nextStabilitySignature;
                contextInventoryMatches = 1;
            }
            if (contextInventoryMatches >= contextInventoryStableReads) {
                contextInventoryPending = false;
                contextInventorySignature = null;
                contextInventoryMatches = 0;
                applied = applyNormalized(normalized);
            } else {
                applied = publicClone(state);
            }
        } else {
            if (sdkLabelAccepted !== null && normalized.selected.label !== sdkLabelAccepted) {
                return publicClone(state);
            }
            applied = applyNormalized(normalized);
        }
        if (consecutiveRefreshFailures > 0) diagnostics.refreshRecoveries += 1;
        consecutiveRefreshFailures = 0;
        lastSuccessfulRefreshAt = now();
        lastRefreshStartedAt = lastSuccessfulRefreshAt;
        return applied;
    }

    function contextMatches(capturedContextCounter, capturedPhotoKey, capturedPhotoUuid) {
        return capturedContextCounter === contextCounter && capturedPhotoKey === photoKey &&
            capturedPhotoUuid === photoUuid;
    }

    function recordRefreshFailure(error, capturedContextCounter, capturedPhotoKey, capturedPhotoUuid) {
        if (!contextMatches(capturedContextCounter, capturedPhotoKey, capturedPhotoUuid)) return publicClone(state);
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

    function normalizeContextBinding(input) {
        if (Number.isSafeInteger(input) && input >= 0) {
            return {
                contextCounter: input, photoKey: null, photoUuid: null, contextChangedAt: null,
                previousDevelopCounter: 0, developCounter: 1, developChangedAt: null, legacyReady: true
            };
        }
        if (!input || typeof input !== "object" || Array.isArray(input) ||
            !Number.isSafeInteger(input.contextCounter) || input.contextCounter < 0 ||
            (input.selectedPhotoKey !== null && input.selectedPhotoKey !== undefined &&
                (typeof input.selectedPhotoKey !== "string" || input.selectedPhotoKey.length < 1 ||
                    input.selectedPhotoKey.length > 1024)) ||
            (input.selectedPhotoUuid !== null && input.selectedPhotoUuid !== undefined &&
                (typeof input.selectedPhotoUuid !== "string" || input.selectedPhotoUuid.length < 1 ||
                    input.selectedPhotoUuid.length > 160)) ||
            !Number.isSafeInteger(input.previousDevelopCounter) || input.previousDevelopCounter < 0 ||
            !Number.isSafeInteger(input.developCounter) || input.developCounter < 0 ||
            (input.contextChangedAt !== null && !Number.isFinite(input.contextChangedAt)) ||
            (input.developChangedAt !== null && !Number.isFinite(input.developChangedAt))) {
            throw new TypeError("Invalid Profile context binding");
        }
        return {
            contextCounter: input.contextCounter,
            photoKey: input.selectedPhotoKey || null,
            photoUuid: input.selectedPhotoUuid || null,
            contextChangedAt: input.contextChangedAt,
            previousDevelopCounter: input.previousDevelopCounter,
            developCounter: input.developCounter,
            developChangedAt: input.developChangedAt,
            legacyReady: false
        };
    }

    function developAdvancedForContext(binding) {
        return binding.legacyReady || (binding.developCounter > contextDevelopBaseline &&
            Number.isFinite(binding.developChangedAt) && Number.isFinite(contextChangedAt) &&
            binding.developChangedAt >= contextChangedAt);
    }

    function syncContext(input) {
        const binding = normalizeContextBinding(input);
        const contextChanged = binding.contextCounter !== contextCounter || binding.photoKey !== photoKey ||
            binding.photoUuid !== photoUuid;
        if (!contextChanged) {
            currentDevelopCounter = binding.developCounter;
            currentDevelopChangedAt = binding.developChangedAt;
            if (!contextDevelopReady && developAdvancedForContext(binding)) {
                contextDevelopReady = true;
                diagnostics.developContextReady += 1;
            }
            return false;
        }
        contextCounter = binding.contextCounter;
        photoKey = binding.photoKey;
        photoUuid = binding.photoUuid;
        contextChangedAt = binding.contextChangedAt;
        contextDevelopBaseline = binding.previousDevelopCounter;
        currentDevelopCounter = binding.developCounter;
        currentDevelopChangedAt = binding.developChangedAt;
        contextDevelopReady = developAdvancedForContext(binding);
        if (contextDevelopReady) diagnostics.developContextReady += 1;
        sdkLabelAccepted = null;
        sdkSourceAccepted = null;
        sdkSupportsAmountAccepted = null;
        uiaFallbackLabel = null;
        if (sdkWritePending) diagnostics.sdkWritesCanceled += 1;
        sdkWritePending = null;
        sdkWriteRecord = null;
        sdkValidationGeneration = 0;
        sdkValidationFailedGeneration = 0;
        contextInventoryPending = true;
        contextInventorySignature = null;
        contextInventoryMatches = 0;
        makeUnavailable("Waiting for the current Lightroom photograph Profile options", true);
        lastRefreshStartedAt = null;
        lastSuccessfulRefreshAt = null;
        consecutiveRefreshFailures = 0;
        return true;
    }

    function observeSdkProfile(input) {
        const validSource = input && (input.source === "AILook" || input.source === "Look.Name" ||
            input.source === "CameraProfile");
        if (!input || typeof input !== "object" || Array.isArray(input) || !validSource ||
            !Number.isSafeInteger(input.contextCounter) || !Number.isSafeInteger(input.developCounter) ||
            typeof input.selectedPhotoKey !== "string" || input.selectedPhotoKey.length < 1 ||
            (input.selectedPhotoUuid !== null && input.selectedPhotoUuid !== undefined &&
                (typeof input.selectedPhotoUuid !== "string" || input.selectedPhotoUuid.length < 1)) ||
            typeof input.label !== "string" || input.label.trim() !== input.label || input.label.length < 1 ||
            input.label.length > MAX_LABEL_LENGTH || isBrowseLabel(input.label) ||
            (input.supportsAmount !== null && typeof input.supportsAmount !== "boolean") ||
            input.contextCounter !== contextCounter || input.developCounter !== currentDevelopCounter ||
            input.selectedPhotoKey !== photoKey || (input.selectedPhotoUuid || null) !== photoUuid ||
            !contextDevelopReady || input.developCounter <= contextDevelopBaseline || sdkWritePending) {
            diagnostics.sdkFeedbackRejected += 1;
            return false;
        }
        diagnostics.sdkFeedbackAccepted += 1;
        if (sdkLabelAccepted === input.label && state.selectedLabel === input.label && state.source === input.source &&
            state.supportsAmount === input.supportsAmount) return true;

        sdkLabelAccepted = input.label;
        sdkSourceAccepted = input.source;
        sdkSupportsAmountAccepted = input.supportsAmount;
        uiaFallbackLabel = null;
        revision += 1;
        if (optionSignature !== null || privateSnapshot !== null || state.available) optionSnapshotRevision += 1;
        optionSignature = null;
        privateSnapshot = null;
        contextInventoryPending = true;
        contextInventorySignature = null;
        contextInventoryMatches = 0;
        state = {
            available: false,
            updating: false,
            reason: "Profile options are updating",
            revision: revision,
            optionSnapshotRevision: optionSnapshotRevision,
            contextCounter: contextCounter,
            photoKey: photoKey,
            photoUuid: photoUuid,
            processId: null,
            browsePosition: null,
            browseLabel: null,
            selectedToken: null,
            selectedLabel: input.label,
            source: input.source,
            supportsAmount: input.supportsAmount,
            validationGeneration: sdkValidationGeneration,
            validationFailedGeneration: sdkValidationFailedGeneration,
            options: []
        };
        return true;
    }

    function refresh(force) {
        diagnostics.refreshRequests += 1;
        if (refreshInFlight !== null && refreshInFlight.contextCounter === contextCounter &&
            refreshInFlight.photoKey === photoKey && refreshInFlight.photoUuid === photoUuid) {
            diagnostics.sharedRefreshes += 1;
            return refreshInFlight.promise;
        }
        const requestedAt = now();
        expireSdkWritePending(requestedAt);
        if (force !== true && lastRefreshStartedAt !== null && requestedAt - lastRefreshStartedAt < refreshIntervalMs) {
            diagnostics.cachedRefreshes += 1;
            return Promise.resolve(publicClone(state));
        }
        const capturedContextCounter = contextCounter;
        const capturedPhotoKey = photoKey;
        const capturedPhotoUuid = photoUuid;
        diagnostics.nativeReads += 1;
        const work = Promise.resolve()
            .then(function () { return backend.readProfileSnapshot(); })
            .then(function (raw) {
                if (!contextMatches(capturedContextCounter, capturedPhotoKey, capturedPhotoUuid)) return publicClone(state);
                try { return applySuccessfulRaw(raw); }
                catch (error) {
                    return recordRefreshFailure(error, capturedContextCounter, capturedPhotoKey, capturedPhotoUuid);
                }
            }, function (error) {
                return recordRefreshFailure(error, capturedContextCounter, capturedPhotoKey, capturedPhotoUuid);
            });
        const entry = {
            contextCounter: capturedContextCounter, photoKey: capturedPhotoKey, photoUuid: capturedPhotoUuid, promise: null
        };
        entry.promise = work.finally(function () {
            if (refreshInFlight === entry) refreshInFlight = null;
        });
        refreshInFlight = entry;
        return entry.promise;
    }

    function refreshLabel() {
        diagnostics.labelRefreshRequests += 1;
        if (labelRefreshInFlight !== null && labelRefreshInFlight.contextCounter === contextCounter &&
            labelRefreshInFlight.photoKey === photoKey && labelRefreshInFlight.photoUuid === photoUuid) {
            diagnostics.sharedLabelRefreshes += 1;
            return labelRefreshInFlight.promise;
        }
        const capturedContextCounter = contextCounter;
        const capturedPhotoKey = photoKey;
        const capturedPhotoUuid = photoUuid;
        diagnostics.nativeLabelReads += 1;
        const readLabel = typeof backend.readProfileLabel === "function"
            ? function () { return backend.readProfileLabel(); }
            : function () { return backend.readProfileSnapshot(); };
        const work = Promise.resolve()
            .then(readLabel)
            .then(function (raw) {
                if (!contextMatches(capturedContextCounter, capturedPhotoKey, capturedPhotoUuid)) return publicClone(state);
                try { return applyNormalizedLabel(normalizeRawLabel(raw)); }
                catch (error) {
                    return recordRefreshFailure(error, capturedContextCounter, capturedPhotoKey, capturedPhotoUuid);
                }
            }, function (error) {
                return recordRefreshFailure(error, capturedContextCounter, capturedPhotoKey, capturedPhotoUuid);
            });
        const entry = {
            contextCounter: capturedContextCounter, photoKey: capturedPhotoKey, photoUuid: capturedPhotoUuid, promise: null
        };
        entry.promise = work.finally(function () {
            if (labelRefreshInFlight === entry) labelRefreshInFlight = null;
        });
        labelRefreshInFlight = entry;
        return entry.promise;
    }

    function requestContextRefresh() {
        diagnostics.contextRefreshRequests += 1;
        if (contextRefreshInFlight !== null && contextRefreshInFlight.contextCounter === contextCounter &&
            contextRefreshInFlight.photoKey === photoKey && contextRefreshInFlight.photoUuid === photoUuid) {
            return contextRefreshInFlight.promise;
        }
        const capturedContextCounter = contextCounter;
        const capturedPhotoKey = photoKey;
        const capturedPhotoUuid = photoUuid;
        const work = refreshLabel()
            .then(function () {
                if (!contextMatches(capturedContextCounter, capturedPhotoKey, capturedPhotoUuid)) return publicClone(state);
                return refresh(true);
            })
            .then(function () {
                if (!contextMatches(capturedContextCounter, capturedPhotoKey, capturedPhotoUuid) ||
                    !contextInventoryPending) return publicClone(state);
                return refresh(true);
            })
            .catch(function () { return publicClone(state); });
        const entry = {
            contextCounter: capturedContextCounter, photoKey: capturedPhotoKey, photoUuid: capturedPhotoUuid, promise: null
        };
        entry.promise = work.finally(function () {
            if (contextRefreshInFlight === entry) contextRefreshInFlight = null;
        });
        contextRefreshInFlight = entry;
        return entry.promise;
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
        sdkLabelAccepted = null;
        sdkSourceAccepted = null;
        sdkSupportsAmountAccepted = null;
        sdkWritePending = {
            generation: sdkWriteGeneration,
            token: token,
            label: matches[0].label,
            position: matches[0].position,
            contextCounter: contextCounter,
            photoKey: photoKey,
            photoUuid: photoUuid,
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
            sdkWriteRecord.photoKey !== photoKey || sdkWriteRecord.photoUuid !== photoUuid ||
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
        refreshContextLabel: refreshLabel,
        requestContextRefresh: requestContextRefresh,
        syncContext: syncContext,
        observeSdkProfile: observeSdkProfile,
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
                labelRefreshInFlight: labelRefreshInFlight !== null,
                contextRefreshInFlight: contextRefreshInFlight !== null,
                contextInventoryPending: contextInventoryPending,
                contextInventoryMatches: contextInventoryMatches,
                photoKey: photoKey,
                photoUuid: photoUuid,
                contextChangedAt: contextChangedAt,
                contextDevelopBaseline: contextDevelopBaseline,
                currentDevelopCounter: currentDevelopCounter,
                currentDevelopChangedAt: currentDevelopChangedAt,
                contextDevelopReady: contextDevelopReady,
                sdkLabelAccepted: sdkLabelAccepted,
                consecutiveRefreshFailures: consecutiveRefreshFailures,
                lastRefreshStartedAt: lastRefreshStartedAt,
                lastSuccessfulRefreshAt: lastSuccessfulRefreshAt,
                refreshIntervalMs: refreshIntervalMs,
                failureThreshold: failureThreshold,
                staleAfterMs: staleAfterMs,
                writeTimeoutMs: writeTimeoutMs,
                contextInventoryStableReads: contextInventoryStableReads,
                sdkWritePending: sdkWritePending !== null,
                sdkWriteGeneration: sdkWriteGeneration
            }, diagnostics);
        },
        resetForTests: function () {
            revision = 0;
            optionSnapshotRevision = 0;
            optionSignature = null;
            contextCounter = 0;
            photoKey = null;
            photoUuid = null;
            contextChangedAt = null;
            contextDevelopBaseline = 0;
            currentDevelopCounter = 0;
            currentDevelopChangedAt = null;
            contextDevelopReady = false;
            sdkLabelAccepted = null;
            sdkSourceAccepted = null;
            sdkSupportsAmountAccepted = null;
            uiaFallbackLabel = null;
            privateSnapshot = null;
            state = unavailableProfileState("Lightroom Profile state has not been read yet", 0, 0, 0);
            refreshInFlight = null;
            labelRefreshInFlight = null;
            contextRefreshInFlight = null;
            contextInventoryPending = false;
            contextInventorySignature = null;
            contextInventoryMatches = 0;
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
    DEFAULT_CONTEXT_INVENTORY_STABLE_READS,
    PUBLIC_UNAVAILABLE_REASON,
    ProfileUnavailableError,
    ProfileRejectedError,
    isBrowseLabel,
    unavailableProfileState,
    normalizeRawSnapshot,
    normalizeRawLabel,
    createProfileNativeState
});
