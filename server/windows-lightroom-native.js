"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const childProcess = require("node:child_process");

const BRUSH_CONTROLS = Object.freeze(["amount", "size", "feather", "flow"]);
const CHECKBOX_CONTROLS = Object.freeze(["visualizeDepth", "autoMask"]);

function unavailableControl() {
    return { available: false, value: null, min: null, max: null };
}

function unavailableCheckbox() {
    return { available: false, value: null };
}

function unavailableAction() {
    return { available: false, enabled: false };
}

function unavailableNativeState(reason) {
    return {
        available: false,
        reason: typeof reason === "string" && reason !== "" ? reason : "unavailable",
        brush: {
            amount: unavailableControl(),
            size: unavailableControl(),
            feather: unavailableControl(),
            flow: unavailableControl()
        },
        visualizeDepth: unavailableCheckbox(),
        autoMask: unavailableCheckbox(),
        refinementMode: "unknown",
        refinementModeTargetsAvailable: false,
        refinementDisclosure: unavailableCheckbox(),
        refinementReset: unavailableAction(),
        focusActions: {
            subject: unavailableAction(),
            pointArea: unavailableAction()
        }
    };
}

function sanitizeNumericControl(input) {
    if (!input || typeof input !== "object" || input.available !== true ||
        !Number.isFinite(input.value) || !Number.isFinite(input.min) || !Number.isFinite(input.max) ||
        input.min > input.max || input.value < input.min || input.value > input.max) return unavailableControl();
    return { available: true, value: input.value, min: input.min, max: input.max };
}

function sanitizeCheckbox(input) {
    return input && typeof input === "object" && input.available === true && typeof input.value === "boolean"
        ? { available: true, value: input.value }
        : unavailableCheckbox();
}

function sanitizeAction(input) {
    return input && typeof input === "object" && input.available === true && typeof input.enabled === "boolean"
        ? { available: true, enabled: input.enabled }
        : unavailableAction();
}

function sanitizeNativeState(input) {
    if (!input || typeof input !== "object" || input.available !== true || !input.brush || typeof input.brush !== "object") {
        return unavailableNativeState(input && typeof input.reason === "string" ? input.reason : undefined);
    }
    const state = unavailableNativeState(null);
    state.available = true;
    state.reason = null;
    for (const control of BRUSH_CONTROLS) state.brush[control] = sanitizeNumericControl(input.brush[control]);
    state.visualizeDepth = sanitizeCheckbox(input.visualizeDepth);
    state.autoMask = sanitizeCheckbox(input.autoMask);
    state.refinementMode = input.refinementMode === "focus" || input.refinementMode === "blur"
        ? input.refinementMode
        : "unknown";
    state.refinementModeTargetsAvailable = input.refinementModeTargetsAvailable === true;
    state.refinementDisclosure = sanitizeCheckbox(input.refinementDisclosure);
    state.refinementReset = sanitizeAction(input.refinementReset);
    const focusActions = input.focusActions && typeof input.focusActions === "object" ? input.focusActions : {};
    state.focusActions.subject = sanitizeAction(focusActions.subject);
    state.focusActions.pointArea = sanitizeAction(focusActions.pointArea);
    return state;
}

class NativeBackendUnavailableError extends Error {
    constructor(message) {
        super(message || "Windows Lightroom native controls unavailable");
        this.name = "NativeBackendUnavailableError";
        this.code = "LIGHTROOM_NATIVE_UNAVAILABLE";
    }
}

class NativeBackendOperationError extends Error {
    constructor(message) {
        super(message || "Windows Lightroom native operation was rejected");
        this.name = "NativeBackendOperationError";
        this.code = "LIGHTROOM_NATIVE_REJECTED";
    }
}

function resolveScriptPath(options) {
    if (options.scriptPath) return path.resolve(options.scriptPath);
    const resourceRoot = options.resourcesPath || process.resourcesPath;
    if (resourceRoot) {
        const packaged = path.join(resourceRoot, "native", "windows-lightroom-native.ps1");
        if (fs.existsSync(packaged)) return packaged;
    }
    return path.join(__dirname, "windows-lightroom-native.ps1");
}

