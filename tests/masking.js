"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const maskingDefinition = require("../server/masking-state");
const maskingUi = require("../app/controller-masking");
const { createBridge } = require("../server/bridge");

const root = path.join(__dirname, "..");
const runtimeInventoryFixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, "masking-lr15.3-inventory-fixture.json"), "utf8"));
const RUNTIME_GROUP_FIELDS = new Set(["ID", "Name", "Hidden", "Tools"]);
const RUNTIME_TOOL_FIELDS = new Set([
    "ID", "Name", "Type", "Subtype", "Hidden", "Inverted", "MaskSubCategoryID"
]);

function validFixtureId(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(value);
}

function optionalFixtureField(container, key, expectedType) {
    return container[key] === undefined || typeof container[key] === expectedType;
}

function normalizeRuntimeInventoryFixture(inventory) {
    if (!Array.isArray(inventory) || inventory.length > 512) return null;
    const maskIds = new Set();
    const toolIds = new Set();
    const normalized = [];
    for (const mask of inventory) {
        if (!mask || typeof mask !== "object" || Array.isArray(mask) || !validFixtureId(mask.ID) ||
            maskIds.has(mask.ID) || !optionalFixtureField(mask, "Name", "string") ||
            !optionalFixtureField(mask, "Hidden", "boolean") ||
            Object.keys(mask).some(function (key) { return !RUNTIME_GROUP_FIELDS.has(key); }) ||
            !Array.isArray(mask.Tools) || mask.Tools.length < 1 || mask.Tools.length > 2048) return null;
        maskIds.add(mask.ID);
        const tools = [];
        for (const tool of mask.Tools) {
            if (!tool || typeof tool !== "object" || Array.isArray(tool) || !validFixtureId(tool.ID) ||
                toolIds.has(tool.ID) || !optionalFixtureField(tool, "Name", "string") ||
                !optionalFixtureField(tool, "Type", "string") ||
                !optionalFixtureField(tool, "Subtype", "string") ||
                !optionalFixtureField(tool, "Hidden", "boolean") ||
                !optionalFixtureField(tool, "Inverted", "boolean") ||
                (tool.MaskSubCategoryID !== undefined &&
                    (typeof tool.MaskSubCategoryID !== "number" || !Number.isFinite(tool.MaskSubCategoryID))) ||
                Object.keys(tool).some(function (key) { return !RUNTIME_TOOL_FIELDS.has(key); })) return null;
            toolIds.add(tool.ID);
            tools.push({ ID: tool.ID });
        }
        normalized.push({ ID: mask.ID, Tools: tools });
    }
    return normalized;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function context(overrides) {
    return Object.assign({
        activeModule: "develop", selectedPhotoUuid: "photo-1", contextCounter: 7,
        developCounter: 12, contextChangedAt: 1234
    }, overrides || {});
}

function snapshot(overrides) {
    return Object.assign({
        available: true, unavailableReason: null, active: true, maskGroupCount: 3,
        hasSelectedMaskGroup: true, selectedMaskGroupIndex: 2, selectedMaskGroupId: "mask-b",
        previousAvailable: true, nextAvailable: true, selectedMaskToolAvailable: true,
        selectedMaskToolId: "tool-b1"
    }, overrides || {});
}

function suppliedBinding(state) {
    return {
        selectedPhotoUuid: state.selectedPhotoUuid,
        contextCounter: state.contextCounter,
        developCounter: state.developCounter,
        contextChangedAt: state.contextChangedAt,
        serverEpoch: state.serverEpoch,
        revision: state.revision
    };
}

class FakeClassList {
    constructor() { this.values = new Set(); }
    add() { for (const value of arguments) this.values.add(value); }
    contains(value) { return this.values.has(value); }
    reset(value) {
        this.values.clear();
        String(value || "").split(/\s+/).filter(Boolean).forEach(this.values.add.bind(this.values));
    }
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName).toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.disabled = false;
        this.type = "";
        this._className = "";
        this._textContent = "";
        this.classList = new FakeClassList();
    }
    get className() { return this._className; }
    set className(value) {
        this._className = String(value);
        this.classList.reset(this._className);
    }
    get textContent() { return this._textContent; }
    set textContent(value) {
        this._textContent = String(value);
        for (const child of this.children) child.parentElement = null;
        this.children = [];
    }
    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    remove() {
        if (!this.parentElement) return;
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }
    click() {
        if (this.disabled) return false;
        const event = { type: "click", target: this, preventDefault() {} };
        for (const listener of this.listeners.get("click") || []) listener(event);
        return true;
    }
}

class FakeDocument {
    createElement(tagName) { return new FakeElement(tagName, this); }
}

function findElement(rootElement, predicate) {
    if (predicate(rootElement)) return rootElement;
    for (const child of rootElement.children || []) {
        const match = findElement(child, predicate);
        if (match) return match;
    }
    return null;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise(function (resolvePromise, rejectPromise) {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise: promise, resolve: resolve, reject: reject };
}

function jsonResponse(body, status) {
    const statusCode = status === undefined ? 200 : status;
    return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        json: async function () { return clone(body); }
    };
}

async function flushAsync(rounds) {
    for (let index = 0; index < (rounds || 8); index += 1) {
        await new Promise(function (resolve) { setImmediate(resolve); });
    }
}

function renderedControllerState(options) {
    options = options || {};
    const fields = options.context || context();
    const active = options.active !== false;
    const count = options.count === undefined ? 5 : options.count;
    const index = active && count > 0 ? (options.index === undefined ? 1 : options.index) : null;
    return {
        ok: true,
        serverEpoch: options.serverEpoch || "mask-rendered",
        revision: options.revision === undefined ? 1 : options.revision,
        capturedAt: Date.now(),
        selectedPhotoUuid: fields.selectedPhotoUuid,
        contextCounter: fields.contextCounter,
        developCounter: fields.developCounter,
        contextChangedAt: fields.contextChangedAt,
        pendingOperation: options.pendingOperation || null,
        lastResult: options.lastResult || null,
        available: true,
        unavailableReason: null,
        active: active,
        maskGroupCount: count,
        hasSelectedMaskGroup: active ? count > 0 : null,
        selectedMaskGroupIndex: index,
        selectedMaskGroupId: index === null ? null : "mask-" + index,
        previousAvailable: index !== null && index > 1,
        nextAvailable: index !== null && index < count,
        selectedMaskToolAvailable: index !== null,
        selectedMaskToolId: index === null ? null : "tool-" + index
    };
}

