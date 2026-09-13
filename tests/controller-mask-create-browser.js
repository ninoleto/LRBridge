"use strict";
const assert = require("node:assert/strict");
const types = require("../app/controller-masking-corrections").creationTypes;

function install(fixture) {
    const handle = fixture.handle;
    const c = fixture.creation = { count: 0, active: false, pending: null, last: null, calls: [], hold: false, release: null };
    c.deletes = []; c.history = []; c.historyIndex = 0; c.historyCommands = [];
    c.diagnostics = [];
    c.componentCalls = []; c.componentCount = 1;
    c.selectionUnavailable = false; c.emptySelectionFrames = 0;
    fixture.handle = function (url, reply) {
        if (url.pathname === "/api/masking/state" && c.stateErrors > 0) {
            c.stateErrors -= 1; reply({ ok: false, error: "fixture feedback failure" }, 503); return true;
        }
        if (url.pathname === "/api/masking/state" && c.staleFeedback) {
            const stale = c.staleFeedback; c.staleFeedback = null; reply(stale); return true;
        }
        if (url.pathname === "/api/diagnostics/masking-deletion-browser") {
            c.diagnostics.push(JSON.parse(url.searchParams.get("report")));
            reply({ ok: true }); return true;
        }
        if (url.pathname === "/api/history/state") {
            reply({ ok: true, state: { available: true, canUndo: c.historyIndex > 0, canRedo: c.historyIndex < c.history.length } }); return true;
        }
        if (url.pathname === "/api/command" && /^lightroom\.(undo|redo)$/.test(url.searchParams.get("command"))) {
            const command = url.searchParams.get("command"); c.historyCommands.push(command);
            const entry = command === "lightroom.undo" ? c.history[--c.historyIndex] : c.history[c.historyIndex++];
            c.count = command === "lightroom.undo" ? entry.before : entry.after;
            if (entry.componentsBefore) c.componentCount = command === "lightroom.undo" ? entry.componentsBefore : entry.componentsAfter;
            if (entry.componentIdsBefore) {
                c.componentIds = (command === "lightroom.undo" ? entry.componentIdsBefore : entry.componentIdsAfter).slice();
                c.componentSelectedId = command === "lightroom.undo" ? entry.selectedBefore : entry.selectedAfter;
                c.componentCount = c.componentIds.length;
            }
            c.selectionUnavailable = false;
            c.last = null; fixture.revision += 1; reply({ ok: true }); return true;
        }
        if (["/api/masking/selected/delete", "/api/masking/all/delete"].includes(url.pathname)) {
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("stateRevision"), String(fixture.revision));
            const selected = url.pathname.includes("selected");
            if (selected) assert.equal(url.searchParams.get("selectedMaskGroupId"), "created-" + c.count);
            assert.ok(c.count > 0); assert.equal(c.pending, null);
            c.deletes.push(url.pathname); fixture.revision += 1;
            c.pending = { operationId: "mo-" + (100 + c.deletes.length), kind: selected ? "deleteSelected" : "deleteAll",
                open: null, direction: null, hidden: null };
            if (selected && !c.missingDeleteTarget) c.pending.beforeSelectedMaskId = "created-" + c.count;
            const admission = { ok: true, serverEpoch: "grain-fixture", revision: fixture.revision,
                operationId: c.pending.operationId, pendingOperation: { ...c.pending } };
            const count = c.count;
            const photo = fixture.context.selectedPhotoUuid;
            setTimeout(() => {
                reply(admission); c.count = selected ? count - 1 : 0;
                c.selectionUnavailable = true; fixture.revision += 1;
                c.history.splice(c.historyIndex); c.history.push({ before: count, after: c.count }); c.historyIndex += 1;
                // Match the native lifecycle: deletion leaves no selection until the operation selects a survivor.
                const finish = () => {
                    if (photo !== fixture.context.selectedPhotoUuid) return;
                    c.selectionUnavailable = c.selectionFails === true && c.count > 0;
                    c.last = { operationId: admission.operationId, outcome: c.selectionUnavailable ? "deleted" : "confirmed",
                        detail: c.selectionUnavailable ? "Mask deleted, but Lightroom could not select a remaining mask. Select a mask in Lightroom." : null };
                    if (c.confirmationFails) c.last = { operationId: admission.operationId, outcome: "failed",
                        detail: "Lightroom returned invalid Masking state." };
                    c.pending = null; fixture.revision += 1;
                };
                if (c.holdDeleteResult) c.releaseDeleteResult = finish; else setTimeout(finish, 420);
            }, 180);
            return true;
        }
        if (url.pathname === "/api/masking/component/delete") {
            const targetMaskId = "created-" + c.count, targetToolId = c.componentSelectedId;
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("selectedMaskGroupId"), targetMaskId);
            assert.equal(url.searchParams.get("selectedMaskToolId"), targetToolId);
            assert.equal(url.searchParams.get("stateRevision"), String(fixture.revision));
            assert.ok(targetToolId && c.componentIds.includes(targetToolId)); assert.equal(c.pending, null);
            c.componentDeletes.push({ targetMaskId, targetToolId }); fixture.revision += 1;
            c.pending = { operationId: "mo-" + (300 + c.componentDeletes.length), kind: "deleteComponent",
                beforeSelectedMaskId: targetMaskId, beforeSelectedMaskToolId: targetToolId };
            const admission = { ok: true, serverEpoch: "grain-fixture", revision: fixture.revision,
                operationId: c.pending.operationId, pendingOperation: { ...c.pending } };
            const before = c.count, ids = c.componentIds.slice(), index = ids.indexOf(targetToolId);
            const finish = () => {
                reply(admission);
                if (c.holdComponentDelete) return;
                if (c.componentDeleteOutcome !== "stale") {
                    c.componentIds = ids.filter(id => id !== targetToolId);
                    c.componentSelectedId = c.componentIds[index] || c.componentIds[index - 1] || null;
                    if (!c.componentIds.length && !c.retainEmptyParent) {
                        c.count -= 1;
                        c.componentIds = c.count ? ["survivor-component"] : [];
                        c.componentSelectedId = c.componentIds[0] || null;
                    }
                    if (c.componentDeleteSelectionFails) c.componentSelectedId = null;
                    c.componentCount = c.componentIds.length;
                    c.history.splice(c.historyIndex); c.history.push({ before, after: c.count,
                        componentIdsBefore: ids, componentIdsAfter: c.componentIds.slice(), selectedBefore: targetToolId, selectedAfter: c.componentSelectedId });
                    c.historyIndex += 1;
                }
                c.last = { operationId: admission.operationId, outcome: c.componentDeleteOutcome || (c.componentDeleteSelectionFails ? "deleted" : "confirmed"),
                    targetMaskId, targetToolId: c.wrongComponentResultTarget ? "wrong-tool" : targetToolId,
                    parentRemoved: c.count < before, remainingComponentCount: ids.length - 1,
                    detail: c.componentDeleteSelectionFails ? "Component deleted, but Lightroom could not select a remaining component. Select a component in Lightroom." : null };
                c.pending = null; fixture.revision += 1;
            };
            if (c.holdComponentDelete) c.releaseComponentDelete = finish; else setTimeout(finish, 180);
            return true;
        }
        if (/^\/api\/masking\/component\/(add|subtract)$/.test(url.pathname)) {
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("selectedMaskGroupId"), "created-" + c.count);
            assert.equal(url.searchParams.get("stateRevision"), String(fixture.revision));
            const kind = url.pathname.endsWith("/add") ? "add" : "subtract";
            const type = types.find(t => t.maskType === url.searchParams.get("maskType") && t.maskSubtype === url.searchParams.get("maskSubtype"));
            assert.ok(type); assert.equal(c.pending, null);
            c.componentCalls.push({ kind, type }); fixture.revision += 1;
            c.pending = { operationId: "mo-" + (200 + c.componentCalls.length), kind,
                maskType: type.maskType, maskSubtype: type.maskSubtype, beforeSelectedMaskId: "created-" + c.count };
            const admission = { ok: true, serverEpoch: "grain-fixture", revision: fixture.revision,
                operationId: c.pending.operationId, pendingOperation: { ...c.pending } };
            const finish = () => {
                reply(admission);
                if (c.holdComponent) return;
                const before = c.componentCount;
                // Interactive fixture exposes a new entry but does not prove drawing is finished.
                c.componentCount += 1;
                c.history.splice(c.historyIndex); c.history.push({ before: c.count, after: c.count,
                    componentsBefore: before, componentsAfter: c.componentCount }); c.historyIndex += 1;
                c.last = { operationId: admission.operationId, outcome: type.instruction ? "started" : "confirmed" };
                c.pending = null; fixture.revision += 1;
            };
            if (c.holdComponent) c.releaseComponent = finish; else setTimeout(finish, 180);
            return true;
        }
        if (url.pathname === "/api/masking/create") {
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("contextCounter"), String(fixture.context.contextCounter));
            const type = types.find(t => t.maskType === url.searchParams.get("maskType") && t.maskSubtype === url.searchParams.get("maskSubtype"));
            assert.ok(type); assert.equal(c.pending, null);
            c.calls.push(type); fixture.revision += 1;
            c.pending = { operationId: "mo-" + c.calls.length, kind: "create", maskType: type.maskType, maskSubtype: type.maskSubtype };
            const admission = { ok: true, serverEpoch: "grain-fixture", revision: fixture.revision,
                operationId: c.pending.operationId, pendingOperation: { ...c.pending } };
            const finish = () => {
                reply(admission);
                if (c.hold) return;
                c.active = true; if (!type.instruction && !c.delayAuto) c.count += 1;
                c.last = { operationId: admission.operationId, outcome: type.instruction || c.delayAuto ? "started" : "confirmed" };
                c.pending = null; fixture.revision += 1;
            };
            if (c.hold) c.release = finish; else setTimeout(finish, 180);
            return true;
        }
        return handle(url, body => {
            if (url.pathname === "/api/masking/state") {
                Object.assign(body, { active: c.active, maskGroupCount: c.count, pendingOperation: c.pending, lastResult: c.last,
                    hasSelectedMaskGroup: c.active ? c.count > 0 : null,
                    selectedMaskGroupIndex: c.count || null, selectedMaskGroupId: c.count ? "created-" + c.count : null,
                    selectedMaskGroupName: c.count ? "Created mask " + c.count : null,
                    selectedMaskHidden: c.count ? false : null, previousAvailable: c.count > 1, nextAvailable: false,
                    selectedMaskToolAvailable: c.count > 0, selectedMaskToolId: c.count ?
                        (c.componentCount > 1 ? "component-" + c.componentCount : "created-tool-" + c.count) : null,
                    selectedMaskToolHidden: c.count ? false : null, selectedMaskToolCount: c.count ? c.componentCount : null,
                    selectedMaskToolIndex: c.count ? c.componentCount : null, previousMaskToolAvailable: c.componentCount > 1, nextMaskToolAvailable: false });
                if (c.componentIds && c.count > 0) {
                    const index = c.componentIds.indexOf(c.componentSelectedId);
                    Object.assign(body, { selectedMaskToolAvailable: index >= 0, selectedMaskToolId: index >= 0 ? c.componentSelectedId : null,
                        selectedMaskToolName: null, selectedMaskToolType: null, selectedMaskToolSubtype: null,
                        selectedMaskToolHidden: index >= 0 ? false : null, selectedMaskToolCount: c.componentIds.length,
                        selectedMaskToolIndex: index >= 0 ? index + 1 : null,
                        previousMaskToolAvailable: index > 0, nextMaskToolAvailable: index >= 0 && index < c.componentIds.length - 1 });
                }
                if (!c.count) body.corrections = [];
                if (c.selectionUnavailable && c.count > 0) {
                    c.emptySelectionFrames += 1;
                    Object.assign(body, { hasSelectedMaskGroup: false, selectedMaskGroupIndex: null, selectedMaskGroupId: null,
                        selectedMaskGroupName: null, selectedMaskHidden: null, previousAvailable: false, nextAvailable: false,
                        selectedMaskToolAvailable: false, selectedMaskToolId: null, selectedMaskToolHidden: null,
                        selectedMaskToolCount: null, selectedMaskToolIndex: null, corrections: [] });
                }
                c.lastState = JSON.parse(JSON.stringify(body));
            }
            if (url.pathname === "/api/masking/tone-curve/state") body = { ok: true, pointCurve: { available: false } };
            reply(body);
        });
    };
}

