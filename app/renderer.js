const terminal = document.getElementById("terminal");
const polling = document.getElementById("polling");

function appendLog(line) {
    const div = document.createElement("div");
    div.textContent = line;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

async function init() {
    const state = await window.lrbridge.getInitialState();

    polling.textContent = state.pollingMs + " ms";

    for (const line of state.logs) {
        appendLog(line);
    }

    window.lrbridge.onLog(function (line) {
        appendLog(line);
    });
}

init();
