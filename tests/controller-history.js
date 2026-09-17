"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/controller.html"), "utf8");
const block = source.slice(source.indexOf("        let historyUndoButton ="), source.indexOf("        function disconnectSliderJumpDockObserver()"));

(async () => {
    let calls = 0, mutations = 0, release = null, fail = false, maskBusy = false, removeBusy = false, refreshes = 0;
    const c = { Date, Math, Boolean, Number, encodeURIComponent, setInterval() { return 1; }, clearInterval() {},
        heartbeatWasStale: false, activeSliderInteractions: new Set(), undo: {}, redo: {},
        maskingController: { getInteractionState: () => ({ correctionBusy: maskBusy }), refresh() { refreshes += 1; } },
        removeController: { isInteracting: () => removeBusy },
        reflectionsController: { isInteracting: () => c.reflectionsBusy === true },
        peopleController: { isInteracting: () => c.peopleBusy === true },
        redEyeController: { isInteracting: () => c.redEyeBusy === true },
        exportController: { isInteracting: () => c.exportBusy === true },
        pollControllerContext() { refreshes += 1; }, requestLiveFeedbackSnapshot() { refreshes += 1; },
        async fetch() {
            calls += 1;
            if (release === "hold") await new Promise(resolve => { release = resolve; });
            return { ok: !fail, json: async () => ({ state: { available: true, canUndo: true, canRedo: false } }) };
        },
        async sendCommand(path) { assert.equal(path, "/api/command?command=lightroom.undo"); mutations += 1; return true; }
    };
    vm.createContext(c);
    vm.runInContext(block + `
        historyUndoButton = this.undo; historyRedoButton = this.redo;
        this.api = { request: requestHistoryState, run: runLightroomHistoryCommand,
            mutate: startHistoryActionCooldown, update: updateHistoryButtons,
            ready() { historyActionCooldownUntil=0; historyState={available:true,canUndo:true,canRedo:false}; updateHistoryButtons(); },
            state() { return historyState; } };
    `, c);
    for (const tab of ["tools", "sliders", "tone-curve", "color-grading", "presets", "selection", "application"]) {
        c.activeTab = tab; const before = calls; await c.api.request();
        assert.equal(calls, before + 1, tab + " must fetch authoritative global history");
        assert.equal(c.undo.disabled, false); assert.equal(c.redo.disabled, true);
    }
    release = "hold"; const pending = c.api.request();
    c.api.mutate(); release(); release = null; await pending;
    assert.equal(c.api.state().available, false, "pre-adjustment feedback must not override mutation invalidation");
    c.api.ready(); fail = true; await c.api.request(); assert.equal(c.undo.disabled, true, "HTTP failures must fail closed");
    fail = false; c.api.ready();
    c.heartbeatWasStale = true; c.api.update(); await c.api.run("lightroom.undo"); assert.equal(mutations, 0);
    c.heartbeatWasStale = false; maskBusy = true; c.api.update(); await c.api.run("lightroom.undo"); assert.equal(mutations, 0);
    maskBusy = false; removeBusy = true; c.api.update(); await c.api.run("lightroom.undo"); assert.equal(mutations, 0);
    assert.equal(c.undo.disabled, true, "Remove preference editing blocks shared history during the operation");
    removeBusy = false; c.reflectionsBusy = true; c.api.update(); await c.api.run("lightroom.undo");
    assert.equal(mutations, 0); assert.equal(c.undo.disabled, true, "Reflections processing blocks shared history across tabs");
    c.reflectionsBusy = false;
    c.peopleBusy = true; c.api.update(); await c.api.run("lightroom.undo");
    assert.equal(mutations, 0); assert.equal(c.undo.disabled, true, "People removal processing blocks shared history across tabs");
    c.peopleBusy = false;
    c.redEyeBusy = true; c.api.update(); await c.api.run("lightroom.undo");
    assert.equal(mutations, 0); assert.equal(c.undo.disabled, true, "Red Eye commands block shared history across tabs");
    c.redEyeBusy = false;
    c.exportBusy = true; c.api.update(); await c.api.run("lightroom.undo");
    assert.equal(mutations, 0); assert.equal(c.undo.disabled, true, "Export dispatch blocks shared history across tabs");
    c.exportBusy = false;
    removeBusy = false; c.activeSliderInteractions.add("GrainSize"); await c.api.run("lightroom.undo"); assert.equal(mutations, 0);
    c.activeSliderInteractions.clear(); c.api.ready();
    await Promise.all([c.api.run("lightroom.undo"), c.api.run("lightroom.undo")]);
    assert.equal(mutations, 1); assert.equal(refreshes, 3);
    assert.equal(c.undo.disabled, true, "history commands keep their existing settlement cooldown");
    console.log("Shared history: all tabs, stale replies, HTTP failure, connection/interaction guards and exactly-one command passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
