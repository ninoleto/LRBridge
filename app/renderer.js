const terminal = document.getElementById("terminal");
const polling = document.getElementById("polling");
const lightroomPath = document.getElementById("lightroomPath");
const pollingInput = document.getElementById("pollingInput");
const settingsHint = document.getElementById("settingsHint");

const startLightroomButton = document.getElementById("startLightroom");
const openHelpButton = document.getElementById("openHelp");
const saveSettingsButton = document.getElementById("saveSettings");
const defaultSettingsButton = document.getElementById("defaultSettings");

let defaultPollingMs = 50;

function appendLog(line) {
    const div = document.createElement("div");
    div.textContent = line;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function setPollingDisplay(value) {
    polling.textContent = value + " ms";
    pollingInput.value = value;
}

async function init() {
    const state = await window.lrbridge.getInitialState();

    defaultPollingMs = state.defaultPollingMs;

    setPollingDisplay(state.pollingMs);
    pollingInput.min = state.minPollingMs;
    pollingInput.max = state.maxPollingMs;
    lightroomPath.textContent = state.lightroomPath;

    for (const line of state.logs) {
        appendLog(line);
    }

    window.lrbridge.onLog(function (line) {
        appendLog(line);
    });
}

startLightroomButton.addEventListener("click", async function () {
    appendLog("UI: Start Lightroom Classic clicked.");

    const result = await window.lrbridge.startLightroom();

    if (!result.ok) {
        appendLog("UI ERROR: " + result.error);
    }
});

openHelpButton.addEventListener("click", async function () {
    appendLog("UI: Open help clicked.");
    await window.lrbridge.openHelp();
});

saveSettingsButton.addEventListener("click", async function () {
    appendLog("UI: Save settings clicked.");

    const result = await window.lrbridge.saveSettings({
        pollingMs: pollingInput.value
    });

    if (!result.ok) {
        appendLog("UI ERROR: " + result.error);
        return;
    }

    setPollingDisplay(result.pollingMs);
    settingsHint.textContent = "Saved. Change applies automatically within about 1 second.";
});

defaultSettingsButton.addEventListener("click", async function () {
    appendLog("UI: Default settings clicked.");

    const result = await window.lrbridge.resetSettings();

    if (!result.ok) {
        appendLog("UI ERROR: " + result.error);
        return;
    }

    setPollingDisplay(result.pollingMs);
    settingsHint.textContent = "Default settings restored. Change applies automatically within about 1 second.";
});

init();

