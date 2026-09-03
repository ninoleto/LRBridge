const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const collapse = require(path.join(root, "app", "controller-section-collapse.js"));
const controller = fs.readFileSync(path.join(root, "app", "controller.html"), "utf8");
const colorGrading = fs.readFileSync(path.join(root, "app", "controller-color-grading.js"), "utf8");
const main = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");

const allowedDevelopSections = Object.freeze({
    "white-balance": "White Balance",
    tone: "Tone",
    "hdr-sdr-rendition": "HDR / SDR Rendition",
    presence: "Presence",
    "color-mixer": "Color Mixer",
    detail: "Detail",
    "lens-corrections": "Lens Corrections",
    transform: "Transform",
    "lens-blur": "Lens Blur",
    effects: "Effects",
    calibration: "Calibration"
});
const allowedCollapseDefinitions = Object.fromEntries(Object.entries(allowedDevelopSections).map(function (entry) {
    return ["develop." + entry[0], entry[1]];
}));
const expectedJumpEntries = [
    { id: "white-balance", label: "White Balance" },
    { id: "tone", label: "Tone" },
    { id: "hdr-sdr-rendition", label: "HDR / SDR Rendition" },
    { id: "presence", label: "Presence" },
    { tab: "tone-curve", label: "Tone Curve" },
    { id: "color-mixer", label: "Color Mixer" },
    { tab: "color-grading", label: "Color Grading" },
    { id: "detail", label: "Detail" },
    { id: "lens-corrections", label: "Lens Corrections" },
    { id: "transform", label: "Transform" },
    { id: "lens-blur", label: "Lens Blur" },
    { id: "effects", label: "Effects" },
    { id: "calibration", label: "Calibration" },
    { tab: "presets", label: "Presets", presetTab: true }
];
const allowedToolsCollapseDefinitions = Object.freeze({
    "tools.crop-straighten": "Crop & Straighten",
    "tools.healing": "Healing",
    "tools.red-eye": "Red Eye",
    "tools.masking": "Masking"
});
const expectedToolsJumpEntries = [
    { id: "crop-straighten", label: "Crop & Straighten", toolsSection: true },
    { id: "healing", label: "Healing", toolsSection: true },
    { id: "red-eye", label: "Red Eye", toolsSection: true },
    { id: "masking", label: "Masking", toolsSection: true }
];

