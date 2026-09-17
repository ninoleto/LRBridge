const sliders = require("./sliders");
const numbers = require("./numbers");
const colorGrading = require("./color-grading");
const pointColor = require("./point-color-state");
const lensBlur = require("./lens-blur-state");
const focalRange = require("./lens-blur-focal-range");
const context = require("./context");
const developCategorical = require("./develop-categorical-state");
const profileSdkRegistry = require("./profile-sdk-registry");
const pointCurve = require("./point-curve-state");
const maskingCorrections = require("../app/controller-masking-corrections");
const localPresets = require("./local-adjustment-presets");

const commandQueue = [];
let latestResult = null;
let enhanceOperationPending = false;
let enhanceAmountOperationPending = false;
let pointColorAdmissionContextProvider = null;
let developPresetAdmissionProvider = null;
let maskingAdmissionProvider = null;
let removeAdmissionProvider = null;
let reflectionsAdmissionProvider = null;
let peopleAdmissionProvider = null;
let redEyeAdmissionProvider = null;

const HARD_QUEUE_CAPACITY = 1024;
const ORDINARY_ADMISSION_CEILING = 896;
const PROTECTED_QUEUE_RESERVE = 128;

const queueEntryMetadata = [];
let highWaterMark = 0;
let enqueuedEntries = 0;
let coalescedCommands = 0;
let dequeuedEntries = 0;
let queueFullRejections = 0;
let lastEnqueuedAt = null;
let lastCoalescedAt = null;
let lastDequeuedAt = null;
let lastQueueFullRejectionAt = null;

const ADMISSION_ACCEPTED = "accepted";
const ADMISSION_COALESCED = "coalesced";
const ADMISSION_INVALID = "invalid";
const ADMISSION_QUEUE_FULL = "queue_full";

const allowedActions = [
    "resetAllDevelopAdjustments",
    "resetCrop",
    "resetTransforms",
    "setAutoTone",
    "setAutoWhiteBalance",
    "resetSpotRemoval",
    "resetRedeye",
    "selectCropTool",
    "selectHealingTool",
    "selectRedEyeTool",
    "selectUprightTool",
    "selectMaskingTool"
];

const allowedSelectionDirections = ["next", "previous", "first", "last"];
const allowedExtendDirections = ["left", "right"];
const allowedPhotoRotateDirections = ["left", "right"];
const allowedPhotoTreatments = ["grayscale", "color"];
const allowedPhotoCropAspects = ["original", "asshot", "1x1", "2x3", "4x5", "5x7", "16x9", "16x10"];
const allowedPhotoRevealScopes = ["active"];
const allowedFlags = ["pick", "reject", "none"];
const allowedRatingDirections = ["increase", "decrease"];
const allowedLabels = ["red", "yellow", "green", "blue", "purple", "none"];
const allowedToggleLabels = ["red", "yellow", "green", "blue", "purple"];
const allowedSelectionOperations = [
    "select_all",
    "select_none",
    "select_inverse",
    "deselect_active",
    "deselect_others"
];
const allowedApplicationModules = [
    "library",
    "develop",
    "map",
    "book",
    "slideshow",
    "print",
    "web"
];
const allowedApplicationViews = [
    "loupe",
    "grid",
    "compare",
    "survey",
    "people",
    "develop_loupe",
    "develop_before_after_horiz",
    "develop_before_after_vert",
    "develop_before",
    "develop_reference_horiz",
    "develop_reference_vert"
];
const allowedApplicationActions = [
    "toggle_zoom",
    "zoom_in",
    "zoom_out",
    "zoom_100",
    "fullscreen_preview",
    "fullscreen_hide_panels",
    "next_screen_mode",
    "cycle_loupe_info",
    "toggle_secondary_display",
    "toggle_secondary_fullscreen"
];
const allowedSecondaryViews = [
    "loupe",
    "live_loupe",
    "locked_loupe",
    "grid",
    "compare",
    "survey",
    "slideshow"
];

