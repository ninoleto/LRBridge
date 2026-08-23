const express = require("express");
const WebSocket = require("ws");

const commands = require("./commands");
const sliders = require("./sliders");
const context = require("./context");
const numbers = require("./numbers");
const colorGrading = require("./color-grading");
const enhance = require("./enhance-state").createEnhanceState();
const pointColorDefinition = require("./point-color-state");
const history = require("./history-state").createHistoryState();
const pointColor = pointColorDefinition.createPointColorState();
const lensBlurDefinition = require("./lens-blur-state");
const lensBlur = lensBlurDefinition.createLensBlurState();
const focalRangeDefinition = require("./lens-blur-focal-range");
const windowsNativeDefinition = require("./windows-lightroom-native");
const developCategoricalDefinition = require("./develop-categorical-state");
const profileNativeDefinition = require("./profile-native-state");

const HTTP_PORT = 17891;
const WS_PORT = 17890;
const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
const HTTP_REQUEST_TIMEOUT_MS = 60_000;
const HTTP_HEADERS_TIMEOUT_MS = 15_000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const HTTP_MAX_HEADERS_COUNT = 64;

function positiveFiniteIntegerOption(options, name, defaultValue) {
    const value = options[name] === undefined ? defaultValue : options[name];

    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(name + " must be a positive finite integer");
    }

    return value;
}

function parseStrictFiniteNumber(value) {
    if (typeof value !== "string" || value === "" || value.trim() !== value || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function createBridge(options) {
options = options || {};
const httpPort = options.httpPort === undefined ? HTTP_PORT : options.httpPort;
const wsPort = options.wsPort === undefined ? WS_PORT : options.wsPort;
const httpHost = options.httpHost;
const wsHost = options.wsHost;
const wsMaxPayloadBytes = options.wsMaxPayloadBytes === undefined
    ? WS_MAX_PAYLOAD_BYTES
    : options.wsMaxPayloadBytes;
if (!Number.isFinite(wsMaxPayloadBytes) || !Number.isInteger(wsMaxPayloadBytes) || wsMaxPayloadBytes <= 0) {
    throw new TypeError("wsMaxPayloadBytes must be a positive finite integer");
}
const httpRequestTimeoutMs = positiveFiniteIntegerOption(
    options, "httpRequestTimeoutMs", HTTP_REQUEST_TIMEOUT_MS
);
const httpHeadersTimeoutMs = positiveFiniteIntegerOption(
    options, "httpHeadersTimeoutMs", HTTP_HEADERS_TIMEOUT_MS
);
const httpKeepAliveTimeoutMs = positiveFiniteIntegerOption(
    options, "httpKeepAliveTimeoutMs", HTTP_KEEP_ALIVE_TIMEOUT_MS
);
const httpMaxHeadersCount = positiveFiniteIntegerOption(
    options, "httpMaxHeadersCount", HTTP_MAX_HEADERS_COUNT
);
const windowsNativeBackend = options.windowsNativeBackend ||
    windowsNativeDefinition.createUnavailableWindowsBackend("Windows native backend was not configured");
if (!windowsNativeBackend || typeof windowsNativeBackend.readState !== "function" ||
    typeof windowsNativeBackend.setBrushValue !== "function" || typeof windowsNativeBackend.resetBrushValue !== "function" ||
    typeof windowsNativeBackend.adjustBrushValue !== "function" ||
    typeof windowsNativeBackend.setCheckbox !== "function" || typeof windowsNativeBackend.setRefinementMode !== "function" ||
    typeof windowsNativeBackend.setRefinementDisclosure !== "function" ||
    typeof windowsNativeBackend.resetRefinement !== "function" ||
    typeof windowsNativeBackend.activateFocusRangeAction !== "function" ||
    typeof windowsNativeBackend.stop !== "function") {
    throw new TypeError("windowsNativeBackend must implement the LRBridge Windows native backend interface");
}
if (httpHeadersTimeoutMs > httpRequestTimeoutMs) {
    throw new RangeError("httpHeadersTimeoutMs must not exceed httpRequestTimeoutMs");
}
const shutdownGraceMs = options.shutdownGraceMs === undefined ? 250 : options.shutdownGraceMs;
const app = express();
const developCategorical = developCategoricalDefinition.createDevelopCategoricalState();
const profileBackend = typeof windowsNativeBackend.readProfileSnapshot === "function"
    ? windowsNativeBackend
    : windowsNativeDefinition.createUnavailableWindowsBackend("Profile native backend was not configured");
const profileNative = profileNativeDefinition.createProfileNativeState(profileBackend, options.profileStateOptions);

function profileContextBinding(fields, previousDevelopCounter) {
    return {
        contextCounter: fields.contextCounter,
        selectedPhotoKey: fields.selectedPhotoKey,
        selectedPhotoUuid: fields.selectedPhotoUuid,
        contextChangedAt: fields.contextChangedAt,
        previousDevelopCounter: previousDevelopCounter,
        developCounter: fields.developCounter,
        developChangedAt: fields.developChangedAt
    };
}

commands.setPointColorAdmissionContextProvider(function () {
    const current = pointColor.get();
    return { selectedIndex: current.available ? current.selectedIndex : 0, contextCounter: context.getContextFields().contextCounter };
});

const feedbackRequests = [];
const feedbackValues = {};
const feedbackSnapshots = {};
const colorGradingSnapshots = {};
const treatmentSnapshots = {};
let feedbackRequestId = 0;
let focalRangeCommitCounter = 0;
const dedicatedFeedbackParameters = new Set(["CropAngle", "CropConstrainToWarp"]);

function isFeedbackParameter(value) {
    return sliders.exists(value) || dedicatedFeedbackParameters.has(value);
}

function createFeedbackSnapshot(id, requestedSliders) {
    feedbackSnapshots[id] = {
        id: id,
        requestedSliders: requestedSliders.slice(),
        results: {},
        complete: false,
        requestedAt: Date.now(),
        completedAt: null
    };

    const ids = Object.keys(feedbackSnapshots).map(Number).sort(function (a, b) { return a - b; });
    while (ids.length > 32) {
        const expiredId = ids.shift();
        delete feedbackSnapshots[expiredId];
        for (let i = feedbackRequests.length - 1; i >= 0; i -= 1) {
            if (feedbackRequests[i].id === expiredId) {
                feedbackRequests.splice(i, 1);
            }
        }
    }
}

function queueCommand(command) {
    return commands.tryEnqueueCommand(command);
}

function rejectInvalidCommand(res) {
    res.status(400).json({
        ok: false,
        error: "Invalid command"
    });
}

function queueOrReject(res, command, responseExtra, onAccepted) {
    const admission = queueCommand(command);

    if (admission.status === commands.ADMISSION_QUEUE_FULL) {
        rejectQueueFull(res, admission.queueLength);
        return;
    }

    if (!admission.accepted) {
        rejectInvalidCommand(res, command);
        return;
    }

    if (onAccepted) onAccepted();

    res.json(Object.assign({
        ok: true,
        queued: command
    }, responseExtra || {}));
}

function rejectQueueFull(res, queueLength) {
    res.set("Retry-After", "1").status(503).json({
        ok: false,
        error: "Command queue full",
        queueLength: queueLength,
        queueLimit: commands.HARD_QUEUE_CAPACITY,
        retryable: true
    });
}

app.get("/", function (req, res) {
    res.json({
        name: "LRBridge",
        ok: true,
        httpPort: httpServer && httpServer.address() ? httpServer.address().port : httpPort,
        wsPort: wsServer && wsServer.address() ? wsServer.address().port : wsPort,
        help: "/help"
    });
});

app.get("/help", function (req, res) {
    res.json({
        name: "LRBridge",
        mode: "one-way-lightroom-control",
        sourceOfTruth: "Lightroom visible UI",
        reliableEndpoints: {
            help: "/help",
            status: "/status",
            sliders: "/sliders",
            groups: "/groups",
            set: "/set?slider=Exposure&value=1.25",
            adjust: "/adjust?slider=Exposure&amount=1",
            reset: "/reset?slider=Exposure",
            navigateSelection: "/command?command=selection.navigate&direction=next",
            extendSelection: "/command?command=selection.extend&direction=right&amount=1",
            rotatePhoto: "/command?command=photo.rotate&direction=right",
            setPhotoTreatment: "/command?command=photo.treatment&value=grayscale",
            setPhotoCropAspect: "/command?command=photo.crop_aspect&mode=1x1",
            setPhotoCropAspect16x10: "/command?command=photo.crop_aspect&mode=16x10",
            setCustomPhotoCropAspect: "/command?command=photo.crop_aspect&mode=custom&w=16&h=10",
            setPhotoCropAngle: "/command?command=photo.crop_angle.set&value=-2.5",
            resetPhotoCropAngle: "/command?command=photo.crop_angle.reset",
            revealPhoto: "/command?command=photo.reveal&scope=active",
            openCropTool: "/command?command=develop.action&action=selectCropTool",
            resetCrop: "/command?command=develop.action&action=resetCrop",
            setFlag: "/command?command=selection.flag&flag=pick",
            setRating: "/command?command=selection.rating.set&rating=5",
            adjustRating: "/command?command=selection.rating.adjust&direction=increase",
            setColorLabel: "/command?command=selection.label.set&label=red",
            toggleColorLabel: "/command?command=selection.label.toggle&label=red",
            selectionOperation: "/command?command=selection.operation&operation=select_all",
            switchModule: "/command?command=application.module&module=library",
            showView: "/command?command=application.view&view=grid",
            applicationAction: "/command?command=application.action&action=toggle_zoom",
            secondaryView: "/command?command=application.secondary_view&view=loupe",
            setColorGradingWheel: "/command?command=color_grading.wheel.set&region=shadows&hue=220&saturation=35",
            setColorGradingValue: "/command?command=color_grading.value.set&control=blending&value=50",
            resetColorGradingRegion: "/command?command=color_grading.region.reset&region=shadows",
            resetColorGradingValue: "/command?command=color_grading.value.reset&control=balance",
            selectColorGradingView: "/command?command=color_grading.view.set&view=3-way",
            requestColorGradingSnapshot: "/color-grading/request",
            setLensBlurApply: "/lens-blur/apply?enabled=true",
            setLensBlurBokeh: "/lens-blur/bokeh?value=Circle",
            setLensBlurDepthVisualization: "/lens-blur/visualize-depth?enabled=true",
            setLensBlurAutoMask: "/lens-blur/auto-mask?enabled=true",
            setLensBlurRefinementMode: "/lens-blur/refinement-mode?value=focus",
            setLensBlurRefinementDisclosure: "/lens-blur/refinement-disclosure?open=true",
            resetLensBlurRefinement: "/lens-blur/refinement-reset?confirmed=true",
            setLensBlurBrushSize: "/lens-blur/brush/size/set?value=31.0",
            adjustLensBlurBrushSize: "/lens-blur/brush/size/adjust?amount=0.1",
            resetLensBlurBrushSize: "/lens-blur/brush/size/reset",
            setLensBlurFocalRange: "/lens-blur/focal-range/set?nearOuter=-80&nearInner=0&farInner=55&farOuter=135&expected=-43%2037%2057%20137",
            selectLensBlurDepthRefinement: "/lens-blur/depth-refinement/select",
            lensBlurState: "/lens-blur/state",
            deprecatedWakeEndpoint: "/wake-lightroom",
            libraryModuleCommand: "/command?command=application.module&module=library"
        },
        experimentalEndpoints: {
            get: "/get?slider=Exposure",
            lastResult: "/last-result"
        },
        notes: [
            "Use /set for absolute Web Controller values; /adjust remains available for Companion encoders.",
            "Do not depend on /get for feedback.",
            "Rapid pending absolute values coalesce independently per slider.",
            "amount means number of Lightroom increment steps.",
            "Accepted commands are queued; execution by Lightroom is not confirmed.",
            "Selection commands act on Lightroom's current selection and do not switch modules.",
            "First/last selection works in all modules in Lightroom Classic 13 or later; older versions may require Library.",
            "Color label metadata strings depend on Lightroom's active Color Label Set.",
            "Selection commands use the Lightroom SDK and do not depend on keyboard shortcuts or AutoHotkey.",
            "Application commands use LrApplicationView and only switch modules when application.module is requested.",
            "Color Grading uses documented case-sensitive SDK parameters and Lightroom runtime ranges; unavailable values have no static fallback.",
            "A wheel command carries one Hue/Saturation pair and executes two consecutive native setValue calls in Develop.",
            "Color Grading view selection requires Process Version 3 or newer.",
            "Lens Blur Amount, Cat Eye, and Boost are available only when Lightroom reports numeric values and runtime ranges; nil is unavailable.",
            "Lens Blur Bokeh selection is authoritative only after getSelectedLensBlurBokeh reports it; the getter can lag a successful setter.",
            "On Windows, Brush Refinement controls and Lens Blur checkboxes use dynamically discovered native controls and fail closed when identity is ambiguous.",
            "Visualize Depth and Auto Mask require explicit targets and authoritative BM_GETCHECK readback; blind toggles are not accepted.",
            "LensBlurFocalRange is a strict four-integer compound value and uses authoritative Lightroom SDK readback after writes.",
            "Selection operations and application controls are ordinary FIFO queue commands; they do not consume the protected reset/action reserve.",
            "Context heartbeats report Lightroom state and do not enqueue commands or switch modules.",
            "/wake-lightroom is deprecated; use /command?command=application.module&module=library."
        ]
    });
});

app.get("/wake-lightroom", function (req, res) {
    queueOrReject(res, {
        command: "application.module",
        module: "library"
    }, {
        deprecated: true,
        replacement: "/command?command=application.module&module=library"
    });
});

app.get("/status", function (req, res) {
    res.json(Object.assign(commands.getStatus(), context.getContextFields()));
});

app.get("/diagnostics/queue", function (req, res) {
    res.set("Cache-Control", "no-store").json(commands.getQueueDiagnostics());
});

app.get("/context", function (req, res) {
    const status = commands.getStatus();

    res.json(context.getContext(status.queueLength));
});

app.get("/context/update", function (req, res) {
    const previousContext = context.getContextFields();
    const updated = context.updateContext({
        activeModule: req.query.activeModule,
        selectedPhotoKey: req.query.selectedPhotoKey,
        selectedPhotoUuid: req.query.selectedPhotoUuid,
        selectedPhotoPath: req.query.selectedPhotoPath,
        developFingerprint: req.query.developFingerprint
    });
    enhance.syncContext(updated.contextCounter);
    pointColor.syncContext(updated.contextCounter);
    lensBlur.syncContext(updated.contextCounter);
    developCategorical.syncContext(updated.contextCounter);
    const profileContextChanged = profileNative.syncContext(
        profileContextBinding(updated, previousContext.developCounter)
    );
    if (profileContextChanged) profileNative.requestContextRefresh();

    if (updated.contextCounter !== previousContext.contextCounter) {
        history.invalidate();
        Object.keys(feedbackValues).forEach(function (slider) {
            delete feedbackValues[slider];
        });
        colorGrading.clearRuntimeRanges();
        Object.keys(colorGradingSnapshots).forEach(function (id) { delete colorGradingSnapshots[id]; });
    }

    const status = commands.getStatus();

    res.json(Object.assign({
        ok: true,
        queueLength: status.queueLength
    }, updated));
});

app.get("/sliders", function (req, res) {
    res.json({
        sliders: commands.getSliderMetadata()
    });
});

app.get("/color-grading", function (req, res) {
    res.set("Cache-Control", "no-store").json({ colorGrading: colorGrading.getMetadata() });
});

app.get("/color-grading/metadata", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.set("Cache-Control", "no-store").json({ ok: true, colorGrading: colorGrading.getMetadata() });
});

app.get("/groups", function (req, res) {
    res.json({
        groups: sliders.getGroups()
    });
});

app.get("/next", function (req, res) {
    const command = commands.getNextCommand();
    res.json({ command: command });
});

app.get("/enhance/state", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    enhance.requestRefresh();
    res.set("Cache-Control", "no-store").json(enhance.get());
});

app.get("/point-color/state", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    pointColor.requestRefresh();
    res.set("Cache-Control", "no-store").json({ ok: true, state: pointColor.get() });
});

