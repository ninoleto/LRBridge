const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lrbridge", {
    getInitialState: function () {
        return ipcRenderer.invoke("get-initial-state");
    },
    onLog: function (callback) {
        ipcRenderer.on("bridge-log", function (_event, line) {
            callback(line);
        });
    }
});
