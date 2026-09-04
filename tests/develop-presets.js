"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const commands = require("../server/commands");
const presetDefinition = require("../server/develop-presets");
const webController = require("../app/controller-develop-presets");
const { createBridge } = require("../server/bridge");
const windowsNative = require("../server/windows-lightroom-native");

const root = path.join(__dirname, "..");
const controllerHtml = fs.readFileSync(path.join(root, "app", "controller.html"), "utf8");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-develop-presets-"));

assert.match(controllerHtml, /\.develop-preset-manager-toolbar\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*76px/,
    "Preset manager actions must remain in a sticky toolbar below Jump-to");
assert.match(controllerHtml, /\.develop-preset-manager-toolbar\s*>\s*button\s*\{[\s\S]*width:\s*100%/,
    "Preset toolbar actions must share readable equal-width touch targets");
assert.match(controllerHtml, /\.develop-preset-manager-toolbar\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    "Add, Refresh, and Save must share three responsive toolbar columns");
assert.match(controllerHtml,
    /\.develop-preset-manager-toolbar\s*>\s*button\s*\{[\s\S]*height:\s*52px;[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*10px 14px;[\s\S]*border-radius:\s*7px;[\s\S]*font-family:\s*inherit;[\s\S]*font-size:\s*14px;[\s\S]*font-weight:\s*700/,
    "Add, Refresh, and Save must share identical explicit touch sizing and inherited typography");
assert.match(controllerHtml, /\.develop-preset-add-open\s*\{[\s\S]*background:\s*#21465d/,
    "Add Presets must retain the blue action treatment");
assert.match(controllerHtml, /\.develop-preset-save\.dirty:not\(:disabled\)\s*\{[\s\S]*background:\s*#1f7651/,
    "Dirty Save Changes must use the established green action treatment");
assert.match(controllerHtml, /\.slider-jump-option\.preset-tab-entry\s*\{[\s\S]*#2f9ed8/,
    "The Presets Jump-to destination must use one alternate blue/teal accent");
assert.doesNotMatch(controllerHtml, /<select[^>]*developPreset/i,
    "Develop Presets must not use native select controls");

function request(port, requestPath, options = {}) {
    return new Promise(function (resolve, reject) {
        const outgoing = http.request({
            hostname: "127.0.0.1",
            port: port,
            path: requestPath,
            method: options.method || "GET",
            headers: options.headers
        }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (err) {}
                resolve({ statusCode: response.statusCode, body: parsed, text: body });
            });
        });
        outgoing.once("error", reject);
        if (options.body !== undefined) outgoing.write(options.body);
        outgoing.end();
    });
}

function encodedQuery(fields) {
    return Object.keys(fields).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(String(fields[key]));
    }).join("&");
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName).toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentElement = null;
        this.className = "";
        this.id = "";
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.disabled = false;
        this.hidden = false;
        this.selected = false;
        this.checked = false;
        this.open = false;
        this.value = "";
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollLeft = 0;
        this.scrollTop = 0;
        this.style = { setProperty() {} };
        this._textContent = "";
    }

    get textContent() {
        return this._textContent;
    }

    set textContent(value) {
        this._textContent = String(value);
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        if (this.tagName === "SELECT") this.value = "";
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    append(...children) {
        children.forEach(this.appendChild.bind(this));
    }

    remove() {
        if (!this.parentElement) return;
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    blur() {
        if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
        const event = { type: "blur", target: this, preventDefault() {} };
        for (const listener of this.listeners.get("blur") || []) listener(event);
    }

    select() {}

    setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }

    showModal() {
        this.open = true;
        this.hidden = false;
    }

    close() {
        this.open = false;
    }

    async dispatch(type, fields = {}) {
        const event = Object.assign({
            type: type,
            target: this,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }
        }, fields);
        for (const listener of this.listeners.get(type) || []) {
            await listener(event);
        }
        return event;
    }
}

class FakeDocument {
    constructor() {
        this.activeElement = null;
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }
}

function findElement(rootElement, predicate) {
    if (predicate(rootElement)) return rootElement;
    for (const child of rootElement.children) {
        const match = findElement(child, predicate);
        if (match) return match;
    }
    return null;
}

function findByText(rootElement, text) {
    return findElement(rootElement, function (element) { return element.textContent === text; });
}

function renderedText(element) {
    return element._textContent + element.children.map(renderedText).join("");
}

function findByClass(rootElement, className) {
    return findElement(rootElement, function (element) {
        return element.className.split(/\s+/).includes(className);
    });
}

function findByAttribute(rootElement, name, value) {
    return findElement(rootElement, function (element) { return element.getAttribute(name) === value; });
}

function countByClass(rootElement, className) {
    let count = rootElement.className.split(/\s+/).includes(className) ? 1 : 0;
    for (const child of rootElement.children) count += countByClass(child, className);
    return count;
}

function findAll(rootElement, predicate, found = []) {
    if (predicate(rootElement)) found.push(rootElement);
    for (const child of rootElement.children) findAll(child, predicate, found);
    return found;
}

function findByDataUuid(rootElement, uuid) {
    return findElement(rootElement, function (element) { return element.dataset.uuid === uuid; });
}