class FakeClassList {
    constructor(element) { this.element = element; this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); this.sync(); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); this.sync(); }
    toggle(name, force) {
        const enabled = force === undefined ? !this.values.has(name) : !!force;
        if (enabled) this.values.add(name); else this.values.delete(name);
        this.sync();
        return enabled;
    }
    contains(name) { return this.values.has(name); }
    replaceFrom(text) {
        this.values = new Set(String(text || "").split(/\s+/).filter(Boolean));
        this.sync();
    }
    sync() { this.element._className = Array.from(this.values).join(" "); }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.parentNode = null;
        this.children = [];
        this.dataset = {};
        this.attributes = Object.create(null);
        this.classList = new FakeClassList(this);
        this.hidden = false;
        this.id = "";
        this.type = "";
        this.isConnected = true;
        this.listeners = Object.create(null);
        this._textContent = "";
        this._className = "";
    }
    get className() { return this._className; }
    set className(value) { this.classList.replaceFrom(value); }
    get textContent() { return this._textContent; }
    set textContent(value) {
        this._textContent = String(value);
        this.children.forEach((child) => { child.parentNode = null; });
        this.children = [];
    }
    get nextSibling() {
        if (!this.parentNode) return null;
        const index = this.parentNode.children.indexOf(this);
        return index >= 0 ? this.parentNode.children[index + 1] || null : null;
    }
    appendChild(child) {
        if (child.parentNode) {
            const oldIndex = child.parentNode.children.indexOf(child);
            if (oldIndex >= 0) child.parentNode.children.splice(oldIndex, 1);
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    insertBefore(child, reference) {
        if (child.parentNode) {
            const oldIndex = child.parentNode.children.indexOf(child);
            if (oldIndex >= 0) child.parentNode.children.splice(oldIndex, 1);
        }
        child.parentNode = this;
        const index = reference ? this.children.indexOf(reference) : -1;
        if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
        return child;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { if (this.listeners.click) this.listeners.click({ currentTarget: this }); }
}

class FakeDocument {
    createElement(tagName) { return new FakeElement(tagName); }
    createElementNS(_namespace, tagName) { return new FakeElement(tagName); }
}

function makeSection(documentObject) {
    const parent = documentObject.createElement("section");
    const heading = documentObject.createElement("div");
    heading.className = "group-title";
    heading.textContent = "TONE";
    const first = documentObject.createElement("div");
    first.textContent = "Exposure";
    const second = documentObject.createElement("div");
    second.textContent = "Contrast";
    parent.appendChild(heading);
    parent.appendChild(first);
    parent.appendChild(second);
    return { parent, heading, first, second };
}

const definitions = collapse.normalizeDefinitions(Object.assign({}, allowedCollapseDefinitions, {
    "Bad ID": "Rejected",
    "develop.empty": "   "
}));
assert.deepEqual(definitions, allowedCollapseDefinitions);
assert.deepEqual(Array.from(collapse.parseStoredState(null, definitions)), []);
assert.deepEqual(Array.from(collapse.parseStoredState("not json", definitions)), []);
assert.deepEqual(Array.from(collapse.parseStoredState(JSON.stringify({ version: 0, collapsed: ["develop.tone"] }), definitions)), []);
assert.deepEqual(Array.from(collapse.parseStoredState(JSON.stringify({
    version: collapse.STORAGE_VERSION,
    collapsed: ["unknown", "tone-curve", "color-grading.shadow", "develop.tone", 7]
}), definitions)), ["develop.tone"]);
assert.equal(collapse.serializeStoredState(new Set(["unknown", "develop.tone"]), definitions),
    JSON.stringify({ version: 1, collapsed: ["develop.tone"] }));
assert.equal(collapse.STORAGE_KEY, "lrbridge.controller.collapsedSections.v1");

const stored = new Map();
const storage = {
    getItem(key) { return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { stored.set(key, value); }
};
const documentObject = new FakeDocument();
const section = makeSection(documentObject);
let callbackSawVisibleBody = false;
const manager = collapse.createManager({
    document: documentObject,
    storage,
    definitions,
    onBeforeCollapse(_id, _name, entry) { callbackSawVisibleBody = entry.body.hidden === false; }
});
const entry = manager.decorateWhole(section.parent, section.heading, "develop.tone");
assert.ok(entry);
assert.equal(entry.button.tagName, "BUTTON");
assert.equal(entry.button.type, "button");
assert.equal(entry.button.getAttribute("aria-expanded"), "true");
assert.equal(entry.button.getAttribute("aria-controls"), entry.body.id);
assert.equal(entry.button.getAttribute("aria-label"), "Collapse Tone");
assert.equal(entry.button.children[0].tagName, "SVG");
assert.equal(entry.button.children[0].getAttribute("aria-hidden"), "true");
assert.deepEqual(entry.body.children, [section.first, section.second]);
assert.equal(entry.body.hidden, false, "sections default expanded");

entry.button.click();
assert.equal(callbackSawVisibleBody, true, "gesture cancellation callback runs before the body is hidden");
assert.equal(entry.body.hidden, true);
assert.equal(entry.button.getAttribute("aria-expanded"), "false");
assert.equal(entry.button.getAttribute("aria-label"), "Expand Tone");
assert.deepEqual(JSON.parse(stored.get(collapse.STORAGE_KEY)), { version: 1, collapsed: ["develop.tone"] });

const restoredSection = makeSection(documentObject);
const restoredManager = collapse.createManager({ document: documentObject, storage, definitions });
const restoredEntry = restoredManager.decorateWhole(restoredSection.parent, restoredSection.heading, "develop.tone");
assert.equal(restoredEntry.body.hidden, true, "persisted collapse state restores on a new render");
restoredEntry.button.click();
assert.equal(restoredEntry.body.hidden, false);
assert.deepEqual(JSON.parse(stored.get(collapse.STORAGE_KEY)), { version: 1, collapsed: [] });

const throwingStorage = { getItem() { throw new Error("disabled"); }, setItem() { throw new Error("disabled"); } };
const safeSection = makeSection(documentObject);
const safeManager = collapse.createManager({ document: documentObject, storage: throwingStorage, definitions });
const safeEntry = safeManager.decorateWhole(safeSection.parent, safeSection.heading, "develop.tone");
assert.equal(safeEntry.body.hidden, false);
assert.doesNotThrow(() => safeEntry.button.click());

const forbiddenSection = makeSection(documentObject);
const originalForbiddenChildren = forbiddenSection.parent.children.slice();
assert.equal(manager.decorateWhole(forbiddenSection.parent, forbiddenSection.heading, "tone-curve"), null,
    "dedicated tabs must not be admitted by the Develop-only collapse manager");
assert.deepEqual(forbiddenSection.parent.children, originalForbiddenChildren,
    "rejected collapse identities must not alter fixed-layout DOM");

assert.match(controller, /<script src="\/controller-section-collapse\.js"><\/script>/);
assert.match(main, /controller-section-collapse\.js/);
assert.match(controller, /\.collapsible-section-toggle\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
assert.match(controller, /\.collapsible-section-toggle:focus-visible\s*\{[\s\S]*?outline:\s*3px solid/);
assert.match(controller, /\.collapsible-section-toggle\[aria-expanded="false"\] svg\s*\{\s*transform:\s*rotate\(0deg\)/);
assert.doesNotMatch(controller.match(/\.collapsible-section-heading[\s\S]*?@media \(prefers-reduced-motion: reduce\)/)[0], /eye/i);

function evaluateConstRange(startToken, endToken, exportsSource) {
    const start = controller.indexOf(startToken);
    const end = controller.indexOf(endToken, start);
    assert.notEqual(start, -1, "Missing " + startToken);
    assert.notEqual(end, -1, "Missing " + endToken);
    const context = {};
    vm.runInNewContext(controller.slice(start, end) + "\n" + exportsSource, context);
    return context.result;
}

const productionCollapseDefinitions = JSON.parse(JSON.stringify(evaluateConstRange(
    "const sectionCollapseDefinitions", "const sectionCollapseManager",
    "this.result = sectionCollapseDefinitions;"
)));
assert.deepEqual(productionCollapseDefinitions, allowedCollapseDefinitions,
    "persisted identities must be limited to the exact Jump-to Develop sections");
const productionToolsCollapseDefinitions = JSON.parse(JSON.stringify(evaluateConstRange(
    "const toolsSectionCollapseDefinitions", "const toolsSectionCollapseManager",
    "this.result = toolsSectionCollapseDefinitions;"
)));
assert.deepEqual(productionToolsCollapseDefinitions, allowedToolsCollapseDefinitions,
    "Tools persisted identities must be limited to its four actual top-level sections");
assert.match(controller, /storageKey: "lrbridge\.controller\.collapsedToolsSections\.v1"/);

const sectionRegistry = JSON.parse(JSON.stringify(evaluateConstRange(
    "const developSectionDisplayOrder", "const colorMixerDefinitions",
    "this.result = { order: developSectionDisplayOrder, collapseIds: developSectionCollapseIds };"
)));
assert.deepEqual(sectionRegistry.order.map((sectionDefinition) => sectionDefinition.id), Object.keys(allowedDevelopSections),
    "the expected collapse allowlist must match every Jump-to section in order");
assert.deepEqual(sectionRegistry.collapseIds, Object.fromEntries(Object.keys(allowedDevelopSections).map(function (id) {
    return [id, "develop." + id];
})), "every Jump-to section must have exactly one collapse identity");

const jumpModelStart = controller.indexOf("function getSliderJumpSections(");
const jumpModelEnd = controller.indexOf("function findSliderJumpHeading(", jumpModelStart);
assert.notEqual(jumpModelStart, -1);
assert.notEqual(jumpModelEnd, -1);
const jumpModelContext = { developSectionDisplayOrder: sectionRegistry.order };
vm.runInNewContext(controller.slice(jumpModelStart, jumpModelEnd) +
    "\nthis.getSliderJumpSections = getSliderJumpSections;" +
    "\nthis.getToolsJumpSections = getToolsJumpSections;", jumpModelContext);
assert.deepEqual(JSON.parse(JSON.stringify(jumpModelContext.getSliderJumpSections())), expectedJumpEntries,
    "Jump-to entries must retain the exact requested Lightroom-style order");
assert.equal(expectedJumpEntries.length, 14, "the shared Jump-to model must contain exactly fourteen entries");
assert.equal(expectedJumpEntries[13].label, "Presets", "Presets must be the final shared Jump-to entry");
assert.doesNotMatch(controller.slice(jumpModelStart, jumpModelEnd), /developPresetController|draft|uuid|alias|Preset Controls|Manage Presets/,
    "the shared Jump-to model must never reflect the configured preset draft or manager");
assert.deepEqual(JSON.parse(JSON.stringify(jumpModelContext.getToolsJumpSections())), expectedToolsJumpEntries,
    "Tools Jump-to entries must contain only actual Tools sections in page order");

const menuTabsStart = controller.indexOf("function isSliderJumpMenuTab(");
const menuTabsEnd = controller.indexOf("function getSliderJumpMenuHost(", menuTabsStart);
assert.notEqual(menuTabsStart, -1);
assert.notEqual(menuTabsEnd, -1);
const menuTabsContext = {
    getSliderJumpSections: jumpModelContext.getSliderJumpSections,
    getToolsJumpSections: jumpModelContext.getToolsJumpSections
};
vm.runInNewContext(controller.slice(menuTabsStart, menuTabsEnd) +
    "\nthis.isSliderJumpMenuTab = isSliderJumpMenuTab;" +
    "\nthis.getSliderJumpMenuSections = getSliderJumpMenuSections;", menuTabsContext);
["sliders", "tone-curve", "color-grading"].forEach(function (tab) {
    assert.equal(menuTabsContext.isSliderJumpMenuTab(tab), true, tab + " must render Jump-to");
    assert.deepEqual(JSON.parse(JSON.stringify(menuTabsContext.getSliderJumpMenuSections(tab))), expectedJumpEntries,
        tab + " must render the same complete Jump-to menu");
});
assert.equal(menuTabsContext.isSliderJumpMenuTab("tools"), true);
assert.deepEqual(JSON.parse(JSON.stringify(menuTabsContext.getSliderJumpMenuSections("tools"))), expectedToolsJumpEntries);
assert.equal(menuTabsContext.isSliderJumpMenuTab("presets"), true, "Presets must render Jump-to");
assert.deepEqual(JSON.parse(JSON.stringify(menuTabsContext.getSliderJumpMenuSections("presets"))), expectedJumpEntries,
    "Presets must use the exact shared 14-entry Jump-to menu");
["selection", "application", "crop", "retouching"].forEach(function (tab) {
    assert.equal(menuTabsContext.isSliderJumpMenuTab(tab), false, tab + " must not render Jump-to");
    assert.deepEqual(JSON.parse(JSON.stringify(menuTabsContext.getSliderJumpMenuSections(tab))), [],
        tab + " must not receive Jump-to entries");
});
assert.match(controller,
    /function getSliderJumpMenuHost\(\)[\s\S]*activeTab === "color-grading"[\s\S]*getElementById\("colorGradingWorkspace"\)[\s\S]*getElementById\("content"\)/,
    "the Develop-related and Tools tabs must mount Jump-to in their existing workspace without moving tab content");
const renderBlock = controller.slice(controller.indexOf("function render()"), controller.indexOf("async function loadDevelopSliderDefinitions"));
assert.match(renderBlock, /colorGradingController\.activate\(\);\s*installSliderJumpMenu\(\);/);
assert.match(renderBlock, /renderSlidersTab\(\);\s*activateDevelopFeedbackPolling\(\);\s*installSliderJumpMenu\(\);/);
assert.match(renderBlock, /renderToneCurveTab\(\);\s*activateDevelopFeedbackPolling\(\);\s*installSliderJumpMenu\(\);/);
assert.match(renderBlock, /renderPresetsTab\(\);\s*installSliderJumpMenu\(\);/);
assert.equal((renderBlock.match(/installSliderJumpMenu\(\)/g) || []).length, 5,
    "only the three Develop-related tabs, Presets, and Tools may install Jump-to");
assert.equal((renderBlock.match(/removeSliderJumpMenus\(\)/g) || []).length, 2,
    "Selection and Application must explicitly remove Jump-to");
assert.match(controller, /slider-jump-option" \+ \(section\.presetTab \? " preset-tab-entry" : ""\)/,
    "Only the final Presets navigation entry receives the alternate accent class");
assert.match(controller, /if \(section\.tab\) \{[\s\S]*selectControllerTab\(section\.tab, true\)/,
    "Presets navigation must use the existing authoritative tab-selection path");
assert.doesNotMatch(controller.slice(controller.indexOf("function activateSliderJumpEntry"), controller.indexOf("sections.forEach", controller.indexOf("function activateSliderJumpEntry"))),
    /submitPreset|applyDevelopPreset|develop_preset\.apply|developPresetController|Manage Presets/,
    "Presets Jump-to navigation must not invoke preset or manager actions");

const expectedDesktopRows = [
    ["White Balance", "Detail"],
    ["Tone", "Lens Corrections"],
    ["HDR / SDR Rendition", "Transform"],
    ["Presence", "Lens Blur"],
    ["Tone Curve", "Effects"],
    ["Color Mixer", "Calibration"],
    ["Color Grading", "Presets"]
];
assert.deepEqual(Array.from({ length: 7 }, function (_unused, index) {
    return [expectedJumpEntries[index].label, expectedJumpEntries[index + 7] ? expectedJumpEntries[index + 7].label : null];
}), expectedDesktopRows, "the canonical menu order must fill the exact desktop columns");
const desktopPopoverCss = controller.slice(
    controller.indexOf(".slider-jump-popover {"),
    controller.indexOf(".slider-jump-popover[hidden]")
);
assert.match(desktopPopoverCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(desktopPopoverCss, /grid-template-rows:\s*repeat\(7, auto\)/);
assert.match(desktopPopoverCss, /grid-auto-flow:\s*column/,
    "desktop Jump-to must fill down the left column before the right column");
assert.match(desktopPopoverCss, /max-height:\s*var\(--slider-jump-available-height\)/,
    "available height, not an arbitrary cap, must bound the menu");
assert.match(desktopPopoverCss, /overflow-y:\s*auto/,
    "the scrollbar must appear only when the menu truly overflows");
assert.match(desktopPopoverCss, /overscroll-behavior:\s*contain/,
    "menu overflow must not scroll the underlying page");
assert.doesNotMatch(desktopPopoverCss, /(?:max-)?height:[^;]*(?:70vh|620px)/,
    "Jump-to must not impose the rejected arbitrary height caps");
assert.doesNotMatch(controller, /scrollbar-gutter/,
    "a non-overflowing menu must not reserve a scrollbar gutter");
const singleColumnBreakpoint = Number(controller.match(
    /@media \(max-width: (\d+)px\) \{\s*\.slider-jump-popover/
)[1]);
assert.equal(singleColumnBreakpoint, 520, "Jump-to must not switch to one column at the 720px toolbar breakpoint");
assert.ok(689 > singleColumnBreakpoint, "the demonstrated 689px width must retain two columns");
const toolbarResponsiveCss = controller.slice(
    controller.indexOf("@media (max-width: 720px)"),
    controller.indexOf("@media (max-width: 520px)")
);
assert.doesNotMatch(toolbarResponsiveCss, /slider-jump-popover/,
    "toolbar wrapping at 720px must not alter the menu columns");
const narrowJumpCss = controller.slice(
    controller.indexOf("@media (max-width: 520px)"),
    controller.indexOf("\n        .status", controller.indexOf("@media (max-width: 520px)"))
);
assert.match(narrowJumpCss, /\.slider-jump-popover[\s\S]*grid-template-columns:\s*1fr/);
assert.match(narrowJumpCss, /grid-template-rows:\s*none/);
assert.match(narrowJumpCss, /grid-auto-flow:\s*row/,
    "narrow Jump-to must follow the sequential 1-14 DOM order");
assert.match(narrowJumpCss, /scrollbar-color:\s*#ffc066 #241508/);
assert.match(narrowJumpCss, /::-webkit-scrollbar[\s\S]*width:\s*14px/);
assert.doesNotMatch(narrowJumpCss, /overflow-y:\s*scroll|scrollbar-gutter/,
    "narrow menus must not force a scrollbar or reserve its gutter");

const heightCalculationStart = controller.indexOf("function calculateSliderJumpAvailableHeight(");
const heightCalculationEnd = controller.indexOf("function removeSliderJumpMenus(", heightCalculationStart);
assert.notEqual(heightCalculationStart, -1);
assert.notEqual(heightCalculationEnd, -1);
const heightCalculationContext = {};
vm.runInNewContext(controller.slice(heightCalculationStart, heightCalculationEnd) +
    "\nthis.calculateSliderJumpAvailableHeight = calculateSliderJumpAvailableHeight;", heightCalculationContext);
const naturalSingleColumnHeight = (14 * 54) + (13 * 10) + 28 + 4;
const tallNarrowAvailableHeight = heightCalculationContext.calculateSliderJumpAvailableHeight(100, 1100, 0);
const shortNarrowAvailableHeight = heightCalculationContext.calculateSliderJumpAvailableHeight(210, 640, 0);
assert.ok(tallNarrowAvailableHeight >= naturalSingleColumnHeight,
    "a tall narrow viewport must fit all 14 natural-height entries without overflow");
assert.ok(shortNarrowAvailableHeight < naturalSingleColumnHeight,
    "a genuinely short narrow viewport must constrain the menu and overflow internally");
assert.equal(heightCalculationContext.calculateSliderJumpAvailableHeight(90, 700, 45), 643,
    "available height must include the current visual viewport offset and bottom margin");
assert.doesNotMatch(controller, /More items|slider-jump-more-indicator|moreIndicator|updateSliderJumpMoreIndicator/,
    "the rejected more-items indicator and all of its state logic must be absent");
const jumpInstallerBlock = controller.slice(
    controller.indexOf("function installSliderJumpMenu()"),
    controller.indexOf("function startSliderJumpMenuObserver")
);
assert.doesNotMatch(jumpInstallerBlock, /addEventListener\("scroll"/,
    "Jump-to must rely on native overflow rather than scroll-listener state");
assert.match(jumpInstallerBlock, /visualViewport[\s\S]*visualViewport\.height[\s\S]*visualViewport\.offsetTop/,
    "the menu must measure the current visual viewport");
assert.match(jumpInstallerBlock, /function openMenu\(\)[\s\S]*updateSliderJumpPopoverLayout\(\)/,
    "opening the menu must recalculate its available height");
assert.match(jumpInstallerBlock, /window\.addEventListener\("resize", sliderJumpViewportResizeHandler\)/);
assert.match(jumpInstallerBlock, /window\.visualViewport\.addEventListener\("resize", sliderJumpViewportResizeHandler\)/,
    "window and visual viewport resizes must recalculate available height");
assert.doesNotMatch(jumpInstallerBlock, /contentHost\.querySelector\("\.basic-controls-row"\)/,
    "Jump-to must not derive an insertion reference from a nested controller subtree");
assert.match(jumpInstallerBlock, /const insertionPoint = getSliderJumpInsertionPoint\(contentHost\)/,
    "Every Jump-to render must resolve its insertion point from the current host");
assert.match(controller,
    /function disconnectSliderJumpDocumentListeners\(\)[\s\S]*removeEventListener\("pointerdown", sliderJumpDocumentPointerDownHandler\)[\s\S]*removeEventListener\("keydown", sliderJumpDocumentKeydownHandler\)/,
    "Jump-to document listeners must be removable with their rendered menu");
assert.match(controller,
    /function removeSliderJumpMenus\(\) \{[\s\S]*disconnectSliderJumpDockObserver\(\);[\s\S]*disconnectSliderJumpDocumentListeners\(\);[\s\S]*querySelectorAll\("\.slider-jump-control, \.slider-jump-sentinel"\)/,
    "Jump-to cleanup must dispose observers/listeners and remove every stale menu artifact");
assert.match(controller,
    /let sliderJumpMenuObserver = null;[\s\S]*if \(sliderJumpMenuObserver\) return;[\s\S]*sliderJumpMenuObserver = new MutationObserver/,
    "the content observer must be installed at most once");

const insertionResolverStart = controller.indexOf("function getSliderJumpInsertionPoint(");
const insertionResolverEnd = controller.indexOf("function installSliderJumpMenu()", insertionResolverStart);
assert.notEqual(insertionResolverStart, -1, "missing Jump-to insertion resolver");
assert.notEqual(insertionResolverEnd, -1, "missing Jump-to insertion resolver boundary");
const insertionResolverContext = {};
vm.runInNewContext(controller.slice(insertionResolverStart, insertionResolverEnd) +
    "\nthis.getSliderJumpInsertionPoint = getSliderJumpInsertionPoint;", insertionResolverContext);
const directBasicControls = {
    classList: { contains(name) { return name === "basic-controls-row"; } },
    nextSibling: { id: "direct-sibling" }
};
const ordinaryChild = { classList: { contains() { return false; } } };
assert.equal(insertionResolverContext.getSliderJumpInsertionPoint({
    children: [directBasicControls, ordinaryChild], firstChild: directBasicControls
}), directBasicControls.nextSibling,
"a direct Basic controls row must retain the established Jump-to placement");
const presetRoot = { classList: { contains() { return false; } } };
assert.equal(insertionResolverContext.getSliderJumpInsertionPoint({
    children: [presetRoot], firstChild: presetRoot
}), presetRoot,
"a nested Presets treatment row must not supply a detached insertBefore reference");

const clearContentBlock = controller.slice(
    controller.indexOf("function clearContent()"),
    controller.indexOf("function renderTabs()")
);
assert.match(clearContentBlock, /removeSliderJumpMenus\(\);[\s\S]*disposeDevelopTreatmentPresentation\(\);[\s\S]*content\.innerHTML = ""/,
    "render-owned observers, listeners, and treatment UI must be disposed before the content host is cleared");
assert.match(renderBlock,
    /developPresetController\.deactivate\(\);\s*colorGradingController\.deactivate\(\);\s*pointCurveController\.deactivate\(\);\s*deactivateDevelopFeedbackPolling\(\);\s*clearContent\(\);/,
    "every tab render must dispose the previous controllers and polling before clearing their host");
const metadataInitializationBlock = controller.slice(
    controller.indexOf("loadDevelopSliderDefinitions().then("),
    controller.indexOf("const colorGradingController", controller.indexOf("loadDevelopSliderDefinitions().then("))
);
assert.match(metadataInitializationBlock,
    /then\(function \(\) \{\s*startLiveFeedbackPolling\(\);\s*render\(\);\s*\}, function \(\) \{/,
    "shared polling must start before rendering and render failures must not be mislabeled as metadata failures");
assert.doesNotMatch(metadataInitializationBlock, /\.catch\(/,
    "the slider-metadata error path must not catch unrelated tab-render failures");

const activationStart = controller.indexOf("function activateSliderJumpEntry(section)");
const activationEnd = controller.indexOf("\n\n            sections.forEach", activationStart);
assert.notEqual(activationStart, -1, "missing Jump-to activation helper");
assert.notEqual(activationEnd, -1, "missing Jump-to activation helper boundary");
const selectedTabs = [];
const scrolledTargets = [];
const activationContext = {
    activeTab: "sliders",
    selectControllerTab(tab, updateHistory) {
        selectedTabs.push([tab, updateHistory]);
        activationContext.activeTab = tab;
    },
    document: {
        getElementById(id) {
            return {
                scrollIntoView(options) { scrolledTargets.push([id, options]); }
            };
        }
    }
};
vm.runInNewContext(controller.slice(activationStart, activationEnd) +
    "\nthis.activateSliderJumpEntry = activateSliderJumpEntry;", activationContext);
assert.equal(activationContext.activateSliderJumpEntry({ tab: "tone-curve" }), true);
assert.equal(activationContext.activateSliderJumpEntry({ tab: "color-grading" }), true);
assert.equal(activationContext.activateSliderJumpEntry({ tab: "presets", presetTab: true }), true);
expectedJumpEntries.filter(function (entryDefinition) { return entryDefinition.id; }).forEach(function (entryDefinition) {
    assert.equal(activationContext.activateSliderJumpEntry({
        id: "slider-jump-section-" + entryDefinition.id,
        developSectionId: entryDefinition.id,
        name: entryDefinition.label
    }), true, entryDefinition.label + " must retain Develop-section navigation");
});
expectedToolsJumpEntries.forEach(function (entryDefinition) {
    assert.equal(activationContext.activateSliderJumpEntry({
        id: "slider-jump-section-" + entryDefinition.id,
        toolsSectionId: entryDefinition.id,
        name: entryDefinition.label
    }), true, entryDefinition.label + " must retain Tools-section navigation");
});
assert.deepEqual(selectedTabs, [["tone-curve", true], ["color-grading", true], ["presets", true], ["sliders", true], ["tools", true]],
    "all cross-tab Jump-to navigation must use the existing authoritative tab-selection path");
assert.deepEqual(scrolledTargets.map(function (entry) { return entry[0]; }),
    expectedJumpEntries.filter(function (entryDefinition) { return entryDefinition.id; })
        .map(function (entryDefinition) { return "slider-jump-section-" + entryDefinition.id; })
        .concat(expectedToolsJumpEntries.map(function (entryDefinition) {
            return "slider-jump-section-" + entryDefinition.id;
        })),
    "every Develop and Tools navigation target must retain its heading-scroll path");
scrolledTargets.forEach(function (entry) {
    assert.deepEqual(entry[1], { behavior: "smooth", block: "start" });
});
assert.equal(activationContext.activateSliderJumpEntry({ id: "slider-jump-section-tone" }), false,
    "arbitrary non-tab entries must not bypass the Develop section identity");

const finalizerStart = controller.indexOf("function finalizeDevelopSectionCollapsing(");
const finalizerEnd = controller.indexOf("function invalidateHDRRenditionControls(", finalizerStart);
assert.notEqual(finalizerStart, -1);
assert.notEqual(finalizerEnd, -1);
const finalizerCalls = [];
const finalizerContext = {
    developSectionCollapseIds: sectionRegistry.collapseIds,
    decorateCollapsibleWhole(parent, heading, sectionId, sectionName) {
        finalizerCalls.push({ parent, heading, sectionId, sectionName });
    }
};
vm.runInNewContext(controller.slice(finalizerStart, finalizerEnd) +
    "\nthis.finalizeDevelopSectionCollapsing = finalizeDevelopSectionCollapsing;", finalizerContext);
Object.entries(allowedDevelopSections).forEach(function (entry) {
    const id = entry[0];
    const label = entry[1];
    const title = { className: "group-title" };
    const whiteBalanceTitle = {
        className: "develop-white-balance-title",
        classList: { contains(name) { return name === "develop-white-balance-title"; } }
    };
    const parent = { children: id === "white-balance" ? [whiteBalanceTitle] : [title] };
    finalizerContext.finalizeDevelopSectionCollapsing(parent, { id, label }, title);
    const call = finalizerCalls.at(-1);
    assert.equal(call.parent, parent);
    assert.equal(call.heading, id === "white-balance" ? whiteBalanceTitle : title);
    assert.equal(call.sectionId, "develop." + id);
    assert.equal(call.sectionName, label);
});
assert.equal(finalizerCalls.length, Object.keys(allowedDevelopSections).length,
    "each Jump-to Develop section must receive one top-level collapse control");
assert.equal((controller.match(/decorateCollapsibleWhole\(/g) || []).length, 2,
    "only the shared decorator definition and Develop-section finalizer may reference collapse decoration");
assert.doesNotMatch(controller, /decorateCollapsibleRange|\.decorateRange\(/,
    "individual sliders and nested subsections must never receive collapse decoration");

assert.match(controller, /const replacement = createDevelopSectionElement\(section\)[\s\S]*?replaceWith\(replacement\)/,
    "dynamic Color Mixer/B&W replacement must retain its one allowed top-level identity");
assert.match(controller, /closest\("\.collapsible-section-body\[hidden\]"\)[\s\S]*?visibleSliders\.push\(slider\)/,
    "collapsed slider bodies must remain in authoritative feedback polling");

const commandTabsBlock = controller.slice(
    controller.indexOf("function renderCommandGroups("),
    controller.indexOf("function cropToolCommandPath(")
);
const toneCurveTabBlock = controller.slice(
    controller.indexOf("function renderToneCurveTab("),
    controller.indexOf("function renderToolTab(")
);
const toolsBlock = controller.slice(
    controller.indexOf("function renderToolTab("),
    controller.indexOf("function renderSelectionTab(")
);
const fixedTabBlock = controller.slice(
    controller.indexOf("function renderSelectionTab("),
    controller.indexOf("function render()")
);
[colorGrading, commandTabsBlock, toneCurveTabBlock, fixedTabBlock].forEach(function (sourceBlock) {
    assert.doesNotMatch(sourceBlock, /collapseManager|decorateCollapsible|collapsible-section|collapseToggle/,
        "dedicated tabs must retain fixed layouts without collapse behavior");
});
assert.match(toolsBlock, /decorateToolsCollapsibleWhole\(groupElement, title, "tools\." \+ sectionSlug, tab\.title\)/);
assert.match(controller, /decorateToolsCollapsibleWhole\(section, heading, "tools\.crop-straighten", "Crop & Straighten"\)/);
assert.equal((controller.match(/decorateToolsCollapsibleWhole\(/g) || []).length, 3,
    "only the Tools decorator definition, Crop section, and shared Retouching renderer may reference Tools collapse decoration");
[
    "color-grading.", "tone-curve", "presets.", "selection.", "crop.", "application.", "retouching.", "tools.",
    "develop.color-mixer.hsl.", "develop.color-mixer.color.", "develop.color-mixer.point-color",
    "develop.lens-corrections.", "develop.lens-blur."
].forEach(function (forbiddenId) {
    assert.ok(!Object.keys(productionCollapseDefinitions).some(function (id) {
        return id === forbiddenId || id.startsWith(forbiddenId);
    }), "forbidden persisted collapse identity: " + forbiddenId);
});

const jumpFunction = controller.match(/function installSliderJumpMenu\(\)[\s\S]*?function startSliderJumpMenuObserver/)[0];
assert.match(jumpFunction, /target\.scrollIntoView/);
assert.doesNotMatch(jumpFunction, /setCollapsed|localStorage|collapseToggle/,
    "Jump To navigation must scroll to visible headings without changing persisted collapse state");

const cancellationFunction = controller.match(/function cancelActiveControllerGestures\(message\)[\s\S]*?function visibleWebControllerActions/)[0];
[
    "activeSliderInteractions", "cancelPointColorLocalGestures", "cancelEnhanceAmountGesture",
    "cancelLensBlurLocalGestures", "cancelCropAngleGesture"
].forEach((token) => assert.ok(cancellationFunction.includes(token), "missing collapse gesture cancellation: " + token));
["cancelParametricCurveGesture", "pointCurveController", "colorGradingController"]
    .forEach((token) => assert.ok(!cancellationFunction.includes(token), "dedicated-tab cancellation leaked into Develop collapse: " + token));
assert.match(controller, /onBeforeCollapse:[\s\S]*?cancelActiveControllerGestures/);

console.log("Web Controller section collapse tests passed.");
