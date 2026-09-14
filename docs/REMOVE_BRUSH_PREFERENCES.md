# Remove / Heal / Clone preferences

The user reported that the repaired panel works well (2026-09-14). Preserve that accepted interaction repair and Masking checkpoint `b22c6c82485f2211c0f2d09d67a5ceafcd496fbb`. The user now also reports that the current Healing controls appear to work in live use and authorizes a local checkpoint. This is initial feedback, not exhaustive validation. Individual Selected Repair Opacity/Feather Reset buttons are the first follow-up; their values and semantics remain unestablished. No release, version bump or native UI fallback is part of this work.

Current action-row, explicit first-mode opening and Selected Repair details are in [Healing actions and selected-repair support](HEALING_SELECTED_REPAIR.md). That document supersedes the earlier Open Remove / Close Remove lifecycle description below; the accepted brush interaction behavior remains unchanged.

## Live failure and repair

The original helper used its confirmed value as both display and step base. `submit()` cleared the draft, rendered the old SDK value, and disabled input until confirmation. A request from 25 to 26 visibly returned to 25; repeated intentional clicks were ignored. The old browser test incorrectly expected repeated clicks to be discarded and checked eventual success rather than intermediate display. The new delayed-feedback regression reproduced actual `25`, expected `26`, before repair.

The repair follows the working Develop/Masking separation of authoritative, displayed and desired values (`nextDevelopSliderStepValue`, `applyDevelopSliderFeedback`, `submitDevelopSliderValue`, `flushDevelopSliderValue`, `stepDevelopSliderValue`, and Masking correction gestures). Each slider retains confirmed/displayed values, editing/drag state and its latest target. The panel allows one SDK operation and at most one coalesced target per preference. Range input schedules at 100 ms and step bursts at 350 ms; release, numeric Enter/blur and Reset flush the latest intent. Size, Feather and Threshold now display whole numbers, with range/step increments of 1 from the latest displayed/requested value. Committed decimal point/comma input rounds to the nearest integer and clamps to its SDK range. Other Web Controller controls retain their own precision.

Raw fractional SDK values remain unchanged in browser confirmed state, server snapshots and Lua preservation baselines. Formatting, polling or committing an untouched rounded editor sends no write. For example, native Size 25.49 displays 25; ten + clicks request 35, using 25.49 as the exact SDK baseline. A change to Size must preserve native Feather 50.5 and Threshold 37.4 exactly. Confirmation compares raw values, never their rounded display.

Older HTTP acknowledgements and SDK results cannot replace a newer display or end its gesture. Only a matching result with SDK readback confirms a write. Failed/expired operations cancel unsent follow-ups and return to authoritative feedback with an error. Native photo/module/Develop/mode/tool changes invalidate obsolete edits. Cancellation cannot roll back a setter already executed.

## Supported controls

The existing **Tools > Healing** section has one **Open Healing Tool / Close Healing Tool** button with the Masking button styling, one **Reset Spot Removal** button, and **Remove | Heal | Clone** mini-tabs with Color Mixer styling. Active selection follows Lightroom; a requested tab or tool transition is busy until confirmed.

| Control | SDK field / values | Availability |
| --- | --- | --- |
| Remove / Heal / Clone | `newSpotType`: `heal_patchmatch` / `heal` / `clone` | All modes |
| Size | `brushSize`, 1–100 | All modes |
| Feather | `brushFeather`, 0–100 | Heal and Clone; hidden in Remove |
| Use generative AI | `useGenerativeAI`, boolean | Remove only |
| Detect objects | `detectObjects`, boolean | Remove only |
| Tool Overlay | `toolOverlay`: `always`, `auto`, `selected`, `never` | All modes; labels Always, Auto, Selected, Never |
| Visualize Spots | `visualizeSpots`, boolean | All modes |
| Threshold | `visualizationThreshold`, 0–100 | All modes; enabled when Visualize Spots is confirmed on |

Rows reuse label, range, numeric editor, minus, plus and orange Reset. Numeric drafts/caret, decimal point/comma, Enter, Escape and focus survive routine polling. Panel/history DOM remains mounted. Mode-specific content has stable allocated space so native feedback does not move the page. Redundant `Lightroom: value` lines are removed; compact status distinguishes requests from confirmation.

Adobe's [Healing tool help](https://helpx.adobe.com/lightroom-classic/desktop/help/healing-tool.html) limits Feather to Heal/Clone and describes Visualize Spots/threshold. Its [Remove tool help](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/remove-tool.html) documents generative AI, Detect objects restricted to Remove, Tool Overlay and Visualize Spots. These supplement the SDK catalog; they are not live verification of this implementation.

## SDK and reset contract

Installed Lightroom Classic 15.3 SDK, `API Reference/modules/LrDevelopController.html`, documents the following as SDK 14.1+ methods:

```lua
local preferences = LrDevelopController.getRemovePanelPreferences()
local success, errorMessage = LrDevelopController.setRemovePanelPreferences(preferencesTable)
```

The getter returns the eight fields above. The setter accepts optional fields and returns a boolean, with an error string on failure. Every write sends one field. Unknown/future preferences are preserved by omission and checked against a deep-copied getter baseline.