app.get("/lens-blur/state", async function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    lensBlur.requestRefresh();
    let windowsNative;
    try { windowsNative = await windowsNativeBackend.readState(); }
    catch (error) { windowsNative = windowsNativeDefinition.unavailableNativeState(error.message); }
    res.set("Cache-Control", "no-store").json({
        ok: true,
        state: Object.assign(lensBlur.get(), { windowsNative: windowsNativeDefinition.sanitizeNativeState(windowsNative) }),
        revision: lensBlur.getRevision(),
        focalRangeCommitId: lensBlur.getFocalRangeCommitId()
    });
});

app.get("/develop-categorical/metadata", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.set("Cache-Control", "no-store").json({
        ok: true,
        whiteBalanceOptions: developCategoricalDefinition.whiteBalanceOptions,
        processOptions: developCategoricalDefinition.processOptions,
        vignetteStyleOptions: developCategoricalDefinition.vignetteStyleOptions,
        uprightModeOptions: developCategoricalDefinition.uprightModeOptions,
        capabilities: developCategoricalDefinition.capabilities
    });
});

app.get("/develop-categorical/state", async function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    developCategorical.requestRefresh();
    const contextFields = context.getContextFields();
    profileNative.syncContext(profileContextBinding(contextFields, contextFields.developCounter));
    const currentProfile = profileNative.get();
    if (currentProfile.updating) {
        await profileNative.refreshContextLabel();
        profileNative.refresh();
    } else if (!currentProfile.available && currentProfile.selectedLabel !== null) {
        profileNative.refresh();
    } else {
        await profileNative.refresh();
    }
    res.set("Cache-Control", "no-store").json({
        ok: true,
        state: developCategorical.get(),
        revision: developCategorical.getRevision(),
        profile: profileNative.get(),
        capabilities: developCategoricalDefinition.capabilities
    });
});

app.get("/develop-categorical/profile-feedback", function (req, res) {
    const allowed = new Set([
        "contextCounter", "developCounter", "selectedPhotoKey", "selectedPhotoUuid", "label", "source"
    ]);
    const feedbackContextCounter = Number(req.query.contextCounter);
    const feedbackDevelopCounter = Number(req.query.developCounter);
    if (Object.keys(req.query).length !== allowed.size ||
        Object.keys(req.query).some(function (key) { return !allowed.has(key) || Array.isArray(req.query[key]); }) ||
        !/^\d+$/.test(req.query.contextCounter || "") || !/^\d+$/.test(req.query.developCounter || "") ||
        !Number.isSafeInteger(feedbackContextCounter) || !Number.isSafeInteger(feedbackDevelopCounter) ||
        typeof req.query.selectedPhotoKey !== "string" || req.query.selectedPhotoKey.length < 1 ||
        req.query.selectedPhotoKey.length > 1024 || typeof req.query.selectedPhotoUuid !== "string" ||
        req.query.selectedPhotoUuid.length > 160 || typeof req.query.label !== "string" ||
        req.query.label.trim() !== req.query.label || req.query.label.length < 1 || req.query.label.length > 160 ||
        !["AILook", "Look.Name", "CameraProfile"].includes(req.query.source)) {
        return res.status(400).json({ ok: false, error: "Invalid Profile feedback" });
    }
    const previousProfile = profileNative.get();
    const accepted = profileNative.observeSdkProfile({
        contextCounter: feedbackContextCounter,
        developCounter: feedbackDevelopCounter,
        selectedPhotoKey: req.query.selectedPhotoKey,
        selectedPhotoUuid: req.query.selectedPhotoUuid || null,
        label: req.query.label,
        source: req.query.source
    });
    if (!accepted) return res.status(409).json({ ok: false, error: "Stale or unresolved Profile feedback" });
    if (previousProfile.selectedLabel !== req.query.label) profileNative.requestContextRefresh();
    res.set("Cache-Control", "no-store").json({ ok: true, profile: profileNative.get() });
});

