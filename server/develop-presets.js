"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_VERSION = 1;
const INVENTORY_TIMEOUT_MS = 20_000;
const APPLICATION_TIMEOUT_MS = 20_000;
const OUTCOME_STALE = "stale/rejected";
const OUTCOME_OBSERVED = "SDK call completed and covered effect observed";
const OUTCOME_NO_CHANGE = "SDK call completed with no detectable change";
const OUTCOME_FAILED = "failed";
const TERMINAL_OUTCOMES = new Set([
    OUTCOME_STALE,
    OUTCOME_OBSERVED,
    OUTCOME_NO_CHANGE,
    OUTCOME_FAILED
]);
const SUCCESS_OUTCOMES = new Set([OUTCOME_OBSERVED, OUTCOME_NO_CHANGE]);
const DEFAULT_PRESET_AMOUNT = 100;
const MIN_PRESET_AMOUNT = 0;
const MAX_PRESET_AMOUNT = 200;

function validIdentity(value, maximumLength) {
    return typeof value === "string" && value.length >= 1 && value.length <= maximumLength &&
        !/[\u0000-\u001f\u007f]/.test(value);
}

function validRequestId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function validPresetAmount(value) {
    return Number.isSafeInteger(value) && value >= MIN_PRESET_AMOUNT && value <= MAX_PRESET_AMOUNT;
}

function normalizeAlias(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw new TypeError("Develop preset alias must be a string");
    const alias = value.trim();
    if (alias.length === 0) return null;
    if (!validIdentity(alias, 160)) throw new RangeError("Develop preset alias is invalid");
    return alias;
}

function normalizeConfiguredEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError("Develop preset configuration entry must be an object");
    }
    if (!validIdentity(entry.uuid, 200)) throw new RangeError("Develop preset UUID is invalid");
    const updateAISettings = entry.updateAISettings === undefined ? false : entry.updateAISettings;
    if (typeof updateAISettings !== "boolean") {
        throw new TypeError("Develop preset updateAISettings must be boolean");
    }
    const normalized = {
        uuid: entry.uuid,
        updateAISettings: updateAISettings
    };
    const alias = normalizeAlias(entry.alias);
    if (alias !== null) normalized.alias = alias;
    return normalized;
}

function normalizeConfiguration(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        input.version !== CONFIG_VERSION || !Array.isArray(input.presets) ||
        Object.keys(input).some(function (key) { return key !== "version" && key !== "presets"; })) {
        throw new TypeError("Develop preset configuration must use version 1 and a presets array");
    }
    const seen = new Set();
    const presets = input.presets.map(function (entry) {
        const normalized = normalizeConfiguredEntry(entry);
        if (seen.has(normalized.uuid)) throw new Error("Develop preset UUIDs must be unique");
        seen.add(normalized.uuid);
        return normalized;
    });
    return { version: CONFIG_VERSION, presets: presets };
}

function compareText(left, right) {
    const a = String(left).toLowerCase();
    const b = String(right).toLowerCase();
    if (a < b) return -1;
    if (a > b) return 1;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function compareInventory(left, right) {
    return compareText(left.folder, right.folder) || compareText(left.name, right.name) ||
        compareText(left.uuid, right.uuid);
}

function normalizeInventoryItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !validIdentity(item.uuid, 200) || !validIdentity(item.folder, 300) ||
        !validIdentity(item.name, 300)) {
        throw new TypeError("Invalid Develop preset inventory item");
    }
    return { uuid: item.uuid, folder: item.folder, name: item.name };
}

function operationId(prefix, counter, now) {
    return prefix + "-" + now.toString(36) + "-" + counter.toString(36);
}