async function webControllerInventorySelectionPersistenceTest() {
    const inventory = [
        { uuid: "uuid-one", folder: "A Portrait", name: "One" },
        { uuid: "uuid-two", folder: "A Portrait", name: "Two" },
        { uuid: "uuid-three", folder: "B Color", name: "Three" },
        { uuid: "uuid-four", folder: "B Color", name: "Four" }
    ];
    let savedPresets = [
        { uuid: "uuid-one", alias: "Portrait Soft", updateAISettings: false, amountEnabled: true },
        { uuid: "uuid-two", updateAISettings: true, amountEnabled: true }
    ];
    let cursorUuid = "uuid-one";
    let presetAmount = null;
    let amountFeedbackReportedUnavailable = false;
    let saveCount = 0;
    let inventoryRefreshCount = 0;
    let treatmentPresentationCreateCount = 0;
    let treatmentPresentationDisposeCount = 0;
    const appliedUuids = [];
    const appliedAmounts = [];
    const serverEpoch = "browser-fixture";
    let stateRevision = 1;
    let amountFeedbackId = 1;
    let operationCounter = 0;
    let lastApplication = null;

    function publicState() {
        const configured = savedPresets.map(function (entry) {
            const preset = inventory.find(function (item) { return item.uuid === entry.uuid; });
            return {
                uuid: entry.uuid,
                alias: entry.alias || null,
                updateAISettings: entry.updateAISettings === true,
                amountEnabled: entry.amountEnabled === true,
                folder: preset ? preset.folder : null,
                name: preset ? preset.name : null,
                available: !!preset,
                missing: !preset,
                error: preset ? null : "Preset UUID is unavailable"
            };
        });
        return {
            ok: true,
            serverEpoch: serverEpoch,
            stateRevision: stateRevision,
            configuration: { version: 1, presets: savedPresets.map(function (entry) { return Object.assign({}, entry); }) },
            configurationError: null,
            inventory: inventory.map(function (preset) { return Object.assign({}, preset); }),
            inventoryStatus: "ready",
            inventoryError: null,
            inventoryRefreshedAt: 1,
            inventoryLoaded: true,
            inventoryRequestId: null,
            configured: configured,
            availableCount: configured.filter(function (entry) { return entry.available; }).length,
            cursorUuid: cursorUuid,
            cursorAmountEnabled: configured.some(function (entry) {
                return entry.uuid === cursorUuid && entry.amountEnabled === true;
            }),
            presetAmount: presetAmount,
            amountFeedback: presetAmount === null
                ? {
                    id: amountFeedbackReportedUnavailable ? amountFeedbackId : null,
                    available: false,
                    value: null,
                    range: null,
                    receivedAt: amountFeedbackReportedUnavailable ? 1000 + amountFeedbackId : null
                }
                : {
                    id: amountFeedbackId,
                    available: true,
                    value: presetAmount,
                    range: { min: 0, max: 200 },
                    receivedAt: 1000 + amountFeedbackId
                },
            controlsEnabled: configured.some(function (entry) { return entry.available; }),
            pendingApplication: false,
            pendingOperation: null,
            lastApplication: lastApplication
        };
    }

    async function fakeFetch(url, options) {
        let responseState;
        if (url === "/api/develop-presets/state") {
            responseState = publicState();
        } else if (url === "/api/develop-presets/inventory/refresh") {
            inventoryRefreshCount += 1;
            responseState = publicState();
        } else if (url === "/api/develop-presets/config") {
            assert.equal(options.method, "POST");
            const configuration = JSON.parse(options.body);
            savedPresets = configuration.presets.map(function (entry) { return Object.assign({}, entry); });
            saveCount += 1;
            stateRevision += 1;
            responseState = publicState();
        } else if (url.startsWith("/api/develop-presets/apply?")) {
            const parsed = new URL(url, "http://127.0.0.1");
            cursorUuid = parsed.searchParams.get("uuid");
            presetAmount = 100;
            appliedUuids.push(cursorUuid);
            stateRevision += 2;
            amountFeedbackId += 1;
            lastApplication = {
                operationId: "preset-" + (++operationCounter),
                operationKind: "preset",
                uuid: cursorUuid,
                outcome: presetDefinition.OUTCOME_NO_CHANGE,
                detail: "fixture preset success"
            };
            responseState = publicState();
        } else if (url.startsWith("/api/develop-presets/amount?")) {
            const parsed = new URL(url, "http://127.0.0.1");
            const requestedAmount = Number(parsed.searchParams.get("presetAmount"));
            const expectedFeedbackId = Number(parsed.searchParams.get("feedbackId"));
            presetAmount = requestedAmount;
            appliedAmounts.push(requestedAmount);
            amountFeedbackId += 1;
            responseState = {
                ok: true,
                queued: {
                    command: "develop_preset.amount.set",
                    presetAmount: requestedAmount,
                    expectedPresetUuid: cursorUuid,
                    expectedActiveModule: "develop",
                    expectedSelectedPhotoUuid: "photo",
                    expectedContextCounter: 1,
                    expectedDevelopCounter: 1,
                    expectedContextChangedAt: 1000,
                    expectedServerEpoch: serverEpoch,
                    expectedFeedbackId: expectedFeedbackId
                },
                coalesced: false,
                feedbackRequestId: amountFeedbackId
            };
        } else {
            throw new Error("Unexpected Web Controller request: " + url);
        }
        return {
            ok: true,
            async json() { return JSON.parse(JSON.stringify(responseState)); }
        };
    }

    const document = new FakeDocument();
    const host = document.createElement("div");
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const intervalHandles = [];
    global.setInterval = function (listener, milliseconds) {
        const handle = { listener: listener, milliseconds: milliseconds, active: true };
        intervalHandles.push(handle);
        return handle;
    };
    global.clearInterval = function (handle) {
        if (handle) handle.active = false;
    };
    const controller = webController.createController({
        document: document,
        fetch: fakeFetch,
        getContext: function () {
            return {
                activeModule: "develop",
                selectedPhotoUuid: "photo",
                contextCounter: 1,
                developCounter: 1,
                contextChangedAt: 1000
            };
        },
        createTreatmentPresentation: function () {
            treatmentPresentationCreateCount += 1;
            const row = document.createElement("div");
            row.className = "basic-controls-row develop-preset-treatment-row";
            const control = document.createElement("div");
            control.className = "preset-treatment-control";
            const colorButton = document.createElement("button");
            colorButton.textContent = "✓ Color";
            colorButton.setAttribute("aria-pressed", "true");
            const blackAndWhiteButton = document.createElement("button");
            blackAndWhiteButton.textContent = "Black & White";
            blackAndWhiteButton.setAttribute("aria-pressed", "false");
            const current = document.createElement("span");
            current.className = "preset-treatment-current";
            current.textContent = "Current: Color";
            const warning = document.createElement("div");
            warning.className = "preset-treatment-warning";
            warning.hidden = true;
            control.append(current, colorButton, blackAndWhiteButton, warning);
            row.appendChild(control);
            return {
                element: row,
                dispose: function () { treatmentPresentationDisposeCount += 1; }
            };
        }
    });

    try {
        controller.activate(host);
        await controller.refresh();
        assert.equal(intervalHandles.filter(function (handle) { return handle.active; }).length, 1,
            "Presets activation must start exactly one preset state poll");
        assert.equal(findAll(host, function (element) { return element.tagName === "SELECT"; }).length, 0,
            "Develop Presets must not render a native select");

        const currentButton = findByClass(host, "develop-preset-current-button");
        const currentPrimary = findByClass(host, "develop-preset-current-primary");
        const amountRange = findByAttribute(host, "aria-label", "Preset Amount");
        const amountNumber = findByAttribute(host, "aria-label", "Preset Amount numeric value");
        const amountCapabilityNote = findByClass(host, "develop-preset-amount-capability-note");
        assert.equal(findByText(host, "FAVORITE PRESETS").tagName, "H2");
        assert.ok(findByText(host,
            "This screen shows only your Favorites for faster touch control. Use Add to Favorites below to search all Lightroom presets."));
        assert.equal(findByText(host,
            "Using an Adaptive or AI preset? Open Manage Favorite Presets and enable AI adjustments so Lightroom can detect the sky, subject or people in each photo."), null,
        "The previous AI guidance must not remain above preset navigation");
        assert.ok(findByText(host, "Selected preset"));
        assert.ok(findByText(host, "Prev"));
        assert.ok(findByText(host, "Next"));
        const treatmentBlock = findByClass(host, "develop-preset-treatment");
        const colorTreatmentButton = findByText(treatmentBlock, "✓ Color");
        const blackAndWhiteTreatmentButton = findByText(treatmentBlock, "Black & White");
        const treatmentStatus = findByClass(treatmentBlock, "preset-treatment-current");
        const treatmentWarning = findByClass(treatmentBlock, "preset-treatment-warning");
        assert.ok(currentButton && currentPrimary);
        assert.ok(colorTreatmentButton && blackAndWhiteTreatmentButton,
            "Presets must render both segments from the injected shared treatment component");
        assert.equal(colorTreatmentButton.getAttribute("aria-pressed"), "true");
        assert.equal(blackAndWhiteTreatmentButton.getAttribute("aria-pressed"), "false");
        assert.equal(treatmentStatus.textContent, "Current: Color",
            "Presets must display feedback supplied by the shared authoritative treatment presentation");
        assert.equal(treatmentWarning.hidden, true);
        const compactRoot = findByClass(host, "develop-presets-controller");
        const compactStatus = findByClass(host, "develop-presets-controller-status");
        const managePresets = findByText(host, "Manage Favorite Presets");
        const aiGuidance = findByClass(host, "develop-preset-ai-guidance");
        const aiGuidanceIcon = findByClass(aiGuidance, "develop-preset-ai-guidance-icon");
        assert.ok(findByText(aiGuidance,
            "If an Adaptive or AI preset does not change the photo, open Manage Favorite Presets and turn on AI adjustments for that preset. This lets Lightroom apply the preset’s sky, subject or people effects."));
        assert.equal(aiGuidance.className.includes("warning"), false,
            "AI guidance must use a distinct informational presentation, not the B&W warning class");
        assert.equal(aiGuidanceIcon.textContent, "i");
        assert.equal(aiGuidanceIcon.getAttribute("aria-hidden"), "true");
        assert.ok(compactRoot.children.indexOf(currentButton.parentElement.parentElement) <
            compactRoot.children.indexOf(aiGuidance),
        "AI guidance must not render above preset navigation");
        assert.ok(compactRoot.children.indexOf(amountRange.parentElement) < compactRoot.children.indexOf(treatmentBlock));
        assert.ok(compactRoot.children.indexOf(amountRange.parentElement) < compactRoot.children.indexOf(aiGuidance));
        assert.ok(compactRoot.children.indexOf(treatmentBlock) < compactRoot.children.indexOf(aiGuidance),
            "AI guidance must render after PHOTO MODE so it is not visually associated with Amount");
        assert.ok(compactRoot.children.indexOf(aiGuidance) < compactRoot.children.indexOf(compactStatus),
            "AI guidance must remain above the transient status");
        assert.ok(compactRoot.children.indexOf(treatmentBlock) < compactRoot.children.indexOf(compactStatus));
        assert.ok(compactRoot.children.indexOf(treatmentBlock) < compactRoot.children.indexOf(managePresets),
            "Treatment must sit after Preset Amount and before status/Manage Favorite Presets");
        assert.equal(findAll(treatmentBlock, function (element) {
            return element.textContent === "Black & White";
        }).length, 1);
        assert.equal(currentPrimary.textContent, "Portrait Soft");
        assert.equal(amountRange.disabled, true,
            "Amount must stay disabled until a configured preset application succeeds");
        assert.equal(amountCapabilityNote.textContent, "Checking Amount availability…",
            "An enabled favorite must show a loading message before Lightroom reports Amount availability");
        amountFeedbackReportedUnavailable = true;
        amountFeedbackId += 1;
        stateRevision += 1;
        await controller.refresh();
        assert.equal(renderedText(amountCapabilityNote),
            "Amount slider unavailable: Make sure it is enabled under Preset Options. If enabled, Lightroom Classic does not support it for this preset.",
            "Completed unavailable feedback must not tell the photographer to enable an already-enabled option");
        const amountUnavailableEmphasis = findByClass(amountCapabilityNote,
            "develop-preset-amount-unavailable-emphasis");
        assert.equal(amountUnavailableEmphasis.textContent, "Amount slider unavailable:");
        assert.equal(amountCapabilityNote.children.length, 2,
            "Only the unavailable prefix may receive separate emphasis markup");
        await currentButton.dispatch("click");

        let configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        let configuredSearchInput = findByAttribute(configuredDialog, "aria-label", "Search configured presets");
        assert.equal(configuredDialog.open, true);
        assert.equal(configuredDialog.getAttribute("aria-modal"), "true");
        assert.equal(document.activeElement, configuredSearchInput, "Picker focus must enter the search field");
        assert.equal(findByDataUuid(configuredDialog, "uuid-one").getAttribute("aria-selected"), "true",
            "The current LRBridge cursor must be visibly marked");

        configuredSearchInput.value = "two";
        await configuredSearchInput.dispatch("input");
        assert.equal(findByDataUuid(configuredDialog, "uuid-one"), null);
        assert.ok(findByDataUuid(configuredDialog, "uuid-two"));
        await controller.refresh();
        await controller.refresh();
        configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        configuredSearchInput = findByAttribute(configuredDialog, "aria-label", "Search configured presets");
        assert.equal(configuredDialog.open, true, "Authoritative polling must not dismiss an open picker");
        assert.equal(configuredSearchInput.value, "two", "Authoritative polling must preserve picker search state");

        configuredSearchInput.value = "";
        await configuredSearchInput.dispatch("input");
        await findByDataUuid(configuredDialog, "uuid-one").dispatch("click");
        assert.deepEqual(appliedUuids, ["uuid-one"], "Selecting the current cursor must explicitly reapply it");
        assert.equal(configuredDialog.open, false);
        assert.equal(document.activeElement, currentButton, "Applying a preset must restore focus to the opener");
        assert.equal(amountRange.disabled, false);
        assert.equal(amountRange.value, "100", "Direct selection must expose committed Amount 100 after success");

        await amountNumber.dispatch("focus");
        amountNumber.value = "125";
        await amountNumber.dispatch("keydown", { key: "Enter" });
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.deepEqual(appliedAmounts, [125]);
        assert.equal(amountRange.value, "125", "Successful Amount reapplication must update committed presentation");

        const decrementAmount = findByAttribute(host, "aria-label", "Decrease Preset Amount");
        const incrementAmount = findByAttribute(host, "aria-label", "Increase Preset Amount");
        const resetAmount = findByText(host, "Reset");
        await incrementAmount.dispatch("click");
        await new Promise(function (resolve) { setImmediate(resolve); });
        await decrementAmount.dispatch("click");
        await new Promise(function (resolve) { setImmediate(resolve); });
        await resetAmount.dispatch("click");
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.deepEqual(appliedAmounts, [125, 126, 125, 100],
            "Amount plus, minus, and Reset must submit bounded explicit reapplications");

        await amountRange.dispatch("pointerdown", { pointerType: "mouse" });
        amountRange.value = "112";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        assert.deepEqual(appliedAmounts, [125, 126, 125, 100],
            "Normal range input must remain bounded by its throttle before release");
        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await new Promise(function (resolve) { setImmediate(resolve); });
        amountRange.value = "113";
        await amountRange.dispatch("change");
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.deepEqual(appliedAmounts, [125, 126, 125, 100, 112, 113],
            "Pointer release and a later change may each submit through the normal native parameter path");

        await currentButton.dispatch("click");
        configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        await findByDataUuid(configuredDialog, "uuid-two").dispatch("click");
        assert.deepEqual(appliedUuids, ["uuid-one", "uuid-two"]);
        assert.equal(currentPrimary.textContent, "Two", "Applying must move the server-authoritative cursor");
        assert.equal(amountRange.value, "100", "Selecting another preset must reset Amount to 100");

        await amountRange.dispatch("pointerdown", { pointerType: "touch" });
        amountRange.value = "140";
        await amountRange.dispatch("input", { pointerType: "touch" });
        await controller.refresh();
        assert.deepEqual(appliedAmounts, [125, 126, 125, 100, 112, 113],
            "AI preset range input must remain local until the normal native-parameter throttle fires");
        assert.equal(amountRange.value, "140", "Polling must not overwrite an in-progress AI Amount drag");
        await amountRange.dispatch("pointerup", { pointerType: "touch" });
        await new Promise(function (resolve) { setImmediate(resolve); });
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.deepEqual(appliedAmounts, [125, 126, 125, 100, 112, 113, 140],
            "AI preset Amount must use the same native parameter path on pointer release");
        await currentButton.dispatch("click");
        configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        await findByDataUuid(configuredDialog, "uuid-two").dispatch("click");
        assert.deepEqual(appliedUuids, ["uuid-one", "uuid-two", "uuid-two"],
            "Selecting the already-selected cursor row must reapply it");

        const manageButton = findByText(host, "Manage Favorite Presets");
        assert.ok(manageButton);
        await manageButton.dispatch("click");
        assert.ok(findByText(host,
            "Choose which Lightroom presets appear in Favorite Presets and arrange the order used by Prev and Next. Adding an alias does not rename the original Lightroom preset."));
        const addButton = findByText(host, "+ Add to Favorites");
        const refreshButton = findByText(host, "Refresh Presets");
        const saveButton = findByText(host, "Save Changes");
        assert.ok(addButton && refreshButton && saveButton);
        assert.equal(saveButton.disabled, true, "A saved configuration must expose a neutral disabled Save action");
        assert.equal(saveButton.className, "develop-preset-save");
        assert.equal(countByClass(host, "develop-preset-add-open"), 1,
            "Manage Favorite Presets must expose exactly one Add to Favorites action");
        assert.equal(countByClass(host, "develop-preset-refresh"), 1,
            "Manage Favorite Presets must expose exactly one Refresh Presets action");
        assert.equal(countByClass(host, "develop-preset-save"), 1,
            "Manage Favorite Presets must expose exactly one Save Changes action");
        const firstConfiguredCard = findByDataUuid(findByClass(host, "develop-preset-config-list"), "uuid-one");
        assert.equal(firstConfiguredCard.children[0].className, "develop-preset-config-field preset");
        assert.equal(firstConfiguredCard.children[0].children[0].textContent, "Preset");
        assert.equal(firstConfiguredCard.children[1].className, "develop-preset-config-field folder");
        assert.equal(firstConfiguredCard.children[1].children[0].textContent, "Folder");
        assert.equal(firstConfiguredCard.children[2].className, "develop-preset-config-field alias");
        assert.equal(firstConfiguredCard.children[2].children[0].textContent, "Alias (optional)");
        const optionsHeading = findByClass(host, "develop-preset-options-heading");
        assert.equal(optionsHeading.textContent, "Preset options");
        const optionFields = findByClass(host, "develop-preset-config-options");
        const aiToggle = findByAttribute(host, "aria-label", "AI adjustments for A Portrait — One");
        assert.ok(aiToggle, "Each configured card must retain its internal AI-application boolean");
        assert.equal(findByClass(aiToggle, "develop-preset-option-title").textContent, "AI adjustments");
        assert.equal(findByClass(aiToggle, "develop-preset-option-help").textContent,
            "Enable this if you apply an Adaptive or AI preset and the preset does not visibly affect the photo.");
        const amountSwitch = findByAttribute(host, "aria-label",
            "Amount slider for A Portrait — One");
        assert.ok(amountSwitch, "Each configured card must expose the UUID-bound Amount capability switch");
        assert.equal(findByClass(amountSwitch, "develop-preset-option-title").textContent, "Amount slider");
        assert.equal(findByClass(amountSwitch, "develop-preset-option-help").textContent,
            "Enable the Amount slider for this preset. Leave it disabled if Lightroom does not show an Amount slider for this preset.");
        assert.equal(aiToggle.className, "develop-preset-option-toggle");
        assert.equal(amountSwitch.className, "develop-preset-option-toggle enabled");
        assert.equal(optionFields.children.length, 2);
        assert.equal(findAll(optionFields, function (element) {
            return element.tagName === "INPUT" && element.type === "checkbox";
        }).length, 0, "Both preset options must use the same custom toggle-card component");
        assert.equal(aiToggle.tagName, "BUTTON");
        assert.equal(aiToggle.getAttribute("role"), "switch");
        assert.equal(aiToggle.getAttribute("aria-checked"), "false");
        assert.equal(amountSwitch.tagName, "BUTTON", "Amount capability must not use a native checkbox");
        assert.equal(amountSwitch.getAttribute("role"), "switch");
        assert.equal(amountSwitch.getAttribute("aria-checked"), "true");
        await aiToggle.dispatch("click");
        assert.equal(aiToggle.getAttribute("aria-checked"), "true");
        await aiToggle.dispatch("click");
        assert.equal(aiToggle.getAttribute("aria-checked"), "false");
        amountSwitch.focus();
        await amountSwitch.dispatch("click");
        assert.equal(amountSwitch.getAttribute("aria-checked"), "false");
        await controller.refresh();
        assert.equal(findByAttribute(host, "aria-label",
            "Amount slider for A Portrait — One"), amountSwitch,
        "Polling must preserve the capability switch node and manager draft");
        assert.equal(document.activeElement, amountSwitch);
        await amountSwitch.dispatch("click");
        assert.equal(amountSwitch.getAttribute("aria-checked"), "true");
        assert.equal(saveButton.disabled, true, "Returning a capability draft to its saved value must clear dirty state");
        const managerToolbar = findByClass(host, "develop-preset-manager-toolbar");
        assert.ok(managerToolbar && managerToolbar.children[0] === addButton &&
            managerToolbar.children[1] === refreshButton && managerToolbar.children[2] === saveButton,
        "Add, Refresh, and Save must appear in the required top manager toolbar order");
        assert.equal(findByClass(host, "develop-preset-config-list").parentElement.children.includes(saveButton), false,
            "There must be no bottom Save Changes action");
        assert.equal(countByClass(host, "develop-preset-config-row"), 2);
        await addButton.dispatch("click");
        assert.equal(inventoryRefreshCount, 1, "+ Add to Favorites must refresh the Lightroom inventory when opened");
        let inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        assert.ok(findByText(inventoryDialog, "Add Lightroom Presets to Favorites"));
        const inventorySearchInput = findByAttribute(inventoryDialog, "aria-label", "Search Lightroom preset inventory");
        assert.equal(inventoryDialog.open, true);
        assert.equal(findByDataUuid(inventoryDialog, "uuid-one").disabled, true,
            "Configured presets must be marked and unavailable for duplicate addition");
        inventorySearchInput.value = "color";
        await inventorySearchInput.dispatch("input");
        assert.equal(findByDataUuid(inventoryDialog, "uuid-one"), null);
        assert.ok(findByDataUuid(inventoryDialog, "uuid-three"));

        await findByDataUuid(inventoryDialog, "uuid-four").dispatch("click");
        await controller.refresh();
        await controller.refresh();
        inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        assert.equal(findByDataUuid(inventoryDialog, "uuid-four").getAttribute("aria-selected"), "true",
            "Polling/rerender cycles must preserve transient inventory multi-selection");
        await findByDataUuid(inventoryDialog, "uuid-three").dispatch("click");
        const addSelected = findByText(inventoryDialog, "Add selected");
        assert.equal(addSelected.disabled, false);
        await addSelected.dispatch("click");
        assert.equal(inventoryDialog.open, false);
        assert.deepEqual(controller.getDraft().map(function (entry) { return entry.uuid; }),
            ["uuid-one", "uuid-two", "uuid-three", "uuid-four"],
            "Simultaneously added presets must enter the draft in deterministic inventory order");
        assert.deepEqual(controller.getDraft().slice(2).map(function (entry) { return entry.amountEnabled; }),
            [false, false], "Newly added presets must default Amount capability to disabled");
        assert.equal(countByClass(host, "develop-preset-config-row"), 4,
            "Add selected must render all unsaved configuration cards immediately");
        assert.equal(saveButton.disabled, false, "A changed draft must enable Save Changes");
        assert.match(saveButton.className, /\bdirty\b/, "A changed draft must expose the green Save state");
        assert.equal(currentPrimary.textContent, "Two",
            "Unsaved draft additions must not change the compact current-preset button");

        const configuredList = findByClass(host, "develop-preset-config-list");
        configuredList.scrollTop = 37;
        const aliasInput = findByAttribute(host, "aria-label", "Optional alias for A Portrait — Two");
        assert.equal(aliasInput.placeholder, "Optional alias");
        aliasInput.focus();
        let typedAlias = "";
        for (const character of "Saved Alias") {
            typedAlias += character;
            aliasInput.value = typedAlias;
            aliasInput.selectionStart = aliasInput.value.length;
            aliasInput.selectionEnd = aliasInput.value.length;
            aliasInput.scrollLeft = aliasInput.value.length * 3;
            await aliasInput.dispatch("input");
            await controller.refresh();
            await controller.refresh();
            await controller.refresh();
            assert.equal(findByAttribute(host, "aria-label", "Optional alias for A Portrait — Two"), aliasInput,
                "Authoritative preset polling must preserve the keyed Alias input node");
            assert.equal(document.activeElement, aliasInput, "Authoritative polling must preserve Alias focus");
            assert.equal(aliasInput.value, typedAlias);
            assert.equal(aliasInput.selectionStart, aliasInput.value.length);
            assert.equal(aliasInput.selectionEnd, aliasInput.value.length);
            assert.equal(aliasInput.scrollLeft, aliasInput.value.length * 3);
            assert.equal(configuredList.scrollTop, 37, "Authoritative polling must preserve manager scroll position");
            assert.equal(controller.getDraft()[1].alias, aliasInput.value,
                "Each Alias input event must update the local authoritative draft without a list rerender");
        }
        assert.equal(aliasInput.value, "Saved Alias");
        assert.equal(currentPrimary.textContent, "Two", "An unsaved alias must not leak into the compact cursor");

        let aliasRow = findByDataUuid(configuredList, "uuid-two");
        let moveUp = findByText(aliasRow, "Move Up");
        moveUp.focus();
        await moveUp.dispatch("click");
        aliasRow = findByDataUuid(configuredList, "uuid-two");
        assert.equal(document.activeElement, findByText(aliasRow, "Move Up"),
            "Reordering must restore focus to the same UUID-keyed action");
        const moveDown = findByText(aliasRow, "Move Down");
        moveDown.focus();
        await moveDown.dispatch("click");
        assert.equal(document.activeElement, findByText(findByDataUuid(configuredList, "uuid-two"), "Move Down"),
            "Moving back must keep focus on the same UUID-keyed card");
        assert.deepEqual(controller.getDraft().map(function (entry) { return entry.uuid; }),
            ["uuid-one", "uuid-two", "uuid-three", "uuid-four"]);

        const fourthRow = findByDataUuid(configuredList, "uuid-four");
        const removeFourth = findByText(fourthRow, "Remove");
        removeFourth.focus();
        await removeFourth.dispatch("click");
        assert.equal(document.activeElement, findByText(findByDataUuid(configuredList, "uuid-three"), "Remove"),
            "Removing the focused final card must move focus predictably to the preceding keyed card");
        await addButton.dispatch("click");
        inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        await findByDataUuid(inventoryDialog, "uuid-four").dispatch("click");
        await findByText(inventoryDialog, "Add selected").dispatch("click");
        assert.equal(document.activeElement, addButton,
            "Adding cards must restore focus to the single Add to Favorites toolbar action");
        assert.deepEqual(controller.getDraft().map(function (entry) { return entry.uuid; }),
            ["uuid-one", "uuid-two", "uuid-three", "uuid-four"]);

        controller.deactivate();
        assert.equal(controller.isActive(), false);
        assert.equal(treatmentPresentationDisposeCount, 1,
            "Leaving Presets must unregister its shared treatment presentation");
        assert.equal(intervalHandles.filter(function (handle) { return handle.active; }).length, 0,
            "Leaving Presets must clean up the preset poll");
        controller.activate(host);
        await controller.refresh();
        assert.equal(treatmentPresentationCreateCount, 2,
            "Returning to Presets must create one fresh shared treatment presentation");
        assert.equal(intervalHandles.filter(function (handle) { return handle.active; }).length, 1,
            "Returning to Presets must start one fresh preset poll");
        const reactivatedManager = findByText(host, "Manage Favorite Presets");
        assert.equal(findByClass(host, "develop-preset-manager").hidden, true,
            "Manage Favorite Presets must be collapsed by default on Presets activation");
        await reactivatedManager.dispatch("click");
        assert.equal(countByClass(host, "develop-preset-config-row"), 4,
            "Tab navigation must preserve the complete unsaved manager draft");
        assert.equal(controller.getDraft()[1].alias, "Saved Alias");

        const reactivatedSave = findByText(host, "Save Changes");
        assert.equal(reactivatedSave.disabled, false);
        assert.match(reactivatedSave.className, /\bdirty\b/);
        await reactivatedSave.dispatch("click");
        assert.equal(saveCount, 1);
        assert.equal(savedPresets.length, 4);
        assert.equal(savedPresets[1].alias, "Saved Alias", "Save must submit the complete final Alias value");
        assert.equal(reactivatedSave.disabled, true, "Successful Save must return to the neutral disabled state");
        assert.equal(reactivatedSave.className, "develop-preset-save");
        assert.equal(findByClass(host, "develop-preset-current-primary").textContent, "Saved Alias",
            "Successful authoritative save must update the compact current-preset button");

        const reactivatedCurrent = findByClass(host, "develop-preset-current-button");
        await reactivatedCurrent.dispatch("click");
        configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        assert.equal(findAll(configuredDialog, function (element) {
            return element.className.split(/\s+/).includes("develop-preset-picker-option");
        }).length, 4, "The configured picker must update only after Save configuration succeeds");
        const searchAfterSave = findByAttribute(configuredDialog, "aria-label", "Search configured presets");
        await searchAfterSave.dispatch("keydown", { key: "ArrowDown" });
        assert.equal(document.activeElement.dataset.uuid, "uuid-one", "Arrow Down must enter the available option list");
        await configuredDialog.dispatch("keydown", { key: "Escape" });
        assert.equal(configuredDialog.open, false, "Escape must dismiss the picker");
        assert.equal(document.activeElement, reactivatedCurrent, "Escape must restore focus");

        await reactivatedCurrent.dispatch("click");
        configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        await configuredDialog.dispatch("click", { target: configuredDialog });
        assert.equal(configuredDialog.open, false, "Clicking the modal backdrop must dismiss the picker");
        controller.deactivate();
        assert.equal(treatmentPresentationDisposeCount, 2,
            "Each Presets presentation must be unregistered exactly once");
    } finally {
        controller.deactivate();
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
}

async function webControllerInventoryRefreshLifecycleTest() {
    const savedPresets = [
        { uuid: "uuid-delayed", alias: "Saved Alias", updateAISettings: true },
        { uuid: "uuid-second", updateAISettings: false }
    ];
    let inventory = [];
    let inventoryStatus = "not-loaded";
    let inventoryError = null;
    let inventoryLoaded = false;
    let inventoryRefreshedAt = null;
    let cursorUuid = "uuid-delayed";
    let presetAmount = 137;
    let inventoryRefreshCount = 0;
    let configurationSaveCount = 0;
    let applicationCount = 0;
    const refreshResponses = [];
    let serverEpoch = "inventory-epoch-one";
    let stateRevision = 1;
    let amountFeedbackId = 1;

    function configuredState() {
        return savedPresets.map(function (entry) {
            const item = inventory.find(function (candidate) { return candidate.uuid === entry.uuid; }) || null;
            const missing = inventoryLoaded && !item;
            return {
                uuid: entry.uuid,
                alias: entry.alias || null,
                updateAISettings: entry.updateAISettings === true,
                amountEnabled: entry.amountEnabled === true,
                folder: item ? item.folder : null,
                name: item ? item.name : null,
                available: inventoryLoaded && !!item,
                missing: missing,
                error: missing ? "Preset UUID is unavailable in the current Lightroom inventory." : null
            };
        });
    }

    function publicState() {
        const configured = configuredState();
        return {
            ok: true,
            serverEpoch: serverEpoch,
            stateRevision: stateRevision,
            configuration: {
                version: 1,
                presets: savedPresets.map(function (entry) { return Object.assign({}, entry); })
            },
            configurationError: null,
            inventory: inventory.map(function (entry) { return Object.assign({}, entry); }),
            inventoryStatus: inventoryStatus,
            inventoryError: inventoryError,
            inventoryRefreshedAt: inventoryRefreshedAt,
            inventoryLoaded: inventoryLoaded,
            inventoryRequestId: null,
            configured: configured,
            availableCount: configured.filter(function (entry) { return entry.available; }).length,
            cursorUuid: cursorUuid,
            cursorAmountEnabled: false,
            presetAmount: presetAmount,
            amountFeedback: {
                id: amountFeedbackId,
                available: true,
                value: presetAmount,
                range: { min: 0, max: 200 },
                receivedAt: 1000 + amountFeedbackId
            },
            controlsEnabled: inventoryLoaded && configured.some(function (entry) { return entry.available; }),
            pendingApplication: false,
            pendingOperation: null,
            lastApplication: null
        };
    }

    function deferredRefresh() {
        let resolve;
        const promise = new Promise(function (resolvePromise) { resolve = resolvePromise; });
        return {
            promise: promise,
            resolveState: function () {
                stateRevision += 1;
                const snapshot = JSON.parse(JSON.stringify(publicState()));
                resolve({ ok: true, async json() { return snapshot; } });
            }
        };
    }

    async function fakeFetch(url) {
        if (url === "/api/develop-presets/state") {
            const snapshot = JSON.parse(JSON.stringify(publicState()));
            return { ok: true, async json() { return snapshot; } };
        }
        if (url === "/api/develop-presets/inventory/refresh") {
            inventoryRefreshCount += 1;
            const response = refreshResponses.shift();
            if (!response) throw new Error("Unexpected inventory refresh");
            return response.promise;
        }
        if (url === "/api/develop-presets/config") configurationSaveCount += 1;
        if (url.startsWith("/api/develop-presets/apply?") ||
            url.startsWith("/api/develop-presets/amount?") ||
            url.startsWith("/api/develop-presets/navigate?")) applicationCount += 1;
        throw new Error("Unexpected preset lifecycle request: " + url);
    }

    function flushAsync() {
        return new Promise(function (resolve) {
            setImmediate(function () { setImmediate(resolve); });
        });
    }

    function containsText(rootElement, fragment) {
        return findAll(rootElement, function () { return true; }).some(function (element) {
            return element.textContent.includes(fragment);
        });
    }

    const document = new FakeDocument();
    const host = document.createElement("div");
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    global.setInterval = function (listener, milliseconds) {
        return { listener: listener, milliseconds: milliseconds, active: true };
    };
    global.clearInterval = function (handle) {
        if (handle) handle.active = false;
    };
    const controller = webController.createController({
        document: document,
        fetch: fakeFetch,
        getContext: function () {
            return {
                activeModule: "develop",
                selectedPhotoUuid: "photo",
                contextCounter: 4,
                developCounter: 8,
                contextChangedAt: 4000
            };
        }
    });

    try {
        const automaticFailure = deferredRefresh();
        refreshResponses.push(automaticFailure);
        controller.activate(host);
        await flushAsync();
        assert.equal(inventoryRefreshCount, 1,
            "First Presets activation must automatically request the current-process inventory exactly once");
        const compactStatus = findByClass(host, "develop-presets-controller-status");
        assert.equal(compactStatus.textContent, "Finding Lightroom presets…");
        assert.equal(findByClass(host, "develop-presets-controller").dataset.inventoryStatus, "loading");

        await findByText(host, "Manage Favorite Presets").dispatch("click");
        const addButton = findByText(host, "+ Add to Favorites");
        const refreshButton = findByText(host, "Refresh Presets");
        const saveButton = findByText(host, "Save Changes");
        const configuredList = findByClass(host, "develop-preset-config-list");
        const initialRow = findByDataUuid(configuredList, "uuid-delayed");
        assert.equal(findByClass(initialRow, "preset").children[1].textContent, "uuid-delayed");
        assert.equal(containsText(host, "missing UUID"), false,
            "Configured UUIDs must not be called missing before a successful inventory snapshot exists");
        assert.equal(saveButton.disabled, true, "Automatic inventory loading must not dirty configuration");

        const addDuringAutomatic = addButton.dispatch("click");
        const manualDuringAutomatic = refreshButton.dispatch("click");
        await flushAsync();
        assert.equal(inventoryRefreshCount, 1,
            "Automatic, Add to Favorites, and manual refresh calls must share one browser refresh operation");
        let inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        assert.equal(inventoryDialog.open, false,
            "+ Add to Favorites must wait for the authoritative refresh before opening the picker");

        inventoryStatus = "error";
        inventoryError = "Lightroom inventory probe failed";
        automaticFailure.resolveState();
        await Promise.all([addDuringAutomatic, manualDuringAutomatic]);
        inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        assert.equal(inventoryDialog.open, true, "Add Presets may open after a failed refresh to show the truthful error");
        assert.equal(compactStatus.textContent, "Could not refresh Lightroom presets. Please try again.");
        assert.equal(containsText(host, "missing UUID"), false,
            "A failed first refresh must not turn unproven configured UUIDs into missing UUIDs");
        assert.deepEqual(controller.getDraft(), webController.createDraft(savedPresets),
            "Failed initial inventory acquisition must preserve UUIDs, aliases, order, and AI settings");
        assert.equal(saveButton.disabled, true, "A failed inventory refresh must not dirty configuration");
        await findByText(inventoryDialog, "Cancel").dispatch("click");

        let aliasInput = findByAttribute(host, "aria-label", "Optional alias for uuid-delayed");
        aliasInput.value = "Unsaved Draft Alias";
        aliasInput.selectionStart = 7;
        aliasInput.selectionEnd = 12;
        aliasInput.focus();
        await aliasInput.dispatch("input");
        assert.equal(saveButton.disabled, false, "Only the genuine Alias draft edit may enable Save Changes");

        const successfulRefresh = deferredRefresh();
        refreshResponses.push(successfulRefresh);
        const manualSuccess = refreshButton.dispatch("click");
        await flushAsync();
        assert.equal(inventoryRefreshCount, 2, "Refresh Presets must start one manual authoritative refresh");
        assert.equal(compactStatus.textContent, "Finding Lightroom presets…");
        inventory = [
            { uuid: "uuid-delayed", folder: "User Presets", name: "Resolved Name" },
            { uuid: "uuid-extra", folder: "User Presets", name: "Extra" }
        ];
        inventoryStatus = "ready";
        inventoryError = null;
        inventoryLoaded = true;
        inventoryRefreshedAt = 1000;
        successfulRefresh.resolveState();
        await manualSuccess;
        aliasInput = findByAttribute(host, "aria-label", "Optional alias for User Presets — Resolved Name");
        assert.equal(aliasInput.value, "Unsaved Draft Alias");
        assert.equal(document.activeElement, aliasInput, "Inventory resolution must restore Alias editing focus");
        assert.equal(aliasInput.selectionStart, 7);
        assert.equal(aliasInput.selectionEnd, 12);
        assert.deepEqual(controller.getDraft(), [
            { uuid: "uuid-delayed", alias: "Unsaved Draft Alias", updateAISettings: true, amountEnabled: false },
            { uuid: "uuid-second", alias: "", updateAISettings: false, amountEnabled: false }
        ]);
        assert.equal(findByClass(findByDataUuid(configuredList, "uuid-delayed"), "preset").children[1].textContent,
            "Resolved Name", "A delayed successful inventory must resolve the saved UUID without rebuilding identity");
        assert.equal(containsText(host, "uuid-delayed (missing UUID)"), false);
        assert.equal(saveButton.disabled, false, "Inventory success must preserve the genuine draft-dirty state");
        assert.equal(controller.getState().cursorUuid, cursorUuid);
        assert.equal(controller.getState().presetAmount, presetAmount);

        const retainedInventory = JSON.parse(JSON.stringify(inventory));
        const failedRefresh = deferredRefresh();
        refreshResponses.push(failedRefresh);
        const manualFailure = refreshButton.dispatch("click");
        await flushAsync();
        assert.equal(compactStatus.textContent, "Refreshing Lightroom presets…");
        inventoryStatus = "error";
        inventoryError = "Second Lightroom inventory probe failed";
        failedRefresh.resolveState();
        await manualFailure;
        assert.deepEqual(controller.getState().inventory, retainedInventory,
            "A failed refresh after success must retain the previous authoritative snapshot");
        assert.equal(compactStatus.textContent, "Could not refresh Lightroom presets. Please try again.");
        assert.equal(findByClass(findByDataUuid(configuredList, "uuid-delayed"), "preset").children[1].textContent,
            "Resolved Name");
        assert.equal(saveButton.disabled, false);
        assert.equal(controller.getState().cursorUuid, cursorUuid);
        assert.equal(controller.getState().presetAmount, presetAmount);
        assert.equal(configurationSaveCount, 0, "Inventory lifecycle operations must never save configuration");
        assert.equal(applicationCount, 0, "Inventory lifecycle operations must never apply or reapply a preset");

        controller.deactivate();
        controller.activate(host);
        await flushAsync();
        assert.equal(inventoryRefreshCount, 3,
            "Reactivating Presets must not auto-refresh again while the same process has a successful snapshot");
        controller.deactivate();

        inventory = [];
        inventoryStatus = "not-loaded";
        inventoryError = null;
        inventoryLoaded = false;
        inventoryRefreshedAt = null;
        serverEpoch = "inventory-epoch-two";
        stateRevision = 1;
        amountFeedbackId = 1;
        const nextProcessRefresh = deferredRefresh();
        refreshResponses.push(nextProcessRefresh);
        controller.activate(host);
        await flushAsync();
        assert.equal(inventoryRefreshCount, 4,
            "A new server process's not-loaded state must trigger one new automatic inventory request");
        inventory = retainedInventory;
        inventoryStatus = "ready";
        inventoryLoaded = true;
        inventoryRefreshedAt = 2000;
        nextProcessRefresh.resolveState();
        await flushAsync();
        assert.equal(configurationSaveCount, 0);
        assert.equal(applicationCount, 0);
    } finally {
        controller.deactivate();
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
}

async function webControllerAmountAdversarialTest() {
    let serverEpoch = "amount-epoch-one";
    const configuredEntries = [
        {
            uuid: "uuid-serial",
            alias: null,
            updateAISettings: false,
            amountEnabled: true,
            folder: "Test",
            name: "Serial",
            available: true,
            missing: false,
            error: null
        },
        {
            uuid: "uuid-second",
            alias: null,
            updateAISettings: false,
            amountEnabled: true,
            folder: "Test",
            name: "Second",
            available: true,
            missing: false,
            error: null
        }
    ];
    let cursorUuid = "uuid-serial";
    let presetAmount = 100;
    let pendingOperation = null;
    let lastApplication = null;
    let stateRevision = 10;
    let amountRevision = 10;
    let operationCounter = 0;
    let delayNextAdmission = false;
    const delayedAdmissions = [];
    const queuedSnapshots = [];
    const submittedAmounts = [];
    const submittedBindings = [];
    const statusMessages = [];
    let currentContext = {
        activeModule: "develop",
        selectedPhotoUuid: "photo-one",
        contextCounter: 1,
        developCounter: 1,
        contextChangedAt: 1000
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function publicState() {
        return {
            ok: true,
            serverEpoch: serverEpoch,
            stateRevision: stateRevision,
            amountRevision: amountRevision,
            configuration: {
                version: 1,
                presets: configuredEntries.map(function (entry) {
                    return {
                        uuid: entry.uuid,
                        updateAISettings: entry.updateAISettings,
                        amountEnabled: entry.amountEnabled
                    };
                })
            },
            configurationError: null,
            inventory: configuredEntries.map(function (entry) {
                return { uuid: entry.uuid, folder: entry.folder, name: entry.name };
            }),
            inventoryStatus: "ready",
            inventoryError: null,
            inventoryRefreshedAt: 1,
            inventoryLoaded: true,
            inventoryRequestId: null,
            configured: configuredEntries.map(function (entry) { return Object.assign({}, entry); }),
            availableCount: configuredEntries.length,
            cursorUuid: cursorUuid,
            presetAmount: presetAmount,
            controlsEnabled: true,
            pendingApplication: pendingOperation !== null,
            pendingOperation: pendingOperation ? Object.assign({}, pendingOperation) : null,
            lastApplication: lastApplication ? Object.assign({}, lastApplication) : null
        };
    }

    function operationFromUrl(parsed, amount) {
        operationCounter += 1;
        return {
            operationId: "serial-" + operationCounter,
            operationKind: "amount",
            uuid: cursorUuid,
            presetAmount: amount,
            updateAISettings: false,
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: parsed.searchParams.get("selectedPhotoUuid"),
            expectedContextCounter: Number(parsed.searchParams.get("contextCounter")),
            expectedDevelopCounter: Number(parsed.searchParams.get("developCounter")),
            expectedContextChangedAt: Number(parsed.searchParams.get("contextChangedAt")),
            expectedServerEpoch: parsed.searchParams.get("serverEpoch")
        };
    }

    async function fakeFetch(url) {
        if (url === "/api/develop-presets/state") {
            let snapshot = queuedSnapshots.length > 0 ? queuedSnapshots.shift() : publicState();
            if (snapshot && typeof snapshot.then === "function") snapshot = await snapshot;
            return { ok: true, async json() { return clone(snapshot); } };
        }
        if (url.startsWith("/api/develop-presets/amount?")) {
            assert.equal(pendingOperation, null, "The client must never submit two preset applications concurrently");
            const parsed = new URL(url, "http://127.0.0.1");
            assert.equal(parsed.searchParams.get("serverEpoch"), serverEpoch);
            const amount = Number(parsed.searchParams.get("presetAmount"));
            pendingOperation = operationFromUrl(parsed, amount);
            submittedBindings.push({
                selectedPhotoUuid: pendingOperation.expectedSelectedPhotoUuid,
                contextCounter: pendingOperation.expectedContextCounter,
                developCounter: pendingOperation.expectedDevelopCounter,
                contextChangedAt: pendingOperation.expectedContextChangedAt
            });
            lastApplication = Object.assign({ outcome: null, detail: "Waiting for Lightroom." }, pendingOperation);
            stateRevision += 1;
            amountRevision += 1;
            submittedAmounts.push(amount);
            const responseBody = {
                ok: true,
                operationId: pendingOperation.operationId,
                operationKind: "amount",
                uuid: pendingOperation.uuid,
                presetAmount: pendingOperation.presetAmount,
                serverEpoch: serverEpoch,
                stateRevision: stateRevision,
                amountRevision: amountRevision,
                expectedSelectedPhotoUuid: pendingOperation.expectedSelectedPhotoUuid,
                expectedContextCounter: pendingOperation.expectedContextCounter,
                expectedDevelopCounter: pendingOperation.expectedDevelopCounter,
                expectedContextChangedAt: pendingOperation.expectedContextChangedAt
            };
            if (delayNextAdmission) {
                delayNextAdmission = false;
                await new Promise(function (resolve) { delayedAdmissions.push(resolve); });
            }
            return { ok: true, async json() { return clone(responseBody); } };
        }
        throw new Error("Unexpected adversarial Amount request: " + url);
    }

    function finishPending(outcome, detail) {
        assert.ok(pendingOperation);
        const completed = pendingOperation;
        if (outcome === presetDefinition.OUTCOME_OBSERVED || outcome === presetDefinition.OUTCOME_NO_CHANGE) {
            presetAmount = completed.presetAmount;
        }
        lastApplication = Object.assign({}, completed, {
            outcome: outcome,
            detail: detail || "adversarial test result"
        });
        pendingOperation = null;
        stateRevision += 1;
        amountRevision += 1;
        if (outcome === presetDefinition.OUTCOME_OBSERVED) {
            currentContext = Object.assign({}, currentContext, {
                developCounter: currentContext.developCounter + 1
            });
            controller.updateContext();
        }
        Object.assign(lastApplication, {
            settledActiveModule: currentContext.activeModule,
            settledSelectedPhotoUuid: currentContext.selectedPhotoUuid,
            settledContextCounter: currentContext.contextCounter,
            settledDevelopCounter: currentContext.developCounter,
            settledContextChangedAt: currentContext.contextChangedAt
        });
        return clone(publicState());
    }

    function flushAsync() {
        return new Promise(function (resolve) {
            setImmediate(function () { setImmediate(resolve); });
        });
    }

    function compactAmountState(controller) {
        const amountState = controller.getAmountState();
        return {
            committed: amountState.committed,
            desired: amountState.desired,
            submitted: amountState.submitted,
            queued: amountState.queued
        };
    }

    const document = new FakeDocument();
    const host = document.createElement("div");
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    global.setInterval = function (listener, milliseconds) {
        return { listener: listener, milliseconds: milliseconds, active: true };
    };
    global.clearInterval = function (handle) {
        if (handle) handle.active = false;
    };
    const controller = webController.createController({
        document: document,
        fetch: fakeFetch,
        getContext: function () { return Object.assign({}, currentContext); },
        setStatus: function (message) { statusMessages.push(message); }
    });

    try {
        controller.activate(host);
        await controller.refresh();
        const amountRange = findByAttribute(host, "aria-label", "Preset Amount");
        const incrementAmount = findByAttribute(host, "aria-label", "Increase Preset Amount");
        const decrementAmount = findByAttribute(host, "aria-label", "Decrease Preset Amount");
        const resetAmount = findByText(host, "Reset");
        const capabilityNote = findByClass(host, "develop-preset-amount-capability-note");
        assert.equal(amountRange.value, "100");
        assert.equal(capabilityNote.textContent, "Adjust the strength of this preset.");

        const preAdmissionSnapshot = clone(publicState());
        delayNextAdmission = true;
        for (let tap = 0; tap < 5; tap += 1) await incrementAmount.dispatch("click");
        await flushAsync();
        assert.deepEqual(submittedAmounts, [101]);
        assert.equal(amountRange.value, "105", "Five rapid taps must continuously render newest desired intent");
        queuedSnapshots.push(preAdmissionSnapshot);
        await controller.refresh();
        assert.equal(amountRange.value, "105",
            "A poll received before delayed POST admission returns must not roll desired intent backward");
        assert.deepEqual(compactAmountState(controller), {
            committed: 100, desired: 105, submitted: 101, queued: 105
        });

        delayedAdmissions.shift()();
        await flushAsync();
        const admittedA = Object.assign({}, pendingOperation);
        const wrongSameValue = clone(publicState());
        wrongSameValue.stateRevision += 1;
        wrongSameValue.amountRevision += 1;
        wrongSameValue.pendingApplication = false;
        wrongSameValue.pendingOperation = null;
        wrongSameValue.presetAmount = 101;
        wrongSameValue.lastApplication = Object.assign({}, admittedA, {
            operationId: "wrong-same-value",
            outcome: presetDefinition.OUTCOME_OBSERVED,
            detail: "wrong operation"
        });
        stateRevision = wrongSameValue.stateRevision;
        amountRevision = wrongSameValue.amountRevision;
        queuedSnapshots.push(wrongSameValue);
        await controller.refresh();
        assert.equal(amountRange.value, "105");
        assert.equal(controller.getAmountState().submittedOperationId, admittedA.operationId,
            "Same Amount with the wrong operation ID must remain inert");

        const completedASnapshot = finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await flushAsync();
        assert.deepEqual(submittedAmounts, [101, 105],
            "Five rapid + taps must submit only 101 followed by 105");
        assert.equal(amountRange.value, "105");
        assert.deepEqual(compactAmountState(controller), {
            committed: 101, desired: 105, submitted: 105, queued: null
        });

        queuedSnapshots.push(completedASnapshot);
        await controller.refresh();
        assert.deepEqual(compactAmountState(controller), {
            committed: 101, desired: 105, submitted: 105, queued: null
        }, "Old A completion arriving after B begins must be rejected by revision and exact identity");

        finishPending(presetDefinition.OUTCOME_NO_CHANGE);
        await controller.refresh();
        assert.deepEqual(compactAmountState(controller), {
            committed: 105, desired: 105, submitted: null, queued: null
        });

        amountRange.dispatch("pointerdown", { pointerType: "mouse" });
        amountRange.value = "120";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        amountRange.value = "128";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await flushAsync();
        assert.equal(submittedAmounts.at(-1), 128,
            "Quick drag/release must flush the exact final release value");
        assert.equal(amountRange.value, "128");
        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();

        await incrementAmount.dispatch("click");
        await resetAmount.dispatch("click");
        await flushAsync();
        assert.equal(submittedAmounts.at(-1), 129);
        assert.equal(amountRange.value, "100", "Reset during flight must become newest desired intent");
        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await flushAsync();
        assert.equal(submittedAmounts.at(-1), 100,
            "Reset during flight must coalesce behind the exact submitted operation");
        finishPending(presetDefinition.OUTCOME_NO_CHANGE);
        await controller.refresh();

        const renderedDragSubmissionStart = submittedAmounts.length;
        const renderedDragDevelopCounter = currentContext.developCounter;
        delayNextAdmission = true;
        await amountRange.dispatch("pointerdown", { pointerType: "mouse" });
        amountRange.value = "98";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        await new Promise(function (resolve) { setTimeout(resolve, 140); });
        await flushAsync();
        assert.deepEqual(submittedAmounts.slice(renderedDragSubmissionStart), [98],
            "The first rendered drag intermediate must enter delayed POST admission alone");
        const delayedIntermediateSnapshot = clone(publicState());
        let releaseDelayedIntermediatePoll;
        queuedSnapshots.push(new Promise(function (resolve) { releaseDelayedIntermediatePoll = resolve; }));
        const delayedIntermediatePoll = controller.refresh();

        for (const renderedValue of [112, 121, 137, 149, 154, 159]) {
            amountRange.value = String(renderedValue);
            await amountRange.dispatch("input", { pointerType: "mouse" });
        }
        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await amountRange.dispatch("change", { pointerType: "mouse" });
        assert.equal(amountRange.value, "159",
            "The rendered pointer-release/change value must remain authoritative during delayed admission");
        assert.deepEqual(submittedAmounts.slice(renderedDragSubmissionStart), [98],
            "Rendered intermediates and release must wait behind the one admitted operation");

        delayedAdmissions.shift()();
        await flushAsync();
        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await flushAsync();
        assert.deepEqual(submittedAmounts.slice(renderedDragSubmissionStart), [98, 159],
            "Own Develop revision advance must rebind the chain and submit the exact rendered release value");
        assert.equal(submittedBindings.at(-1).developCounter, renderedDragDevelopCounter + 1,
            "The post-intermediate Amount request must use the observed authoritative Develop revision");
        assert.equal(amountRange.value, "159",
            "The successful intermediate must not roll back a newer rendered pointer-release value");

        releaseDelayedIntermediatePoll(delayedIntermediateSnapshot);
        await delayedIntermediatePoll;
        assert.equal(amountRange.value, "159",
            "A delayed older pending snapshot must not overwrite the rendered release value");
        assert.equal(controller.getAmountState().submitted, 159);
        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        assert.equal(amountRange.value, "159");
        assert.deepEqual(compactAmountState(controller), {
            committed: 159, desired: 159, submitted: null, queued: null
        });

        const sameValueReleaseStart = submittedAmounts.length;
        delayNextAdmission = true;
        await amountRange.dispatch("pointerdown", { pointerType: "mouse" });
        amountRange.value = "160";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        await new Promise(function (resolve) { setTimeout(resolve, 140); });
        await flushAsync();
        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await amountRange.dispatch("change", { pointerType: "mouse" });
        assert.deepEqual(submittedAmounts.slice(sameValueReleaseStart), [160]);
        assert.equal(controller.getAmountState().queued, 160,
            "Pointer release must record a newer intent even when its value equals the submitted intermediate");
        delayedAdmissions.shift()();
        await flushAsync();
        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await flushAsync();
        assert.deepEqual(submittedAmounts.slice(sameValueReleaseStart), [160, 160],
            "A same-value pointer release must still submit after the current in-flight intermediate");
        finishPending(presetDefinition.OUTCOME_NO_CHANGE);
        await controller.refresh();
        assert.deepEqual(compactAmountState(controller), {
            committed: 160, desired: 160, submitted: null, queued: null
        });

        await incrementAmount.dispatch("click");
        await flushAsync();
        const stalePresetOperation = Object.assign({}, pendingOperation);
        cursorUuid = "uuid-second";
        presetAmount = 100;
        pendingOperation = null;
        lastApplication = {
            operationId: "preset-switch",
            operationKind: "preset",
            uuid: cursorUuid,
            outcome: presetDefinition.OUTCOME_NO_CHANGE,
            detail: "preset switched"
        };
        stateRevision += 1;
        amountRevision += 1;
        await controller.refresh();
        assert.equal(amountRange.value, "100", "Preset switch must invalidate the older Amount chain");
        lastApplication = Object.assign({}, stalePresetOperation, {
            outcome: presetDefinition.OUTCOME_OBSERVED,
            detail: "late old-preset completion"
        });
        stateRevision += 1;
        amountRevision += 1;
        await controller.refresh();
        assert.equal(amountRange.value, "100", "Late old-preset completion must not affect the new cursor");

        await incrementAmount.dispatch("click");
        await flushAsync();
        const staleContextOperation = Object.assign({}, pendingOperation);
        currentContext = {
            activeModule: "develop",
            selectedPhotoUuid: "photo-two",
            contextCounter: 2,
            developCounter: 2,
            contextChangedAt: 2000
        };
        controller.updateContext();
        pendingOperation = null;
        lastApplication = Object.assign({}, staleContextOperation, {
            outcome: presetDefinition.OUTCOME_STALE,
            detail: "photo changed"
        });
        stateRevision += 1;
        amountRevision += 1;
        await controller.refresh();
        assert.equal(amountRange.value, "100", "Photo/context change must invalidate incompatible queued work");

        await incrementAmount.dispatch("click");
        await flushAsync();
        finishPending(presetDefinition.OUTCOME_FAILED, "Exact Lightroom Amount failure");
        await controller.refresh();
        assert.equal(amountRange.value, "100", "Failure must restore the last committed Amount");
        assert.equal(statusMessages.at(-1), "ERROR: Could not update Amount. Please try again.");

        configuredEntries[1].amountEnabled = false;
        stateRevision += 1;
        amountRevision += 1;
        await controller.refresh();
        assert.equal(amountRange.disabled, true);
        assert.equal(incrementAmount.disabled, true);
        assert.equal(resetAmount.disabled, true);
        assert.equal(renderedText(capabilityNote),
            "Amount slider unavailable: Make sure it is enabled under Preset Options. If enabled, Lightroom Classic does not support it for this preset.");

        const staleOldEpoch = clone(publicState());
        let releaseOldEpoch;
        queuedSnapshots.push(new Promise(function (resolve) { releaseOldEpoch = resolve; }));
        const delayedOldEpochRefresh = controller.refresh();
        serverEpoch = "amount-epoch-two";
        stateRevision = 1;
        amountRevision = 1;
        pendingOperation = null;
        lastApplication = null;
        await controller.refresh();
        assert.equal(controller.getState().serverEpoch, "amount-epoch-two");
        releaseOldEpoch(staleOldEpoch);
        await delayedOldEpochRefresh;
        assert.equal(controller.getState().serverEpoch, "amount-epoch-two",
            "A delayed response from an older server epoch must not replace the newer process state");
        assert.equal(amountRange.value, "100");
    } finally {
        controller.deactivate();
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
}

async function webControllerNativePresetAmountTest() {
    const configuredEntry = {
        uuid: "uuid-native",
        alias: null,
        updateAISettings: false,
        amountEnabled: true,
        folder: "Test",
        name: "Native Amount",
        available: true,
        missing: false,
        error: null
    };
    const serverEpoch = "native-amount-epoch";
    let presetAmount = 100;
    let amountFeedbackId = 1;
    let issuedFeedbackId = 1;
    let serverFeedbackId = 1;
    let advanceServerFeedbackAtNextAdmission = 0;
    let serverDevelopCounter = 11;
    const submittedAmounts = [];
    const submittedCommands = [];
    const pendingSdkWrites = [];
    const sdkWrites = [];
    const queuedStateSnapshots = [];
    let currentContext = {
        activeModule: "develop",
        selectedPhotoUuid: "photo-native",
        contextCounter: 7,
        developCounter: 11,
        contextChangedAt: 7000
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function publicState() {
        return {
            ok: true,
            serverEpoch: serverEpoch,
            stateRevision: 3,
            configuration: {
                version: 1,
                presets: [{
                    uuid: configuredEntry.uuid,
                    updateAISettings: false,
                    amountEnabled: configuredEntry.amountEnabled
                }]
            },
            configurationError: null,
            inventory: [{ uuid: configuredEntry.uuid, folder: configuredEntry.folder, name: configuredEntry.name }],
            inventoryStatus: "ready",
            inventoryError: null,
            inventoryRefreshedAt: 1,
            inventoryLoaded: true,
            inventoryRequestId: null,
            configured: [Object.assign({}, configuredEntry)],
            availableCount: 1,
            cursorUuid: configuredEntry.uuid,
            cursorAmountEnabled: configuredEntry.amountEnabled,
            presetAmount: presetAmount,
            amountFeedback: {
                id: amountFeedbackId,
                available: true,
                value: presetAmount,
                range: { min: 0, max: 200 },
                receivedAt: 7000 + amountFeedbackId
            },
            controlsEnabled: true,
            pendingApplication: false,
            pendingOperation: null,
            lastApplication: null
        };
    }

    function amountResponse(parsed, amount) {
        if (advanceServerFeedbackAtNextAdmission > 0) {
            issuedFeedbackId += advanceServerFeedbackAtNextAdmission;
            serverFeedbackId = issuedFeedbackId;
            advanceServerFeedbackAtNextAdmission = 0;
        }
        const browserFeedbackId = Number(parsed.searchParams.get("feedbackId"));
        issuedFeedbackId += 1;
        const command = {
            command: "develop_preset.amount.set",
            presetAmount: amount,
            expectedPresetUuid: configuredEntry.uuid,
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: parsed.searchParams.get("selectedPhotoUuid"),
            expectedContextCounter: Number(parsed.searchParams.get("contextCounter")),
            expectedDevelopCounter: serverDevelopCounter,
            expectedContextChangedAt: Number(parsed.searchParams.get("contextChangedAt")),
            expectedServerEpoch: parsed.searchParams.get("serverEpoch"),
            expectedFeedbackId: serverFeedbackId
        };
        assert.ok(command.expectedFeedbackId >= browserFeedbackId,
            "Server admission may only move a same-context feedback binding forward");
        submittedCommands.push(clone(command));
        pendingSdkWrites.push({ command: clone(command), feedbackRequestId: issuedFeedbackId });
        return {
            ok: true,
            queued: command,
            coalesced: false,
            feedbackRequestId: issuedFeedbackId
        };
    }

    async function fakeFetch(url) {
        if (url === "/api/develop-presets/state") {
            let snapshot = queuedStateSnapshots.length > 0 ? queuedStateSnapshots.shift() : publicState();
            if (snapshot && typeof snapshot.then === "function") snapshot = await snapshot;
            snapshot = clone(snapshot);
            return { ok: true, async json() { return snapshot; } };
        }
        if (!url.startsWith("/api/develop-presets/amount?")) {
            throw new Error("Unexpected native Amount request: " + url);
        }
        const parsed = new URL(url, "http://127.0.0.1");
        const amount = Number(parsed.searchParams.get("presetAmount"));
        assert.equal(Number(parsed.searchParams.get("feedbackId")), amountFeedbackId,
            "Each native write must bind to the latest authoritative feedback snapshot");
        submittedAmounts.push(amount);
        const responseBody = amountResponse(parsed, amount);
        return { ok: true, async json() { return clone(responseBody); } };
    }

    function publishFeedback(value, id) {
        presetAmount = value;
        if (id === undefined) {
            issuedFeedbackId += 1;
            amountFeedbackId = issuedFeedbackId;
        } else {
            amountFeedbackId = id;
        }
        serverFeedbackId = Math.max(serverFeedbackId, amountFeedbackId);
    }

    function executeNextNativeWrite() {
        const pending = pendingSdkWrites.shift();
        assert.ok(pending, "Expected one queued SDK PresetAmount write");
        const before = presetAmount;
        presetAmount = pending.command.presetAmount;
        const immediate = presetAmount;
        sdkWrites.push({
            parameter: "PresetAmount",
            value: pending.command.presetAmount,
            before: before,
            immediate: immediate,
            command: clone(pending.command)
        });
        serverDevelopCounter += 1;
        issuedFeedbackId += 1;
        amountFeedbackId = issuedFeedbackId;
        serverFeedbackId = amountFeedbackId;
        return pending;
    }

    function flushAsync() {
        return new Promise(function (resolve) {
            setImmediate(function () { setImmediate(resolve); });
        });
    }

    const document = new FakeDocument();
    const host = document.createElement("div");
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    global.setInterval = function (listener, milliseconds) {
        return { listener: listener, milliseconds: milliseconds, active: true };
    };
    global.clearInterval = function (handle) {
        if (handle) handle.active = false;
    };
    const controller = webController.createController({
        document: document,
        fetch: fakeFetch,
        getContext: function () { return Object.assign({}, currentContext); }
    });

    try {
        controller.activate(host);
        await controller.refresh();
        const amountRange = findByAttribute(host, "aria-label", "Preset Amount");
        const incrementAmount = findByAttribute(host, "aria-label", "Increase Preset Amount");
        const decrementAmount = findByAttribute(host, "aria-label", "Decrease Preset Amount");
        const capabilityNote = findByClass(host, "develop-preset-amount-capability-note");
        assert.equal(amountRange.value, "100");
        assert.equal(amountRange.disabled, false);
        assert.equal(capabilityNote.textContent,
            "Adjust the strength of this preset.");

        publishFeedback(159);
        serverDevelopCounter += 1;
        currentContext = Object.assign({}, currentContext, { developCounter: serverDevelopCounter });
        await controller.refresh();
        assert.equal(amountRange.value, "159",
            "Authoritative Lightroom feedback must update the Web Controller while idle");

        advanceServerFeedbackAtNextAdmission = 2;
        await amountRange.dispatch("pointerdown", { pointerType: "mouse" });
        amountRange.value = "150";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        await new Promise(function (resolve) { setTimeout(resolve, 140); });
        await flushAsync();
        assert.deepEqual(submittedAmounts, [150],
            "A held drag must submit throttled intermediate values through the normal parameter path");
        assert.equal(pendingSdkWrites.length, 1);
        assert.ok(submittedCommands[0].expectedFeedbackId > amountFeedbackId,
            "A harmlessly newer same-context server feedback ID must rebind rather than reject browser intent");
        assert.equal(amountRange.value, "150",
            "Delayed native execution must not let the older authoritative sample roll back rendered intent");

        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await amountRange.dispatch("change", { pointerType: "mouse" });
        await flushAsync();
        assert.deepEqual(submittedAmounts, [150],
            "Pointerup/change for the active value must not duplicate its native write");

        const preWriteFeedbackId = pendingSdkWrites[0].feedbackRequestId;
        publishFeedback(159, preWriteFeedbackId);
        await controller.refresh();
        assert.equal(amountRange.value, "150",
            "A post-admission feedback request sampled before setValue must not own the UI");
        executeNextNativeWrite();
        await controller.refresh();
        assert.deepEqual(sdkWrites.map(function (write) {
            return [write.parameter, write.value, write.before, write.immediate];
        }), [["PresetAmount", 150, 159, 150]],
        "The exact SDK sequence must be getValue, one setValue target, then immediate getValue readback");
        assert.equal(amountRange.value, "150");
        assert.equal(controller.getAmountState().committed, 150);

        const outOfOrderSnapshot = clone(publicState());
        outOfOrderSnapshot.amountFeedback.id = preWriteFeedbackId;
        outOfOrderSnapshot.amountFeedback.value = 159;
        outOfOrderSnapshot.presetAmount = 159;
        queuedStateSnapshots.push(outOfOrderSnapshot);
        await controller.refresh();
        assert.equal(amountRange.value, "150",
            "A lower-ID feedback sample arriving after settlement must not roll back the rendered DOM");
        assert.equal(controller.getAmountState().committed, 150);

        await amountRange.dispatch("pointerdown", { pointerType: "mouse" });
        amountRange.value = "140";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await flushAsync();
        amountRange.value = "145";
        await amountRange.dispatch("input", { pointerType: "mouse" });
        await amountRange.dispatch("pointerup", { pointerType: "mouse" });
        await flushAsync();
        assert.deepEqual(submittedAmounts, [150, 140]);
        assert.equal(amountRange.value, "145",
            "A newer desired value must retain DOM ownership while the earlier write settles");
        executeNextNativeWrite();
        await controller.refresh();
        await flushAsync();
        assert.deepEqual(submittedAmounts, [150, 140, 145],
            "After authoritative settlement, only the newest queued intent may become the next HTTP command");
        assert.ok(submittedCommands[2].expectedDevelopCounter > currentContext.developCounter,
            "The server must rebind a newer intent to its current Develop revision when browser context lags");
        executeNextNativeWrite();
        await controller.refresh();
        await flushAsync();
        assert.equal(amountRange.value, "145");
        assert.equal(controller.getAmountState().committed, 145);

        currentContext = Object.assign({}, currentContext, { developCounter: serverDevelopCounter });
        for (let tap = 0; tap < 5; tap += 1) await incrementAmount.dispatch("click");
        await flushAsync();
        assert.deepEqual(submittedAmounts, [150, 140, 145, 146]);
        assert.equal(amountRange.value, "150", "Rapid taps must render the accumulated local target");
        executeNextNativeWrite();
        await controller.refresh();
        await flushAsync();
        assert.deepEqual(submittedAmounts, [150, 140, 145, 146, 150],
            "Rapid taps must retain only the latest value behind the settling native write");
        executeNextNativeWrite();
        await controller.refresh();
        await flushAsync();
        assert.equal(amountRange.value, "150");
        assert.equal(controller.getAmountState().committed, 150);

        currentContext = Object.assign({}, currentContext, { developCounter: serverDevelopCounter });
        for (let tap = 0; tap < 5; tap += 1) await decrementAmount.dispatch("click");
        await flushAsync();
        assert.equal(submittedAmounts.at(-1), 149);
        assert.equal(amountRange.value, "145");
        executeNextNativeWrite();
        await controller.refresh();
        await flushAsync();
        assert.equal(submittedAmounts.at(-1), 145);
        executeNextNativeWrite();
        await controller.refresh();
        await flushAsync();
        assert.equal(amountRange.value, "145",
            "Five rapid minus presses must settle on the exact accumulated authoritative value");
        assert.equal(controller.getAmountState().committed, 145);

        publishFeedback(88);
        serverDevelopCounter += 1;
        currentContext = Object.assign({}, currentContext, { developCounter: serverDevelopCounter });
        await controller.refresh();
        assert.equal(amountRange.value, "88",
            "A later Lightroom-native observer result must remain authoritative");

        configuredEntry.amountEnabled = false;
        await controller.refresh();
        assert.equal(amountRange.disabled, true, "Per-preset Amount opt-in must remain an explicit guard");
        assert.equal(renderedText(capabilityNote),
            "Amount slider unavailable: Make sure it is enabled under Preset Options. If enabled, Lightroom Classic does not support it for this preset.");
    } finally {
        controller.deactivate();
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
}

function configurationAndOrderingTests() {
    assert.equal(webController.parsePresetAmount("0"), 0);
    assert.equal(webController.parsePresetAmount("100"), 100);
    assert.equal(webController.parsePresetAmount("200"), 200);
    for (const invalid of ["", " 100", "100 ", "1.5", "-1", "201", "NaN"]) {
        assert.equal(webController.parsePresetAmount(invalid), null);
    }
    const configPath = path.join(temporaryRoot, "pure", "develop-presets.json");
    const state = presetDefinition.createDevelopPresetState({ configPath: configPath });
    const initialRevisionState = state.getPublicState();
    assert.ok(Number.isSafeInteger(initialRevisionState.stateRevision));
    assert.equal(Object.prototype.hasOwnProperty.call(initialRevisionState, "amountRevision"), false,
        "Preset state must not retain the obsolete Amount application revision");
    assert.deepEqual(presetDefinition.normalizeConfiguration({ version: 1, presets: [{ uuid: "default-ai" }] }), {
        version: 1, presets: [{ uuid: "default-ai", updateAISettings: false, amountEnabled: false }]
    }, "Update AI and user-controlled Amount capability must default to false");
    assert.throws(function () {
        presetDefinition.normalizeConfiguration({
            version: 1,
            presets: [{ uuid: "bad-amount-capability", amountEnabled: "true" }]
        });
    }, /amountEnabled must be boolean/);
    const requestId = state.beginInventoryRefresh();
    const loadingRevisionState = state.getPublicState();
    assert.ok(loadingRevisionState.stateRevision > initialRevisionState.stateRevision);
    state.acceptInventoryItem(requestId, { uuid: "uuid-z", folder: "Z Folder", name: "Duplicate" });
    state.acceptInventoryItem(requestId, { uuid: "uuid-a", folder: "A Folder", name: "Duplicate" });
    state.acceptInventoryItem(requestId, { uuid: "uuid-b", folder: "B Folder", name: "Another" });
    assert.equal(state.completeInventoryRefresh(requestId), true);
    const completedRevisionState = state.getPublicState();
    assert.ok(completedRevisionState.stateRevision > loadingRevisionState.stateRevision);
    assert.deepEqual(completedRevisionState.inventory.map(function (entry) { return entry.uuid; }),
        ["uuid-a", "uuid-b", "uuid-z"], "Inventory must sort deterministically by folder, name, then UUID");

    let draft = webController.createDraft([]);
    assert.equal(webController.addDraftEntry(draft, "uuid-z"), true);
    assert.equal(webController.addDraftEntry(draft, "missing-uuid"), true);
    assert.equal(webController.addDraftEntry(draft, "uuid-a"), true);
    assert.equal(webController.addDraftEntry(draft, "uuid-z"), false,
        "UUID identity must reject duplicates regardless of labels");
    assert.equal(webController.moveDraftEntry(draft, 2, -1), true);
    assert.equal(webController.removeDraftEntry(draft, 0), true);
    draft[0].alias = "  Portrait  ";
    draft[0].updateAISettings = true;
    draft[0].amountEnabled = true;
    const saved = webController.configurationFromDraft(draft);
    assert.deepEqual(saved, {
        version: 1,
        presets: [
            { uuid: "uuid-a", updateAISettings: true, amountEnabled: true, alias: "Portrait" },
            { uuid: "missing-uuid", updateAISettings: false, amountEnabled: false }
        ]
    });
    state.saveConfiguration(saved);
    const loaded = presetDefinition.createDevelopPresetState({ configPath: configPath });
    let notLoadedState = loaded.getPublicState();
    assert.deepEqual(notLoadedState.configuration, saved, "Save/load must preserve explicit configured order");
    assert.equal(notLoadedState.inventoryStatus, "not-loaded");
    assert.equal(notLoadedState.inventoryLoaded, false);
    assert.deepEqual(notLoadedState.configuration.presets, saved.presets,
        "A new process must preserve the complete configured UUID/alias/order/AI payload before inventory loads");
    assert.equal(notLoadedState.configured[0].missing, false);
    assert.equal(notLoadedState.configured[1].missing, false);
    assert.equal(notLoadedState.configured[0].error, null);
    assert.equal(notLoadedState.configured[1].error, null,
        "No configured UUID may be classified as missing without a successful current-process snapshot");
    const failedFirstRequest = loaded.beginInventoryRefresh();
    assert.equal(loaded.getPublicState().inventoryStatus, "loading");
    assert.equal(loaded.getPublicState().configured[1].missing, false);
    loaded.failInventoryRefresh(failedFirstRequest, "Initial Lightroom inventory failed");
    notLoadedState = loaded.getPublicState();
    assert.equal(notLoadedState.inventoryStatus, "error");
    assert.equal(notLoadedState.inventoryLoaded, false);
    assert.equal(notLoadedState.configured[1].missing, false);
    assert.equal(notLoadedState.configured[1].error, null);
    assert.deepEqual(notLoadedState.configuration.presets, saved.presets,
        "A failed first inventory request must preserve all configured values");
    assert.equal(fs.readFileSync(configPath, "utf8").includes("Z Folder"), false,
        "Generated configuration must persist UUID/options, not mutable display labels");

    const secondRequest = state.beginInventoryRefresh();
    state.acceptInventoryItem(secondRequest, { uuid: "uuid-a", folder: "A Folder", name: "Duplicate" });
    state.completeInventoryRefresh(secondRequest);
    const publicState = state.getPublicState();
    assert.deepEqual(publicState.configuration.presets.map(function (entry) { return entry.uuid; }),
        ["uuid-a", "missing-uuid"], "Inventory refresh must never reorder configured presets");
    assert.equal(publicState.configured[0].available, true);
    assert.equal(publicState.configured[1].available, false);
    assert.equal(publicState.configured[1].missing, true);
    assert.match(publicState.configured[1].error, /unavailable/i);
    assert.equal(publicState.cursorUuid, "uuid-a", "Initial cursor must deterministically select the first available configured UUID");

    const binding = {
        activeModule: "develop",
        selectedPhotoUuid: "photo",
        contextCounter: 4,
        developCounter: 7,
        contextChangedAt: 1234,
        serverEpoch: state.getPublicState().serverEpoch
    };
    const ordinary = state.beginPresetApplication("uuid-a", binding);
    const ordinaryTransportCommand = {
        command: "develop_preset.apply",
        operationId: ordinary.operationId,
        operationKind: ordinary.operationKind,
        uuid: ordinary.uuid,
        updateAISettings: ordinary.updateAISettings,
        expectedActiveModule: ordinary.expectedActiveModule,
        expectedSelectedPhotoUuid: ordinary.expectedSelectedPhotoUuid,
        expectedContextCounter: ordinary.expectedContextCounter,
        expectedDevelopCounter: ordinary.expectedDevelopCounter,
        expectedContextChangedAt: ordinary.expectedContextChangedAt,
        expectedServerEpoch: ordinary.expectedServerEpoch
    };
    assert.equal(Object.prototype.hasOwnProperty.call(ordinaryTransportCommand, "presetAmount"), false,
        "Preset application must omit Amount");
    assert.equal(commands.validateCommand(ordinaryTransportCommand), true);
    assert.equal(state.applicationBindingMatches(ordinary, binding), true);
    assert.equal(state.applicationBindingMatches(ordinary, Object.assign({}, binding, { contextCounter: 5 })), false,
        "Context-counter drift must be rejected");
    assert.equal(state.applicationBindingMatches(ordinary, Object.assign({}, binding, { developCounter: 8 })), false,
        "Develop-counter drift must be rejected");
    assert.equal(state.applicationBindingMatches(ordinary, Object.assign({}, binding, { contextChangedAt: 1235 })), false,
        "Context epoch drift must be rejected");
    assert.equal(state.applicationBindingMatches(ordinary, Object.assign({}, binding, { activeModule: "library" })), false,
        "Module drift must be rejected");
    assert.equal(state.applicationBindingMatches(
        Object.assign({}, ordinary, { expectedServerEpoch: "other-server-epoch" }), binding), false,
    "Server-epoch drift must be rejected");
    const pendingRevisionState = state.getPublicState();
    assert.equal(state.finishApplication(ordinary.operationId, ordinary.uuid,
        "other-server-epoch", presetDefinition.OUTCOME_OBSERVED, "wrong epoch"), false);
    assert.equal(state.finishApplication(ordinary.operationId, "other-uuid",
        binding.serverEpoch, presetDefinition.OUTCOME_OBSERVED, "wrong UUID"), false);
    assert.equal(state.getPublicState().pendingApplication, true,
        "Mismatched terminal responses must not consume the exact pending operation");
    assert.equal(state.getPublicState().stateRevision, pendingRevisionState.stateRevision,
        "Mismatched terminal responses must not advance authoritative state");
    state.rejectApplication(ordinary);

    const validAmountCommand = {
        command: "develop_preset.amount.set",
        presetAmount: 137,
        expectedPresetUuid: "uuid-a",
        expectedActiveModule: "develop",
        expectedSelectedPhotoUuid: "photo",
        expectedContextCounter: 4,
        expectedDevelopCounter: 7,
        expectedContextChangedAt: 1234,
        expectedServerEpoch: binding.serverEpoch,
        expectedFeedbackId: 9
    };
    assert.equal(commands.validateCommand(validAmountCommand), true);
    for (const invalidAmount of [undefined, "137", 1.5, -1, 201]) {
        const invalid = Object.assign({}, validAmountCommand);
        if (invalidAmount === undefined) delete invalid.presetAmount;
        else invalid.presetAmount = invalidAmount;
        assert.equal(commands.validateCommand(invalid), false,
            "Native Preset Amount must fail closed at command admission: " + invalidAmount);
    }
    assert.equal(commands.validateCommand(Object.assign({}, validAmountCommand, { expectedFeedbackId: 0 })), false);
    assert.equal(Object.prototype.hasOwnProperty.call(state.getPublicState(), "presetAmount"), false,
        "Preset state must not fabricate native PresetAmount feedback");

    const failedRefresh = state.beginInventoryRefresh();
    const loadingWithSnapshot = state.getPublicState();
    assert.equal(loadingWithSnapshot.inventoryStatus, "loading");
    assert.equal(loadingWithSnapshot.inventoryLoaded, true);
    assert.equal(loadingWithSnapshot.configured[0].available, true,
        "A refresh in progress must retain the previous successful snapshot");
    assert.equal(loadingWithSnapshot.cursorUuid, "uuid-a");
    assert.equal(state.failInventoryRefresh(failedRefresh, "Lightroom is unavailable"), true);
    const retainedAfterFailure = state.getPublicState();
    assert.equal(retainedAfterFailure.inventoryStatus, "error");
    assert.match(retainedAfterFailure.inventoryError, /Lightroom is unavailable/);
    assert.equal(retainedAfterFailure.inventoryLoaded, true);
    assert.equal(retainedAfterFailure.controlsEnabled, true,
        "A failed refresh must keep the previous successful inventory usable");
    assert.deepEqual(retainedAfterFailure.inventory, publicState.inventory);
    assert.equal(retainedAfterFailure.cursorUuid, "uuid-a");

    const changedInventory = state.beginInventoryRefresh();
    state.acceptInventoryItem(changedInventory, { uuid: "uuid-z", folder: "Z Folder", name: "Duplicate" });
    state.completeInventoryRefresh(changedInventory);
    const afterChangedInventory = state.getPublicState();
    assert.equal(afterChangedInventory.cursorUuid, "uuid-a",
        "An inventory-only refresh must not move the preset-to-apply cursor");
    assert.equal(afterChangedInventory.configured[0].missing, true,
        "Only a completed successful inventory may prove a configured UUID missing");

    const empty = presetDefinition.createDevelopPresetState({ configPath: null });
    const emptyRequest = empty.beginInventoryRefresh();
    empty.completeInventoryRefresh(emptyRequest);
    assert.equal(empty.getPublicState().cursorUuid, null);
    assert.equal(empty.getPublicState().controlsEnabled, false);
    assert.equal(empty.navigationTarget("next"), null);
}

async function httpNavigationAndSafetyTests() {
    const configPath = path.join(temporaryRoot, "http", "develop-presets.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        presets: [
            { uuid: "uuid-a", alias: "First", updateAISettings: false, amountEnabled: false },
            { uuid: "missing-uuid", updateAISettings: false, amountEnabled: false },
            { uuid: "uuid-b", updateAISettings: true, amountEnabled: true },
            { uuid: "uuid-c", updateAISettings: false, amountEnabled: false }
        ]
    }), "utf8");
    commands.resetQueueForTests();
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        developPresetConfigPath: configPath,
        windowsNativeBackend: windowsNative.createUnavailableWindowsBackend("test")
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    let serverEpoch = null;
    try {
        let response = await request(port, "/develop-presets/inventory/refresh");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.inventoryStatus, "loading");
        const coalescedRefresh = await request(port, "/develop-presets/inventory/refresh");
        assert.equal(coalescedRefresh.statusCode, 200);
        assert.equal(coalescedRefresh.body.inventoryRequestId, response.body.inventoryRequestId,
            "Concurrent HTTP refresh requests must join the active Lightroom inventory operation");
        const inventoryCommand = commands.getNextCommand();
        assert.equal(inventoryCommand.command, "develop_presets.inventory.request");
        assert.equal(commands.getNextCommand(), null,
            "Coalesced HTTP refresh requests must enqueue exactly one Lightroom inventory command");
        const inventoryItems = [
            { uuid: "uuid-c", folder: "Folder C", name: "Other" },
            { uuid: "uuid-a", folder: "Folder Z", name: "Duplicate" },
            { uuid: "uuid-b", folder: "Folder A", name: "Duplicate" }
        ];
        for (const item of inventoryItems) {
            response = await request(port, "/develop-presets/inventory/item?" + encodedQuery({
                requestId: inventoryCommand.requestId,
                uuid: item.uuid,
                folder: item.folder,
                name: item.name
            }));
            assert.equal(response.statusCode, 200);
        }
        response = await request(port, "/develop-presets/inventory/complete?" + encodedQuery({
            requestId: inventoryCommand.requestId
        }));
        assert.equal(response.statusCode, 200);
        serverEpoch = response.body.serverEpoch;
        assert.match(serverEpoch, /^[A-Za-z0-9_-]{1,64}$/);
        assert.deepEqual(response.body.inventory.map(function (entry) { return entry.uuid; }),
            ["uuid-b", "uuid-c", "uuid-a"], "Duplicate names must be disambiguated/sorted by folder");
        assert.deepEqual(response.body.configured.map(function (entry) { return entry.uuid; }),
            ["uuid-a", "missing-uuid", "uuid-b", "uuid-c"]);
        assert.equal(response.body.cursorUuid, "uuid-a");
        assert.equal(response.body.presetAmount, null,
            "An initial cursor is not a successfully applied preset and must not expose committed Amount");
        assert.equal(commands.getNextCommand(), null, "Initial cursor must not automatically apply a preset");

        const authoritativeConfiguration = {
            version: 1,
            presets: [
                { uuid: "uuid-a", alias: "First", updateAISettings: false, amountEnabled: false },
                { uuid: "missing-uuid", updateAISettings: false, amountEnabled: false },
                { uuid: "uuid-b", updateAISettings: true, amountEnabled: true },
                { uuid: "uuid-c", updateAISettings: false, amountEnabled: false }
            ]
        };
        response = await request(port, "/develop-presets/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(authoritativeConfiguration)
        });
        assert.equal(response.statusCode, 200, response.text);
        assert.deepEqual(response.body.configuration, authoritativeConfiguration,
            "The server must return the authoritative saved configuration");
        assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), authoritativeConfiguration,
            "Remote Web Controller saves must persist through the server state module");
        response = await request(port, "/develop-presets/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{not-json"
        });
        assert.equal(response.statusCode, 400);
        assert.match(response.body.error, /Invalid JSON/i);

        async function updateContext(activeModule, photo, fingerprint) {
            const result = await request(port, "/context/update?" + encodedQuery({
                activeModule: activeModule,
                selectedPhotoUuid: photo,
                developFingerprint: fingerprint
            }));
            assert.equal(result.statusCode, 200);
            return result.body;
        }

        function bindingQuery(fields) {
            return {
                selectedPhotoUuid: fields.selectedPhotoUuid,
                contextCounter: fields.contextCounter,
                developCounter: fields.developCounter,
                contextChangedAt: fields.contextChangedAt,
                serverEpoch: serverEpoch
            };
        }

        async function apply(uuid, fields) {
            const result = await request(port, "/develop-presets/apply?" + encodedQuery(Object.assign({ uuid: uuid }, bindingQuery(fields))));
            assert.equal(result.statusCode, 200, result.text);
            const command = commands.getNextCommand();
            assert.equal(command.uuid, uuid);
            assert.equal(command.operationKind, presetDefinition.APPLICATION_KIND_PRESET);
            assert.equal(Object.prototype.hasOwnProperty.call(command, "presetAmount"), false,
                "Direct preset selection must omit the optional Amount argument");
            assert.equal(Object.prototype.hasOwnProperty.call(command, "name"), false);
            assert.equal(command.expectedActiveModule, "develop");
            return command;
        }

        async function navigate(direction, fields, expectedUuid) {
            const result = await request(port, "/develop-presets/navigate?" + encodedQuery(Object.assign({ direction: direction }, bindingQuery(fields))));
            assert.equal(result.statusCode, 200, result.text);
            const command = commands.getNextCommand();
            assert.equal(command.uuid, expectedUuid);
            assert.equal(command.operationKind, presetDefinition.APPLICATION_KIND_PRESET);
            assert.equal(Object.prototype.hasOwnProperty.call(command, "presetAmount"), false,
                "Previous/Next must omit the optional Amount argument");
            return command;
        }

        async function publishAmountFeedback(amount, fields) {
            let result = await request(port, "/feedback/request?slider=PresetAmount");
            assert.equal(result.statusCode, 200, result.text);
            const feedbackId = result.body.request.id;
            result = await request(port, "/feedback/result?" + encodedQuery({
                id: feedbackId,
                slider: "PresetAmount",
                value: amount,
                min: 0,
                max: 200,
                selectedPhotoKey: fields.selectedPhotoUuid,
                selectedPhotoUuid: fields.selectedPhotoUuid
            }));
            assert.equal(result.statusCode, 200, result.text);
            return feedbackId;
        }

        async function applyAmount(amount, fields, feedbackId) {
            const result = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
                presetAmount: amount,
                feedbackId: feedbackId
            }, bindingQuery(fields))));
            assert.equal(result.statusCode, 200, result.text);
            const command = commands.getNextCommand();
            assert.equal(command.command, "develop_preset.amount.set");
            assert.equal(command.presetAmount, Number(amount));
            assert.equal(command.expectedPresetUuid, "uuid-b");
            assert.equal(command.expectedFeedbackId, feedbackId);
            assert.equal(Object.prototype.hasOwnProperty.call(command, "operationId"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(command, "uuid"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(command, "updateAISettings"), false);
            assert.ok(Number.isSafeInteger(result.body.feedbackRequestId));
            return command;
        }

        async function finish(command, outcome) {
            const result = await request(port, "/develop-presets/apply-result?" + encodedQuery({
                operationId: command.operationId,
                uuid: command.uuid,
                serverEpoch: command.expectedServerEpoch,
                outcome: outcome,
                detail: "test result"
            }));
            assert.equal(result.statusCode, 200, result.text);
            return result.body;
        }

        let fields = await updateContext("develop", "photo-1", "revision-1");
        for (const invalidAmount of [null, "malformed", "1.5", "-1", "201"]) {
            const query = bindingQuery(fields);
            if (invalidAmount !== null) query.presetAmount = invalidAmount;
            const invalid = await request(port, "/develop-presets/amount?" + encodedQuery(query));
            assert.equal(invalid.statusCode, 400, "Invalid preset Amount must fail closed: " + invalidAmount);
            assert.equal(commands.getNextCommand(), null);
        }
        let amountFeedbackId = await publishAmountFeedback(100, fields);
        const beforeSuccessfulPreset = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 100,
            feedbackId: amountFeedbackId
        }, bindingQuery(fields))));
        assert.equal(beforeSuccessfulPreset.statusCode, 409,
            "Amount-disabled UUIDs must reject before queue admission");
        assert.match(beforeSuccessfulPreset.body.error, /not enabled/i);
        assert.equal(commands.getNextCommand(), null);
        let command = await apply("uuid-b", fields);
        assert.equal(command.updateAISettings, true);
        assert.equal(bridge.getDevelopPresetState().cursorUuid, "uuid-a",
            "Cursor must not move before the Lightroom SDK result");
        const wrongEpochResult = await request(port, "/develop-presets/apply-result?" + encodedQuery({
            operationId: command.operationId,
            uuid: command.uuid,
            serverEpoch: "stale-server-epoch",
            outcome: presetDefinition.OUTCOME_OBSERVED,
            detail: "stale result"
        }));
        assert.equal(wrongEpochResult.statusCode, 409,
            "A result from another server epoch must not settle the pending operation");
        assert.equal(bridge.getDevelopPresetState().pendingApplication, true);
        let state = await finish(command, presetDefinition.OUTCOME_OBSERVED);
        assert.equal(state.cursorUuid, "uuid-b");
        assert.equal(state.presetAmount, null,
            "Preset completion must wait for authoritative native PresetAmount feedback");

        amountFeedbackId = await publishAmountFeedback(100, fields);
        let firstAmount = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 135,
            feedbackId: amountFeedbackId
        }, bindingQuery(fields))));
        assert.equal(firstAmount.statusCode, 200, firstAmount.text);
        const latestAmount = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 140,
            feedbackId: amountFeedbackId
        }, bindingQuery(fields))));
        assert.equal(latestAmount.statusCode, 200, latestAmount.text);
        assert.equal(latestAmount.body.coalesced, true,
            "Pending native Amount writes for one binding must coalesce to the latest value");
        command = commands.getNextCommand();
        assert.equal(command.command, "develop_preset.amount.set");
        assert.equal(command.presetAmount, 140);
        assert.equal(command.expectedFeedbackId, amountFeedbackId);
        assert.equal(commands.getNextCommand(), null);

        amountFeedbackId = await publishAmountFeedback(140, fields);
        response = await request(port, "/develop-presets/state");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.presetAmount, 140,
            "Native PresetAmount feedback—not queue admission—must drive public state");
        assert.equal(response.body.amountFeedback.id, amountFeedbackId);
        const olderFeedbackRequest = await request(port, "/feedback/request?slider=PresetAmount");
        const newerFeedbackRequest = await request(port, "/feedback/request?slider=PresetAmount");
        const newerFeedbackId = newerFeedbackRequest.body.request.id;
        let feedbackResult = await request(port, "/feedback/result?" + encodedQuery({
            id: newerFeedbackId,
            slider: "PresetAmount",
            value: 141,
            min: 0,
            max: 200,
            selectedPhotoKey: fields.selectedPhotoUuid,
            selectedPhotoUuid: fields.selectedPhotoUuid
        }));
        assert.equal(feedbackResult.statusCode, 200);
        feedbackResult = await request(port, "/feedback/result?" + encodedQuery({
            id: olderFeedbackRequest.body.request.id,
            slider: "PresetAmount",
            value: 139,
            min: 0,
            max: 200,
            selectedPhotoKey: fields.selectedPhotoUuid,
            selectedPhotoUuid: fields.selectedPhotoUuid
        }));
        assert.equal(feedbackResult.statusCode, 200);
        response = await request(port, "/develop-presets/state");
        assert.equal(response.body.amountFeedback.id, newerFeedbackId);
        assert.equal(response.body.presetAmount, 141,
            "A late lower-ID feedback result must not replace the newer native value");
        amountFeedbackId = newerFeedbackId;
        const laggingFeedbackWrite = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 80,
            feedbackId: amountFeedbackId - 1
        }, bindingQuery(fields))));
        assert.equal(laggingFeedbackWrite.statusCode, 200, laggingFeedbackWrite.text);
        command = commands.getNextCommand();
        assert.equal(command.command, "develop_preset.amount.set");
        assert.equal(command.presetAmount, 80);
        assert.equal(command.expectedFeedbackId, amountFeedbackId,
            "A same-context browser intent must bind to the server's newer authoritative feedback ID");

        const browserLaggingFields = Object.assign({}, fields);
        fields = await updateContext("develop", "photo-1", "native-amount-advanced-revision");
        amountFeedbackId = await publishAmountFeedback(141, fields);
        const rebasedAmount = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 142,
            feedbackId: amountFeedbackId
        }, bindingQuery(Object.assign({}, fields, { developCounter: browserLaggingFields.developCounter })))));
        assert.equal(rebasedAmount.statusCode, 200, rebasedAmount.text);
        command = commands.getNextCommand();
        assert.equal(command.command, "develop_preset.amount.set");
        assert.equal(command.expectedDevelopCounter, fields.developCounter,
            "A same-photo browser intent may be rebound only to the server's newer current Develop revision");
        assert.ok(command.expectedDevelopCounter > browserLaggingFields.developCounter);

        command = await apply("uuid-b", fields);
        state = await finish(command, presetDefinition.OUTCOME_NO_CHANGE);
        assert.equal(state.cursorUuid, "uuid-b", "Explicitly choosing the cursor preset must reapply it");
        assert.equal(state.presetAmount, null);

        command = await navigate("next", fields, "uuid-c");
        state = await finish(command, presetDefinition.OUTCOME_NO_CHANGE);
        assert.equal(state.cursorUuid, "uuid-c", "Next must skip the unavailable configured UUID");
        command = await navigate("next", fields, "uuid-a");
        state = await finish(command, presetDefinition.OUTCOME_OBSERVED);
        assert.equal(state.cursorUuid, "uuid-a", "Next must wrap around");
        amountFeedbackId = await publishAmountFeedback(100, fields);
        const disabledAmount = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 110,
            feedbackId: amountFeedbackId
        }, bindingQuery(fields))));
        assert.equal(disabledAmount.statusCode, 409,
            "Amount-disabled configured UUIDs must remain blocked after ordinary application succeeds");
        assert.match(disabledAmount.body.error, /not enabled/i);
        assert.equal(commands.getNextCommand(), null, "Disabled Amount must never enter the command queue");
        command = await navigate("previous", fields, "uuid-c");
        state = await finish(command, presetDefinition.OUTCOME_OBSERVED);
        assert.equal(state.cursorUuid, "uuid-c", "Previous must wrap around and skip unavailable entries");

        command = await apply("uuid-b", fields);
        state = await finish(command, presetDefinition.OUTCOME_FAILED);
        assert.equal(state.cursorUuid, "uuid-c", "SDK failure must not move the cursor");

        fields = await updateContext("develop", "photo-1", "external-revision");
        assert.equal(bridge.getDevelopPresetState().cursorUuid, "uuid-c",
            "External Lightroom Develop changes must not move the preset-to-apply cursor");

        command = await apply("uuid-a", fields);
        await updateContext("develop", "photo-2", "photo-change");
        assert.equal(commands.getNextCommand(), null, "Photo drift must reject the exact captured application before dequeue");
        assert.equal(bridge.getDevelopPresetState().lastApplication.outcome, presetDefinition.OUTCOME_STALE);
        assert.equal(bridge.getDevelopPresetState().cursorUuid, "uuid-c");

        fields = await updateContext("develop", "photo-3", "module-base");
        command = await apply("uuid-a", fields);
        await updateContext("library", "photo-3", "module-base");
        assert.equal(commands.getNextCommand(), null, "Module drift must reject before dequeue");
        assert.equal(bridge.getDevelopPresetState().lastApplication.outcome, presetDefinition.OUTCOME_STALE);

        fields = await updateContext("develop", "photo-4", "develop-base");
        command = await apply("uuid-a", fields);
        await updateContext("develop", "photo-4", "develop-changed");
        assert.equal(commands.getNextCommand(), null, "Develop revision drift must reject before dequeue");
        assert.equal(bridge.getDevelopPresetState().lastApplication.outcome, presetDefinition.OUTCOME_STALE);

        const staleAdmission = Object.assign({}, command, { operationId: "unknown-operation" });
        assert.equal(commands.tryEnqueueCommand(staleAdmission).accepted, false,
            "Queue admission must independently reject an unbound/stale preset operation");
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