function validateCommand(command) {
    const allowedCommands = [
        "develop.adjust",
        "develop.get",
        "develop.set",
        "develop.reset",
        "develop.action",
        "photo.rotate",
        "photo.treatment",
        "photo.crop_aspect",
        "photo.crop_angle.set",
        "photo.crop_angle.reset",
        "photo.reveal",
        "selection.navigate",
        "selection.extend",
        "selection.flag",
        "selection.rating.set",
        "selection.rating.adjust",
        "selection.label.set",
        "selection.label.toggle",
        "selection.operation",
        "application.module",
        "application.view",
        "application.action",
        "application.secondary_view"
        ,"enhance.denoise.set"
        ,"enhance.denoise.amount.set"
        ,"enhance.raw_details.set"
        ,"enhance.super_resolution.set"
        ,"color_grading.wheel.set"
        ,"color_grading.value.set"
        ,"color_grading.value.reset"
        ,"color_grading.region.reset"
        ,"color_grading.view.set"
        ,"point_color.value.set"
        ,"point_color.range.set"
        ,"point_color.range.translate"
        ,"point_color.range_visualization.toggle"
        ,"point_color.tool.select"
        ,"lightroom.undo"
        ,"lightroom.redo"
        ,"lens_blur.active.set"
        ,"lens_blur.bokeh.set"
        ,"lens_blur.depth_visualization.toggle"
        ,"lens_blur.depth_refinement.select"
        ,"lens_blur.depth_refinement.close"
        ,"lens_blur.focal_range.set"
        ,"develop_categorical.white_balance.set"
        ,"develop_categorical.profile.set"
        ,"develop_categorical.process.set"
        ,"develop_categorical.vignette_style.set"
        ,"develop_categorical.upright_mode.set"
        ,"develop_categorical.constrain_crop.set"
        ,"develop_categorical.upright_tool.select"
        ,"tone_curve.gesture.begin"
        ,"tone_curve.gesture.update"
        ,"tone_curve.gesture.end"
        ,"tone_curve.gesture.cancel"
        ,"tone_curve.reset"
        ,"tone_curve.refine_saturation.gesture.begin"
        ,"tone_curve.refine_saturation.gesture.update"
        ,"tone_curve.refine_saturation.gesture.end"
        ,"tone_curve.refine_saturation.gesture.cancel"
        ,"tone_curve.refine_saturation.reset"
        ,"tone_curve.preset.set"
        ,"develop_presets.inventory.request"
        ,"develop_preset.apply"
        ,"develop_preset.amount.set"
        ,"masking.create"
        ,"remove.repair.action"
        ,"remove.repair.fill.set"
        ,"remove.repair.param.set"
        ,"remove.panel.set"
        ,"remove.brush.set"
        ,"remove.dust.off"
        ,"remove.dust.on"
        ,"remove.dust.close"
        ,"reflections.set"
        ,"people.action"
        ,"red_eye.action"
        ,"masking.component.add"
        ,"masking.component.subtract"
        ,"masking.component.delete"
        ,"masking.component.invert"
        ,"masking.panel.set"
        ,"masking.group.navigate"
        ,"masking.tool.navigate"
        ,"masking.group.visibility.set"
        ,"masking.tool.visibility.set"
    ];

    if (!command || typeof command !== "object" || Array.isArray(command)) {
        console.log("Invalid command");
        return false;
    }

    const hasTarget = Object.prototype.hasOwnProperty.call(command, "target");
    if (hasTarget &&
        (command.command !== "develop.action" || command.action !== "selectCropTool")) {
        return false;
    }

    if (command.command === "tone_curve.gesture.begin" || command.command === "tone_curve.gesture.update" ||
        command.command === "tone_curve.gesture.end" || command.command === "tone_curve.gesture.cancel" ||
        command.command === "tone_curve.reset") {
        const gestureCommand = command.command !== "tone_curve.reset";
        const carriesPoints = command.command === "tone_curve.gesture.update" || command.command === "tone_curve.gesture.end";
        const cancellation = command.command === "tone_curve.gesture.cancel";
        const expectedKeys = cancellation ? 7 : (gestureCommand ? (carriesPoints ? 9 : 8) : 7);
        if (Object.keys(command).length !== expectedKeys || !pointCurve.validChannel(command.channel) ||
            command.field !== pointCurve.fieldForChannel(command.channel) ||
            typeof command.expectedSelectedPhotoUuid !== "string" || command.expectedSelectedPhotoUuid.length < 1 ||
            command.expectedSelectedPhotoUuid.length > 160 ||
            !Number.isSafeInteger(command.expectedContextCounter) || command.expectedContextCounter < 0 ||
            !Number.isSafeInteger(command.expectedDevelopCounter) || command.expectedDevelopCounter < 0 ||
            (!cancellation && !pointCurve.validCurveArray(command.expectedPoints))) {
            return false;
        }
        if (gestureCommand && !pointCurve.GESTURE_ID_PATTERN.test(command.gestureId || "")) return false;
        if (carriesPoints && !pointCurve.validCurveArray(command.points)) return false;
        return true;
    }

    if (command.command === "tone_curve.refine_saturation.gesture.begin" ||
        command.command === "tone_curve.refine_saturation.gesture.update" ||
        command.command === "tone_curve.refine_saturation.gesture.end" ||
        command.command === "tone_curve.refine_saturation.gesture.cancel" ||
        command.command === "tone_curve.refine_saturation.reset") {
        const gestureCommand = command.command !== "tone_curve.refine_saturation.reset";
        const carriesValue = command.command === "tone_curve.refine_saturation.gesture.update" ||
            command.command === "tone_curve.refine_saturation.gesture.end";
        const cancellation = command.command === "tone_curve.refine_saturation.gesture.cancel";
        const expectedKeys = cancellation ? 6 : (gestureCommand ? (carriesValue ? 8 : 7) : 6);
        if (Object.keys(command).length !== expectedKeys ||
            command.field !== pointCurve.REFINE_SATURATION_FIELD ||
            typeof command.expectedSelectedPhotoUuid !== "string" || command.expectedSelectedPhotoUuid.length < 1 ||
            command.expectedSelectedPhotoUuid.length > 160 ||
            !Number.isSafeInteger(command.expectedContextCounter) || command.expectedContextCounter < 0 ||
            !Number.isSafeInteger(command.expectedDevelopCounter) || command.expectedDevelopCounter < 0 ||
            (!cancellation && !Number.isFinite(command.expectedValue))) return false;
        if (gestureCommand && !pointCurve.GESTURE_ID_PATTERN.test(command.gestureId || "")) return false;
        if (carriesValue && !Number.isFinite(command.value)) return false;
        return true;
    }

    if (command.command === "tone_curve.preset.set") {
        const target = pointCurve.presetCurve(command.preset);
        return Object.keys(command).length === 8 && target !== null &&
            command.field === pointCurve.CHANNEL_FIELDS.rgb &&
            typeof command.expectedSelectedPhotoUuid === "string" && command.expectedSelectedPhotoUuid.length >= 1 &&
            command.expectedSelectedPhotoUuid.length <= 160 &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.expectedDevelopCounter) && command.expectedDevelopCounter >= 0 &&
            pointCurve.validCurveArray(command.expectedPoints) && pointCurve.validCurveArray(command.points) &&
            pointCurve.serializeCurve(command.points) === pointCurve.serializeCurve(target);
    }

    if (command.command === "develop_presets.inventory.request") {
        return Object.keys(command).length === 2 &&
            typeof command.requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(command.requestId);
    }

    if (command.command === "develop_preset.apply") {
        return Object.keys(command).length === 11 && command.operationKind === "preset" &&
            !Object.prototype.hasOwnProperty.call(command, "presetAmount") &&
            typeof command.operationId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(command.operationId) &&
            typeof command.uuid === "string" && command.uuid.length >= 1 && command.uuid.length <= 200 &&
            !/[\u0000-\u001f\u007f]/.test(command.uuid) &&
            typeof command.updateAISettings === "boolean" &&
            command.expectedActiveModule === "develop" &&
            typeof command.expectedSelectedPhotoUuid === "string" && command.expectedSelectedPhotoUuid.length >= 1 &&
            command.expectedSelectedPhotoUuid.length <= 200 &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.expectedDevelopCounter) && command.expectedDevelopCounter >= 0 &&
            Number.isSafeInteger(command.expectedContextChangedAt) && command.expectedContextChangedAt >= 0 &&
            typeof command.expectedServerEpoch === "string" &&
            /^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch);
    }

    if (command.command === "develop_preset.amount.set") {
        return Object.keys(command).length === 10 &&
            Number.isSafeInteger(command.presetAmount) && command.presetAmount >= 0 && command.presetAmount <= 200 &&
            typeof command.expectedPresetUuid === "string" && command.expectedPresetUuid.length >= 1 &&
            command.expectedPresetUuid.length <= 200 && !/[\u0000-\u001f\u007f]/.test(command.expectedPresetUuid) &&
            command.expectedActiveModule === "develop" &&
            typeof command.expectedSelectedPhotoUuid === "string" && command.expectedSelectedPhotoUuid.length >= 1 &&
            command.expectedSelectedPhotoUuid.length <= 200 &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.expectedDevelopCounter) && command.expectedDevelopCounter >= 0 &&
            Number.isSafeInteger(command.expectedContextChangedAt) && command.expectedContextChangedAt >= 0 &&
            typeof command.expectedServerEpoch === "string" &&
            /^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch) &&
            Number.isSafeInteger(command.expectedFeedbackId) && command.expectedFeedbackId > 0;
    }

    if (command.command === "reflections.set") return require("./reflections-state").validCommand(command);
    if (command.command === "people.action") return require("./people-state").validCommand(command);
    if (command.command === "red_eye.action") return require("./red-eye-state").validCommand(command);
    if (["remove.dust.off", "remove.dust.on", "remove.dust.close", "remove.brush.set", "remove.panel.set", "remove.repair.action", "remove.repair.fill.set", "remove.repair.param.set"].includes(command.command)) return require("./remove-state").validCommand(command);

    if (command.command === "masking.component.add" || command.command === "masking.component.subtract" ||
        command.command === "masking.create" || command.command === "masking.panel.set" || command.command === "masking.group.navigate" ||
        command.command === "masking.tool.navigate" || command.command === "masking.group.visibility.set" ||
        command.command === "masking.tool.visibility.set") {
        const visibility = command.command === "masking.group.visibility.set" ||
            command.command === "masking.tool.visibility.set";
        const navigation = command.command === "masking.group.navigate" || command.command === "masking.tool.navigate";
        const toolNavigation = command.command === "masking.tool.navigate";
        const creation = command.command === "masking.create";
        const component = command.command === "masking.component.add" || command.command === "masking.component.subtract";
        if (Object.keys(command).length !== (component ? 15 : creation ? 12 : visibility ? 13 : (toolNavigation ? 12 : (navigation ? 11 : 10))) ||
            typeof command.operationId !== "string" || !/^mo-\d{1,15}$/.test(command.operationId) ||
            command.expectedActiveModule !== "develop" ||
            typeof command.expectedSelectedPhotoUuid !== "string" || command.expectedSelectedPhotoUuid.length < 1 ||
            command.expectedSelectedPhotoUuid.length > 200 ||
            Number.isSafeInteger(command.expectedContextCounter) === false || command.expectedContextCounter < 0 ||
            Number.isSafeInteger(command.expectedDevelopCounter) === false || command.expectedDevelopCounter < 0 ||
            Number.isSafeInteger(command.expectedContextChangedAt) === false || command.expectedContextChangedAt < 0 ||
            typeof command.expectedServerEpoch !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch) ||
            Number.isSafeInteger(command.expectedMaskingRevision) === false || command.expectedMaskingRevision < 1) return false;
        if (creation) return Boolean(maskingCorrections.creationType(command.maskType, command.maskSubtype)) &&
            Number.isSafeInteger(command.expectedMaskCount) && command.expectedMaskCount >= 0 && command.expectedMaskCount < 512;
        if (!component && !visibility && !navigation) return typeof command.open === "boolean";
        const validMaskId = typeof command.expectedSelectedMaskId === "string" &&
            command.expectedSelectedMaskId.length >= 1 && command.expectedSelectedMaskId.length <= 256 &&
            !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskId);
        const validToolId = typeof command.expectedSelectedMaskToolId === "string" &&
            command.expectedSelectedMaskToolId.length >= 1 && command.expectedSelectedMaskToolId.length <= 256 &&
            !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskToolId);
        if (!validMaskId) return false;
        if (component) return Boolean(maskingCorrections.creationType(command.maskType, command.maskSubtype)) &&
            Number.isSafeInteger(command.expectedMaskCount) && command.expectedMaskCount >= 1 && command.expectedMaskCount <= 512 &&
            Number.isSafeInteger(command.expectedMaskToolCount) && command.expectedMaskToolCount >= 1 && command.expectedMaskToolCount < 2048 &&
            (command.expectedSelectedMaskToolId === null || validToolId);
        if (visibility) return validToolId && typeof command.hidden === "boolean" &&
            typeof command.expectedHidden === "boolean" && command.hidden !== command.expectedHidden;
        if (command.direction !== "previous" && command.direction !== "next") return false;
        return !toolNavigation || validToolId;
    }

    if (command.command === "masking.all.delete" || command.command === "masking.component.invert" || command.command === "masking.component.delete" || command.command === "masking.selected.delete" || command.command === "masking.selected.reset" ||
        command.command === "masking.preset.apply") {
        const deleteAll = command.command === "masking.all.delete";
        const deleteSelected = command.command === "masking.selected.delete";
        const deleteComponent = command.command === "masking.component.delete";
        const invertComponent = command.command === "masking.component.invert";
        const preset = command.command === "masking.preset.apply";
        if (Object.keys(command).length !== (invertComponent ? 12 : deleteComponent ? 13 : deleteSelected ? 11 : (preset ? 16 : 10)) ||
            typeof command.operationId !== "string" || !/^mo-\d{1,15}$/.test(command.operationId) ||
            command.expectedActiveModule !== "develop" ||
            typeof command.expectedSelectedPhotoUuid !== "string" || command.expectedSelectedPhotoUuid.length < 1 ||
            command.expectedSelectedPhotoUuid.length > 200 ||
            !Number.isSafeInteger(command.expectedContextCounter) || command.expectedContextCounter < 0 ||
            !Number.isSafeInteger(command.expectedDevelopCounter) || command.expectedDevelopCounter < 0 ||
            !Number.isSafeInteger(command.expectedContextChangedAt) || command.expectedContextChangedAt < 0 ||
            typeof command.expectedServerEpoch !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch) ||
            !Number.isSafeInteger(command.expectedMaskingRevision) || command.expectedMaskingRevision < 1) return false;
        if (deleteAll) return Number.isSafeInteger(command.expectedMaskCount) &&
            command.expectedMaskCount >= 1 && command.expectedMaskCount <= 512;
        if (typeof command.expectedSelectedMaskId !== "string" || command.expectedSelectedMaskId.length < 1 ||
            command.expectedSelectedMaskId.length > 256 || /[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskId)) return false;
        if (deleteSelected) return Number.isSafeInteger(command.expectedMaskCount) &&
            command.expectedMaskCount >= 1 && command.expectedMaskCount <= 512;
        if (invertComponent) return (typeof command.expectedInverted === "boolean" || command.expectedInverted === null) &&
            typeof command.expectedSelectedMaskToolId === "string" && command.expectedSelectedMaskToolId.length >= 1 &&
            command.expectedSelectedMaskToolId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskToolId);
        if (deleteComponent) return Number.isSafeInteger(command.expectedMaskCount) && command.expectedMaskCount >= 1 &&
            command.expectedMaskCount <= 512 && Number.isSafeInteger(command.expectedMaskToolCount) &&
            command.expectedMaskToolCount >= 1 && command.expectedMaskToolCount <= 2048 &&
            typeof command.expectedSelectedMaskToolId === "string" && command.expectedSelectedMaskToolId.length >= 1 &&
            command.expectedSelectedMaskToolId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskToolId);
        if (!preset) return true;
        if (typeof command.expectedSelectedMaskToolId !== "string" || command.expectedSelectedMaskToolId.length < 1 ||
            command.expectedSelectedMaskToolId.length > 256 || /[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskToolId)) return false;
        if (typeof command.preset !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(command.preset)) return false;
        if (command.presetKind === "file") {
            return typeof command.presetFile === "string" && command.presetFile.length <= 180 &&
                /^[^"\\/\u0000-\u001f\u007f]+\.lrtemplate$/i.test(command.presetFile) &&
                command.presetParameter === null && command.presetValue === null;
        }
        return command.presetKind === "builtin" && command.presetFile === null &&
            typeof command.presetParameter === "string" &&
            Object.prototype.hasOwnProperty.call(maskingCorrections.byParameter, command.presetParameter) &&
            localPresets.validBuiltinPreset(command.preset, command.presetParameter, command.presetValue);
    }

    if (command.command === "masking.point_color.tool.select" ||
        command.command === "masking.point_color.range_visualization.toggle") {
        return Object.keys(command).length === 11 &&
            typeof command.operationId === "string" && /^mo-\d{1,15}$/.test(command.operationId) &&
            command.expectedActiveModule === "develop" &&
            typeof command.expectedSelectedPhotoUuid === "string" && command.expectedSelectedPhotoUuid.length >= 1 &&
            command.expectedSelectedPhotoUuid.length <= 200 &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.expectedDevelopCounter) && command.expectedDevelopCounter >= 0 &&
            Number.isSafeInteger(command.expectedContextChangedAt) && command.expectedContextChangedAt >= 0 &&
            typeof command.expectedServerEpoch === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch) &&
            Number.isSafeInteger(command.expectedMaskingRevision) && command.expectedMaskingRevision >= 1 &&
            typeof command.expectedSelectedMaskId === "string" && command.expectedSelectedMaskId.length >= 1 &&
            command.expectedSelectedMaskId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskId) &&
            typeof command.expectedSelectedMaskToolId === "string" && command.expectedSelectedMaskToolId.length >= 1 &&
            command.expectedSelectedMaskToolId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskToolId);
    }

    if (command.command === "masking.correction.gesture.begin" ||
        command.command === "masking.correction.gesture.update" ||
        command.command === "masking.correction.gesture.end" ||
        command.command === "masking.correction.gesture.cancel" || command.command === "masking.correction.reset") {
        const gesture = command.command !== "masking.correction.reset";
        const carriesValue = command.command === "masking.correction.gesture.update" ||
            command.command === "masking.correction.gesture.end";
        if (Object.keys(command).length !== (gesture ? (carriesValue ? 13 : 12) : 11) ||
            !Number.isSafeInteger(command.correctionSequence) || command.correctionSequence < 1 ||
            !Object.prototype.hasOwnProperty.call(maskingCorrections.byParameter, command.parameter) ||
            typeof command.expectedSelectedMaskId !== "string" || command.expectedSelectedMaskId.length < 1 ||
            command.expectedSelectedMaskId.length > 256 || /[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskId) ||
            command.expectedActiveModule !== "develop" ||
            typeof command.expectedSelectedPhotoUuid !== "string" || command.expectedSelectedPhotoUuid.length < 1 ||
            command.expectedSelectedPhotoUuid.length > 200 ||
            !Number.isSafeInteger(command.expectedContextCounter) || command.expectedContextCounter < 0 ||
            !Number.isSafeInteger(command.expectedDevelopCounter) || command.expectedDevelopCounter < 0 ||
            !Number.isSafeInteger(command.expectedContextChangedAt) || command.expectedContextChangedAt < 0 ||
            typeof command.expectedServerEpoch !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch) ||
            !Number.isSafeInteger(command.expectedMaskingRevision) || command.expectedMaskingRevision < 1) return false;
        if (gesture && (typeof command.gestureId !== "string" ||
            !/^mg-[A-Za-z0-9_-]{1,60}$/.test(command.gestureId))) return false;
        return !carriesValue || Number.isFinite(command.value);
    }

    if (command.command.startsWith("masking.point_color.") || command.command.startsWith("masking.tone_curve.")) {
        const validBase = Number.isSafeInteger(command.editSequence) && command.editSequence >= 1 &&
            typeof command.expectedSelectedMaskId === "string" && command.expectedSelectedMaskId.length >= 1 &&
            command.expectedSelectedMaskId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(command.expectedSelectedMaskId) &&
            command.expectedActiveModule === "develop" && typeof command.expectedSelectedPhotoUuid === "string" &&
            command.expectedSelectedPhotoUuid.length >= 1 && command.expectedSelectedPhotoUuid.length <= 200 &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.expectedDevelopCounter) && command.expectedDevelopCounter >= 0 &&
            Number.isSafeInteger(command.expectedContextChangedAt) && command.expectedContextChangedAt >= 0 &&
            typeof command.expectedServerEpoch === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(command.expectedServerEpoch) &&
            Number.isSafeInteger(command.expectedMaskingRevision) && command.expectedMaskingRevision >= 1;
        if (!validBase) return false;
        if (command.command === "masking.point_color.value.set") {
            return Object.keys(command).length === 13 && pointColor.validValue(command.field, command.value) &&
                Number.isSafeInteger(command.expectedSelectedIndex) && command.expectedSelectedIndex >= 1 &&
                command.expectedSelectedIndex <= 8;
        }
        if (command.command === "masking.point_color.range.set") {
            return Object.keys(command).length === 14 && pointColor.validRangeValue(command.range, command.boundary, command.value) &&
                Number.isSafeInteger(command.expectedSelectedIndex) && command.expectedSelectedIndex >= 1 &&
                command.expectedSelectedIndex <= 8;
        }
        if (command.command === "masking.point_color.range.translate") {
            const translated = { LowerNone: command.LowerNone, LowerFull: command.LowerFull,
                UpperFull: command.UpperFull, UpperNone: command.UpperNone };
            return Object.keys(command).length === 16 && pointColor.validRangeTranslation(command.range, translated) &&
                pointColor.safeFullRangeWidth(translated) && Number.isSafeInteger(command.expectedSelectedIndex) &&
                command.expectedSelectedIndex >= 1 && command.expectedSelectedIndex <= 8;
        }
        if (command.command === "masking.point_color.sample.select") {
            return Object.keys(command).length === 11 && Number.isSafeInteger(command.selectedIndex) &&
                command.selectedIndex >= 1 && command.selectedIndex <= 8;
        }
        const curveGesture = command.command.match(/^masking\.tone_curve\.gesture\.(begin|update|end|cancel)$/);
        if (curveGesture) {
            const carriesPoints = curveGesture[1] === "update" || curveGesture[1] === "end";
            return Object.keys(command).length === (carriesPoints ? 15 : 14) && pointCurve.validChannel(command.channel) &&
                command.field === ({ rgb: "local_Maincurve", red: "local_Redcurve", green: "local_Greencurve",
                    blue: "local_Bluecurve" })[command.channel] &&
                pointCurve.GESTURE_ID_PATTERN.test(command.gestureId || "") &&
                pointCurve.validCurveArray(command.expectedPoints) &&
                (!carriesPoints || pointCurve.validCurveArray(command.points));
        }
        if (command.command === "masking.tone_curve.reset") {
            return Object.keys(command).length === 13 && pointCurve.validChannel(command.channel) &&
                command.field === ({ rgb: "local_Maincurve", red: "local_Redcurve", green: "local_Greencurve",
                    blue: "local_Bluecurve" })[command.channel] && pointCurve.validCurveArray(command.expectedPoints);
        }
        if (command.command === "masking.tone_curve.preset.set") {
            return Object.keys(command).length === 15 && command.channel === "rgb" && command.field === "local_Maincurve" &&
                Boolean(pointCurve.presetCurve(command.preset)) && pointCurve.validCurveArray(command.expectedPoints) &&
                pointCurve.validCurveArray(command.points);
        }
        const refineGesture = command.command.match(/^masking\.tone_curve\.refine_saturation\.gesture\.(begin|update|end|cancel)$/);
        if (refineGesture) {
            const carriesValue = refineGesture[1] === "update" || refineGesture[1] === "end";
            return Object.keys(command).length === (carriesValue ? 14 : 13) && command.field === "local_RefineSaturation" &&
                pointCurve.GESTURE_ID_PATTERN.test(command.gestureId || "") && Number.isFinite(command.expectedValue) &&
                (!carriesValue || Number.isFinite(command.value));
        }
        return command.command === "masking.tone_curve.refine_saturation.reset" && Object.keys(command).length === 12 &&
            command.field === "local_RefineSaturation" && Number.isFinite(command.expectedValue);
    }

    if (command.command === "point_color.value.set") {
        const keys = Object.keys(command);
        const publicShape = keys.length === 3;
        const internalShape = keys.length === 5 && Number.isInteger(command.expectedSelectedIndex) && command.expectedSelectedIndex >= 1 && command.expectedSelectedIndex <= 8 &&
            Number.isInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0;
        return (publicShape || internalShape) && typeof command.field === "string" && pointColor.validValue(command.field, command.value);
    }
    if (command.command === "point_color.range.set") {
        const keys = Object.keys(command);
        const publicShape = keys.length === 4;
        const internalShape = keys.length === 6 && Number.isInteger(command.expectedSelectedIndex) && command.expectedSelectedIndex >= 1 && command.expectedSelectedIndex <= 8 &&
            Number.isInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0;
        return (publicShape || internalShape) && pointColor.validRangeValue(command.range, command.boundary, command.value);
    }
    if (command.command === "point_color.range.translate") {
        const keys = Object.keys(command); const publicShape = keys.length === 6;
        const internalShape = keys.length === 8 && Number.isInteger(command.expectedSelectedIndex) && command.expectedSelectedIndex >= 1 && command.expectedSelectedIndex <= 8 &&
            Number.isInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0;
        const translated = { LowerNone: command.LowerNone, LowerFull: command.LowerFull, UpperFull: command.UpperFull, UpperNone: command.UpperNone };
        return (publicShape || internalShape) && pointColor.validRangeTranslation(command.range, translated) && pointColor.safeFullRangeWidth(translated);
    }
    if (command.command === "point_color.range_visualization.toggle") return Object.keys(command).length === 1;
    if (command.command === "point_color.tool.select") return Object.keys(command).length === 1;
    if (command.command === "lightroom.undo" || command.command === "lightroom.redo") return Object.keys(command).length === 1;
    if (command.command === "lens_blur.active.set") {
        return Object.keys(command).length === 2 && typeof command.enabled === "boolean";
    }
    if (command.command === "lens_blur.bokeh.set") {
        return Object.keys(command).length === 2 && lensBlur.bokehValues.includes(command.value);
    }
    if (command.command === "lens_blur.depth_visualization.toggle") {
        return Object.keys(command).length === 5 && typeof command.enabled === "boolean" &&
            typeof command.expectedSelectedPhotoUuid === "string" && command.expectedSelectedPhotoUuid.length >= 1 &&
            command.expectedSelectedPhotoUuid.length <= 160 &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.expectedDevelopCounter) && command.expectedDevelopCounter >= 0;
    }
    if (command.command === "lens_blur.depth_refinement.select" || command.command === "lens_blur.depth_refinement.close") {
        return Object.keys(command).length === 1;
    }
    if (command.command === "lens_blur.focal_range.set") {
        const keys = Object.keys(command);
        const publicShape = keys.length === 2;
        const internalShape = keys.length === 3 && typeof command.commitId === "string" &&
            /^[A-Za-z0-9_-]{1,64}$/.test(command.commitId);
        return (publicShape || internalShape) && typeof command.value === "string" &&
            focalRange.format(focalRange.parse(command.value)) === command.value;
    }

    if (command.command === "develop_categorical.white_balance.set") {
        return Object.keys(command).length === 2 && developCategorical.whiteBalanceWritableValues.includes(command.value);
    }
    if (command.command === "develop_categorical.profile.set") {
        return Object.keys(command).length === 4 && profileSdkRegistry.isSupportedProfile(command.profile) &&
            Number.isSafeInteger(command.expectedContextCounter) && command.expectedContextCounter >= 0 &&
            Number.isSafeInteger(command.profileGeneration) && command.profileGeneration >= 1;
    }
    if (command.command === "develop_categorical.process.set") {
        return Object.keys(command).length === 2 && developCategorical.processValues.includes(command.value);
    }
    if (command.command === "develop_categorical.vignette_style.set") {
        return Object.keys(command).length === 2 && developCategorical.vignetteStyleValues.includes(command.value);
    }
    if (command.command === "develop_categorical.upright_mode.set") {
        return Object.keys(command).length === 2 && developCategorical.uprightModeValues.includes(command.value);
    }
    if (command.command === "develop_categorical.constrain_crop.set") {
        return Object.keys(command).length === 2 && developCategorical.constrainCropValues.includes(command.value);
    }
    if (command.command === "develop_categorical.upright_tool.select") {
        return Object.keys(command).length === 1;
    }
    if (command.command === "enhance.denoise.set") {
        return Object.keys(command).length === 3 && typeof command.enabled === "boolean" && Number.isInteger(command.amount) &&
            command.amount >= 1 && command.amount <= 100;
    }
    if (command.command === "enhance.denoise.amount.set") {
        return Object.keys(command).length === 2 && Number.isInteger(command.amount) && command.amount >= 1 && command.amount <= 100;
    }
    if (command.command === "enhance.raw_details.set") {
        return Object.keys(command).length === 2 && typeof command.enabled === "boolean";
    }
    if (command.command === "enhance.super_resolution.set") return Object.keys(command).length === 2 && typeof command.enabled === "boolean";

    if (!allowedCommands.includes(command.command)) {
        console.log("Unknown command");
        return false;
    }

    if (command.command === "develop.set" && command.slider === "CropConstrainToWarp") {
        return Object.keys(command).length === 3 && (command.value === 0 || command.value === 1);
    }

    if (command.command === "color_grading.wheel.set") {
        if (Object.keys(command).length !== 4 || !colorGrading.regions.includes(command.region)) return false;
        const region = colorGrading.metadata.regions[command.region];
        return colorGrading.inRuntimeRange(region.hue, command.hue) &&
            colorGrading.inRuntimeRange(region.saturation, command.saturation);
    }

    if (command.command === "color_grading.value.set") {
        if (Object.keys(command).length !== 3 || !colorGrading.scalarControls.includes(command.control)) return false;
        return colorGrading.inRuntimeRange(colorGrading.metadata.scalarControls[command.control].parameter, command.value);
    }

    if (command.command === "color_grading.value.reset") {
        return Object.keys(command).length === 2 && colorGrading.scalarControls.includes(command.control);
    }

    if (command.command === "color_grading.region.reset") {
        return Object.keys(command).length === 2 && colorGrading.regions.includes(command.region);
    }

    if (command.command === "color_grading.view.set") {
        return Object.keys(command).length === 2 && colorGrading.metadata.views.includes(command.view);
    }

    if (command.command === "selection.navigate") {
        return typeof command.direction === "string" &&
            allowedSelectionDirections.includes(command.direction);
    }

    if (command.command === "selection.extend") {
        return typeof command.direction === "string" &&
            allowedExtendDirections.includes(command.direction) &&
            typeof command.amount === "number" &&
            Number.isFinite(command.amount) &&
            Number.isInteger(command.amount) &&
            command.amount >= 1 &&
            command.amount <= 100;
    }

    if (command.command === "photo.rotate") {
        return typeof command.direction === "string" &&
            allowedPhotoRotateDirections.includes(command.direction);
    }

    if (command.command === "photo.treatment") {
        return Object.keys(command).length === 2 &&
            typeof command.value === "string" &&
            allowedPhotoTreatments.includes(command.value);
    }

    if (command.command === "photo.crop_aspect") {
        if (typeof command.mode !== "string") return false;

        if (command.mode === "custom") {
            return Object.keys(command).length === 4 &&
                typeof command.w === "number" &&
                Number.isSafeInteger(command.w) &&
                command.w >= 1 &&
                command.w <= 10000 &&
                typeof command.h === "number" &&
                Number.isSafeInteger(command.h) &&
                command.h >= 1 &&
                command.h <= 10000;
        }

        return Object.keys(command).length === 2 &&
            allowedPhotoCropAspects.includes(command.mode);
    }

    if (command.command === "photo.crop_angle.set") {
        return Object.keys(command).length === 2 &&
            typeof command.value === "number" &&
            Number.isFinite(command.value) &&
            command.value >= -45 &&
            command.value <= 45 &&
            Math.abs(command.value * 100 - Math.round(command.value * 100)) < 1e-9;
    }

    if (command.command === "photo.crop_angle.reset") {
        return Object.keys(command).length === 1;
    }

    if (command.command === "photo.reveal") {
        return Object.keys(command).length === 2 &&
            typeof command.scope === "string" &&
            allowedPhotoRevealScopes.includes(command.scope);
    }

    if (command.command === "selection.flag") {
        return typeof command.flag === "string" && allowedFlags.includes(command.flag);
    }

    if (command.command === "selection.rating.set") {
        return typeof command.rating === "number" &&
            Number.isFinite(command.rating) &&
            Number.isInteger(command.rating) &&
            command.rating >= 0 &&
            command.rating <= 5;
    }

    if (command.command === "selection.rating.adjust") {
        return typeof command.direction === "string" &&
            allowedRatingDirections.includes(command.direction);
    }

    if (command.command === "selection.label.set") {
        return typeof command.label === "string" && allowedLabels.includes(command.label);
    }

    if (command.command === "selection.label.toggle") {
        return typeof command.label === "string" && allowedToggleLabels.includes(command.label);
    }

    if (command.command === "selection.operation") {
        return typeof command.operation === "string" && allowedSelectionOperations.includes(command.operation);
    }

    if (command.command === "application.module") {
        return typeof command.module === "string" && allowedApplicationModules.includes(command.module);
    }

    if (command.command === "application.view") {
        return typeof command.view === "string" && allowedApplicationViews.includes(command.view);
    }

    if (command.command === "application.action") {
        return typeof command.action === "string" && allowedApplicationActions.includes(command.action);
    }

    if (command.command === "application.secondary_view") {
        return typeof command.view === "string" && allowedSecondaryViews.includes(command.view);
    }

    if (command.command === "develop.action") {
        if (!allowedActions.includes(command.action)) {
            console.log("Unknown action");
            return false;
        }

        if (command.action === "selectCropTool") {
            const keys = Object.keys(command);
            if (!hasTarget) return keys.length === 2;
            return keys.length === 3 && (command.target === "crop" || command.target === "loupe");
        }

        return Object.keys(command).length === 2;
    }

    const preserveMaskingPanel = Object.prototype.hasOwnProperty.call(command, "preserveMaskingPanel");
    if (preserveMaskingPanel && (command.preserveMaskingPanel !== true ||
        !["develop.set", "develop.reset"].includes(command.command) ||
        !["GrainSize", "GrainFrequency"].includes(command.slider))) return false;

    if (!sliders.exists(command.slider)) {
        console.log("Unknown slider");
        return false;
    }

    if (command.command === "develop.adjust" && sliders.getById(command.slider).adjustSupported === false) {
        return false;
    }

    if (command.command === "develop.reset" && sliders.getById(command.slider).resetSupported === false) {
        return false;
    }

    if (
        command.command === "develop.adjust" &&
        !numbers.isSafeIntegerNumber(command.amount)
    ) {
        console.log("Invalid amount");
        return false;
    }

    if (
        command.command === "develop.set" &&
        (
            Object.keys(command).length !== (preserveMaskingPanel ? 4 : 3) ||
            !sliders.isValidAbsoluteValue(command.slider, command.value)
        )
    ) {
        console.log("Invalid value");
        return false;
    }

    if (
        command.command === "develop.reset" &&
        Object.keys(command).length !== (preserveMaskingPanel ? 3 : 2)
    ) {
        return false;
    }

    return true;
}