function createDevelopPresetState(options) {
    options = options || {};
    const configPath = options.configPath === undefined
        ? path.join(__dirname, "..", "config", "develop-presets.json")
        : options.configPath;
    const fileSystem = options.fs || fs;
    const now = typeof options.now === "function" ? options.now : Date.now;
    let counter = 0;
    let configuration = { version: CONFIG_VERSION, presets: [] };
    let configurationError = null;
    let inventory = [];
    let inventoryByUuid = new Map();
    let inventoryStatus = "unavailable";
    let inventoryError = "Refresh the Develop preset inventory from Lightroom.";
    let inventoryRefreshedAt = null;
    let pendingInventory = null;
    let cursorUuid = null;
    let presetAmount = null;
    const pendingApplications = new Map();
    let lastApplication = null;

    function loadConfiguration() {
        if (!configPath) return configuration;
        try {
            const text = fileSystem.readFileSync(configPath, "utf8");
            configuration = normalizeConfiguration(JSON.parse(text));
            configurationError = null;
        } catch (err) {
            if (err && err.code === "ENOENT") {
                configuration = { version: CONFIG_VERSION, presets: [] };
                configurationError = null;
            } else {
                configuration = { version: CONFIG_VERSION, presets: [] };
                configurationError = "Could not load Develop preset configuration: " + err.message;
            }
        }
        reconcileCursor();
        return configuration;
    }

    function saveConfiguration(input) {
        const normalized = normalizeConfiguration(input);
        if (configPath) {
            const directory = path.dirname(configPath);
            fileSystem.mkdirSync(directory, { recursive: true });
            const temporaryPath = configPath + ".tmp";
            fileSystem.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
            fileSystem.renameSync(temporaryPath, configPath);
        }
        configuration = normalized;
        configurationError = null;
        reconcileCursor();
        return getPublicState();
    }

    function availableConfiguredEntries() {
        if (inventoryStatus !== "ready") return [];
        return configuration.presets.filter(function (entry) { return inventoryByUuid.has(entry.uuid); });
    }

    function reconcileCursor() {
        const previousCursorUuid = cursorUuid;
        if (inventoryStatus !== "ready") {
            if (!configuredEntry(cursorUuid)) cursorUuid = null;
            if (cursorUuid !== previousCursorUuid) presetAmount = null;
            return;
        }
        const available = availableConfiguredEntries();
        if (available.length === 0) {
            cursorUuid = null;
            presetAmount = null;
            return;
        }
        if (!available.some(function (entry) { return entry.uuid === cursorUuid; })) {
            cursorUuid = available[0].uuid;
            presetAmount = null;
        }
    }

    function expirePending() {
        const observedAt = now();
        if (pendingInventory && observedAt - pendingInventory.startedAt > INVENTORY_TIMEOUT_MS) {
            failInventoryRefresh(pendingInventory.requestId,
                "Lightroom did not return a Develop preset inventory. Ensure the LRBridge plug-in is loaded and command polling is running.");
        }
        for (const pending of pendingApplications.values()) {
            if (observedAt - pending.submittedAt > APPLICATION_TIMEOUT_MS) {
                finishApplication(pending.operationId, pending.uuid, OUTCOME_FAILED,
                    "Lightroom did not return a preset application result.");
            }
        }
    }

    function beginInventoryRefresh() {
        expirePending();
        if (pendingInventory) throw new Error("A Develop preset inventory refresh is already pending");
        counter += 1;
        const requestId = operationId("inventory", counter, now());
        inventoryStatus = "refreshing";
        inventoryError = null;
        inventoryRefreshedAt = null;
        pendingInventory = { requestId: requestId, startedAt: now(), items: new Map() };
        return requestId;
    }

    function acceptInventoryItem(requestId, item) {
        if (!pendingInventory || pendingInventory.requestId !== requestId) return false;
        const normalized = normalizeInventoryItem(item);
        if (pendingInventory.items.has(normalized.uuid)) return false;
        pendingInventory.items.set(normalized.uuid, normalized);
        return true;
    }

    function completeInventoryRefresh(requestId) {
        if (!pendingInventory || pendingInventory.requestId !== requestId) return false;
        inventory = Array.from(pendingInventory.items.values()).sort(compareInventory);
        inventoryByUuid = new Map(inventory.map(function (item) { return [item.uuid, item]; }));
        pendingInventory = null;
        inventoryStatus = "ready";
        inventoryError = null;
        inventoryRefreshedAt = now();
        reconcileCursor();
        return true;
    }

    function failInventoryRefresh(requestId, message) {
        if (!pendingInventory || pendingInventory.requestId !== requestId) return false;
        pendingInventory = null;
        inventory = [];
        inventoryByUuid = new Map();
        inventoryStatus = "error";
        inventoryError = validIdentity(message, 500) ? message : "Develop preset inventory refresh failed.";
        inventoryRefreshedAt = null;
        cursorUuid = null;
        presetAmount = null;
        return true;
    }

    function cancelInventoryRefresh(requestId, message) {
        return failInventoryRefresh(requestId, message);
    }

    function configuredEntry(uuid) {
        return configuration.presets.find(function (entry) { return entry.uuid === uuid; }) || null;
    }

    function beginApplication(uuid, binding, requestedPresetAmount) {
        expirePending();
        if (pendingApplications.size > 0) {
            throw new Error("Wait for the current Develop preset application to finish");
        }
        if (!validPresetAmount(requestedPresetAmount)) {
            throw new Error("Develop preset Amount must be an integer from 0 through 200");
        }
        const entry = configuredEntry(uuid);
        if (!entry) throw new Error("Develop preset is not configured");
        if (inventoryStatus !== "ready") throw new Error(inventoryError || "Develop preset inventory is unavailable");
        if (!inventoryByUuid.has(uuid)) throw new Error("Configured Develop preset UUID is unavailable in Lightroom");
        if (!binding || binding.activeModule !== "develop" || !validIdentity(binding.selectedPhotoUuid, 200) ||
            !Number.isSafeInteger(binding.contextCounter) || binding.contextCounter < 0 ||
            !Number.isSafeInteger(binding.developCounter) || binding.developCounter < 0) {
            throw new Error("Develop preset application requires a current Develop photo context");
        }
        counter += 1;
        const operation = {
            operationId: operationId("apply", counter, now()),
            uuid: uuid,
            presetAmount: requestedPresetAmount,
            updateAISettings: entry.updateAISettings,
            expectedActiveModule: binding.activeModule,
            expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            submittedAt: now()
        };
        pendingApplications.set(operation.operationId, operation);
        lastApplication = Object.assign({ outcome: null, detail: "Waiting for Lightroom." }, operation);
        return Object.assign({}, operation);
    }

    function applicationBindingMatches(command, fields) {
        const pending = command && pendingApplications.get(command.operationId);
        return Boolean(pending && pending.uuid === command.uuid && pending.presetAmount === command.presetAmount &&
            pending.updateAISettings === command.updateAISettings &&
            command.expectedActiveModule === "develop" && fields && fields.activeModule === command.expectedActiveModule &&
            fields.selectedPhotoUuid === command.expectedSelectedPhotoUuid &&
            fields.contextCounter === command.expectedContextCounter &&
            fields.developCounter === command.expectedDevelopCounter);
    }

    function finishApplication(operationIdValue, uuid, outcome, detail) {
        const pending = pendingApplications.get(operationIdValue);
        if (!pending || pending.uuid !== uuid || !TERMINAL_OUTCOMES.has(outcome)) return false;
        pendingApplications.delete(operationIdValue);
        if (SUCCESS_OUTCOMES.has(outcome) && configuredEntry(uuid) && inventoryByUuid.has(uuid)) {
            cursorUuid = uuid;
            presetAmount = pending.presetAmount;
        } else {
            reconcileCursor();
        }
        lastApplication = Object.assign({}, pending, {
            outcome: outcome,
            detail: validIdentity(detail, 500) ? detail : outcome,
            completedAt: now()
        });
        return true;
    }

    function rejectApplication(command, detail) {
        if (!command) return false;
        return finishApplication(command.operationId, command.uuid, OUTCOME_STALE,
            detail || "Develop preset application was rejected because its captured context changed.");
    }

    function rejectMismatchedApplications(fields) {
        for (const pending of Array.from(pendingApplications.values())) {
            if (!applicationBindingMatches(pending, fields)) {
                rejectApplication(pending, "Develop preset application was rejected because its captured photo, module, context, or Develop revision changed.");
            }
        }
    }

    function cancelApplication(operationIdValue) {
        const pending = pendingApplications.get(operationIdValue);
        if (!pending) return false;
        pendingApplications.delete(operationIdValue);
        if (lastApplication && lastApplication.operationId === operationIdValue && lastApplication.outcome === null) {
            lastApplication = null;
        }
        return true;
    }

    function navigationTarget(direction) {
        const available = availableConfiguredEntries();
        if (available.length === 0) return null;
        const currentIndex = available.findIndex(function (entry) { return entry.uuid === cursorUuid; });
        const startingIndex = currentIndex >= 0 ? currentIndex : 0;
        const delta = direction === "previous" ? -1 : direction === "next" ? 1 : 0;
        if (delta === 0) return null;
        return available[(startingIndex + delta + available.length) % available.length].uuid;
    }

    function publicConfiguredEntry(entry) {
        const item = inventoryByUuid.get(entry.uuid) || null;
        const available = inventoryStatus === "ready" && item !== null;
        return {
            uuid: entry.uuid,
            alias: entry.alias || null,
            updateAISettings: entry.updateAISettings,
            folder: item ? item.folder : null,
            name: item ? item.name : null,
            available: available,
            error: available ? null : "Preset UUID is unavailable in the current Lightroom inventory."
        };
    }

    function getPublicState() {
        expirePending();
        const configured = configuration.presets.map(publicConfiguredEntry);
        const availableCount = configured.filter(function (entry) { return entry.available; }).length;
        return {
            ok: true,
            configuration: { version: CONFIG_VERSION, presets: configuration.presets.map(function (entry) {
                return Object.assign({}, entry);
            }) },
            configurationError: configurationError,
            inventory: inventory.map(function (item) { return Object.assign({}, item); }),
            inventoryStatus: inventoryStatus,
            inventoryError: inventoryError,
            inventoryRefreshedAt: inventoryRefreshedAt,
            inventoryRequestId: pendingInventory ? pendingInventory.requestId : null,
            configured: configured,
            availableCount: availableCount,
            cursorUuid: cursorUuid,
            presetAmount: presetAmount,
            controlsEnabled: inventoryStatus === "ready" && availableCount > 0,
            pendingApplication: pendingApplications.size > 0,
            lastApplication: lastApplication ? Object.assign({}, lastApplication) : null
        };
    }

    loadConfiguration();

    return {
        beginInventoryRefresh,
        acceptInventoryItem,
        completeInventoryRefresh,
        failInventoryRefresh,
        cancelInventoryRefresh,
        saveConfiguration,
        loadConfiguration,
        beginApplication,
        applicationBindingMatches,
        finishApplication,
        rejectApplication,
        rejectMismatchedApplications,
        cancelApplication,
        navigationTarget,
        getPublicState
    };
}

module.exports = {
    CONFIG_VERSION,
    OUTCOME_STALE,
    OUTCOME_OBSERVED,
    OUTCOME_NO_CHANGE,
    OUTCOME_FAILED,
    TERMINAL_OUTCOMES,
    SUCCESS_OUTCOMES,
    DEFAULT_PRESET_AMOUNT,
    MIN_PRESET_AMOUNT,
    MAX_PRESET_AMOUNT,
    compareInventory,
    normalizeConfiguration,
    normalizeInventoryItem,
    validRequestId,
    validPresetAmount,
    createDevelopPresetState
};
