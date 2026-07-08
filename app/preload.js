const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lrbridge", {
    getInitialState: function () {
        return ipcRenderer.invoke("get-initial-state");
    },
    startLightroom: function () {
        return ipcRenderer.invoke("start-lightroom");
    },
    saveSettings: function (settings) {
        return ipcRenderer.invoke("save-settings", settings);
    },
    resetSettings: function () {
        return ipcRenderer.invoke("reset-settings");
    },
    openHelp: function () {
        return ipcRenderer.invoke("open-help");
    },
    openKoFi: function () {
        return ipcRenderer.invoke("open-kofi");
    },
    openWebController: function () {
        return ipcRenderer.invoke("open-web-controller");
    },
    openHttpBuilder: function () {
        return ipcRenderer.invoke("open-http-builder");
    },
    copyText: function (text) {
        return ipcRenderer.invoke("copy-text", text);
    },
    quitApp: function () {
        return ipcRenderer.invoke("quit-app");
    },
    onLog: function (callback) {
        ipcRenderer.on("bridge-log", function (_event, line) {
            callback(line);
        });
    }
});
