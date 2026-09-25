# HTTP workflows for Windows v0.6

Direct API: `http://127.0.0.1:17891`. Builder Copy path and Copy full URL use this direct API, without `/api`. The controller at port 17892 proxies paths with `/api` prepended. For example, `http://127.0.0.1:17891/set?slider=Exposure&value=1.25` and `http://127.0.0.1:17892/api/set?slider=Exposure&value=1.25` reach the same handler. Never combine port 17891 with `/api`.

HTTP admission means queued, not confirmed Lightroom execution. Check subsequent authoritative state or the workflow's matching result. A `queued` response does not prove that Lightroom applied the edit, and a later context change can invalidate pending work. Do not automatically retry a mutation after a timeout or uncertain response.

After clicking an action button, allow Lightroom time to respond before clicking it again. Repeated clicks can queue additional actions.

## Ordinary URLs

The Builder can generate existing Set/Adjust/Reset, Develop actions, Selection, Photo/Crop, Application and Color Grading URLs. Example: `/set?slider=Exposure&value=1.25`. These use validated native-current context and queue admission; they do not acquire the full captured-selection protocol of Export/Paste. `/command?command=photo.crop_aspect&mode=custom&w=16&h=10` **applies** that aspect ratio; the web controller's own Custom Crop button opens its input dialog.

Ordinary URL commands use **GET** and URL-encoded query fields. Cards for POST/body or multi-request actions provide complete PowerShell commands/scripts instead. The Builder only copies requests; it never executes them. Read `/sliders` for slider IDs, declared range, precision and `adjustSupported` / `resetSupported`, and `/color-grading` for Color Grading metadata and any reported runtime ranges. Do not infer support from a visible Lightroom control.

| Builder choice | Direct route and required query fields |
|---|---|
| Absolute slider Set | `/set`: `slider`, `value` (plain decimal within declared range and precision) |
| Relative Adjust / Reset | `/command`: `command=develop.adjust`, `slider`, `amount` (signed safe integer counting Lightroom increments); or `command=develop.reset`, `slider`. Honor each slider's support flags. |
| Develop action | `/command`: `command=develop.action`, `action`. Only `selectCropTool` accepts optional `target=crop` or `target=loupe`; omitting it opens Crop. |
| Selection | `/command`: `command=selection.navigate` + `direction`; `selection.extend` + `direction` and integer `amount=1..100`; `selection.flag` + `flag`; `selection.rating.set` + integer `rating=0..5`; `selection.rating.adjust` + `direction`; `selection.label.set` / `selection.label.toggle` + `label`; `selection.operation` + `operation`. |
| Photo | `/command`: `command=photo.rotate` + `direction`; `photo.treatment` + `value`; `photo.reveal` + `scope=active`. |
| Crop aspect | `/command`: `command=photo.crop_aspect`, `mode`. Custom requires `mode=custom`, integer `w` and `h` from 1 to 10000; fixed modes omit `w` and `h`. |
| Crop Angle | `/command`: `command=photo.crop_angle.set`, `value` from -45 to 45 with at most two decimal places; or `command=photo.crop_angle.reset` alone. |
| Application | `/command`: `command=application.module` + `module`; `application.view` / `application.secondary_view` + `view`; `application.action` + `action`. |
| Color Grading | `/command`: `command=color_grading.wheel.set` + `region`, `hue`, `saturation`; `color_grading.value.set` + `control`, `value`; `color_grading.region.reset` + `region`; `color_grading.value.reset` + `control`; `color_grading.view.set` + `view`. |

Choose a command card and enter its required values. The server and Lightroom still validate context, capability and runtime ranges; generating a URL does not establish availability. For continuous controls that provide gesture routes, retain their begin/update/end/cancel ownership.

## Remove → Selected and mode feedback

Use GET `/remove/state` and the guarded GET `/remove/selection` action. Its exact fields are `field=selectedSelection`, `value` (`add`, `subtract`, `cancel` or `remove`), `mode`, `selectedPhotoUuid`, `contextCounter`, `developCounter`, `contextChangedAt`, `serverEpoch`, `stateRevision` and `selectionToken`, taken from the current available state and selection. Map `mode` from `newSpotType` (which must be `heal_patchmatch`), `stateRevision` from `revision`, and `selectionToken` from `selection.refinementToken` for Add/Subtract or `selection.token` for Cancel/Remove. Keep the existing capability checks, pending-operation gating and matching result handling in `app/controller-remove.js`; this is not a reusable URL. Add/Subtract work as command-only actions: delivery does not prove the active mode or brushing behavior. Check Lightroom for the active mode. The `/remove/selection-refinement-native`, `/remove/selection-native`, `/remove/selection-validate` and `/remove/selection-guard` routes are internal plug-in protocol.

