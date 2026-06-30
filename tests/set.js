const WebSocket = require("ws");

const slider = process.argv[2];
const value = Number(process.argv[3]);

if (!slider || Number.isNaN(value)) {
    console.log("Usage:");
    console.log("node tests/set.js Exposure 0");
    process.exit(1);
}

const ws = new WebSocket("ws://localhost:17890");

ws.on("open", () => {

    const command = {
        command: "develop.set",
        slider: slider,
        value: value
    };

    console.log("Sending:");
    console.log(command);

    ws.send(JSON.stringify(command));

    ws.close();

});