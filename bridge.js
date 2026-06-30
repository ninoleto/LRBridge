const express = require("express");
const WebSocket = require("ws");

const HTTP_PORT = 17891;
const WS_PORT = 17890;

const allowedSliders = [
    "Exposure",
    "Contrast",
    "Highlights",
    "Shadows",
    "Whites",
    "Blacks"
];

let latestCommand = null;

const app = express();

app.get("/next", function (req, res) {
    if (latestCommand === null) {
        res.json({ command: null });
        return;
    }

    const commandToSend = latestCommand;
    latestCommand = null;

    res.json({ command: commandToSend });
});

app.listen(HTTP_PORT, function () {
    console.log("LRBridge HTTP server listening on http://localhost:" + HTTP_PORT);
});

const wsServer = new WebSocket.Server({ port: WS_PORT });

console.log("LRBridge WebSocket server listening on ws://localhost:" + WS_PORT);

function handleCommand(commandText) {
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

wsServer.on("connection", function (socket) {
    console.log("Client connected.");

    socket.on("message", function (message) {
        handleCommand(message.toString());
    });

    socket.on("close", function () {
        console.log("Client disconnected.");
    });
});