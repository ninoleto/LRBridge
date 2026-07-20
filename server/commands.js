const sliders = require("./sliders");
const numbers = require("./numbers");

const commandQueue = [];
let latestResult = null;

const HARD_QUEUE_CAPACITY = 1024;
const ORDINARY_ADMISSION_CEILING = 896;
const PROTECTED_QUEUE_RESERVE = 128;

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

function validateCommand(command) {
    const allowedCommands = [
        "develop.adjust",
        "develop.get",
        "develop.set",
        "develop.reset",
        "develop.action"
    ];

    if (!command || typeof command !== "object" || Array.isArray(command)) {
        console.log("Invalid command");
        return false;
    }

    if (!allowedCommands.includes(command.command)) {
        console.log("Unknown command:", command.command);
        return false;
    }

    if (command.command === "develop.action") {
        if (!allowedActions.includes(command.action)) {
            console.log("Unknown action:", command.action);
            return false;
        }

        return true;
    }

    if (!sliders.exists(command.slider)) {
        console.log("Unknown slider:", command.slider);
        return false;
    }

    if (
        command.command === "develop.adjust" &&
        !numbers.isFiniteNumber(command.amount)
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

            if (Number.isFinite(combinedAmount)) {
                lastCommand.amount = combinedAmount;
                console.log("Coalesced command:", lastCommand);
                return admissionResult(ADMISSION_COALESCED);
            }
        }
    }

    const limit = isProtectedCommand(command)
        ? HARD_QUEUE_CAPACITY
        : ORDINARY_ADMISSION_CEILING;

    if (commandQueue.length >= limit) {
        return admissionResult(ADMISSION_QUEUE_FULL);
    }

    commandQueue.push(command);

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
        return admissionResult(ADMISSION_QUEUE_FULL);
    }

    for (const command of batch) {
        commandQueue.push(command);
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

    return commandQueue.shift();
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
    clearLatestResult,
    setLatestResult,
    getLatestResult,
    getStatus,
    getSupportedSliders,
    getSliderMetadata,
    resetQueueForTests
};
