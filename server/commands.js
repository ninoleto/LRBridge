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

function setLatestCommand(message) {
    let command;

    try {
        command = JSON.parse(message);
    } catch (err) {
        console.log("Invalid JSON");
        return;
    }

    const allowedCommands = [
        "develop.adjust",
        "develop.get",
        "develop.set"
    ];

    if (!allowedCommands.includes(command.command)) {
        console.log("Unknown command:", command.command);
        return;
    }

    if (!sliderMap[command.slider]) {
        console.log("Unknown slider:", command.slider);
        return;
    }

    if (command.command === "develop.adjust" && typeof command.amount !== "number") {
        console.log("Invalid amount");
        return;
    }

    if (command.command === "develop.set" && typeof command.value !== "number") {
        console.log("Invalid value");
        return;
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

module.exports = {
    setLatestCommand,
    getNextCommand,
    setLatestResult,
    getLatestResult
};