function setLatestCommand(message) {
    let command;

    try {
        command = JSON.parse(message);
    } catch (err) {
        console.log("Invalid JSON");
        return false;
    }

    return enqueueCommand(command);
}

function enqueueCommand(command) {
    return tryEnqueueCommand(command).accepted;
}

function isContextBoundDevelopCommand(command) {
    if (!command || (command.command !== "develop.set" && command.command !== "develop.reset")) return false;
    const definition = sliders.getById(command.slider);
    return definition !== null && (definition.contextBoundRuntimeRange === true || command.preserveMaskingPanel === true);
}

function bindContextBoundDevelopCommand(command) {
    if (!isContextBoundDevelopCommand(command)) return command;
    const fields = context.getContextFields();
    if (fields.activeModule !== "develop" || fields.selectedPhotoKey === null ||
        (sliders.getById(command.slider).contextBoundRuntimeRange === true &&
            sliders.getRuntimeRange(command.slider) === null)) return null;
    return Object.assign({}, command, {
        expectedContextCounter: fields.contextCounter,
        expectedSelectedPhotoKey: fields.selectedPhotoKey,
        expectedSelectedPhotoUuid: fields.selectedPhotoUuid
    });
}

function tryEnqueueCommand(command) {
    if (command && command.command === "red_eye.action" && (!validateCommand(command) || !redEyeAdmissionProvider ||
        !redEyeAdmissionProvider.matches(command, "admit"))) return admissionResult(ADMISSION_INVALID);
    if (command && command.command === "people.action" && (!validateCommand(command) || !peopleAdmissionProvider ||
        !peopleAdmissionProvider.matches(command, "admit"))) return admissionResult(ADMISSION_INVALID);
    if (command && command.command === "reflections.set" && (!validateCommand(command) || !reflectionsAdmissionProvider ||
        !reflectionsAdmissionProvider.matches(command, "admit"))) return admissionResult(ADMISSION_INVALID);
    if (command && ["remove.dust.off", "remove.dust.on", "remove.dust.close", "remove.brush.set", "remove.panel.set", "remove.repair.action", "remove.repair.fill.set", "remove.repair.param.set"].includes(command.command) && (!validateCommand(command) ||
        !removeAdmissionProvider || !removeAdmissionProvider.matches(command, "admit"))) return admissionResult(ADMISSION_INVALID);
    if (!validateCommand(command)) {
        return admissionResult(ADMISSION_INVALID);
    }
    command = bindContextBoundDevelopCommand(command);
    if (command === null) return admissionResult(ADMISSION_INVALID);
    if ((command.command === "develop_preset.apply" || command.command === "develop_preset.amount.set") &&
        (!developPresetAdmissionProvider || !developPresetAdmissionProvider.matches(command, context.getContextFields()))) {
        if (developPresetAdmissionProvider && typeof developPresetAdmissionProvider.onRejected === "function") {
            developPresetAdmissionProvider.onRejected(command, "Develop preset context changed during queue admission.");
        }
        return admissionResult(ADMISSION_INVALID);
    }
    if ((command.command === "masking.component.add" || command.command === "masking.component.subtract" ||
        command.command === "masking.create" || command.command === "masking.panel.set" || command.command === "masking.group.navigate" ||
        command.command === "masking.tool.navigate" || command.command === "masking.group.visibility.set" ||
        command.command === "masking.tool.visibility.set" || command.command === "masking.all.delete" || command.command === "masking.component.invert" || command.command === "masking.component.delete" || command.command === "masking.selected.delete" ||
        command.command === "masking.selected.reset" || command.command === "masking.preset.apply" ||
        command.command.startsWith("masking.point_color.") || command.command.startsWith("masking.tone_curve.") ||
        command.command.startsWith("masking.correction.")) &&
        (!maskingAdmissionProvider || !maskingAdmissionProvider.matches(command, context.getContextFields()))) {
        if (maskingAdmissionProvider && typeof maskingAdmissionProvider.onRejected === "function") {
            maskingAdmissionProvider.onRejected(command, "Masking context changed during queue admission.");
        }
        return admissionResult(ADMISSION_INVALID);
    }
    if ((command.command === "point_color.value.set" && Object.keys(command).length === 3) ||
        (command.command === "point_color.range.set" && Object.keys(command).length === 4)) {
        const admissionContext = pointColorAdmissionContextProvider && pointColorAdmissionContextProvider();
        if (!admissionContext || !Number.isInteger(admissionContext.selectedIndex) || admissionContext.selectedIndex <= 0 || !Number.isInteger(admissionContext.contextCounter)) return admissionResult(ADMISSION_INVALID);
        command = Object.assign({}, command, { expectedSelectedIndex: admissionContext.selectedIndex, expectedContextCounter: admissionContext.contextCounter });
    }
    if (command.command === "point_color.range.translate" && Object.keys(command).length === 6) {
        const admissionContext = pointColorAdmissionContextProvider && pointColorAdmissionContextProvider();
        if (!admissionContext || !Number.isInteger(admissionContext.selectedIndex) || admissionContext.selectedIndex <= 0 || !Number.isInteger(admissionContext.contextCounter)) return admissionResult(ADMISSION_INVALID);
        command = Object.assign({}, command, { expectedSelectedIndex: admissionContext.selectedIndex, expectedContextCounter: admissionContext.contextCounter });
    }
    if ((command.command === "enhance.denoise.set" || command.command === "enhance.raw_details.set" || command.command === "enhance.super_resolution.set") && (enhanceOperationPending || enhanceAmountOperationPending)) {
        return admissionResult(ADMISSION_INVALID);
    }
    if (command.command === "enhance.denoise.amount.set" && (enhanceAmountOperationPending || enhanceOperationPending)) return admissionResult(ADMISSION_INVALID);

    const colorAdmission = coalesceColorGrading(command);
    if (colorAdmission) return colorAdmission;

    if (command.command === "point_color.value.set" || command.command === "point_color.range.set" || command.command === "point_color.range.translate") {
        const admittedAt = Date.now();
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];
            const sameOperation = command.command === "point_color.value.set" ? pending.field === command.field :
                command.command === "point_color.range.set" ? pending.range === command.range && pending.boundary === command.boundary : pending.range === command.range;
            if (pending.command === command.command && sameOperation &&
                pending.expectedSelectedIndex === command.expectedSelectedIndex && pending.expectedContextCounter === command.expectedContextCounter) {
                return replacePendingAt(index, command, admittedAt, "Coalesced Point Color value:");
            }
        }
    }

    if (command.command === "lens_blur.focal_range.set") {
        const admittedAt = Date.now();
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            if (commandQueue[index].command === command.command) {
                return replacePendingAt(index, command, admittedAt, "Coalesced Lens Blur Focus Range:");
            }
        }
    }

    if (command.command === "develop_preset.amount.set") {
        const admittedAt = Date.now();
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];
            if (pending.command === command.command &&
                pending.expectedPresetUuid === command.expectedPresetUuid &&
                pending.expectedSelectedPhotoUuid === command.expectedSelectedPhotoUuid &&
                pending.expectedContextCounter === command.expectedContextCounter &&
                pending.expectedServerEpoch === command.expectedServerEpoch) {
                return replacePendingAt(index, command, admittedAt, "Coalesced native Preset Amount:");
            }
        }
    }

    if (command.command.startsWith("masking.correction.")) {
        const admittedAt = Date.now();
        const sameCorrection = function (pending) {
            return pending && typeof pending.command === "string" && pending.command.startsWith("masking.correction.") &&
                pending.parameter === command.parameter && pending.expectedSelectedMaskId === command.expectedSelectedMaskId &&
                pending.expectedSelectedPhotoUuid === command.expectedSelectedPhotoUuid &&
                pending.expectedContextCounter === command.expectedContextCounter &&
                pending.expectedServerEpoch === command.expectedServerEpoch;
        };
        if (command.command === "masking.correction.reset") {
            removePending(sameCorrection);
        } else if (command.command === "masking.correction.gesture.update" ||
            command.command === "masking.correction.gesture.end" ||
            command.command === "masking.correction.gesture.cancel") {
            const matchingIndexes = [];
            for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
                const pending = commandQueue[index];
                const replaceable = pending.command === "masking.correction.gesture.update" ||
                    (command.command === "masking.correction.gesture.cancel" &&
                        (pending.command === "masking.correction.gesture.begin" ||
                            pending.command === "masking.correction.gesture.end" ||
                            pending.command === "masking.correction.gesture.cancel"));
                if (sameCorrection(pending) && pending.gestureId === command.gestureId && replaceable) {
                    matchingIndexes.push(index);
                }
            }
            if (matchingIndexes.length > 0) {
                for (const index of matchingIndexes) {
                    commandQueue.splice(index, 1);
                    queueEntryMetadata.splice(index, 1);
                }
                commandQueue.push(command);
                queueEntryMetadata.push({ enqueuedAt: admittedAt });
                coalescedCommands += 1;
                lastCoalescedAt = admittedAt;
                console.log("Coalesced Masking correction gesture:", command);
                return admissionResult(ADMISSION_COALESCED);
            }
        }
    }

    if (command.command.startsWith("masking.point_color.")) {
        const admittedAt = Date.now();
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];
            const sameTarget = command.command === "masking.point_color.value.set"
                ? pending.field === command.field
                : command.command === "masking.point_color.range.set"
                    ? pending.range === command.range && pending.boundary === command.boundary
                    : command.command === "masking.point_color.range.translate"
                        ? pending.range === command.range : false;
            if (sameTarget && pending.command === command.command &&
                pending.expectedSelectedMaskId === command.expectedSelectedMaskId &&
                pending.expectedSelectedIndex === command.expectedSelectedIndex &&
                pending.expectedServerEpoch === command.expectedServerEpoch) {
                return replacePendingAt(index, command, admittedAt, "Coalesced mask Point Color edit:");
            }
        }
    }

    if (command.command.startsWith("masking.tone_curve.gesture.") ||
        command.command.startsWith("masking.tone_curve.refine_saturation.gesture.")) {
        const phase = command.command.substring(command.command.lastIndexOf(".") + 1);
        if (phase === "update" || phase === "end" || phase === "cancel") {
            const admittedAt = Date.now();
            for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
                const pending = commandQueue[index];
                const pendingPhase = typeof pending.command === "string"
                    ? pending.command.substring(pending.command.lastIndexOf(".") + 1) : "";
                const sameFamily = command.command.includes("refine_saturation") === pending.command.includes("refine_saturation");
                if (sameFamily && pending.command.startsWith("masking.tone_curve.") &&
                    ["begin", "update", "end", "cancel"].includes(pendingPhase) &&
                    pending.gestureId === command.gestureId && pending.channel === command.channel &&
                    pending.expectedSelectedMaskId === command.expectedSelectedMaskId &&
                    pending.expectedServerEpoch === command.expectedServerEpoch) {
                    commandQueue.splice(index, 1);
                    queueEntryMetadata.splice(index, 1);
                    commandQueue.push(command);
                    queueEntryMetadata.push({ enqueuedAt: admittedAt });
                    coalescedCommands += 1;
                    lastCoalescedAt = admittedAt;
                    return admissionResult(ADMISSION_COALESCED);
                }
            }
        }
    }

    if (command.command === "tone_curve.gesture.update" || command.command === "tone_curve.gesture.end" ||
        command.command === "tone_curve.gesture.cancel") {
        const admittedAt = Date.now();
        const matchingIndexes = [];
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];
            if ((pending.command === "tone_curve.gesture.update" || pending.command === "tone_curve.gesture.end" ||
                (command.command === "tone_curve.gesture.cancel" &&
                    (pending.command === "tone_curve.gesture.begin" || pending.command === "tone_curve.gesture.cancel"))) &&
                pending.channel === command.channel && pending.gestureId === command.gestureId &&
                pending.expectedSelectedPhotoUuid === command.expectedSelectedPhotoUuid &&
                pending.expectedContextCounter === command.expectedContextCounter) {
                matchingIndexes.push(index);
            }
        }
        if (matchingIndexes.length > 0) {
            for (const index of matchingIndexes) {
                commandQueue.splice(index, 1);
                queueEntryMetadata.splice(index, 1);
            }
            commandQueue.push(command);
            queueEntryMetadata.push({ enqueuedAt: admittedAt });
            coalescedCommands += 1;
            lastCoalescedAt = admittedAt;
            console.log("Coalesced Tone Curve gesture:", command);
            return admissionResult(ADMISSION_COALESCED);
        }
    }

    if (command.command === "tone_curve.refine_saturation.gesture.update" ||
        command.command === "tone_curve.refine_saturation.gesture.end" ||
        command.command === "tone_curve.refine_saturation.gesture.cancel") {
        const admittedAt = Date.now();
        const matchingIndexes = [];
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];
            if ((pending.command === "tone_curve.refine_saturation.gesture.update" ||
                pending.command === "tone_curve.refine_saturation.gesture.end" ||
                (command.command === "tone_curve.refine_saturation.gesture.cancel" &&
                    (pending.command === "tone_curve.refine_saturation.gesture.begin" ||
                        pending.command === "tone_curve.refine_saturation.gesture.cancel"))) &&
                pending.gestureId === command.gestureId &&
                pending.expectedSelectedPhotoUuid === command.expectedSelectedPhotoUuid &&
                pending.expectedContextCounter === command.expectedContextCounter) matchingIndexes.push(index);
        }
        if (matchingIndexes.length > 0) {
            for (const index of matchingIndexes) {
                commandQueue.splice(index, 1);
                queueEntryMetadata.splice(index, 1);
            }
            commandQueue.push(command);
            queueEntryMetadata.push({ enqueuedAt: admittedAt });
            coalescedCommands += 1;
            lastCoalescedAt = admittedAt;
            console.log("Coalesced Refine Saturation gesture:", command);
            return admissionResult(ADMISSION_COALESCED);
        }
    }

    if (command.command === "tone_curve.preset.set") {
        const admittedAt = Date.now();
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];
            if (pending.command === command.command &&
                pending.expectedSelectedPhotoUuid === command.expectedSelectedPhotoUuid &&
                pending.expectedContextCounter === command.expectedContextCounter) {
                return replacePendingAt(index, command, admittedAt, "Coalesced Point Curve preset:");
            }
        }
    }

    if (command.command === "develop_categorical.white_balance.set" ||
        command.command === "develop_categorical.process.set" ||
        command.command === "develop_categorical.vignette_style.set" ||
        command.command === "develop_categorical.upright_mode.set" ||
        command.command === "develop_categorical.constrain_crop.set") {
        const admittedAt = Date.now();
        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            if (commandQueue[index].command === command.command) {
                return replacePendingAt(index, command, admittedAt, "Coalesced Develop categorical state:");
            }
        }
    }

    if (command.command === "develop.adjust") {
        const lastCommand = commandQueue[commandQueue.length - 1];

        if (
            lastCommand &&
            lastCommand.command === "develop.adjust" &&
            lastCommand.slider === command.slider
        ) {
            const combinedAmount = lastCommand.amount + command.amount;

            if (Number.isSafeInteger(combinedAmount)) {
                lastCommand.amount = combinedAmount;
                coalescedCommands += 1;
                lastCoalescedAt = Date.now();
                console.log("Coalesced command:", lastCommand);
                return admissionResult(ADMISSION_COALESCED);
            }
        }
    }

    if (
        command.command === "photo.crop_angle.set" ||
        command.command === "photo.crop_angle.reset"
    ) {
        const admittedAt = Date.now();

        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];

            if (
                pending.command === "photo.crop_angle.set" ||
                pending.command === "photo.crop_angle.reset"
            ) {
                commandQueue.splice(index, 1);
                queueEntryMetadata.splice(index, 1);
                commandQueue.push(command);
                queueEntryMetadata.push({ enqueuedAt: admittedAt });
                coalescedCommands += 1;
                lastCoalescedAt = admittedAt;
                console.log("Coalesced crop angle command:", command);
                return admissionResult(ADMISSION_COALESCED);
            }
        }
    }

    if (command.command === "develop.set" || command.command === "develop.reset") {
        const admittedAt = Date.now();

        for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
            const pending = commandQueue[index];

            if (
                pending.slider === command.slider &&
                (pending.command === "develop.set" || pending.command === "develop.reset") &&
                pending.expectedContextCounter === command.expectedContextCounter
            ) {
                commandQueue.splice(index, 1);
                queueEntryMetadata.splice(index, 1);
                commandQueue.push(command);
                queueEntryMetadata.push({ enqueuedAt: admittedAt });
                coalescedCommands += 1;
                lastCoalescedAt = admittedAt;
                console.log("Coalesced Develop slider state:", command);
                return admissionResult(ADMISSION_COALESCED);
            }
        }
    }

    const limit = isProtectedCommand(command)
        ? HARD_QUEUE_CAPACITY
        : ORDINARY_ADMISSION_CEILING;

    if (commandQueue.length >= limit) {
        queueFullRejections += 1;
        lastQueueFullRejectionAt = Date.now();
        return admissionResult(ADMISSION_QUEUE_FULL);
    }

    const admittedAt = Date.now();
    commandQueue.push(command);
    if (command.command === "enhance.denoise.set" || command.command === "enhance.raw_details.set" || command.command === "enhance.super_resolution.set") enhanceOperationPending = true;
    if (command.command === "enhance.denoise.amount.set") enhanceAmountOperationPending = true;
    queueEntryMetadata.push({ enqueuedAt: admittedAt });
    enqueuedEntries += 1;
    lastEnqueuedAt = admittedAt;
    highWaterMark = Math.max(highWaterMark, commandQueue.length);

    console.log("Queued command:", command);
    console.log("Queue length:", commandQueue.length);

    return admissionResult(ADMISSION_ACCEPTED);
}

