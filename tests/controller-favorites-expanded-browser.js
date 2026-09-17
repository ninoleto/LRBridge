"use strict";
const assert = require("node:assert/strict");
const { selection, application } = require("./controller-tab-actions");
async function verify({ evaluate, waitFor, selectTab, fixture, setViewport, reload, capture }) {
    const originalHandle = fixture.handle, calls = [];
    let hold = false, heldReply = null, disconnected = false;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/context" && disconnected) { reply({ ...fixture.context, lastHeartbeatAt: Date.now() - 10000 }); return true; }
        if (url.pathname === "/api/command" && !url.searchParams.get("command").startsWith("lightroom.")) {
            calls.push(Object.fromEntries(url.searchParams));
            if (hold) heldReply = () => reply({ ok: true }); else reply({ ok: true });
            return true;
        }
        return originalHandle(url, reply);
    };
    const favorite = id => "document.querySelector('[data-favorite-action=\"" + id + "\"]')";
    const source = id => "document.querySelector('[data-controller-action=\"" + id + "\"]')";
    const order = () => evaluate("Array.from(document.querySelectorAll('[data-favorite-action]'),b=>b.dataset.favoriteAction)");
    const customize = () => evaluate("document.getElementById('favoritesCustomize').click()");
    const close = () => evaluate("document.getElementById('favoritesClose').click()");
    const search = value => evaluate("document.getElementById('favoritesSearch').value=" + JSON.stringify(value) + ";document.getElementById('favoritesSearch').dispatchEvent(new Event('input'))");
    const add = id => evaluate("document.getElementById('favoritesAddChoice').value=" + JSON.stringify(id) + ";document.getElementById('favoritesAdd').click()");
    const enabled = id => waitFor(() => evaluate(favorite(id) + "?.getAttribute('aria-disabled')==='false'"), "expanded favorite available: " + id);
    const click = id => evaluate(favorite(id) + ".click()");
    const context = (module, photo = "browser-lifecycle-photo") => {
        Object.assign(fixture.context, { activeModule: module, selectedPhotoUuid: photo, selectedPhotoKey: photo,
            contextCounter: fixture.context.contextCounter + 1, contextChangedAt: fixture.context.contextChangedAt + 1 });
    };
    try {
        await customize();
        const expected = ["clipboard.copy", "clipboard.paste", "export.dialog", "export.previous", ...[...selection, ...application].flatMap(g => g.commands.map(i => i.command + "." + i.value))];
        const choices = await evaluate("Array.from(document.getElementById('favoritesAddChoice').options,o=>o.value)");
        assert.deepEqual(choices.slice().sort(), expected.sort(), "every action from both complete tabs is offered");
        assert.equal(new Set(choices).size, 69);
        assert.equal(await evaluate("document.querySelectorAll('#favoritesAddChoice optgroup').length"), 16);
        assert.deepEqual(await order(), ["lightroom.undo", "lightroom.redo"], "new choices are never auto-added");
        await search("APPLICATION secondary");
        assert.equal(await evaluate("document.getElementById('favoritesAddChoice').options.length"), 9);
        await search("no-such-action"); assert.equal(await evaluate("document.getElementById('favoritesAdd').disabled"), true);
        assert.match(await evaluate("document.getElementById('favoritesMatches').textContent"), /No matching/);
        await search("rate 5"); assert.equal(await evaluate("document.getElementById('favoritesAddChoice').value"), "selection.rating.set.5");
        await search(""); await add("selection.navigate.next");
        assert.equal(await evaluate("Array.from(document.getElementById('favoritesAddChoice').options).some(o=>o.value==='selection.navigate.next')"), false);
        await add("selection.navigate.next"); assert.equal((await order()).length, 3, "duplicate add rejected");
        for (const width of [1280, 390]) {
            await setViewport(width, 900); await search("Application zoom");
            assert.equal(await evaluate("document.getElementById('favoritesAddChoice').options.length"), 4);
            if (capture) await capture("expanded-chooser-" + width);
        }
        await search("");
        const added = ["photo.rotate.left", "photo.reveal.active", "selection.flag.pick", "selection.rating.set.5", "selection.label.set.red",
            "selection.extend.left", "selection.operation.select_all", "selection.operation.select_none", "selection.navigate.first",
            "application.module.library", "application.module.develop", "application.view.grid", "application.view.compare", "application.view.develop_before",
            "application.action.zoom_in", "application.action.toggle_zoom", "application.action.next_screen_mode", "application.action.fullscreen_preview",
            "application.action.toggle_secondary_display", "application.action.toggle_secondary_fullscreen", "application.secondary_view.grid"];
        for (const id of added) await add(id);
        const saved = await order(); await close(); await reload();
        assert.deepEqual(await order(), saved, "expanded preferences retain IDs and exact order across reload");
        context("develop");
        await selectTab("selection");
        await enabled("selection.navigate.next");
        await waitFor(() => evaluate("document.querySelector('.export-selection').textContent.includes('selected')"), "Export selection feedback before layout capture");
        const headings = await evaluate("Array.from(document.querySelectorAll('#content > section > .group-title'),n=>n.textContent)");
        assert.deepEqual(headings, [...selection.map(g => g.name), "Export", "Copy / Paste Settings"]);
        assert.equal(await evaluate("document.querySelectorAll('[data-controller-action]').length"), 31);
        for (const width of [1280, 390, 320]) {
            await setViewport(width, 900); await evaluate("window.scrollTo(0,0)");
            if (capture && width !== 320) await capture("selection-navigate-first-" + width);
            await evaluate("document.querySelectorAll('.tab-action-group')[2].scrollIntoView({block:'start'})");
            assert.equal(await evaluate("document.querySelectorAll('.tab-action-group')[2].getBoundingClientRect().top>=document.getElementById('historyToolbar').getBoundingClientRect().bottom"), true, "favorites do not cover scrolled section heading");
            await evaluate("document.getElementById('clipboardSection').scrollIntoView({block:'end'})");
            if (capture && width !== 320) await capture("selection-copy-paste-last-" + width);
            assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
            assert.equal(await evaluate("document.getElementById('historyToolbar').getBoundingClientRect().height"), 64);
        }
        await enabled("selection.navigate.next");
        await evaluate(favorite("selection.navigate.next") + ".focus({preventScroll:true})");
        const pageScroll = await evaluate("window.scrollY");
        hold = true; await click("selection.navigate.next");
        await waitFor(() => heldReply, "one shared pending command");
        await evaluate(source("selection.navigate.next") + ".click()"); await click("application.module.library");
        assert.equal(calls.length, 1, "original/favorite share duplicate and pending guard");
        assert.equal(await evaluate("document.activeElement.dataset.favoriteAction"), "selection.navigate.next", "pending shared action retains keyboard focus");
        assert.equal(await evaluate("window.scrollY"), pageScroll, "pending feedback preserves page scrolling");
        hold = false; heldReply(); heldReply = null; await enabled("selection.navigate.next");
        await evaluate(source("selection.navigate.next") + ".click()"); await waitFor(() => calls.length === 2, "original same route");
        assert.deepEqual(calls[0], calls[1]);
        // Commands from both tabs work everywhere without mounting their source tab.
        const representatives = ["photo.rotate.left", "selection.flag.pick", "selection.rating.set.5", "selection.label.set.red", "selection.extend.left",
            "selection.operation.select_all", "photo.reveal.active", "application.view.develop_before", "application.action.zoom_in",
            "application.action.toggle_zoom", "application.action.next_screen_mode", "application.action.toggle_secondary_display",
            "application.action.toggle_secondary_fullscreen", "application.secondary_view.grid"];
        const tabs = ["sliders", "tone-curve", "color-grading", "presets", "tools", "application", "selection"];
        for (const [index, id] of representatives.entries()) {
            const tab = tabs[index % tabs.length]; await selectTab(tab); await enabled(id);
            const count = calls.length; await click(id); await waitFor(() => calls.length === count + 1, "representative " + id);
            assert.equal(await evaluate("document.querySelector('.tab-button.active').dataset.tab"), tab, "action never switches controller tab");
            assert.equal(calls.at(-1).command + "." + (calls.at(-1).direction || calls.at(-1).flag || calls.at(-1).rating || calls.at(-1).label || calls.at(-1).operation || calls.at(-1).scope || calls.at(-1).view || calls.at(-1).action), id);
        }
        await selectTab("application"); await enabled("application.module.library");
        assert.equal(await evaluate("document.querySelectorAll('[data-controller-action]').length"), 34);
        assert.equal(await evaluate(favorite("application.module.develop") + ".getAttribute('aria-pressed')"), "true");
        await click("application.module.library"); await enabled("application.module.library");
        assert.equal(await evaluate(favorite("application.module.library") + ".getAttribute('aria-pressed')"), "false", "request cannot invent active module");
        context("library"); await enabled("application.view.grid");
        await waitFor(() => evaluate(favorite("application.module.library") + ".getAttribute('aria-pressed')==='true'"), "authoritative module feedback");
        assert.equal(await evaluate(source("application.module.library") + ".getAttribute('aria-pressed')"), "true");
        assert.equal(await evaluate(favorite("application.view.develop_before") + ".getAttribute('aria-disabled')"), "true");
        assert.equal(await evaluate(source("application.view.develop_before") + ".getAttribute('aria-disabled')"), "true");
        assert.equal(await evaluate(favorite("application.action.toggle_secondary_display") + ".hasAttribute('aria-pressed')"), false);
        const prior = calls.length; await click("application.view.grid"); await waitFor(() => calls.length === prior + 1, "Library view uses shared route");
        context("library", null);
        await waitFor(() => evaluate("lastControllerSelectedPhotoUuid===null"), "authoritative empty selection applied");
        await waitFor(() => evaluate(favorite("photo.rotate.left") + ".getAttribute('aria-disabled')==='true'"), "missing active photo");
        await click("photo.rotate.left"); await click("selection.flag.pick"); await click("application.view.compare");
        assert.equal(calls.length, prior + 1);
        await enabled("selection.navigate.first"); await enabled("selection.operation.select_all"); await enabled("application.module.develop");
        context("map"); await waitFor(() => evaluate(favorite("application.action.zoom_in") + ".getAttribute('aria-disabled')==='true'"), "zoom module restriction");
        disconnected = true;
        await waitFor(() => evaluate(favorite("application.module.library") + ".getAttribute('aria-disabled')==='true'"), "stale heartbeat");
        await click("application.module.library"); assert.equal(calls.length, prior + 1);
        disconnected = false; context("develop"); await enabled("photo.rotate.left");
        await evaluate("activeSliderInteractions.add('Exposure');updateHistoryButtons()");
        assert.equal(await evaluate(favorite("photo.rotate.left") + ".getAttribute('aria-disabled')"), "true");
        await click("photo.rotate.left"); assert.equal(calls.length, prior + 1);
        await evaluate("activeSliderInteractions.delete('Exposure');updateHistoryButtons()"); await enabled("photo.rotate.left");
        await customize(); await evaluate("document.getElementById('favoritesRestore').click()"); await close();
        assert.deepEqual(await order(), ["lightroom.undo", "lightroom.redo"]);
        return { expandedActions: 71, addedTabActions: 65, sections: 17, allTabsIncluded: true, noExclusions: true, sharedHandlersAndAvailability: true, selectionOrder: true };
    } finally { fixture.handle = originalHandle; }
}
module.exports = { verify };
