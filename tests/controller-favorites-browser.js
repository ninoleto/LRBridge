"use strict";
const assert = require("node:assert/strict");
const { normalize, storageKey } = require("../app/controller-favorites");
async function verify({ evaluate, waitFor, fixture, setViewport, selectTab, reload, capture, key }) {
    const c = fixture.clipboard, e = fixture.exports;
    const order = () => evaluate("Array.from(document.querySelectorAll('[data-favorite-action]'),b=>b.dataset.favoriteAction)");
    const favorite = id => "document.querySelector('[data-favorite-action=\"" + id + "\"]')";
    const enabled = id => waitFor(() => evaluate(favorite(id) + "?.getAttribute('aria-disabled')==='false'"), "favorite available: " + id);
    const click = id => evaluate(favorite(id) + ".click()");
    const customize = () => evaluate("document.getElementById('favoritesCustomize').click()");
    const close = () => evaluate("document.getElementById('favoritesClose').click()");
    const add = id => evaluate("document.getElementById('favoritesAddChoice').value=" + JSON.stringify(id) + ";document.getElementById('favoritesAdd').click()");
    const defaults = ["lightroom.undo", "lightroom.redo"];
    assert.deepEqual(normalize(null, defaults), defaults);
    assert.deepEqual(normalize(["invalid", "lightroom.undo", "lightroom.undo"], defaults), ["lightroom.undo"]);
    assert.deepEqual(normalize([], defaults), []);
    assert.deepEqual(await order(), defaults);
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 900); await selectTab("sliders");
        await evaluate("window.scrollTo(0,0)");
        await waitFor(() => evaluate("!!document.querySelector('.slider-jump-control')"), "jump navigation");
        const layout = await evaluate("(()=>{const b=document.getElementById('historyToolbar').getBoundingClientRect(),m=document.getElementById('content').getBoundingClientRect();return {height:b.height,gap:m.top-b.bottom,overflow:document.documentElement.scrollWidth>innerWidth,offset:parseFloat(getComputedStyle(document.querySelector('.slider-jump-control')).top),clipboard:!!document.querySelector('.clipboard-info,#clipboardSection'),buttons:Array.from(document.querySelectorAll('#historyToolbar button:not([hidden])'),n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width}))}})()");
        assert.equal(layout.height, 64); assert.equal(layout.offset, 64);
        assert.ok(layout.gap >= 0 && layout.gap <= 24, JSON.stringify(layout));
        assert.equal(layout.overflow, false); assert.equal(layout.clipboard, false);
        layout.buttons.forEach(b => assert.ok(b.height >= 44 && b.width >= 44));
        if (capture && [1280, 390].includes(width)) await capture("favorites-default-" + width);
        await selectTab("selection");
        await waitFor(() => evaluate("!!document.getElementById('clipboardSection')"), "clipboard section");
        assert.equal(await evaluate("document.querySelector('.clipboard-details').open"), false);
        assert.equal(await evaluate("document.getElementById('clipboardStatus').getBoundingClientRect().height"), 0, "no reserved empty feedback");
        assert.match(await evaluate("document.getElementById('clipboardCopyHelp').textContent"), /categories last selected/);
        if (capture && [1280, 390].includes(width)) { await evaluate("document.getElementById('clipboardSection').scrollIntoView({block:'end'})"); await capture("selection-copy-paste-" + width); }
    }
    await selectTab("sliders"); await setViewport(390, 900);
    await evaluate("window.scrollTo(0,700);document.getElementById('favoritesCustomize').focus({preventScroll:true})");
    let scroll = await evaluate("window.scrollY");
    await customize();
    for (const id of ["clipboard.copy", "clipboard.paste", "export.dialog", "export.previous"]) await add(id);
    if (capture) await capture("favorites-customize-phone");
    for (const width of [320, 1280]) {
        await setViewport(width, 900);
        const modal = await evaluate("(()=>{const d=document.getElementById('favoritesDialog'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:d.scrollWidth>d.clientWidth,targets:Array.from(d.querySelectorAll('button'),b=>b.getBoundingClientRect().height)}})()");
        assert.ok(modal.left >= 0 && modal.right <= width && modal.top >= 0 && modal.bottom <= 900);
        assert.equal(modal.overflow, false); modal.targets.forEach(h => assert.ok(h >= 44));
        if (capture && width === 1280) await capture("favorites-customize-desktop");
    }
    await setViewport(390, 900);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    scroll = await evaluate("window.scrollY"); // Reflow during deliberate viewport changes may adjust browser anchoring.
    await key("Escape");
    await waitFor(() => evaluate("!document.getElementById('favoritesDialog').open"), "Escape closes customization");
    assert.equal(await evaluate("document.activeElement.id"), "favoritesCustomize");
    await customize();
    await evaluate("document.querySelector('[aria-label=\"Move up: Paste Settings\"]').click()");
    await evaluate("document.querySelector('[aria-label=\"Remove Redo\"]').click()");
    const saved = ["lightroom.undo", "clipboard.paste", "clipboard.copy", "export.dialog", "export.previous"];
    assert.deepEqual(await order(), saved);
    await close();
    assert.equal(await evaluate("document.activeElement.id"), "favoritesCustomize");
    assert.equal(await evaluate("window.scrollY"), scroll, "customization does not scroll the underlying controls");
    assert.deepEqual(JSON.parse(await evaluate("localStorage.getItem(" + JSON.stringify(storageKey) + ")")), saved);
    await reload(); assert.deepEqual(await order(), saved, "browser reload restores arrangement");
    for (const tab of ["sliders", "tone-curve", "color-grading", "presets", "selection", "tools", "application"]) {
        await selectTab(tab); assert.deepEqual(await order(), saved);
        assert.equal(await evaluate("!!document.getElementById('clipboardSection')"), tab === "selection");
    }
    await selectTab("sliders"); await enabled("clipboard.copy"); await enabled("export.dialog");
    c.copySupported = false; c.revision++;
    await waitFor(() => evaluate(favorite("clipboard.copy") + ".getAttribute('aria-disabled')==='true'"), "native capability blocks favorite");
    await click("clipboard.copy"); assert.equal(c.calls.length, 0);
    c.copySupported = true; c.revision++; await enabled("clipboard.copy");
    await evaluate("window.scrollTo(0,700);" + favorite("clipboard.copy") + ".focus({preventScroll:true})");
    const beforeAction = await evaluate("[window.scrollY,document.scrollingElement.scrollHeight]");
    c.hold = true; await click("clipboard.copy"); await click("clipboard.copy");
    await waitFor(() => c.calls.length === 1, "one original Copy request");
    assert.equal(await evaluate("document.activeElement.dataset.favoriteAction"), "clipboard.copy");
    assert.equal(await evaluate(favorite("clipboard.paste") + ".getAttribute('aria-disabled')"), "true");
    c.finish(); await enabled("clipboard.copy");
    assert.deepEqual(await evaluate("[window.scrollY,document.scrollingElement.scrollHeight]"), beforeAction, "favorite feedback adds no page height or scroll movement");
    assert.equal(await evaluate("document.getElementById('historyToolbar').getBoundingClientRect().height"), 64);
    if (capture) await capture("favorites-active-phone");
    const horizontal = await evaluate("document.getElementById('favoriteActions').scrollLeft=12;document.getElementById('favoriteActions').scrollLeft");
    const reads = c.reads; await waitFor(() => c.reads > reads + 1, "idle favorite feedback polls");
    assert.equal(await evaluate("document.getElementById('favoriteActions').scrollLeft"), horizontal, "polling does not reset manual bar scrolling");
    // A favorite and its Selection control share the same in-flight guard.
    await click("clipboard.paste"); await waitFor(() => c.calls.length === 2, "favorite Paste admission");
    await selectTab("selection"); await evaluate("document.getElementById('pasteSettingsButton').click()");
    assert.equal(c.calls.length, 2);
    await selectTab("application"); c.finish("uncertain");
    await waitFor(() => evaluate("document.getElementById('favoritesNotice').textContent.includes('Review')"), "review visible outside Selection");
    await customize(); await evaluate("document.querySelector('[aria-label=\"Remove Paste Settings\"]').click()"); await close();
    assert.equal(await evaluate("document.getElementById('favoritesNotice').hidden"), false, "removing favorite cannot hide required review");
    await evaluate("document.getElementById('favoritesNotice').click()");
    assert.equal(await evaluate("document.querySelector('.tab-button.active').dataset.tab"), "selection");
    assert.equal(await evaluate("document.querySelector('.clipboard-details').open"), true);
    assert.equal(await evaluate("document.activeElement.id"), "clipboardReview");
    await evaluate("document.getElementById('clipboardReview').click()"); await enabled("clipboard.copy");
    await selectTab("sliders"); await enabled("export.dialog"); e.hold = true;
    await click("export.dialog"); await click("export.previous"); await waitFor(() => e.calls.length === 1, "favorite Export single dispatch");
    e.finish(); await enabled("export.previous");
    await click("export.previous"); await waitFor(() => e.calls.length === 2, "favorite Previous original dispatch");
    e.finish("uncertain"); await waitFor(() => evaluate("document.getElementById('favoritesNotice').getAttribute('aria-label').startsWith('Review export')"), "Export review accessible");
    await click("export.previous"); assert.equal(e.calls.length, 2, "uncertainty cannot retry");
    await evaluate("document.getElementById('favoritesNotice').click();document.querySelector('.export-review').click()");
    await enabled("export.dialog");
    fixture.nativeEdit(12); await enabled("lightroom.undo");
    const historyCount = fixture.history.commands.length;
    await click("lightroom.undo"); await click("lightroom.undo");
    await waitFor(() => fixture.history.commands.length === historyCount + 1, "favorite delegates to guarded history command");
    await customize(); await evaluate("document.getElementById('favoritesRestore').click()"); await close();
    assert.deepEqual(await order(), defaults); await reload(); assert.deepEqual(await order(), defaults);
    await enabled("lightroom.redo");
    const beforeRedo = fixture.history.commands.length;
    await click("lightroom.redo"); await click("lightroom.redo");
    await waitFor(() => fixture.history.commands.length === beforeRedo + 1, "default Redo uses the original single-dispatch guard");
    assert.equal(fixture.history.commands.at(-1), "lightroom.redo");
    await selectTab("application");
    const n = e.reads; await new Promise(resolve => setTimeout(resolve, 1200));
    assert.ok(e.reads <= n + 1, "removing Export favorites stops inactive polling");
    // Storage restrictions are handled without losing the current in-memory layout.
    await evaluate("window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('blocked')}");
    await customize(); await add("clipboard.copy");
    assert.match(await evaluate("document.getElementById('favoritesPreferenceStatus').textContent"), /storage unavailable/);
    await evaluate("Storage.prototype.setItem=window.originalStorageSet;document.getElementById('favoritesRestore').click()"); await close();
    const expanded = await require("./controller-favorites-expanded-browser").verify({ evaluate, waitFor, fixture, setViewport, selectTab, reload, capture });
    const feedback = await require("./controller-favorites-feedback-browser").verify({ evaluate, waitFor, fixture, setViewport, selectTab, reload, capture });
    return { ...expanded, ...feedback, favorites: true, defaultBarHeight: 64, widths: [1280, 768, 390, 320], noGlobalGap: true, customizationPersistence: true,
        originalActionsAndAvailability: true, accessibleReview: true, stableFocusAndScroll: true };
}
module.exports = { verify };