function replacePendingAt(index, command, admittedAt, message) {
    commandQueue.splice(index, 1);
    queueEntryMetadata.splice(index, 1);
    commandQueue.push(command);
    queueEntryMetadata.push({ enqueuedAt: admittedAt });
    coalescedCommands += 1;
    lastCoalescedAt = admittedAt;
    console.log(message, command);
    return admissionResult(ADMISSION_COALESCED);
}

function removePending(predicate) {
    let removed = 0;
    for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
        if (predicate(commandQueue[index])) {
            commandQueue.splice(index, 1);
            queueEntryMetadata.splice(index, 1);
            removed += 1;
        }
    }
    return removed;
}

function coalesceColorGrading(command) {
    const admittedAt = Date.now();
    if (command.command === "color_grading.region.reset") {
        const luminanceControl = Object.keys(colorGrading.metadata.scalarControls).find(function (control) {
            return colorGrading.metadata.scalarControls[control].region === command.region;
        });
        removePending(function (pending) {
            return (pending.command === "color_grading.wheel.set" && pending.region === command.region) ||
                (pending.command === "color_grading.value.set" && pending.control === luminanceControl);
        });
        return null;
    }
    if (command.command === "color_grading.value.reset") {
        removePending(function (pending) {
            return pending.command === "color_grading.value.set" && pending.control === command.control;
        });
        return null;
    }
    for (let index = commandQueue.length - 1; index >= 0; index -= 1) {
        const pending = commandQueue[index];
        if (command.command === "color_grading.wheel.set" && pending.command === command.command && pending.region === command.region) {
            return replacePendingAt(index, command, admittedAt, "Coalesced Color Grading wheel:");
        }
        if (command.command === "color_grading.value.set" && pending.command === command.command && pending.control === command.control) {
            return replacePendingAt(index, command, admittedAt, "Coalesced Color Grading scalar:");
        }
        if (command.command === "color_grading.view.set" && pending.command === command.command) {
            return replacePendingAt(index, command, admittedAt, "Coalesced Color Grading view:");
        }
    }
    return null;
}