app.get("/develop-categorical/next", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.json({ requested: developCategorical.takeRequest() });
});

app.get("/develop-categorical/result", function (req, res) {
    const allowed = new Set([
        "whiteBalanceAvailable", "whiteBalance",
        "processAvailable", "process", "vignetteStyleAvailable", "vignetteStyle",
        "uprightModeAvailable", "uprightMode", "constrainCropAvailable", "constrainCrop",
        "selectedToolAvailable", "selectedTool"
    ]);
    function booleanValue(name) {
        return req.query[name] === "true" ? true : req.query[name] === "false" ? false : null;
    }
    const input = {
        whiteBalanceAvailable: booleanValue("whiteBalanceAvailable"),
        whiteBalance: req.query.whiteBalance === undefined ? null : req.query.whiteBalance,
        processAvailable: booleanValue("processAvailable"),
        process: req.query.process === undefined ? null : req.query.process,
        vignetteStyleAvailable: booleanValue("vignetteStyleAvailable"),
        vignetteStyle: /^[1-3]$/.test(req.query.vignetteStyle || "") ? Number(req.query.vignetteStyle) : null,
        uprightModeAvailable: booleanValue("uprightModeAvailable"),
        uprightMode: /^[0-5]$/.test(req.query.uprightMode || "") ? Number(req.query.uprightMode) : null,
        constrainCropAvailable: booleanValue("constrainCropAvailable"),
        constrainCrop: /^[01]$/.test(req.query.constrainCrop || "") ? Number(req.query.constrainCrop) : null,
        selectedToolAvailable: booleanValue("selectedToolAvailable"),
        selectedTool: req.query.selectedTool === undefined ? null : req.query.selectedTool
    };
    if (Object.keys(req.query).some(function (key) { return !allowed.has(key) || Array.isArray(req.query[key]); }) ||
        input.whiteBalanceAvailable === null || input.processAvailable === null || input.vignetteStyleAvailable === null ||
        input.uprightModeAvailable === null || input.constrainCropAvailable === null || input.selectedToolAvailable === null ||
        !developCategorical.update(input)) {
        return res.status(400).json({ ok: false, error: "Invalid Develop categorical state" });
    }
    res.json({ ok: true, revision: developCategorical.getRevision() });
});

function queueDevelopCategoricalSet(req, res, specification) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.value)) return rejectInvalidCommand(res);
    const value = specification.parse(req.query.value);
    if (!specification.values.includes(value)) return rejectInvalidCommand(res);
    const current = developCategorical.get();
    if (current[specification.availableField] !== true) {
        return res.status(409).json({ ok: false, error: specification.label + " unavailable" });
    }
    const confirmationAfterRevision = developCategorical.getRevision();
    queueOrReject(res, { command: specification.command, value: value }, {
        confirmationAfterRevision: confirmationAfterRevision
    }, function () {
        if (specification.preserveAuthoritativeState !== true) developCategorical.invalidate(specification.control);
        developCategorical.requestRefresh(Date.now(), true);
    });
}

app.get("/develop-categorical/white-balance", function (req, res) {
    queueDevelopCategoricalSet(req, res, {
        control: "whiteBalance", command: "develop_categorical.white_balance.set", label: "White Balance",
        availableField: "whiteBalanceAvailable", values: developCategoricalDefinition.whiteBalanceWritableValues,
        preserveAuthoritativeState: true,
        parse: function (value) { return value; }
    });
});

app.get("/develop-categorical/profile", function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.token) ||
        !profileNativeDefinition.TOKEN_PATTERN.test(req.query.token || "")) return rejectInvalidCommand(res);
    const contextFields = context.getContextFields();
    profileNative.syncContext(profileContextBinding(contextFields, contextFields.developCounter));
    if (contextFields.activeModule !== "develop" || typeof contextFields.selectedPhotoKey !== "string" ||
        contextFields.selectedPhotoKey.length < 1) {
        return res.status(409).json({ ok: false, error: "Lightroom Develop photo context unavailable" });
    }
    let admission = null;
    try {
        admission = profileNative.admitSdkSelection(req.query.token);
        const command = {
            command: "develop_categorical.profile.set",
            profile: admission.label,
            expectedContextCounter: admission.contextCounter,
            profileGeneration: admission.generation
        };
        const queueAdmission = queueCommand(command);
        if (queueAdmission.status === commands.ADMISSION_QUEUE_FULL) {
            profileNative.cancelSdkSelection(admission.generation);
            return rejectQueueFull(res, queueAdmission.queueLength);
        }
        if (!queueAdmission.accepted) {
            profileNative.cancelSdkSelection(admission.generation);
            return rejectInvalidCommand(res);
        }
        res.set("Cache-Control", "no-store").json({
            ok: true,
            queued: command,
            confirmationAfterRevision: admission.confirmationAfterRevision,
            generation: admission.generation
        });
    } catch (error) {
        if (admission) profileNative.cancelSdkSelection(admission.generation);
        if (error && error.code === "LIGHTROOM_PROFILE_REJECTED") {
            return res.status(409).json({ ok: false, error: error.message });
        }
        res.status(503).json({ ok: false, error: error && error.message ? error.message : "Profile unavailable" });
    }
});

app.get("/develop-categorical/profile-validation", function (req, res) {
    if (Object.keys(req.query).length !== 3 || Array.isArray(req.query.generation) ||
        Array.isArray(req.query.profile) || Array.isArray(req.query.status) ||
        !/^\d+$/.test(req.query.generation || "") ||
        (req.query.status !== "confirmed" && req.query.status !== "failed") ||
        typeof req.query.profile !== "string" || req.query.profile.length < 1 || req.query.profile.length > 160) {
        return rejectInvalidCommand(res);
    }
    const generation = Number(req.query.generation);
    if (!Number.isSafeInteger(generation) || generation < 1 ||
        !profileNative.recordSdkValidation(generation, req.query.profile, req.query.status)) {
        return res.status(409).json({ ok: false, error: "Stale or mismatched Profile validation" });
    }
    res.set("Cache-Control", "no-store").json({ ok: true });
});

app.get("/develop-categorical/process", function (req, res) {
    queueDevelopCategoricalSet(req, res, {
        control: "process", command: "develop_categorical.process.set", label: "Process",
        availableField: "processAvailable", values: developCategoricalDefinition.processValues,
        parse: function (value) { return value; }
    });
});

app.get("/develop-categorical/vignette-style", function (req, res) {
    queueDevelopCategoricalSet(req, res, {
        control: "vignetteStyle", command: "develop_categorical.vignette_style.set", label: "Post-Crop Vignetting Style",
        availableField: "vignetteStyleAvailable", values: developCategoricalDefinition.vignetteStyleValues,
        parse: function (value) { return /^[1-3]$/.test(value || "") ? Number(value) : null; }
    });
});

app.get("/develop-categorical/upright-mode", function (req, res) {
    queueDevelopCategoricalSet(req, res, {
        control: "uprightMode", command: "develop_categorical.upright_mode.set", label: "Upright mode",
        availableField: "uprightModeAvailable", values: developCategoricalDefinition.uprightModeValues,
        parse: function (value) { return /^[0-5]$/.test(value || "") ? Number(value) : null; }
    });
});

app.get("/develop-categorical/constrain-crop", function (req, res) {
    queueDevelopCategoricalSet(req, res, {
        control: "constrainCrop", command: "develop_categorical.constrain_crop.set", label: "Constrain Crop",
        availableField: "constrainCropAvailable", values: developCategoricalDefinition.constrainCropValues,
        parse: function (value) { return /^[01]$/.test(value || "") ? Number(value) : null; }
    });
});

app.get("/develop-categorical/upright-tool", function (req, res) {
    if (Object.keys(req.query).length !== 0) return rejectInvalidCommand(res);
    const current = developCategorical.get();
    if (current.selectedToolAvailable !== true || current.uprightModeAvailable !== true) {
        return res.status(409).json({ ok: false, error: "Guided Upright tool unavailable" });
    }
    const confirmationAfterRevision = developCategorical.getRevision();
    queueOrReject(res, { command: "develop_categorical.upright_tool.select" }, {
        confirmationAfterRevision: confirmationAfterRevision
    }, function () {
        developCategorical.invalidate("selectedTool");
        developCategorical.requestRefresh(Date.now(), true);
    });
});

app.get("/lens-blur/next", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.json({ requested: lensBlur.takeRequest() });
});

app.get("/lens-blur/result", function (req, res) {
    const allowed = new Set([
        "activeAvailable", "active", "bokehAvailable", "bokeh", "selectedToolAvailable", "selectedTool",
        "focalRangeSourceAvailable", "focalRangeSource", "focalRangeAvailable", "focalRange", "focalRangeCommitId"
    ]);
    const booleanValue = function (name) {
        return req.query[name] === "true" ? true : req.query[name] === "false" ? false : null;
    };
    const input = {
        activeAvailable: booleanValue("activeAvailable"),
        active: req.query.active === undefined ? null : booleanValue("active"),
        bokehAvailable: booleanValue("bokehAvailable"),
        bokeh: req.query.bokeh === undefined ? null : req.query.bokeh,
        selectedToolAvailable: booleanValue("selectedToolAvailable"),
        selectedTool: req.query.selectedTool === undefined ? null : req.query.selectedTool,
        focalRangeSourceAvailable: req.query.focalRangeSourceAvailable === undefined
            ? false
            : booleanValue("focalRangeSourceAvailable"),
        focalRangeSource: req.query.focalRangeSource === undefined ? null : Number(req.query.focalRangeSource),
        focalRangeAvailable: booleanValue("focalRangeAvailable"),
        focalRange: req.query.focalRange === undefined ? null : req.query.focalRange,
        focalRangeCommitId: req.query.focalRangeCommitId === undefined ? null : req.query.focalRangeCommitId
    };
    if (Object.keys(req.query).some(function (key) { return !allowed.has(key) || Array.isArray(req.query[key]); }) ||
        input.activeAvailable === null || input.bokehAvailable === null || input.selectedToolAvailable === null ||
        input.focalRangeSourceAvailable === null ||
        (input.focalRangeCommitId !== null && (typeof input.focalRangeCommitId !== "string" ||
            !/^[A-Za-z0-9_-]{1,64}$/.test(input.focalRangeCommitId))) ||
        input.focalRangeAvailable === null || !lensBlur.update(input)) {
        return res.status(400).json({ ok: false, error: "Invalid Lens Blur state" });
    }
    res.json({ ok: true });
});