async function createRenderedMaskingHarness(options) {
    options = options || {};
    const documentObject = new FakeDocument();
    const host = documentObject.createElement("div");
    let currentContext = options.context || context();
    let authoritative = renderedControllerState({
        context: currentContext,
        serverEpoch: options.serverEpoch,
        revision: options.revision,
        active: options.active,
        count: options.count,
        index: options.index
    });
    let pendingServerOperation = null;
    let operationCounter = 0;
    let maximumPending = 0;
    const commandRequests = [];
    const stateResponses = [];
    const admissions = [];

    const fetchImpl = async function (requestPath) {
        if (requestPath === "/api/masking/state") {
            const responseState = stateResponses.length > 0 ? stateResponses.shift() : authoritative;
            return jsonResponse(responseState);
        }
        const parsed = new URL(requestPath, "http://controller.test");
        const navigation = parsed.pathname === "/api/masking/group/navigate";
        const panel = parsed.pathname === "/api/masking/panel";
        if (!navigation && !panel) throw new Error("Unexpected Masking request: " + requestPath);
        const record = {
            path: parsed.pathname,
            direction: parsed.searchParams.get("direction"),
            open: parsed.searchParams.get("open"),
            selectedPhotoUuid: parsed.searchParams.get("selectedPhotoUuid"),
            contextCounter: Number(parsed.searchParams.get("contextCounter")),
            developCounter: Number(parsed.searchParams.get("developCounter")),
            contextChangedAt: Number(parsed.searchParams.get("contextChangedAt")),
            serverEpoch: parsed.searchParams.get("serverEpoch"),
            stateRevision: Number(parsed.searchParams.get("stateRevision")),
            responseStatus: null,
            responseBody: null
        };
        commandRequests.push(record);
        const admission = admissions.length > 0 ? admissions.shift() : {};
        if (admission.gate) await admission.gate.promise;
        if (options.identicalBackgroundBeforeCommands === true) {
            authoritative = Object.assign({}, authoritative, { capturedAt: authoritative.capturedAt + 1 });
        }
        record.serverRevisionAtAdmission = authoritative.revision;
        if (admission.status && admission.status >= 400) {
            record.responseStatus = admission.status;
            record.responseBody = admission.body;
            return jsonResponse(admission.body, admission.status);
        }
        if (record.stateRevision !== authoritative.revision) {
            record.responseStatus = 409;
            record.responseBody = {
                ok: false,
                error: "Masking state changed or the requested action is unavailable"
            };
            return jsonResponse(record.responseBody, record.responseStatus);
        }
        assert.equal(pendingServerOperation, null, "the rendered controller overlapped Lightroom operations");
        operationCounter += 1;
        const operationId = "rendered-op-" + operationCounter;
        pendingServerOperation = navigation ? {
            operationId: operationId,
            kind: "navigate",
            direction: record.direction,
            beforeIndex: authoritative.selectedMaskGroupIndex
        } : {
            operationId: operationId,
            kind: "panel",
            open: record.open === "true",
            beforeIndex: authoritative.selectedMaskGroupIndex
        };
        maximumPending = Math.max(maximumPending, pendingServerOperation ? 1 : 0);
        authoritative = Object.assign({}, authoritative, {
            revision: authoritative.revision + 1,
            pendingOperation: Object.assign({}, pendingServerOperation)
        });
        const body = {
            ok: true,
            operationId: operationId,
            serverEpoch: authoritative.serverEpoch,
            revision: authoritative.revision,
            pendingOperation: Object.assign({}, pendingServerOperation)
        };
        record.responseStatus = 200;
        record.responseBody = body;
        return jsonResponse(body);
    };

    const controller = maskingUi.createController({
        document: documentObject,
        fetch: fetchImpl,
        getContext: function () { return currentContext; },
        setInterval: function () { return 1; },
        clearInterval: function () {}
    });
    controller.activate(host);
    await flushAsync();

    function control(className) {
        return findElement(host, function (element) { return element.classList.contains(className); });
    }

    async function settle(outcome, detail, overrides) {
        assert.ok(pendingServerOperation, "a Lightroom operation must be pending before settlement");
        const operation = pendingServerOperation;
        pendingServerOperation = null;
        let active = authoritative.active;
        let selectedIndex = operation.beforeIndex;
        if (outcome === "confirmed") {
            if (operation.kind === "navigate") {
                selectedIndex += operation.direction === "previous" ? -1 : 1;
            } else {
                active = operation.open;
                selectedIndex = active && authoritative.maskGroupCount > 0 ? (selectedIndex || 1) : null;
            }
        }
        overrides = overrides || {};
        authoritative = renderedControllerState({
            context: currentContext,
            serverEpoch: authoritative.serverEpoch,
            revision: authoritative.revision + 1,
            active: overrides.active === undefined ? active : overrides.active,
            count: overrides.count === undefined ? authoritative.maskGroupCount : overrides.count,
            index: overrides.index === undefined ? selectedIndex : overrides.index,
            lastResult: {
                operationId: operation.operationId,
                outcome: outcome,
                detail: detail || null,
                completedAt: Date.now()
            }
        });
        await controller.refresh();
        await flushAsync();
    }

    async function publish(nextState) {
        authoritative = nextState;
        pendingServerOperation = null;
        await controller.refresh();
        await flushAsync();
    }

    return {
        controller: controller,
        host: host,
        panel: control("masking-panel-button"),
        previous: control("masking-navigation-button"),
        next: (function () {
            const first = control("masking-navigation-button");
            return findElement(host, function (element) {
                return element !== first && element.classList.contains("masking-navigation-button");
            });
        })(),
        position: control("masking-position"),
        status: control("masking-status"),
        commandRequests: commandRequests,
        admissions: admissions,
        stateResponses: stateResponses,
        settle: settle,
        publish: publish,
        getAuthoritative: function () { return authoritative; },
        getPending: function () { return pendingServerOperation; },
        getMaximumPending: function () { return maximumPending; },
        replaceContext: async function (nextContext, stateOptions) {
            currentContext = nextContext;
            pendingServerOperation = null;
            authoritative = renderedControllerState(Object.assign({ context: currentContext }, stateOptions || {}));
            controller.updateContext(currentContext);
            await flushAsync();
        },
        close: function () { controller.deactivate(); }
    };
}

function testStateMachine() {
    let now = 10000;
    const state = maskingDefinition.createMaskingState({ serverEpoch: "mask-test", now: function () { return now; } });
    const fields = context();
    assert.equal(state.syncContext(fields), true);
    assert.equal(state.requestRefresh(fields, true), true);
    const request = state.takeRequest();
    assert.equal(request.command, "masking.query");
    assert.equal(request.expectedSelectedPhotoUuid, "photo-1");
    assert.equal(state.acceptQueryResult(Object.assign({}, request, { snapshot: snapshot() }), fields), true);
    let publicState = state.getPublicState();
    assert.equal(publicState.revision, 2);
    assert.equal(publicState.selectedMaskGroupIndex, 2);
    assert.equal(state.acceptQueryResult(Object.assign({}, request, { snapshot: snapshot() }), fields), false,
        "a completed query must not be accepted twice");

    const operation = state.beginOperation({ kind: "navigate", direction: "next" }, suppliedBinding(publicState), fields);
    assert.equal(operation.command, "masking.group.navigate");
    assert.equal(operation.expectedSelectedMaskId, "mask-b");
    assert.equal(state.beginOperation({ kind: "navigate", direction: "next" }, suppliedBinding(publicState), fields), null,
        "rapid navigation must not overlap an authoritative operation");
    assert.equal(state.commandMatches(operation, fields), true);
    assert.equal(state.finishOperation(Object.assign({}, operation, {
        outcome: "confirmed", detail: "", snapshot: snapshot({
            selectedMaskGroupIndex: 3, selectedMaskGroupId: "mask-c", previousAvailable: true,
            nextAvailable: false, selectedMaskToolId: "tool-c1"
        })
    }), fields), true);
    publicState = state.getPublicState();
    assert.equal(publicState.nextAvailable, false);
    assert.equal(state.beginOperation({ kind: "navigate", direction: "next" }, suppliedBinding(publicState), fields), null,
        "Next must be bounded at the final mask");

    const previous = state.beginOperation({ kind: "navigate", direction: "previous" }, suppliedBinding(publicState), fields);
    assert.ok(previous);
    assert.equal(state.rejectCommand(previous, "Context changed"), true);
    assert.equal(state.getPublicState().capturedAt, null, "a rejected queued command must force fresh readback");

    now += 10;
    assert.equal(state.requestRefresh(fields, true), true);
    const refreshed = state.takeRequest();
    const closed = snapshot({
        active: false, hasSelectedMaskGroup: null, selectedMaskGroupIndex: null, selectedMaskGroupId: null,
        previousAvailable: false, nextAvailable: false, selectedMaskToolAvailable: false, selectedMaskToolId: null
    });
    assert.equal(state.acceptQueryResult(Object.assign({}, refreshed, { snapshot: closed }), fields), true);
    publicState = state.getPublicState();
    const open = state.beginOperation({ kind: "panel", open: true }, suppliedBinding(publicState), fields);
    assert.ok(open);
    assert.equal(state.commandMatches(open, context({ selectedPhotoUuid: "photo-2" })), false);
    state.syncContext(context({ selectedPhotoUuid: "photo-2", contextCounter: 8, contextChangedAt: 5678 }));
    assert.equal(state.getPublicState().pendingOperation, null);
    assert.equal(state.getPublicState().lastResult.outcome, "stale");

    assert.equal(maskingDefinition.sanitizeSnapshot(snapshot({ selectedMaskGroupIndex: 1, previousAvailable: true })), null,
        "derived navigation flags must be exact");
    assert.equal(maskingDefinition.sanitizeSnapshot({ available: false, unavailableReason: "sdk_error" }).available, false);

    let staleNow = 20000;
    const stale = maskingDefinition.createMaskingState({ serverEpoch: "mask-stale", now: function () { return staleNow; } });
    stale.syncContext(fields);
    stale.requestRefresh(fields, true);
    const staleRequest = stale.takeRequest();
    assert.equal(stale.acceptQueryResult(Object.assign({}, staleRequest, { snapshot: snapshot() }), fields), true);
    const stalePublic = stale.getPublicState();
    staleNow += maskingDefinition.SNAPSHOT_FRESH_MS + 1;
    assert.equal(stale.beginOperation({ kind: "navigate", direction: "next" }, suppliedBinding(stalePublic), fields), null,
        "commands must not use an expired Masking snapshot");

    const unreconciled = maskingDefinition.createMaskingState({ serverEpoch: "mask-unreconciled" });
    unreconciled.syncContext(fields);
    unreconciled.requestRefresh(fields, true);
    const unreconciledRequest = unreconciled.takeRequest();
    unreconciled.acceptQueryResult(Object.assign({}, unreconciledRequest, { snapshot: snapshot() }), fields);
    const unreconciledPublic = unreconciled.getPublicState();
    const unreconciledOperation = unreconciled.beginOperation(
        { kind: "navigate", direction: "next" }, suppliedBinding(unreconciledPublic), fields);
    assert.equal(unreconciled.finishOperation(Object.assign({}, unreconciledOperation, {
        outcome: "confirmed", detail: "", snapshot: snapshot({
            selectedMaskGroupIndex: 1, selectedMaskGroupId: "mask-a", previousAvailable: false,
            nextAvailable: true, selectedMaskToolId: "tool-a1"
        })
    }), fields), true);
    assert.equal(unreconciled.getPublicState().lastResult.outcome, "failed",
        "an SDK result that does not match the requested direction must settle safely as failure");
    assert.equal(unreconciled.getPublicState().pendingOperation, null);
}

