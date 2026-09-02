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
            updateAISettings: entry.updateAISettings === true
        };
    }

    function createDraft(entries) {
        return Array.isArray(entries) ? entries.map(cloneEntry) : [];
    }

    function addDraftEntry(draft, uuid) {
        if (!Array.isArray(draft) || typeof uuid !== "string" || uuid.length === 0 ||
            draft.some(function (entry) { return entry.uuid === uuid; })) return false;
        draft.push({ uuid: uuid, alias: "", updateAISettings: false });
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
                const saved = { uuid: entry.uuid, updateAISettings: entry.updateAISettings === true };
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
        return entry.uuid + " (missing UUID)";
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
        let compactStatus = null;
        let treatmentPresentation = null;
        let manageButton = null;
        let managerPanel = null;
        let addPresetsButton = null;
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
        let lastSuccessfulCommittedAmount = null;
        let desiredAmount = null;
        let submittedAmount = null;
        let submittedAmountOperationId = null;
        let latestQueuedAmount = null;
        let amountChainContext = null;
        let amountThrottleTimer = null;
        let inventoryRefreshInFlight = false;
        let saveInFlight = false;
        let configuredListRendered = false;

        const successfulApplicationOutcomes = new Set([
            "SDK call completed and covered effect observed",
            "SDK call completed with no detectable change"
        ]);

        function currentContext() {
            const value = typeof getContext === "function" ? getContext() : null;
            return value || {};
        }

        function contextReady() {
            const context = currentContext();
            return context.activeModule === "develop" && typeof context.selectedPhotoUuid === "string" &&
                context.selectedPhotoUuid.length > 0 && Number.isInteger(context.contextCounter) &&
                Number.isInteger(context.developCounter);
        }

        function applicationPath(uuid) {
            const context = currentContext();
            return "/api/develop-presets/apply?uuid=" + encodeURIComponent(uuid) +
                "&selectedPhotoUuid=" + encodeURIComponent(context.selectedPhotoUuid) +
                "&contextCounter=" + encodeURIComponent(String(context.contextCounter)) +
                "&developCounter=" + encodeURIComponent(String(context.developCounter));
        }

        function navigationPath(direction) {
            const context = currentContext();
            return "/api/develop-presets/navigate?direction=" + encodeURIComponent(direction) +
                "&selectedPhotoUuid=" + encodeURIComponent(context.selectedPhotoUuid) +
                "&contextCounter=" + encodeURIComponent(String(context.contextCounter)) +
                "&developCounter=" + encodeURIComponent(String(context.developCounter));
        }

        function amountPath(amount) {
            const context = currentContext();
            return "/api/develop-presets/amount?presetAmount=" + encodeURIComponent(String(amount)) +
                "&selectedPhotoUuid=" + encodeURIComponent(context.selectedPhotoUuid) +
                "&contextCounter=" + encodeURIComponent(String(context.contextCounter)) +
                "&developCounter=" + encodeURIComponent(String(context.developCounter));
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

        function syncManagerToolbar() {
            if (!addPresetsButton || !saveButton) return;
            addPresetsButton.disabled = false;
            addPresetsButton.setAttribute("aria-busy", String(inventoryRefreshInFlight));
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
            const pending = state.pendingApplication === true || applicationRequestInFlight;
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
                    return submitPresetAtDefaultAmount(applicationPath(entry.uuid));
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
                    (state && state.inventoryStatus === "ready" && !inventoryUuids.has(uuid))) {
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
                inventoryRefreshInFlight ? "refreshing" : state.inventoryStatus,
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
                const message = inventoryRefreshInFlight || state.inventoryStatus === "refreshing"
                    ? "Refreshing the Lightroom preset inventory…"
                    : inventory.length === 0 ? (state.inventoryError || "No Lightroom presets are available.")
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
                " to the draft. Save Configuration to persist the change.", "info");
            renderManager(true, true);
        }

        function currentCursorUsesAi() {
            if (!state || !Array.isArray(state.configured)) return false;
            const cursor = state.configured.find(function (entry) { return entry.uuid === state.cursorUuid; });
            return !!cursor && cursor.updateAISettings === true;
        }

        function committedAmount() {
            return parsePresetAmount(lastSuccessfulCommittedAmount) !== null
                ? lastSuccessfulCommittedAmount
                : null;
        }

        function showLocalAmount(amount) {
            if (parsePresetAmount(amount) === null) return false;
            desiredAmount = Number(amount);
            if (amountRange) {
                amountRange.value = String(desiredAmount);
                amountRange.style.setProperty("--slider-progress", (desiredAmount / 2) + "%");
                amountRange.setAttribute("aria-valuenow", String(desiredAmount));
            }
            if (amountNumber && !amountEditing) amountNumber.value = String(desiredAmount);
            if (amountDecrementButton && amountRange) {
                amountDecrementButton.disabled = amountRange.disabled || desiredAmount <= 0;
            }
            if (amountIncrementButton && amountRange) {
                amountIncrementButton.disabled = amountRange.disabled || desiredAmount >= 200;
            }
            return true;
        }

        function amountContextSnapshot() {
            const context = currentContext();
            return {
                activeModule: context.activeModule,
                selectedPhotoUuid: context.selectedPhotoUuid,
                contextCounter: context.contextCounter,
                developCounter: context.developCounter
            };
        }

        function amountContextMatchesCurrent() {
            if (!amountChainContext) return true;
            const context = currentContext();
            return context.activeModule === amountChainContext.activeModule &&
                context.selectedPhotoUuid === amountChainContext.selectedPhotoUuid &&
                context.contextCounter === amountChainContext.contextCounter &&
                context.developCounter === amountChainContext.developCounter;
        }

        function cancelAmountThrottle() {
            if (amountThrottleTimer !== null) clearTimeout(amountThrottleTimer);
            amountThrottleTimer = null;
        }

        function discardAmountChain(restoreCommitted) {
            cancelAmountThrottle();
            latestQueuedAmount = null;
            submittedAmount = null;
            submittedAmountOperationId = null;
            amountChainContext = null;
            if (restoreCommitted && committedAmount() !== null) showLocalAmount(committedAmount());
        }

        async function dispatchPendingAmount() {
            if (!rootElement || latestQueuedAmount === null || !state || state.pendingApplication === true ||
                applicationRequestInFlight || submittedAmount !== null || !contextReady() ||
                !amountContextMatchesCurrent()) return false;
            const amount = latestQueuedAmount;
            latestQueuedAmount = null;
            submittedAmount = amount;
            submittedAmountOperationId = null;
            const accepted = await submit(amountPath(amount), {
                onAccepted: function (data) {
                    submittedAmountOperationId = typeof data.operationId === "string" ? data.operationId : null;
                }
            });
            if (!accepted) {
                discardAmountChain(true);
                renderCompact();
                return false;
            }
            if (submittedAmount === null && latestQueuedAmount !== null) setTimeout(dispatchPendingAmount, 0);
            return true;
        }

        function queueAmount(amount, immediate) {
            if (parsePresetAmount(amount) === null || !contextReady()) return false;
            if (!amountChainContext) amountChainContext = amountContextSnapshot();
            if (!amountContextMatchesCurrent()) {
                discardAmountChain(true);
                return false;
            }
            showLocalAmount(amount);
            latestQueuedAmount = Number(amount);
            cancelAmountThrottle();
            if (submittedAmount !== null || applicationRequestInFlight || (state && state.pendingApplication === true)) {
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

        function submitPresetAtDefaultAmount(path) {
            discardAmountChain(true);
            return submit(path);
        }

        function commitAmountNumber() {
            if (!amountNumber) return false;
            const amount = parsePresetAmount(amountNumber.value);
            amountEditing = false;
            if (amount === null) {
                if (committedAmount() !== null) showLocalAmount(committedAmount());
                else amountNumber.value = "100";
                setStatus("ERROR: Preset Amount must be an integer from 0 through 200.");
                renderCompact();
                return false;
            }
            return queueAmount(amount, true);
        }

        function stepAmount(direction) {
            const base = parsePresetAmount(desiredAmount) !== null ? desiredAmount : committedAmount();
            if (base === null) return false;
            return queueAmount(Math.max(0, Math.min(200, base + direction)), true);
        }

        function reconcileAmountState(nextState) {
            const incomingCommitted = parsePresetAmount(nextState && nextState.presetAmount) !== null
                ? Number(nextState.presetAmount)
                : null;

            if (submittedAmount !== null && nextState.pendingApplication !== true) {
                const terminal = nextState.lastApplication;
                const matchingOperation = terminal && (
                    submittedAmountOperationId !== null
                        ? terminal.operationId === submittedAmountOperationId
                        : terminal.presetAmount === submittedAmount
                );
                const succeeded = matchingOperation && successfulApplicationOutcomes.has(terminal.outcome) &&
                    terminal.presetAmount === submittedAmount && incomingCommitted === submittedAmount;
                if (succeeded) {
                    lastSuccessfulCommittedAmount = incomingCommitted;
                    submittedAmount = null;
                    submittedAmountOperationId = null;
                    if (latestQueuedAmount === lastSuccessfulCommittedAmount) latestQueuedAmount = null;
                    if (latestQueuedAmount === null) {
                        amountChainContext = null;
                        showLocalAmount(lastSuccessfulCommittedAmount);
                    }
                } else {
                    const detail = terminal && terminal.detail ? terminal.detail : "Preset Amount application failed.";
                    discardAmountChain(true);
                    setStatus("ERROR: " + detail);
                }
            }

            if (submittedAmount === null && latestQueuedAmount === null && amountThrottleTimer === null &&
                !amountEditing && !amountDragging && nextState.pendingApplication !== true) {
                lastSuccessfulCommittedAmount = incomingCommitted;
                desiredAmount = incomingCommitted;
            }
        }

        function renderAmount(cursor, pending) {
            if (!amountRange || !amountNumber) return;
            const committed = committedAmount();
            if (!amountEditing && !amountDragging && latestQueuedAmount === null && submittedAmount === null &&
                !pending) showLocalAmount(committed === null ? 100 : committed);
            else if (desiredAmount === null) showLocalAmount(committed === null ? 100 : committed);
            const ownAmountChainPending = submittedAmount !== null || latestQueuedAmount !== null;
            const blockedByOtherApplication = pending && !ownAmountChainPending;
            const enabled = !!cursor && cursor.available === true && committed !== null && state.controlsEnabled === true &&
                contextReady() && !blockedByOtherApplication && amountContextMatchesCurrent();
            amountRange.disabled = !enabled;
            amountNumber.disabled = !enabled;
            amountDecrementButton.disabled = !enabled || desiredAmount <= 0;
            amountIncrementButton.disabled = !enabled || desiredAmount >= 200;
            amountResetButton.disabled = !enabled;
            amountNumber.setAttribute("aria-invalid", String(amountEditing && parsePresetAmount(amountNumber.value) === null));
        }

        function renderCompact() {
            if (!rootElement || !state) return;
            const configured = Array.isArray(state.configured) ? state.configured : [];
            const cursor = configured.find(function (entry) { return entry.uuid === state.cursorUuid; }) || null;
            const pending = state.pendingApplication === true || applicationRequestInFlight;
            const enabled = state.controlsEnabled === true && contextReady() && !pending;

            currentPresetPrimary.textContent = cursor ? primaryLabel(cursor) : "No preset available";
            currentPresetSecondary.textContent = cursor ? secondaryLabel(cursor) +
                (cursor.available ? "" : " — Unavailable") : "Open Manage Presets to configure presets";
            currentPresetButton.disabled = configured.length === 0 || pending;
            currentPresetButton.setAttribute("aria-label", cursor
                ? "Preset to apply: " + displayLabel(cursor) + ". Open configured preset picker."
                : "Preset to apply: none configured");
            previousButton.disabled = !enabled;
            nextButton.disabled = !enabled;
            renderAmount(cursor, pending);
            renderConfiguredPicker(false);

            if (state.inventoryStatus !== "ready") {
                compactStatus.textContent = state.inventoryError ||
                    "Develop preset inventory is unavailable. Open Manage Presets and refresh it from Lightroom.";
            } else if (state.availableCount === 0) {
                compactStatus.textContent = configured.length === 0
                    ? "No presets are configured. Open Manage Presets to add and save presets."
                    : "No configured preset UUID is available in the current Lightroom inventory.";
            } else if (!contextReady()) {
                compactStatus.textContent = "Select one photo in Lightroom's Develop module to apply a preset.";
            } else if (pending) {
                compactStatus.textContent = "Waiting for Lightroom to finish the preset application.";
            } else if (state.lastApplication && state.lastApplication.outcome) {
                compactStatus.textContent = state.lastApplication.outcome + ": " + state.lastApplication.detail +
                    " Amount is LRBridge's last-successful application value, not native Lightroom readback.";
            } else {
                compactStatus.textContent =
                    "This is LRBridge's preset-to-apply cursor, not Lightroom active-preset state. " +
                    "Amount becomes LRBridge last-successful state after an application, not native Lightroom readback.";
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

        function renderConfiguredList() {
            const inventory = state && Array.isArray(state.inventory) ? state.inventory : [];
            const inventoryByUuid = new Map(inventory.map(function (item) { return [item.uuid, item]; }));
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
                const row = document.createElement("div");
                row.className = "develop-preset-config-row" + (item ? "" : " unavailable");
                row.dataset.uuid = entry.uuid;
                appendTextField(row, "Folder", item ? item.folder : "Unavailable", "folder");
                appendTextField(row, "Preset", item ? item.name : entry.uuid + " (missing UUID)", "preset");

                const aliasField = document.createElement("label");
                aliasField.className = "develop-preset-config-field alias";
                const aliasLabel = document.createElement("span");
                aliasLabel.className = "develop-preset-config-field-label";
                aliasLabel.textContent = "Alias (optional)";
                const alias = document.createElement("input");
                alias.type = "text";
                alias.maxLength = 160;
                alias.value = entry.alias;
                alias.dataset.focusKey = "alias";
                alias.setAttribute("aria-label", "Optional alias for " + (item ? inventoryLabel(item) : entry.uuid));
                alias.addEventListener("input", function () {
                    entry.alias = alias.value;
                    updateDraftDirtyState();
                });
                aliasField.append(aliasLabel, alias);
                row.appendChild(aliasField);

                const aiField = document.createElement("label");
                aiField.className = "develop-preset-config-field ai";
                const ai = document.createElement("input");
                ai.type = "checkbox";
                ai.checked = entry.updateAISettings;
                ai.dataset.focusKey = "update-ai";
                ai.setAttribute("aria-label", "Update AI settings for " + (item ? inventoryLabel(item) : entry.uuid));
                ai.addEventListener("change", function () {
                    entry.updateAISettings = ai.checked;
                    updateDraftDirtyState();
                });
                const aiText = document.createElement("span");
                aiText.textContent = "Update AI settings";
                aiField.append(ai, aiText);
                row.appendChild(aiField);

                const actions = document.createElement("div");
                actions.className = "develop-preset-config-actions";
                const moveUp = makeButton("Move Up", "secondary", function () {
                    if (moveDraftEntry(draft, index, -1)) {
                        updateDraftDirtyState();
                        setManagerMessage("Order changed. Save Configuration to persist it.", "info");
                        renderManager(true, true);
                    }
                });
                moveUp.dataset.focusKey = "move-up";
                moveUp.disabled = index === 0;
                const moveDown = makeButton("Move Down", "secondary", function () {
                    if (moveDraftEntry(draft, index, 1)) {
                        updateDraftDirtyState();
                        setManagerMessage("Order changed. Save Configuration to persist it.", "info");
                        renderManager(true, true);
                    }
                });
                moveDown.dataset.focusKey = "move-down";
                moveDown.disabled = index === draft.length - 1;
                const remove = makeButton("Remove", "danger", function () {
                    if (removeDraftEntry(draft, index)) {
                        updateDraftDirtyState();
                        setManagerMessage("Preset removed from the draft. Save Configuration to persist it.", "info");
                        renderManager(true, true);
                    }
                });
                remove.dataset.focusKey = "remove";
                actions.append(moveUp, moveDown, remove);
                row.appendChild(actions);

                if (!item) {
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
                setManagerMessage("Error: " + state.configurationError, "state-error");
            } else if (!preserveMessage && state.inventoryStatus === "error" && !inventoryRefreshInFlight) {
                setManagerMessage(
                    "Error: " + (state.inventoryError || "Develop preset inventory is unavailable."),
                    "state-error"
                );
            }
        }

        function acceptServerState(nextState, optionsForState) {
            optionsForState = optionsForState || {};
            state = nextState;
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
            if (latestQueuedAmount !== null && submittedAmount === null &&
                state.pendingApplication !== true && !applicationRequestInFlight) {
                setTimeout(dispatchPendingAmount, 0);
            }
        }

        async function fetchState() {
            const response = await fetchRequest("/api/develop-presets/state", { cache: "no-store" });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset state is unavailable");
            return data;
        }

        function unavailableState(message) {
            const configured = state && Array.isArray(state.configured) ? state.configured.map(function (entry) {
                return Object.assign({}, entry, { available: false });
            }) : draft.map(function (entry) {
                return Object.assign({ folder: null, name: null, available: false }, cloneEntry(entry));
            });
            return {
                ok: false,
                configuration: configurationFromDraft(draft),
                configurationError: null,
                inventory: [],
                inventoryStatus: "error",
                inventoryError: message,
                configured: configured,
                availableCount: 0,
                cursorUuid: state ? state.cursorUuid : null,
                presetAmount: state ? state.presetAmount : null,
                controlsEnabled: false,
                pendingApplication: false,
                lastApplication: state ? state.lastApplication : null
            };
        }

        async function refreshState() {
            const activeGeneration = generation;
            try {
                const data = await fetchState();
                if (activeGeneration !== generation || !rootElement) return null;
                acceptServerState(data);
                return data;
            } catch (err) {
                if (activeGeneration !== generation || !rootElement) return null;
                state = unavailableState(err.message);
                renderCompact();
                renderManager();
                setManagerMessage("Error: " + err.message, "state-error");
                return null;
            }
        }

        async function submit(path, submissionOptions) {
            submissionOptions = submissionOptions || {};
            if (!contextReady() || !state || state.controlsEnabled !== true ||
                state.pendingApplication || applicationRequestInFlight) return false;
            applicationRequestInFlight = true;
            renderCompact();
            setStatus("Sending Develop preset command…");
            try {
                const response = await fetchRequest(path, { cache: "no-store" });
                const data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset application was rejected");
                if (typeof submissionOptions.onAccepted === "function") submissionOptions.onAccepted(data);
                setStatus("OK: Develop preset application queued. Lightroom result pending.");
                return data;
            } catch (err) {
                setStatus("ERROR: " + err.message);
                return false;
            } finally {
                applicationRequestInFlight = false;
                await refreshState();
            }
        }

        function wait(milliseconds) {
            return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
        }

        async function refreshInventory() {
            if (inventoryRefreshInFlight) return;
            const activeGeneration = generation;
            inventoryRefreshInFlight = true;
            setManagerMessage("Waiting for Lightroom to return the ordinary Develop preset inventory…", "info");
            renderManager(true);
            try {
                const response = await fetchRequest("/api/develop-presets/inventory/refresh", { cache: "no-store" });
                let data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset inventory refresh was rejected");
                if (activeGeneration !== generation || !rootElement) return;
                acceptServerState(data, { replaceDraft: false, renderManager: true });
                const requestId = data.inventoryRequestId;
                const deadline = Date.now() + 22_000;
                while (data.inventoryStatus === "refreshing" && data.inventoryRequestId === requestId &&
                    Date.now() < deadline) {
                    await wait(400);
                    if (activeGeneration !== generation || !rootElement) return;
                    data = await fetchState();
                    acceptServerState(data, { replaceDraft: false, renderManager: true });
                }
                if (data.inventoryStatus === "refreshing") {
                    throw new Error("Lightroom did not complete the Develop preset inventory refresh.");
                }
                if (data.inventoryStatus !== "ready") {
                    throw new Error(data.inventoryError || "Lightroom Develop preset inventory is unavailable.");
                }
                setManagerMessage(
                    "Loaded " + data.inventory.length + " Develop presets from Lightroom. Configured order was preserved.",
                    "success"
                );
            } catch (err) {
                setManagerMessage("Error: " + err.message, "error");
            } finally {
                inventoryRefreshInFlight = false;
                if (activeGeneration === generation && rootElement) renderManager(true, true);
            }
        }

        async function saveConfiguration() {
            if (saveInFlight || !draftDirty) return;
            saveInFlight = true;
            setManagerMessage("Saving the ordered Develop preset configuration…", "info");
            renderManager(true);
            try {
                const response = await fetchRequest("/api/develop-presets/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(configurationFromDraft(draft)),
                    cache: "no-store"
                });
                const data = await response.json();
                if (!response.ok || !data.ok) throw new Error(data.error || "Develop preset configuration save failed");
                draftDirty = false;
                acceptServerState(data, {
                    replaceDraft: true,
                    renderManager: true,
                    rebuildConfiguredList: true
                });
                setManagerMessage(
                    "Saved " + data.configuration.presets.length + " configured Develop presets in explicit order.",
                    "success"
                );
            } catch (err) {
                setManagerMessage("Error: " + err.message, "error");
            } finally {
                saveInFlight = false;
                if (rootElement) renderManager(true);
            }
        }

        function createManager() {
            manageButton = makeButton("Manage Presets", "develop-preset-manage-toggle secondary", function () {
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
                "Preset UUID is the saved identity. Folder and preset names are labels; this sorted inventory does not claim Lightroom Presets panel order.";

            addPresetsButton = makeButton("+ Add Presets", "develop-preset-add-open", function () {
                openPicker(inventoryPicker, addPresetsButton);
                return refreshInventory();
            });
            addPresetsButton.setAttribute("aria-haspopup", "dialog");
            addPresetsButton.setAttribute("aria-expanded", "false");
            addPresetsButton.setAttribute("aria-controls", "developPresetInventoryPicker");
            const toolbar = document.createElement("div");
            toolbar.className = "develop-preset-manager-toolbar";
            saveButton = makeButton("Save Configuration", "develop-preset-save", saveConfiguration);
            managerStatus = document.createElement("div");
            managerStatus.className = "develop-preset-manager-status";
            managerStatus.setAttribute("role", "status");
            managerStatus.setAttribute("aria-live", "polite");
            toolbar.append(addPresetsButton, saveButton, managerStatus);

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
                "Add Lightroom presets",
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
            title.textContent = "DEVELOP PRESETS";

            previousButton = makeButton("Previous Preset", "develop-preset-navigation", function () {
                return submitPresetAtDefaultAmount(navigationPath("previous"));
            });
            nextButton = makeButton("Next Preset", "develop-preset-navigation", function () {
                return submitPresetAtDefaultAmount(navigationPath("next"));
            });
            const current = document.createElement("div");
            current.className = "develop-preset-current";
            const currentLabel = document.createElement("span");
            currentLabel.className = "develop-preset-current-label";
            currentLabel.textContent = "Preset to apply";
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
            amountDecrementButton = makeButton("−", "develop-preset-amount-step", function () { stepAmount(-1); });
            amountDecrementButton.setAttribute("aria-label", "Decrease Preset Amount");
            amountIncrementButton = makeButton("+", "develop-preset-amount-step", function () { stepAmount(1); });
            amountIncrementButton.setAttribute("aria-label", "Increase Preset Amount");
            amountResetButton = makeButton("Reset", "reset develop-preset-amount-reset", function () {
                queueAmount(100, true);
            });
            amountRange.addEventListener("pointerdown", function () { amountDragging = true; });
            amountRange.addEventListener("input", function () {
                const amount = parsePresetAmount(amountRange.value);
                if (amount === null) return;
                showLocalAmount(amount);
                if (!currentCursorUsesAi()) queueAmount(amount, false);
            });
            amountRange.addEventListener("pointerup", function () {
                amountDragging = false;
                const amount = parsePresetAmount(amountRange.value);
                if (amount !== null) queueAmount(amount, true);
            });
            amountRange.addEventListener("pointercancel", function () {
                amountDragging = false;
                if (currentCursorUsesAi() && committedAmount() !== null) showLocalAmount(committedAmount());
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
                amountDecrementButton, amountIncrementButton, amountResetButton);
            const treatmentBlock = document.createElement("div");
            treatmentBlock.className = "develop-preset-treatment";
            if (typeof createTreatmentPresentation === "function") {
                treatmentPresentation = createTreatmentPresentation();
                if (treatmentPresentation && treatmentPresentation.element) {
                    treatmentBlock.appendChild(treatmentPresentation.element);
                }
            }
            const treatmentNote = document.createElement("p");
            treatmentNote.className = "develop-preset-treatment-note";
            treatmentNote.textContent = "Some presets preserve the current treatment. Switch back to Color here after using a B&W preset.";
            treatmentBlock.appendChild(treatmentNote);
            compactStatus = document.createElement("div");
            compactStatus.className = "develop-presets-controller-status";
            compactStatus.setAttribute("role", "status");
            compactStatus.textContent = "Loading configured Develop presets…";
            createManager();
            rootElement.append(title, row, amountRow, treatmentBlock, compactStatus, manageButton, managerPanel);
            createPickers();
            nextHost.appendChild(rootElement);
            if (!state) state = unavailableState("Loading Develop preset state…");
            renderCompact();
            renderManager(false, true);
            refreshState();
            timer = setInterval(refreshState, 600);
        }

        function updateContext() {
            if (!amountContextMatchesCurrent()) discardAmountChain(true);
            renderCompact();
        }

        function deactivate() {
            generation += 1;
            if (timer !== null) clearInterval(timer);
            timer = null;
            discardAmountChain(true);
            amountEditing = false;
            amountDragging = false;
            desiredAmount = null;
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
                    submitted: submittedAmount,
                    queued: latestQueuedAmount
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