function tryEnqueueBatch(batch) {
    if (!Array.isArray(batch) || !batch.every(validateCommand)) {
        return admissionResult(ADMISSION_INVALID);
    }
    if (batch.some(command => command.command === "reflections.set" || command.command === "people.action" || command.command === "red_eye.action")) return admissionResult(ADMISSION_INVALID);
    // Remove preference writes require the single-operation admission path.
    if (batch.some(command => ["remove.dust.off", "remove.dust.on", "remove.dust.close", "remove.brush.set", "remove.panel.set", "remove.repair.action", "remove.repair.fill.set", "remove.repair.param.set"].includes(command.command))) return admissionResult(ADMISSION_INVALID);

    if (!batch.every(isProtectedCommand)) {
        return admissionResult(ADMISSION_INVALID);
    }

    if (commandQueue.length + batch.length > HARD_QUEUE_CAPACITY) {
        queueFullRejections += 1;
        lastQueueFullRejectionAt = Date.now();
        return admissionResult(ADMISSION_QUEUE_FULL);
    }

    const admittedAt = Date.now();
    for (const command of batch) {
        commandQueue.push(command);
        queueEntryMetadata.push({ enqueuedAt: admittedAt });
    }

    if (batch.length > 0) {
        enqueuedEntries += batch.length;
        lastEnqueuedAt = admittedAt;
        highWaterMark = Math.max(highWaterMark, commandQueue.length);
    }

    console.log("Queued command batch:", batch.length);
    console.log("Queue length:", commandQueue.length);
    return admissionResult(ADMISSION_ACCEPTED);
}