`newSpotType` explicitly means the type for **new spots**. The SDK's `goToRemove` documentation also says `setRemovePanelPreferences` can change the displayed spot type. No selected-spot type/parameter/index setter is called. Setting preferences does not itself request spot creation, removal application, AI generation or an image-history entry.

No documented individual Remove brush-preference reset/default getter exists in this SDK. `resetSpotRemoval()` clears the current photo's spot-removal adjustments and is deprecated; it is never used for preference resets. The separate **Reset Spot Removal** button retains the existing `develop.action` / `resetSpotRemoval` path and its request feedback; that legacy action has no new inventory-based completion confirmation. An empty preference table is not documented as a reset and is not used.

Reset uses explicit **LRBridge product defaults**, defined in `app/controller-remove.js`: **Size 25, Feather 50, Threshold 50**. These are deliberate local fallback values, not observations or claims about Adobe factory defaults. The UI note and Reset title/accessibility wording disclose the source and values. Each Reset patches only its field and supersedes that slider's latest target while an earlier write settles.

## Context, mode changes and history

Admission, dispatch, validation and results retain photo UUID, module, context counter/timestamp, Develop counter, server epoch, semantic preference revision, original mode and original field value. Reads require Develop, a photo and the existing `dust` tool. After the last yielding admission check, native context/mode/value are read again before the setter. Confirmation requires matching readback and preservation of every other preference. Concurrent unrelated changes are reported as unconfirmed; no rollback overwrites them. Freshness uses server age plus browser monotonic elapsed time.

A mode intent cancels local brush drafts/follow-ups. Server admission revokes the obsolete queued/dispatched preference operation before enqueuing the mode write. The serial Lightroom command worker and single-use ownership remain; late old results cannot settle the replacement. Repeated mode choices coalesce to the latest mode, without carrying obsolete brush values into it.

Open/Close uses actual `getSelectedTool()` feedback. Opening explicitly calls SDK 14.1+ `goToRemove("heal_patchmatch", "manualRemove")`, selecting the first new-stroke mode; closing calls `selectTool("loupe")`. These are dot calls with no controller/self argument. The label follows the actual getter value, even when preferences are unavailable. The dedicated `remove.panel.set` command binds original photo/context/epoch/revision and selected tool; it checks native context again after yielding validation and polls selected-tool readback. An HTTP acknowledgement alone cannot flip the label. Closing revokes obsolete preference ownership and cancels draft/drag continuations. It does not undo a preference write that Lightroom has already executed, and it does not replace a newer native tool selection. No preference setter, image-history entry or panel scrolling is requested by Open/Close.

Shared Undo/Redo stays global and is blocked during editing/confirmation. SDK UI preferences are not documented as image-history entries; LRBridge neither manufactures entries nor claims they can be undone through image history.

## Focused Distraction Removal audit (2026-09-14; inspection only)

Source: installed [Lightroom Classic 15.3 SDK controller reference](<C:/Users/nino/Downloads/LrC_15.3_SDK/API Reference/modules/LrDevelopController.html>), read alongside the existing [capability audit](LIGHTROOM_15_3_SDK_CAPABILITY_AUDIT.md). All method names below belong to `LrDevelopController` and use dot calls. These are documented capabilities, not executed actions or live confirmation of their behavior. No Distraction Removal controls are implemented.

| Capability | Exact documented API / allowed values | Feedback and limitations |
| --- | --- | --- |
| Reflections — Apply | `toggleReflectionRemoval(amount, quality, callback, callbackFuncArgTable)`; optional amount −100…100 (default 100), optional quality `preview` / `standard` / `best` (default `preview`), optional callback and argument table. SDK 14.5+, Develop required. | `getReflectionRemovalPanelState()` returns boolean `checkboxState`, numeric `amount`, string `quality`, boolean `enabled` and `isSupported`. Apply is a toggle, not a boolean setter; read state before invoking. Callback is documented after the toggle, without a documented success/error payload or progress percentage. |
| Reflections — Amount | `changeReflectionRemovalAmount(amount)`; required number −100…100. SDK 14.5+, Develop required. | The same getter exposes actual amount; suitable for a bound slider with readback. No return value, callback or per-control enabled flag is documented for this setter. Panel support/enabled state must be respected. |
| Reflections — Quality | `changeReflectionRemovalQuality(quality, callback, callbackFuncArgTable)`; required `preview` / `standard` / `best`, optional callback and argument table. SDK 14.5+, Develop required. | Same getter exposes quality. Callback follows quality change; no documented success/error payload. This is an enum choice, not an amount slider. No documented processing-progress getter. |
| People — detection | `detectDistractingPeople()`; no parameters. SDK 14.5+, Develop and open Remove required. | Executable detection trigger; no return value, completion callback, busy/ready/error state getter or detection-progress API is documented. An empty spot inventory does not prove detection has finished or found no people. |
| People — removal | `applyRemovalOnDetectedDistractingPeople(callback, callbackFuncArgTable)`; both optional. SDK 14.5+, Develop and open Remove required. | Executable removal of detected people. Callback runs after removal is done, but no documented success/error arguments, result count or progress. It is not a boolean preference or adjustable removal-strength slider. |
| People — readable inventory/selection | `countAllSpots("distractingPeopleRemoval")` returns a number; `getAllSpots("distractingPeopleRemoval")` returns a spot list; `getSelectedSpotIndex("distractingPeopleRemoval")` returns an index or nil; `getSelectedSpotParams("distractingPeopleRemoval")` returns a table. These APIs were added in SDK 14.1 and updated in 14.5 for feature selection. | All require Develop; the selected-spot getters also require open Remove. Their optional `whichFeature` accepts `manualRemove` or `distractingPeopleRemoval`, default `manualRemove`. Spot-table fields are not specified here as an operation-state schema. Inventory/selection is readable; a reliable detection/removal state machine cannot be inferred from undocumented fields or counts alone. |
| Dust — automatic Distraction Removal | No documented automatic Dust detection/removal method, parameters, state getter or adjustable controls found in the installed API modules. | `selectTool("dust")` opens the existing manual removal tool, and `getSelectedTool()` reports that tool identifier. Neither establishes automatic Distraction Removal Dust support. No executable automatic Dust action is justified by this evidence. |