app.get("/lens-blur/apply", function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.enabled) ||
        (req.query.enabled !== "true" && req.query.enabled !== "false")) return rejectInvalidCommand(res);
    queueOrReject(res, { command: "lens_blur.active.set", enabled: req.query.enabled === "true" }, null, function () {
        lensBlur.invalidateActive();
        lensBlur.requestRefresh(Date.now(), true);
    });
});

app.get("/lens-blur/bokeh", function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.value) ||
        !lensBlurDefinition.bokehValues.includes(req.query.value)) return rejectInvalidCommand(res);
    if (!lensBlur.get().bokehAvailable) return res.status(409).json({ ok: false, error: "Lens Blur Bokeh unavailable" });
    queueOrReject(res, { command: "lens_blur.bokeh.set", value: req.query.value }, null, function () {
        lensBlur.invalidateBokeh();
        lensBlur.requestRefresh(Date.now(), true);
    });
});

app.get("/lens-blur/depth-visualization/toggle", function (req, res) {
    if (Object.keys(req.query).length !== 0) return rejectInvalidCommand(res);
    res.status(410).json({ ok: false, error: "Blind Visualize Depth toggles are unsupported; provide an explicit target" });
});

function validExplicitBooleanQuery(req) {
    return Object.keys(req.query).length === 1 && !Array.isArray(req.query.enabled) &&
        (req.query.enabled === "true" || req.query.enabled === "false");
}

function sendNativeFailure(res, error) {
    const unavailable = !error || error.code !== "LIGHTROOM_NATIVE_REJECTED";
    res.status(unavailable ? 503 : 400).json({
        ok: false,
        available: !unavailable,
        error: error && error.message ? error.message : "Windows Lightroom native controls unavailable"
    });
}

app.get("/lens-blur/brush/:control/set", async function (req, res) {
    const control = req.params.control;
    const value = parseStrictFiniteNumber(req.query.value);
    const keys = Object.keys(req.query);
    const interaction = req.query.interaction;
    const hasInteraction = typeof interaction === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(interaction);
    const hasFinal = req.query.final === "true" || req.query.final === "false";
    if (!windowsNativeDefinition.BRUSH_CONTROLS.includes(control) || Array.isArray(req.query.value) || value === null ||
        keys.some(function (key) { return !["value", "interaction", "final"].includes(key); }) ||
        (!hasInteraction && (keys.length !== 1 || keys[0] !== "value")) ||
        (hasInteraction && (!hasFinal || keys.length !== 3 || Array.isArray(req.query.interaction) || Array.isArray(req.query.final)))) {
        return rejectInvalidCommand(res);
    }
    try {
        const state = await windowsNativeBackend.setBrushValue(control, value, hasInteraction
            ? { interaction: interaction, final: req.query.final === "true" }
            : undefined);
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/brush/:control/adjust", async function (req, res) {
    const control = req.params.control;
    const amount = parseStrictFiniteNumber(req.query.amount);
    if (!windowsNativeDefinition.BRUSH_CONTROLS.includes(control) || Object.keys(req.query).length !== 1 ||
        Array.isArray(req.query.amount) || amount === null || amount === 0) return rejectInvalidCommand(res);
    try {
        const state = await windowsNativeBackend.adjustBrushValue(control, amount);
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/brush/:control/reset", async function (req, res) {
    const control = req.params.control;
    if (!windowsNativeDefinition.BRUSH_CONTROLS.includes(control) || Object.keys(req.query).length !== 0) {
        return rejectInvalidCommand(res);
    }
    try {
        const state = await windowsNativeBackend.resetBrushValue(control);
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/visualize-depth", async function (req, res) {
    if (!validExplicitBooleanQuery(req)) return rejectInvalidCommand(res);
    try {
        const state = await windowsNativeBackend.setCheckbox("visualizeDepth", req.query.enabled === "true");
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/auto-mask", async function (req, res) {
    if (!validExplicitBooleanQuery(req)) return rejectInvalidCommand(res);
    try {
        const state = await windowsNativeBackend.setCheckbox("autoMask", req.query.enabled === "true");
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/refinement-mode", async function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.value) ||
        (req.query.value !== "focus" && req.query.value !== "blur")) return rejectInvalidCommand(res);
    try {
        const state = await windowsNativeBackend.setRefinementMode(req.query.value);
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/refinement-disclosure", async function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.open) ||
        (req.query.open !== "true" && req.query.open !== "false")) return rejectInvalidCommand(res);
    try {
        const state = await windowsNativeBackend.setRefinementDisclosure(req.query.open === "true");
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/refinement-reset", async function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.confirmed) || req.query.confirmed !== "true") {
        return rejectInvalidCommand(res);
    }
    try {
        const state = await windowsNativeBackend.resetRefinement();
        res.set("Cache-Control", "no-store").json({ ok: true, windowsNative: windowsNativeDefinition.sanitizeNativeState(state) });
    } catch (error) { sendNativeFailure(res, error); }
});

app.get("/lens-blur/focus-action", async function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.value) ||
        (req.query.value !== "subject" && req.query.value !== "point-area")) return rejectInvalidCommand(res);
    const baselineRevision = lensBlur.getRevision();
    try {
        const state = await windowsNativeBackend.activateFocusRangeAction(req.query.value);
        if (req.query.value === "subject") {
            lensBlur.invalidateFocalRange();
            lensBlur.invalidateFocalRangeSource();
        } else {
            lensBlur.invalidateSelectedTool();
        }
        lensBlur.requestRefresh(Date.now(), true);
        res.set("Cache-Control", "no-store").json({
            ok: true,
            action: req.query.value,
            confirmationAfterRevision: baselineRevision,
            windowsNative: windowsNativeDefinition.sanitizeNativeState(state)
        });
    } catch (error) { sendNativeFailure(res, error); }
});

function currentFocalRangeMatches(expected) {
    const current = lensBlur.get();
    return current.focalRangeAvailable && typeof expected === "string" &&
        focalRangeDefinition.equal(current.focalRange, expected);
}

function queueFocalRange(res, range) {
    const value = focalRangeDefinition.format(range);
    if (value === null) return rejectInvalidCommand(res);
    focalRangeCommitCounter += 1;
    const commitId = "focus-range-" + focalRangeCommitCounter;
    queueOrReject(res, { command: "lens_blur.focal_range.set", value: value, commitId: commitId }, {
        focalRange: range,
        focalRangeCommitId: commitId
    }, function () {
        lensBlur.invalidateFocalRange();
        lensBlur.requestRefresh(Date.now(), true);
    });
}

app.get("/lens-blur/focal-range/set", function (req, res) {
    const expectedKeys = focalRangeDefinition.COMPONENTS.concat(["expected"]);
    const keys = Object.keys(req.query);
    if (keys.length !== expectedKeys.length || keys.some(function (key) {
        return !expectedKeys.includes(key) || Array.isArray(req.query[key]);
    })) return rejectInvalidCommand(res);
    const range = focalRangeDefinition.create(req.query);
    if (range === null) return rejectInvalidCommand(res);
    if (!currentFocalRangeMatches(req.query.expected)) {
        return res.status(409).json({ ok: false, error: "Lens Blur Focus Range is unavailable or stale" });
    }
    queueFocalRange(res, range);
});

app.get("/lens-blur/focal-range/adjust", function (req, res) {
    const keys = Object.keys(req.query);
    if (keys.length !== 3 || keys.some(function (key) {
        return !["part", "amount", "expected"].includes(key) || Array.isArray(req.query[key]);
    }) || !focalRangeDefinition.PARTS.includes(req.query.part)) return rejectInvalidCommand(res);
    const amount = focalRangeDefinition.parseComponent(req.query.amount);
    if (amount === null || amount === 0) return rejectInvalidCommand(res);
    const current = lensBlur.get();
    if (!current.focalRangeAvailable || !currentFocalRangeMatches(req.query.expected)) {
        return res.status(409).json({ ok: false, error: "Lens Blur Focus Range is unavailable or stale" });
    }
    const translated = focalRangeDefinition.translate(current.focalRange, req.query.part, amount);
    if (translated === null) return rejectInvalidCommand(res);
    queueFocalRange(res, translated);
});

app.get("/lens-blur/depth-refinement/select", function (req, res) {
    if (Object.keys(req.query).length !== 0) return rejectInvalidCommand(res);
    queueOrReject(res, { command: "lens_blur.depth_refinement.select" }, null, function () {
        lensBlur.invalidateSelectedTool();
        lensBlur.requestRefresh(Date.now(), true);
    });
});

app.get("/lens-blur/depth-refinement/close", function (req, res) {
    if (Object.keys(req.query).length !== 0) return rejectInvalidCommand(res);
    const current = lensBlur.get();
    if (!current.selectedToolAvailable) {
        return res.status(409).json({ ok: false, error: "Selected Lightroom tool is unavailable" });
    }
    if (current.selectedTool !== "depth_refinement") {
        return res.set("Cache-Control", "no-store").json({ ok: true, changed: false, selectedTool: current.selectedTool });
    }
    queueOrReject(res, { command: "lens_blur.depth_refinement.close" }, null, function () {
        lensBlur.invalidateSelectedTool();
        lensBlur.requestRefresh(Date.now(), true);
    });
});

app.get("/history/state", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    history.requestRefresh();
    res.set("Cache-Control", "no-store").json({ ok: true, state: history.get() });
});
app.get("/history/next", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.json({ requested: history.takeRequest() });
});
app.get("/history/result", function (req, res) {
    const allowed = ["sequence", "available", "canUndo", "canRedo"];
    const booleanValue = function (name) { return req.query[name] === "true" ? true : req.query[name] === "false" ? false : null; };
    const next = { available: booleanValue("available"), canUndo: booleanValue("canUndo"), canRedo: booleanValue("canRedo") };
    if (!/^\d+$/.test(req.query.sequence || "") || Object.keys(req.query).some(function (key) { return !allowed.includes(key) || Array.isArray(req.query[key]); }) ||
        Object.values(next).some(function (value) { return value === null; }) || !history.update(next)) return res.status(400).json({ ok: false, error: "Invalid history state" });
    res.json({ ok: true });
});
app.get("/point-color/next", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.json({ requested: pointColor.takeRequest() });
});