function isProtectedCommand(command) {
    if (command.command === "red_eye.action") return true;
    if (command.command === "people.action") return true;
    if (command.command === "reflections.set") return true;
    if (["remove.dust.off", "remove.dust.on", "remove.dust.close", "remove.brush.set", "remove.panel.set", "remove.repair.action", "remove.repair.fill.set", "remove.repair.param.set"].includes(command.command)) return true;
    return command.command === "develop.reset" || command.command === "develop.action" ||
        command.command === "color_grading.region.reset" || command.command === "color_grading.value.reset" ||
        command.command === "lightroom.undo" || command.command === "lightroom.redo" ||
        command.command === "tone_curve.reset" || command.command === "tone_curve.gesture.cancel" ||
        command.command === "tone_curve.refine_saturation.reset" ||
        command.command === "tone_curve.refine_saturation.gesture.cancel" ||
        command.command === "masking.component.add" || command.command === "masking.component.subtract" ||
        command.command === "masking.create" || command.command === "masking.panel.set" || command.command === "masking.group.navigate" ||
        command.command === "masking.tool.navigate" || command.command === "masking.group.visibility.set" ||
        command.command === "masking.tool.visibility.set" || command.command === "masking.correction.gesture.cancel" ||
        command.command === "masking.correction.reset" || command.command === "masking.all.delete" || command.command === "masking.component.invert" || command.command === "masking.component.delete" || command.command === "masking.selected.delete" ||
        command.command === "masking.selected.reset" || command.command === "masking.tone_curve.gesture.cancel" ||
        command.command === "masking.tone_curve.reset" ||
        command.command === "masking.tone_curve.refine_saturation.gesture.cancel" ||
        command.command === "masking.tone_curve.refine_saturation.reset";
}

