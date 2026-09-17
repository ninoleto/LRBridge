"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTabActions } = require("../app/controller-favorites");
const html = fs.readFileSync(require("node:path").join(__dirname, "../app/controller.html"), "utf8");
function readGroups(name) {
    const start = html.indexOf("const " + name + " = ") + ("const " + name + " = ").length;
    return JSON.parse(html.slice(start, html.indexOf(";", start)));
}
const selection = readGroups("selectionGroups"), application = readGroups("applicationGroups");
async function verify() {
    let connected = true, blocked = false, changes = 0, release = null, fail = false;
    const context = { activeModule: "develop", selectedPhotoUuid: "test-photo" }, sent = [];
    const controller = createTabActions({ tabs: [["Selection", selection], ["Application", application]],
        getContext: () => context, isConnected: () => connected, isBlocked: () => blocked,
        onChange: () => changes++, showDetails() {},
        send: async item => { sent.push(item); if (fail) throw Error("network uncertainty"); if (release) await new Promise(resolve => { release = resolve; }); return true; }
    });
    assert.equal(selection.flatMap(g => g.commands).length, 31);
    assert.equal(application.flatMap(g => g.commands).length, 34);
    assert.equal(controller.actions.length, 65);
    assert.equal(new Set(controller.actions.map(a => a.id)).size, 65);
    assert.equal(new Set(controller.actions.map(a => a.label)).size, 65, "labels make sense outside their original sections");
    const a = id => controller.get(id);
    for (const [groups, module] of [[selection, "library"], [application, "develop"]]) for (const group of groups) for (const item of group.commands) {
        context.activeModule = item.command === "application.view" && !item.value.startsWith("develop_") ? "library" : module;
        const action = controller.forItem(item);
        assert.equal(a(action.id), action, "original and favorite use one descriptor");
        assert.equal(action.available(), true, action.id);
        assert.equal(await action.run(), true); assert.equal(sent.at(-1), item);
        assert.match(action.feedback().detail, /Completion is not confirmed/);
    }
    assert.equal(sent.length, 65);
    assert.equal(a("selection.navigate.next").label, "Next Photo");
    assert.equal(a("application.secondary_view.grid").label, "Secondary Display: Grid");
    assert.equal(a("selection.label.set.none").label, "Clear Color Label");
    context.activeModule = "library"; context.selectedPhotoUuid = null;
    for (const id of ["selection.flag.pick", "photo.rotate.left", "photo.reveal.active", "selection.rating.set.5", "selection.label.set.red", "selection.extend.left", "selection.navigate.next", "application.view.compare", "application.action.zoom_in"]) assert.equal(a(id).available(), false, id);
    for (const id of ["selection.navigate.first", "selection.navigate.last", "selection.operation.select_all", "selection.operation.select_inverse", "application.view.grid", "application.module.develop", "application.action.toggle_secondary_display", "application.secondary_view.grid"]) assert.equal(a(id).available(), true, id);
    assert.equal(a("application.module.library").pressed(), true);
    assert.equal(a("application.action.toggle_secondary_display").pressed(), null, "no invented toggle state");
    context.selectedPhotoUuid = "test-photo";
    assert.equal(a("application.view.develop_before").available(), false);
    context.activeModule = "develop";
    assert.equal(a("application.view.grid").available(), false); assert.equal(a("application.view.develop_before").available(), true);
    context.activeModule = "map"; assert.equal(a("application.action.zoom_in").available(), false);
    assert.equal(a("application.module.map").pressed(), true);
    blocked = true; assert.ok(controller.actions.every(x => !x.available())); blocked = false;
    connected = false; assert.ok(controller.actions.every(x => !x.available())); assert.equal(a("application.module.map").pressed(), null); connected = true;
    context.activeModule = "unknown"; assert.ok(controller.actions.every(x => !x.available())); context.activeModule = "develop";
    release = true;
    const before = sent.length, pending = a("selection.navigate.next").run();
    assert.equal(await a("selection.navigate.next").run(), false);
    assert.equal(await a("application.module.library").run(), false);
    assert.equal(sent.length, before + 1); assert.equal(controller.isInteracting(), true);
    release(); release = null; await pending;
    assert.equal(controller.isInteracting(), false);
    fail = true; assert.equal(await a("selection.navigate.next").run(), false);
    assert.equal(sent.length, before + 2); assert.match(a("selection.navigate.next").feedback().detail, /no automatic retry/);
    assert.equal(changes, sent.length * 2);
    console.log("Tab actions: all 65 original descriptors, contextual labels, shared dispatch, module/photo/connection/gesture guards, authoritative module state and duplicate/uncertain requests passed.");
}
if (require.main === module) verify().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verify, selection, application };