function sourceContractTests() {
    const indexHtml = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
    const renderer = fs.readFileSync(path.join(root, "app/renderer.js"), "utf8");
    const preload = fs.readFileSync(path.join(root, "app/preload.js"), "utf8");
    const main = fs.readFileSync(path.join(root, "app/main.js"), "utf8");
    const controller = fs.readFileSync(path.join(root, "app/controller-develop-presets.js"), "utf8");
    const controllerHtml = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
    const lua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/DevelopPresets.lua"), "utf8");
    const parser = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Parser.lua"), "utf8");
    const settings = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Settings.lua"), "utf8");
    const polling = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/AutoStartPolling.lua"), "utf8");
    const feedbackPolling = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

    for (const removedId of ["polling", "pollingInput", "saveSettings", "defaultSettings", "settingsMessage"]) {
        assert.doesNotMatch(indexHtml, new RegExp('id="' + removedId + '"'), "Removed Polling dashboard DOM must stay absent");
    }
    assert.doesNotMatch(renderer, /setPollingDisplay|saveSettingsButton|defaultSettingsButton|pollingInput/);
    assert.doesNotMatch(preload, /saveSettings|resetSettings/);
    assert.doesNotMatch(main, /ipcMain\.handle\("save-settings"|ipcMain\.handle\("reset-settings"/);
    assert.match(settings, /local defaultPollIntervalMs = 100/);
    assert.match(settings, /local minPollIntervalMs = 10/);
    assert.match(settings, /local maxPollIntervalMs = 1000/);
    assert.match(settings, /pollIntervalMs = clamp\(pollIntervalMs, minPollIntervalMs, maxPollIntervalMs\)/);
    assert.match(polling, /local newConfig = Settings\.load\(\)[\s\S]*newConfig\.pollInterval ~= config\.pollInterval/);
    assert.match(readme, /Command queue check interval/);
    assert.match(readme, /does \*\*not\*\* control Web Controller feedback cadence/);
    assert.doesNotMatch(readme, /Electron app can edit this value/);

    assert.equal(fs.existsSync(path.join(root, "app/develop-presets-manager.js")), false,
        "The Electron-only preset manager helper must be removed");
    assert.doesNotMatch(indexHtml, /Develop Presets|developPreset|Manage Presets/i,
        "Electron must contain no Develop Presets manager or controls");
    assert.doesNotMatch(renderer, /developPreset|DevelopPreset|preset manager/i,
        "Electron renderer must contain no orphaned preset manager binding or state");
    assert.doesNotMatch(preload, /developPreset|get-develop-presets|refresh-develop-presets|save-develop-presets/i,
        "Electron preload must expose no preset-manager IPC surface");
    assert.doesNotMatch(main,
        /ipcMain\.handle\("(?:get|refresh|save)-develop-presets"/,
        "Electron main process must expose no preset-manager IPC handlers");
    assert.match(controller, /title\.textContent = "FAVORITE PRESETS"/);
    assert.match(controller,
        /helper\.textContent =[\s\S]*"This screen shows only your Favorites for faster touch control\. Use Add to Favorites below to search all Lightroom presets\."/);
    assert.match(controller,
        /aiGuidanceText\.textContent =[\s\S]*"If an Adaptive or AI preset does not change the photo, open Manage Favorite Presets and turn on AI adjustments for that preset\. This lets Lightroom apply the preset’s sky, subject or people effects\."/,
        "Favorite Presets must show the exact troubleshooting-focused AI guidance");
    assert.doesNotMatch(controller,
        /Using an Adaptive or AI preset\? Open Manage Favorite Presets/,
        "The removed top AI guidance must not remain in source");
    assert.match(controller, /previousButton = makeButton\("Prev"/);
    assert.match(controller, /currentLabel\.textContent = "Selected preset"/);
    assert.match(controller, /develop-preset-current-button/);
    assert.match(controller, /nextButton = makeButton\("Next"/);
    assert.doesNotMatch(controller, /Previous Favorite|Next Favorite|Previous Preset|Next Preset|Preset to apply/,
        "Favorite preset navigation must use the requested concise labels");
    assert.match(controller, /amountRange\.type = "range"/);
    assert.match(controller, /amountRange\.min = "0"/);
    assert.match(controller, /amountRange\.max = "200"/);
    assert.match(controller, /amountRange\.step = "1"/);
    assert.match(controller, /amountNumber\.type = "text"/);
    assert.match(controller, /const createTreatmentPresentation = options\.createTreatmentPresentation/,
        "Presets must consume the main controller's dedicated Presets treatment renderer");
    assert.match(controller,
        /rootElement\.append\(title, helper, row, amountRow, treatmentBlock, aiGuidance, compactStatus, manageButton, managerPanel\)/,
        "AI guidance must follow PHOTO MODE and precede transient status and management");
    const aiGuidanceCss = controllerHtml.slice(
        controllerHtml.indexOf(".develop-preset-ai-guidance {"),
        controllerHtml.indexOf(".develop-presets-controller-row {")
    );
    assert.match(aiGuidanceCss,
        /background:\s*#10202c;[\s\S]*border-left:\s*3px solid #3d8fb8;[\s\S]*color:\s*#9bc8e5;[\s\S]*font-family:\s*inherit;[\s\S]*font-size:\s*13px;[\s\S]*font-weight:\s*400/,
        "Relocated AI guidance must use the compact blue informational styling");
    assert.match(aiGuidanceCss, /\.develop-preset-ai-guidance-icon\s*\{/,
        "AI guidance must include its own small information icon styling");
    assert.doesNotMatch(aiGuidanceCss, /preset-treatment-warning|#2a1d0d|#e0a038|amber/i,
        "AI information styling must remain distinct from the amber B&W warning");
    assert.doesNotMatch(controller, /develop-preset-treatment-note|Some presets preserve the current treatment/,
        "Presets must rely on the shared authoritative treatment note instead of static advice");
    assert.match(controllerHtml,
        /\.develop-preset-treatment \.basic-controls-row\s*\{[\s\S]*margin-bottom:\s*6px/,
        "The Presets treatment presentation must retain touch-friendly controls styling");
    assert.match(controller,
        /if \(treatmentPresentation && typeof treatmentPresentation\.dispose === "function"\)[\s\S]*treatmentPresentation\.dispose\(\)/,
        "Presets tab deactivation must unregister its shared treatment presentation");
    assert.match(controller, /amountRange\.addEventListener\("input"[\s\S]*queueAmount\(amount, false\)/,
        "Preset Amount dragging must use the normal throttled native-parameter path");
    assert.doesNotMatch(controller, /currentCursorUsesAi/,
        "Native PresetAmount writes must not retain the preset-reapplication AI special case");
    assert.match(controller, /pointerup[\s\S]*queueAmount\(amount, true\)/);
    assert.match(controller, /makeButton\("Reset"[\s\S]*queueAmount\(100, true\)/);
    assert.match(controller, /\/api\/develop-presets\/amount\?presetAmount=/);
    assert.match(controller, /Manage Favorite Presets/);
    assert.doesNotMatch(controller, /makeButton\("Manage Presets"/,
        "The old manager label must not remain visible");
    assert.match(controller, /managerPanel\.hidden = true/,
        "Web Controller manager must be collapsed by default");
    assert.doesNotMatch(controller, /createElement\("select"\)|<select/i,
        "Develop Presets must use no native HTML select controls");
    assert.match(controller, /makeButton\("\+ Add to Favorites"/);
    assert.doesNotMatch(controller, /makeButton\("\+ Add Presets"/,
        "The old add label must not remain visible");
    assert.match(controller, /"Add Lightroom Presets to Favorites"/);
    assert.match(controller, /makeButton\("Refresh Presets", "develop-preset-refresh secondary", refreshInventory\)/,
        "Manage Favorite Presets must expose the dedicated touch-sized Refresh Presets action");
    assert.match(controller,
        /makeButton\("\+ Add to Favorites"[\s\S]*return refreshInventory\(\)\.then\(function \(\) \{[\s\S]*openPicker\(inventoryPicker, addPresetsButton\)/,
        "+ Add to Favorites must finish the shared authoritative refresh before opening the picker");
    assert.match(controller, /if \(inventoryRefreshPromise\) return inventoryRefreshPromise/,
        "Every browser inventory trigger must coalesce onto one shared refresh promise");
    assert.match(controller,
        /data\.inventoryStatus === "not-loaded" && !inventorySnapshotLoaded\(data\)[\s\S]*refreshInventory\(\)/,
        "First Presets activation must auto-refresh only a current-process not-loaded inventory");
    assert.match(controller, /makeButton\("Add selected"/);
    assert.match(controller, /Alias \(optional\)/);
    assert.match(controller,
        /appendTextField\(row, "Preset"[\s\S]*appendTextField\(row, "Folder"[\s\S]*aliasLabel\.textContent = "Alias \(optional\)"/,
        "Each managed favorite must display Preset, Folder, then Alias before Preset Options");
    assert.match(controller, /optionsHeading\.textContent = "Preset options"/);
    assert.match(controller,
        /"AI adjustments", "Enable this if you apply an Adaptive or AI preset and the preset does not visibly affect the photo\."/);
    assert.match(controller,
        /"Amount slider", "Enable the Amount slider for this preset\. Leave it disabled if Lightroom does not show an Amount slider for this preset\."/);
    assert.doesNotMatch(controller,
        /Update AI settings|Apply AI adjustments|Enable Amount user override|Amount control|User setting — enable only/,
        "Manage Favorite Presets must not expose implementation-oriented option copy");
    assert.doesNotMatch(controller, /\.type = "checkbox"/,
        "Neither preset option may use an inconsistent native checkbox");
    assert.match(controller,
        /createPresetOptionToggle\(entry, "updateAISettings"[\s\S]*createPresetOptionToggle\(entry, "amountEnabled"/,
        "Both stored preset booleans must use the same compact toggle-card component");
    assert.match(controllerHtml,
        /\.develop-preset-config-options\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
        "Preset options must render side by side on desktop");
    assert.match(controllerHtml,
        /@media \(max-width: 680px\)[\s\S]*\.develop-preset-config-options\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/,
        "Preset options must stack on narrow touch layouts");
    assert.match(controller, /alias\.placeholder = "Optional alias"/);
    assert.match(controllerHtml,
        /\.develop-preset-config-field\.alias input\[type="text"\]\s*\{[\s\S]*background:\s*#080b10;[\s\S]*color:\s*#f3c65f;[\s\S]*caret-color:\s*#f3c65f;[\s\S]*border:\s*1px solid #42505c/,
        "Alias inputs must use the requested dark field and warm text/caret palette");
    assert.match(controllerHtml,
        /\.develop-preset-config-field\.alias input\[type="text"\]::placeholder\s*\{[\s\S]*color:\s*#8f8773/,
        "Alias placeholders must use muted warm-grey text");
    assert.match(controllerHtml,
        /\.develop-preset-config-field\.alias input\[type="text"\]:focus-visible\s*\{[\s\S]*border-color:\s*#7cc7ff/,
        "Alias focus must retain the LRBridge cyan accent");
    assert.match(controllerHtml,
        /\.develop-preset-config-field\.alias input\[type="text"\]::selection\s*\{[\s\S]*background:\s*#315f7c;[\s\S]*color:\s*#fff0c2/,
        "Alias selection highlighting must remain readable");
    assert.match(controllerHtml,
        /\.develop-preset-config-field\.preset \.develop-preset-config-field-value\s*\{[\s\S]*font-size:\s*17px;[\s\S]*font-weight:\s*700/,
        "Only the Preset value must receive stronger primary prominence");
    assert.match(controllerHtml,
        /\.develop-preset-amount-unavailable-emphasis\s*\{[\s\S]*color:\s*#f4f7fa;[\s\S]*font-weight:\s*700/,
        "Only the unavailable prefix must receive brighter bold emphasis");
    assert.match(controller, /Move Up/);
    assert.match(controller, /Move Down/);
    assert.match(controller, /Remove/);
    assert.match(controller, /makeButton\("Save Changes"/);
    assert.match(controller,
        /Choose which Lightroom presets appear in Favorite Presets and arrange the order used by Prev and Next\. Adding an alias does not rename the original Lightroom preset\./);
    assert.match(controller, /return count \+ " Lightroom presets found\."/);
    for (const amountGuidance of [
        "Amount slider unavailable: Make sure it is enabled under Preset Options. If enabled, Lightroom Classic does not support it for this preset.",
        "Checking Amount availability…",
        "Adjust the strength of this preset."
    ]) {
        assert.ok(controller.includes('"' + amountGuidance + '"'),
            "Missing distinct Amount guidance: " + amountGuidance);
    }
    const photographerFacingPresetText = controller.match(/(?:textContent|setStatus|setManagerMessage)[\s\S]*/)[0];
    assert.doesNotMatch(photographerFacingPresetText,
        /Preset UUID is the saved identity|Preset inventory loaded successfully|Value and range are authoritative feedback|Amount is read independently|Sending native Lightroom Preset Amount|native Preset Amount queued|Develop preset application queued|Lightroom result pending/,
        "Photographer-facing Presets copy must not expose SDK, feedback, queue, or identity internals");
    for (const statusText of [
        "Applying preset…",
        "Preset applied.",
        "Updating Amount…",
        "Amount updated.",
        "Could not apply the preset. Please try again.",
        "Could not update Amount. Please try again."
    ]) {
        assert.ok(controller.includes('"' + statusText + '"'),
            "Missing concise photographer-facing status: " + statusText);
    }
    assert.match(controller, /\/api\/develop-presets\/config/);
    assert.match(controller, /method: "POST"/);
    assert.match(controller, /configurationFromDraft\(draft\)/);
    assert.match(controller, /const selectedInventoryUuids = new Set\(\)/);
    assert.match(controller, /inventory\.forEach\(function \(item\) \{[\s\S]*selectedInventoryUuids\.has\(item\.uuid\)[\s\S]*addDraftEntry\(draft, item\.uuid\)/,
        "Multi-add must preserve deterministic inventory order");
    assert.match(controller, /configuredUuidSet\(\)[\s\S]*draft\.map/,
        "Unsaved and saved configured UUIDs must both prevent duplicate inventory additions");
    const configurationBuilderBlock = controller.slice(
        controller.indexOf("function configurationFromDraft("),
        controller.indexOf("function displayLabel(")
    );
    assert.doesNotMatch(configurationBuilderBlock, /treatment|grayscale|monochrome|black.?and.?white/i,
        "Preset configuration must gain no treatment classification field");
    assert.doesNotMatch(controller, /photo\.treatment|command=photo\.treatment|quickDevelopSetTreatment|value=.*grayscale/,
        "Preset selection, navigation, and Amount application must never force treatment");
    assert.doesNotMatch(controller, /(?:entry|preset|inventory)\.(?:name|folder|alias)[\s\S]{0,120}(?:grayscale|monochrome|black.?and.?white)/i,
        "Preset labels and folders must never be used as Color/B&W heuristics");
    const amountCapabilityBlock = controller.slice(
        controller.indexOf("function currentCursorAllowsAmount("),
        controller.indexOf("function committedAmount(")
    );
    assert.match(amountCapabilityBlock, /cursor\.amountEnabled === true/);
    assert.doesNotMatch(amountCapabilityBlock, /name|folder|alias|type|SupportsAmount|xmp|sdk/i,
        "Amount capability must come only from the saved UUID-bound boolean");
    assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB/,
        "The browser must not persist a duplicate preset configuration");
    assert.match(controller, /Unavailable/);
    assert.match(controller, /missing UUID/);
    assert.match(controller, /entry\.missing === true \? " \(missing UUID\)" : ""/,
        "Compact labels must rely on authoritative missing proof");
    assert.match(controller, /const missing = snapshotLoaded && !item/,
        "Manager rows must not infer missing UUIDs before a successful snapshot exists");
    assert.match(controller, /state\.pendingApplication/);
    assert.match(controller, /const isCursor = entry\.uuid === state\.cursorUuid[\s\S]*submitPreset\(applicationPath\(entry\.uuid\)\)/,
        "Selecting the cursor preset again must remain an explicit reapply action");
    assert.match(controller, /document\.createElement\("dialog"\)/);
    assert.match(controller, /dialog\.setAttribute\("aria-modal", "true"\)/);
    assert.match(controller, /list\.setAttribute\("role", "listbox"\)/);
    assert.match(controller, /list\.setAttribute\("aria-multiselectable", "true"\)/);
    assert.match(controller, /picker\.dialog\.showModal\(\)/,
        "Modal pickers must use the browser's top-layer modal behavior");
    assert.match(controller, /event\.key !== "Escape"[\s\S]*closePicker\(picker, true\)/);
    assert.match(controller, /event\.target === dialog[\s\S]*closePicker\(picker, true\)/);
    assert.match(controller, /makeButton\("Close"/);
    assert.match(controller, /focusElement\(picker\.opener\)/,
        "Picker dismissal must restore focus to its opener");
    assert.match(controller, /configuredSearch[\s\S]*renderSignature/);
    assert.match(controller, /selectedInventoryUuids[\s\S]*renderSignature/);
    assert.match(controller, /alias\.addEventListener\("input"[\s\S]*entry\.alias = alias\.value;[\s\S]*updateDraftDirtyState\(\)/,
        "Alias input must update the local draft without invoking the card-list renderer");
    assert.match(controller, /function acceptServerState[\s\S]*if \(optionsForState\.replaceDraft === true \|\| !draftInitialized\)[\s\S]*renderManager\(false, optionsForState\.rebuildConfiguredList === true \|\| replacedDraft\)/,
        "Ordinary authoritative polling must not replace or rebuild an initialized manager draft");
    const deactivateBlock = controller.match(/function deactivate\(\) \{[\s\S]*?\n        \}/)[0];
    assert.match(deactivateBlock, /clearInterval\(timer\)/);
    assert.doesNotMatch(deactivateBlock, /state = null|draft = \[\]|draftDirty = false/,
        "Tab deactivation must stop polling without discarding the unsaved manager draft");
    assert.match(controllerHtml, /controller-develop-presets\.js/);
    assert.match(main, /requestUrl\.pathname === "\/"[\s\S]*fs\.readFileSync\(controllerPath, "utf8"\)/,
        "The running Web Controller must read controller.html for each page request");
    assert.match(main, /requestUrl\.pathname === "\/controller-develop-presets\.js"[\s\S]*fs\.readFileSync\(controllerDevelopPresetsPath, "utf8"\)/,
        "The running Web Controller must read the preset component for each script request");
    assert.match(controllerHtml, /develop-preset-navigation[\s\S]*min-height: 48px/,
        "Previous and Next must remain touch-sized");
    assert.match(controllerHtml, /develop-preset-current-button[\s\S]*min-height: 56px/,
        "The current preset cursor must be a large touch button");
    assert.match(controllerHtml,
        /\.develop-preset-manager-toolbar\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[\s\S]*@media \(max-width: 520px\)[\s\S]*\.develop-preset-manager-toolbar\s*\{[\s\S]*grid-template-columns:\s*1fr/,
        "The three preset actions must share equal columns and stack without overflow on narrow screens");
    assert.match(controllerHtml, /\.develop-preset-amount-row[\s\S]*grid-template-columns:[\s\S]*min-width: 0/,
        "Preset Amount must use the established overflow-safe slider row layout");
    assert.match(controllerHtml, /\.develop-preset-amount-step,[\s\S]*min-width: 48px;[\s\S]*min-height: 48px/,
        "Preset Amount step and Reset actions must remain touch-sized");
    assert.match(controllerHtml, /@media \(max-width: 680px\)[\s\S]*\.develop-preset-amount-row[\s\S]*grid-template-columns:[\s\S]*\.develop-preset-amount-range[\s\S]*grid-column: 1 \/ -1/,
        "Preset Amount must stack without horizontal overflow on narrow screens");
    assert.match(controller, /amountNumber\.addEventListener\("keydown"[\s\S]*event\.key === "Enter"[\s\S]*event\.key === "Escape"/,
        "Preset Amount numeric editing must support keyboard commit and dismissal");
    assert.match(controller, /desiredAmount[\s\S]*queuedAmount[\s\S]*activeAmountRequest[\s\S]*awaitingAmountFeedback/,
        "Preset Amount must track rendered intent, queued/native writes, and authoritative settlement separately");
    assert.match(controller, /stateRequestGeneration[\s\S]*acceptedStateRequestGeneration/,
        "Out-of-order state responses across server epochs must be generation-bound");
    assert.match(controller,
        /record\.generation !== amountGeneration[\s\S]*minimumFeedbackId: data\.feedbackRequestId/,
        "Native Amount admission must be generation-bound and settle only against newer feedback");
    assert.match(controller, /amountDecrementButton\.disabled = !enabled \|\| desiredAmount <= minimum[\s\S]*amountIncrementButton\.disabled = !enabled \|\| desiredAmount >= maximum/,
        "Amount step controls must honor Lightroom's authoritative native range");
    assert.match(controllerHtml, /develop-preset-picker-option[\s\S]*min-height: 52px/,
        "Every custom picker row must exceed the 48px touch target minimum");
    assert.match(controllerHtml, /dialog\.develop-preset-picker[\s\S]*width: min\(720px, calc\(100vw - 32px\)\)[\s\S]*max-height: calc\(100dvh - 32px\)[\s\S]*overflow: hidden/,
        "Wide picker panels must fit the visual viewport without horizontal overflow");
    assert.match(controllerHtml, /develop-preset-picker-list[\s\S]*overflow-x: hidden[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior: contain[\s\S]*touch-action: pan-y/,
        "Only genuinely overflowing picker lists may scroll, without dragging the page");
    assert.match(controllerHtml, /develop-preset-picker-footer[\s\S]*position: sticky[\s\S]*bottom: 0/,
        "The inventory Add selected action must remain sticky");
    assert.match(controllerHtml, /@media \(max-width: 680px\)[\s\S]*dialog\.develop-preset-picker[\s\S]*width: calc\(100vw - 12px\)[\s\S]*max-height: calc\(100dvh - 12px\)/,
        "Narrow screens must use a nearly full-width visual-viewport sheet");
    assert.doesNotMatch(controllerHtml, /scrollbar-gutter|More items/i,
        "Pickers must expose neither a permanent scrollbar gutter nor a More items indicator");
    assert.doesNotMatch(indexHtml + renderer + controller + controllerHtml, />\s*Active preset\s*</i);
    assert.doesNotMatch(controller, /textContent\s*=\s*["']Active preset/i);
    assert.match(controllerHtml,
        /const controllerTabIds = \["sliders", "color-grading", "tone-curve", "presets", "selection", "application", "tools"\]/,
        "The Web Controller must expose the exact accepted seven-tab order");
    assert.match(controllerHtml, /function renderPresetsTab\(\) \{\s*developPresetController\.activate\(content\);\s*\}/);
    assert.match(controllerHtml,
        /createTreatmentPresentation: function \(\) \{\s*return createPresetTreatmentPresentation\("develop-preset-treatment-row"\);\s*\}/,
        "Presets must receive the explicit Photo Mode renderer");
    assert.match(controllerHtml,
        /developTreatmentPresentation = createDevelopTreatmentPresentation\(row\)/,
        "Develop Sliders must receive the separate compact B&W renderer");
    assert.match(controllerHtml,
        /developTreatmentPresentations\.forEach\(updateDevelopTreatmentPresentation\);\s*presetTreatmentPresentations\.forEach\(updatePresetTreatmentPresentation\)/,
        "Both visual renderers must update from the same authoritative Treatment state");
    assert.match(controllerHtml,
        /function render\(\) \{[\s\S]*developPresetController\.deactivate\(\);[\s\S]*clearContent\(\);[\s\S]*if \(activeTab === "presets"\) \{[\s\S]*renderPresetsTab\(\)/,
        "Every render must dispose the previous Presets controller before clearing its host, then reactivate it only for Presets");
    const selectionRender = controllerHtml.match(/function renderSelectionTab\(\) \{[\s\S]*?\n\s*\}/)[0];
    assert.doesNotMatch(selectionRender, /developPresetController|Treatment/,
        "Selection must contain neither Develop Presets nor Treatment UI");
    assert.match(main, /\/api\/develop-presets\/config[\s\S]*request\.method !== "POST"[\s\S]*method: "POST"/,
        "Web Controller configuration saves must be proxied to the authoritative server");

    assert.match(lua, /LrApplication\.developPresetFolders\(\)/);
    assert.match(lua, /folder:getDevelopPresets\(\)/);
    assert.match(lua, /preset:getUuid\(\)/);
    assert.match(lua, /LrApplication\.developPresetByUuid\(command\.uuid\)/);
    assert.match(lua, /local capturedPhoto = catalog:getTargetPhoto\(\)/);
    assert.match(lua, /catalog:getTargetPhoto\(\) ~= capturedPhoto/);
    assert.match(lua, /catalog:withWriteAccessDo\("LRBridge Develop Preset"/);
    assert.doesNotMatch(lua, /applyDevelopPreset\([^\n]*command\.presetAmount/,
        "Interactive Amount must never reapply a Develop preset");
    assert.match(lua, /capturedPhoto:applyDevelopPreset\(preset, _PLUGIN\)/,
        "Ordinary non-AI preset application must omit Amount entirely");
    assert.match(lua, /capturedPhoto:applyDevelopPreset\(preset, _PLUGIN, nil, true\)/,
        "Ordinary AI preset application must pass no Amount while preserving the fourth SDK option");
    assert.match(lua, /LrDevelopController\.getRange\(presetAmountParameter\)/);
    assert.match(lua, /LrDevelopController\.getValue\(presetAmountParameter\)/);
    assert.match(lua, /LrDevelopController\.setValue\(presetAmountParameter, command\.presetAmount\)/,
        "Interactive Amount must be one direct native PresetAmount write");
    assert.match(lua, /LrDevelopController\.addAdjustmentChangeObserver/,
        "Lightroom adjustment changes must arm authoritative PresetAmount feedback");
    assert.match(feedbackPolling,
        /DevelopPresets\.consumeAmountDirty\(\)[\s\S]*feedback\/request\?slider=PresetAmount/,
        "The feedback loop must request native PresetAmount after adjustment observer callbacks");
    assert.match(lua, /gateFingerprint ~= beforeFingerprint/);
    assert.match(lua, /not serverContextMatches\(command\)/);
    const commandSource = fs.readFileSync(path.join(root, "server/commands.js"), "utf8");
    const presetServerSource = fs.readFileSync(path.join(root, "server/develop-presets.js"), "utf8");
    const bridgeSource = fs.readFileSync(path.join(root, "server/bridge.js"), "utf8");
    const amountAdmissionBlock = bridgeSource.slice(
        bridgeSource.indexOf('app.get("/develop-presets/amount"'),
        bridgeSource.indexOf('app.get("/develop-presets/apply-result"')
    );
    assert.match(amountAdmissionBlock, /cursor\.amountEnabled !== true[\s\S]*status\(409\)/,
        "Amount-disabled UUIDs must fail before queue admission");
    assert.doesNotMatch(amountAdmissionBlock, /name|folder|alias|type|SupportsAmount|xmp|sdk/i,
        "Server Amount admission must perform no inferred capability classification");
    assert.doesNotMatch(controller + presetServerSource + amountAdmissionBlock + lua,
        /SupportsAmount2?|<x:xmpmeta|\.xmp\b/i,
        "Production must not infer Preset Amount capability from XMP metadata");
    assert.match(presetServerSource, /pendingApplications\.size > 0[\s\S]*Wait for the current Develop preset application to finish/,
        "Server admission must reject overlapping preset SDK applications");
    assert.match(commandSource, /develop_preset\.apply[\s\S]*developPresetAdmissionProvider\.matches/,
        "Preset commands must revalidate at queue admission");
    assert.match(commandSource, /develop_preset\.amount\.set[\s\S]*developPresetAdmissionProvider\.matches/,
        "Native PresetAmount commands must revalidate at queue admission and dequeue");
    assert.match(commandSource, /function getNextCommand\(\)[\s\S]*develop_preset\.apply[\s\S]*developPresetAdmissionProvider\.matches/,
        "Preset commands must revalidate at dequeue");
    assert.match(bridgeSource,
        /currentState\.inventoryStatus === "loading" && currentState\.inventoryRequestId[\s\S]*return developPresetPublicState\(\)/,
        "The server must coalesce concurrent inventory requests before queue admission");
    assert.match(bridgeSource, /const PRESET_AMOUNT_PARAMETER = "PresetAmount"/);
    assert.match(bridgeSource, /state\.amountFeedback = feedback[\s\S]*state\.presetAmount = feedback \? feedback\.value : null/,
        "Develop preset public state must publish only authoritative native feedback");
    assert.doesNotMatch(controller + bridgeSource + lua + parser, /amountTrace|develop-preset-amount-trace/i,
        "Temporary Amount trace hooks and endpoints must not remain in production source");
    assert.doesNotMatch(lua, /getTargetPhotos|applyDevelopPreset\(photos|undo/i,
        "Preset application must target only the captured single photo and perform no automatic Undo");
    assert.match(parser, /local updateAISettings = parseBooleanField\(json, "updateAISettings"\)/);
    assert.match(parser, /local presetAmount = parseIntegerField\(json, "presetAmount"\)/);
    assert.match(lua,
        /develop-presets\/state[\s\S]*jsonString\(presetState, "serverEpoch"\) ~= command\.expectedServerEpoch/,
        "Lua must reject a fetched command if the server epoch changed before SDK execution");

    const inline = controllerHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(inline);
    new vm.Script(inline[1], { filename: "controller-inline.js" });
}

async function main() {
    try {
        configurationAndOrderingTests();
        await webControllerInventorySelectionPersistenceTest();
        await webControllerInventoryRefreshLifecycleTest();
        await webControllerNativePresetAmountTest();
        await httpNavigationAndSafetyTests();
        sourceContractTests();
        console.log("Web Controller Develop preset configuration, navigation, safety, and Polling UI regression tests passed.");
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

main().catch(function (err) {
    console.error(err.stack || err.message);
    process.exitCode = 1;
});