function testSemanticRevisionFreshness() {
    let now = 30000;
    const fields = context();

    function readyState(epoch, initialSnapshot) {
        const machine = maskingDefinition.createMaskingState({
            serverEpoch: epoch,
            now: function () { return now; }
        });
        machine.syncContext(fields);
        assert.equal(machine.requestRefresh(fields, true), true);
        const request = machine.takeRequest();
        assert.equal(machine.acceptQueryResult(Object.assign({}, request, {
            snapshot: initialSnapshot || snapshot()
        }), fields), true);
        return machine;
    }

    let machine = readyState("mask-semantic-panel");
    let publicState = machine.getPublicState();
    const panelRevision = publicState.revision;
    const firstCapturedAt = publicState.capturedAt;
    now += 500;
    assert.equal(machine.requestRefresh(fields, false), true);
    let request = machine.takeRequest();
    assert.equal(machine.acceptQueryResult(Object.assign({}, request, { snapshot: snapshot() }), fields), true);
    publicState = machine.getPublicState();
    assert.equal(publicState.revision, panelRevision,
        "an identical SDK snapshot must not change the command-binding revision");
    assert.ok(publicState.capturedAt > firstCapturedAt,
        "an identical SDK snapshot must still refresh capturedAt");
    const close = machine.beginOperation({ kind: "panel", open: false }, suppliedBinding(publicState), fields);
    assert.ok(close, "a panel command using the pre-refresh semantic revision must remain admissible");

    machine = readyState("mask-semantic-navigation");
    publicState = machine.getPublicState();
    const navigationRevision = publicState.revision;
    now += 500;
    machine.requestRefresh(fields, false);
    request = machine.takeRequest();
    assert.equal(machine.acceptQueryResult(Object.assign({}, request, { snapshot: snapshot() }), fields), true);
    assert.equal(machine.getPublicState().revision, navigationRevision);
    const navigation = machine.beginOperation(
        { kind: "navigate", direction: "next" }, suppliedBinding(publicState), fields);
    assert.ok(navigation, "a navigation command using the pre-refresh semantic revision must remain admissible");

    machine = readyState("mask-semantic-change");
    const staleBinding = suppliedBinding(machine.getPublicState());
    now += 500;
    machine.requestRefresh(fields, false);
    request = machine.takeRequest();
    const externallyChanged = snapshot({
        selectedMaskGroupIndex: 3,
        selectedMaskGroupId: "mask-c",
        previousAvailable: true,
        nextAvailable: false,
        selectedMaskToolId: "tool-c1"
    });
    assert.equal(machine.acceptQueryResult(Object.assign({}, request, { snapshot: externallyChanged }), fields), true);
    assert.equal(machine.getPublicState().revision, staleBinding.revision + 1,
        "a command-relevant Lightroom change must advance the semantic revision");
    assert.equal(machine.beginOperation({ kind: "navigate", direction: "previous" }, staleBinding, fields), null,
        "a command using the prior semantic revision must remain stale");

    machine = readyState("mask-query-order");
    now += 500;
    machine.requestRefresh(fields, false);
    const older = machine.takeRequest();
    now += 3000;
    machine.requestRefresh(fields, true);
    const newer = machine.takeRequest();
    assert.notEqual(older.requestId, newer.requestId, "every authoritative query must retain a unique request ID");
    assert.equal(machine.acceptQueryResult(Object.assign({}, older, { snapshot: snapshot() }), fields), false,
        "an out-of-order query result must remain rejected");
    assert.equal(machine.acceptQueryResult(Object.assign({}, newer, { snapshot: snapshot() }), fields), true);
    assert.equal(machine.acceptQueryResult(Object.assign({}, newer, { snapshot: snapshot() }), fields), false,
        "a duplicated completed query result must remain rejected");

    machine = readyState("mask-command-during-query");
    publicState = machine.getPublicState();
    now += 500;
    machine.requestRefresh(fields, false);
    const outstanding = machine.takeRequest();
    const duringQuery = machine.beginOperation(
        { kind: "navigate", direction: "next" }, suppliedBinding(publicState), fields);
    assert.ok(duringQuery, "an identical refresh window must not block a valid command at the current revision");
    assert.equal(machine.acceptQueryResult(Object.assign({}, outstanding, { snapshot: snapshot() }), fields), false,
        "a query invalidated by command admission must not settle afterward");

    machine = readyState("mask-idle-polling");
    const idleRevision = machine.getPublicState().revision;
    for (let index = 0; index < 8; index += 1) {
        now += 500;
        assert.equal(machine.requestRefresh(fields, false), true);
        request = machine.takeRequest();
        assert.equal(machine.acceptQueryResult(Object.assign({}, request, { snapshot: snapshot() }), fields), true);
        assert.equal(machine.getPublicState().revision, idleRevision,
            "repeated idle polling must not churn the semantic revision");
    }

    assert.equal(maskingDefinition.sameSemanticSnapshot(snapshot(), snapshot()), true);
    assert.equal(maskingDefinition.sameSemanticSnapshot(snapshot(), snapshot({ selectedMaskToolId: "tool-new" })), false,
        "selected tool changes must remain command-relevant semantic changes");
}

function testLightroom153RuntimeInventoryFixture() {
    const before = JSON.stringify(runtimeInventoryFixture);
    const normalized = normalizeRuntimeInventoryFixture(runtimeInventoryFixture.allMasks);
    assert.ok(normalized, "the captured Lightroom 15.3 nested Tools structure must be recognized");
    assert.equal(normalized.length, 2, "the two captured mask groups must remain distinct");
    assert.deepEqual(normalized.map(function (mask) { return mask.ID; }),
        ["mask-runtime-a", "mask-runtime-b"]);
    assert.deepEqual(normalized.map(function (mask) { return mask.Tools[0].ID; }),
        ["tool-runtime-a1", "tool-runtime-b1"]);
    const selectedIndex = normalized.findIndex(function (mask) {
        return mask.ID === runtimeInventoryFixture.selectedMaskId;
    });
    assert.equal(selectedIndex, 1, "the captured selected group ID must reconcile to group two");
    assert.equal(normalized[selectedIndex].Tools.some(function (tool) {
        return tool.ID === runtimeInventoryFixture.selectedMaskToolId;
    }), true, "the captured selected tool ID must reconcile inside the selected group's Tools array");

    const runtimeSnapshot = snapshot({
        maskGroupCount: normalized.length,
        selectedMaskGroupIndex: selectedIndex + 1,
        selectedMaskGroupId: runtimeInventoryFixture.selectedMaskId,
        previousAvailable: selectedIndex > 0,
        nextAvailable: selectedIndex + 1 < normalized.length,
        selectedMaskToolAvailable: true,
        selectedMaskToolId: runtimeInventoryFixture.selectedMaskToolId
    });
    assert.ok(maskingDefinition.sanitizeSnapshot(runtimeSnapshot));
    const ctx = context();
    const authoritative = Object.assign({ ok: true, serverEpoch: "runtime-fixture", revision: 1 }, ctx, runtimeSnapshot);
    let presentation = maskingUi.present(authoritative, ctx, null);
    assert.equal(presentation.position, "Mask 2 of 2");
    assert.equal(presentation.previousDisabled, false);
    assert.equal(presentation.nextDisabled, true, "Next must remain bounded at the captured final group");
    presentation = maskingUi.present(Object.assign({}, authoritative, {
        selectedMaskGroupIndex: 1,
        selectedMaskGroupId: normalized[0].ID,
        previousAvailable: false,
        nextAvailable: true,
        selectedMaskToolId: normalized[0].Tools[0].ID
    }), ctx, null);
    assert.equal(presentation.position, "Mask 1 of 2");
    assert.equal(presentation.previousDisabled, true, "Previous must remain bounded at the first group");
    assert.equal(presentation.nextDisabled, false);
    assert.equal(JSON.stringify(runtimeInventoryFixture), before,
        "inventory normalization and state presentation must not mutate the Lightroom fixture");

    const optionalMetadataMissing = clone(runtimeInventoryFixture.allMasks);
    delete optionalMetadataMissing[0].Name;
    delete optionalMetadataMissing[0].Hidden;
    delete optionalMetadataMissing[0].Tools[0].Name;
    delete optionalMetadataMissing[0].Tools[0].Type;
    delete optionalMetadataMissing[0].Tools[0].Subtype;
    delete optionalMetadataMissing[0].Tools[0].Hidden;
    delete optionalMetadataMissing[0].Tools[0].Inverted;
    delete optionalMetadataMissing[1].Tools[0].MaskSubCategoryID;
    assert.ok(normalizeRuntimeInventoryFixture(optionalMetadataMissing),
        "only IDs and a non-empty nested Tools array are required navigation information");

    const malformed = [];
    const missingTools = clone(runtimeInventoryFixture.allMasks);
    delete missingTools[0].Tools;
    malformed.push(missingTools);
    const emptyTools = clone(runtimeInventoryFixture.allMasks);
    emptyTools[0].Tools = [];
    malformed.push(emptyTools);
    const duplicateMaskId = clone(runtimeInventoryFixture.allMasks);
    duplicateMaskId[1].ID = duplicateMaskId[0].ID;
    malformed.push(duplicateMaskId);
    const duplicateToolId = clone(runtimeInventoryFixture.allMasks);
    duplicateToolId[1].Tools[0].ID = duplicateToolId[0].Tools[0].ID;
    malformed.push(duplicateToolId);
    const invalidId = clone(runtimeInventoryFixture.allMasks);
    invalidId[0].Tools[0].ID = "";
    malformed.push(invalidId);
    const wrongOptionalType = clone(runtimeInventoryFixture.allMasks);
    wrongOptionalType[1].Tools[0].MaskSubCategoryID = "1";
    malformed.push(wrongOptionalType);
    const unknownMetadata = clone(runtimeInventoryFixture.allMasks);
    unknownMetadata[0].Unexpected = true;
    malformed.push(unknownMetadata);
    const directLegacyTool = clone(runtimeInventoryFixture.allMasks);
    directLegacyTool[0][0] = directLegacyTool[0].Tools[0];
    malformed.push(directLegacyTool);
    malformed.forEach(function (inventory, index) {
        assert.equal(normalizeRuntimeInventoryFixture(inventory), null,
            "malformed runtime inventory fixture " + index + " must fail closed");
    });
}