function pointCurveCommandBindingMatches(command) {
    const fields = context.getContextFields();
    return fields.activeModule === "develop" && fields.selectedPhotoUuid === command.expectedSelectedPhotoUuid &&
        fields.contextCounter === command.expectedContextCounter && fields.developCounter === command.expectedDevelopCounter;
}

function lensBlurDepthVisualizationBindingMatches(command) {
    const fields = context.getContextFields();
    return fields.activeModule === "develop" && fields.selectedPhotoUuid === command.expectedSelectedPhotoUuid &&
        fields.contextCounter === command.expectedContextCounter && fields.developCounter === command.expectedDevelopCounter;
}

function contextBoundDevelopCommandMatches(command) {
    if (!isContextBoundDevelopCommand(command)) return true;
    const fields = context.getContextFields();
    return fields.activeModule === "develop" &&
        fields.contextCounter === command.expectedContextCounter &&
        fields.selectedPhotoKey === command.expectedSelectedPhotoKey &&
        fields.selectedPhotoUuid === command.expectedSelectedPhotoUuid &&
        (sliders.getById(command.slider).contextBoundRuntimeRange !== true || sliders.getRuntimeRange(command.slider) !== null);
}

function admissionResult(status) {
    return {
        accepted: status === ADMISSION_ACCEPTED || status === ADMISSION_COALESCED,
        coalesced: status === ADMISSION_COALESCED,
        status: status,
        queueLength: commandQueue.length
    };
}

function getNextCommand() {
    while (commandQueue.length > 0) {
        const command = commandQueue.shift();
        queueEntryMetadata.shift();
        dequeuedEntries += 1;
        lastDequeuedAt = Date.now();
        if ((command.command === "point_color.value.set" || command.command === "point_color.range.set" || command.command === "point_color.range.translate" ||
            command.command === "develop_categorical.profile.set") && command.expectedContextCounter !== context.getContextFields().contextCounter) continue;
        if (!contextBoundDevelopCommandMatches(command)) continue;
        if ((command.command === "tone_curve.gesture.begin" || command.command === "tone_curve.gesture.update" ||
            command.command === "tone_curve.reset") && !pointCurveCommandBindingMatches(command)) continue;
        if ((command.command === "tone_curve.refine_saturation.gesture.begin" ||
            command.command === "tone_curve.refine_saturation.gesture.update" ||
            command.command === "tone_curve.refine_saturation.reset" ||
            command.command === "tone_curve.preset.set") && !pointCurveCommandBindingMatches(command)) continue;
        if (command.command === "lens_blur.depth_visualization.toggle" &&
            !lensBlurDepthVisualizationBindingMatches(command)) continue;
        if ((command.command === "develop_preset.apply" || command.command === "develop_preset.amount.set") &&
            (!developPresetAdmissionProvider || !developPresetAdmissionProvider.matches(command, context.getContextFields()))) {
            if (developPresetAdmissionProvider && typeof developPresetAdmissionProvider.onRejected === "function") {
                developPresetAdmissionProvider.onRejected(command, "Develop preset context changed before dequeue.");
            }
            continue;
        }
        if ((command.command === "masking.component.add" || command.command === "masking.component.subtract" ||
        command.command === "masking.create" || command.command === "masking.panel.set" || command.command === "masking.group.navigate" ||
            command.command === "masking.tool.navigate" || command.command === "masking.group.visibility.set" ||
            command.command === "masking.tool.visibility.set" || command.command === "masking.all.delete" || command.command === "masking.component.invert" || command.command === "masking.component.delete" || command.command === "masking.selected.delete" ||
            command.command === "masking.selected.reset" || command.command === "masking.preset.apply" ||
            command.command.startsWith("masking.point_color.") || command.command.startsWith("masking.tone_curve.") ||
            command.command.startsWith("masking.correction.")) &&
            (!maskingAdmissionProvider || !maskingAdmissionProvider.matches(command, context.getContextFields()))) {
            if (maskingAdmissionProvider && typeof maskingAdmissionProvider.onRejected === "function") {
                maskingAdmissionProvider.onRejected(command, "Masking context changed before dequeue.");
            }
            continue;
        }
        if (command.command === "red_eye.action" && (!redEyeAdmissionProvider || !redEyeAdmissionProvider.matches(command, "dequeue"))) {
            if (redEyeAdmissionProvider) redEyeAdmissionProvider.reject(command, "Photo or Develop context changed before dequeue.");
            continue;
        }
        if (command.command === "reflections.set" && (!reflectionsAdmissionProvider || !reflectionsAdmissionProvider.matches(command, "dequeue"))) {
            if (reflectionsAdmissionProvider) reflectionsAdmissionProvider.reject(command, "Reflections context changed before dequeue.");
            continue;
        }
        if (command.command === "people.action" && (!peopleAdmissionProvider || !peopleAdmissionProvider.matches(command, "dequeue"))) {
            if (peopleAdmissionProvider) peopleAdmissionProvider.reject(command, "People context changed before dequeue.");
            continue;
        }
        if (["remove.dust.off", "remove.dust.on", "remove.dust.close", "remove.brush.set", "remove.panel.set", "remove.repair.action", "remove.repair.fill.set", "remove.repair.param.set"].includes(command.command) && (!removeAdmissionProvider || !removeAdmissionProvider.matches(command, "dequeue"))) {
            if (removeAdmissionProvider) removeAdmissionProvider.reject(command, "Remove brush context changed before dequeue.");
            continue;
        }
        return command;
    }
    return null;
}