app.get("/point-color/result", function (req, res) {
    const available = req.query.available === "true" ? true : req.query.available === "false" ? false : null;
    const selectionTransient = req.query.selectionTransient === "true" ? true : req.query.selectionTransient === "false" ? false : null;
    const swatchCount = typeof req.query.swatchCount === "string" && /^\d+$/.test(req.query.swatchCount) ? Number(req.query.swatchCount) : null;
    const selectedIndex = typeof req.query.selectedIndex === "string" && /^\d+$/.test(req.query.selectedIndex) ? Number(req.query.selectedIndex) : null;
    const allowed = new Set(["available", "swatchCount", "selectedIndex", "selectionTransient", "HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]);
    for (const rangeName of pointColorDefinition.rangeNames) {
        allowed.add(pointColorDefinition.markerFields[rangeName]);
        for (const boundary of pointColorDefinition.boundaries) allowed.add(rangeName + "." + boundary);
    }
    if (available === null || swatchCount === null || selectedIndex === null || selectionTransient === null || Object.keys(req.query).some(function (key) { return !allowed.has(key) || Array.isArray(req.query[key]); })) {
        return res.status(400).json({ ok: false, error: "Invalid Point Color state" });
    }
    const input = { available: available, swatchCount: swatchCount, selectedIndex: selectedIndex, selectionTransient: selectionTransient };
    for (const field of pointColorDefinition.fields) {
        if (req.query[field] !== undefined) input[field] = parseStrictFiniteNumber(req.query[field]);
    }
    for (const rangeName of pointColorDefinition.rangeNames) {
        const markerField = pointColorDefinition.markerFields[rangeName];
        if (req.query[markerField] !== undefined) input[markerField] = parseStrictFiniteNumber(req.query[markerField]);
        input[rangeName] = {};
        for (const boundary of pointColorDefinition.boundaries) {
            const key = rangeName + "." + boundary;
            if (req.query[key] !== undefined) input[rangeName][boundary] = parseStrictFiniteNumber(req.query[key]);
        }
    }
    if (!pointColor.update(input)) return res.status(400).json({ ok: false, error: "Invalid Point Color state" });
    res.json({ ok: true });
});

app.get("/point-color/value", function (req, res) {
    const keys = Object.keys(req.query);
    const value = parseStrictFiniteNumber(req.query.value);
    if (keys.length !== 2 || !keys.includes("field") || !keys.includes("value") || Array.isArray(req.query.field) || Array.isArray(req.query.value)) return rejectInvalidCommand(res);
    const current = pointColor.get();
    const contextFields = context.getContextFields();
    if (!current.available || current.selectedIndex <= 0) return res.status(409).json({ ok: false, error: "No selected Point Color swatch" });
    const command = { command: "point_color.value.set", field: req.query.field, value: value,
        expectedSelectedIndex: current.selectedIndex, expectedContextCounter: contextFields.contextCounter };
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    queueOrReject(res, command, null, function () { pointColor.requestRefresh(Date.now(), true); });
});

app.get("/point-color/range", function (req, res) {
    const keys = Object.keys(req.query);
    const value = parseStrictFiniteNumber(req.query.value);
    if (keys.length !== 3 || !keys.includes("range") || !keys.includes("boundary") || !keys.includes("value") ||
        keys.some(function (key) { return Array.isArray(req.query[key]); })) return rejectInvalidCommand(res);
    const current = pointColor.get(); const contextFields = context.getContextFields();
    if (!current.available || current.selectedIndex <= 0) return res.status(409).json({ ok: false, error: "No selected Point Color swatch" });
    const proposed = Object.assign({}, current[req.query.range]);
    if (!proposed || !pointColorDefinition.validRangeValue(req.query.range, req.query.boundary, value)) return rejectInvalidCommand(res);
    proposed[req.query.boundary] = value;
    const marker = pointColorDefinition.effectiveMarker(current[req.query.range], current[pointColorDefinition.markerFields[req.query.range]]);
    if (marker === null || !pointColorDefinition.validRangeTranslation(req.query.range, proposed) || !pointColorDefinition.rangeContainsMarker(proposed, marker) || !pointColorDefinition.safeFullRangeWidth(proposed)) return rejectInvalidCommand(res);
    const command = { command: "point_color.range.set", range: req.query.range, boundary: req.query.boundary, value: value,
        expectedSelectedIndex: current.selectedIndex, expectedContextCounter: contextFields.contextCounter };
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    queueOrReject(res, command, null, function () { pointColor.requestRefresh(Date.now(), true); });
});

app.get("/point-color/range/translate", function (req, res) {
    const expected = ["range", "LowerNone", "LowerFull", "UpperFull", "UpperNone"];
    const keys = Object.keys(req.query);
    if (keys.length !== expected.length || keys.some(function (key) { return !expected.includes(key) || Array.isArray(req.query[key]); })) return rejectInvalidCommand(res);
    const translated = {};
    for (const boundary of pointColorDefinition.boundaries) translated[boundary] = parseStrictFiniteNumber(req.query[boundary]);
    const current = pointColor.get(); const contextFields = context.getContextFields();
    if (!current.available || current.selectedIndex <= 0) return res.status(409).json({ ok: false, error: "No selected Point Color swatch" });
    const marker = pointColorDefinition.effectiveMarker(current[req.query.range], current[pointColorDefinition.markerFields[req.query.range]]);
    if (marker === null || !pointColorDefinition.validRangeTranslation(req.query.range, translated) || !pointColorDefinition.rangeContainsMarker(translated, marker) || !pointColorDefinition.safeFullRangeWidth(translated)) return rejectInvalidCommand(res);
    const command = Object.assign({ command: "point_color.range.translate", range: req.query.range }, translated,
        { expectedSelectedIndex: current.selectedIndex, expectedContextCounter: contextFields.contextCounter });
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    queueOrReject(res, command, null, function () { pointColor.requestRefresh(Date.now(), true); });
});

app.get("/point-color/range-visualization/toggle", function (req, res) {
    if (Object.keys(req.query).length !== 0) return rejectInvalidCommand(res);
    queueOrReject(res, { command: "point_color.range_visualization.toggle" });
});

app.get("/point-color/tool/select", function (req, res) {
    if (Object.keys(req.query).length !== 0) return rejectInvalidCommand(res);
    queueOrReject(res, { command: "point_color.tool.select" });
});

app.get("/enhance/next", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    res.json({ requested: enhance.takeRequest() });
});

app.get("/enhance/result", function (req, res) {
    const allowed = new Set(["available", "denoiseState", "denoiseEnabled", "denoiseAmount",
        "rawDetailsState", "rawDetailsEnabled", "superResState", "superResEnabled",
        "enhanceNeedsUpdate", "operation", "operationTarget", "errorCategory", "info", "requestedEnabled"]);
    if (Object.keys(req.query).some(function (key) { return !allowed.has(key) || Array.isArray(req.query[key]); })) {
        return res.status(400).json({ ok: false, error: "Invalid Enhance state" });
    }
    function booleanField(name) { return req.query[name] === "true" ? true : req.query[name] === "false" ? false : null; }
    const amount = req.query.denoiseAmount === "null" ? null : (/^\d+$/.test(req.query.denoiseAmount || "") ? Number(req.query.denoiseAmount) : NaN);
    const result = { operation: req.query.operation, denoiseAmount: amount };
    for (const field of ["available", "denoiseState", "denoiseEnabled", "rawDetailsState",
        "rawDetailsEnabled", "superResState", "superResEnabled", "enhanceNeedsUpdate"]) result[field] = booleanField(field);
    if (req.query.errorCategory !== undefined) result.errorCategory = req.query.errorCategory;
    if (req.query.info !== undefined) result.info = req.query.info;
    if (req.query.requestedEnabled !== undefined) result.requestedEnabled = booleanField("requestedEnabled");
    if (req.query.operationTarget !== undefined) result.operationTarget = req.query.operationTarget;
    if (!enhance.update(result)) return res.status(400).json({ ok: false, error: "Invalid Enhance state" });
    if (enhance.TERMINAL_STATES.has(result.operation)) commands.finishEnhanceOperation();
    res.json({ ok: true });
});

app.get("/enhance/denoise/set", function (req, res) {
    const keys = Object.keys(req.query);
    if (keys.length !== 2 || !keys.includes("enabled") || !keys.includes("amount") ||
        Array.isArray(req.query.enabled) || Array.isArray(req.query.amount) ||
        (req.query.enabled !== "true" && req.query.enabled !== "false") || !/^\d+$/.test(req.query.amount || "")) {
        return rejectInvalidCommand(res);
    }
    const command = { command: "enhance.denoise.set", enabled: req.query.enabled === "true", amount: Number(req.query.amount) };
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    if (!enhance.acceptOperation(command.enabled, "denoise")) return res.status(409).json({ ok: false, error: "Enhance operation already pending" });
    const admission = queueCommand(command);
    if (admission.status === commands.ADMISSION_QUEUE_FULL) {
        enhance.cancelAdmission();
        return rejectQueueFull(res, admission.queueLength);
    }
    if (!admission.accepted) {
        enhance.cancelAdmission();
        return rejectInvalidCommand(res);
    }
    enhance.requestRefresh(Date.now(), true);
    res.json({ ok: true, queued: command });
});

app.get("/enhance/raw-details/set", function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.enabled) ||
        (req.query.enabled !== "true" && req.query.enabled !== "false")) return rejectInvalidCommand(res);
    const command = { command: "enhance.raw_details.set", enabled: req.query.enabled === "true" };
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    if (!enhance.acceptOperation(command.enabled, "rawDetails")) return res.status(409).json({ ok: false, error: "Enhance operation already pending" });
    const admission = queueCommand(command);
    if (!admission.accepted) { enhance.cancelAdmission(); return res.status(409).json({ ok: false, error: "Enhance operation already pending" }); }
    enhance.requestRefresh(Date.now(), true);
    res.json({ ok: true, queued: command });
});

