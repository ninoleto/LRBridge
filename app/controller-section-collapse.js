(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LRBridgeSectionCollapse = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const STORAGE_VERSION = 1;
    const STORAGE_KEY = "lrbridge.controller.collapsedSections.v1";

    function normalizeDefinitions(definitions) {
        const normalized = Object.create(null);
        Object.keys(definitions || {}).forEach(function (id) {
            if (/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) &&
                typeof definitions[id] === "string" && definitions[id].trim() !== "") {
                normalized[id] = definitions[id].trim();
            }
        });
        return Object.freeze(normalized);
    }

    function parseStoredState(raw, definitions) {
        if (typeof raw !== "string" || raw === "") return new Set();
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.collapsed)) return new Set();
            return new Set(parsed.collapsed.filter(function (id) {
                return typeof id === "string" && Object.prototype.hasOwnProperty.call(definitions, id);
            }));
        } catch (error) {
            return new Set();
        }
    }

    function serializeStoredState(collapsed, definitions) {
        const ids = Array.from(collapsed || []).filter(function (id) {
            return Object.prototype.hasOwnProperty.call(definitions, id);
        }).sort();
        return JSON.stringify({ version: STORAGE_VERSION, collapsed: ids });
    }

    function bodyIdFor(sectionId) {
        return "lrbridge-collapse-body-" + sectionId.replace(/[^a-z0-9]+/g, "-");
    }

    function createChevron(documentObject) {
        const svgNamespace = "http://www.w3.org/2000/svg";
        const svg = documentObject.createElementNS(svgNamespace, "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const path = documentObject.createElementNS(svgNamespace, "path");
        path.setAttribute("d", "M5.5 3.5 10 8l-4.5 4.5");
        svg.appendChild(path);
        return svg;
    }

    function createManager(options) {
        const documentObject = options.document;
        const storage = options.storage || null;
        const storageKey = options.storageKey || STORAGE_KEY;
        const definitions = normalizeDefinitions(options.definitions);
        const onBeforeCollapse = typeof options.onBeforeCollapse === "function"
            ? options.onBeforeCollapse
            : function () {};
        let collapsed = new Set();
        const entries = new Map();

        try {
            collapsed = parseStoredState(storage && storage.getItem(storageKey), definitions);
        } catch (error) {
            collapsed = new Set();
        }

        function persist() {
            try {
                if (storage) storage.setItem(storageKey, serializeStoredState(collapsed, definitions));
            } catch (error) {
                // Storage can be unavailable in private or restricted browser contexts.
            }
        }

        function liveEntries(sectionId) {
            const registered = entries.get(sectionId) || [];
            const live = registered.filter(function (entry) {
                return entry.heading && entry.heading.isConnected !== false &&
                    entry.body && entry.body.isConnected !== false;
            });
            entries.set(sectionId, live);
            return live;
        }

        function updateEntry(entry, isCollapsed) {
            entry.body.hidden = isCollapsed;
            entry.button.setAttribute("aria-expanded", String(!isCollapsed));
            entry.button.setAttribute("aria-label", (isCollapsed ? "Expand " : "Collapse ") + entry.name);
            entry.heading.classList.toggle("collapsed", isCollapsed);
        }

        function setCollapsed(sectionId, isCollapsed, shouldPersist) {
            if (!Object.prototype.hasOwnProperty.call(definitions, sectionId)) return false;
            if (isCollapsed) collapsed.add(sectionId);
            else collapsed.delete(sectionId);
            liveEntries(sectionId).forEach(function (entry) { updateEntry(entry, isCollapsed); });
            if (shouldPersist !== false) persist();
            return true;
        }

        function decorateRange(parent, heading, endExclusive, sectionId, runtimeName) {
            if (!parent || !heading || heading.parentNode !== parent ||
                !Object.prototype.hasOwnProperty.call(definitions, sectionId)) return null;
            const name = typeof runtimeName === "string" && runtimeName.trim() !== ""
                ? runtimeName.trim()
                : definitions[sectionId];
            const nodes = [];
            let cursor = heading.nextSibling;
            while (cursor && cursor !== endExclusive) {
                nodes.push(cursor);
                cursor = cursor.nextSibling;
            }

            const body = documentObject.createElement("div");
            body.id = bodyIdFor(sectionId);
            body.className = "collapsible-section-body";
            body.dataset.collapseBody = sectionId;
            parent.insertBefore(body, heading.nextSibling);
            nodes.forEach(function (node) { body.appendChild(node); });

            const label = documentObject.createElement("span");
            label.className = "collapsible-section-label";
            label.textContent = name;
            const button = documentObject.createElement("button");
            button.type = "button";
            button.className = "collapsible-section-toggle";
            button.dataset.collapseToggle = sectionId;
            button.setAttribute("aria-controls", body.id);
            button.appendChild(createChevron(documentObject));
            heading.textContent = "";
            heading.classList.add("collapsible-section-heading");
            heading.dataset.collapseSection = sectionId;
            heading.appendChild(label);
            heading.appendChild(button);

            const entry = { sectionId: sectionId, name: name, heading: heading, body: body, button: button };
            const registered = entries.get(sectionId) || [];
            registered.push(entry);
            entries.set(sectionId, registered);
            updateEntry(entry, collapsed.has(sectionId));
            button.addEventListener("click", function () {
                const nextCollapsed = button.getAttribute("aria-expanded") === "true";
                if (nextCollapsed) onBeforeCollapse(sectionId, name, entry);
                setCollapsed(sectionId, nextCollapsed, true);
            });
            return entry;
        }

        function decorateWhole(parent, heading, sectionId, runtimeName) {
            return decorateRange(parent, heading, null, sectionId, runtimeName);
        }

        return Object.freeze({
            definitions: definitions,
            decorateRange: decorateRange,
            decorateWhole: decorateWhole,
            setCollapsed: setCollapsed,
            isCollapsed: function (sectionId) { return collapsed.has(sectionId); },
            getCollapsed: function () { return Array.from(collapsed).sort(); }
        });
    }

    return Object.freeze({
        STORAGE_VERSION: STORAGE_VERSION,
        STORAGE_KEY: STORAGE_KEY,
        normalizeDefinitions: normalizeDefinitions,
        parseStoredState: parseStoredState,
        serializeStoredState: serializeStoredState,
        bodyIdFor: bodyIdFor,
        createManager: createManager
    });
}));