async function settleAllRenderedNavigation(harness) {
    let guard = 0;
    while (harness.getPending()) {
        guard += 1;
        assert.ok(guard <= 20, "serialized Masking navigation did not converge");
        await harness.settle("confirmed", "");
    }
}

function assertNavigationRequestSequence(harness, directions, startingRevision) {
    const requests = harness.commandRequests.filter(function (request) {
        return request.path === "/api/masking/group/navigate";
    });
    assert.deepEqual(requests.map(function (request) { return request.direction; }), directions,
        "the exact serialized HTTP navigation sequence drifted");
    assert.deepEqual(requests.map(function (request) { return request.stateRevision; }),
        directions.map(function (_direction, index) { return startingRevision + (index * 2); }),
        "each one-step command must use the newly confirmed authoritative revision");
    for (const request of requests) {
        assert.equal(request.selectedPhotoUuid, "photo-1");
        assert.equal(request.contextCounter, 7);
        assert.equal(request.developCounter, 12);
        assert.equal(request.contextChangedAt, 1234);
        assert.equal(request.serverEpoch, "mask-rendered");
        assert.equal(request.responseStatus, 200);
    }
    assert.equal(harness.getMaximumPending(), directions.length > 0 ? 1 : 0,
        "only one HTTP/Lightroom Masking operation may be in flight");
}

async function testRenderedRapidFinalIntentSequences() {
    let harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        assert.equal(harness.position.textContent, "Mask 1 of 5");
        harness.next.click();
        harness.next.click();
        harness.next.click();
        assert.equal(harness.status.textContent, "Moving to Mask 4…");
        assert.equal(harness.position.textContent, "Mask 1 of 5",
            "desired navigation must never replace confirmed Lightroom state");
        assert.equal(harness.commandRequests.length, 1, "rapid clicks must not overlap commands");
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next", "next", "next"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 4);
        assert.equal(harness.position.textContent, "Mask 4 of 5");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 5, count: 5 });
    try {
        harness.previous.click();
        harness.previous.click();
        harness.previous.click();
        harness.previous.click();
        assert.equal(harness.status.textContent, "Moving to Mask 1…");
        assert.equal(harness.commandRequests.length, 1);
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["previous", "previous", "previous", "previous"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 1);
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        harness.next.click();
        harness.next.click();
        harness.previous.click();
        assert.equal(harness.status.textContent, "Moving to Mask 2…");
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 2,
            "Next, Next, Previous must settle at the mathematical final target");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 3, count: 5 });
    try {
        harness.next.click();
        harness.previous.click();
        harness.next.click();
        harness.previous.click();
        assert.equal(harness.status.textContent, "Moving to Mask 3…");
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next", "previous"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 3,
            "rapid alternating direction changes must preserve the final intent");
    } finally {
        harness.close();
    }
}

async function testRenderedBoundaryClamping() {
    let harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        assert.equal(harness.previous.disabled, true);
        assert.equal(harness.previous.click(), false);
        assert.equal(harness.commandRequests.length, 0);
        for (let index = 0; index < 10; index += 1) harness.next.click();
        assert.equal(harness.next.disabled, true, "desired Next must clamp at the final group");
        assert.equal(harness.status.textContent, "Moving to Mask 5…");
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next", "next", "next", "next"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 5);
        assert.equal(harness.next.click(), false);
        assert.equal(harness.commandRequests.length, 4, "boundary clicks must never wrap or enqueue");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 5, count: 5 });
    try {
        assert.equal(harness.next.disabled, true);
        assert.equal(harness.next.click(), false);
        assert.equal(harness.commandRequests.length, 0);
    } finally {
        harness.close();
    }
}

async function testRenderedDelayedAdmissionAndSettlement() {
    let harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        const admissionGate = deferred();
        harness.admissions.push({ gate: admissionGate });
        harness.next.click();
        harness.next.click();
        harness.next.click();
        await flushAsync();
        assert.equal(harness.commandRequests.length, 1, "delayed HTTP admission must retain later clicks locally");
        assert.equal(harness.status.textContent, "Moving to Mask 4…");
        assert.equal(harness.previous.disabled, false, "direction reversal must remain clickable during admission");
        assert.equal(harness.next.disabled, false);
        admissionGate.resolve();
        await flushAsync();
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next", "next", "next"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 4);
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        harness.next.click();
        harness.next.click();
        harness.next.click();
        await flushAsync();
        assert.ok(harness.getPending(), "Lightroom settlement must remain pending in the fixture");
        await harness.controller.refresh();
        await harness.controller.refresh();
        assert.equal(harness.commandRequests.length, 1,
            "routine polling during delayed Lightroom settlement must not overlap commands");
        assert.equal(harness.status.textContent, "Moving to Mask 4…");
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next", "next", "next"], 1);
    } finally {
        harness.close();
    }
}

async function testRenderedOutOfOrderAndContextCancellation() {
    let harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        const original = clone(harness.controller.getState());
        harness.next.click();
        harness.next.click();
        harness.next.click();
        await flushAsync();
        assert.equal(harness.controller.getState().revision, 2);
        harness.stateResponses.push(original);
        await harness.controller.refresh();
        assert.equal(harness.controller.getState().revision, 2,
            "older polling must not roll back an admitted Masking operation");
        await harness.settle("confirmed", "");
        const firstSettled = renderedControllerState({
            index: 2,
            count: 5,
            revision: 3,
            lastResult: { operationId: "rendered-op-1", outcome: "confirmed", detail: null }
        });
        assert.equal(harness.controller.getState().revision, 4,
            "the next step must already use the newly settled state");
        harness.stateResponses.push(firstSettled);
        await harness.controller.refresh();
        assert.equal(harness.controller.getState().revision, 4,
            "out-of-order completed polling must not replace the newer pending revision");
        await settleAllRenderedNavigation(harness);
        assertNavigationRequestSequence(harness, ["next", "next", "next"], 1);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 4);
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        harness.next.click();
        harness.next.click();
        harness.next.click();
        await flushAsync();
        await harness.publish(renderedControllerState({
            index: 1, count: 5, serverEpoch: "mask-rendered-restarted", revision: 1
        }));
        assert.equal(harness.commandRequests.length, 1,
            "a new server epoch must cancel every remaining navigation step");
        assert.equal(harness.status.textContent, "LRBridge restarted. Please try the Masking action again.");
        await harness.controller.refresh();
        assert.equal(harness.status.textContent, "LRBridge restarted. Please try the Masking action again.",
            "routine polling must not clear an epoch-change error");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 2, count: 5 });
    try {
        harness.next.click();
        harness.next.click();
        await flushAsync();
        await harness.replaceContext(context({
            selectedPhotoUuid: "photo-2", contextCounter: 8, contextChangedAt: 2234
        }), { index: 4, count: 5, revision: 1 });
        assert.equal(harness.commandRequests.length, 1,
            "a photo change must cancel queued navigation intent immediately");
        assert.equal(harness.controller.getState().selectedPhotoUuid, "photo-2");
        assert.equal(harness.position.textContent, "Mask 4 of 5");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 2, count: 5 });
    try {
        harness.next.click();
        harness.next.click();
        await flushAsync();
        await harness.replaceContext(context({ activeModule: "library", contextCounter: 8, contextChangedAt: 3234 }), {
            index: 2, count: 5, revision: 1
        });
        assert.equal(harness.commandRequests.length, 1,
            "a module change must cancel queued navigation intent immediately");
        assert.equal(harness.position.textContent, "Open a photo in Develop to use Masking.");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 2, count: 5 });
    try {
        harness.next.click();
        await flushAsync();
        await harness.settle("confirmed", "", { index: 2 });
        assert.equal(harness.status.textContent,
            "Lightroom could not confirm that mask change. Please try again.",
            "a confirmed result that did not perform the requested one-step move must fail closed");
        assert.equal(harness.commandRequests.length, 1,
            "an unreconciled confirmed result must stop automatic navigation");
    } finally {
        harness.close();
    }
}

