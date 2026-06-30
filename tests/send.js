const WebSocket = require("ws");

const slider = process.argv[2];
const amount = Number(process.argv[3]);

if (!slider || Number.isNaN(amount)) {
    console.log("Usage:");
    console.log("node tests/send.js Exposure 1");
    process.exit(1);
}

const ws = new WebSocket("ws://localhost:17890");

ws.on("open", () => {

    const command = {
        command: "develop.adjust",
        slider: slider,
        amount: amount
    };

    console.log("Sending:");
    console.log(command);

    ws.send(JSON.stringify(command));

    ws.close();

});