const terminal = document.getElementById("terminal");
const polling = document.getElementById("polling");
const controllerUrl = document.getElementById("controllerUrl");
const pollingInput = document.getElementById("pollingInput");
const settingsMessage = document.getElementById("settingsMessage");

const startLightroomButton = document.getElementById("startLightroom");
const openWebControllerButton = document.getElementById("openWebController");
const openHelpButton = document.getElementById("openHelp");
const saveSettingsButton = document.getElementById("saveSettings");
const defaultSettingsButton = document.getElementById("defaultSettings");

let defaultPollingMs = 100;
let currentControllerUrl = "http://127.0.0.1:17892/";

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
    currentControllerUrl = state.controllerUrl || currentControllerUrl;

    setPollingDisplay(state.pollingMs);
    pollingInput.min = state.minPollingMs;
    pollingInput.max = state.maxPollingMs;

    controllerUrl.textContent = currentControllerUrl;
    controllerUrl.href = currentControllerUrl;

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

openWebControllerButton.addEventListener("click", function () {
    appendLog("UI: Open web controller clicked.");
    window.open(currentControllerUrl, "_blank");
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
        settingsMessage.textContent = "Error: " + result.error;
        return;
    }

    setPollingDisplay(result.pollingMs);
    settingsMessage.textContent = "Settings saved to " + result.pollingMs + " ms. Change applies automatically within about 1 second.";
});

defaultSettingsButton.addEventListener("click", async function () {
    appendLog("UI: Default settings clicked.");

    const result = await window.lrbridge.resetSettings();

    if (!result.ok) {
        appendLog("UI ERROR: " + result.error);
        settingsMessage.textContent = "Error: " + result.error;
        return;
    }

    setPollingDisplay(result.pollingMs);
    settingsMessage.textContent = "Default settings restored to " + result.pollingMs + " ms. Change applies automatically within about 1 second.";
});

init();
