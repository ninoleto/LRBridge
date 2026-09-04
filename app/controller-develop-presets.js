(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeControllerDevelopPresets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function cloneEntry(entry) {
        return {
            uuid: entry.uuid,
            alias: typeof entry.alias === "string" ? entry.alias : "",
            updateAISettings: entry.updateAISettings === true,
            amountEnabled: entry.amountEnabled === true
        };
    }

    function createDraft(entries) {
        return Array.isArray(entries) ? entries.map(cloneEntry) : [];
    }

    function addDraftEntry(draft, uuid) {
        if (!Array.isArray(draft) || typeof uuid !== "string" || uuid.length === 0 ||
            draft.some(function (entry) { return entry.uuid === uuid; })) return false;
        draft.push({ uuid: uuid, alias: "", updateAISettings: false, amountEnabled: false });
        return true;
    }

    function removeDraftEntry(draft, index) {
        if (!Array.isArray(draft) || !Number.isInteger(index) || index < 0 || index >= draft.length) return false;
        draft.splice(index, 1);
        return true;
    }

    function moveDraftEntry(draft, index, direction) {
        const target = index + direction;
        if (!Array.isArray(draft) || !Number.isInteger(index) || (direction !== -1 && direction !== 1) ||
            index < 0 || index >= draft.length || target < 0 || target >= draft.length) return false;
        const entry = draft[index];
        draft.splice(index, 1);
        draft.splice(target, 0, entry);
        return true;
    }

    function configurationFromDraft(draft) {
        return {
            version: 1,
            presets: draft.map(function (entry) {
                const saved = {
                    uuid: entry.uuid,
                    updateAISettings: entry.updateAISettings === true,
                    amountEnabled: entry.amountEnabled === true
                };
                const alias = typeof entry.alias === "string" ? entry.alias.trim() : "";
                if (alias) saved.alias = alias;
                return saved;
            })
        };
    }

    function displayLabel(entry) {
        const source = entry.folder && entry.name ? entry.folder + " — " + entry.name : entry.uuid;
        return entry.alias ? entry.alias + " — " + source : source;
    }

    function inventoryLabel(item) {
        return item.folder + " — " + item.name;
    }

    function primaryLabel(entry) {
        return entry.alias || entry.name || entry.uuid;
    }

    function secondaryLabel(entry) {
        if (entry.folder && entry.name) return entry.folder + " — " + entry.name;
        if (entry.name) return entry.name;
        return entry.uuid + (entry.missing === true ? " (missing UUID)" : "");
    }

    function parsePresetAmount(value) {
        const text = String(value);
        if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
        const amount = Number(text);
        return Number.isSafeInteger(amount) && amount >= 0 && amount <= 200 ? amount : null;
    }

    function createController(options) {
        const document = options.document;
        const fetchRequest = options.fetch;
        const setStatus = options.setStatus || function () {};
        const getContext = options.getContext;
        const createTreatmentPresentation = options.createTreatmentPresentation;
        let state = null;
        let draft = [];
        let draftDirty = false;
        let draftInitialized = false;
        const selectedInventoryUuids = new Set();
        let configuredSearch = "";
        let inventorySearch = "";
        let rootElement = null;
        let previousButton = null;
        let nextButton = null;
        let currentPresetButton = null;
        let currentPresetPrimary = null;
        let currentPresetSecondary = null;
        let amountRange = null;
        let amountNumber = null;
        let amountDecrementButton = null;
        let amountIncrementButton = null;
        let amountResetButton = null;
        let amountCapabilityNote = null;
        let compactStatus = null;
        let treatmentPresentation = null;
        let manageButton = null;
        let managerPanel = null;
        let addPresetsButton = null;
        let refreshPresetsButton = null;
        let configuredList = null;
        let saveButton = null;
        let managerStatus = null;
        let configuredPicker = null;
        let inventoryPicker = null;
        let timer = null;
        let generation = 0;
        let applicationRequestInFlight = false;
        let amountEditing = false;
        let amountDragging = false;
        let desiredAmount = null;
        let queuedAmount = null;
        let queuedAmountRevision = 0;
        let activeAmountRequest = null;
        let awaitingAmountFeedback = null;
        let amountGeneration = 0;
        let amountIntentRevision = 0;
        let amountThrottleTimer = null;
        let acceptedServerEpoch = null;
        let acceptedStateRevision = -1;
        let stateRequestGeneration = 0;
        let acceptedStateRequestGeneration = 0;
        let acceptedAmountFeedbackId = 0;
        let acceptedAmountFeedbackBinding = null;
        let inventoryRefreshInFlight = false;
        let inventoryRefreshPromise = null;
        let inventoryRefreshError = null;
        let saveInFlight = false;
        let configuredListRendered = false;
        let pendingPresetStatusOperationId = null;

        function currentContext() {
            const value = typeof getContext === "function" ? getContext() : null;
            return value || {};
        }

        function nextStateRequestGeneration() {
            stateRequestGeneration += 1;
            return stateRequestGeneration;
        }

        function contextReady() {
            const context = currentContext();
            return context.activeModule === "develop" && typeof context.selectedPhotoUuid === "string" &&
                context.selectedPhotoUuid.length > 0 && Number.isSafeInteger(context.contextCounter) &&
                Number.isSafeInteger(context.developCounter) && Number.isSafeInteger(context.contextChangedAt) &&
                state && typeof state.serverEpoch === "string" && state.serverEpoch.length > 0;
        }

        function bindingQuery() {
            const context = currentContext();
            return "&selectedPhotoUuid=" + encodeURIComponent(context.selectedPhotoUuid) +
                "&contextCounter=" + encodeURIComponent(String(context.contextCounter)) +
                "&developCounter=" + encodeURIComponent(String(context.developCounter)) +
                "&contextChangedAt=" + encodeURIComponent(String(context.contextChangedAt)) +
                "&serverEpoch=" + encodeURIComponent(state.serverEpoch);
        }

        function applicationPath(uuid) {
            return "/api/develop-presets/apply?uuid=" + encodeURIComponent(uuid) + bindingQuery();
        }

        function navigationPath(direction) {
            return "/api/develop-presets/navigate?direction=" + encodeURIComponent(direction) + bindingQuery();
        }

        function amountPath(amount, feedbackId) {
            return "/api/develop-presets/amount?presetAmount=" + encodeURIComponent(String(amount)) +
                "&feedbackId=" + encodeURIComponent(String(feedbackId)) + bindingQuery();
        }

        function makeButton(text, className, listener) {
            const button = document.createElement("button");
            button.type = "button";
            if (className) button.className = className;
            button.textContent = text;
            button.addEventListener("click", listener);
            return button;
        }

        function appendTextField(row, labelText, value, className) {
            const field = document.createElement("div");
            field.className = "develop-preset-config-field " + (className || "");
            const label = document.createElement("span");
            label.className = "develop-preset-config-field-label";
            label.textContent = labelText;
            const text = document.createElement("span");
            text.className = "develop-preset-config-field-value";
            text.textContent = value;
            field.append(label, text);
            row.appendChild(field);
        }

        function setManagerMessage(message, kind) {
            if (!managerStatus) return;
            managerStatus.textContent = message || "";
            managerStatus.dataset.kind = kind || "info";
        }

        function draftDiffersFromSavedConfiguration() {
            if (!draftInitialized || !state || !state.configuration) return false;
            const savedConfiguration = configurationFromDraft(createDraft(state.configuration.presets));
            return JSON.stringify(configurationFromDraft(draft)) !== JSON.stringify(savedConfiguration);
        }

        function inventorySnapshotLoaded(candidate) {
            return !!candidate && (candidate.inventoryLoaded === true || Number.isFinite(candidate.inventoryRefreshedAt));
        }

        function inventoryLifecycleMessage(candidate) {
            const loaded = inventorySnapshotLoaded(candidate);
            const status = candidate ? candidate.inventoryStatus : "not-loaded";
            const failure = inventoryRefreshError || (candidate && candidate.inventoryError);
            if (inventoryRefreshInFlight || status === "loading") {
                return loaded ? "Refreshing Lightroom presets…" : "Finding Lightroom presets…";
            }
            if (failure) {
                return "Could not refresh Lightroom presets. Please try again.";
            }
            if (status === "ready" && loaded) {
                const count = candidate && Array.isArray(candidate.inventory) ? candidate.inventory.length : 0;
                return count + " Lightroom presets found.";
            }
            return "Lightroom presets have not been loaded yet.";
        }

        function syncManagerToolbar() {
            if (!addPresetsButton || !refreshPresetsButton || !saveButton) return;
            addPresetsButton.disabled = false;
            addPresetsButton.setAttribute("aria-busy", String(inventoryRefreshInFlight));
            refreshPresetsButton.disabled = inventoryRefreshInFlight;
            refreshPresetsButton.setAttribute("aria-busy", String(inventoryRefreshInFlight));
            saveButton.disabled = saveInFlight || !draftDirty;
            saveButton.className = "develop-preset-save" + (draftDirty ? " dirty" : "");
            saveButton.setAttribute("aria-busy", String(saveInFlight));
        }

        function updateDraftDirtyState() {
            draftDirty = draftDiffersFromSavedConfiguration();
            syncManagerToolbar();
        }

        function normalizedSearch(value) {
            return String(value || "").trim().toLocaleLowerCase();
        }

        function matchesSearch(entry, search) {
            if (!search) return true;
            return [entry.alias, entry.folder, entry.name, entry.uuid].some(function (value) {
                return typeof value === "string" && value.toLocaleLowerCase().includes(search);
            });
        }

        function focusElement(element) {
            if (!element || typeof element.focus !== "function") return;
            try { element.focus({ preventScroll: true }); } catch (err) { element.focus(); }
        }

        function focusPickerRow(rows, index, key) {
            const enabledRows = rows.filter(function (row) { return !row.disabled; });
            if (enabledRows.length === 0) return;
            const current = enabledRows.indexOf(rows[index]);
            let target = 0;
            if (key === "End") target = enabledRows.length - 1;
            else if (key === "ArrowUp") target = current <= 0 ? enabledRows.length - 1 : current - 1;
            else if (key === "ArrowDown") target = current < 0 || current === enabledRows.length - 1 ? 0 : current + 1;
            focusElement(enabledRows[target]);
        }

        function closePicker(picker, restoreFocus) {
            if (!picker || !picker.open) return;
            picker.open = false;
            picker.dialog.hidden = true;
            if (typeof picker.dialog.close === "function" && picker.dialog.open) {
                try { picker.dialog.close(); } catch (err) { /* The fallback hidden state is sufficient. */ }
            }
            if (picker.opener) picker.opener.setAttribute("aria-expanded", "false");
            if (restoreFocus !== false) focusElement(picker.opener);
            picker.opener = null;
        }

        function renderOpenPicker(picker, force) {
            if (!picker || !picker.open) return;
            if (picker === configuredPicker) renderConfiguredPicker(force === true);
            else renderInventoryPicker(force === true);
        }

        function openPicker(picker, opener) {
            if (!picker || picker.open) return;
            const other = picker === configuredPicker ? inventoryPicker : configuredPicker;
            closePicker(other, false);
            picker.open = true;
            picker.opener = opener;
            picker.dialog.hidden = false;
            opener.setAttribute("aria-expanded", "true");
            renderOpenPicker(picker, true);
            if (typeof picker.dialog.showModal === "function") {
                try { picker.dialog.showModal(); } catch (err) { /* A connected fallback dialog remains visible. */ }
            }
            focusElement(picker.searchInput);
        }

        function createPickerDialog(id, titleText, descriptionText, searchLabel, listLabel, multiple) {
            const dialog = document.createElement("dialog");
            dialog.className = "develop-preset-picker";
            dialog.id = id;
            dialog.hidden = true;
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", id + "Title");
            dialog.setAttribute("aria-describedby", id + "Description");

            const shell = document.createElement("div");
            shell.className = "develop-preset-picker-shell";
            const header = document.createElement("div");
            header.className = "develop-preset-picker-header";
            const title = document.createElement("h3");
            title.id = id + "Title";
            title.textContent = titleText;
            const closeButton = makeButton("Close", "develop-preset-picker-close secondary", function () {
                closePicker(picker, true);
            });
            header.append(title, closeButton);

            const description = document.createElement("p");
            description.id = id + "Description";
            description.className = "develop-preset-picker-description";
            description.textContent = descriptionText;
            const searchInput = document.createElement("input");
            searchInput.type = "search";
            searchInput.autocomplete = "off";
            searchInput.className = "develop-preset-picker-search";
            searchInput.setAttribute("aria-label", searchLabel);
            const list = document.createElement("div");
            list.className = "develop-preset-picker-list";
            list.setAttribute("role", "listbox");
            list.setAttribute("aria-label", listLabel);
            if (multiple) list.setAttribute("aria-multiselectable", "true");
            shell.append(header, description, searchInput, list);
            dialog.appendChild(shell);
            rootElement.appendChild(dialog);

            const picker = {
                dialog: dialog,
                shell: shell,
                searchInput: searchInput,
                list: list,
                open: false,
                opener: null,
                optionRows: [],
                renderSignature: null
            };
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "ArrowDown" && picker.optionRows.length > 0) {
                    if (event.preventDefault) event.preventDefault();
                    focusPickerRow(picker.optionRows, -1, "ArrowDown");
                }
            });
            dialog.addEventListener("cancel", function (event) {
                if (event.preventDefault) event.preventDefault();
                closePicker(picker, true);
            });
            dialog.addEventListener("keydown", function (event) {
                if (event.key !== "Escape") return;
                if (event.preventDefault) event.preventDefault();
                closePicker(picker, true);
            });
            dialog.addEventListener("click", function (event) {
                if (event.target === dialog) closePicker(picker, true);
            });
            return picker;
        }

        function appendPickerOptionContent(row, primary, secondary, marker) {
            const labels = document.createElement("span");
            labels.className = "develop-preset-picker-option-labels";
            const primaryText = document.createElement("span");
            primaryText.className = "develop-preset-picker-option-primary";
            primaryText.textContent = primary;
            const secondaryText = document.createElement("span");
            secondaryText.className = "develop-preset-picker-option-secondary";
            secondaryText.textContent = secondary;
            labels.append(primaryText, secondaryText);
            const mark = document.createElement("span");
            mark.className = "develop-preset-picker-option-mark";
            mark.textContent = marker || "";
            row.append(labels, mark);
        }

        function appendPickerEmpty(picker, message) {
            const empty = document.createElement("div");
            empty.className = "develop-preset-picker-empty";
            empty.textContent = message;
            picker.list.appendChild(empty);
        }

        function renderConfiguredPicker(force) {
            if (!configuredPicker || !configuredPicker.open || !state) return;
            const configured = Array.isArray(state.configured) ? state.configured : [];
            const pending = state.pendingApplication === true || applicationRequestInFlight || amountBusy();
            const signature = [
                configuredSearch,
                state.cursorUuid || "",
                contextReady() ? "ready" : "context-unavailable",
                state.controlsEnabled === true ? "enabled" : "disabled",
                pending ? "pending" : "idle",
                configured.map(function (entry) {
                    return [entry.uuid, entry.alias || "", entry.folder || "", entry.name || "", entry.available === true].join("\u001f");
                }).join("\u001e")
            ].join("\u001d");
            if (!force && configuredPicker.renderSignature === signature) return;
            configuredPicker.renderSignature = signature;
            configuredPicker.searchInput.value = configuredSearch;
            const activeUuid = document.activeElement && document.activeElement.dataset
                ? document.activeElement.dataset.uuid : null;
            configuredPicker.list.textContent = "";
            const search = normalizedSearch(configuredSearch);
            const rows = [];
            configured.filter(function (entry) { return matchesSearch(entry, search); }).forEach(function (entry) {
                const isCursor = entry.uuid === state.cursorUuid;
                const row = makeButton("", "develop-preset-picker-option" +
                    (isCursor ? " current" : "") + (entry.available ? "" : " unavailable"), function () {
                    if (row.disabled) return;
                    closePicker(configuredPicker, true);
                    return submitPreset(applicationPath(entry.uuid));
                });
                row.dataset.uuid = entry.uuid;
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", String(isCursor));
                row.setAttribute("aria-label", displayLabel(entry) + (isCursor ? ", current cursor" : "") +
                    (entry.available ? "" : ", unavailable"));
                row.disabled = !entry.available || !contextReady() || state.controlsEnabled !== true || pending;
                appendPickerOptionContent(row, primaryLabel(entry), secondaryLabel(entry) +
                    (entry.available ? "" : " — Unavailable"), isCursor ? "✓ Current cursor" : "");
                rows.push(row);
                row.addEventListener("keydown", function (event) {
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                    if (event.preventDefault) event.preventDefault();
                    focusPickerRow(rows, rows.indexOf(row), event.key);
                });
                configuredPicker.list.appendChild(row);
            });
            configuredPicker.optionRows = rows;
            if (rows.length === 0) appendPickerEmpty(configuredPicker,
                configured.length === 0 ? "No configured presets." : "No configured presets match this search.");
            const focusRow = rows.find(function (row) { return row.dataset.uuid === activeUuid; });
            if (focusRow) focusElement(focusRow);
        }

        function configuredUuidSet() {
            const configuredUuids = new Set(draft.map(function (entry) { return entry.uuid; }));
            if (state && state.configuration && Array.isArray(state.configuration.presets)) {
                state.configuration.presets.forEach(function (entry) { configuredUuids.add(entry.uuid); });
            }
            return configuredUuids;
        }

        function reconcileSelectedInventoryUuids() {
            const configuredUuids = configuredUuidSet();
            const inventory = state && Array.isArray(state.inventory) ? state.inventory : [];
            const inventoryUuids = new Set(inventory.map(function (item) { return item.uuid; }));
            selectedInventoryUuids.forEach(function (uuid) {
                if (configuredUuids.has(uuid) ||
                    (inventorySnapshotLoaded(state) && !inventoryUuids.has(uuid))) {
                    selectedInventoryUuids.delete(uuid);
                }
            });
            return configuredUuids;
        }

        function updateInventoryPickerAction() {
            if (!inventoryPicker || !inventoryPicker.addSelectedButton) return;
            inventoryPicker.addSelectedButton.disabled = selectedInventoryUuids.size === 0 || inventoryRefreshInFlight;
            inventoryPicker.selectionCount.textContent = selectedInventoryUuids.size +
                (selectedInventoryUuids.size === 1 ? " preset selected" : " presets selected");
        }

        function renderInventoryPicker(force) {
            if (!inventoryPicker || !inventoryPicker.open || !state) return;
            const inventory = Array.isArray(state.inventory) ? state.inventory : [];
            const configuredUuids = reconcileSelectedInventoryUuids();
            const signature = [
                inventorySearch,
                inventoryRefreshInFlight ? "loading" : state.inventoryStatus,
                inventorySnapshotLoaded(state) ? "loaded" : "not-loaded",
                state.inventoryError || "",
                Array.from(selectedInventoryUuids).sort().join("\u001f"),
                Array.from(configuredUuids).sort().join("\u001f"),
                inventory.map(function (item) { return [item.uuid, item.folder, item.name].join("\u001f"); }).join("\u001e")
            ].join("\u001d");
            if (!force && inventoryPicker.renderSignature === signature) {
                updateInventoryPickerAction();
                return;
            }
            inventoryPicker.renderSignature = signature;
            inventoryPicker.searchInput.value = inventorySearch;
            const activeUuid = document.activeElement && document.activeElement.dataset
                ? document.activeElement.dataset.uuid : null;
            inventoryPicker.list.textContent = "";
            const search = normalizedSearch(inventorySearch);
            const rows = [];
            let lastFolder = null;
            inventory.filter(function (item) { return matchesSearch(item, search); }).forEach(function (item) {
                if (item.folder !== lastFolder) {
                    lastFolder = item.folder;
                    const folder = document.createElement("div");
                    folder.className = "develop-preset-picker-folder";
                    folder.setAttribute("role", "presentation");
                    folder.textContent = item.folder;
                    inventoryPicker.list.appendChild(folder);
                }
                const isConfigured = configuredUuids.has(item.uuid);
                const isSelected = selectedInventoryUuids.has(item.uuid);
                const row = makeButton("", "develop-preset-picker-option" +
                    (isSelected ? " selected" : "") + (isConfigured ? " configured" : ""), function () {
                    if (isConfigured || inventoryRefreshInFlight) return;
                    if (selectedInventoryUuids.has(item.uuid)) selectedInventoryUuids.delete(item.uuid);
                    else selectedInventoryUuids.add(item.uuid);
                    inventoryPicker.renderSignature = null;
                    renderInventoryPicker(true);
                });
                row.dataset.uuid = item.uuid;
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", String(isSelected));
                row.setAttribute("aria-label", inventoryLabel(item) +
                    (isConfigured ? ", already configured" : isSelected ? ", selected" : ""));
                row.disabled = isConfigured || inventoryRefreshInFlight;
                appendPickerOptionContent(row, item.name, item.folder,
                    isConfigured ? "✓ Configured" : isSelected ? "✓ Selected" : "");
                rows.push(row);
                row.addEventListener("keydown", function (event) {
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                    if (event.preventDefault) event.preventDefault();
                    focusPickerRow(rows, rows.indexOf(row), event.key);
                });
                inventoryPicker.list.appendChild(row);
            });
            inventoryPicker.optionRows = rows;
            if (rows.length === 0) {
                const message = !inventorySnapshotLoaded(state) || inventoryRefreshInFlight ||
                    state.inventoryStatus === "loading" || state.inventoryStatus === "error"
                    ? inventoryLifecycleMessage(state)
                    : inventory.length === 0 ? "No Lightroom presets are available."
                        : "No Lightroom presets match this search.";
                appendPickerEmpty(inventoryPicker, message);
            }
            updateInventoryPickerAction();
            const focusRow = rows.find(function (row) { return row.dataset.uuid === activeUuid; });
            if (focusRow) focusElement(focusRow);
        }

        function addSelectedInventoryPresets() {
            if (!state || inventoryRefreshInFlight || selectedInventoryUuids.size === 0) return;
            const inventory = Array.isArray(state.inventory) ? state.inventory : [];
            let added = 0;
            inventory.forEach(function (item) {
                if (selectedInventoryUuids.has(item.uuid) && addDraftEntry(draft, item.uuid)) added += 1;
            });
            if (added === 0) {
                setManagerMessage("Error: select at least one preset that is not already configured.", "error");
                return;
            }
            selectedInventoryUuids.clear();
            updateDraftDirtyState();
            closePicker(inventoryPicker, true);
            setManagerMessage(added + (added === 1 ? " preset added" : " presets added") +
                ". Choose Save Changes to keep the new order.", "info");
            renderManager(true, true);
        }

        function currentCursorEntry() {
            if (!state || !Array.isArray(state.configured)) return false;
            return state.configured.find(function (entry) { return entry.uuid === state.cursorUuid; }) || null;
        }

        function currentCursorAllowsAmount() {
            const cursor = currentCursorEntry();
            return !!cursor && cursor.amountEnabled === true;
        }

        function amountFeedback() {
            const feedback = state && state.amountFeedback;
            if (!feedback || feedback.available !== true || !Number.isSafeInteger(feedback.id) ||
                parsePresetAmount(feedback.value) === null || !feedback.range ||
                !Number.isFinite(feedback.range.min) || !Number.isFinite(feedback.range.max) ||
                feedback.range.min >= feedback.range.max || feedback.value < feedback.range.min ||
                feedback.value > feedback.range.max) return null;
            return feedback;
        }

        function committedAmount() {
            const feedback = amountFeedback();
            return feedback ? Number(feedback.value) : null;
        }

        function showLocalAmount(amount) {
            if (parsePresetAmount(amount) === null) return false;
            const feedback = amountFeedback();
            const minimum = feedback ? feedback.range.min : 0;
            const maximum = feedback ? feedback.range.max : 200;
            desiredAmount = Number(amount);
            if (amountRange) {
                amountRange.min = String(minimum);
                amountRange.max = String(maximum);
                amountRange.value = String(desiredAmount);
                const progress = maximum > minimum
                    ? ((desiredAmount - minimum) / (maximum - minimum)) * 100
                    : 0;
                amountRange.style.setProperty("--slider-progress", progress + "%");
                amountRange.setAttribute("aria-valuenow", String(desiredAmount));
                amountRange.setAttribute("aria-valuemin", String(minimum));
                amountRange.setAttribute("aria-valuemax", String(maximum));
            }
            if (amountNumber && !amountEditing) amountNumber.value = String(desiredAmount);
            if (amountDecrementButton && amountRange) {
                amountDecrementButton.disabled = amountRange.disabled || desiredAmount <= minimum;
            }
            if (amountIncrementButton && amountRange) {
                amountIncrementButton.disabled = amountRange.disabled || desiredAmount >= maximum;
            }
            return true;
        }

        function amountBindingSnapshot() {
            const context = currentContext();
            const feedback = amountFeedback();
            return {
                activeModule: context.activeModule,
                selectedPhotoUuid: context.selectedPhotoUuid,
                contextCounter: context.contextCounter,
                developCounter: context.developCounter,
                contextChangedAt: context.contextChangedAt,
                presetUuid: state ? state.cursorUuid : null,
                serverEpoch: state ? state.serverEpoch : null,
                feedbackId: feedback ? feedback.id : null
            };
        }

        function stableAmountBindingMatches(binding) {
            const context = currentContext();
            return !!binding && context.activeModule === "develop" &&
                context.selectedPhotoUuid === binding.selectedPhotoUuid &&
                context.contextCounter === binding.contextCounter &&
                context.contextChangedAt === binding.contextChangedAt &&
                state && state.cursorUuid === binding.presetUuid &&
                state.serverEpoch === binding.serverEpoch && currentCursorAllowsAmount();
        }

        function amountBusy() {
            return activeAmountRequest !== null || queuedAmount !== null ||
                amountThrottleTimer !== null || awaitingAmountFeedback !== null;
        }

        function cancelAmountWork(restoreAuthoritative) {
            amountGeneration += 1;
            if (amountThrottleTimer !== null) clearTimeout(amountThrottleTimer);
            amountThrottleTimer = null;
            queuedAmount = null;
            queuedAmountRevision = 0;
            activeAmountRequest = null;
            awaitingAmountFeedback = null;
            if (restoreAuthoritative && committedAmount() !== null) showLocalAmount(committedAmount());
        }

        function admittedAmountCommandMatches(data, record) {
            const command = data && data.queued;
            return data && data.ok === true && Number.isSafeInteger(data.feedbackRequestId) &&
                data.feedbackRequestId > 0 && command && command.command === "develop_preset.amount.set" &&
                command.presetAmount === record.amount &&
                command.expectedPresetUuid === record.presetUuid &&
                command.expectedSelectedPhotoUuid === record.selectedPhotoUuid &&
                command.expectedContextCounter === record.contextCounter &&
                command.expectedDevelopCounter >= record.developCounter &&
                command.expectedContextChangedAt === record.contextChangedAt &&
                command.expectedServerEpoch === record.serverEpoch &&
                command.expectedFeedbackId >= record.feedbackId;
        }

        async function dispatchPendingAmount() {
            if (!rootElement || queuedAmount === null || activeAmountRequest !== null ||
                awaitingAmountFeedback !== null ||
                !state || state.pendingApplication === true || applicationRequestInFlight ||
                !contextReady() || !currentCursorAllowsAmount()) return false;
            const feedback = amountFeedback();
            if (!feedback) {
                queuedAmount = null;
                setStatus("Could not update Amount. Please try again.");
                renderCompact();
                return false;
            }
            const binding = amountBindingSnapshot();
            if (!stableAmountBindingMatches(binding)) return false;
            const amount = queuedAmount;
            const intentRevision = queuedAmountRevision;
            queuedAmount = null;
            queuedAmountRevision = 0;
            const record = Object.assign({
                generation: amountGeneration,
                amount: amount,
                intentRevision: intentRevision,
                submittedAt: Date.now()
            }, binding);
            activeAmountRequest = record;
            renderCompact();
            setStatus("Updating Amount…");
            try {
                const response = await fetchRequest(amountPath(amount, feedback.id), { cache: "no-store" });
                const data = await response.json();
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || "Native Lightroom Preset Amount was rejected");
                }
                if (activeAmountRequest !== record || record.generation !== amountGeneration) return false;
                if (!admittedAmountCommandMatches(data, record)) {
                    throw new Error("Native Preset Amount admission returned mismatched context");
                }
                awaitingAmountFeedback = Object.assign({}, binding, {
                    target: amount,
                    intentRevision: intentRevision,
                    minimumFeedbackId: data.feedbackRequestId,
                    submittedAt: record.submittedAt
                });
                return true;
            } catch (err) {
                if (activeAmountRequest === record && record.generation === amountGeneration) {
                    awaitingAmountFeedback = null;
                    if (queuedAmount === null && committedAmount() !== null) showLocalAmount(committedAmount());
                    setStatus("Could not update Amount. Please try again.");
                }
                return false;
            } finally {
                if (activeAmountRequest === record) activeAmountRequest = null;
                if (rootElement) {
                    await refreshState();
                    if (queuedAmount !== null && activeAmountRequest === null) dispatchPendingAmount();
                    else renderCompact();
                }
            }
        }

        function queueAmount(amount, immediate) {
            const parsed = parsePresetAmount(amount);
            const feedback = amountFeedback();
            if (parsed === null || !feedback || parsed < feedback.range.min || parsed > feedback.range.max ||
                !contextReady() || !currentCursorAllowsAmount() || !state ||
                state.controlsEnabled !== true || state.pendingApplication === true ||
                applicationRequestInFlight) return false;
            if (desiredAmount !== parsed) amountIntentRevision += 1;
            showLocalAmount(parsed);
            if (queuedAmount === parsed) {
                if (immediate && activeAmountRequest === null) {
                    if (amountThrottleTimer !== null) clearTimeout(amountThrottleTimer);
                    amountThrottleTimer = null;
                    dispatchPendingAmount();
                }
                return true;
            }
            if ((queuedAmount === null && activeAmountRequest && activeAmountRequest.amount === parsed) ||
                (queuedAmount === null && !activeAmountRequest && awaitingAmountFeedback &&
                    awaitingAmountFeedback.target === parsed)) return true;
            queuedAmount = parsed;
            queuedAmountRevision = amountIntentRevision;
            if (amountThrottleTimer !== null) clearTimeout(amountThrottleTimer);
            amountThrottleTimer = null;
            if (activeAmountRequest !== null) {
                renderCompact();
            } else if (immediate) {
                dispatchPendingAmount();
            } else {
                amountThrottleTimer = setTimeout(function () {
                    amountThrottleTimer = null;
                    dispatchPendingAmount();
                }, 120);
            }
            return true;
        }

        function submitPreset(path) {
            cancelAmountWork(true);
            return submit(path);
        }

        function commitAmountNumber() {
            if (!amountNumber) return false;
            const amount = parsePresetAmount(amountNumber.value);
            amountEditing = false;
            if (amount === null) {
                if (committedAmount() !== null) showLocalAmount(committedAmount());
                else amountNumber.value = "100";
                setStatus("Could not update Amount. Please try again.");
                renderCompact();
                return false;
            }
            return queueAmount(amount, true);
        }

        function stepAmount(direction) {
            const feedback = amountFeedback();
            const base = parsePresetAmount(desiredAmount) !== null ? desiredAmount : committedAmount();
            if (!feedback || base === null) return false;
            return queueAmount(Math.max(feedback.range.min,
                Math.min(feedback.range.max, base + direction)), true);
        }

        function reconcileAmountState(nextState) {
            const feedback = amountFeedback();
            if (awaitingAmountFeedback && !stableAmountBindingMatches(awaitingAmountFeedback)) {
                awaitingAmountFeedback = null;
            }
            if (awaitingAmountFeedback && feedback &&
                feedback.id >= awaitingAmountFeedback.minimumFeedbackId) {
                if (feedback.value === awaitingAmountFeedback.target) {
                    const settledRevision = awaitingAmountFeedback.intentRevision;
                    awaitingAmountFeedback = null;
                    setStatus("Amount updated.");
                    if (queuedAmount !== null && queuedAmount === feedback.value &&
                        queuedAmountRevision > settledRevision) {
                        queuedAmount = null;
                        queuedAmountRevision = 0;
                    }
                } else if (activeAmountRequest === null && queuedAmount === null &&
                    Date.now() - awaitingAmountFeedback.submittedAt > 2500) {
                    awaitingAmountFeedback = null;
                    setStatus("Could not update Amount. Please try again.");
                }
            }
            if (!amountEditing && !amountDragging && activeAmountRequest === null &&
                queuedAmount === null && amountThrottleTimer === null && awaitingAmountFeedback === null &&
                nextState.pendingApplication !== true) {
                showLocalAmount(feedback ? feedback.value : 100);
            }
        }

        const amountUnavailableMessage =
            "Amount slider unavailable: Make sure it is enabled under Preset Options. If enabled, Lightroom Classic does not support it for this preset.";

        function renderAmountUnavailableMessage() {
            const emphasizedPrefix = "Amount slider unavailable:";
            const emphasis = document.createElement("span");
            emphasis.className = "develop-preset-amount-unavailable-emphasis";
            emphasis.textContent = emphasizedPrefix;
            const suffix = document.createElement("span");
            suffix.textContent = amountUnavailableMessage.slice(emphasizedPrefix.length);
            amountCapabilityNote.textContent = "";
            amountCapabilityNote.append(emphasis, suffix);
        }

        function renderAmount(cursor, pending) {
            if (!amountRange || !amountNumber) return;
            const feedback = amountFeedback();
            const committed = committedAmount();
            if (!amountEditing && !amountDragging && !amountBusy() && !pending) {
                showLocalAmount(committed === null ? 100 : committed);
            } else if (desiredAmount === null) {
                showLocalAmount(committed === null ? 100 : committed);
            }
            const enabled = !!cursor && cursor.available === true && feedback !== null &&
                state.controlsEnabled === true && cursor.amountEnabled === true &&
                contextReady() && !pending;
            amountRange.disabled = !enabled;
            amountNumber.disabled = !enabled;
            const minimum = feedback ? feedback.range.min : 0;
            const maximum = feedback ? feedback.range.max : 200;
            amountDecrementButton.disabled = !enabled || desiredAmount <= minimum;
            amountIncrementButton.disabled = !enabled || desiredAmount >= maximum;
            amountResetButton.disabled = !enabled || 100 < minimum || 100 > maximum;
            amountNumber.setAttribute("aria-invalid", String(amountEditing &&
                parsePresetAmount(amountNumber.value) === null));
            if (amountCapabilityNote) {
                if (cursor && cursor.amountEnabled !== true) {
                    renderAmountUnavailableMessage();
                } else if (cursor && cursor.amountEnabled === true && feedback !== null) {
                    amountCapabilityNote.textContent =
                        "Adjust the strength of this preset.";
                } else if (cursor && cursor.amountEnabled === true && state.amountFeedback &&
                    state.amountFeedback.available === false && Number.isSafeInteger(state.amountFeedback.id)) {
                    renderAmountUnavailableMessage();
                } else if (cursor && cursor.amountEnabled === true) {
                    amountCapabilityNote.textContent = "Checking Amount availability…";
                } else {
                    amountCapabilityNote.textContent = "Choose an available configured preset to use Amount.";
                }
            }
        }

        function renderCompact() {
            if (!rootElement || !state) return;
            rootElement.dataset.inventoryStatus = inventoryRefreshInFlight ? "loading" : state.inventoryStatus;
            rootElement.dataset.inventoryLoaded = String(inventorySnapshotLoaded(state));
            const configured = Array.isArray(state.configured) ? state.configured : [];
            const cursor = configured.find(function (entry) { return entry.uuid === state.cursorUuid; }) || null;
            const presetPending = state.pendingApplication === true || applicationRequestInFlight;
            const pending = presetPending || amountBusy();
            const enabled = state.controlsEnabled === true && contextReady() && !pending;

            currentPresetPrimary.textContent = cursor ? primaryLabel(cursor) : "No preset available";
            currentPresetSecondary.textContent = cursor ? secondaryLabel(cursor) +
                (cursor.available ? "" : " — Unavailable") : "Open Manage Favorite Presets to configure favorites";
            currentPresetButton.disabled = configured.length === 0 || pending;
            currentPresetButton.setAttribute("aria-label", cursor
                ? "Selected preset: " + displayLabel(cursor) + ". Open favorite preset picker."
                : "Selected preset: none configured");
            previousButton.disabled = !enabled;
            nextButton.disabled = !enabled;
            renderAmount(cursor, presetPending);
            renderConfiguredPicker(false);

            if (inventoryRefreshInFlight || state.inventoryStatus === "loading" ||
                state.inventoryStatus === "not-loaded" || state.inventoryStatus === "error" ||
                inventoryRefreshError) {
                compactStatus.textContent = inventoryLifecycleMessage(state);
            } else if (state.availableCount === 0) {
                compactStatus.textContent = configured.length === 0
                    ? "No favorite presets yet. Open Manage Favorite Presets to add some."
                    : "None of your favorite presets is currently available in Lightroom.";
            } else if (!contextReady()) {
                compactStatus.textContent = "Select one photo in Lightroom's Develop module to apply a preset.";
            } else if (presetPending) {
                compactStatus.textContent = "Applying preset…";
            } else if (amountBusy()) {
                compactStatus.textContent = "Updating Amount…";
            } else if (state.lastApplication && state.lastApplication.outcome) {
                compactStatus.textContent = state.lastApplication.outcome === "failed" ||
                    state.lastApplication.outcome === "stale/rejected"
                    ? "Could not apply the preset. Please try again."
                    : "Preset applied.";
                if (pendingPresetStatusOperationId &&
                    state.lastApplication.operationId === pendingPresetStatusOperationId) {
                    setStatus(compactStatus.textContent);
                    pendingPresetStatusOperationId = null;
                }
            } else {
                compactStatus.textContent = "Choose a favorite preset to apply.";
            }
        }

        function configuredRowForElement(element) {
            let current = element;
            while (current && current !== configuredList) {
                if (current.dataset && typeof current.dataset.uuid === "string") return current;
                current = current.parentElement;
            }
            return null;
        }

        function descendantWithFocusKey(element, focusKey) {
            if (!element) return null;
            if (element.dataset && element.dataset.focusKey === focusKey) return element;
            for (const child of Array.from(element.children || [])) {
                const match = descendantWithFocusKey(child, focusKey);
                if (match) return match;
            }
            return null;
        }

        function captureConfiguredEditorState() {
            const active = document.activeElement;
            const row = configuredRowForElement(active);
            return {
                uuid: row && row.dataset ? row.dataset.uuid : null,
                rowIndex: row ? Array.prototype.indexOf.call(configuredList.children, row) : -1,
                focusKey: active && active.dataset ? active.dataset.focusKey : null,
                selectionStart: active && Number.isInteger(active.selectionStart) ? active.selectionStart : null,
                selectionEnd: active && Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
                inputScrollLeft: active && Number.isFinite(active.scrollLeft) ? active.scrollLeft : null,
                listScrollTop: Number.isFinite(configuredList.scrollTop) ? configuredList.scrollTop : 0,
                listScrollLeft: Number.isFinite(configuredList.scrollLeft) ? configuredList.scrollLeft : 0
            };
        }

        function restoreConfiguredEditorState(captured) {
            if (!captured) return;
            configuredList.scrollTop = captured.listScrollTop;
            configuredList.scrollLeft = captured.listScrollLeft;
            if (!captured.focusKey) return;
            const rows = Array.from(configuredList.children || []).filter(function (row) {
                return row.dataset && typeof row.dataset.uuid === "string";
            });
            let row = rows.find(function (candidate) { return candidate.dataset.uuid === captured.uuid; }) || null;
            if (!row && rows.length > 0) row = rows[Math.max(0, Math.min(captured.rowIndex, rows.length - 1))];
            const target = descendantWithFocusKey(row, captured.focusKey);
            if (!target) return;
            focusElement(target);
            if (captured.selectionStart !== null && captured.selectionEnd !== null) {
                if (typeof target.setSelectionRange === "function") {
                    target.setSelectionRange(captured.selectionStart, captured.selectionEnd);
                } else {
                    target.selectionStart = captured.selectionStart;
                    target.selectionEnd = captured.selectionEnd;
                }
            }
            if (captured.inputScrollLeft !== null) target.scrollLeft = captured.inputScrollLeft;
            configuredList.scrollTop = captured.listScrollTop;
            configuredList.scrollLeft = captured.listScrollLeft;
        }

        function createPresetOptionToggle(entry, propertyName, focusKey, titleText, helpText, ariaLabel) {
            const toggle = makeButton("", "develop-preset-option-toggle", function () {
                entry[propertyName] = entry[propertyName] !== true;
                toggle.setAttribute("aria-checked", String(entry[propertyName]));
                toggle.className = "develop-preset-option-toggle" + (entry[propertyName] ? " enabled" : "");
                updateDraftDirtyState();
            });
            toggle.setAttribute("role", "switch");
            toggle.setAttribute("aria-checked", String(entry[propertyName] === true));
            toggle.setAttribute("aria-label", ariaLabel);
            toggle.className += entry[propertyName] === true ? " enabled" : "";
            toggle.dataset.focusKey = focusKey;
            const track = document.createElement("span");
            track.className = "develop-preset-option-track";
            track.setAttribute("aria-hidden", "true");
            const thumb = document.createElement("span");
            thumb.className = "develop-preset-option-thumb";
            track.appendChild(thumb);
            const copy = document.createElement("span");
            copy.className = "develop-preset-option-copy";
            const title = document.createElement("span");
            title.className = "develop-preset-option-title";
            title.textContent = titleText;
            const help = document.createElement("span");
            help.className = "develop-preset-option-help";
            help.textContent = helpText;
            copy.append(title, help);
            toggle.append(track, copy);
            return toggle;
        }

        function renderConfiguredList() {
            const inventory = state && Array.isArray(state.inventory) ? state.inventory : [];
            const inventoryByUuid = new Map(inventory.map(function (item) { return [item.uuid, item]; }));
            const snapshotLoaded = inventorySnapshotLoaded(state);
            const captured = captureConfiguredEditorState();
            configuredList.textContent = "";
            if (draft.length === 0) {
                const empty = document.createElement("div");
                empty.className = "develop-preset-config-empty";
                empty.textContent = "No Develop presets configured.";
                configuredList.appendChild(empty);
                configuredListRendered = true;
                restoreConfiguredEditorState(captured);
                return;
            }

            draft.forEach(function (entry, index) {
                const item = inventoryByUuid.get(entry.uuid) || null;
                const missing = snapshotLoaded && !item;
                const unresolvedFolder = inventoryRefreshInFlight || (state && state.inventoryStatus === "loading")
                    ? "Loading inventory…"
                    : state && state.inventoryStatus === "error" ? "Refresh failed" : "Inventory not loaded";
                const row = document.createElement("div");
                row.className = "develop-preset-config-row" + (missing ? " unavailable" : "");
                row.dataset.uuid = entry.uuid;
                appendTextField(row, "Preset", item ? item.name : entry.uuid + (missing ? " (missing UUID)" : ""), "preset");
                appendTextField(row, "Folder", item ? item.folder : missing ? "Unavailable" : unresolvedFolder, "folder");

                const aliasField = document.createElement("label");
                aliasField.className = "develop-preset-config-field alias";
                const aliasLabel = document.createElement("span");
                aliasLabel.className = "develop-preset-config-field-label";
                aliasLabel.textContent = "Alias (optional)";
                const alias = document.createElement("input");
                alias.type = "text";
                alias.maxLength = 160;
                alias.placeholder = "Optional alias";
                alias.value = entry.alias;
                alias.dataset.focusKey = "alias";
                alias.setAttribute("aria-label", "Optional alias for " + (item ? inventoryLabel(item) : entry.uuid));
                alias.addEventListener("input", function () {
                    entry.alias = alias.value;
                    updateDraftDirtyState();
                });
                aliasField.append(aliasLabel, alias);
                row.appendChild(aliasField);

                const optionBlock = document.createElement("div");
                optionBlock.className = "develop-preset-config-options-block";
                const optionsHeading = document.createElement("div");
                optionsHeading.className = "develop-preset-options-heading";
                optionsHeading.textContent = "Preset options";
                const optionFields = document.createElement("div");
                optionFields.className = "develop-preset-config-options";
                const itemLabel = item ? inventoryLabel(item) : entry.uuid;
                const aiSwitch = createPresetOptionToggle(entry, "updateAISettings", "update-ai",
                    "AI adjustments", "Enable this if you apply an Adaptive or AI preset and the preset does not visibly affect the photo.",
                    "AI adjustments for " + itemLabel);
                const amountSwitch = createPresetOptionToggle(entry, "amountEnabled", "amount-enabled",
                    "Amount slider", "Enable the Amount slider for this preset. Leave it disabled if Lightroom does not show an Amount slider for this preset.",
                    "Amount slider for " + itemLabel);
                optionFields.append(aiSwitch, amountSwitch);
                optionBlock.append(optionsHeading, optionFields);
                row.appendChild(optionBlock);

                const actions = document.createElement("div");
                actions.className = "develop-preset-config-actions";
                const moveUp = makeButton("Move Up", "secondary", function () {
                    if (moveDraftEntry(draft, index, -1)) {
                        updateDraftDirtyState();
                        setManagerMessage("Order changed. Choose Save Changes to keep it.", "info");
                        renderManager(true, true);
                    }
                });
                moveUp.dataset.focusKey = "move-up";
                moveUp.disabled = index === 0;
                const moveDown = makeButton("Move Down", "secondary", function () {
                    if (moveDraftEntry(draft, index, 1)) {
                        updateDraftDirtyState();
                        setManagerMessage("Order changed. Choose Save Changes to keep it.", "info");
                        renderManager(true, true);
                    }
                });
                moveDown.dataset.focusKey = "move-down";
                moveDown.disabled = index === draft.length - 1;
                const remove = makeButton("Remove", "danger", function () {
                    if (removeDraftEntry(draft, index)) {
                        updateDraftDirtyState();
                        setManagerMessage("Preset removed. Choose Save Changes to keep it.", "info");
                        renderManager(true, true);
                    }
                });
                remove.dataset.focusKey = "remove";
                actions.append(moveUp, moveDown, remove);
                row.appendChild(actions);

                if (missing) {
                    const error = document.createElement("div");
                    error.className = "develop-preset-config-error";
                    error.textContent = "Unavailable: this configured UUID was not found in the current Lightroom inventory.";
                    row.appendChild(error);
                }
                configuredList.appendChild(row);
            });
            configuredListRendered = true;
            restoreConfiguredEditorState(captured);
        }

        function renderManager(preserveMessage, rebuildConfiguredList) {
            if (!managerPanel || !state) return;
            syncManagerToolbar();
            if (rebuildConfiguredList === true || !configuredListRendered) renderConfiguredList();
            renderInventoryPicker(false);
            if (!preserveMessage && state.configurationError) {
                setManagerMessage("Could not load preset settings. Please review the saved configuration.", "state-error");
            } else if (!preserveMessage) {
                const inventoryKind = state.inventoryStatus === "error" || inventoryRefreshError
                    ? "state-error" : state.inventoryStatus === "ready" ? "success" : "info";
                setManagerMessage(inventoryLifecycleMessage(state), inventoryKind);
            }
        }

        function validAmountFeedbackSnapshot(feedback) {
            if (!feedback || typeof feedback !== "object" || Array.isArray(feedback) ||
                typeof feedback.available !== "boolean") return false;
            if (feedback.available === false) {
                return (feedback.id === null || (Number.isSafeInteger(feedback.id) && feedback.id > 0)) &&
                    feedback.value === null && feedback.range === null;
            }
            return Number.isSafeInteger(feedback.id) && feedback.id > 0 &&
                parsePresetAmount(feedback.value) !== null && feedback.range &&
                Number.isFinite(feedback.range.min) && Number.isFinite(feedback.range.max) &&
                feedback.range.min >= 0 && feedback.range.max <= 200 &&
                feedback.range.min < feedback.range.max &&
                feedback.value >= feedback.range.min && feedback.value <= feedback.range.max;
        }

        function amountFeedbackBinding(nextState) {
            const context = currentContext();
            return [
                nextState.serverEpoch,
                nextState.cursorUuid || "",
                context.selectedPhotoUuid || "",
                Number.isSafeInteger(context.contextCounter) ? context.contextCounter : "",
                Number.isSafeInteger(context.contextChangedAt) ? context.contextChangedAt : ""
            ].join("|");
        }

        function acceptServerState(nextState, optionsForState) {
            optionsForState = optionsForState || {};
            const requestGeneration = optionsForState.requestGeneration;
            if (!nextState || typeof nextState.serverEpoch !== "string" || nextState.serverEpoch.length === 0 ||
                !Number.isSafeInteger(nextState.stateRevision) || nextState.stateRevision < 0 ||
                !Number.isSafeInteger(requestGeneration) || requestGeneration <= 0 ||
                !validAmountFeedbackSnapshot(nextState.amountFeedback)) return false;
            const sameEpoch = acceptedServerEpoch === nextState.serverEpoch;
            if (sameEpoch && (nextState.stateRevision < acceptedStateRevision ||
                requestGeneration < acceptedStateRequestGeneration)) return false;
            if (acceptedServerEpoch !== null && !sameEpoch &&
                requestGeneration < acceptedStateRequestGeneration) return false;
            if (acceptedServerEpoch !== null && !sameEpoch) {
                cancelAmountWork(false);
                desiredAmount = null;
                acceptedStateRevision = -1;
            }
            const nextAmountBinding = amountFeedbackBinding(nextState);
            if (acceptedAmountFeedbackBinding !== nextAmountBinding) {
                acceptedAmountFeedbackBinding = nextAmountBinding;
                acceptedAmountFeedbackId = 0;
            }
            if (nextState.amountFeedback.available === true &&
                nextState.amountFeedback.id < acceptedAmountFeedbackId && state &&
                amountFeedbackBinding(state) === nextAmountBinding &&
                validAmountFeedbackSnapshot(state.amountFeedback)) {
                nextState = Object.assign({}, nextState, {
                    amountFeedback: state.amountFeedback,
                    presetAmount: state.presetAmount
                });
            } else if (nextState.amountFeedback.available === true) {
                acceptedAmountFeedbackId = Math.max(acceptedAmountFeedbackId, nextState.amountFeedback.id);
            }
            if (awaitingAmountFeedback) {
                const nextCursor = Array.isArray(nextState.configured)
                    ? nextState.configured.find(function (entry) { return entry.uuid === nextState.cursorUuid; })
                    : null;
                if (nextState.serverEpoch !== awaitingAmountFeedback.serverEpoch ||
                    nextState.cursorUuid !== awaitingAmountFeedback.presetUuid ||
                    !nextCursor || nextCursor.amountEnabled !== true) {
                    cancelAmountWork(false);
                }
            }
            acceptedServerEpoch = nextState.serverEpoch;
            acceptedStateRevision = Math.max(acceptedStateRevision, nextState.stateRevision);
            acceptedStateRequestGeneration = Math.max(acceptedStateRequestGeneration, requestGeneration);
            state = nextState;
            if (state.inventoryStatus === "ready") inventoryRefreshError = null;
            else if (state.inventoryStatus === "error" && state.inventoryError) {
                inventoryRefreshError = state.inventoryError;
            }
            reconcileAmountState(state);
            if (managerStatus && managerStatus.dataset.kind === "state-error" &&
                !state.configurationError && state.inventoryStatus !== "error") {
                setManagerMessage("", "info");
            }
            let replacedDraft = false;
            if (optionsForState.replaceDraft === true || !draftInitialized) {
                draft = createDraft(state.configuration && state.configuration.presets);
                draftInitialized = true;
                draftDirty = false;
                replacedDraft = true;
            } else {
                draftDirty = draftDiffersFromSavedConfiguration();
            }
            reconcileSelectedInventoryUuids();
            renderCompact();
            syncManagerToolbar();
            if (optionsForState.renderManager === true || replacedDraft) {
                renderManager(false, optionsForState.rebuildConfiguredList === true || replacedDraft);
            } else {
                renderInventoryPicker(false);
            }
            if (queuedAmount !== null && activeAmountRequest === null && awaitingAmountFeedback === null &&
                amountThrottleTimer === null) {
                Promise.resolve().then(dispatchPendingAmount);
            }
            return true;
        }

        async function fetchState() {
            const requestGeneration = nextStateRequestGeneration();
            const response = await fetchRequest("/api/develop-presets/state", { cache: "no-store" });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset state is unavailable");
            return { data: data, requestGeneration: requestGeneration };
        }

        function unavailableState(message) {
            const loaded = inventorySnapshotLoaded(state);
            const configured = state && Array.isArray(state.configured) ? state.configured.map(function (entry) {
                return loaded ? Object.assign({}, entry) : Object.assign({}, entry, {
                    available: false,
                    missing: false,
                    error: null
                });
            }) : draft.map(function (entry) {
                return Object.assign({ folder: null, name: null, available: false, missing: false, error: null },
                    cloneEntry(entry));
            });
            return {
                ok: false,
                configuration: configurationFromDraft(draft),
                configurationError: null,
                inventory: loaded && state && Array.isArray(state.inventory) ? state.inventory.slice() : [],
                inventoryStatus: "error",
                inventoryError: message,
                inventoryRefreshedAt: loaded ? state.inventoryRefreshedAt : null,
                inventoryLoaded: loaded,
                configured: configured,
                availableCount: loaded && state ? state.availableCount : 0,
                serverEpoch: state ? state.serverEpoch : null,
                stateRevision: state && Number.isSafeInteger(state.stateRevision) ? state.stateRevision : 0,
                cursorUuid: state ? state.cursorUuid : null,
                cursorAmountEnabled: false,
                presetAmount: null,
                amountFeedback: { id: null, available: false, value: null, range: null, receivedAt: null },
                controlsEnabled: false,
                pendingApplication: false,
                pendingOperation: null,
                lastApplication: state ? state.lastApplication : null
            };
        }

        async function refreshState() {
            const activeGeneration = generation;
            try {
                const result = await fetchState();
                if (activeGeneration !== generation || !rootElement) return null;
                return acceptServerState(result.data, { requestGeneration: result.requestGeneration })
                    ? result.data
                    : state;
            } catch (err) {
                if (activeGeneration !== generation || !rootElement) return null;
                state = unavailableState(err.message);
                renderCompact();
                renderManager();
                setManagerMessage("Could not load preset settings. Please try again.", "state-error");
                return null;
            }
        }

        async function submit(path, submissionOptions) {
            submissionOptions = submissionOptions || {};
            if (!contextReady() || !state || state.controlsEnabled !== true ||
                state.pendingApplication || applicationRequestInFlight || amountBusy()) return false;
            applicationRequestInFlight = true;
            renderCompact();
            setStatus("Applying preset…");
            try {
                const response = await fetchRequest(path, { cache: "no-store" });
                const data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset application was rejected");
                if (typeof submissionOptions.onAccepted === "function") submissionOptions.onAccepted(data);
                pendingPresetStatusOperationId = typeof data.operationId === "string" ? data.operationId : null;
                return data;
            } catch (err) {
                pendingPresetStatusOperationId = null;
                setStatus("Could not apply the preset. Please try again.");
                return false;
            } finally {
                applicationRequestInFlight = false;
                await refreshState();
            }
        }

        function wait(milliseconds) {
            return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
        }

        function refreshInventory() {
            if (inventoryRefreshPromise) return inventoryRefreshPromise;
            const activeGeneration = generation;
            inventoryRefreshInFlight = true;
            inventoryRefreshError = null;
            setManagerMessage(inventoryLifecycleMessage(state), "info");
            renderCompact();
            renderManager(true);
            const operation = (async function () {
                try {
                    const initialRequestGeneration = nextStateRequestGeneration();
                    const response = await fetchRequest("/api/develop-presets/inventory/refresh", { cache: "no-store" });
                    let data = await response.json();
                    if (!response.ok || !data.ok) {
                        throw new Error(data.error || "Develop preset inventory refresh was rejected");
                    }
                    if (activeGeneration !== generation || !rootElement) return false;
                    if (!acceptServerState(data, {
                        replaceDraft: false,
                        renderManager: true,
                        requestGeneration: initialRequestGeneration
                    })) data = state;
                    const requestId = data.inventoryRequestId;
                    const deadline = Date.now() + 22_000;
                    while (data.inventoryStatus === "loading" && data.inventoryRequestId === requestId &&
                        Date.now() < deadline) {
                        await wait(400);
                        if (activeGeneration !== generation || !rootElement) return false;
                        const result = await fetchState();
                        data = result.data;
                        if (!acceptServerState(data, {
                            replaceDraft: false,
                            renderManager: true,
                            requestGeneration: result.requestGeneration
                        })) data = state;
                    }
                    if (data.inventoryStatus === "loading") {
                        throw new Error("Lightroom did not complete the Develop preset inventory refresh.");
                    }
                    if (data.inventoryStatus !== "ready") {
                        throw new Error(data.inventoryError || "Lightroom Develop preset inventory is unavailable.");
                    }
                    inventoryRefreshError = null;
                    setManagerMessage(data.inventory.length + " Lightroom presets found.", "success");
                    return true;
                } catch (err) {
                    inventoryRefreshError = err.message;
                    if (activeGeneration === generation && rootElement) {
                        setManagerMessage(inventoryLifecycleMessage(state), "error");
                        renderCompact();
                    }
                    return false;
                }
            })();
            inventoryRefreshPromise = operation.finally(function () {
                inventoryRefreshInFlight = false;
                inventoryRefreshPromise = null;
                if (activeGeneration === generation && rootElement) {
                    renderCompact();
                    renderManager(false, true);
                }
            });
            return inventoryRefreshPromise;
        }

        async function saveConfiguration() {
            if (saveInFlight || !draftDirty) return;
            saveInFlight = true;
            setManagerMessage("Saving changes…", "info");
            renderManager(true);
            try {
                const requestGeneration = nextStateRequestGeneration();
                const response = await fetchRequest("/api/develop-presets/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(configurationFromDraft(draft)),
                    cache: "no-store"
                });
                const data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset configuration save failed");
                if (!acceptServerState(data, {
                    replaceDraft: true,
                    renderManager: true,
                    rebuildConfiguredList: true,
                    requestGeneration: requestGeneration
                })) throw new Error("Ignored a stale Develop preset configuration response");
                setManagerMessage("Changes saved.", "success");
            } catch (err) {
                setManagerMessage("Could not save changes. Please try again.", "error");
            } finally {
                saveInFlight = false;
                if (rootElement) renderManager(true);
            }
        }

        function createManager() {
            manageButton = makeButton("Manage Favorite Presets", "develop-preset-manage-toggle secondary", function () {
                const expanded = manageButton.getAttribute("aria-expanded") !== "true";
                manageButton.setAttribute("aria-expanded", String(expanded));
                managerPanel.hidden = !expanded;
                if (expanded) renderManager();
            });
            manageButton.setAttribute("aria-expanded", "false");

            managerPanel = document.createElement("div");
            managerPanel.className = "develop-preset-manager";
            managerPanel.id = "developPresetManagerPanel";
            managerPanel.hidden = true;
            manageButton.setAttribute("aria-controls", managerPanel.id);

            const description = document.createElement("p");
            description.className = "develop-preset-manager-description";
            description.textContent =
                "Choose which Lightroom presets appear in Favorite Presets and arrange the order used by Prev and Next. Adding an alias does not rename the original Lightroom preset.";

            addPresetsButton = makeButton("+ Add to Favorites", "develop-preset-add-open", function () {
                return refreshInventory().then(function () {
                    if (rootElement && inventoryPicker) openPicker(inventoryPicker, addPresetsButton);
                });
            });
            addPresetsButton.setAttribute("aria-haspopup", "dialog");
            addPresetsButton.setAttribute("aria-expanded", "false");
            addPresetsButton.setAttribute("aria-controls", "developPresetInventoryPicker");
            const toolbar = document.createElement("div");
            toolbar.className = "develop-preset-manager-toolbar";
            refreshPresetsButton = makeButton("Refresh Presets", "develop-preset-refresh secondary", refreshInventory);
            saveButton = makeButton("Save Changes", "develop-preset-save", saveConfiguration);
            managerStatus = document.createElement("div");
            managerStatus.className = "develop-preset-manager-status";
            managerStatus.setAttribute("role", "status");
            managerStatus.setAttribute("aria-live", "polite");
            toolbar.append(addPresetsButton, refreshPresetsButton, saveButton, managerStatus);

            configuredList = document.createElement("div");
            configuredList.className = "develop-preset-config-list";
            configuredList.setAttribute("aria-label", "Ordered configured Develop presets");
            managerPanel.append(description, toolbar, configuredList);
        }

        function createPickers() {
            configuredPicker = createPickerDialog(
                "developPresetConfiguredPicker",
                "Choose a configured preset",
                "This list follows the saved LRBridge configuration order. Choosing the current cursor reapplies it.",
                "Search configured presets",
                "Configured Develop presets",
                false
            );
            configuredPicker.searchInput.addEventListener("input", function () {
                configuredSearch = configuredPicker.searchInput.value;
                configuredPicker.renderSignature = null;
                renderConfiguredPicker(true);
            });

            inventoryPicker = createPickerDialog(
                "developPresetInventoryPicker",
                "Add Lightroom Presets to Favorites",
                "Choose one or more presets. The inventory is sorted by folder and name and does not claim to match Lightroom's visible Presets panel order.",
                "Search Lightroom preset inventory",
                "Lightroom Develop preset inventory",
                true
            );
            inventoryPicker.searchInput.addEventListener("input", function () {
                inventorySearch = inventoryPicker.searchInput.value;
                inventoryPicker.renderSignature = null;
                renderInventoryPicker(true);
            });
            const footer = document.createElement("div");
            footer.className = "develop-preset-picker-footer";
            const selectionCount = document.createElement("span");
            selectionCount.className = "develop-preset-picker-selection-count";
            const cancel = makeButton("Cancel", "secondary", function () {
                closePicker(inventoryPicker, true);
            });
            const addSelected = makeButton("Add selected", "develop-preset-picker-add-selected", addSelectedInventoryPresets);
            footer.append(selectionCount, cancel, addSelected);
            inventoryPicker.shell.appendChild(footer);
            inventoryPicker.selectionCount = selectionCount;
            inventoryPicker.addSelectedButton = addSelected;
        }

        function activate(nextHost) {
            deactivate();
            generation += 1;
            rootElement = document.createElement("section");
            rootElement.className = "develop-presets-controller";
            rootElement.id = "developPresetsController";
            rootElement.setAttribute("aria-labelledby", "developPresetsControllerTitle");

            const title = document.createElement("h2");
            title.id = "developPresetsControllerTitle";
            title.className = "develop-presets-controller-title";
            title.textContent = "FAVORITE PRESETS";

            const helper = document.createElement("p");
            helper.className = "develop-presets-controller-help";
            helper.textContent =
                "This screen shows only your Favorites for faster touch control. Use Add to Favorites below to search all Lightroom presets.";

            previousButton = makeButton("Prev", "develop-preset-navigation", function () {
                return submitPreset(navigationPath("previous"));
            });
            nextButton = makeButton("Next", "develop-preset-navigation", function () {
                return submitPreset(navigationPath("next"));
            });
            const current = document.createElement("div");
            current.className = "develop-preset-current";
            const currentLabel = document.createElement("span");
            currentLabel.className = "develop-preset-current-label";
            currentLabel.textContent = "Selected preset";
            currentPresetButton = makeButton("", "develop-preset-current-button", function () {
                openPicker(configuredPicker, currentPresetButton);
            });
            currentPresetButton.setAttribute("aria-haspopup", "dialog");
            currentPresetButton.setAttribute("aria-expanded", "false");
            currentPresetButton.setAttribute("aria-controls", "developPresetConfiguredPicker");
            currentPresetPrimary = document.createElement("span");
            currentPresetPrimary.className = "develop-preset-current-primary";
            currentPresetSecondary = document.createElement("span");
            currentPresetSecondary.className = "develop-preset-current-secondary";
            currentPresetButton.append(currentPresetPrimary, currentPresetSecondary);
            current.append(currentLabel, currentPresetButton);

            const row = document.createElement("div");
            row.className = "develop-presets-controller-row";
            row.append(previousButton, current, nextButton);

            const amountRow = document.createElement("div");
            amountRow.className = "develop-preset-amount-row";
            const amountLabel = document.createElement("label");
            amountLabel.className = "develop-preset-amount-label";
            amountLabel.htmlFor = "developPresetAmountRange";
            amountLabel.textContent = "Amount";
            amountRange = document.createElement("input");
            amountRange.id = "developPresetAmountRange";
            amountRange.className = "develop-preset-amount-range";
            amountRange.type = "range";
            amountRange.min = "0";
            amountRange.max = "200";
            amountRange.step = "1";
            amountRange.value = "100";
            amountRange.setAttribute("aria-label", "Preset Amount");
            amountNumber = document.createElement("input");
            amountNumber.className = "develop-preset-amount-number";
            amountNumber.type = "text";
            amountNumber.inputMode = "numeric";
            amountNumber.autocomplete = "off";
            amountNumber.spellcheck = false;
            amountNumber.value = "100";
            amountNumber.setAttribute("aria-label", "Preset Amount numeric value");
            amountDecrementButton = makeButton("−", "develop-preset-amount-step", function () {
                stepAmount(-1);
            });
            amountDecrementButton.setAttribute("aria-label", "Decrease Preset Amount");
            amountIncrementButton = makeButton("+", "develop-preset-amount-step", function () {
                stepAmount(1);
            });
            amountIncrementButton.setAttribute("aria-label", "Increase Preset Amount");
            amountResetButton = makeButton("Reset", "reset develop-preset-amount-reset", function () {
                queueAmount(100, true);
            });
            amountCapabilityNote = document.createElement("p");
            amountCapabilityNote.className = "develop-preset-amount-capability-note";
            amountRange.addEventListener("pointerdown", function () {
                amountDragging = true;
            });
            amountRange.addEventListener("input", function () {
                const amount = parsePresetAmount(amountRange.value);
                if (amount === null) return;
                queueAmount(amount, false);
            });
            amountRange.addEventListener("pointerup", function () {
                amountDragging = false;
                const amount = parsePresetAmount(amountRange.value);
                if (amount !== null) queueAmount(amount, true);
            });
            amountRange.addEventListener("pointercancel", function () {
                amountDragging = false;
                if (amountThrottleTimer !== null) clearTimeout(amountThrottleTimer);
                amountThrottleTimer = null;
                queuedAmount = null;
                if (activeAmountRequest === null && awaitingAmountFeedback === null &&
                    committedAmount() !== null) showLocalAmount(committedAmount());
                renderCompact();
            });
            amountRange.addEventListener("change", function () {
                amountDragging = false;
                const amount = parsePresetAmount(amountRange.value);
                if (amount !== null) queueAmount(amount, true);
            });
            amountNumber.addEventListener("focus", function () { amountEditing = true; });
            amountNumber.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    if (event.preventDefault) event.preventDefault();
                    commitAmountNumber();
                    amountNumber.blur();
                } else if (event.key === "Escape") {
                    if (event.preventDefault) event.preventDefault();
                    amountEditing = false;
                    if (committedAmount() !== null) showLocalAmount(committedAmount());
                    amountNumber.blur();
                }
            });
            amountNumber.addEventListener("blur", function () {
                if (amountEditing) commitAmountNumber();
            });
            amountRow.append(amountLabel, amountRange, amountNumber,
                amountDecrementButton, amountIncrementButton, amountResetButton, amountCapabilityNote);
            const aiGuidance = document.createElement("div");
            aiGuidance.className = "develop-preset-ai-guidance";
            const aiGuidanceIcon = document.createElement("span");
            aiGuidanceIcon.className = "develop-preset-ai-guidance-icon";
            aiGuidanceIcon.setAttribute("aria-hidden", "true");
            aiGuidanceIcon.textContent = "i";
            const aiGuidanceText = document.createElement("span");
            aiGuidanceText.textContent =
                "If an Adaptive or AI preset does not change the photo, open Manage Favorite Presets and turn on AI adjustments for that preset. This lets Lightroom apply the preset’s sky, subject or people effects.";
            aiGuidance.append(aiGuidanceIcon, aiGuidanceText);
            const treatmentBlock = document.createElement("div");
            treatmentBlock.className = "develop-preset-treatment";
            if (typeof createTreatmentPresentation === "function") {
                treatmentPresentation = createTreatmentPresentation();
                if (treatmentPresentation && treatmentPresentation.element) {
                    treatmentBlock.appendChild(treatmentPresentation.element);
                }
            }
            compactStatus = document.createElement("div");
            compactStatus.className = "develop-presets-controller-status";
            compactStatus.setAttribute("role", "status");
            compactStatus.textContent = "Loading configured Develop presets…";
            createManager();
            rootElement.append(title, helper, row, amountRow, treatmentBlock, aiGuidance, compactStatus, manageButton, managerPanel);
            createPickers();
            nextHost.appendChild(rootElement);
            if (!state) state = unavailableState("Loading Develop preset state…");
            renderCompact();
            renderManager(false, true);
            const activeGeneration = generation;
            refreshState().then(function (data) {
                if (activeGeneration !== generation || !rootElement || !data) return;
                if (data.inventoryStatus === "not-loaded" && !inventorySnapshotLoaded(data)) {
                    refreshInventory();
                }
            });
            timer = setInterval(refreshState, 600);
        }

        function updateContext() {
            if ((activeAmountRequest && !stableAmountBindingMatches(activeAmountRequest)) ||
                (awaitingAmountFeedback && !stableAmountBindingMatches(awaitingAmountFeedback))) {
                cancelAmountWork(false);
                desiredAmount = null;
            }
            renderCompact();
        }

        function deactivate() {
            generation += 1;
            if (timer !== null) clearInterval(timer);
            timer = null;
            cancelAmountWork(true);
            amountEditing = false;
            amountDragging = false;
            desiredAmount = null;
            pendingPresetStatusOperationId = null;
            amountCapabilityNote = null;
            closePicker(configuredPicker, false);
            closePicker(inventoryPicker, false);
            if (treatmentPresentation && typeof treatmentPresentation.dispose === "function") {
                treatmentPresentation.dispose();
            }
            treatmentPresentation = null;
            if (rootElement && rootElement.parentElement) rootElement.remove();
            rootElement = null;
            configuredPicker = null;
            inventoryPicker = null;
            configuredListRendered = false;
        }

        return {
            activate: activate,
            deactivate: deactivate,
            updateContext: updateContext,
            refresh: refreshState,
            getState: function () { return state; },
            getDraft: function () { return createDraft(draft); },
            getAmountState: function () {
                return {
                    committed: committedAmount(),
                    desired: desiredAmount,
                    submitted: activeAmountRequest ? activeAmountRequest.amount : null,
                    queued: queuedAmount,
                    awaiting: awaitingAmountFeedback ? awaitingAmountFeedback.target : null,
                    feedbackId: state && state.amountFeedback ? state.amountFeedback.id : null
                };
            },
            isActive: function () { return rootElement !== null; }
        };
    }

    return {
        createController: createController,
        displayLabel: displayLabel,
        inventoryLabel: inventoryLabel,
        primaryLabel: primaryLabel,
        secondaryLabel: secondaryLabel,
        createDraft: createDraft,
        addDraftEntry: addDraftEntry,
        removeDraftEntry: removeDraftEntry,
        moveDraftEntry: moveDraftEntry,
        configurationFromDraft: configurationFromDraft,
        parsePresetAmount: parsePresetAmount
    };
});
