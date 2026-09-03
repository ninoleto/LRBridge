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
    "Dirty Save Configuration must use the green action treatment");
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
        { uuid: "uuid-one", alias: "Portrait Soft", updateAISettings: false },
        { uuid: "uuid-two", updateAISettings: true }
    ];
    let cursorUuid = "uuid-one";
    let presetAmount = null;
    let saveCount = 0;
    let inventoryRefreshCount = 0;
    let treatmentPresentationCreateCount = 0;
    let treatmentPresentationDisposeCount = 0;
    const appliedUuids = [];
    const appliedAmounts = [];

    function publicState() {
        const configured = savedPresets.map(function (entry) {
            const preset = inventory.find(function (item) { return item.uuid === entry.uuid; });
            return {
                uuid: entry.uuid,
                alias: entry.alias || null,
                updateAISettings: entry.updateAISettings === true,
                folder: preset ? preset.folder : null,
                name: preset ? preset.name : null,
                available: !!preset,
                missing: !preset,
                error: preset ? null : "Preset UUID is unavailable"
            };
        });
        return {
            ok: true,
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
            presetAmount: presetAmount,
            controlsEnabled: configured.some(function (entry) { return entry.available; }),
            pendingApplication: false,
            lastApplication: null
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
            responseState = publicState();
        } else if (url.startsWith("/api/develop-presets/apply?")) {
            const parsed = new URL(url, "http://127.0.0.1");
            cursorUuid = parsed.searchParams.get("uuid");
            presetAmount = 100;
            appliedUuids.push(cursorUuid);
            responseState = publicState();
        } else if (url.startsWith("/api/develop-presets/amount?")) {
            const parsed = new URL(url, "http://127.0.0.1");
            presetAmount = Number(parsed.searchParams.get("presetAmount"));
            appliedAmounts.push(presetAmount);
            responseState = publicState();
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
            return { activeModule: "develop", selectedPhotoUuid: "photo", contextCounter: 1, developCounter: 1 };
        },
        createTreatmentPresentation: function () {
            treatmentPresentationCreateCount += 1;
            const row = document.createElement("div");
            row.className = "basic-controls-row develop-preset-treatment-row";
            const button = document.createElement("button");
            button.textContent = "B&W";
            const status = document.createElement("span");
            status.className = "basic-controls-status";
            status.textContent = "Color";
            row.append(button, status);
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
        const treatmentBlock = findByClass(host, "develop-preset-treatment");
        const treatmentButton = findByText(treatmentBlock, "B&W");
        const treatmentStatus = findByClass(treatmentBlock, "basic-controls-status");
        const treatmentNote = findByClass(treatmentBlock, "develop-preset-treatment-note");
        assert.ok(currentButton && currentPrimary);
        assert.ok(treatmentButton, "Presets must render the injected shared treatment button");
        assert.equal(treatmentStatus.textContent, "Color",
            "Presets must display feedback supplied by the shared authoritative treatment presentation");
        assert.equal(treatmentNote.textContent,
            "Some presets preserve the current treatment. Switch back to Color here after using a B&W preset.");
        const compactRoot = findByClass(host, "develop-presets-controller");
        const compactStatus = findByClass(host, "develop-presets-controller-status");
        const managePresets = findByText(host, "Manage Presets");
        assert.ok(compactRoot.children.indexOf(amountRange.parentElement) < compactRoot.children.indexOf(treatmentBlock));
        assert.ok(compactRoot.children.indexOf(treatmentBlock) < compactRoot.children.indexOf(compactStatus));
        assert.ok(compactRoot.children.indexOf(treatmentBlock) < compactRoot.children.indexOf(managePresets),
            "Treatment must sit after Preset Amount and before status/Manage Presets");
        assert.equal(findAll(treatmentBlock, function (element) { return element.textContent === "B&W"; }).length, 1);
        assert.equal(currentPrimary.textContent, "Portrait Soft");
        assert.equal(amountRange.disabled, true,
            "Amount must stay disabled until a configured preset application succeeds");
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
            "Normal pointer release and keyboard/change commits must reapply Amount");

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
            "AI preset range input must remain local and must not continuously recompute masks");
        assert.equal(amountRange.value, "140", "Polling must not overwrite an in-progress AI Amount drag");
        await amountRange.dispatch("pointerup", { pointerType: "touch" });
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.deepEqual(appliedAmounts, [125, 126, 125, 100, 112, 113, 140],
            "AI preset Amount must submit on pointer release");
        await currentButton.dispatch("click");
        configuredDialog = findByAttribute(host, "aria-labelledby", "developPresetConfiguredPickerTitle");
        await findByDataUuid(configuredDialog, "uuid-two").dispatch("click");
        assert.deepEqual(appliedUuids, ["uuid-one", "uuid-two", "uuid-two"],
            "Selecting the already-selected cursor row must reapply it");

        const manageButton = findByText(host, "Manage Presets");
        assert.ok(manageButton);
        await manageButton.dispatch("click");
        const addButton = findByText(host, "+ Add Presets");
        const refreshButton = findByText(host, "Refresh Presets");
        const saveButton = findByText(host, "Save Configuration");
        assert.ok(addButton && refreshButton && saveButton);
        assert.equal(saveButton.disabled, true, "A saved configuration must expose a neutral disabled Save action");
        assert.equal(saveButton.className, "develop-preset-save");
        assert.equal(countByClass(host, "develop-preset-add-open"), 1,
            "Manage Presets must expose exactly one Add Presets action");
        assert.equal(countByClass(host, "develop-preset-refresh"), 1,
            "Manage Presets must expose exactly one Refresh Presets action");
        assert.equal(countByClass(host, "develop-preset-save"), 1,
            "Manage Presets must expose exactly one Save Configuration action");
        const managerToolbar = findByClass(host, "develop-preset-manager-toolbar");
        assert.ok(managerToolbar && managerToolbar.children[0] === addButton &&
            managerToolbar.children[1] === refreshButton && managerToolbar.children[2] === saveButton,
        "Add, Refresh, and Save must appear in the required top manager toolbar order");
        assert.equal(findByClass(host, "develop-preset-config-list").parentElement.children.includes(saveButton), false,
            "There must be no bottom Save Configuration action");
        assert.equal(countByClass(host, "develop-preset-config-row"), 2);
        await addButton.dispatch("click");
        assert.equal(inventoryRefreshCount, 1, "+ Add Presets must refresh the Lightroom inventory when opened");
        let inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
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
        assert.equal(countByClass(host, "develop-preset-config-row"), 4,
            "Add selected must render all unsaved configuration cards immediately");
        assert.equal(saveButton.disabled, false, "A changed draft must enable Save Configuration");
        assert.match(saveButton.className, /\bdirty\b/, "A changed draft must expose the green Save state");
        assert.equal(currentPrimary.textContent, "Two",
            "Unsaved draft additions must not change the compact current-preset button");

        const configuredList = findByClass(host, "develop-preset-config-list");
        configuredList.scrollTop = 37;
        const aliasInput = findByAttribute(host, "aria-label", "Optional alias for A Portrait — Two");
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
            "Adding cards must restore focus to the single Add Presets toolbar action");
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
        const reactivatedManager = findByText(host, "Manage Presets");
        assert.equal(findByClass(host, "develop-preset-manager").hidden, true,
            "Manage Presets must be collapsed by default on Presets activation");
        await reactivatedManager.dispatch("click");
        assert.equal(countByClass(host, "develop-preset-config-row"), 4,
            "Tab navigation must preserve the complete unsaved manager draft");
        assert.equal(controller.getDraft()[1].alias, "Saved Alias");

        const reactivatedSave = findByText(host, "Save Configuration");
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

    function configuredState() {
        return savedPresets.map(function (entry) {
            const item = inventory.find(function (candidate) { return candidate.uuid === entry.uuid; }) || null;
            const missing = inventoryLoaded && !item;
            return {
                uuid: entry.uuid,
                alias: entry.alias || null,
                updateAISettings: entry.updateAISettings === true,
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
            presetAmount: presetAmount,
            controlsEnabled: inventoryLoaded && configured.some(function (entry) { return entry.available; }),
            pendingApplication: false,
            lastApplication: null
        };
    }

    function deferredRefresh() {
        let resolve;
        const promise = new Promise(function (resolvePromise) { resolve = resolvePromise; });
        return {
            promise: promise,
            resolveState: function () {
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
            return { activeModule: "develop", selectedPhotoUuid: "photo", contextCounter: 4, developCounter: 8 };
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
        assert.equal(compactStatus.textContent, "Loading preset inventory…");
        assert.equal(findByClass(host, "develop-presets-controller").dataset.inventoryStatus, "loading");

        await findByText(host, "Manage Presets").dispatch("click");
        const addButton = findByText(host, "+ Add Presets");
        const refreshButton = findByText(host, "Refresh Presets");
        const saveButton = findByText(host, "Save Configuration");
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
            "Automatic, Add Presets, and manual refresh calls must share one browser refresh operation");
        let inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        assert.equal(inventoryDialog.open, false,
            "+ Add Presets must wait for the authoritative refresh before opening the picker");

        inventoryStatus = "error";
        inventoryError = "Lightroom inventory probe failed";
        automaticFailure.resolveState();
        await Promise.all([addDuringAutomatic, manualDuringAutomatic]);
        inventoryDialog = findByAttribute(host, "aria-labelledby", "developPresetInventoryPickerTitle");
        assert.equal(inventoryDialog.open, true, "Add Presets may open after a failed refresh to show the truthful error");
        assert.match(compactStatus.textContent, /refresh failed: Lightroom inventory probe failed/);
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
        assert.equal(saveButton.disabled, false, "Only the genuine Alias draft edit may enable Save Configuration");

        const successfulRefresh = deferredRefresh();
        refreshResponses.push(successfulRefresh);
        const manualSuccess = refreshButton.dispatch("click");
        await flushAsync();
        assert.equal(inventoryRefreshCount, 2, "Refresh Presets must start one manual authoritative refresh");
        assert.equal(compactStatus.textContent, "Loading preset inventory…");
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
            { uuid: "uuid-delayed", alias: "Unsaved Draft Alias", updateAISettings: true },
            { uuid: "uuid-second", alias: "", updateAISettings: false }
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
        assert.match(compactStatus.textContent, /Refreshing preset inventory/);
        inventoryStatus = "error";
        inventoryError = "Second Lightroom inventory probe failed";
        failedRefresh.resolveState();
        await manualFailure;
        assert.deepEqual(controller.getState().inventory, retainedInventory,
            "A failed refresh after success must retain the previous authoritative snapshot");
        assert.match(compactStatus.textContent, /Continuing to use the previous successful inventory/);
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

async function webControllerAmountCoalescingTest() {
    const configuredEntry = {
        uuid: "uuid-serial",
        alias: null,
        updateAISettings: false,
        folder: "Test",
        name: "Serial",
        available: true,
        missing: false,
        error: null
    };
    let presetAmount = 100;
    let pendingOperation = null;
    let lastApplication = null;
    let operationCounter = 0;
    const submittedAmounts = [];
    let currentContext = {
        activeModule: "develop",
        selectedPhotoUuid: "photo-one",
        contextCounter: 1,
        developCounter: 1
    };

    function publicState() {
        return {
            ok: true,
            configuration: {
                version: 1,
                presets: [{ uuid: configuredEntry.uuid, updateAISettings: false }]
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
            presetAmount: presetAmount,
            controlsEnabled: true,
            pendingApplication: pendingOperation !== null,
            lastApplication: lastApplication ? Object.assign({}, lastApplication) : null
        };
    }

    async function fakeFetch(url) {
        if (url === "/api/develop-presets/state") {
            return { ok: true, async json() { return publicState(); } };
        }
        if (url.startsWith("/api/develop-presets/amount?")) {
            assert.equal(pendingOperation, null, "The client must never submit two preset applications concurrently");
            const parsed = new URL(url, "http://127.0.0.1");
            const amount = Number(parsed.searchParams.get("presetAmount"));
            operationCounter += 1;
            pendingOperation = { operationId: "serial-" + operationCounter, presetAmount: amount };
            lastApplication = Object.assign({ outcome: null, detail: "Waiting for Lightroom." }, pendingOperation);
            submittedAmounts.push(amount);
            return {
                ok: true,
                async json() { return { ok: true, operationId: pendingOperation.operationId }; }
            };
        }
        throw new Error("Unexpected serial Amount request: " + url);
    }

    function finishPending(outcome) {
        assert.ok(pendingOperation);
        if (outcome === presetDefinition.OUTCOME_OBSERVED || outcome === presetDefinition.OUTCOME_NO_CHANGE) {
            presetAmount = pendingOperation.presetAmount;
        }
        lastApplication = Object.assign({}, pendingOperation, { outcome: outcome, detail: "serial test result" });
        pendingOperation = null;
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
        assert.equal(amountRange.value, "100");

        for (let tap = 0; tap < 5; tap += 1) await incrementAmount.dispatch("click");
        await flushAsync();
        assert.deepEqual(submittedAmounts, [101],
            "Five rapid + taps must initially submit only the first serial target");
        assert.equal(amountRange.value, "105", "Five rapid + taps must update desired Amount immediately");
        assert.equal(incrementAmount.disabled, false, "+ must remain enabled during the in-flight application");
        assert.deepEqual(controller.getAmountState(), {
            committed: 100,
            desired: 105,
            submitted: 101,
            queued: 105
        });

        await controller.refresh();
        await controller.refresh();
        await controller.refresh();
        assert.equal(amountRange.value, "105",
            "Polling an older committed Amount must not overwrite the pending desired display");
        assert.deepEqual(submittedAmounts, [101]);

        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await flushAsync();
        assert.deepEqual(submittedAmounts, [101, 105],
            "After the first success, transport must skip all intermediate taps and submit only the latest target");
        assert.deepEqual(controller.getAmountState(), {
            committed: 101,
            desired: 105,
            submitted: 105,
            queued: null
        });

        finishPending(presetDefinition.OUTCOME_NO_CHANGE);
        await controller.refresh();
        assert.equal(amountRange.value, "105");
        assert.deepEqual(controller.getAmountState(), {
            committed: 105,
            desired: 105,
            submitted: null,
            queued: null
        }, "The final success must reconcile desired and committed Amount");

        await incrementAmount.dispatch("click");
        await incrementAmount.dispatch("click");
        await flushAsync();
        assert.deepEqual(submittedAmounts, [101, 105, 106]);
        finishPending(presetDefinition.OUTCOME_OBSERVED);
        await controller.refresh();
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await flushAsync();
        assert.deepEqual(submittedAmounts, [101, 105, 106, 107]);
        finishPending(presetDefinition.OUTCOME_FAILED);
        await controller.refresh();
        assert.equal(amountRange.value, "106", "A final failure must restore the last successful committed Amount");
        assert.deepEqual(controller.getAmountState(), {
            committed: 106,
            desired: 106,
            submitted: null,
            queued: null
        });

        await incrementAmount.dispatch("click");
        await incrementAmount.dispatch("click");
        await flushAsync();
        currentContext = {
            activeModule: "develop",
            selectedPhotoUuid: "photo-two",
            contextCounter: 2,
            developCounter: 2
        };
        controller.updateContext();
        assert.deepEqual(controller.getAmountState(), {
            committed: 106,
            desired: 106,
            submitted: null,
            queued: null
        }, "Photo/context drift must discard the queued target and restore the last success");
        finishPending(presetDefinition.OUTCOME_STALE);
        await controller.refresh();
        assert.equal(amountRange.value, "106");
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
    assert.deepEqual(presetDefinition.normalizeConfiguration({ version: 1, presets: [{ uuid: "default-ai" }] }), {
        version: 1, presets: [{ uuid: "default-ai", updateAISettings: false }]
    }, "updateAISettings must default to false");
    const requestId = state.beginInventoryRefresh();
    state.acceptInventoryItem(requestId, { uuid: "uuid-z", folder: "Z Folder", name: "Duplicate" });
    state.acceptInventoryItem(requestId, { uuid: "uuid-a", folder: "A Folder", name: "Duplicate" });
    state.acceptInventoryItem(requestId, { uuid: "uuid-b", folder: "B Folder", name: "Another" });
    assert.equal(state.completeInventoryRefresh(requestId), true);
    assert.deepEqual(state.getPublicState().inventory.map(function (entry) { return entry.uuid; }),
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
    const saved = webController.configurationFromDraft(draft);
    assert.deepEqual(saved, {
        version: 1,
        presets: [
            { uuid: "uuid-a", updateAISettings: true, alias: "Portrait" },
            { uuid: "missing-uuid", updateAISettings: false }
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

    const binding = { activeModule: "develop", selectedPhotoUuid: "photo", contextCounter: 4, developCounter: 7 };
    assert.throws(function () { state.beginApplication("uuid-a", binding); }, /integer from 0 through 200/);
    assert.throws(function () { state.beginApplication("uuid-a", binding, 1.5); }, /integer from 0 through 200/);
    const pending = state.beginApplication("uuid-a", binding, 100);
    const validTransportCommand = {
        command: "develop_preset.apply",
        operationId: pending.operationId,
        uuid: pending.uuid,
        presetAmount: pending.presetAmount,
        updateAISettings: pending.updateAISettings,
        expectedActiveModule: pending.expectedActiveModule,
        expectedSelectedPhotoUuid: pending.expectedSelectedPhotoUuid,
        expectedContextCounter: pending.expectedContextCounter,
        expectedDevelopCounter: pending.expectedDevelopCounter
    };
    assert.equal(commands.validateCommand(validTransportCommand), true);
    for (const invalidAmount of [undefined, "100", 1.5, -1, 201]) {
        const invalid = Object.assign({}, validTransportCommand);
        if (invalidAmount === undefined) delete invalid.presetAmount;
        else invalid.presetAmount = invalidAmount;
        assert.equal(commands.validateCommand(invalid), false,
            "Preset Amount must fail closed at command admission: " + invalidAmount);
    }
    assert.equal(state.applicationBindingMatches(pending, binding), true);
    assert.equal(state.applicationBindingMatches(pending, Object.assign({}, binding, { contextCounter: 5 })), false,
        "Context-counter drift must be rejected");
    assert.equal(state.applicationBindingMatches(pending, Object.assign({}, binding, { developCounter: 8 })), false,
        "Develop-counter drift must be rejected");
    assert.equal(state.applicationBindingMatches(pending, Object.assign({}, binding, { activeModule: "library" })), false,
        "Module drift must be rejected");
    state.rejectApplication(pending);

    const committed = state.beginApplication("uuid-a", binding, 137);
    assert.equal(state.finishApplication(committed.operationId, committed.uuid,
        presetDefinition.OUTCOME_NO_CHANGE, "committed before refresh"), true);
    assert.equal(state.getPublicState().presetAmount, 137);

    const failedRefresh = state.beginInventoryRefresh();
    const loadingWithSnapshot = state.getPublicState();
    assert.equal(loadingWithSnapshot.inventoryStatus, "loading");
    assert.equal(loadingWithSnapshot.inventoryLoaded, true);
    assert.equal(loadingWithSnapshot.configured[0].available, true,
        "A refresh in progress must retain the previous successful snapshot");
    assert.equal(loadingWithSnapshot.cursorUuid, "uuid-a");
    assert.equal(loadingWithSnapshot.presetAmount, 137);
    assert.equal(state.failInventoryRefresh(failedRefresh, "Lightroom is unavailable"), true);
    const retainedAfterFailure = state.getPublicState();
    assert.equal(retainedAfterFailure.inventoryStatus, "error");
    assert.match(retainedAfterFailure.inventoryError, /Lightroom is unavailable/);
    assert.equal(retainedAfterFailure.inventoryLoaded, true);
    assert.equal(retainedAfterFailure.controlsEnabled, true,
        "A failed refresh must keep the previous successful inventory usable");
    assert.deepEqual(retainedAfterFailure.inventory, publicState.inventory);
    assert.equal(retainedAfterFailure.cursorUuid, "uuid-a");
    assert.equal(retainedAfterFailure.presetAmount, 137,
        "A failed refresh must preserve the preset cursor and committed Amount");

    const changedInventory = state.beginInventoryRefresh();
    state.acceptInventoryItem(changedInventory, { uuid: "uuid-z", folder: "Z Folder", name: "Duplicate" });
    state.completeInventoryRefresh(changedInventory);
    const afterChangedInventory = state.getPublicState();
    assert.equal(afterChangedInventory.cursorUuid, "uuid-a",
        "A successful inventory-only refresh must not reset the preset cursor");
    assert.equal(afterChangedInventory.presetAmount, 137,
        "A successful inventory-only refresh must not change committed Amount");
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
            { uuid: "uuid-a", alias: "First", updateAISettings: false },
            { uuid: "missing-uuid", updateAISettings: false },
            { uuid: "uuid-b", updateAISettings: true },
            { uuid: "uuid-c", updateAISettings: false }
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
                { uuid: "uuid-a", alias: "First", updateAISettings: false },
                { uuid: "missing-uuid", updateAISettings: false },
                { uuid: "uuid-b", updateAISettings: true },
                { uuid: "uuid-c", updateAISettings: false }
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
                developCounter: fields.developCounter
            };
        }

        async function apply(uuid, fields) {
            const result = await request(port, "/develop-presets/apply?" + encodedQuery(Object.assign({ uuid: uuid }, bindingQuery(fields))));
            assert.equal(result.statusCode, 200, result.text);
            const command = commands.getNextCommand();
            assert.equal(command.uuid, uuid);
            assert.equal(command.presetAmount, 100, "Direct preset selection must default Amount to 100");
            assert.equal(Object.prototype.hasOwnProperty.call(command, "name"), false);
            assert.equal(command.expectedActiveModule, "develop");
            return command;
        }

        async function navigate(direction, fields, expectedUuid) {
            const result = await request(port, "/develop-presets/navigate?" + encodedQuery(Object.assign({ direction: direction }, bindingQuery(fields))));
            assert.equal(result.statusCode, 200, result.text);
            const command = commands.getNextCommand();
            assert.equal(command.uuid, expectedUuid);
            assert.equal(command.presetAmount, 100, "Previous/Next must default Amount to 100");
            return command;
        }

        async function applyAmount(amount, fields) {
            const result = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
                presetAmount: amount
            }, bindingQuery(fields))));
            assert.equal(result.statusCode, 200, result.text);
            const command = commands.getNextCommand();
            assert.equal(command.presetAmount, Number(amount));
            return command;
        }

        async function finish(command, outcome) {
            const result = await request(port, "/develop-presets/apply-result?" + encodedQuery({
                operationId: command.operationId,
                uuid: command.uuid,
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
        const beforeSuccessfulPreset = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 100
        }, bindingQuery(fields))));
        assert.equal(beforeSuccessfulPreset.statusCode, 409,
            "Amount must stay unavailable until a configured preset application succeeds");
        assert.equal(commands.getNextCommand(), null);
        let command = await apply("uuid-b", fields);
        assert.equal(command.updateAISettings, true);
        assert.equal(bridge.getDevelopPresetState().cursorUuid, "uuid-a",
            "Cursor must not move before the Lightroom SDK result");
        let state = await finish(command, presetDefinition.OUTCOME_OBSERVED);
        assert.equal(state.cursorUuid, "uuid-b");
        assert.equal(state.presetAmount, 100);

        command = await applyAmount(135, fields);
        const overlappingAmount = await request(port, "/develop-presets/amount?" + encodedQuery(Object.assign({
            presetAmount: 140
        }, bindingQuery(fields))));
        assert.equal(overlappingAmount.statusCode, 409,
            "Server admission must reject a second preset application while Lightroom is still processing one");
        assert.match(overlappingAmount.body.error, /current Develop preset application/i);
        assert.equal(commands.getNextCommand(), null, "Rejected overlap must not flood the Lightroom command queue");
        state = await finish(command, presetDefinition.OUTCOME_NO_CHANGE);
        assert.equal(state.cursorUuid, "uuid-b");
        assert.equal(state.presetAmount, 135, "Successful Amount reapplication must commit Amount");

        command = await applyAmount(80, fields);
        state = await finish(command, presetDefinition.OUTCOME_FAILED);
        assert.equal(state.cursorUuid, "uuid-b");
        assert.equal(state.presetAmount, 135, "Failed Amount reapplication must preserve committed Amount");

        command = await apply("uuid-b", fields);
        state = await finish(command, presetDefinition.OUTCOME_NO_CHANGE);
        assert.equal(state.cursorUuid, "uuid-b", "Explicitly choosing the cursor preset must reapply it");
        assert.equal(state.presetAmount, 100);

        command = await navigate("next", fields, "uuid-c");
        state = await finish(command, presetDefinition.OUTCOME_NO_CHANGE);
        assert.equal(state.cursorUuid, "uuid-c", "Next must skip the unavailable configured UUID");
        command = await navigate("next", fields, "uuid-a");
        state = await finish(command, presetDefinition.OUTCOME_OBSERVED);
        assert.equal(state.cursorUuid, "uuid-a", "Next must wrap around");
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
    assert.match(controller, /Previous Preset/);
    assert.match(controller, /currentLabel\.textContent = "Preset to apply"/);
    assert.match(controller, /develop-preset-current-button/);
    assert.match(controller, /Next Preset/);
    assert.match(controller, /amountRange\.type = "range"/);
    assert.match(controller, /amountRange\.min = "0"/);
    assert.match(controller, /amountRange\.max = "200"/);
    assert.match(controller, /amountRange\.step = "1"/);
    assert.match(controller, /amountNumber\.type = "text"/);
    assert.match(controller, /const createTreatmentPresentation = options\.createTreatmentPresentation/,
        "Presets must consume the main controller's shared treatment renderer");
    assert.match(controller,
        /rootElement\.append\(title, row, amountRow, treatmentBlock, compactStatus, manageButton, managerPanel\)/,
        "Treatment must render after Amount and before compact status and Manage Presets");
    assert.match(controller,
        /Some presets preserve the current treatment\. Switch back to Color here after using a B&W preset\./);
    assert.match(controllerHtml,
        /\.develop-preset-treatment \.basic-controls-row\s*\{[\s\S]*margin-bottom:\s*6px/,
        "The Presets treatment presentation must retain the shared touch-friendly Basic controls styling");
    assert.match(controller,
        /if \(treatmentPresentation && typeof treatmentPresentation\.dispose === "function"\)[\s\S]*treatmentPresentation\.dispose\(\)/,
        "Presets tab deactivation must unregister its shared treatment presentation");
    assert.match(controller, /currentCursorUsesAi\(\)[\s\S]*queueAmount\(amount, false\)/,
        "AI preset dragging must bypass continuous throttled submission");
    assert.match(controller, /pointerup[\s\S]*queueAmount\(amount, true\)/);
    assert.match(controller, /makeButton\("Reset"[\s\S]*queueAmount\(100, true\)/);
    assert.match(controller, /\/api\/develop-presets\/amount\?presetAmount=/);
    assert.match(controller, /Manage Presets/);
    assert.match(controller, /managerPanel\.hidden = true/,
        "Web Controller manager must be collapsed by default");
    assert.doesNotMatch(controller, /createElement\("select"\)|<select/i,
        "Develop Presets must use no native HTML select controls");
    assert.match(controller, /makeButton\("\+ Add Presets"/);
    assert.match(controller, /makeButton\("Refresh Presets", "develop-preset-refresh secondary", refreshInventory\)/,
        "Manage Presets must expose the dedicated touch-sized Refresh Presets action");
    assert.match(controller,
        /makeButton\("\+ Add Presets"[\s\S]*return refreshInventory\(\)\.then\(function \(\) \{[\s\S]*openPicker\(inventoryPicker, addPresetsButton\)/,
        "+ Add Presets must finish the shared authoritative refresh before opening the picker");
    assert.match(controller, /if \(inventoryRefreshPromise\) return inventoryRefreshPromise/,
        "Every browser inventory trigger must coalesce onto one shared refresh promise");
    assert.match(controller,
        /data\.inventoryStatus === "not-loaded" && !inventorySnapshotLoaded\(data\)[\s\S]*refreshInventory\(\)/,
        "First Presets activation must auto-refresh only a current-process not-loaded inventory");
    assert.match(controller, /makeButton\("Add selected"/);
    assert.match(controller, /Alias \(optional\)/);
    assert.match(controller, /Update AI settings/);
    assert.match(controller, /Move Up/);
    assert.match(controller, /Move Down/);
    assert.match(controller, /Remove/);
    assert.match(controller, /makeButton\("Save Configuration"/);
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
    assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB/,
        "The browser must not persist a duplicate preset configuration");
    assert.match(controller, /Unavailable/);
    assert.match(controller, /missing UUID/);
    assert.match(controller, /entry\.missing === true \? " \(missing UUID\)" : ""/,
        "Compact labels must rely on authoritative missing proof");
    assert.match(controller, /const missing = snapshotLoaded && !item/,
        "Manager rows must not infer missing UUIDs before a successful snapshot exists");
    assert.match(controller, /state\.pendingApplication/);
    assert.match(controller, /const isCursor = entry\.uuid === state\.cursorUuid[\s\S]*submitPresetAtDefaultAmount\(applicationPath\(entry\.uuid\)\)/,
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
    assert.match(controller, /lastSuccessfulCommittedAmount[\s\S]*desiredAmount[\s\S]*submittedAmount[\s\S]*latestQueuedAmount/,
        "Preset Amount must track committed, desired, submitted, and latest queued values separately");
    assert.match(controller, /const blockedByOtherApplication = pending && !ownAmountChainPending[\s\S]*amountDecrementButton\.disabled = !enabled \|\| desiredAmount <= 0[\s\S]*amountIncrementButton\.disabled = !enabled \|\| desiredAmount >= 200/,
        "Amount step controls must remain available during their own serial chain except at bounds");
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
    assert.equal((controllerHtml.match(/createTreatmentPresentation\(/g) || []).length, 3,
        "One treatment factory plus exactly two call sites must serve Develop Sliders and Presets");
    assert.match(controllerHtml,
        /createTreatmentPresentation: function \(\) \{\s*return createTreatmentPresentation\(null, "develop-preset-treatment-row"\);\s*\}/,
        "Presets must receive the same treatment renderer as Develop Sliders");
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
    assert.match(lua, /capturedPhoto:applyDevelopPreset\(preset, _PLUGIN, command\.presetAmount, command\.updateAISettings\)/,
        "Preset Amount must be the third SDK argument and updateAISettings must remain fourth");
    assert.match(lua, /gateFingerprint ~= beforeFingerprint/);
    assert.match(lua, /not serverContextMatches\(command\)/);
    const commandSource = fs.readFileSync(path.join(root, "server/commands.js"), "utf8");
    const presetServerSource = fs.readFileSync(path.join(root, "server/develop-presets.js"), "utf8");
    const bridgeSource = fs.readFileSync(path.join(root, "server/bridge.js"), "utf8");
    assert.match(presetServerSource, /pendingApplications\.size > 0[\s\S]*Wait for the current Develop preset application to finish/,
        "Server admission must reject overlapping preset SDK applications");
    assert.match(commandSource, /develop_preset\.apply[\s\S]*developPresetAdmissionProvider\.matches/,
        "Preset commands must revalidate at queue admission");
    assert.match(commandSource, /function getNextCommand\(\)[\s\S]*develop_preset\.apply[\s\S]*developPresetAdmissionProvider\.matches/,
        "Preset commands must revalidate at dequeue");
    assert.match(bridgeSource,
        /currentState\.inventoryStatus === "loading" && currentState\.inventoryRequestId[\s\S]*return currentState/,
        "The server must coalesce concurrent inventory requests before queue admission");
    assert.doesNotMatch(lua, /getTargetPhotos|applyDevelopPreset\(photos|undo/i,
        "Preset application must target only the captured single photo and perform no automatic Undo");
    assert.match(parser, /local updateAISettings = parseBooleanField\(json, "updateAISettings"\)/);
    assert.match(parser, /local presetAmount = parseIntegerField\(json, "presetAmount"\)/);

    const inline = controllerHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(inline);
    new vm.Script(inline[1], { filename: "controller-inline.js" });
}

async function main() {
    try {
        configurationAndOrderingTests();
        await webControllerInventorySelectionPersistenceTest();
        await webControllerInventoryRefreshLifecycleTest();
        await webControllerAmountCoalescingTest();
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
