const commandQueue = [];
let latestResult = null;

const sliderMap = {
    Exposure: true,
    Contrast: true,
    Highlights: true,
    Shadows: true,
    Whites: true,
    Blacks: true,

    Temperature: true,
    Tint: true,

    Texture: true,
    Clarity: true,
    Dehaze: true,

    Vibrance: true,
    Saturation: true,

    Sharpness: true,
    LuminanceNR: true,
    ColorNR: true
};

function getSupportedSliders() {
    return Object.keys(sliderMap);
}

function validateCommand(command) {
    const allowedCommands = [
        "develop.adjust",
        "develop.get",
        "develop.set"
    ];

    if (!allowedCommands.includes(command.command)) {
        console.log("Unknown command:", command.command);
        return false;
    }

    if (!sliderMap[command.slider]) {
        console.log("Unknown slider:", command.slider);
        return false;
    }

    if (command.command === "develop.adjust" && typeof command.amount !== "number") {
        console.log("Invalid amount");
        return false;
    }

    if (command.command === "develop.set" && typeof command.value !== "number") {
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
        return;
    }

    if (!validateCommand(command)) {
        return;
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
            return;
        }
    }

    commandQueue.push(command);

    console.log("Queued command:", command);
    console.log("Queue length:", commandQueue.length);
}

function getNextCommand() {
    if (commandQueue.length === 0) {
        return null;
    }

    return commandQueue.shift();
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
        supportedSliders: getSupportedSliders()
    };
}

module.exports = {
    setLatestCommand,
    getNextCommand,
    setLatestResult,
    getLatestResult,
    getStatus,
    getSupportedSliders
};