async function testRenderedPersistentErrorsAndRecovery() {
    let harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        const rejectedBody = {
            ok: false,
            error: "Masking state changed or the requested action is unavailable"
        };
        harness.admissions.push({ status: 409, body: rejectedBody });
        harness.next.click();
        await flushAsync();
        assert.equal(harness.commandRequests.length, 1);
        assert.equal(harness.commandRequests[0].responseStatus, 409);
        assert.deepEqual(harness.commandRequests[0].responseBody, rejectedBody,
            "the regression must retain the precise server rejection outcome");
        assert.equal(harness.status.textContent,
            "That mask change is no longer available. Masking state was refreshed.");
        assert.equal(harness.status.textContent.includes("revision"), false);
        assert.equal(harness.status.textContent.includes("mask-"), false);
        await harness.controller.refresh();
        await harness.controller.refresh();
        assert.equal(harness.status.textContent,
            "That mask change is no longer available. Masking state was refreshed.",
            "ordinary valid polling must not flash away an admission error");
        harness.next.click();
        assert.equal(harness.status.textContent, "Moving to Mask 2…",
            "the next deliberate action must clear the previous error");
        await flushAsync();
        await harness.settle("confirmed", "");
        assert.equal(harness.status.textContent, "", "a successful later operation must leave the error cleared");
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 2);
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 2, count: 5 });
    try {
        harness.next.click();
        await flushAsync();
        await harness.settle("failed", "Lightroom's Masking result could not be reconciled safely.", { index: 2 });
        assert.equal(harness.status.textContent,
            "Lightroom could not confirm that mask change. Please try again.");
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 2);
        assert.equal(harness.commandRequests.length, 1,
            "failed Lightroom settlement must stop the automatic sequence");
        await harness.controller.refresh();
        assert.equal(harness.status.textContent,
            "Lightroom could not confirm that mask change. Please try again.",
            "ordinary polling must not clear a Lightroom reconciliation error");
        harness.next.click();
        await flushAsync();
        await harness.settle("confirmed", "");
        assert.equal(harness.status.textContent, "");
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 3);
    } finally {
        harness.close();
    }
}

async function testRenderedPanelOperationsStaySeparate() {
    const harness = await createRenderedMaskingHarness({
        active: false,
        count: 5,
        identicalBackgroundBeforeCommands: true
    });
    try {
        assert.equal(harness.panel.textContent, "Open Masking");
        harness.panel.click();
        assert.equal(harness.panel.click(), false,
            "a second panel click must be ignored while Open Masking is still authoritative-pending");
        assert.equal(harness.status.textContent, "Opening Masking…",
            "an ignored disabled click must not create an error");
        assert.equal(harness.next.click(), false, "navigation must remain disabled during a panel operation");
        assert.deepEqual(harness.commandRequests.map(function (request) { return request.path; }),
            ["/api/masking/panel"]);
        await flushAsync();
        await harness.settle("confirmed", "", { active: true, index: 1 });
        assert.equal(harness.panel.textContent, "Close Masking");

        harness.panel.click();
        await flushAsync();
        await harness.settle("confirmed", "", { active: false });
        assert.equal(harness.panel.textContent, "Open Masking",
            "Close must work immediately after authoritative Open confirmation");
        harness.panel.click();
        await flushAsync();
        await harness.settle("confirmed", "", { active: true, index: 1 });
        assert.equal(harness.panel.textContent, "Close Masking",
            "Open must work immediately after authoritative Close confirmation");

        harness.next.click();
        harness.next.click();
        assert.equal(harness.panel.click(), false,
            "Open/Close must not mix with serialized group navigation");
        await settleAllRenderedNavigation(harness);
        assert.equal(harness.controller.getState().selectedMaskGroupIndex, 3);
        harness.panel.click();
        await flushAsync();
        await harness.settle("confirmed", "", { active: false });
        assert.equal(harness.panel.textContent, "Open Masking");
        assert.deepEqual(harness.commandRequests.map(function (request) { return request.path; }), [
            "/api/masking/panel",
            "/api/masking/panel",
            "/api/masking/panel",
            "/api/masking/group/navigate",
            "/api/masking/group/navigate",
            "/api/masking/panel"
        ]);
        assert.deepEqual(harness.commandRequests.map(function (request) { return request.stateRevision; }),
            [1, 3, 5, 7, 9, 11],
            "rapid panel/navigation transitions must use each newly confirmed semantic revision");
        assert.equal(harness.commandRequests.every(function (request) {
            return request.stateRevision === request.serverRevisionAtAdmission;
        }), true, "identical background queries must not invalidate any submitted controller revision");
        assert.equal(harness.getMaximumPending(), 1);
    } finally {
        harness.close();
    }
}

async function testRenderedOperationErrorOwnership() {
    let harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        const rejectedBody = {
            ok: false,
            error: "Masking state changed or the requested action is unavailable"
        };
        harness.admissions.push({ status: 409, body: rejectedBody });
        harness.next.click();
        await flushAsync();
        assert.equal(harness.commandRequests[0].path, "/api/masking/group/navigate");
        assert.equal(harness.status.textContent,
            "That mask change is no longer available. Masking state was refreshed.");
        harness.panel.click();
        assert.equal(harness.status.textContent, "Closing Masking…",
            "a deliberate panel action must clear an older navigation error");
        await flushAsync();
        await harness.settle("confirmed", "", { active: false });
        assert.equal(harness.status.textContent, "",
            "successful Close Masking must keep the older navigation error cleared");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ index: 1, count: 5 });
    try {
        const rejectedBody = {
            ok: false,
            error: "Masking state changed or the requested action is unavailable"
        };
        harness.admissions.push({ status: 409, body: rejectedBody });
        harness.panel.click();
        await flushAsync();
        assert.equal(harness.commandRequests[0].path, "/api/masking/panel");
        assert.equal(harness.commandRequests[0].open, "false");
        assert.equal(harness.status.textContent,
            "Close Masking is no longer available. Masking state was refreshed.");
        harness.next.click();
        assert.equal(harness.status.textContent, "Moving to Mask 2…",
            "a deliberate navigation action must clear an older panel error");
        await flushAsync();
        await harness.settle("confirmed", "");
        assert.equal(harness.status.textContent, "",
            "successful navigation must keep the older panel error cleared");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ active: false, count: 5 });
    try {
        harness.admissions.push({
            status: 409,
            body: { ok: false, error: "Masking state changed or the requested action is unavailable" }
        });
        harness.panel.click();
        await flushAsync();
        assert.equal(harness.status.textContent,
            "Open Masking is no longer available. Masking state was refreshed.");
        await harness.controller.refresh();
        assert.equal(harness.status.textContent,
            "Open Masking is no longer available. Masking state was refreshed.",
            "routine polling must not erase a current panel error");
    } finally {
        harness.close();
    }

    harness = await createRenderedMaskingHarness({ active: false, count: 5 });
    try {
        harness.panel.click();
        await flushAsync();
        await harness.settle("failed", "Lightroom could not reconcile panel state.", { active: false });
        assert.equal(harness.status.textContent,
            "Lightroom could not confirm Open Masking. Please try again.",
            "a failed panel settlement must retain the exact panel action owner");
        await harness.controller.refresh();
        assert.equal(harness.status.textContent,
            "Lightroom could not confirm Open Masking. Please try again.");
        harness.panel.click();
        await flushAsync();
        await harness.settle("confirmed", "", { active: true, index: 1 });
        assert.equal(harness.status.textContent, "");
    } finally {
        harness.close();
    }
}

function queryString(values) {
    const query = new URLSearchParams();
    Object.entries(values).forEach(function ([key, value]) {
        if (key !== "command" && key !== "requestedAt") query.set(key, value === null ? "null" : String(value));
    });
    return query.toString();
}

