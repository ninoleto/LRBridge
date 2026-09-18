# HTTP workflows for Windows v0.6

Direct API: `http://127.0.0.1:17891`. The controller at port 17892 proxies paths with `/api` prepended. Never mix the two prefixes. HTTP admission means queued, not Lightroom completion. Do not automatically retry a mutation after a timeout or uncertain response.

## Ordinary URLs

The Builder can generate existing Set/Adjust/Reset, Develop actions, Selection, Photo/Crop, Application and Color Grading URLs. Example: `/set?slider=Exposure&value=1.25`. These use validated native-current context and queue admission; they do not acquire the full captured-selection protocol of Export/Paste. `/command?command=photo.crop_aspect&mode=custom&w=16&h=10` **applies** that aspect ratio; the web controller's own Custom Crop button opens its input dialog.

## Quick Copy/Paste and Export

The Builder inventories these operations but does **not** generate permanent action URLs. Use the Web Controller, or implement this protocol in a client:

1. GET `/clipboard/state` (or `/export/state`). Poll the read-only state until `available` and the required capability are true, with a current selection and no pending operation/review. Reading state may enqueue a bounded SDK query. Do not infer clipboard validity from availability.
2. Capture the displayed selection/count. For one explicit user action create a unique `requestId`. Send exactly `command`, `requestId`, `serverEpoch`, `stateRevision`, `selectionToken`, `activeModule`, `selectedPhotoUuid`, `contextCounter`, `developCounter`, `contextChangedAt` to the family's `/action`. `stateRevision` comes from the state response's `revision`. Copy commands are `clipboard.copy` (Quick Copy Settings) and `clipboard.paste`; Export commands are `export.dialog` and `export.previous`. The server supplies the accepted AI-update setting; do not add extra fields or use `/command` for these operations.
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