Point Color Visualize Range works as a toggle, but has no active-mode feedback in LRBridge. Lens profile selection and configuration remain in Lightroom Classic.

## Quick Copy/Paste and Export

The Builder provides complete PowerShell scripts for these operations, fetching fresh state when executed rather than embedding a permanent action URL. The scripts and Web Controller follow this protocol, which custom clients must also preserve:

1. GET `/clipboard/state` (or `/export/state`). Poll the read-only state until `available` and the required capability are true, with a current selection and no pending operation/review. Reading state may enqueue a bounded SDK query. Do not infer clipboard validity from availability.
2. Capture the displayed selection/count. For one explicit user action create a unique `requestId`. Send exactly `command`, `requestId`, `serverEpoch`, `stateRevision`, `selectionToken`, `activeModule`, `selectedPhotoUuid`, `contextCounter`, `developCounter`, `contextChangedAt` as GET query parameters to the family's `/action`. `stateRevision` comes from the state response's `revision`. Copy commands are `clipboard.copy` (Quick Copy Settings) and `clipboard.paste`; Export commands are `export.dialog` and `export.previous`. The server supplies the accepted AI-update setting; do not add extra fields or use `/command` for these operations.
3. Inspect the admission response and poll the family's `/state` for the operation result. A transport exception is uncertain. Preserve the request ID/operation identity and stop; never silently create another request. The server consumes duplicate IDs. A stale state/selection rejection requires a fresh snapshot and another deliberate user action.
4. Show the actual result. Copy uses categories last chosen in Lightroom and the **active** source photo. Paste uses the explicit captured selection and requests AI updating. Batch true only proves at least one photo was processed. Pending AI updates and unknown status are distinct from completion. Export is request-only.
5. Required review remains visible. Only after explicit user review call the family's `/acknowledge` with that result's `serverEpoch` and `operationId`. It is not a retry. Re-read state before another user action.

Clipboard contents/categories/validity/version are not exposed by the SDK; native Copy may replace contents while a request waits. No preceding web Copy is required. Details: [Copy/Paste](COPY_PASTE_SETTINGS.md), [Export](EXPORT_CONTROLS.md).

## Other guarded operations

The inventory identifies these as workflows, not copy-ready URLs. The Builder does not yet generate standalone clients for them. Use the existing controller and its unchanged handlers:

- Undo/Redo: authoritative `/history/state`, shared gesture/pending-operation gating, the existing history command and subsequent state refresh. A static command alone does not reproduce controller availability safeguards.
- Masking: current photo/module/context/epoch/revision plus selected mask/component IDs. Creation, deletion, inversion, presets and local adjustments must preserve admission/result ownership. Consult the relevant controller and `docs/MASKING_COMPONENT_DELETION.md`.
- Healing, Reflections, People, Dust and Red Eye: capability/inventory snapshot → explicit action with exact target binding → matching result/state. Preserve confirmations, uncertainty review and existing AI/manual edits. Closed panels are not cancellation or processing completion.
- Develop presets and Profiles: resolve current inventory tokens/UUIDs, observe capability and target bindings, submit the guarded request, reconcile results. Native list/cursor presentation is not an SDK guarantee that a preset remains applied.
- Tone Curve, Point Color, Enhance and Masking corrections: use the implemented gesture start/update/end/cancel lifecycle where provided. Do not call an end route without an owned gesture or reuse stale revisions. Cancel local pending input on context loss, refresh authoritative feedback afterward and never turn a retry into another mutation.
- Lens Blur: main sliders and Bokeh/Apply have ordinary routes; Focus Range requires its expected prior value/commit readback. Subject/Point/refinement actions use the accepted Windows helper. Explicit Visualize Depth requires current photo/context and Windows state before its SDK toggle. These are not interchangeable with blind toggles.

The generated inventory lists actual registered methods/paths and their source file. Internal plug-in claims, validation, feedback and queue-consumption endpoints are identified separately; they are not controller actions. The current source modules remain authoritative for exact query/body schemas. The Builder never fabricates context tokens or strips required checks to make a URL reusable.