async function verify({ evaluate, waitFor, fixture, setViewport, touch, key, capture }) {
    const c = fixture.creation;
    if (c.confirmationOnly) {
        const warning = "Lightroom could not confirm removal. Check the current mask inventory before another delete.";
        const ready = () => evaluate("!document.querySelector('.masking-delete-selected-button').disabled");
        await waitFor(ready, "diagnostic deletion ready");
        // Captured mo-9 wire sequence: admission omits beforeSelectedMaskId,
        // strict server confirmation arrives later with the surviving selection.
        c.missingDeleteTarget = true;
        await evaluate("document.querySelector('.masking-delete-selected-button').click()");
        await waitFor(() => evaluate("document.querySelector('.masking-status').textContent===" + JSON.stringify(warning)), "captured admission warning");
        await waitFor(() => c.last && c.last.outcome === "confirmed" && c.pending === null, "captured authoritative completion");
        await waitFor(() => evaluate("document.querySelector('.masking-status').textContent==='Mask deleted; inventory and selection confirmed by Lightroom.'"),
            "only this confirmed deletion's obsolete admission warning clears");
        assert.equal(c.count, 3); assert.equal(c.deletes.length, 1);
        c.missingDeleteTarget = false;
        const earlierDeletes = c.deletes.length;
        c.confirmationFails = true;
        await evaluate("document.querySelector('.masking-delete-selected-button').click();document.querySelector('.masking-delete-selected-button').click()");
        await waitFor(() => evaluate("document.querySelector('.masking-status').textContent===" + JSON.stringify(warning)), "removal warning with recovered selection");
        await waitFor(() => c.diagnostics.some(e => e.event === "render" && e.data.persistentError === warning), "warning diagnostic delivery");
        const failedId = c.last.operationId;
        assert.equal(c.count, 2); assert.equal(c.selectionUnavailable, false); assert.equal(c.deletes.length, earlierDeletes + 1);
        assert.ok(c.diagnostics.some(e => e.event === "admission-response" && e.data.data.operationId === failedId && !e.data.ignored));
        assert.ok(c.diagnostics.some(e => e.event === "matching-result" && e.operationId === failedId && e.data.result.outcome === "failed"));
        assert.ok(c.diagnostics.some(e => e.event === "render" && e.operationId === failedId && e.data.persistentError === warning &&
            e.data.state.selectedMaskGroupId === "created-2" && e.data.state.selectedMaskToolId === "created-tool-2"));
        // Later unrelated results must not be mistaken for this deletion's proof.
        c.last = { operationId: "mo-999", outcome: "confirmed", detail: null }; fixture.revision += 1;
        await waitFor(() => c.diagnostics.some(e => e.event === "feedback" && e.data.incoming.lastResult &&
            e.data.incoming.lastResult.operationId === "mo-999"), "overtaking result diagnostic");
        assert.equal(await evaluate("document.querySelector('.masking-status').textContent"), warning);
        c.confirmationFails = false;
        await waitFor(ready, "second fixture deletion ready");
        await evaluate("document.querySelector('.masking-delete-selected-button').click()");
        await waitFor(() => c.diagnostics.some(e => e.event === "render" && e.operationId === c.last.operationId &&
            e.data.state.lastResult && e.data.state.lastResult.operationId === c.last.operationId &&
            e.data.state.lastResult.outcome === "confirmed" && !e.data.activeOperation), "confirmed diagnostic");
        assert.equal(c.count, 1); assert.equal(c.deletes.length, earlierDeletes + 2);
        assert.equal(await evaluate("document.querySelector('.masking-status').textContent"), warning,
            "a different deletion's success must preserve the earlier genuine unconfirmed-removal error");
        const newPhoto = async id => {
            fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = id;
            fixture.context.contextCounter += 1; c.count = 2; c.pending = c.last = null;
            c.selectionUnavailable = false; fixture.revision += 1;
            await waitFor(() => c.diagnostics.some(e => e.event === "feedback" && e.data.accepted &&
                e.data.incoming.selectedPhotoUuid === id), "fresh diagnostic photo");
            await waitFor(ready, "fresh-photo deletion available");
        };
        await newPhoto("deletion-other-error");
        c.missingDeleteTarget = true; c.holdDeleteResult = true; c.releaseDeleteResult = null;
        await evaluate("document.querySelector('.masking-delete-selected-button').click()");
        await waitFor(() => c.releaseDeleteResult && c.diagnostics.some(e => e.event === "render" &&
            e.attempt === 4 && e.data.persistentError === warning), "owned admission warning");
        c.stateErrors = 1;
        await waitFor(() => evaluate("document.querySelector('.masking-status').textContent==='Could not refresh Masking state.'"), "unrelated feedback error");
        const release = c.releaseDeleteResult; release();
        await waitFor(() => c.diagnostics.some(e => e.event === "removal-warning-reconciled" && e.operationId === c.last.operationId), "proof settles only owned warning");
        assert.equal(await evaluate("document.querySelector('.masking-status').textContent"), "Could not refresh Masking state.");

        await newPhoto("deletion-context-before");
        c.releaseDeleteResult = null;
        await evaluate("document.querySelector('.masking-delete-selected-button').click()");
        await waitFor(() => c.releaseDeleteResult && c.lastState.pendingOperation, "old-context pending deletion");
        const oldReply = { ...c.lastState, revision: fixture.revision + 2, pendingOperation: null,
            lastResult: { operationId: c.pending.operationId, outcome: "confirmed", detail: null } };
        const oldId = c.pending.operationId;
        await newPhoto("deletion-context-after");
        c.staleFeedback = oldReply;
        await waitFor(() => c.diagnostics.some(e => e.event === "feedback" && e.data.incoming.lastResult &&
            e.data.incoming.lastResult.operationId === oldId && !e.data.accepted), "late old-photo confirmation rejected");
        assert.equal(c.diagnostics.some(e => e.event === "removal-warning-reconciled" && e.operationId === oldId), false);
        assert.equal(c.deletes.length, 5, "warning recovery never repeats deletion or selects anything");
        assert.ok(c.diagnostics.every(e => e.version === "mask-delete-confirmation-1"));
        return { capturedAdmissionRecovery: true, deletionDiagnostics: true, recoveredSelectionWithRejectedConfirmation: true,
            unrelatedResultCannotConfirmRemoval: true, unrelatedErrorPreserved: true, stalePhotoRejected: true, exactlyOnce: true };
    }
    const open = async () => {
        await waitFor(() => evaluate("!document.querySelector('.masking-create-button').disabled"), "eligible Create New Mask");
        await evaluate("document.querySelector('.masking-create-button').scrollIntoView({block:'center'});document.querySelector('.masking-create-button').click()");
        assert.equal(await evaluate("!document.querySelector('.masking-create-menu').hidden"), true);
    };
    const choose = async subtype => {
        await open();
        await evaluate("(() => {const b=[...document.querySelectorAll('.masking-create-type')].find(b=>b.dataset.maskSubtype===" +
            JSON.stringify(subtype) + ");b.click();b.click();})()");
    };
    await open();
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.masking-create-type')].map(b=>[b.textContent,b.dataset.maskType,b.dataset.maskSubtype])"), [
        ["Select Subject", "aiSelection", "subject"], ["Select Sky", "aiSelection", "sky"],
        ["Select Background", "aiSelection", "background"], ["Select People", "aiSelection", "people"],
        ["Select Landscape", "aiSelection", "landscape"], ["Select Objects", "aiSelection", "objects"],
        ["Brush", "brush", ""], ["Linear Gradient", "gradient", ""], ["Radial Gradient", "radialGradient", ""],
        ["Color Range", "rangeMask", "color"], ["Luminance Range", "rangeMask", "luminance"], ["Depth Range", "rangeMask", "depth"]
    ]);
    assert.deepEqual(await evaluate("[...document.querySelector('.masking-create-choices').children].map((b,i)=>b.getAttribute('role')==='separator'?i:null).filter(i=>i!==null)"), [6, 10]);
    assert.equal(await evaluate("document.querySelector('.masking-panel-button').textContent"), "Open Masking");
    await evaluate("document.querySelector('.masking-create-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await evaluate("document.activeElement===document.querySelector('.masking-create-button')"), true);
    assert.equal(c.calls.length, 0);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const tap = async selector => {
        const p = await evaluate("(() => {const r=document.querySelector(" + JSON.stringify(selector) + ").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
        await touch("touchStart", p.x, p.y); await touch("touchEnd", p.x, p.y); await pause(40);
    };
    const observe = async () => evaluate("(() => {window.__pickerFrames=[];window.__pickerObserve=true;const sample=()=>{__pickerFrames.push([document.scrollingElement.scrollTop,document.querySelector('.masking-action-row').getBoundingClientRect().top]);if(__pickerObserve)requestAnimationFrame(sample);};sample();})()");
    const stable = async () => {
        await pause(100);
        const frames = await evaluate("(__pickerObserve=false,__pickerFrames)");
        assert.ok(frames.length > 2);
        for (const frame of frames) frame.forEach((value, i) => assert.ok(Math.abs(value - frames[0][i]) < 1, "picker must not move underlying page: " + JSON.stringify([frames[0], frame])));
    };
    for (const [width, height] of [[1280, 900], [768, 1024], [390, 640], [320, 480]]) {
        await setViewport(width, height);
        await evaluate("document.querySelector('.masking-create-button').scrollIntoView({block:'center'})"); await pause(100);
        await observe(); await tap(".masking-create-button");
        const geometry = await evaluate("(() => {const d=document.querySelector('.masking-create-menu'),r=d.getBoundingClientRect(),g=document.querySelector('.masking-create-choices');return {rect:[r.left,r.top,r.right,r.bottom],columns:getComputedStyle(g).gridTemplateColumns.split(' ').length,heights:[...g.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height),overflow:g.scrollHeight>g.clientHeight};})()");
        assert.ok(geometry.rect[0] >= 0 && geometry.rect[1] >= 0 && geometry.rect[2] <= width && geometry.rect[3] <= height);
        assert.equal(geometry.columns, width > 600 ? 3 : 2);
        assert.ok(geometry.heights.every(h => h >= 52));
        if (capture) await capture("picker-" + width);
        if (geometry.overflow) {
            const p = await evaluate("(() => {const r=document.querySelector('.masking-create-choices').getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-20,top:r.top+20};})()");
            for (let swipe = 0; swipe < 3; swipe++) {
                await touch("touchStart", p.x, p.y);
                for (let step = 1; step <= 8; step++) { await touch("touchMove", p.x, p.y - (p.y - p.top) * step / 8); await pause(20); }
                await touch("touchEnd", p.x, p.top); await pause(200);
            }
            assert.equal(await evaluate("(() => {const g=document.querySelector('.masking-create-choices'),b=g.querySelector('button:last-child').getBoundingClientRect(),r=g.getBoundingClientRect();return g.scrollTop>0&&b.top>=r.top&&b.bottom<=r.bottom+1;})()"), true, "finger scrolling reaches Depth Range fully");
            if (capture) await capture("picker-" + width + "-bottom");
        }
        await tap(".masking-create-close"); await stable();
        await observe(); await tap(".masking-create-button"); await key("Escape"); await stable();
        assert.equal(await evaluate("document.querySelector('.masking-create-menu').hidden"), true);
        await observe(); await tap(".masking-create-button");
        await touch("touchStart", 2, 2); await touch("touchEnd", 2, 2); await stable();
        assert.equal(await evaluate("document.querySelector('.masking-create-menu').hidden"), true, "backdrop touch dismisses without moving page");
        const row = await evaluate("(() => {const r=document.querySelector('.masking-action-row').getBoundingClientRect();return [...document.querySelectorAll('.masking-action-row button:not(.masking-create-menu button)')].every(b=>{const e=b.getBoundingClientRect();return e.left>=0&&e.right<=innerWidth;});})()");
        assert.equal(row, true, "action row wraps inside viewport");
    }
    // Hit-test every actual creation option with touch, including the last row of the small sheet.
    await setViewport(390, 640);
    for (const type of types) {
        await open();
        const selector = '.masking-create-type[data-mask-type="' + type.maskType + '"][data-mask-subtype="' + type.maskSubtype + '"]';
        await evaluate("document.querySelector(" + JSON.stringify(selector) + ").scrollIntoView({block:'nearest'})");
        await observe(); await tap(selector);
        await waitFor(() => evaluate("!document.querySelector('.masking-create-button').disabled"), "touch creation settlement");
        await stable();
        assert.equal(c.calls.at(-1), type);
    }
    assert.equal(c.calls.length, 12);
    c.calls = []; c.count = 0; c.active = false; c.last = null; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-panel-button').textContent==='Open Masking'"), "creation fixture restored");
    await choose("");
    await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('Draw in Lightroom')"), "interactive start acknowledgement");
    assert.equal(c.calls.length, 1); assert.equal(c.count, 0);
    assert.equal(await evaluate("document.querySelector('.masking-position').textContent.includes('Mask 1')"), false);
    // Drawing completes in the simulated native application; normal polling supplies its inventory.
    c.count = 1; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-position').textContent.includes('Mask 1 of 1')"), "native drawing inventory");
    await choose("subject");
    await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('inventory and selection confirmed')"), "automatic mask confirmation");
    assert.equal(c.calls.length, 2);
    assert.equal(await evaluate("document.querySelector('.masking-position').textContent.includes('Mask 2 of 2')"), true);
    c.delayAuto = true;
    await choose("sky");
    await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('Waiting for Lightroom')"), "delayed AI request");
    c.count = 3; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('inventory and selection confirmed')"), "delayed authoritative AI inventory");
    assert.equal(c.calls.length, 3);
    await open();
    fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "creation-photo-b";
    fixture.context.contextCounter += 1; c.count = 0; c.active = false; c.last = null; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-create-menu').hidden"), "menu cancellation on photo change");
    await evaluate("document.querySelector('.masking-create-type').click()");
    assert.equal(c.calls.length, 3, "an old menu choice must not create a mask on the new photo");
    c.hold = true; await choose("sky");
    await waitFor(async () => Boolean(c.release), "held creation admission");
    fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "creation-photo-c";
    fixture.context.contextCounter += 1; c.pending = null; c.last = null; fixture.revision += 1;
    const reads = fixture.contextReads;
    await waitFor(async () => fixture.contextReads > reads + 1, "new photo context");
    c.release();
    await waitFor(() => evaluate("!document.querySelector('.masking-create-button').disabled"), "new-photo creation recovered");
    assert.equal(await evaluate("document.querySelector('.masking-status').textContent.includes('confirmed')"), false);
    c.hold = false; c.active = true; c.count = 2; c.last = null; fixture.revision += 1;
    const deleteButton = ".masking-delete-selected-button";
    const historyButton = index => "document.querySelectorAll('#historyToolbar button')[" + index + "]";
    const history = async (index, count) => {
        await waitFor(() => evaluate("!" + historyButton(index) + ".disabled"), "authoritative history availability after deletion");
        await evaluate(historyButton(index) + ".click();" + historyButton(index) + ".click()");
        const expected = count ? "Mask " + count + " of " + count : "No masks available.";
        await waitFor(() => evaluate("document.querySelector('.masking-position').textContent.includes(" + JSON.stringify(expected) + ")"), "history restores authoritative masks");
    };
    const deleteOne = async expected => {
        await waitFor(() => evaluate("!document.querySelector('" + deleteButton + "').disabled"), "selected deletion availability");
        await evaluate("document.querySelector('" + deleteButton + "').click();document.querySelector('" + deleteButton + "').click()");
        await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('Mask deleted;')"), "authoritative deletion confirmation");
        assert.equal(c.count, expected);
    };
    await deleteOne(1); assert.equal(c.deletes.length, 1);
    await history(0, 2); await history(1, 1); assert.equal(c.historyCommands.length, 2);
    await deleteOne(0);
    assert.equal(await evaluate("document.querySelector('.masking-delete-selected-button').disabled&&document.querySelector('.masking-delete-all-button').disabled&&!document.querySelector('.masking-create-button').disabled"), true);
    await history(0, 1);
    await evaluate("window.__deletePrompts=[];window.__deleteAccept=false");
    await evaluate("document.querySelector('.masking-delete-all-button').click()");
    assert.equal(c.deletes.length, 2); assert.equal(c.count, 1);
    assert.deepEqual(await evaluate("__deletePrompts"), ["Delete all 1 mask from this photograph?"]);
    c.count = 3; c.last = null; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-position').textContent.includes('Mask 3 of 3')"), "three-mask fixture");
    await evaluate("window.__deleteAccept=true;document.querySelector('.masking-delete-all-button').click();document.querySelector('.masking-delete-all-button').click()");
    await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('All masks deleted;')"), "all deletion confirmation");
    assert.equal(c.count, 0); assert.equal(c.deletes.length, 3);
    assert.deepEqual(await evaluate("__deletePrompts"), ["Delete all 1 mask from this photograph?", "Delete all 3 masks from this photograph?"]);
    await history(0, 3); assert.equal(c.historyCommands.length, 4);
    await history(1, 0); await history(0, 3); assert.equal(c.historyCommands.length, 6);
    assert.ok(c.emptySelectionFrames > 0, "polling must exercise survivors with no native selection during replacement");
    c.selectionFails = true;
    await waitFor(() => evaluate("!document.querySelector('.masking-delete-selected-button').disabled"), "partial deletion fixture ready");
    await evaluate("document.querySelector('.masking-delete-selected-button').click()");
    await waitFor(() => evaluate("document.querySelector('.masking-status').textContent.includes('Mask deleted, but')"), "specific replacement-selection failure");
    assert.equal(await evaluate("document.querySelector('.masking-position').textContent==='No mask is selected.'"), true);
    assert.equal(await evaluate("document.querySelector('.masking-delete-selected-button').disabled&&!document.querySelector('.masking-create-button').disabled&&!document.querySelector('.masking-delete-all-button').disabled"), true);
    assert.doesNotMatch(await evaluate("document.querySelector('.masking-status').textContent"), /try again|retry/i);
    assert.equal(c.deletes.length, 4, "partial selection failure cannot resubmit the destructive call");
    await history(0, 3);
    assert.doesNotMatch(await evaluate("document.querySelector('.masking-status').textContent"), /could not select a remaining mask/,
        "authoritative recovered selection resolves only the deletion-selection warning");
    c.selectionFails = false;
    const components = await require("./controller-mask-components-browser").verify({ evaluate, waitFor, fixture, setViewport, touch, key });
    const componentDeletion = await require("./controller-mask-component-delete-browser").verify({ evaluate, waitFor, fixture, setViewport, touch });
    const componentInversion = await require("./controller-mask-component-invert-browser").verify({ evaluate, waitFor, fixture, setViewport, touch });
    return { choices: 12, touchWidths: [1280, 768, 390, 320], continuousPageGeometry: true, emptyPhoto: true,
        interactive: true, automatic: true, duplicateGuard: true, photoCancellation: true,
        selectedDeletion: true, lastMask: true, deleteAllCancellation: true, deleteAll: true, history: true,
        emptySelectionFrames: c.emptySelectionFrames, partialSelectionFailure: true, components, componentDeletion, componentInversion };
}
module.exports = { install, verify };