`goToRemove(spotType, whichFeature)` opens a feature panel. Optional `spotType` accepts `heal_patchmatch`, `heal`, `clone` (omitting it retains the last type); optional `whichFeature` accepts `manualRemove`, `reflectionRemoval`, `distractingPeopleRemoval` (default `manualRemove`). There is no Dust feature value. Navigation does not prove detection or removal completed. The manual preference getter and selected-tool getter do not identify which Distraction subpanel is selected.

Other documented People spot actions take `whichFeature` with the same two values: `deleteSelectedSpot`, `deleteSelectedVariation`, `gotoNextVariation`, `gotoPreviousVariation`, `refreshSelectedSpot`, and `setSelectedSpotIndex(spotIndex, whichFeature)` (the last also requires a numeric index). These are inventory/selection/variation actions, not detection-state getters or brush sliders. No speculative operation state or undocumented spot fields are used by LRBridge.

## Verification and live test

`npm run test:remove-preferences` extends the categorical runner: 161 HTTP/queue/Parser/Commands/Lua mock-SDK scenarios plus query/revision/freshness/expiry checks. Coverage includes typed fields, modes/overlay values, three resets, raw fractional baselines/preservation, one-field writes, future preferences, mode supersession before/after dispatch, duplicate/stale results, SDK errors and malformed/unavailable reads. Open/Close cases cover native tool readback, unchanged admission state, stale photo/tool bindings, close supersession before/after dispatch, failed/no-change SDK calls and forged target feedback. Brush-preference cases forbid selected-spot setters and `resetSpotRemoval`; separate selected-repair cases verify Fill, Opacity, Feather, Refresh and Delete. Tool selection is permitted only in lifecycle tests.

`node tests/controller-browser-lifecycle.js --remove-only --preserve-browser-profile` extends the isolated runner with intermediate numeric/thumb assertions, held drags spanning polls/acknowledgements, ten clicks, reversals, pending Reset, delayed HTTP admission, out-of-order state, mode supersession, all preferences, native changes, failed writes and HTTP timeout. It verifies 1280/768/390/320 geometry, orange Reset/touch targets, numeric caret/focus and shared Undo/Redo on an independent image edit. Preference writes must create no image-history entries.

Existing categorical, shared-history, proxy, Lua polling and component inversion checks passed for the accepted interaction repair. Pre-existing Delete All wording and protected Companion `LensBlurAmount` assertions remain separate known failures. The user's report establishes that the repaired panel works well; the current Healing controls also appear to work in live use. This is initial feedback rather than exhaustive validation; no full-suite pass is claimed.

No load or restart is required for this checkpoint: production source is unchanged from the tested build. The following checklist is retained for future targeted validation, not a request to repeat live experiments tonight.

1. In Develop and **Tools > Healing**, press Open Healing Tool, then Close Healing Tool. Verify Lightroom enters/exits its native tool and the label follows native changes too. Existing spots remain intact.
2. In Heal/Clone, drag Size/Feather, press + ten times and reverse direction while feedback arrives. Enter `42,5` (43), `120.7` (100) and Escape a draft. Repeat with Visualize Spots threshold; check stable thumb, focus and page position.
3. Press individual Reset: Size 25, Feather 50, Threshold 50. Each changes only its preference. Start an edit, then Close Healing Tool; reopen and confirm no obsolete edit resumes. Repeat a native mode/photo change and ordinary shared Undo/Redo after an image edit.
4. On a disposable photo/copy with removal spots, the separate Reset Spot Removal button still requests clearing spot-removal adjustments. Its legacy feedback reports the request, not new inventory confirmation; verify the native result and Undo in Lightroom.

The completed controls are included in the authorized local Healing checkpoint. No reload is required for checkpointing. Selected Repair Opacity/Feather Reset values and semantics are the first follow-up; no reset functionality was added tonight. Masking brushes remain deferred and optional configured shortcuts remain a post-v0.6 proposal.
