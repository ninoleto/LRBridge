const sliders = require("./sliders");

const commandQueue = [];
let latestResult = null;

const allowedActions = [
    "resetCrop",
    "resetTransforms",
    "setAutoTone",
    "setAutoWhiteBalance",
    "resetSpotRemoval",
    "resetRedeye"
];

function validateCommand(command) {
    const allowedCommands = [
        "develop.adjust",
        "develop.get",
        "develop.set",
        "develop.reset",
        "develop.action"
    ];

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
        (typeof command.amount !== "number" || Number.isNaN(command.amount))
    ) {
        console.log("Invalid amount");
        return false;
    }

    if (
        command.command === "develop.set" &&
        (typeof command.value !== "number" || Number.isNaN(command.value))
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

    if (!validateCommand(command)) {
        return false;
    }

    if (command.command === "develop.adjust") {
        const lastCommand = commandQueue[commandQueue.length - 1];

        if (
            lastCommand &&
            lastCommand.command === "develop.adjust" &&
            lastCommand.slider === command.slider
        ) {
            lastCommand.amount += command.amount;
            console.log("Coalesced command:", lastCommand);
            return true;
        }
    }

    commandQueue.push(command);

    console.log("Queued command:", command);
    console.log("Queue length:", commandQueue.length);

    return true;
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

module.exports = {
    setLatestCommand,
    getNextCommand,
    clearLatestResult,
    setLatestResult,
    getLatestResult,
    getStatus,
    getSupportedSliders,
    getSliderMetadata
};