app.get("/enhance/super-resolution/set", function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.enabled) ||
        (req.query.enabled !== "true" && req.query.enabled !== "false")) return rejectInvalidCommand(res);
    const command = { command: "enhance.super_resolution.set", enabled: req.query.enabled === "true" };
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    const currentEnhance = enhance.get();
    if (command.enabled === true && (currentEnhance.available !== true || currentEnhance.superResEnabled !== true ||
        currentEnhance.superResState === true || currentEnhance.denoiseState === true)) {
        return res.status(409).json({ ok: false, error: "Super Resolution unavailable" });
    }
    if (command.enabled === false && (currentEnhance.available !== true || currentEnhance.superResEnabled !== true || currentEnhance.superResState !== true)) {
        return res.status(409).json({ ok: false, error: "Super Resolution unavailable" });
    }
    if (!enhance.acceptOperation(command.enabled, "superResolution")) return res.status(409).json({ ok: false, error: "Enhance operation already pending" });
    const admission = queueCommand(command);
    if (!admission.accepted) { enhance.cancelAdmission(); return res.status(409).json({ ok: false, error: "Enhance operation already pending" }); }
    enhance.requestRefresh(Date.now(), true);
    res.json({ ok: true, queued: command });
});


app.get("/enhance/amount-result", function (req, res) {
    const allowed = new Set(["available", "denoiseState", "denoiseEnabled", "denoiseAmount",
        "rawDetailsState", "rawDetailsEnabled", "superResState", "superResEnabled", "enhanceNeedsUpdate",
        "amountOperation", "requestedAmount", "errorCategory"]);
    if (Object.keys(req.query).some(function (key) { return !allowed.has(key) || Array.isArray(req.query[key]); })) {
        return res.status(400).json({ ok: false, error: "Invalid Denoise amount state" });
    }
    function bool(name) { return req.query[name] === "true" ? true : req.query[name] === "false" ? false : null; }
    const input = { amountOperation: req.query.amountOperation, requestedAmount: Number(req.query.requestedAmount),
        denoiseAmount: req.query.denoiseAmount === "null" ? null : Number(req.query.denoiseAmount) };
    for (const field of ["available", "denoiseState", "denoiseEnabled", "rawDetailsState", "rawDetailsEnabled",
        "superResState", "superResEnabled", "enhanceNeedsUpdate"]) input[field] = bool(field);
    if (req.query.errorCategory !== undefined) input.amountErrorCategory = req.query.errorCategory;
    if (!enhance.updateAmount(input)) return res.status(400).json({ ok: false, error: "Invalid Denoise amount state" });
    if (["applied", "failed", "uncertain"].includes(input.amountOperation)) commands.finishEnhanceAmountOperation();
    res.json({ ok: true });
});

app.get("/enhance/denoise/amount", function (req, res) {
    if (Object.keys(req.query).length !== 1 || Array.isArray(req.query.amount) || !/^\d+$/.test(req.query.amount || "")) return rejectInvalidCommand(res);
    const command = { command: "enhance.denoise.amount.set", amount: Number(req.query.amount) };
    if (!commands.validateCommand(command)) return rejectInvalidCommand(res);
    const admission = queueCommand(command);
    if (!admission.accepted) return admission.status === commands.ADMISSION_QUEUE_FULL ? rejectQueueFull(res, admission.queueLength) : res.status(409).json({ ok: false, error: "Denoise amount operation already pending" });
    enhance.acceptAmountOperation(command.amount);
    res.json({ ok: true, queued: command });
});

app.get("/command", function (req, res) {
    const commandName = req.query.command;

    const command = { command: commandName };

    for (const field of ["slider", "action", "direction", "flag", "label", "operation", "module", "view", "mode", "scope", "region", "control", "field", "range", "boundary", "LowerNone", "LowerFull", "UpperFull", "UpperNone"]) {
        if (req.query[field] !== undefined) command[field] = req.query[field];
    }

    const colorSchemas = {
        "color_grading.wheel.set": ["command", "region", "hue", "saturation"],
        "color_grading.value.set": ["command", "control", "value"],
        "color_grading.value.reset": ["command", "control"],
        "color_grading.region.reset": ["command", "region"],
        "color_grading.view.set": ["command", "view"]
    };
    if (commandName === "point_color.value.set") {
        const keys = Object.keys(req.query);
        if (keys.length !== 3 || !keys.includes("command") || !keys.includes("field") || !keys.includes("value") || keys.some(function (key) { return Array.isArray(req.query[key]); })) command.invalidQueryField = true;
    }
    if (commandName === "point_color.range.set") {
        const keys = Object.keys(req.query);
        if (keys.length !== 4 || !keys.includes("command") || !keys.includes("range") || !keys.includes("boundary") || !keys.includes("value") || keys.some(function (key) { return Array.isArray(req.query[key]); })) command.invalidQueryField = true;
    }
    if (commandName === "point_color.range.translate") {
        const expected = ["command", "range", "LowerNone", "LowerFull", "UpperFull", "UpperNone"];
        const keys = Object.keys(req.query);
        if (keys.length !== expected.length || keys.some(function (key) { return !expected.includes(key) || Array.isArray(req.query[key]); })) command.invalidQueryField = true;
        for (const boundary of pointColorDefinition.boundaries) command[boundary] = parseStrictFiniteNumber(req.query[boundary]);
    }
    if (commandName === "point_color.range_visualization.toggle" && (Object.keys(req.query).length !== 1 || Array.isArray(req.query.command))) command.invalidQueryField = true;
    if (commandName === "point_color.tool.select" && (Object.keys(req.query).length !== 1 || Array.isArray(req.query.command))) command.invalidQueryField = true;
    if (colorSchemas[commandName]) {
        const expected = colorSchemas[commandName];
        const keys = Object.keys(req.query);
        const invalid = keys.length !== expected.length || keys.some(function (key) {
            return !expected.includes(key) || Array.isArray(req.query[key]);
        });
        if (invalid) command.invalidQueryField = true;
        for (const field of ["hue", "saturation"]) {
            if (req.query[field] !== undefined) command[field] = parseStrictFiniteNumber(req.query[field]);
        }
    }

    if (commandName === "photo.crop_aspect") {
        const allowedQueryFields = new Set(["command", "mode", "w", "h"]);
        if (Object.keys(req.query).some(function (field) {
            return !allowedQueryFields.has(field);
        })) {
            command.invalidQueryField = true;
        }

        for (const field of ["w", "h"]) {
            if (req.query[field] !== undefined) {
                const raw = req.query[field];
                command[field] = typeof raw === "string" && /^\d+$/.test(raw)
                    ? Number(raw)
                    : raw;
            }
        }
    }

    if (commandName === "photo.crop_angle.set" || commandName === "photo.crop_angle.reset") {
        const allowedQueryFields = commandName === "photo.crop_angle.set"
            ? new Set(["command", "value"])
            : new Set(["command"]);

        if (Object.keys(req.query).some(function (field) {
            return !allowedQueryFields.has(field);
        })) {
            command.invalidQueryField = true;
        }
    }

    if (commandName === "develop.reset") {
        const allowedQueryFields = new Set(["command", "slider"]);
        if (Object.keys(req.query).some(function (field) {
            return !allowedQueryFields.has(field);
        })) {
            command.invalidQueryField = true;
        }
    }

    if (commandName === "enhance.denoise.set") {
        const keys = Object.keys(req.query);
        if (keys.length !== 3 || !keys.includes("command") || !keys.includes("enabled") || !keys.includes("amount") ||
            Array.isArray(req.query.command) || Array.isArray(req.query.enabled) || Array.isArray(req.query.amount) ||
            (req.query.enabled !== "true" && req.query.enabled !== "false") || !/^\d+$/.test(req.query.amount || "")) {
            command.invalidQueryField = true;
        }
        command.enabled = req.query.enabled === "true" ? true : req.query.enabled === "false" ? false : req.query.enabled;
    }
    if (commandName === "enhance.denoise.amount.set") {
        const keys = Object.keys(req.query);
        if (keys.length !== 2 || !keys.includes("command") || !keys.includes("amount") ||
            Array.isArray(req.query.command) || Array.isArray(req.query.amount) || !/^\d+$/.test(req.query.amount || "")) {
            command.invalidQueryField = true;
        }
    }

    if (req.query.amount !== undefined) {
        command.amount = numbers.parseFiniteNumber(req.query.amount);
    }

    if (req.query.value !== undefined) {
        if (commandName === "photo.treatment") {
            command.value = req.query.value;
        } else if (commandName === "photo.crop_angle.set") {
            const rawValue = req.query.value;
            command.value = typeof rawValue === "string" &&
                /^-?\d+(?:\.\d{1,2})?$/.test(rawValue)
                ? Number(rawValue)
                : rawValue;
        } else if (commandName === "develop.set") {
            const allowedQueryFields = new Set(["command", "slider", "value"]);
            command.value = Object.keys(req.query).some(function (field) {
                return !allowedQueryFields.has(field);
            }) ? req.query.value : sliders.parseAbsoluteValue(req.query.slider, req.query.value);
        } else if (commandName === "color_grading.value.set") {
            command.value = parseStrictFiniteNumber(req.query.value);
        } else {
            command.value = numbers.parseFiniteNumber(req.query.value);
        }
    }

    if (req.query.rating !== undefined) {
        command.rating = numbers.parseFiniteNumber(req.query.rating);
    }

    if (commandName === "point_color.range.set" || commandName === "point_color.range.translate") {
        const current = pointColor.get();
        if (!current.available || current.selectedIndex <= 0) return res.status(409).json({ ok: false, error: "No selected Point Color swatch" });
        const proposed = commandName === "point_color.range.set" ? Object.assign({}, current[command.range]) :
            { LowerNone: command.LowerNone, LowerFull: command.LowerFull, UpperFull: command.UpperFull, UpperNone: command.UpperNone };
        if (commandName === "point_color.range.set" && proposed) proposed[command.boundary] = command.value;
        const marker = pointColorDefinition.effectiveMarker(current[command.range], current[pointColorDefinition.markerFields[command.range]]);
        if (!proposed || marker === null || !pointColorDefinition.validRangeTranslation(command.range, proposed) ||
            !pointColorDefinition.rangeContainsMarker(proposed, marker) || !pointColorDefinition.safeFullRangeWidth(proposed)) return rejectInvalidCommand(res);
    }

    queueOrReject(res, command, null, command.command === "develop.get"
        ? commands.clearLatestResult
        : (command.command === "lightroom.undo" || command.command === "lightroom.redo")
            ? function () { history.invalidate(); history.requestRefresh(); pointColor.requestRefresh(Date.now(), true); }
            : null);
});

