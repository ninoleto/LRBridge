const allowedSliders = [
    "Exposure",
    "Contrast",
    "Highlights",
    "Shadows",
    "Whites",
    "Blacks"
];

let latestCommand = null;

function setLatestCommand(commandText) {
    console.log("Command received:", commandText);

    const parts = commandText.trim().split(" ");

    if (parts.length !== 2) {
        console.log("Invalid command. Expected format: Slider Amount");
        return;
    }

    const slider = parts[0];
    const amount = Number(parts[1]);

    if (!allowedSliders.includes(slider)) {
        console.log("Unknown slider:", slider);
        return;
    }

    if (Number.isNaN(amount)) {
        console.log("Invalid amount:", parts[1]);
        return;
    }

    latestCommand = {
        type: "developAdjust",
        slider: slider,
        amount: amount
    };

    console.log("Stored command for Lightroom:", latestCommand);
}

function getNextCommand() {
    if (latestCommand === null) {
        return null;
    }

    const commandToSend = latestCommand;
    latestCommand = null;

    return commandToSend;
}

module.exports = {
    setLatestCommand,
    getNextCommand
};