function snapshotFields(value) {
    return {
        available: value.available, unavailableReason: value.unavailableReason, active: value.active,
        maskGroupCount: value.maskGroupCount, hasSelectedMaskGroup: value.hasSelectedMaskGroup,
        selectedMaskGroupIndex: value.selectedMaskGroupIndex, selectedMaskGroupId: value.selectedMaskGroupId,
        previousAvailable: value.previousAvailable, nextAvailable: value.nextAvailable,
        selectedMaskToolAvailable: value.selectedMaskToolAvailable, selectedMaskToolId: value.selectedMaskToolId
    };
}

async function get(port, pathname) {
    const response = await fetch("http://127.0.0.1:" + port + pathname);
    return { status: response.status, body: await response.json() };
}

function commandResultFields(command) {
    return {
        operationId: command.operationId,
        expectedServerEpoch: command.expectedServerEpoch,
        expectedMaskingRevision: command.expectedMaskingRevision,
        expectedActiveModule: command.expectedActiveModule,
        expectedSelectedPhotoUuid: command.expectedSelectedPhotoUuid,
        expectedContextCounter: command.expectedContextCounter,
        expectedDevelopCounter: command.expectedDevelopCounter,
        expectedContextChangedAt: command.expectedContextChangedAt
    };
}

function queryResultFields(request, value) {
    return Object.assign({
        requestId: request.requestId,
        expectedServerEpoch: request.expectedServerEpoch,
        expectedMaskingRevision: request.expectedMaskingRevision,
        expectedActiveModule: request.expectedActiveModule,
        expectedSelectedPhotoUuid: request.expectedSelectedPhotoUuid,
        expectedContextCounter: request.expectedContextCounter,
        expectedDevelopCounter: request.expectedDevelopCounter,
        expectedContextChangedAt: request.expectedContextChangedAt
    }, snapshotFields(value));
}

async function submitQueryResult(port, request, value) {
    return get(port, "/masking/query-result?" + queryString(queryResultFields(request, value)));
}

async function submitOperationResult(port, command, outcome, value) {
    return get(port, "/masking/operation-result?" + queryString(Object.assign(
        commandResultFields(command), { outcome: outcome, detail: "" }, snapshotFields(value))));
}

function operationRequestPath(kind, value, binding) {
    const operationField = kind === "panel" ? { open: value } : { direction: value };
    return "/masking/" + (kind === "panel" ? "panel" : "group/navigate") + "?" + queryString(Object.assign(
        operationField,
        {
            selectedPhotoUuid: binding.selectedPhotoUuid,
            contextCounter: binding.contextCounter,
            developCounter: binding.developCounter,
            contextChangedAt: binding.contextChangedAt,
            serverEpoch: binding.serverEpoch,
            stateRevision: binding.revision
        }
    ));
}

