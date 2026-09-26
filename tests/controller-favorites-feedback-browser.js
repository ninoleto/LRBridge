"use strict";
const assert = require("node:assert/strict");
async function verifyExportFeedback() {
    const context = { activeModule: "develop", selectedPhotoUuid: "fixture", contextCounter: 1, developCounter: 1, contextChangedAt: 1 };
    let fail = false, ready;
    const firstRead = new Promise(resolve => { ready = resolve; });
    const controller = require("../app/controller-export").createController({ document: {}, getContext: () => context,
        onPresentationChange: () => ready(), fetch: async () => {
            if (fail) throw Error("Isolated read failure");
            return { ok: true, json: async () => ({ ok: true, ...context, serverEpoch: "fixture", revision: 1, capturedAt: Date.now(),
                lastResult: { operationId: "fixture-export", command: "export.dialog", outcome: "requested", detail: "Export dialog requested." } }) };
        } });
    try {
        controller.setFavoritesActive(true); await firstRead;
        assert.equal(controller.getFeedback().kind, "sent");
        context.contextCounter++; controller.updateContext();
        assert.equal(controller.getFeedback().kind, "idle", "ordinary context invalidation is not a read error");
        fail = true; await controller.refresh(); assert.equal(controller.getFeedback().kind, "error");
        fail = false; await controller.refresh(); assert.equal(controller.getFeedback().kind, "sent", "fresh read resolves presentation error");
    } finally { controller.setFavoritesActive(false); }
}
async function verify({ evaluate, waitFor, fixture, setViewport, selectTab, reload, capture }) {
    await verifyExportFeedback();
    const previous = fixture.handle, calls = [];
    let fail = false;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/command" && ["application.action", "selection.navigate"].includes(url.searchParams.get("command"))) {
            calls.push(Object.fromEntries(url.searchParams));
            reply({ ok: !fail, message: fail ? "Isolated test rejection" : "Command accepted" }, fail ? 503 : 200); return true;
        }
        return previous(url, reply);
    };
    const copyLabel = "Quick Copy Settings", copyHelp = "Choose the settings categories in Lightroom’s Copy Settings dialog. Use Quick Copy Settings to copy the active photo’s current settings, select destination photos, then Paste Settings. Copying directly in Lightroom also works; Quick Copy is not required.";
    const favorite = id => "document.querySelector('[data-favorite-action=\"" + id + "\"]')";
    const enabled = id => waitFor(() => evaluate(favorite(id) + "?.getAttribute('aria-disabled')==='false'"), "feedback favorite available: " + id);
    const click = id => evaluate(favorite(id) + ".click()");
    const open = () => evaluate("document.getElementById('favoritesCustomize').click()");
    const close = () => evaluate("document.getElementById('favoritesClose').click()");
    const add = id => evaluate("document.getElementById('favoritesAddChoice').value=" + JSON.stringify(id) + ";document.getElementById('favoritesAdd').click()");
    const message = () => evaluate("document.getElementById('favoritesMessage').textContent");
    const geometry = () => evaluate("(()=>({page:window.scrollY,height:document.scrollingElement.scrollHeight,bar:document.getElementById('historyToolbar').getBoundingClientRect().toJSON(),favorites:document.getElementById('favoriteActions').getBoundingClientRect().toJSON(),customize:document.getElementById('favoritesCustomize').getBoundingClientRect().toJSON(),horizontal:document.getElementById('favoriteActions').scrollLeft,focus:document.activeElement.dataset.favoriteAction}))()");
    try {
        await open();
        assert.equal(await evaluate("document.querySelector('#favoritesAddChoice option[value=\"clipboard.copy\"]').textContent"), copyLabel);
        await evaluate("document.getElementById('favoritesAddChoice').value='clipboard.copy';document.getElementById('favoritesAddChoice').dispatchEvent(new Event('change'))");
        assert.ok((await evaluate("document.getElementById('favoritesActionHelp').textContent")).endsWith(copyHelp));
        for (const id of ["clipboard.copy", "application.action.zoom_in", "selection.navigate.next"]) await add(id);
        await close();
        const saved = await evaluate("localStorage.getItem('lrbridge.controller.favorites.v1')");
        await reload(); assert.equal(await evaluate("localStorage.getItem('lrbridge.controller.favorites.v1')"), saved);
        assert.equal(await evaluate(favorite("clipboard.copy") + ".textContent"), copyLabel);
        assert.equal(await evaluate(favorite("clipboard.copy") + ".title"), copyHelp);
        assert.equal(await evaluate("!!document.querySelector('#historyToolbar #favoritesNotice')"), false, "no feedback action inside favorites bar");
        for (const width of [1280, 390, 320]) {
            await setViewport(width, 900); await selectTab("selection"); await enabled("clipboard.copy");
            assert.equal(await evaluate("document.getElementById('copySettingsButton').textContent"), copyLabel);
            assert.equal(await evaluate("document.getElementById('copySettingsButton').title"), copyHelp);
            assert.equal(await evaluate("document.getElementById('clipboardCopyHelp').textContent"), copyHelp);
            assert.equal(await evaluate("document.getElementById('copySettingsButton').scrollWidth<=document.getElementById('copySettingsButton').clientWidth"), true, "longer copy label fits");
            await evaluate("document.getElementById('clipboardSection').scrollIntoView({block:'end'})");
            if (capture && width !== 320) await capture("copy-last-used-" + width);
        }
        for (const width of [1280, 390]) {
            await setViewport(width, 900); await selectTab("sliders"); await enabled("application.action.zoom_in");
            await evaluate("window.scrollTo(0,650);" + favorite("application.action.zoom_in") + ".focus({preventScroll:true});document.getElementById('favoriteActions').scrollLeft=10000");
            const before = await geometry(), count = calls.length;
            await click("application.action.zoom_in"); await waitFor(() => calls.length === count + 1, "one Zoom command");
            await waitFor(async () => await message() === "Zoom In — command sent.", "action-specific sent notice");
            assert.deepEqual(await geometry(), before, "sent notice cannot move controls, focus or scroll");
            assert.equal(await evaluate("document.querySelector('#favoritesFeedback button:not([hidden])')===null"), true, "routine status is plain text");
            assert.equal(await evaluate("document.getElementById('favoritesFeedback').getBoundingClientRect().left>=0 && document.getElementById('favoritesFeedback').getBoundingClientRect().right<=innerWidth"), true);
            if (capture) await capture("favorite-sent-" + width);
            await waitFor(() => evaluate("document.getElementById('favoritesFeedback').hidden"), "four-second acknowledgement expiry", 6500);
            assert.deepEqual(await geometry(), before, "expiry leaves no blank space or movement");
            const reads = fixture.clipboard.reads; await waitFor(() => fixture.clipboard.reads > reads + 1, "polls after expiry");
            assert.equal(await evaluate("document.getElementById('favoritesFeedback').hidden"), true, "polling cannot resurrect expired acknowledgement");
            if (capture) await capture("favorite-expired-" + width);
        }
        fail = true; await enabled("application.action.zoom_in"); await click("application.action.zoom_in");
        await waitFor(async () => await message() === "Zoom In — request unconfirmed.", "persistent command failure");
        const failedCalls = calls.length;
        await new Promise(resolve => setTimeout(resolve, 4300));
        assert.equal(await evaluate("document.getElementById('favoritesFeedback').hidden"), false);
        assert.equal(calls.length, failedCalls, "failure never retries automatically");
        fail = false; await enabled("selection.navigate.next"); await click("selection.navigate.next"); await enabled("selection.navigate.next");
        assert.equal(await message(), "Zoom In — request unconfirmed.", "another success cannot hide an unresolved error");
        await open(); await evaluate("document.querySelector('[aria-label=\"Remove Zoom In\"]').click()"); await close();
        await selectTab("application"); assert.equal(await message(), "Zoom In — request unconfirmed.");
        await evaluate("document.getElementById('favoritesNotice').click()");
        assert.match(await evaluate("document.getElementById('status').textContent"), /Zoom In request unconfirmed/);
        assert.equal(await evaluate("document.activeElement.id"), "status");
        assert.equal(await evaluate("document.getElementById('favoritesFeedback').hidden"), true, "notice cannot cover focused details");
        if (capture) await capture("favorite-error-phone");
        await evaluate("document.getElementById('favoritesCustomize').focus({preventScroll:true})");
        assert.equal(await evaluate("document.getElementById('favoritesFeedback').hidden"), false, "unresolved error remains accessible after detail focus");
        await evaluate("document.getElementById('favoritesDismiss').focus({preventScroll:true});document.getElementById('favoritesDismiss').click()");
        assert.equal(await evaluate("document.activeElement.id"), "favoritesCustomize");
        await waitFor(() => evaluate("document.getElementById('favoritesFeedback').hidden"), "explicit error dismissal and remaining acknowledgement expiry", 6500);
        const c = fixture.clipboard, count = c.calls.length; c.hold = true;
        await enabled("clipboard.copy"); await click("clipboard.copy"); await waitFor(() => c.calls.length === count + 1, "unchanged native copy route in fixture");
        assert.match(await message(), /^Quick Copy Settings — waiting/);
        c.finish("uncertain");
        await waitFor(async () => await message() === copyLabel + " — review required.", "required review named correctly");
        assert.equal(await evaluate("document.getElementById('favoritesDismiss').hidden"), true, "required review cannot be dismissed from notice");
        await new Promise(resolve => setTimeout(resolve, 4300));
        assert.equal(await evaluate("document.getElementById('favoritesFeedback').hidden"), false, "review does not expire");
        await click("clipboard.copy"); assert.equal(c.calls.length, count + 1);
        await evaluate("document.getElementById('favoritesNotice').click()");
        assert.equal(await evaluate("document.activeElement.id"), "clipboardReview");
        assert.equal(await evaluate("document.querySelector('.clipboard-details').open"), true);
        assert.equal(await evaluate("document.getElementById('favoritesFeedback').hidden"), true, "notice cannot cover required acknowledgement");
        await evaluate("document.getElementById('clipboardReview').click()"); await enabled("clipboard.copy");
        await waitFor(() => evaluate("document.getElementById('favoritesFeedback').hidden"), "review resolved only through original acknowledgement");
        await open(); await evaluate("document.getElementById('favoritesRestore').click()"); await close();
        return { copyLastUsedPresentation: true, transientActionFeedback: true, stableExpiryGeometry: true, persistentErrorsAndReview: true };
    } finally { fixture.handle = previous; }
}
module.exports = { verify };
