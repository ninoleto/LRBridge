(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerFavorites = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const storageKey = "lrbridge.controller.favorites.v1";
    const defaults = ["lightroom.undo", "lightroom.redo"];
    function normalize(value, ids) {
        if (!Array.isArray(value)) return defaults.slice();
        const result = [...new Set(value.filter(id => ids.includes(id)))];
        return value.length && !result.length ? defaults.slice() : result;
    }
    // Selection/Application originals and favorites share these descriptors. No
    // hidden-button clicks or alternative transport/SDK paths are involved.
    function createTabActions(options) {
        const byItem = new Map(), byId = new Map(), feedback = new Map();
        let pending = false, feedbackVersion = 0;
        const photo = c => typeof c.selectedPhotoUuid === "string" && c.selectedPhotoUuid.length > 0;
        function requirements(item) {
            const c = options.getContext(), hasPhoto = photo(c), module = c.activeModule;
            if (!options.isConnected() || !["library", "develop", "map", "book", "slideshow", "print", "web"].includes(module)) return false;
            if (item.command === "application.module" || item.command === "application.secondary_view") return true;
            if (item.command === "application.view") {
                const develop = item.value.startsWith("develop_");
                return module === (develop ? "develop" : "library") && (["grid", "people"].includes(item.value) || hasPhoto);
            }
            if (item.command === "application.action") {
                if (["toggle_zoom", "zoom_in", "zoom_out", "zoom_100"].includes(item.value)) return ["library", "develop"].includes(module) && hasPhoto;
                return item.value !== "fullscreen_preview" || hasPhoto;
            }
            if (item.command === "selection.navigate" && ["first", "last"].includes(item.value)) return true;
            if (item.command === "selection.operation" && ["select_all", "select_inverse"].includes(item.value)) return true;
            return hasPhoto;
        }
        function label(item, group) {
            if (item.command === "selection.navigate") return item.label + " Photo";
            if (item.command === "selection.extend") return "Extend Selection " + (item.value === "left" ? "Left" : "Right");
            if (item.command === "photo.rotate") return "Rotate Photo " + (item.value === "left" ? "Left" : "Right");
            if (item.command === "photo.reveal") return "Reveal Active Photo";
            if (item.command === "selection.flag") return item.value === "none" ? "Remove Flag" : "Flag as " + item.label;
            if (item.command === "selection.rating.set") return item.value === 0 ? "Clear Rating" : "Rate " + item.label;
            if (item.command === "selection.label.set") return item.value === "none" ? "Clear Color Label" : "Set " + item.label + " Color Label";
            if (item.command === "application.module") return "Switch to " + item.label;
            if (item.command === "application.secondary_view" || group.name === "Secondary Display") return "Secondary Display: " + item.label;
            if (item.command === "application.view") return item.value.startsWith("develop_") ? item.label.startsWith("Develop") ? item.label : "Develop: " + item.label : "Library " + item.label;
            if (item.command === "application.action" && item.value === "toggle_zoom") return "Toggle Zoom";
            return item.label;
        }
        for (const [tab, groups] of options.tabs) groups.forEach((group, index) => {
            for (const item of group.commands) {
                const id = item.command + "." + item.value;
                if (byId.has(id)) throw Error("Duplicate tab action: " + id);
                const action = { id, label: label(item, group), group: tab + " — " + group.name,
                    groupOrder: (tab === "Selection" ? 10 : 30) + index,
                    description: group.note || "Uses Lightroom’s existing " + group.name.toLowerCase() + " command.",
                    available: () => !pending && !options.isBlocked() && requirements(item),
                    pressed: () => item.command === "application.module" && options.isConnected() ? options.getContext().activeModule === item.value : null,
                    feedback: () => feedback.get(id) || {},
                    showDetails: options.showDetails,
                    run: async () => {
                        if (!action.available()) return false;
                        pending = true;
                        const key = ++feedbackVersion;
                        feedback.set(id, { key, kind: "pending", busy: true, summary: action.label + " pending", detail: "Waiting for the bridge to accept " + action.label + "." });
                        options.onChange();
                        let accepted = false;
                        try { accepted = await options.send(item); }
                        catch (_) { accepted = false; }
                        finally {
                            pending = false;
                            feedback.set(id, { key, kind: accepted ? "sent" : "error", summary: action.label + (accepted ? " requested" : " unconfirmed"), short: accepted ? "Requested" : "Check",
                                detail: accepted ? action.label + " requested in Lightroom. Completion is not confirmed by HTTP admission." : action.label + " request unconfirmed. Check the controller status; no automatic retry was sent." });
                            options.onChange(); options.onSettled?.();
                        }
                        return accepted;
                    }
                };
                byItem.set(item, action); byId.set(id, action);
            }
        });
        return { actions: [...byId.values()], forItem: item => byItem.get(item), get: id => byId.get(id), isInteracting: () => pending };
    }
    function create(options) {
        const doc = options.document, actions = options.actions, byId = new Map(actions.map(a => [a.id, a]));
        const bar = doc.getElementById("historyToolbar"), list = doc.getElementById("favoriteActions");
        const customize = doc.getElementById("favoritesCustomize"), notice = doc.getElementById("favoritesNotice");
        const dialog = doc.getElementById("favoritesDialog"), rows = doc.getElementById("favoritesOrder");
        const picker = doc.getElementById("favoritesAddChoice"), add = doc.getElementById("favoritesAdd");
        const search = doc.getElementById("favoritesSearch"), matches = doc.getElementById("favoritesMatches");
        const status = doc.getElementById("favoritesPreferenceStatus"), live = doc.getElementById("favoritesLive");
        const feedbackPanel = doc.getElementById("favoritesFeedback"), message = doc.getElementById("favoritesMessage"), dismiss = doc.getElementById("favoritesDismiss");
        let order = defaults.slice(), lastAction = null, noticeAction = null, lastAnnouncement = "", previousListWidth = null;
        let transient = null, transientKey = null, feedbackTimer = null, activation = 0, detailFocus = null;
        const issues = new Map(), dismissed = new Map(), sentAcknowledgements = new Map();
        const buttons = new Map();
        try { const saved = options.storage?.getItem(storageKey); if (saved !== null && saved !== undefined) order = normalize(JSON.parse(saved), [...byId.keys()]); } catch (_) { /* Browser preference unavailable. */ }
        function element(tag, text, className) {
            const node = doc.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
        }
        function button(label, run) {
            const b = element("button", label, "command-neutral"); b.type = "button"; b.addEventListener("click", run); return b;
        }
        const ownerOf = a => a?.feedbackGroup || a?.id;
        function refreshFeedback() {
            const last = byId.get(lastAction), lastOwner = ownerOf(last), seen = new Set();
            let latest = null;
            for (const source of actions) {
                const owner = ownerOf(source);
                if (seen.has(owner)) continue;
                seen.add(owner);
                const feedback = source.feedback?.() || {};
                const reported = byId.get(feedback.command);
                const action = ownerOf(reported) === owner ? reported : owner === lastOwner ? last : source;
                const signature = JSON.stringify([feedback.kind, feedback.key, feedback.command, feedback.detail]);
                const entry = { owner, action, feedback, signature };
                if (feedback.needsReview) issues.set(owner, entry);
                else {
                    if (issues.get(owner)?.feedback.needsReview) issues.delete(owner);
                    if (feedback.kind === "error") {
                        if ((owner === lastOwner || issues.has(owner)) && dismissed.get(owner) !== signature) issues.set(owner, entry);
                    } else if (feedback.kind !== "pending") { issues.delete(owner); dismissed.delete(owner); }
                }
                if (owner === lastOwner) latest = entry;
            }
            const key = latest && JSON.stringify([activation, latest.signature]);
            if (key !== transientKey) {
                transientKey = key; clearTimeout(feedbackTimer); transient = null;
                if (latest && ["pending", "sent"].includes(latest.feedback.kind) && !latest.feedback.needsReview) {
                    const sentKey = JSON.stringify([activation, latest.feedback.key, latest.feedback.command]);
                    if (latest.feedback.kind === "pending") transient = latest;
                    else if (sentAcknowledgements.get(latest.owner) !== sentKey) {
                        sentAcknowledgements.set(latest.owner, sentKey); transient = latest;
                        feedbackTimer = setTimeout(() => { transient = null; renderFeedback(); }, 4000);
                    }
                }
            }
            renderFeedback();
        }
        function renderFeedback() {
            // Required review belongs to the original controller and cannot be dismissed
            // here. Other errors persist until recovery or explicit dismissal, including
            // when another favorite runs or the failing favorite is removed.
            const attention = [...issues.values()].find(entry => entry.feedback.needsReview) || issues.values().next().value;
            const entry = attention || transient;
            noticeAction = attention || null;
            feedbackPanel.hidden = !entry || Boolean(detailFocus && detailFocus.signature === entry.signature && detailFocus.owner === entry.owner && detailFocus.node === doc.activeElement);
            notice.hidden = !attention; dismiss.hidden = !attention || attention.feedback.needsReview;
            if (!entry) return;
            const { action, feedback } = entry;
            const text = action.label + " — " + (feedback.needsReview ? "review required" : attention ? feedback.notice || "request unconfirmed" : feedback.kind === "pending" ? "waiting for feedback" : "command sent") + ".";
            if (message.textContent !== text) message.textContent = text;
            feedbackPanel.title = feedback.detail || "";
            feedbackPanel.classList.toggle("favorites-attention", Boolean(attention));
            notice.textContent = feedback.needsReview ? "Review" : "Details";
            notice.setAttribute("aria-label", (feedback.summary || action.label) + ". Open details");
            dismiss.setAttribute("aria-label", "Dismiss notice for " + action.label);
            if (text !== lastAnnouncement) { live.textContent = text; lastAnnouncement = text; }
        }
        function refresh() {
            for (const [id, b] of buttons) {
                const a = byId.get(id), available = a.available();
                b.setAttribute("aria-disabled", String(!available));
                b.title = a.description || a.label;
                if (a.description) b.setAttribute("aria-description", a.description);
                const pressed = a.pressed?.();
                if (typeof pressed === "boolean") b.setAttribute("aria-pressed", String(pressed)); else b.removeAttribute("aria-pressed");
            }
            refreshFeedback();
            const listWidth = list.clientWidth;
            if (listWidth !== previousListWidth && list.contains(doc.activeElement)) {
                const target = doc.activeElement.getBoundingClientRect(), viewport = list.getBoundingClientRect();
                if (target.width > viewport.width) list.scrollLeft += target.left - viewport.left;
                else if (target.right > viewport.right) list.scrollLeft += target.right - viewport.right;
                else if (target.left < viewport.left) list.scrollLeft += target.left - viewport.left;
            }
            previousListWidth = listWidth;
        }
        function showOrder() {
            const focusId = doc.activeElement?.dataset.favoriteAction;
            const oldScroll = list.scrollLeft;
            for (const [id, b] of buttons) if (!order.includes(id)) b.remove();
            order.forEach((id, index) => {
                let b = buttons.get(id);
                if (!b) {
                    const a = byId.get(id);
                    b = button(a.label, () => {
                        if (!a.available()) return;
                        lastAction = id; activation++;
                        a.run(); // Same guarded action as its original control.
                        refresh();
                    });
                    b.className = "slider-jump-history-button"; b.dataset.favoriteAction = id;
                    b.setAttribute("aria-label", a.label); buttons.set(id, b);
                }
                if (list.children[index] !== b) list.insertBefore(b, list.children[index] || null);
            });
            if (focusId && order.includes(focusId)) buttons.get(focusId).focus({ preventScroll: true });
            list.scrollLeft = oldScroll;
            options.onArrangementChange?.(order.slice()); refresh();
        }
        function save() {
            try { if (!options.storage) throw Error(); options.storage.setItem(storageKey, JSON.stringify(order)); status.textContent = "Saved for this browser."; }
            catch (_) { status.textContent = "Browser storage unavailable; this arrangement lasts until reload."; }
            showOrder();
        }
        function editRows(focusKey) {
            const scroll = dialog.scrollTop;
            rows.replaceChildren();
            order.forEach((id, index) => {
                const a = byId.get(id), row = element("li", null, "favorites-edit-row");
                row.appendChild(element("span", a.label, "favorites-edit-label"));
                const controls = element("div", null, "favorites-edit-buttons");
                for (const [label, delta] of [["Move up", -1], ["Move down", 1]]) {
                    const move = button(delta < 0 ? "↑" : "↓", () => {
                        const target = order.indexOf(id) + delta;
                        if (target < 0 || target >= order.length) return;
                        const from = order.indexOf(id); [order[from], order[target]] = [order[target], order[from]];
                        save(); editRows(id + ":" + delta);
                    });
                    move.dataset.editKey = id + ":" + delta; move.setAttribute("aria-label", label + ": " + a.label);
                    move.disabled = index + delta < 0 || index + delta >= order.length;
                    controls.appendChild(move);
                }
                const remove = button("Remove", () => { order = order.filter(x => x !== id); save(); editRows(); picker.focus({ preventScroll: true }); });
                remove.setAttribute("aria-label", "Remove " + a.label); controls.appendChild(remove); row.appendChild(controls); rows.appendChild(row);
            });
            filterChoices();
            if (focusKey) {
                const target = Array.from(rows.querySelectorAll("[data-edit-key]")).find(n => n.dataset.editKey === focusKey);
                // At an endpoint keep focus on the other reorder control in that row.
                (target?.disabled ? target.parentElement.querySelector("button:not(:disabled)") : target)?.focus({ preventScroll: true });
            }
            dialog.scrollTop = scroll;
        }
        function filterChoices() {
            const selected = picker.value, terms = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean), groups = new Map();
            picker.replaceChildren();
            for (const a of actions) {
                if (order.includes(a.id) || !terms.every(term => [a.label, a.group, a.description].join(" ").toLocaleLowerCase().includes(term))) continue;
                const groupName = a.group || "Other actions";
                if (!groups.has(groupName)) { const group = element("optgroup"); group.label = groupName; groups.set(groupName, group); picker.appendChild(group); }
                const choice = element("option", a.label); choice.value = a.id; groups.get(groupName).appendChild(choice);
            }
            if (Array.from(picker.options).some(o => o.value === selected)) picker.value = selected;
            picker.disabled = add.disabled = picker.options.length === 0;
            matches.textContent = picker.options.length ? picker.options.length + " available " + (picker.options.length === 1 ? "action" : "actions") + " in " + groups.size + (groups.size === 1 ? " section" : " sections") : "No matching actions. Try another search.";
            describeChoice();
        }
        function describeChoice() {
            const a = byId.get(picker.value);
            doc.getElementById("favoritesActionHelp").textContent = a ? (a.group ? a.group + ". " : "") + (a.description || "") : "";
        }
        search.addEventListener("input", filterChoices);
        picker.addEventListener("change", describeChoice);
        customize.addEventListener("click", () => { search.value = ""; editRows(); dialog.showModal(); });
        doc.getElementById("favoritesClose").addEventListener("click", () => dialog.close());
        dialog.addEventListener("close", () => {
            if (doc.activeElement === doc.body || dialog.contains(doc.activeElement)) customize.focus({ preventScroll: true });
        });
        add.addEventListener("click", () => {
            const id = picker.value; if (!byId.has(id) || order.includes(id)) return;
            order.push(id); save(); editRows(id + ":-1");
        });
        doc.getElementById("favoritesRestore").addEventListener("click", () => { order = defaults.slice(); save(); editRows(); });
        notice.addEventListener("click", () => {
            if (!noticeAction) return;
            noticeAction.action.showDetails?.(noticeAction.feedback.detail);
            // Keep the persistent issue, but do not cover the original detail/review
            // control while the user reads it. It returns when focus moves away.
            if (doc.activeElement !== notice && doc.activeElement !== doc.body) {
                detailFocus = { owner: noticeAction.owner, signature: noticeAction.signature, node: doc.activeElement };
                renderFeedback();
            }
        });
        doc.addEventListener("focusin", () => { if (detailFocus) renderFeedback(); });
        dismiss.addEventListener("click", () => {
            if (!noticeAction || noticeAction.feedback.needsReview) return;
            dismissed.set(noticeAction.owner, noticeAction.signature); issues.delete(noticeAction.owner);
            if (doc.activeElement === dismiss) customize.focus({ preventScroll: true });
            renderFeedback();
        });
        // One row even on phones. Observe the real height so navigation also stays
        // aligned if browser font/zoom preferences change the rendered dimensions.
        const observer = new ResizeObserver(() => doc.documentElement.style.setProperty("--controller-toolbar-height", bar.getBoundingClientRect().height + "px"));
        observer.observe(bar);
        showOrder();
        return { refresh, getOrder: () => order.slice() };
    }
    return { create, createTabActions, normalize, storageKey };
});