function getQueueDiagnostics(nowMs) {
    const queueLength = commandQueue.length;
    const pendingByCommand = {
        "develop.adjust": 0,
        "develop.set": 0,
        "develop.get": 0,
        "develop.reset": 0,
        "develop.action": 0,
        "photo.rotate": 0,
        "photo.treatment": 0,
        "photo.crop_aspect": 0,
        "photo.crop_angle.set": 0,
        "photo.crop_angle.reset": 0,
        "photo.reveal": 0,
        "selection.navigate": 0,
        "selection.extend": 0,
        "selection.flag": 0,
        "selection.rating.set": 0,
        "selection.rating.adjust": 0,
        "selection.label.set": 0,
        "selection.label.toggle": 0,
        "selection.operation": 0,
        "application.module": 0,
        "application.view": 0,
        "application.action": 0,
        "application.secondary_view": 0
        ,"color_grading.wheel.set": 0
        ,"color_grading.value.set": 0
        ,"color_grading.value.reset": 0
        ,"color_grading.region.reset": 0
        ,"color_grading.view.set": 0
        ,"point_color.value.set": 0
        ,"point_color.range.set": 0
        ,"point_color.range.translate": 0
        ,"point_color.range_visualization.toggle": 0
        ,"point_color.tool.select": 0
        ,"lightroom.undo": 0
        ,"lightroom.redo": 0
        ,"lens_blur.active.set": 0
        ,"lens_blur.bokeh.set": 0
        ,"lens_blur.depth_visualization.toggle": 0
        ,"lens_blur.depth_refinement.select": 0
        ,"lens_blur.depth_refinement.close": 0
        ,"lens_blur.focal_range.set": 0
        ,"tone_curve.gesture.begin": 0
        ,"tone_curve.gesture.update": 0
        ,"tone_curve.gesture.end": 0
        ,"tone_curve.gesture.cancel": 0
        ,"tone_curve.reset": 0
        ,"tone_curve.refine_saturation.gesture.begin": 0
        ,"tone_curve.refine_saturation.gesture.update": 0
        ,"tone_curve.refine_saturation.gesture.end": 0
        ,"tone_curve.refine_saturation.gesture.cancel": 0
        ,"tone_curve.refine_saturation.reset": 0
        ,"tone_curve.preset.set": 0
        ,"develop_presets.inventory.request": 0
        ,"develop_preset.apply": 0
        ,"develop_preset.amount.set": 0
        ,"masking.component.add": 0
        ,"masking.component.subtract": 0
        ,"masking.create": 0
        ,"remove.repair.action": 0
        ,"remove.repair.fill.set": 0
        ,"remove.repair.param.set": 0
        ,"remove.panel.set": 0
        ,"remove.brush.set": 0
        ,"remove.dust.off": 0
        ,"remove.dust.on": 0
        ,"remove.dust.close": 0
        ,"reflections.set": 0
        ,"people.action": 0
        ,"red_eye.action": 0
        ,"masking.panel.set": 0
        ,"masking.group.navigate": 0
        ,"masking.tool.navigate": 0
        ,"masking.group.visibility.set": 0
        ,"masking.tool.visibility.set": 0
        ,"masking.all.delete": 0
        ,"masking.component.delete": 0
        ,"masking.component.invert": 0
        ,"masking.selected.delete": 0
        ,"masking.selected.reset": 0
        ,"masking.preset.apply": 0
        ,"masking.point_color.value.set": 0
        ,"masking.point_color.range.set": 0
        ,"masking.point_color.range.translate": 0
        ,"masking.point_color.sample.select": 0
        ,"masking.point_color.tool.select": 0
        ,"masking.point_color.range_visualization.toggle": 0
        ,"masking.tone_curve.gesture.begin": 0
        ,"masking.tone_curve.gesture.update": 0
        ,"masking.tone_curve.gesture.end": 0
        ,"masking.tone_curve.gesture.cancel": 0
        ,"masking.tone_curve.reset": 0
        ,"masking.tone_curve.preset.set": 0
        ,"masking.tone_curve.refine_saturation.gesture.begin": 0
        ,"masking.tone_curve.refine_saturation.gesture.update": 0
        ,"masking.tone_curve.refine_saturation.gesture.end": 0
        ,"masking.tone_curve.refine_saturation.gesture.cancel": 0
        ,"masking.tone_curve.refine_saturation.reset": 0
        ,"masking.correction.gesture.begin": 0
        ,"masking.correction.gesture.update": 0
        ,"masking.correction.gesture.end": 0
        ,"masking.correction.gesture.cancel": 0
        ,"masking.correction.reset": 0
    };

    for (const command of commandQueue) {
        if (Object.prototype.hasOwnProperty.call(pendingByCommand, command.command)) {
            pendingByCommand[command.command] += 1;
        }
    }

    const oldestMetadata = queueLength > 0 ? queueEntryMetadata[0] : null;
    const observedAt = nowMs === undefined ? Date.now() : nowMs;
    const oldestCommandAgeMs = oldestMetadata
        ? Math.max(0, observedAt - oldestMetadata.enqueuedAt)
        : null;

    return {
        ok: true,
        scope: "process",
        queue: {
            length: queueLength,
            ordinaryAdmissionCeiling: ORDINARY_ADMISSION_CEILING,
            protectedReserve: PROTECTED_QUEUE_RESERVE,
            hardCapacity: HARD_QUEUE_CAPACITY,
            ordinaryCapacityAvailable: Math.max(0, ORDINARY_ADMISSION_CEILING - queueLength),
            protectedReserveAvailable: Math.max(0, HARD_QUEUE_CAPACITY - Math.max(queueLength, ORDINARY_ADMISSION_CEILING)),
            totalCapacityAvailable: Math.max(0, HARD_QUEUE_CAPACITY - queueLength),
            ordinarySaturated: queueLength >= ORDINARY_ADMISSION_CEILING,
            hardSaturated: queueLength >= HARD_QUEUE_CAPACITY,
            highWaterMark: highWaterMark,
            oldestCommandAgeMs: oldestCommandAgeMs,
            pending: {
                ordinary: pendingByCommand["develop.adjust"] +
                    pendingByCommand["develop.set"] +
                    pendingByCommand["develop.get"] +
                    pendingByCommand["photo.rotate"] +
                    pendingByCommand["photo.treatment"] +
                    pendingByCommand["photo.crop_aspect"] +
                    pendingByCommand["photo.crop_angle.set"] +
                    pendingByCommand["photo.crop_angle.reset"] +
                    pendingByCommand["photo.reveal"] +
                    pendingByCommand["selection.navigate"] +
                    pendingByCommand["selection.extend"] +
                    pendingByCommand["selection.flag"] +
                    pendingByCommand["selection.rating.set"] +
                    pendingByCommand["selection.rating.adjust"] +
                    pendingByCommand["selection.label.set"] +
                    pendingByCommand["selection.label.toggle"] +
                    pendingByCommand["selection.operation"] +
                    pendingByCommand["application.module"] +
                    pendingByCommand["application.view"] +
                    pendingByCommand["application.action"] +
                    pendingByCommand["application.secondary_view"] +
                    pendingByCommand["color_grading.wheel.set"] +
                    pendingByCommand["color_grading.value.set"] +
                    pendingByCommand["color_grading.view.set"] +
                    pendingByCommand["point_color.value.set"] +
                    pendingByCommand["point_color.range.set"] +
                    pendingByCommand["point_color.range.translate"] +
                    pendingByCommand["point_color.range_visualization.toggle"] +
                    pendingByCommand["point_color.tool.select"] +
                    pendingByCommand["lens_blur.active.set"] +
                    pendingByCommand["lens_blur.bokeh.set"] +
                    pendingByCommand["lens_blur.depth_visualization.toggle"] +
                    pendingByCommand["lens_blur.depth_refinement.select"] +
                    pendingByCommand["lens_blur.depth_refinement.close"] +
                    pendingByCommand["lens_blur.focal_range.set"] +
                    pendingByCommand["tone_curve.gesture.begin"] +
                    pendingByCommand["tone_curve.gesture.update"] +
                    pendingByCommand["tone_curve.gesture.end"] +
                    pendingByCommand["tone_curve.refine_saturation.gesture.begin"] +
                    pendingByCommand["tone_curve.refine_saturation.gesture.update"] +
                    pendingByCommand["tone_curve.refine_saturation.gesture.end"] +
                    pendingByCommand["tone_curve.preset.set"] +
                    pendingByCommand["develop_presets.inventory.request"] +
                    pendingByCommand["develop_preset.apply"] +
                    pendingByCommand["develop_preset.amount.set"] +
                    pendingByCommand["masking.correction.gesture.begin"] +
                    pendingByCommand["masking.correction.gesture.update"] +
                    pendingByCommand["masking.correction.gesture.end"],
                protected: pendingByCommand["develop.reset"] + pendingByCommand["develop.action"] +
                    pendingByCommand["color_grading.region.reset"] + pendingByCommand["color_grading.value.reset"] +
                    pendingByCommand["tone_curve.reset"] + pendingByCommand["tone_curve.gesture.cancel"] +
                    pendingByCommand["tone_curve.refine_saturation.reset"] +
                    pendingByCommand["tone_curve.refine_saturation.gesture.cancel"] +
                    pendingByCommand["red_eye.action"] + pendingByCommand["people.action"] + pendingByCommand["reflections.set"] + pendingByCommand["remove.repair.param.set"] + pendingByCommand["remove.repair.fill.set"] + pendingByCommand["remove.repair.action"] + pendingByCommand["remove.panel.set"] + pendingByCommand["remove.brush.set"] + pendingByCommand["remove.dust.off"] + pendingByCommand["remove.dust.on"] + pendingByCommand["remove.dust.close"] + pendingByCommand["masking.component.add"] + pendingByCommand["masking.component.subtract"] +
                    pendingByCommand["masking.create"] + pendingByCommand["masking.panel.set"] + pendingByCommand["masking.group.navigate"] +
                    pendingByCommand["masking.tool.navigate"] + pendingByCommand["masking.group.visibility.set"] +
                    pendingByCommand["masking.tool.visibility.set"] +
                    pendingByCommand["masking.all.delete"] + pendingByCommand["masking.component.invert"] + pendingByCommand["masking.component.delete"] + pendingByCommand["masking.selected.delete"] + pendingByCommand["masking.selected.reset"] +
                    pendingByCommand["masking.preset.apply"] +
                    pendingByCommand["masking.point_color.tool.select"] +
                    pendingByCommand["masking.point_color.range_visualization.toggle"] +
                    pendingByCommand["masking.correction.gesture.cancel"] +
                    pendingByCommand["masking.correction.reset"] +
                    pendingByCommand["masking.tone_curve.gesture.cancel"] +
                    pendingByCommand["masking.tone_curve.reset"] +
                    pendingByCommand["masking.tone_curve.refine_saturation.gesture.cancel"] +
                    pendingByCommand["masking.tone_curve.refine_saturation.reset"],
                byCommand: pendingByCommand
            }
        },
        counters: {
            enqueuedEntries: enqueuedEntries,
            coalescedCommands: coalescedCommands,
            dequeuedEntries: dequeuedEntries,
            queueFullRejections: queueFullRejections
        },
        timestamps: {
            lastEnqueuedAt: lastEnqueuedAt,
            lastCoalescedAt: lastCoalescedAt,
            lastDequeuedAt: lastDequeuedAt,
            lastQueueFullRejectionAt: lastQueueFullRejectionAt
        }
    };
}

function clearLatestResult() {
    latestResult = null;
}

function setLatestResult(result) {
    latestResult = result;
    console.log("Stored result:", latestResult);
}

function getLatestResult() {
    const result = latestResult;
    latestResult = null;
    return result;
}

function getStatus() {
    return {
        ok: true,
        queueLength: commandQueue.length,
        hasLatestResult: latestResult !== null,
        supportedSliders: sliders.getIds()
    };
}

function getSupportedSliders() {
    return sliders.getIds();
}

function getSliderMetadata() {
    return sliders.getAll();
}

function resetQueueForTests() {
    commandQueue.length = 0;
    queueEntryMetadata.length = 0;
    highWaterMark = 0;
    enqueuedEntries = 0;
    coalescedCommands = 0;
    dequeuedEntries = 0;
    queueFullRejections = 0;
    lastEnqueuedAt = null;
    lastCoalescedAt = null;
    lastDequeuedAt = null;
    lastQueueFullRejectionAt = null;
    latestResult = null;
    enhanceOperationPending = false;
    enhanceAmountOperationPending = false;
}

function finishEnhanceOperation() {
    enhanceOperationPending = false;
}

function setPointColorAdmissionContextProvider(provider) {
    pointColorAdmissionContextProvider = typeof provider === "function" ? provider : null;
}

function setDevelopPresetAdmissionProvider(provider) {
    developPresetAdmissionProvider = provider && typeof provider.matches === "function" ? provider : null;
}

function setMaskingAdmissionProvider(provider) {
    maskingAdmissionProvider = provider && typeof provider.matches === "function" ? provider : null;
}

module.exports = {
    HARD_QUEUE_CAPACITY,
    ORDINARY_ADMISSION_CEILING,
    PROTECTED_QUEUE_RESERVE,
    ADMISSION_ACCEPTED,
    ADMISSION_COALESCED,
    ADMISSION_INVALID,
    ADMISSION_QUEUE_FULL,
    validateCommand,
    enqueueCommand,
    tryEnqueueCommand,
    tryEnqueueBatch,
    setLatestCommand,
    getNextCommand,
    getQueueDiagnostics,
    clearLatestResult,
    setLatestResult,
    getLatestResult,
    getStatus,
    getSupportedSliders,
    getSliderMetadata,
    resetQueueForTests
    ,finishEnhanceOperation
    ,setPointColorAdmissionContextProvider
    ,setDevelopPresetAdmissionProvider
    ,setMaskingAdmissionProvider
    ,setRemoveAdmissionProvider: function (provider) { removeAdmissionProvider = provider; }
    ,setReflectionsAdmissionProvider: function (provider) { reflectionsAdmissionProvider = provider; }
    ,setPeopleAdmissionProvider: function (provider) { peopleAdmissionProvider = provider; }
    ,setRedEyeAdmissionProvider: function (provider) { redEyeAdmissionProvider = provider; }
    ,finishEnhanceAmountOperation: function () { enhanceAmountOperationPending = false; }
};