app.get("/adjust", function (req, res) {
    const slider = req.query.slider;
    const amount = numbers.parseFiniteNumber(req.query.amount);

    if (amount === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid amount",
            slider: slider
        });
        return;
    }

    const command = {
        command: "develop.adjust",
        slider: slider,
        amount: amount
    };

    queueOrReject(res, command);
});

app.get("/set", function (req, res) {
    const slider = req.query.slider;
    const allowedFields = new Set(["slider", "value"]);
    const hasExtraField = Object.keys(req.query).some(function (field) {
        return !allowedFields.has(field);
    });
    const value = hasExtraField ? null : slider === "CropConstrainToWarp"
        ? (/^[01]$/.test(req.query.value || "") ? Number(req.query.value) : null)
        : sliders.parseAbsoluteValue(slider, req.query.value);

    if (value === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: slider
        });
        return;
    }

    const command = {
        command: "develop.set",
        slider: slider,
        value: value
    };

    queueOrReject(res, command);
});

app.get("/action", function (req, res) {
    const action = req.query.action;

    const command = {
        command: "develop.action",
        action: action
    };

    queueOrReject(res, command);
});

app.get("/reset", function (req, res) {
    const slider = req.query.slider;

    if (Object.keys(req.query).length !== 1 || !sliders.exists(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    const command = {
        command: "develop.reset",
        slider: slider
    };

    queueOrReject(res, command);
});

app.get("/get", function (req, res) {
    const command = {
        command: "develop.get",
        slider: req.query.slider
    };

    queueOrReject(res, command, null, commands.clearLatestResult);
});

app.get("/result", function (req, res) {
    const rawValue = req.query.value;
    const numericValue = numbers.parseFiniteNumber(rawValue);

    if (numericValue === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: req.query.slider || null
        });
        return;
    }

    const result = {
        command: req.query.command || "develop.get.result",
        slider: req.query.slider || null,
        value: numericValue
    };

    commands.setLatestResult(result);

    res.json({ ok: true });
});

app.get("/last-result", function (req, res) {
    const result = commands.getLatestResult();
    res.json({ result: result });
});


app.get("/feedback/request", function (req, res) {
    const slider = req.query.slider;

    if (!isFeedbackParameter(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: slider,
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);
    createFeedbackSnapshot(request.id, [slider]);

    res.json({
        ok: true,
        request: request
    });
});

app.get("/feedback/request-all", function (req, res) {
    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: "__all__",
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);
    createFeedbackSnapshot(request.id, sliders.getAll()
        .filter(function (slider) { return slider.feedbackSupported === true; })
        .map(function (slider) { return slider.id; })
        .concat(["CropAngle"]));

    res.json({
        ok: true,
        request: request
    });
});

app.get("/feedback/request-many", function (req, res) {
    const rawSliders = String(req.query.sliders || "");

    const requestedSliders = rawSliders
        .split(",")
        .map(function (slider) {
            return slider.trim();
        })
        .filter(function (slider) {
            return slider.length > 0;
        });

    const validSliders = [];

    requestedSliders.forEach(function (slider) {
        if (isFeedbackParameter(slider) && !validSliders.includes(slider)) {
            validSliders.push(slider);
        }
    });

    if (validSliders.length === 0) {
        res.status(400).json({
            ok: false,
            error: "No valid sliders",
            sliders: requestedSliders
        });
        return;
    }

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: "__many__:" + validSliders.join(","),
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);
    createFeedbackSnapshot(request.id, validSliders);

    res.json({
        ok: true,
        request: request,
        count: validSliders.length,
        sliders: validSliders
    });
});

app.get("/feedback/next", function (req, res) {
    const request = feedbackRequests.shift() || null;

    res.json({
        ok: true,
        request: request
    });
});

app.get("/treatment/request", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    feedbackRequestId += 1;
    const request = { id: feedbackRequestId, treatment: true, requestedAt: Date.now() };
    feedbackRequests.push(request);
    treatmentSnapshots[request.id] = { id: request.id, status: "pending", grayscale: null };
    const treatmentIds = Object.keys(treatmentSnapshots).map(Number).sort(function (a, b) { return a - b; });
    while (treatmentIds.length > 32) delete treatmentSnapshots[treatmentIds.shift()];
    res.json({ ok: true, request: { id: request.id } });
});

app.get("/treatment/result", function (req, res) {
    const id = numbers.parseFiniteInteger(req.query.id);
    const status = req.query.status;
    const allowedFields = status === "available" ? ["id", "status", "grayscale"] : ["id", "status"];
    if (id === null || !["available", "unavailable"].includes(status) ||
        Object.keys(req.query).some(function (field) { return !allowedFields.includes(field); }) ||
        (status === "available" && !["true", "false"].includes(req.query.grayscale))) {
        return res.status(400).json({ ok: false, error: "Invalid treatment result" });
    }
    if (!treatmentSnapshots[id]) return res.status(404).json({ ok: false, error: "Unknown treatment request" });
    treatmentSnapshots[id] = {
        id: id,
        status: status,
        grayscale: status === "available" ? req.query.grayscale === "true" : null
    };
    res.json(treatmentSnapshots[id]);
});

app.get("/treatment/snapshot", function (req, res) {
    const id = numbers.parseFiniteInteger(req.query.id);
    if (id === null || Object.keys(req.query).length !== 1 || Array.isArray(req.query.id)) {
        return res.status(400).set("Cache-Control", "no-store").json({ error: "Invalid treatment request id" });
    }
    const snapshot = treatmentSnapshots[id];
    if (!snapshot) return res.status(404).set("Cache-Control", "no-store").json({ error: "Unknown treatment request" });
    res.set("Cache-Control", "no-store").json(snapshot);
});

app.get("/color-grading/request", function (req, res) {
    if (Object.keys(req.query).length !== 0) return res.status(400).json({ ok: false, error: "Invalid request" });
    feedbackRequestId += 1;
    const request = { id: feedbackRequestId, colorGrading: true, requestedAt: Date.now() };
    feedbackRequests.push(request);
    colorGradingSnapshots[request.id] = {
        id: request.id,
        parameters: {},
        view: null,
        complete: false,
        context: context.getContextFields(),
        requestedAt: request.requestedAt,
        completedAt: null
    };
    res.json({ ok: true, request: request });
});

app.get("/color-grading/result", function (req, res) {
    const id = numbers.parseFiniteInteger(req.query.id);
    const parameter = req.query.parameter;
    const unavailable = req.query.available === "0";
    const allowed = unavailable ? ["id", "parameter", "available"] : ["id", "parameter", "value", "min", "max"];
    if (id === null || !colorGrading.getParameterIds().includes(parameter) || Object.keys(req.query).some(function (key) {
        return !allowed.includes(key) || Array.isArray(req.query[key]);
    })) return res.status(400).json({ ok: false, error: "Invalid Color Grading result" });
    const value = unavailable ? null : numbers.parseFiniteNumber(req.query.value);
    const min = unavailable ? null : numbers.parseFiniteNumber(req.query.min);
    const max = unavailable ? null : numbers.parseFiniteNumber(req.query.max);
    if (!unavailable && (value === null || min === null || max === null || min >= max)) return res.status(400).json({ ok: false, error: "Invalid Color Grading result" });
    const snapshot = colorGradingSnapshots[id];
    if (!snapshot) return res.status(404).json({ ok: false, error: "Unknown Color Grading snapshot" });
    const result = { parameter: parameter, available: !unavailable, value: value, range: unavailable ? null : { min: min, max: max } };
    snapshot.parameters[parameter] = result;
    if (!unavailable) colorGrading.setRuntimeRange(parameter, min, max);
    finishColorGradingSnapshot(snapshot);
    res.json({ ok: true, result: result });
});

app.get("/color-grading/view-result", function (req, res) {
    const id = numbers.parseFiniteInteger(req.query.id);
    const unavailable = req.query.available === "0";
    const allowed = unavailable ? ["id", "available"] : ["id", "view"];
    if (id === null || Object.keys(req.query).some(function (key) { return !allowed.includes(key) || Array.isArray(req.query[key]); }) ||
        (!unavailable && !colorGrading.metadata.views.includes(req.query.view))) return res.status(400).json({ ok: false, error: "Invalid Color Grading view result" });
    const snapshot = colorGradingSnapshots[id];
    if (!snapshot) return res.status(404).json({ ok: false, error: "Unknown Color Grading snapshot" });
    snapshot.view = { available: !unavailable, value: unavailable ? null : req.query.view };
    finishColorGradingSnapshot(snapshot);
    res.json({ ok: true, view: snapshot.view });
});

