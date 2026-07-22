const sliders = require("./sliders");
const numbers = require("./numbers");

const commandQueue = [];
let latestResult = null;

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
        "selection.navigate",
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
    ];

    if (!command || typeof command !== "object" || Array.isArray(command)) {
        console.log("Invalid command");
        return false;
    }

    if (!allowedCommands.includes(command.command)) {
        console.log("Unknown command");
        return false;
    }

    if (command.command === "selection.navigate") {
        return typeof command.direction === "string" &&
            allowedSelectionDirections.includes(command.direction);
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

        return true;
    }

    if (!sliders.exists(command.slider)) {
        console.log("Unknown slider");
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
        !numbers.isFiniteNumber(command.value)
    ) {
        console.log("Invalid value");
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

function tryEnqueueCommand(command) {
    if (!validateCommand(command)) {
        return admissionResult(ADMISSION_INVALID);
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
    queueEntryMetadata.push({ enqueuedAt: admittedAt });
    enqueuedEntries += 1;
    lastEnqueuedAt = admittedAt;
    highWaterMark = Math.max(highWaterMark, commandQueue.length);

    console.log("Queued command:", command);
    console.log("Queue length:", commandQueue.length);

    return admissionResult(ADMISSION_ACCEPTED);
}

function tryEnqueueBatch(batch) {
    if (!Array.isArray(batch) || !batch.every(validateCommand)) {
        return admissionResult(ADMISSION_INVALID);
    }

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
    return command.command === "develop.reset" || command.command === "develop.action";
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
    if (commandQueue.length === 0) {
        return null;
    }

    const command = commandQueue.shift();
    queueEntryMetadata.shift();
    dequeuedEntries += 1;
    lastDequeuedAt = Date.now();
    return command;
}

function getQueueDiagnostics(nowMs) {
    const queueLength = commandQueue.length;
    const pendingByCommand = {
        "develop.adjust": 0,
        "develop.set": 0,
        "develop.get": 0,
        "develop.reset": 0,
        "develop.action": 0,
        "selection.navigate": 0,
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
                    pendingByCommand["selection.navigate"] +
                    pendingByCommand["selection.flag"] +
                    pendingByCommand["selection.rating.set"] +
                    pendingByCommand["selection.rating.adjust"] +
                    pendingByCommand["selection.label.set"] +
                    pendingByCommand["selection.label.toggle"] +
                    pendingByCommand["selection.operation"] +
                    pendingByCommand["application.module"] +
                    pendingByCommand["application.view"] +
                    pendingByCommand["application.action"] +
                    pendingByCommand["application.secondary_view"],
                protected: pendingByCommand["develop.reset"] + pendingByCommand["develop.action"],
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
};