function createUnavailableWindowsBackend(reason) {
    const state = unavailableNativeState(reason || "Windows native backend disabled");
    function reject() { return Promise.reject(new NativeBackendUnavailableError(state.reason)); }
    return Object.freeze({
        readState: function () { return Promise.resolve(unavailableNativeState(state.reason)); },
        setBrushValue: reject,
        resetBrushValue: reject,
        adjustBrushValue: reject,
        setCheckbox: reject,
        setRefinementMode: reject,
        setRefinementDisclosure: reject,
        resetRefinement: reject,
        activateFocusRangeAction: reject,
        stop: function () { return Promise.resolve(); }
    });
}

function createWindowsLightroomNativeBackend(options) {
    options = options || {};
    const platform = options.platform || process.platform;
    if (platform !== "win32") return createUnavailableWindowsBackend("Windows native backend is unavailable on " + platform);

    const spawn = options.spawn || childProcess.spawn;
    const scriptPath = resolveScriptPath(options);
    const requestTimeoutMs = options.requestTimeoutMs === undefined ? 5000 : options.requestTimeoutMs;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 250 || requestTimeoutMs > 60000) {
        throw new TypeError("requestTimeoutMs must be an integer from 250 through 60000");
    }

    let child = null;
    let reader = null;
    let requestId = 0;
    const pending = new Map();
    let latestState = unavailableNativeState("Windows native state has not been read yet");

    function rememberState(input) {
        const state = sanitizeNativeState(input);
        if (state.available) latestState = state;
        return state;
    }

    function refreshStateInBackground() {
        setTimeout(function () {
            request("readState").then(rememberState).catch(function () {});
        }, 0);
    }

    function rejectPending(error) {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
    }

    function disposeChild(instance) {
        if (child !== instance) return;
        if (reader) reader.close();
        reader = null;
        child = null;
    }

    function startChild() {
        if (child) return child;
        if (!fs.existsSync(scriptPath)) throw new NativeBackendUnavailableError("Windows native helper is missing");

        const instance = spawn("powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-File", scriptPath
        ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        let stderrTail = "";
        child = instance;
        reader = readline.createInterface({ input: instance.stdout, crlfDelay: Infinity });
        reader.on("line", function (line) {
            if (line.length > 1024 * 1024) {
                rejectPending(new NativeBackendUnavailableError("Windows native helper response was too large"));
                return;
            }
            let response;
            try { response = JSON.parse(line); } catch (err) { return; }
            const entry = pending.get(response.id);
            if (!entry) return;
            pending.delete(response.id);
            clearTimeout(entry.timer);
            if (response.ok === true) {
                entry.resolve(response.result);
            } else {
                const message = typeof response.error === "string" ? response.error : "Windows Lightroom native controls unavailable";
                entry.reject(response.unavailable === true
                    ? new NativeBackendUnavailableError(message)
                    : new NativeBackendOperationError(message));
            }
        });
        instance.once("error", function (error) {
            rejectPending(new NativeBackendUnavailableError(error.message));
            disposeChild(instance);
        });
        instance.once("exit", function (code) {
            const detail = stderrTail.trim().replace(/\s+/g, " ");
            rejectPending(new NativeBackendUnavailableError("Windows native helper exited" +
                (code === null ? "" : " with code " + code) + (detail === "" ? "" : ": " + detail)));
            disposeChild(instance);
        });
        if (instance.stderr) instance.stderr.on("data", function (chunk) {
            stderrTail = (stderrTail + chunk.toString("utf8")).slice(-8192);
        });
        return instance;
    }

    function request(operation, parameters) {
        let instance;
        try { instance = startChild(); } catch (error) { return Promise.reject(error); }
        const id = ++requestId;
        const message = Object.assign({ id: id, operation: operation }, parameters || {});
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () {
                pending.delete(id);
                reject(new NativeBackendUnavailableError("Windows native helper timed out"));
                try { instance.kill(); } catch (err) {}
            }, requestTimeoutMs);
            pending.set(id, { resolve: resolve, reject: reject, timer: timer });
            instance.stdin.write(JSON.stringify(message) + "\n", "utf8", function (error) {
                if (!error) return;
                const entry = pending.get(id);
                if (!entry) return;
                pending.delete(id);
                clearTimeout(entry.timer);
                reject(new NativeBackendUnavailableError(error.message));
            });
        });
    }

    function validateBrushControl(control) {
        if (!BRUSH_CONTROLS.includes(control)) throw new TypeError("Unknown Brush Refinement control");
    }

    function normalizeBrushInteraction(options) {
        options = options || {};
        const interaction = options.interaction === undefined || options.interaction === null
            ? null
            : options.interaction;
        if (interaction !== null && (typeof interaction !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(interaction))) {
            throw new TypeError("Invalid Brush Refinement interaction id");
        }
        if (options.final !== undefined && typeof options.final !== "boolean") {
            throw new TypeError("Invalid Brush Refinement final flag");
        }
        return { interaction: interaction, final: options.final === undefined ? true : options.final };
    }

    return Object.freeze({
        readState: async function () {
            try { return rememberState(await request("readState")); }
            catch (error) { return unavailableNativeState(error.message); }
        },
        setBrushValue: async function (control, value, options) {
            validateBrushControl(control);
            if (!Number.isFinite(value)) throw new TypeError("Brush Refinement value must be finite");
            const interaction = normalizeBrushInteraction(options);
            return rememberState(await request("setTrackbar", {
                control: control,
                value: value,
                interaction: interaction.interaction,
                final: interaction.final
            }));
        },
        resetBrushValue: async function (control) {
            validateBrushControl(control);
            const result = await request("resetTrackbar", { control: control });
            if (!result || result.control !== control) throw new NativeBackendOperationError("Invalid native reset readback");
            const affected = sanitizeNumericControl(result.affected);
            if (!affected.available) throw new NativeBackendOperationError("Native reset value is unavailable");
            let state;
            if (latestState.available) {
                state = sanitizeNativeState(latestState);
                state.brush[control] = affected;
                latestState = state;
            } else {
                state = rememberState(await request("readState"));
            }
            refreshStateInBackground();
            return sanitizeNativeState(state);
        },
        adjustBrushValue: async function (control, amount) {
            validateBrushControl(control);
            if (!Number.isFinite(amount)) throw new TypeError("Brush Refinement adjustment must be finite");
            return rememberState(await request("adjustTrackbar", { control: control, amount: amount }));
        },
        setCheckbox: async function (control, enabled) {
            if (!CHECKBOX_CONTROLS.includes(control)) throw new TypeError("Unknown Lens Blur checkbox");
            if (typeof enabled !== "boolean") throw new TypeError("Lens Blur checkbox target must be boolean");
            return rememberState(await request("setCheckbox", { control: control, enabled: enabled }));
        },
        setRefinementMode: async function (mode) {
            if (mode !== "focus" && mode !== "blur") throw new TypeError("Unknown Brush Refinement mode");
            return rememberState(await request("setRefinementMode", { mode: mode }));
        },
        setRefinementDisclosure: async function (open) {
            if (typeof open !== "boolean") throw new TypeError("Brush Refinement disclosure target must be boolean");
            return rememberState(await request("setRefinementDisclosure", { open: open }));
        },
        resetRefinement: async function () {
            return rememberState(await request("resetRefinement"));
        },
        activateFocusRangeAction: async function (action) {
            if (action !== "subject" && action !== "point-area") throw new TypeError("Unknown Focus Range action");
            return rememberState(await request("activateFocusRangeAction", { action: action }));
        },
        stop: function () {
            const instance = child;
            if (!instance) return Promise.resolve();
            rejectPending(new NativeBackendUnavailableError("Windows native backend stopped"));
            disposeChild(instance);
            try { instance.kill(); } catch (err) {}
            return Promise.resolve();
        }
    });
}

module.exports = Object.freeze({
    BRUSH_CONTROLS,
    CHECKBOX_CONTROLS,
    NativeBackendUnavailableError,
    NativeBackendOperationError,
    unavailableNativeState,
    sanitizeNativeState,
    createUnavailableWindowsBackend,
    createWindowsLightroomNativeBackend
});