function finishColorGradingSnapshot(snapshot) {
    snapshot.complete = snapshot.view !== null && colorGrading.getParameterIds().every(function (parameter) {
        return snapshot.parameters[parameter] !== undefined;
    });
    if (snapshot.complete && snapshot.completedAt === null) snapshot.completedAt = Date.now();
}

app.get("/color-grading/snapshot", function (req, res) {
    const id = numbers.parseFiniteInteger(req.query.id);
    if (id === null || Object.keys(req.query).length !== 1 || Array.isArray(req.query.id)) return res.status(400).json({ ok: false, error: "Invalid snapshot id" });
    const snapshot = colorGradingSnapshots[id];
    if (!snapshot) return res.status(404).json({ ok: false, error: "Unknown Color Grading snapshot" });
    res.set("Cache-Control", "no-store").json({ ok: true, snapshot: snapshot });
});

app.get("/feedback/result", function (req, res) {
    const slider = req.query.slider;
    const rawValue = req.query.value;
    const unavailable = req.query.available === "0" && rawValue === undefined;
    const allowedFields = unavailable
        ? new Set(["id", "slider", "available"])
        : new Set(["id", "slider", "value", "min", "max"]);
    const hasExtraField = Object.keys(req.query).some(function (field) {
        return !allowedFields.has(field);
    });
    const numericValue = numbers.parseFiniteNumber(rawValue);
    const rangeMin = numbers.parseFiniteNumber(req.query.min);
    const rangeMax = numbers.parseFiniteNumber(req.query.max);
    const requestId = numbers.parseFiniteInteger(req.query.id);

    if (!isFeedbackParameter(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    if (requestId === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid id",
            slider: slider
        });
        return;
    }

    if (
        hasExtraField ||
        (!unavailable && (
            numericValue === null ||
            rangeMin === null ||
            rangeMax === null ||
            rangeMin >= rangeMax
        ))
    ) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: slider
        });
        return;
    }

    const result = {
        id: requestId,
        slider: slider,
        value: unavailable ? null : numericValue,
        available: !unavailable,
        range: unavailable ? null : { min: rangeMin, max: rangeMax },
        receivedAt: Date.now()
    };

    if (!unavailable) {
        sliders.setRuntimeRange(slider, rangeMin, rangeMax);
    }

    feedbackValues[slider] = result;

    const snapshot = feedbackSnapshots[requestId];
    if (snapshot && snapshot.requestedSliders.includes(slider)) {
        snapshot.results[slider] = result;
        snapshot.complete = snapshot.requestedSliders.every(function (requestedSlider) {
            return snapshot.results[requestedSlider] !== undefined;
        });
        if (snapshot.complete && snapshot.completedAt === null) {
            snapshot.completedAt = Date.now();
        }
    }

    res.json({
        ok: true,
        result: result
    });
});

app.get("/feedback/value", function (req, res) {
    const slider = req.query.slider;

    if (!isFeedbackParameter(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    res.json({
        ok: true,
        result: feedbackValues[slider] || null
    });
});

app.get("/feedback/all", function (req, res) {
    res.json({
        ok: true,
        values: feedbackValues
    });
});

app.get("/feedback/snapshot", function (req, res) {
    const requestId = numbers.parseFiniteInteger(req.query.id);
    const hasExtraField = Object.keys(req.query).some(function (field) {
        return field !== "id";
    });

    if (requestId === null || hasExtraField) {
        res.status(400).set("Cache-Control", "no-store").json({
            ok: false,
            error: "Missing or invalid id"
        });
        return;
    }

    const snapshot = feedbackSnapshots[requestId];

    if (!snapshot) {
        res.status(404).set("Cache-Control", "no-store").json({
            ok: false,
            error: "Unknown feedback snapshot"
        });
        return;
    }

    res.set("Cache-Control", "no-store").json({
        ok: true,
        snapshot: snapshot
    });
});

let httpServer = null;
let wsServer = null;
let lifecycleState = "stopped";
let startPromise = null;
let stopPromise = null;
let restartPromise = null;
let restartRequested = false;
let stopRequested = false;
const httpSockets = new Set();

function attachWebSocketHandlers(server) {
server.on("connection", function (socket) {
    console.log("Client connected.");

    socket.on("message", function (message) {
        let command;

        try {
            command = JSON.parse(message.toString());
        } catch (err) {
            console.log("Invalid JSON");
            return;
        }

        const admission = commands.tryEnqueueCommand(command);
        if (admission.status === commands.ADMISSION_QUEUE_FULL) {
            socket.send(JSON.stringify({
                type: "error",
                code: "COMMAND_QUEUE_FULL",
                error: "Command queue full",
                queueLength: admission.queueLength,
                queueLimit: commands.HARD_QUEUE_CAPACITY,
                retryable: true
            }));
        }
    });

    socket.on("close", function () {
        console.log("Client disconnected.");
    });

    socket.on("error", function (err) {
        console.log("WebSocket client error: " + err.message);
    });
});
}

function closeWebSocketServer(server) {
    return new Promise(function (resolve) {
        if (!server) return resolve();

        // Lifecycle shutdown is intentionally forceful: connected clients are
        // terminated so WebSocketServer.close() cannot wait on them indefinitely.
        if (server.clients) {
            for (const client of server.clients) client.terminate();
        }

        try {
            server.close(function () { resolve(); });
        } catch (err) {
            resolve();
        }
    });
}

function closeHttpServer(server) {
    return new Promise(function (resolve) {
        if (!server) return resolve();
        let settled = false;
        let forceTimer = null;

        function finish() {
            if (settled) return;
            settled = true;
            if (forceTimer !== null) clearTimeout(forceTimer);
            resolve();
        }

        try {
            server.close(function () { finish(); });
        } catch (err) {
            finish();
            return;
        }

        if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
        forceTimer = setTimeout(function () {
            if (typeof server.closeAllConnections === "function") {
                server.closeAllConnections();
            } else {
                for (const socket of httpSockets) socket.destroy();
            }
            setTimeout(finish, 50);
        }, shutdownGraceMs);
    });
}

function listenHttp() {
    return new Promise(function (resolve, reject) {
        const server = httpHost === undefined
            ? app.listen(httpPort)
            : app.listen(httpPort, httpHost);
        server.requestTimeout = httpRequestTimeoutMs;
        server.headersTimeout = httpHeadersTimeoutMs;
        server.keepAliveTimeout = httpKeepAliveTimeoutMs;
        server.maxHeadersCount = httpMaxHeadersCount;
        httpServer = server;
        server.on("connection", function (socket) {
            httpSockets.add(socket);
            socket.once("close", function () { httpSockets.delete(socket); });
        });

        function onError(err) {
            server.removeListener("listening", onListening);
            reject(new Error("LRBridge HTTP server failed to listen on port " + httpPort + ": " + err.message));
        }

        function onListening() {
            server.removeListener("error", onError);
            console.log("LRBridge HTTP server listening on http://localhost:" + server.address().port);
            resolve();
        }

        server.once("error", onError);
        server.once("listening", onListening);
    });
}

function listenWebSocket() {
    return new Promise(function (resolve, reject) {
        const wsOptions = { port: wsPort, maxPayload: wsMaxPayloadBytes };
        if (wsHost !== undefined) wsOptions.host = wsHost;
        const server = new WebSocket.Server(wsOptions);
        wsServer = server;

        function onError(err) {
            server.removeListener("listening", onListening);
            reject(new Error("LRBridge WebSocket server failed to listen on port " + wsPort + ": " + err.message));
        }

        function onListening() {
            server.removeListener("error", onError);
            attachWebSocketHandlers(server);
            console.log("LRBridge WebSocket server listening on ws://localhost:" + server.address().port);
            resolve();
        }

        server.once("error", onError);
        server.once("listening", onListening);
    });
}

async function closeListeners() {
    const closingHttpServer = httpServer;
    const closingWebSocketServer = wsServer;
    await Promise.all([
        closeHttpServer(closingHttpServer),
        closeWebSocketServer(closingWebSocketServer),
        windowsNativeBackend.stop()
    ]);
    if (httpServer === closingHttpServer) httpServer = null;
    if (wsServer === closingWebSocketServer) wsServer = null;
    httpSockets.clear();
}

function start() {
    if (stopPromise) {
        restartRequested = true;
        if (!restartPromise) {
            restartPromise = stopPromise.then(function () {
                restartPromise = null;
                if (restartRequested) return start();
                return api;
            });
        }
        return restartPromise;
    }
    if (lifecycleState === "running") return Promise.resolve(api);
    if (startPromise) return startPromise;

    lifecycleState = "starting";
    stopRequested = false;
    startPromise = (async function () {
        try {
            const results = await Promise.allSettled([listenHttp(), listenWebSocket()]);
            const failed = results.find(function (result) { return result.status === "rejected"; });
            if (failed) throw failed.reason;
            lifecycleState = "running";
            return api;
        } catch (err) {
            await closeListeners();
            lifecycleState = "stopped";
            throw err;
        } finally {
            startPromise = null;
        }
    })();
    return startPromise;
}

function stop() {
    stopRequested = true;
    restartRequested = false;
    if (stopPromise) return stopPromise;
    if (lifecycleState === "stopped" && !startPromise) return Promise.resolve(api);

    stopPromise = (async function () {
        if (startPromise) {
            try { await startPromise; } catch (err) {}
        }
        lifecycleState = "stopping";
        await closeListeners();
        lifecycleState = "stopped";
        return api;
    })().finally(function () {
        stopPromise = null;
        stopRequested = false;
    });
    return stopPromise;
}

const api = {
    app: app,
    start: start,
    stop: stop,
    getState: function () { return lifecycleState; },
    getHttpServer: function () { return httpServer; },
    getWebSocketServer: function () { return wsServer; }
};

return api;
}

module.exports = {
    createBridge,
    HTTP_PORT,
    WS_PORT,
    WS_MAX_PAYLOAD_BYTES,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    HTTP_MAX_HEADERS_COUNT
};