async function testHttpAndQueueContract() {
    commands.resetQueueForTests();
    const bridge = createBridge({
        httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40,
        maskingStateOptions: { serverEpoch: "mask-http" }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    try {
        let response = await get(port, "/context/update?" + queryString({
            activeModule: "develop", selectedPhotoUuid: "photo-http", selectedPhotoPath: "C:/photo.dng",
            developFingerprint: "fingerprint-1"
        }));
        assert.equal(response.status, 200);

        response = await get(port, "/masking/next");
        const request = response.body.request;
        assert.equal(request.command, "masking.query");
        const closed = snapshot({
            active: false, maskGroupCount: 2, hasSelectedMaskGroup: null, selectedMaskGroupIndex: null,
            selectedMaskGroupId: null, previousAvailable: false, nextAvailable: false,
            selectedMaskToolAvailable: false, selectedMaskToolId: null
        });
        const queryResult = Object.assign({
            requestId: request.requestId,
            expectedServerEpoch: request.expectedServerEpoch,
            expectedMaskingRevision: request.expectedMaskingRevision,
            expectedActiveModule: request.expectedActiveModule,
            expectedSelectedPhotoUuid: request.expectedSelectedPhotoUuid,
            expectedContextCounter: request.expectedContextCounter,
            expectedDevelopCounter: request.expectedDevelopCounter,
            expectedContextChangedAt: request.expectedContextChangedAt
        }, snapshotFields(closed));
        response = await get(port, "/masking/query-result?" + queryString(queryResult));
        assert.equal(response.status, 200);
        response = await get(port, "/masking/query-result?" + queryString(queryResult));
        assert.equal(response.status, 409, "an older duplicate query result must be rejected");

        let state = (await get(port, "/masking/state")).body;
        assert.equal(state.active, false);
        assert.equal(state.maskGroupCount, 2);
        let binding = suppliedBinding(state);
        response = await get(port, "/masking/panel?" + queryString({
            open: true, selectedPhotoUuid: binding.selectedPhotoUuid, contextCounter: binding.contextCounter,
            developCounter: binding.developCounter, contextChangedAt: binding.contextChangedAt,
            serverEpoch: binding.serverEpoch, stateRevision: binding.revision
        }));
        assert.equal(response.status, 200);
        const openCommand = commands.getNextCommand();
        assert.equal(openCommand.command, "masking.panel.set");
        const firstOpen = snapshot({
            maskGroupCount: 2, selectedMaskGroupIndex: 1, selectedMaskGroupId: "mask-a",
            previousAvailable: false, nextAvailable: true, selectedMaskToolId: "tool-a1"
        });
        response = await get(port, "/masking/operation-result?" + queryString(Object.assign(
            commandResultFields(openCommand), { outcome: "confirmed", detail: "" }, snapshotFields(firstOpen))));
        assert.equal(response.status, 200);

        state = (await get(port, "/masking/state")).body;
        response = await get(port, "/masking/group/navigate?" + queryString({
            direction: "previous", selectedPhotoUuid: state.selectedPhotoUuid, contextCounter: state.contextCounter,
            developCounter: state.developCounter, contextChangedAt: state.contextChangedAt,
            serverEpoch: state.serverEpoch, stateRevision: state.revision
        }));
        assert.equal(response.status, 409, "Previous must be rejected at the first mask");
        binding = suppliedBinding(state);
        const navigationQuery = queryString({
            direction: "next", selectedPhotoUuid: binding.selectedPhotoUuid, contextCounter: binding.contextCounter,
            developCounter: binding.developCounter, contextChangedAt: binding.contextChangedAt,
            serverEpoch: binding.serverEpoch, stateRevision: binding.revision
        });
        response = await get(port, "/masking/group/navigate?" + navigationQuery);
        assert.equal(response.status, 200);
        assert.equal((await get(port, "/masking/group/navigate?" + navigationQuery)).status, 409,
            "rapid duplicate navigation must not queue twice");
        const nextCommand = commands.getNextCommand();
        assert.equal(nextCommand.expectedSelectedMaskId, "mask-a");
        const second = snapshot({
            maskGroupCount: 2, selectedMaskGroupIndex: 2, selectedMaskGroupId: "mask-b",
            previousAvailable: true, nextAvailable: false, selectedMaskToolId: "tool-b1"
        });
        response = await get(port, "/masking/operation-result?" + queryString(Object.assign(
            commandResultFields(nextCommand), { outcome: "confirmed", detail: "" }, snapshotFields(second))));
        assert.equal(response.status, 200);
        state = (await get(port, "/masking/state")).body;
        assert.equal(state.selectedMaskGroupIndex, 2);
        response = await get(port, "/masking/group/navigate?" + queryString({
            direction: "next", selectedPhotoUuid: state.selectedPhotoUuid, contextCounter: state.contextCounter,
            developCounter: state.developCounter, contextChangedAt: state.contextChangedAt,
            serverEpoch: state.serverEpoch, stateRevision: state.revision
        }));
        assert.equal(response.status, 409, "Next must be rejected at the last mask");
        assert.equal((await get(port, "/masking/state?extra=1")).status, 400);

        state = (await get(port, "/masking/state")).body;
        response = await get(port, "/masking/panel?" + queryString({
            open: false, selectedPhotoUuid: state.selectedPhotoUuid, contextCounter: state.contextCounter,
            developCounter: state.developCounter, contextChangedAt: state.contextChangedAt,
            serverEpoch: state.serverEpoch, stateRevision: state.revision
        }));
        assert.equal(response.status, 200);
        const closeCommand = commands.getNextCommand();
        assert.equal(closeCommand.command, "masking.panel.set");
        assert.equal(closeCommand.open, false);
        response = await get(port, "/masking/operation-result?" + queryString(Object.assign(
            commandResultFields(closeCommand), { outcome: "confirmed", detail: "" }, snapshotFields(closed))));
        assert.equal(response.status, 200);
        state = (await get(port, "/masking/state")).body;
        assert.equal(state.active, false);

        response = await get(port, "/masking/panel?" + queryString({
            open: true, selectedPhotoUuid: state.selectedPhotoUuid, contextCounter: state.contextCounter,
            developCounter: state.developCounter, contextChangedAt: state.contextChangedAt,
            serverEpoch: state.serverEpoch, stateRevision: state.revision
        }));
        assert.equal(response.status, 200);
        response = await get(port, "/context/update?" + queryString({
            activeModule: "library", selectedPhotoUuid: "photo-other", selectedPhotoPath: "C:/other.dng",
            developFingerprint: "null"
        }));
        assert.equal(response.status, 200);
        assert.equal(commands.getNextCommand(), null, "a queued Masking command must be discarded after module/photo change");
        assert.equal(bridge.getMaskingState().lastResult.outcome, "stale");

        response = await get(port, "/action?action=selectMaskingTool");
        assert.equal(response.status, 200, "legacy selectMaskingTool compatibility must remain available");
        assert.deepEqual(commands.getNextCommand(), { command: "develop.action", action: "selectMaskingTool" });
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

async function testHttpSemanticRevisionRace() {
    commands.resetQueueForTests();
    let maskingNow = 100000;
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40,
        maskingStateOptions: {
            serverEpoch: "mask-http-race",
            now: function () { return maskingNow; }
        }
    });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    try {
        let response = await get(port, "/context/update?" + queryString({
            activeModule: "develop",
            selectedPhotoUuid: "photo-http-race",
            selectedPhotoPath: "C:/race.dng",
            developFingerprint: "fingerprint-race"
        }));
        assert.equal(response.status, 200);

        response = await get(port, "/masking/next");
        const initialRequest = response.body.request;
        const closed = snapshot({
            active: false,
            maskGroupCount: 5,
            hasSelectedMaskGroup: null,
            selectedMaskGroupIndex: null,
            selectedMaskGroupId: null,
            previousAvailable: false,
            nextAvailable: false,
            selectedMaskToolAvailable: false,
            selectedMaskToolId: null
        });
        response = await submitQueryResult(port, initialRequest, closed);
        assert.equal(response.status, 200);
        let state = (await get(port, "/masking/state")).body;
        const idleRevision = state.revision;
        let previousCapturedAt = state.capturedAt;
        const preRefreshPanelBinding = suppliedBinding(state);
        const queryIds = new Set([initialRequest.requestId]);

        for (let index = 0; index < 5; index += 1) {
            maskingNow += 500;
            const returned = (await get(port, "/masking/state")).body;
            assert.equal(returned.revision, idleRevision,
                "the state route must return the still-valid semantic revision while scheduling an idle refresh");
            response = await get(port, "/masking/next");
            const idleRequest = response.body.request;
            assert.ok(idleRequest);
            assert.equal(idleRequest.expectedMaskingRevision, idleRevision);
            assert.equal(queryIds.has(idleRequest.requestId), false,
                "each repeated idle query must have a unique request ID");
            queryIds.add(idleRequest.requestId);
            response = await submitQueryResult(port, idleRequest, closed);
            assert.equal(response.status, 200);
            assert.equal(response.body.revision, idleRevision,
                "an identical HTTP query result must not advance semantic revision");
            state = (await get(port, "/masking/state")).body;
            assert.equal(state.revision, idleRevision);
            assert.ok(state.capturedAt > previousCapturedAt,
                "an identical HTTP query result must refresh capturedAt");
            previousCapturedAt = state.capturedAt;
        }

        response = await get(port, operationRequestPath("panel", true, preRefreshPanelBinding));
        assert.equal(response.status, 200,
            "Open Masking using revision N must survive completed identical background queries");
        assert.equal(response.body.revision, idleRevision + 1);
        assert.equal(response.body.pendingOperation.kind, "panel");
        let diagnostics = (await get(port, "/diagnostics/queue")).body;
        assert.equal(diagnostics.queue.length, 1);
        assert.equal(diagnostics.queue.pending.byCommand["masking.panel.set"], 1);
        const overlappingPanel = await get(port, operationRequestPath("panel", false, preRefreshPanelBinding));
        assert.equal(overlappingPanel.status, 409,
            "a second panel command must not overlap the admitted Lightroom operation");
        assert.equal((await get(port, "/diagnostics/queue")).body.queue.length, 1);
        let command = commands.getNextCommand();
        assert.equal(command.command, "masking.panel.set");
        const openAtFirst = snapshot({
            maskGroupCount: 5,
            selectedMaskGroupIndex: 1,
            selectedMaskGroupId: "mask-1",
            previousAvailable: false,
            nextAvailable: true,
            selectedMaskToolId: "tool-1"
        });
        response = await submitOperationResult(port, command, "confirmed", openAtFirst);
        assert.equal(response.status, 200);
        assert.equal(response.body.revision, idleRevision + 2);

        state = (await get(port, "/masking/state")).body;
        response = await get(port, operationRequestPath("panel", false, suppliedBinding(state)));
        assert.equal(response.status, 200,
            "Close Masking must be admitted immediately after authoritative Open confirmation");
        command = commands.getNextCommand();
        response = await submitOperationResult(port, command, "confirmed", closed);
        assert.equal(response.status, 200);
        state = (await get(port, "/masking/state")).body;
        assert.equal(state.active, false);
        response = await get(port, operationRequestPath("panel", true, suppliedBinding(state)));
        assert.equal(response.status, 200,
            "Open Masking must be admitted immediately after authoritative Close confirmation");
        command = commands.getNextCommand();
        response = await submitOperationResult(port, command, "confirmed", openAtFirst);
        assert.equal(response.status, 200);

        const navigationRevisions = [];
        for (let targetIndex = 2; targetIndex <= 4; targetIndex += 1) {
            state = (await get(port, "/masking/state")).body;
            const stepBinding = suppliedBinding(state);
            const stepRevision = state.revision;
            maskingNow += 500;
            const returned = (await get(port, "/masking/state")).body;
            assert.equal(returned.revision, stepRevision);
            const background = (await get(port, "/masking/next")).body.request;
            assert.equal(background.expectedMaskingRevision, stepRevision);
            response = await submitQueryResult(port, background, state);
            assert.equal(response.status, 200);
            assert.equal(response.body.revision, stepRevision);
            response = await get(port, operationRequestPath("navigate", "next", stepBinding));
            assert.equal(response.status, 200,
                "serialized navigation must survive an identical background query before every step");
            assert.equal(response.body.revision, stepRevision + 1);
            navigationRevisions.push({ submitted: stepBinding.revision, admitted: response.body.revision });
            diagnostics = (await get(port, "/diagnostics/queue")).body;
            assert.equal(diagnostics.queue.length, 1,
                "only one Lightroom navigation command may be queued at a time");
            command = commands.getNextCommand();
            assert.equal(command.expectedMaskingRevision, stepRevision + 1);
            const nextSnapshot = snapshot({
                maskGroupCount: 5,
                selectedMaskGroupIndex: targetIndex,
                selectedMaskGroupId: "mask-" + targetIndex,
                previousAvailable: true,
                nextAvailable: targetIndex < 5,
                selectedMaskToolId: "tool-" + targetIndex
            });
            response = await submitOperationResult(port, command, "confirmed", nextSnapshot);
            assert.equal(response.status, 200);
            assert.equal(response.body.revision, stepRevision + 2);
        }
        assert.deepEqual(navigationRevisions.map(function (item) { return item.submitted; }),
            navigationRevisions.map(function (item) { return item.admitted - 1; }));
        state = (await get(port, "/masking/state")).body;
        assert.equal(state.selectedMaskGroupIndex, 4,
            "three serialized final-intent steps must finish at authoritative Mask 4");

        const staleBinding = suppliedBinding(state);
        maskingNow += 500;
        const beforeChangedRefresh = (await get(port, "/masking/state")).body;
        assert.equal(beforeChangedRefresh.revision, staleBinding.revision);
        const changedRequest = (await get(port, "/masking/next")).body.request;
        const externallyChanged = snapshot({
            maskGroupCount: 5,
            selectedMaskGroupIndex: 2,
            selectedMaskGroupId: "mask-2",
            previousAvailable: true,
            nextAvailable: true,
            selectedMaskToolId: "tool-2"
        });
        response = await submitQueryResult(port, changedRequest, externallyChanged);
        assert.equal(response.status, 200);
        assert.equal(response.body.revision, staleBinding.revision + 1,
            "a genuine Lightroom selection change must advance semantic revision");
        response = await get(port, operationRequestPath("navigate", "next", staleBinding));
        assert.equal(response.status, 409,
            "the exact navigation endpoint must reject the previous semantic revision after a real change");
        assert.deepEqual(response.body, {
            ok: false,
            error: "Masking state changed or the requested action is unavailable"
        });
        assert.equal((await get(port, "/diagnostics/queue")).body.queue.length, 0);

        state = (await get(port, "/masking/state")).body;
        maskingNow += 500;
        await get(port, "/masking/state");
        const older = (await get(port, "/masking/next")).body.request;
        maskingNow += 3000;
        await get(port, "/masking/state");
        const newer = (await get(port, "/masking/next")).body.request;
        assert.notEqual(older.requestId, newer.requestId);
        response = await submitQueryResult(port, older, state);
        assert.equal(response.status, 409, "the older out-of-order HTTP query result must be rejected");
        response = await submitQueryResult(port, newer, state);
        assert.equal(response.status, 200);
        const stableRevision = response.body.revision;
        response = await submitQueryResult(port, newer, state);
        assert.equal(response.status, 409, "the duplicated HTTP query result must be rejected");
        assert.equal((await get(port, "/masking/state")).body.revision, stableRevision);

        state = (await get(port, "/masking/state")).body;
        const commandDuringQueryBinding = suppliedBinding(state);
        maskingNow += 500;
        await get(port, "/masking/state");
        const outstanding = (await get(port, "/masking/next")).body.request;
        response = await get(port, operationRequestPath("navigate", "next", commandDuringQueryBinding));
        assert.equal(response.status, 200,
            "a command must be admitted while an identical query is outstanding at the same revision");
        assert.equal(response.body.revision, commandDuringQueryBinding.revision + 1);
        response = await submitQueryResult(port, outstanding, state);
        assert.equal(response.status, 409,
            "the query cancelled by command admission must not overwrite the operation lifecycle");
        assert.equal((await get(port, "/diagnostics/queue")).body.queue.length, 1);
        command = commands.getNextCommand();
        const third = snapshot({
            maskGroupCount: 5,
            selectedMaskGroupIndex: 3,
            selectedMaskGroupId: "mask-3",
            previousAvailable: true,
            nextAvailable: true,
            selectedMaskToolId: "tool-3"
        });
        response = await submitOperationResult(port, command, "confirmed", third);
        assert.equal(response.status, 200);
        assert.equal((await get(port, "/diagnostics/queue")).body.queue.length, 0);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

function testPhotographerPresentationAndSourceContract() {
    const ctx = context();
    const authoritative = Object.assign({ ok: true, serverEpoch: "epoch", revision: 5 }, ctx, snapshot());
    assert.equal(maskingUi.present(authoritative, ctx, null).position, "Mask 2 of 3");
    assert.equal(maskingUi.present(authoritative, ctx, null).panelLabel, "Close Masking");
    assert.equal(maskingUi.present(authoritative, ctx, null).previousDisabled, false);
    assert.equal(maskingUi.present(Object.assign({}, authoritative, {
        selectedMaskGroupIndex: 1, selectedMaskGroupId: "mask-a", previousAvailable: false
    }), ctx, null).previousDisabled, true);
    const pendingPresentation = maskingUi.present(authoritative, ctx, {
        activeOperation: { kind: "navigate", direction: "next", operationId: "test-op" },
        desiredMaskGroupIndex: 3,
        navigationIntentActive: true
    });
    assert.equal(pendingPresentation.position, "Mask 2 of 3",
        "pending intent must not replace confirmed Lightroom position");
    assert.equal(pendingPresentation.status, "Moving to Mask 3…");
    assert.equal(pendingPresentation.previousDisabled, false,
        "reverse direction must remain clickable while navigation is serialized");
    const empty = Object.assign({}, authoritative, {
        maskGroupCount: 0, hasSelectedMaskGroup: false, selectedMaskGroupIndex: null, selectedMaskGroupId: null,
        previousAvailable: false, nextAvailable: false, selectedMaskToolAvailable: false, selectedMaskToolId: null
    });
    assert.equal(maskingUi.present(empty, ctx, null).position, "No masks on this photo.");
    const unavailable = Object.assign({}, authoritative, maskingDefinition.unavailableSnapshot("sdk_error"));
    assert.equal(maskingUi.present(unavailable, ctx, null).position, "Lightroom could not report Masking right now.");
    assert.equal(maskingUi.acceptState(authoritative, Object.assign({}, authoritative, { revision: 4 }), ctx), authoritative,
        "an older response must not roll back a newer revision");
    const restarted = Object.assign({}, authoritative, { serverEpoch: "new-epoch", revision: 1 });
    assert.equal(maskingUi.acceptState(authoritative, restarted, ctx), restarted);

    const lua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Masking.lua"), "utf8");
    const commandsLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Commands.lua"), "utf8");
    const feedbackLua = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
    const maskingControllerSource = fs.readFileSync(path.join(root, "app/controller-masking.js"), "utf8");
    const controllerHtml = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
    const electronMain = fs.readFileSync(path.join(root, "app/main.js"), "utf8");
    assert.equal(fs.existsSync(path.join(root, "lightroom/LRBridge.lrplugin/MaskingDiagnostic.lua")), false,
        "the one-shot runtime diagnostic module must be removed after evidence capture");
    assert.equal(lua.includes("MaskingDiagnostic"), false,
        "the one-shot runtime diagnostic import and capture hook must be removed");
    assert.equal(lua.includes("io.open"), false, "Masking production state must not contain temporary file logging");
    assert.ok(lua.indexOf("getSelectedTool") < lua.indexOf("getAllMasks"));
    assert.ok(lua.indexOf("getAllMasks") < lua.indexOf("getSelectedMask"));
    assert.match(lua, /denseArrayLength\(mask\.Tools, MAX_MASK_TOOLS_PER_GROUP\)/,
        "Lightroom 15.3 tools must be validated through the nested Tools array");
    assert.match(lua, /if largest ~= count then return nil end/,
        "mask and tool arrays must remain dense rather than accepting missing navigation entries");
    assert.match(lua, /local groupFields = \{ ID = true, Name = true, Hidden = true, Tools = true \}/,
        "only the observed Lightroom 15.3 group metadata may be tolerated");
    assert.match(lua, /MaskSubCategoryID = true/,
        "the observed optional tool subcategory metadata must remain explicitly allowlisted");
    assert.match(lua, /not validOpaqueId\(tool\.ID\) or toolIds\[tool\.ID\] == true/,
        "invalid or duplicate usable tool identifiers must fail closed");
    assert.match(lua, /ipairs\(masks\[snapshot\.selectedMaskGroupIndex\]\.Tools\)/,
        "selected tools must reconcile inside the selected group's nested Tools array");
    assert.match(lua, /targetMask\.Tools and targetMask\.Tools\[1\]/,
        "group navigation must select the first tool from the evidenced nested Tools array");
    assert.doesNotMatch(lua, /targetMask\[1\]/,
        "the rejected direct mask[1] tool-layout assumption must not return");
    assert.ok(lua.indexOf("LrDevelopController.selectMask(targetMask.ID)") <
        lua.indexOf("LrDevelopController.selectMaskTool(targetTool.ID)"));
    assert.match(lua, /LrDevelopController\.goToMasking\(\)/);
    assert.match(lua, /LrDevelopController\.selectTool\("loupe"\)/);
    assert.match(commandsLua, /masking\.panel\.set[\s\S]*masking\.group\.navigate[\s\S]*Masking\.execute/);
    assert.match(feedbackLua, /\/masking\/next[\s\S]*Masking\.sendRequestedSnapshot/);
    assert.match(controllerHtml, /<script src="\/controller-masking\.js"><\/script>/);
    assert.match(electronMain, /requestUrl\.pathname === "\/controller-masking\.js"/);
    assert.match(maskingControllerSource, /desiredMaskGroupIndex/);
    assert.match(maskingControllerSource, /navigationIntentActive/);
    assert.match(maskingControllerSource, /driveNavigation\(\)/);
    assert.doesNotMatch(maskingControllerSource, /if \(localIntent \|\|/,
        "rapid Masking clicks must not be discarded by the old pending-intent guard");
    for (const forbidden of ["loadstring", "executeTemplate", "deleteMask", "resetMasking", "createNewMask",
        "LrShell", "keystroke", "mouse_event", "SendKeys"]) {
        assert.equal(lua.includes(forbidden), false, "Masking Phase 1 must not use " + forbidden);
    }
    const readSnapshotBlock = lua.slice(lua.indexOf("local function readSnapshot"),
        lua.indexOf("local function queryValue"));
    for (const mutation of ["selectMask(", "selectMaskTool(", "goToMasking(", "selectTool(", "setValue(",
        "resetToDefault(", "applyDevelopSettings(", "applyDevelopPreset(", "createNewMask(", "deleteMask(",
        "invertMask(", "toggleHideMask("]) {
        assert.equal(readSnapshotBlock.includes(mutation), false,
            "authoritative Masking state reading must not invoke " + mutation);
    }
}

(async function run() {
    testStateMachine();
    testSemanticRevisionFreshness();
    testLightroom153RuntimeInventoryFixture();
    testPhotographerPresentationAndSourceContract();
    await testRenderedRapidFinalIntentSequences();
    await testRenderedBoundaryClamping();
    await testRenderedDelayedAdmissionAndSettlement();
    await testRenderedOutOfOrderAndContextCancellation();
    await testRenderedPersistentErrorsAndRecovery();
    await testRenderedPanelOperationsStaySeparate();
    await testRenderedOperationErrorOwnership();
    await testHttpAndQueueContract();
    await testHttpSemanticRevisionRace();
    console.log("Masking authoritative state, serialized rendered navigation, queue, Lightroom source, and controller tests passed.");
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
