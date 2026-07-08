const terminal = document.getElementById("terminal");
const polling = document.getElementById("polling");
const controllerUrl = document.getElementById("controllerUrl");
const controllerLanUrls = document.getElementById("controllerLanUrls");
const pollingInput = document.getElementById("pollingInput");
const settingsMessage = document.getElementById("settingsMessage");

const startLightroomButton = document.getElementById("startLightroom");
const openWebControllerButton = document.getElementById("openWebController");
const openHelpButton = document.getElementById("openHelp");
const openHttpBuilderButton = document.getElementById("openHttpBuilder");
const saveSettingsButton = document.getElementById("saveSettings");
const defaultSettingsButton = document.getElementById("defaultSettings");
const quitAppButton = document.getElementById("quitApp");
const openKoFiButton = document.getElementById("openKoFi");
const shareLocalControllerButton = document.getElementById("shareLocalController");
const shareLocalStatus = document.getElementById("shareLocalStatus");

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

async function shareLink(url, statusElement) {
    await window.lrbridge.copyText(url);

    if (statusElement) {
        statusElement.textContent = "URL copied to clipboard: " + url;
    }
}

function createShareIconButton(url, statusElement) {
    const button = document.createElement("button");
    button.className = "share-url";
    button.title = "Copy share link";
    button.setAttribute("aria-label", "Copy share link");

    button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M18 16.1C17.24 16.1 16.56 16.4 16.04 16.88L8.91 12.73C8.96 12.5 9 12.26 9 12C9 11.74 8.96 11.5 8.91 11.27L15.96 7.16C16.5 7.66 17.21 7.97 18 7.97C19.66 7.97 21 6.63 21 4.97C21 3.31 19.66 2 18 2C16.34 2 15 3.31 15 4.97C15 5.23 15.04 5.47 15.09 5.7L8.04 9.81C7.5 9.31 6.79 9 6 9C4.34 9 3 10.34 3 12C3 13.66 4.34 15 6 15C6.79 15 7.5 14.69 8.04 14.19L15.16 18.35C15.11 18.56 15.08 18.78 15.08 19C15.08 20.61 16.39 21.92 18 21.92C19.61 21.92 20.92 20.61 20.92 19C20.92 17.39 19.61 16.1 18 16.1Z"></path>' +
        "</svg>";

    button.addEventListener("click", function () {
        shareLink(url, statusElement);
    });

    return button;
}

function renderLanUrls(urls) {
    controllerLanUrls.textContent = "";

    if (!urls || urls.length === 0) {
        controllerLanUrls.textContent = "No network addresses detected.";
        return;
    }

    urls.forEach(function (url) {
        const row = document.createElement("div");
        row.className = "url-row";

        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.textContent = url;
        link.className = "url-pill";

        const status = document.createElement("span");
        status.className = "share-status";

        row.appendChild(link);
        row.appendChild(createShareIconButton(url, status));
        row.appendChild(status);
        controllerLanUrls.appendChild(row);
    });

    if (urls.length > 1) {
        const note = document.createElement("div");
        note.textContent = "If your PC has multiple network connections, more than one address may appear. To control Lightroom Classic from another device, use the address from the network that both devices are connected to.";
        note.className = "network-note";
        controllerLanUrls.appendChild(note);
    }
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

    renderLanUrls(state.controllerLanUrls);

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

openHttpBuilderButton.addEventListener("click", async function () {
    appendLog("UI: Open HTTP Builder clicked.");
    await window.lrbridge.openHttpBuilder();
});

quitAppButton.addEventListener("click", async function () {
    appendLog("UI: Quit LRBridge clicked.");
    await window.lrbridge.quitApp();
});

openKoFiButton.addEventListener("click", async function () {
    appendLog("UI: Open Ko-fi support clicked.");
    await window.lrbridge.openKoFi();
});

shareLocalControllerButton.addEventListener("click", function () {
    shareLink(currentControllerUrl, shareLocalStatus);
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


