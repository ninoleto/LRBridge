# LRBridge Codex Handoff

## Accepted checkpoint

- Branch: `feature/v0.6-more-sdk-and-web-controller`.
- The Develop Presets and Web Controller reorganization phase is manually accepted for checkpointing from base `7d02c06efb1ac051304993e7794aaaf98b6b8be0` with commit message `feat: add develop presets and reorganize web controller`.
- Preset Amount is included as implemented but experimental and known-incomplete. The two defects below are the first task for the next session; do not reinterpret this checkpoint as manual acceptance of Amount compatibility or rapid-input reconciliation.
- Git history, current production source, and current tests override stale or conflicting historical handoff text below.

## First next-session priority: Preset Amount follow-up

1. **Compatibility / fail-closed behavior.** Some presets do not react correctly to Amount; confirmed example AR01 causes Lightroom to change the selected preset to None and disable Lightroom's native Amount control. LRBridge incorrectly leaves its Amount control enabled and movable even though it has no effect. Research a reliable capability or application-success signal and fail closed when Amount is unsupported. Never infer compatibility from preset name, folder, alias, or missing settings.
2. **Rapid minus/plus monotonicity.** Repeated rapid Amount minus/plus presses are not reliably monotonic. The displayed desired value can advance and then roll back when polling or an earlier completion settles. Correct desired/submitted/committed reconciliation so stale feedback cannot overwrite newer queued intent.

The automated Preset Amount serial/coalescing tests pass, including the five-rapid-plus case, but manual Lightroom integration exposed behavior those tests do not cover. Preserve the current implementation until this follow-up is deliberately researched and corrected.

## Accepted Develop Presets and Web Controller scope (2026-09-02)

- The top-level order is Develop Sliders, Color Grading, Tone Curve, Presets, Selection, Application, Tools. Presets owns the touch-friendly configured/inventory pickers, ordered UUID configuration, Previous/Next controls, Preset Amount, and per-preset Update AI Settings behavior.
- Preset configuration keeps exactly one sticky `+ Add Presets` and one `Save Configuration` action. Alias drafts remain local and focused across authoritative polling and tab deactivation until Save.
- Develop Sliders, Color Grading, Tone Curve, and Presets share the identical 14-entry Jump-to model. Presets is last, navigation-only, and uniquely blue; configured preset names, folders, aliases, UUIDs, and cards never enter Jump-to.
- Develop Sliders and Presets share one authoritative B&W/Color treatment model, command path, feedback state, and polling lifecycle. Preset application never forces treatment.
- Tools contains Crop & Straighten, Healing, Red Eye, and Masking. Only those four stable top-level identities participate in its scoped collapse and Jump-to model; the eleven Develop collapse identities remain unchanged.
- Lens Corrections Manual and Transform reuse the authoritative `CropConstrainToWarp` Constrain Crop state. Ordinary polling controls were removed from the Electron UI while advanced file configuration remains supported.
- Lightroom's SDK exposes no reliable Make/Model/Lens Profile inventory. LRBridge does not implement a picker; specific lens profiles can be applied through ordinary configured Develop presets.

## Checkpoint verification and lifecycle

- Current checkpoint verification evidence is recorded by the final checkpoint run and in `CODEX_HANDOFF.local.md`.
- The known protected-document `test:contract` mismatch remains `Generated Companion document is missing slider LensBlurAmount`; do not modify the protected Companion files to hide it.
- Manual Lightroom/Web Controller acceptance already included the required Node/server restart, production plug-in reload, and browser refresh for this phase. Checkpoint documentation, staging, commit, and push do not require another restart, plug-in reload, or browser refresh.

## Accepted Point Curve behavior

- Composite/RGB, Red, Green, and Blue use authoritative Lightroom SDK feedback from their four PV2012 curve fields. State remains bound to the selected-photo UUID, context counter, Develop revision, and Point Curve revision.
- The graph renders Adobe's raw natural-cubic spline behavior from authoritative coordinates. It visually clips the spline to the graph without flattening or replacing Adobe's mathematics.
- RGB includes authoritative Refine Saturation value/range feedback and Lightroom-tracked slider, editor, and reset behavior.
- Linear, Medium Contrast, and Strong Contrast presets are supported, while the Lightroom curve name remains derived authoritative feedback.
- Interior-point selection and deletion are supported. Empty graph space is inert until the explicit one-shot Add Point mode is armed; an accepted insertion can continue as the same stable drag gesture.
- Mouse and touchscreen behavior is accepted, including tap selection, intentional-movement drag admission, enlarged touch targets, synchronous local gesture preview, and authoritative final settlement.
- Gesture end/cancel recovery, navigation cancellation, focus/visibility/reconnect refresh, command-queue validation, and stale feedback/response rejection are established. Browser previews never replace authoritative Lightroom state.

## Local preservation state

- `config/settings.txt` has an intentional local modification that must remain unstaged and preserved.
- `CODEX_HANDOFF.local.md` is intentionally ignored and contains verbose historical/diagnostic evidence. Read it only in targeted sections when needed, and do not modify it casually.
- Preserve `stash@{0}` unchanged. Its current object is `76bd3118f786b886a30dd81ce3b591f4e14f49fe`, and it contains only the protected cheat-sheet work.
- Preserve both protected cheat sheets unless explicitly authorized:
  - `app/companion-cheatsheet.html` (current SHA-256 `FFE9E61A3AB6655F53762A13D07EEC0E4EA1C67FC56A22C60CD44F4866671BFC`)
  - `docs/COMPANION_HTTP_CHEATSHEET.md` (current SHA-256 `C3B4019EBC588EC4D121252D3266A2B57CC110CB5EDD118ECA314B708CE82069`)

## Verification status

- The full `npm test` command has an established, base-reproduced protected-document mismatch in `test:contract`: `Generated Companion document is missing slider LensBlurAmount`.
- This mismatch is not a Point Curve regression and must not be repaired by changing either protected cheat sheet without authorization. The remaining suites pass when run separately.
- Use the focused scripts in `package.json` first (notably `npm run test:point-curve` for Point Curve); reserve the full suite for an appropriate checkpoint.

## Next authorized scope

1. Create one unified `TONE CURVE` section.
2. Add Point Curve and Parametric Curve tabs matching the Color Mixer tab design.
3. Add an authoritative Parametric Curve graph.
4. Order Parametric controls as: graph, three coupled split sliders, divider, then Shadows, Darks, Lights, and Highlights sliders.
5. Perform combined navigation, reset, mouse, touchscreen, and regression testing.
6. Create the final Tone Curve checkpoint after manual acceptance and authorization.
7. Begin HDR only after Tone Curve is accepted.

Do not expand the next scope into HDR before Tone Curve acceptance.

## Fresh-session startup

1. Read this file, then verify branch, `HEAD`, status/index, upstream, and ahead/behind counts; report material discrepancies before editing.
2. Confirm the intentional `config/settings.txt` change, ignored local handoff, protected cheat-sheet hashes, and unchanged `stash@{0}`.
3. Inspect current Git history, production source, and focused tests for the requested scope. Treat them as authoritative over stale handoff statements.
4. Read only the relevant local-handoff section if deeper diagnostic evidence is required.
5. Preserve all existing changes, run focused tests first, and obtain manual Lightroom/UI acceptance before any checkpoint request.

## HDR implementation-preparation audit (2026-08-30, read-only)

This section supersedes the stale Tone Curve roadmap above where the two conflict. Git is authoritative: the accepted Tone Curve checkpoint is now commit `ab146a57cb4025ca4d160d6a4dba7a3489486a7e` (`feat: complete interactive tone curve controller`), equal to `origin/feature/v0.6-more-sdk-and-web-controller` when this audit began. No HDR implementation or runtime probe has yet occurred.

### Evidence labels and sources

- **[Adobe-confirmed]** means documented by the downloaded Lightroom Classic 15.3 SDK reference or Adobe's public HDR documentation.
- **[MIDI2LR-confirmed]** means present in the verified MIDI2LR source at commit `e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc`; it is strong implementation evidence, not an Adobe API guarantee or a live LRBridge result.
- **[LRBridge-confirmed]** means established by current production source.
- **[Inference / probe required]** means the expected integration behavior still needs a bounded Lightroom test before implementation.

Primary evidence:

- Downloaded SDK: `C:\Users\nino\Downloads\LrC_15.3_SDK\API Reference\modules\LrPhoto.html` lists `HDREditMode`, `HDRMaxValue`, `SDRBrightness`, `SDRContrast`, `SDRClarity`, `SDRHighlights`, `SDRShadows`, `SDRWhites`, and `SDRBlend` as numeric Develop settings first supported in SDK 13.0. It does not publish fixed ranges for them.
- Downloaded SDK: `LrDevelopController.html` documents generic `getValue`, `getRange`, `setValue`, `resetToDefault`, and `addAdjustmentChangeObserver` behavior in Develop, but its named parameter catalog does not explicitly list these HDR/SDR keys. Consequently, the key names and numeric types are Adobe-confirmed, while per-key controller support remains an inference until probed.
- MIDI2LR `Database.lua:451-467` defines `HDREditMode` as an experimental button and defines all seven `SDR*` controls as parameters with reset actions. `Database.lua:1235-1260` places the seven scalar controls, but not the button, in its generic parameter pipeline.
- MIDI2LR `Client.lua:196` toggles `HDREditMode` through `getValue`/`setValue`; `Client.lua:834-925` sends scalar values through dynamic ranges; `Client.lua:937-960` reads all generic parameters after an adjustment-observer callback; `Client.lua:1014-1032` implements generic resets; and `Client.lua:1059-1079` installs the observer.
- MIDI2LR `ClientUtilities.lua:377-384` implements the experimental HDR toggle as `0`/`1`. `Limits.lua` obtains every scalar parameter's bounds from `LrDevelopController.getRange`; MIDI2LR does not carry static HDR ranges.
- Adobe HDR documentation: <https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/hdr-output.html>. HDR processing requires Process Version 3 or later. Correct HDR visualization depends on GPU/display capability. The Preview for SDR Display UI controls the visible SDR rendition, while the SDR rendition settings also affect SDR export/tone mapping. HDR Tone Curve uses a `0-500` domain rather than SDR's `0-255` domain.

### Per-parameter operation map

No row below is a live LRBridge verification. “Expected” records what the SDK's generic contract plus MIDI2LR's actual implementation support; each expectation must be confirmed on the installed Lightroom version before production exposure.

| Parameter | `getValue` | `getRange` | `setValue` | `resetToDefault` | Observer / authoritative feedback | Smallest safe next-session probe and principal risk |
| --- | --- | --- | --- | --- | --- | --- |
| `HDREditMode` | **Expected**, numeric `0`/`1`; MIDI2LR reads it. | **Do not depend on it.** MIDI2LR treats this as a button and never routes it through `getRange`; record a diagnostic result only. The logical UI range is `0..1`. | **Expected** for explicit `0` or `1`; MIDI2LR writes it. LRBridge should never use a stale read-modify-write toggle. | **Not established and outside the first implementation.** MIDI2LR has no reset action for it; configure `resetSupported: false`. | LRBridge can authoritatively poll `getValue` and include it in the Develop fingerprint. Whether the SDK adjustment observer fires for this key is unknown; MIDI2LR's observer loop excludes buttons. | On one disposable Process Version 3+ photo, record the original value and Develop setting, attach a temporary observer, explicitly write the inverse once, read immediately and after settlement, then explicitly restore the original and verify UUID/context/process version. Record `getRange` only as a diagnostic. The key is marked **Experimental** by MIDI2LR, and a mode change could alter availability or Lightroom UI state. |
| `SDRBrightness` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, through Lightroom's native default; never hard-code the default. | MIDI2LR confirms it participates in the generic adjustment-observer readback loop. LRBridge's existing authoritative request/poll path should work even without adding a new SDK observer. | With HDR enabled and Preview for SDR Display manually enabled, record value/range, write one interior in-range step, verify callback/readback, invoke native reset and record its result, then restore and verify the exact original. Risk: no published fixed range or default, and the visual effect depends on Lightroom's UI-only preview state. |
| `SDRContrast` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, native Lightroom reset. | Same confirmed MIDI2LR scalar observer path and expected LRBridge polling path as `SDRBrightness`. | Perform the same one-step/reset/restore sequence for this key. Capture the actual runtime range/default rather than inferring them from another SDR control. |
| `SDRClarity` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, native Lightroom reset. | Same confirmed MIDI2LR scalar observer path and expected LRBridge polling path. | Perform the same one-step/reset/restore sequence for this key. Do not assume its range matches SDR Contrast merely because MIDI2LR displays both as integer controls. |
| `SDRHighlights` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, native Lightroom reset. | Same confirmed MIDI2LR scalar observer path and expected LRBridge polling path. | Perform the same one-step/reset/restore sequence for this key and retain the returned range/default as authoritative evidence. |
| `SDRShadows` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, native Lightroom reset. | Same confirmed MIDI2LR scalar observer path and expected LRBridge polling path. | Perform the same one-step/reset/restore sequence for this key and verify no mode or process-version side effect. |
| `SDRWhites` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, native Lightroom reset. | Same confirmed MIDI2LR scalar observer path and expected LRBridge polling path. | Perform the same one-step/reset/restore sequence for this key and record both immediate and settled authoritative readback. |
| `SDRBlend` | **Expected**, numeric. | **Expected**, dynamically from Lightroom; exact min/max remain unknown. | **Expected**, bounded by the returned runtime range. | **Expected**, native Lightroom reset. | Same confirmed MIDI2LR scalar observer path and expected LRBridge polling path. | Perform the same one-step/reset/restore sequence for this key. Treat its range and reset value as independent; do not infer percentage semantics from its name. |

For the seven scalar probes, use a single disposable selected photo already on Process Version 3 or later, keep its UUID/context stable, choose one interior value rather than a boundary, and restore every exact original value before leaving the probe. The observer evidence must distinguish “callback fired” from “callback identified this specific key”; LRBridge may retain its existing polling architecture regardless.

### Exact LRBridge extension map

Lightroom plug-in boundary:

- `lightroom/LRBridge.lrplugin/Driver.lua:8-111` — extend `sliderMap` with the eight SDK keys. `Driver.lua:113-125` must reveal Lightroom's `adjustPanel` for these controls, as MIDI2LR does, instead of calling `revealPanel` with a raw SDR key. Existing `adjustSlider`, `setSlider`, and `resetSlider` paths at `Driver.lua:127-190` can serve the seven scalars after probing. `HDREditMode` should use explicit set operations only and no reset.
- `lightroom/LRBridge.lrplugin/Query.lua:5-108` — extend `developControllerMap`; the generic value/range functions at `Query.lua:110-152` should support the seven scalars. Add a deliberate `HDREditMode` value path with logical `0..1` semantics rather than trusting an undocumented range.
- `lightroom/LRBridge.lrplugin/Commands.lua:77-125` — the existing `develop.adjust`, `develop.set`, `develop.reset`, and `develop.get` dispatches require no new command family. Admission must prevent reset for `HDREditMode`.
- `lightroom/LRBridge.lrplugin/FeedbackPolling.lua:43-146` — add the eight watched values. Generic value/range reads at `FeedbackPolling.lua:531-662` and request handling at `FeedbackPolling.lua:785-867` should be reused. Scalar feedback is currently authoritative polling/fingerprinting, not a per-slider SDK observer: only Tone Curve installs an adjustment observer today. `getDevelopFingerprint` at `FeedbackPolling.lua:338-369` and the `0.75` second heartbeat at `FeedbackPolling.lua:379-464` must include the new authoritative values. An HDR-specific observer is optional only after the probe proves a need.

Server contracts and settlement:

- `config/sliders.json` — add metadata for the seven runtime-ranged numeric controls and one explicit authoritative `0`/`1` switch. Use no guessed static range/default; `HDREditMode` must have `resetSupported: false`.
- `server/sliders.js:4-72` — reuse runtime-range/effective-range handling for the scalars, but first add a way to clear a stale runtime range and require a fresh current-context runtime range before admitting HDR writes. The present map outlives a selected-photo context, which is unsafe for experimental or unavailable keys.
- `server/commands.js:114-120,468-507,701-720,1055` — extend only the existing Develop slider allowlist/metadata validation and coalescing paths. Seven scalars use ordinary range-validated set/reset behavior. `HDREditMode` admits only explicit `0`/`1` set values and rejects reset.
- `server/bridge.js:320-357` — clear the new sliders' feedback and runtime ranges on context change. `/sliders` at `server/bridge.js:359-363`, generic `/api/set`, `/api/reset`, and `/api/get` handling at `server/bridge.js:1530-1720`, and feedback result/snapshot handling at `server/bridge.js:1751-2135` remain the transport. Do not create optimistic HDR state.
- `server/context.js:6-56` — preserve the existing selected-photo fingerprint, context counter, and Develop revision semantics unchanged.

Web Controller and focused contracts:

- `app/controller.html:2190-2238` — add labels; `app/controller.html:3099-3196` — add all eight to the explicit feedback-supported set; `app/controller.html:8338-8349` — add a separate HDR/SDR Rendition section without touching Tone Curve.
- `app/controller.html:4395-4453` — represent `HDREditMode` as an explicit Off/On authoritative switch. The current zero/one switch renderer is a starting point, but its pending/timeout state should be brought under the same authoritative settlement discipline as sliders; active state must come only from feedback.
- `app/controller.html:4650-5137` — reuse the established desired-value, targeted-feedback, timeout, reset, and context-cancellation settlement for the seven scalar controls. Native reset must settle from authoritative readback, not a hard-coded expected default.
- `app/controller.html:3775-3969` and `app/controller.html:9773-9780` — reuse the `500` ms live feedback snapshot and metadata filtering. A nil/error/non-numeric value or missing current-context range means unavailable; do not fabricate an enabled control merely because metadata exists.
- Add a focused HDR Develop-settings contract test (prefer a new `tests/hdr-develop-settings.js`) and the minimum display-order/settlement assertions in `tests/generic-develop-sliders.js`. Keep `app/controller-tone-curve.js`, `tests/tone-curve-splits.js`, `tests/point-curve.js`, Parametric calibration, and Point Curve mathematics unchanged.

### Availability and representation limits

- **[Adobe-confirmed]** HDR editing requires a photo using Process Version 3 or later. `LrDevelopController` operations require an active selected photo and the Develop module.
- **[Adobe-confirmed]** correct HDR visualization depends on Lightroom's GPU and physical HDR-display support. LRBridge cannot derive authoritative display headroom or whether the user is actually seeing HDR from these Develop-setting keys.
- **[MIDI2LR-confirmed]** each SDR control warns that Preview for SDR Display must be enabled for it to work properly. No documented SDK key was found for that UI switch. LRBridge therefore must not claim authoritative preview active/inactive state or emulate it.
- **[Inference / probe required]** the eight keys may return nil, error, or no useful range when the selected photo/mode/process version is ineligible. Treat that as authoritative unavailability and retry only after a context/Develop revision change or an explicit feedback refresh.
- **[Inference / probe required]** whether the seven SDR values remain readable/writeable with HDR mode or SDR Preview off, and whether enabling `HDREditMode` affects process version, must be observed rather than assumed.

### Explicit first-implementation boundary

The first useful phase is **medium scope** because it crosses Lua mapping/query/feedback, server admission/range invalidation, Web Controller settlement/availability, and focused tests. It is not a Tone Curve algorithm change. It can and should be implemented without modifying the accepted Parametric B-spline renderer, `parametricCurveOutputAt()`, Point Curve renderer/mathematics, or any Tone Curve calibration/interaction contract.

Keep all of the following outside that phase:

- `HDRMaxValue` / HDR Limit.
- Preview for SDR Display.
- Visualize HDR.
- HDR Point Curve and its `0-500` domain.

### Ordered next-session plan

1. Reconfirm branch/HEAD/upstream equality, empty index, the intentional `config/settings.txt` change, protected-file hashes, ignored local handoff, and `stash@{0}` before any mutation.
2. Run the bounded live probe above on one disposable Process Version 3+ photo: first `HDREditMode`, then each scalar independently. Capture exact values, ranges, native defaults, observer behavior, nil/error behavior, Develop revision changes, and restore verification in `CODEX_HANDOFF.local.md`.
3. Decide from the probe whether `HDREditMode` is safe enough to expose. If its explicit write/read/restore or context behavior is not deterministic, defer the mode switch and do not infer state from the Lightroom UI.
4. Implement current-context runtime-range invalidation and unavailable-state admission in the server before exposing any scalar write route.
5. Add the Lua key/panel/query/feedback mappings. Preserve command queue, gesture lifecycle, UUID/context counter, Develop revision, and stale-response safeguards. Request exactly one Lightroom plug-in reload after all Lua changes are ready.
6. Add metadata and the separate HDR section: authoritative Off/On mode switch plus seven ordinary SDR numeric controls, all driven by feedback and current runtime ranges. State the Preview for SDR Display limitation in the UI without trying to control it.
7. Add and run only focused HDR/generic-slider contracts, JavaScript/Lua syntax checks as applicable, `git diff --check`, and unchanged Tone Curve/Point Curve regression contracts. Do not run the full suite until a later authorized checkpoint.
8. Manually validate mode, scalar write/reset, settlement, navigation, unavailable-state behavior, and exact restoration on the disposable photo. Do not start HDR Limit, display-only switches, or HDR curve work from that validation.

## Final HDR SDK probe checkpoint and account-switch handoff (2026-08-31)

This section supersedes every earlier statement that the HDR runtime probe is still pending. The bounded capability probe is complete and passed. Production HDR/UI/server implementation has **not** started. The accepted Tone Curve checkpoint remains `ab146a57cb4025ca4d160d6a4dba7a3489486a7e`; do not change its implementation, calibration, tests, or layout while adding HDR.

### Final observed Lightroom behavior

- The approved disposable virtual copy was UUID `F8F9A6E4-066F-4568-904A-5C729962B332`, `isVirtualCopy=true`, in Develop with LRBridge context counter `4`, Develop revision `3`, queue length `0`, controller Process Version `Version 6`, and Develop-settings Process Version `15.4`.
- `HDREditMode` reports runtime range `0..1`. An explicit `0 -> 1 -> 0` probe passed: both `LrDevelopController.getValue()` and `photo:getDevelopSettings()` reported `1` immediately and through three settled samples, then reported the exact restored original `0` immediately and through three settled samples. The seven SDR values stayed `0`. No reset was called for `HDREditMode`.
- The mode probe installed the adjustment observer successfully and recorded four callbacks. UUID, selected-photo object, virtual-copy state, Develop module, context, process version, and queue remained unchanged.
- `SDRBrightness`, `SDRContrast`, `SDRClarity`, `SDRHighlights`, `SDRShadows`, `SDRWhites`, and `SDRBlend` each report runtime range `-100..100` on the approved HDR-enabled photo.
- With HDR Edit Mode and Preview for SDR Display enabled manually, every scalar passed the sequential isolated operation `0 -> setValue(parameter, 25) -> resetToDefault(parameter) -> 0`. Each set and reset call was admitted, raised no error, and returned no values. Every native reset restored the exact original `0`; no emergency `setValue(parameter, 0)` path ran, and no non-active scalar changed.
- For all seven scalar writes, `getValue()` reported `25` immediately while `getDevelopSettings()` still reported `0`. The settings snapshot converged to `25` after approximately `2.01-2.09` seconds and then agreed for three consecutive settled samples. Reset readback was immediately `0` through both APIs and remained stable.
- The scalar probe recorded fourteen observer callbacks, a net two per isolated scalar probe. The generic callback does not identify its parameter, so do not claim stronger per-operation attribution than the evidence provides.
- LRBridge Develop revision remained `3` throughout both probes even though authoritative HDR values changed. This is the expected current defect because the eight HDR fields are not yet part of the Develop fingerprint. Add all eight before relying on the revision for HDR feedback invalidation.
- Preview for SDR Display was enabled manually for the scalar probe, but no SDK-readable or SDK-writeable control was found. Production must present this as an informational limitation, never as authoritative state.
- In the Library module, controller `getValue`, `getRange`, and `getProcessVersion` calls returned nil for these fields while `getDevelopSettings()` remained readable. This establishes the required module-unavailable behavior: nil/missing current-context values or ranges are unavailable, not defaults.

### Required first production phase

- Add `HDREditMode` as an authoritative explicit Off/On control. Send only explicit `0` or `1`; never use a stale read-modify-write toggle. It has no Reset action.
- Add the seven SDR controls using Lightroom's current runtime range, native parameter reset, and immediate `LrDevelopController.getValue()` feedback. Label `SDRBlend` as **Highlight Saturation**.
- Add all eight fields to the canonical authoritative Develop fingerprint. Preserve UUID, context-counter, Develop-revision, command-queue, gesture, and stale-response safeguards.
- Clear HDR values and runtime ranges on selected-photo, context, and module changes. A nil/error/non-numeric value or nil/missing current-context range means unavailable. Never retain or reuse a range from an earlier photo/context.
- Do not wait for the approximately two-second `getDevelopSettings()` settlement. Production live authority is immediate `LrDevelopController` feedback; `getDevelopSettings()` may be used only as optional settled diagnostics.
- Create no optimistic HDR state. The Web Controller must render only matching authoritative current-context feedback.
- Add a separate **HDR / SDR Rendition** section. Include an informational statement that Preview for SDR Display must be enabled manually and cannot be observed or controlled by LRBridge.
- Keep `HDRMaxValue` / HDR Limit, Preview for SDR Display control, Visualize HDR, and HDR Point Curve outside this phase.
- Do not modify the accepted Tone Curve implementation or layout.

### Preserved probe evidence

Keep the temporary evidence until the production HDR phase receives manual Lightroom/Web acceptance:

- `__TEMP_HDR_SDK_PROBE_20260830_evidence/baseline-library.tsv` — SHA-256 `95AACEBAB19F3F4AD8235CB3F8BF389E10786F84F8CA2B7EB97895092EED158F`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/baseline-original-photo.tsv` — SHA-256 `19E1A1F89EA23B81DB903618CF0AFCF4FA77B7770772F2664D2BB8E58E1301BD`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/baseline-virtual-copy.tsv` — SHA-256 `D0F9C9F884FC6BD60A7085CCF0BF5D037D29CE55D2CE510B304EE2FFD431084B`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/baseline-hdr-enabled-sdr-preview.tsv` — SHA-256 `53F797D617E601244FD5CA071E9FD1115ACB190155D6649556CB9D50B7A5C1CC`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/hdr-edit-mode-attempt.tsv` — SHA-256 `283E081D1EFBE6F18B9A1D81D262EEC8FE997A9C72DEDB621A60C6CC512F8E1B`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/hdr-edit-mode-result.tsv` — SHA-256 `070D24C6AD9A8D58F874CC312644DD1F9647816E58108D84D04D0453252AACB9`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/sdr-scalars-sequential-attempt.tsv` — SHA-256 `CE7C7C91178225498A62B246D355B72AD8EED35CC9921925D95BE34C7DC8EB19`
- `__TEMP_HDR_SDK_PROBE_20260830_evidence/sdr-scalars-sequential-result.tsv` — SHA-256 `8CD1B919D58F0128C66475F4570D4214FEECE8DAC5EB6E92248BD9A0407B6676`

The independent plug-in and evidence directories remain intentionally untracked: `__TEMP_HDR_SDK_PROBE_20260830.lrplugin/` and `__TEMP_HDR_SDK_PROBE_20260830_evidence/`. Remove **TEMP LRBridge HDR SDK Baseline (Read Only)** from Lightroom Plug-in Manager before any production LRBridge source restart. Do not delete either directory or its evidence until manual HDR acceptance.

### Repository preservation state

- Branch: `feature/v0.6-more-sdk-and-web-controller`.
- `HEAD`: `ab146a57cb4025ca4d160d6a4dba7a3489486a7e` (`feat: complete interactive tone curve controller`).
- Configured upstream resolves to the identical commit; ahead/behind is `0/0`.
- The Git index is empty.
- Modified tracked files are only `CODEX_HANDOFF.md` (the pre-existing uncommitted HDR audit plus this final checkpoint) and `config/settings.txt`.
- `config/settings.txt` retains the intentional unstaged line `minimize_behavior=normal`; SHA-256 `9ADBD48B3F4B42E32C2FA722F9A80313A7232A668BA40B0A7E44E11323D067E3`.
- Preserve `stash@{0}` at object `76bd3118f786b886a30dd81ce3b591f4e14f49fe`, subject `Preserve protected cheat-sheet WIP after Profile checkpoint`.
- Protected files remain untouched:
  - `app/companion-cheatsheet.html` — SHA-256 `FFE9E61A3AB6655F53762A13D07EEC0E4EA1C67FC56A22C60CD44F4866671BFC`
  - `docs/COMPANION_HTTP_CHEATSHEET.md` — SHA-256 `C3B4019EBC588EC4D121252D3266A2B57CC110CB5EDD118ECA314B708CE82069`
- `CODEX_HANDOFF.local.md` is ignored and contains the detailed probe timeline. No production file, test, Tone Curve file, protected file, stash, or index entry was changed by the probe/handoff work.

### Fresh-account start order

1. Read `AGENTS.md`, this final section, and the final HDR section at the end of `CODEX_HANDOFF.local.md`; treat Git and production tests as authoritative.
2. Reverify branch/HEAD/upstream equality, empty index, exact tracked/untracked status, config and protected hashes, and `stash@{0}` before editing.
3. Confirm the temporary probe plug-in has been removed from Lightroom Plug-in Manager before requesting any production LRBridge source restart.
4. Preserve all temporary evidence until manual HDR acceptance.
5. Implement only the bounded eight-control phase above with focused tests and one explicit Lightroom plug-in reload request when all production Lua changes are ready. Do not begin excluded HDR features or alter Tone Curve.

## HDRMaxValue capability checkpoint (2026-08-31)

This section supersedes the earlier exclusion of `HDRMaxValue` / HDR Limit. The dedicated read-only and write/reset/restore probes passed on the approved disposable virtual copy. Production implementation is now authorized only for `HDRMaxValue`, placed as **HDR Limit** immediately after HDR Edit Mode in the existing HDR / SDR Rendition section. Preview for SDR Display, Visualize HDR, and HDR Point Curve remain unsupported.

### Accepted runtime behavior

- `HDRMaxValue` was numeric and available through `LrDevelopController.getValue()`, `getRange()`, and `photo:getDevelopSettings()` in Develop. Eight read-only samples were stable and agreed at original value `2.3`; runtime range was `1..8`.
- The tracked operation `startTracking("HDRMaxValue") -> setValue("HDRMaxValue", 2.4) -> stopTracking("HDRMaxValue", false)` completed without error or Lua return values. Controller and Develop settings both reported `2.4` immediately and remained equal for three stable samples; recorded settlement was approximately `0.34` seconds.
- `resetToDefault("HDRMaxValue")` completed without error or Lua return values. Its observed default on this virtual copy was `2.3`; both APIs agreed immediately and for three stable samples, with approximately `0.36` seconds settlement. Do not hard-code `2.3` as a universal default.
- The explicit tracked restore to exact original `2.3` passed and was proven through three stable controller/settings samples. `trackingMayBeActive=false`; no emergency restoration ran.
- Three generic adjustment-observer callbacks occurred: one each across target, reset, and explicit restoration. All eight already implemented HDR/SDR fields remained unchanged across the probe. UUID, virtual-copy identity, Develop module, Process Version 6, HDR mode, current range, context, Develop revision, and empty queue remained valid; final status was `passed` with no failure.

### Preserved HDRMaxValue evidence

- `__TEMP_HDRMAXVALUE_READONLY_PROBE_20260831_evidence/README.txt` — SHA-256 `C7DCCC09EAA71DE1EA17ECF99E9453954A7325607477C66E70E6AC05B4D2B3C9`
- `__TEMP_HDRMAXVALUE_READONLY_PROBE_20260831_evidence/hdr-max-value-read-only-result.tsv` — SHA-256 `53F809E1CD270422E100FD18C1756772770AA5CD16F524259A7A1EFE460F4C45`
- `__TEMP_HDRMAXVALUE_WRITE_PROBE_20260831_evidence/README.txt` — SHA-256 `F8F03F03FCB58F0007EFFF236EB8691D2F50ECAA658043AC66BB4B68B7D83499`
- `__TEMP_HDRMAXVALUE_WRITE_PROBE_20260831_evidence/hdr-max-value-write-attempt.tsv` — SHA-256 `393BF1AB42D1BEBC2C7ECBD3F26F1C4BA831762DAB8C1AFE5E1976F0384B6D35`
- `__TEMP_HDRMAXVALUE_WRITE_PROBE_20260831_evidence/hdr-max-value-write-result.tsv` — SHA-256 `4915BED1C533BA873C39437FA03D22FCA0FF3939558F0CD4C0D3BD93B3169B76`

Preserve both HDRMaxValue temporary plug-ins and evidence directories unchanged until final manual HDR acceptance.

## HDRMaxValue production implementation complete; manual acceptance pending (2026-08-31)

This section supersedes the earlier statement that production HDR/UI/server implementation had not started. The current unstaged working tree implements the authoritative HDR / SDR Rendition phase plus `HDRMaxValue` as **HDR Limit**. It is source-verified but is not yet an accepted checkpoint: one full LRBridge Electron/server restart, one production Lightroom plug-in reload, and manual Lightroom/Web Controller acceptance remain required.

### Completed HDR Limit path

- `HDRMaxValue` is registered immediately after `HDREditMode` and before the seven SDR rendition controls. The Web Controller label is **HDR Limit**.
- Its displayed and admitted numeric contract is `1..8`, step `0.1`, precision `1`, but writes fail closed until a matching current-context runtime range has been received from Lightroom.
- The Lightroom write path uses the probed `startTracking("HDRMaxValue") -> setValue(...) -> stopTracking(false)` sequence. Reset uses Lightroom's native `resetToDefault`; the observed probe value `2.3` is not a production default.
- Driver preparation reveals `adjustPanel`. Query and feedback use direct controller value/range reads, and `HDRMaxValue` participates in the watched Develop fingerprint, targeted feedback, selected-photo identity binding, context-counter/runtime-range invalidation, queue binding/dequeue rejection, and authoritative Web Controller settlement.
- `HDREditMode` remains an explicit authoritative Off/On set-only control with no reset. Preview for SDR Display remains informational and manual. Visualize HDR and HDR Point Curve remain excluded.

### Final source review and focused verification

- The complete HDR Limit diff was reviewed across metadata, Lua driver/query/feedback, server admission/context/queue handling, Web Controller rendering/settlement, and focused tests. No unfinished or accidental production change remained.
- `tests/queue-diagnostics.js` had a brittle reset fixture that selected a registry entry by position; the new HDR registry order made that position resolve to non-resettable `HDREditMode`. The fixture now names resettable `Exposure` directly. Two stale slider-count assertions were also advanced to `111` total / `110` authoritative-feedback definitions.
- Passed: `npm run test:hdr-develop`, `npm run test:sliders`, `npm run test:controller-feedback`, `npm run test:controller-commands`, `npm run test:queue`, `npm run test:diagnostics`, `npm run test:lua-polling`, `npm run test:polling-contract`, `npm run test:tone-curve`, and `npm run test:point-curve`.
- Explicit `node --check` passed for the changed server and focused test JavaScript; JSON parsing passed for `config/sliders.json` and `package.json`. The controller inline script also parsed through `test:controller-commands`. No standalone Lua interpreter/compiler is installed; the focused Lua source-contract suites above passed.
- `git diff --check` passed after the final handoff updates.
- The full suite was not run. The established protected-cheat-sheet `test:contract` mismatch remains outside this scope.

### Required next action

Do not stage, commit, push, delete probe evidence, or request another implementation change before manual acceptance. Perform exactly one full LRBridge Electron/server restart and exactly one reload of the production plug-in `lightroom/LRBridge.lrplugin`, then validate HDR Limit value feedback, `0.1` writes, native reset, position, unavailable state, and photo/module navigation invalidation in the Web Controller.

## HDR / SDR Rendition accepted checkpoint (2026-08-31)

This section supersedes the preceding manual-acceptance and probe-preservation instructions. The HDR / SDR Rendition implementation is manually accepted and authorized for checkpointing.

### Accepted behavior and boundary

- HDR Edit Mode is an authoritative explicit Off/On control. HDR Limit is authoritative, uses the runtime `1..8` range, actual `0.1` SDK value steps, tracked writes, native Lightroom Reset, and base-2 logarithmic visual positioning (`1`, `2`, `4`, `8` at `0%`, `33.33%`, `66.67%`, `100%`).
- The seven authoritative SDR Rendition controls remain Brightness, Contrast, Clarity, Highlights, Shadows, Whites, and Highlight Saturation (`SDRBlend`). All HDR values/ranges remain current-context bound, fail closed when unavailable, and participate in authoritative feedback, fingerprinting, and context invalidation.
- The accepted Web Controller layout has three blocks: HDR Edit Mode, HDR Limit, and SDR RENDITION SETTINGS, with HDR-only dividers and the limitation notes in their accepted positions.
- Visualize HDR and Preview for SDR Display remain manual-only. LRBridge has no verified authoritative SDK activation, getter, or active-state feedback for either control. MIDI2LR, LrControl, and TourBox provide no verified authoritative solution for those two toggles.
- The complete diff was reviewed without finding probe references, accidental debug code, an HDR reset hard-coded to `2.3`, stale registry counts, or unrelated production changes. Tone Curve and Point Curve behavior remains unchanged.

### Probe archive and cleanup

- The user confirmed all three temporary HDR probe plug-ins were removed from Lightroom Plug-in Manager before cleanup.
- Archive: `D:\Projects\LRBridge_HDR_probe_archive_20260831.zip`
- Archive size: `111934` bytes; entries: `23`; SHA-256: `D9ACDDC81FF15E00C1F0D70D2F6953A07F7EA1E8FAFE59948C6C8EA996617A94`.
- Validation matched every archived entry name, length, and SHA-256 to the six source/evidence trees and found no extra archive root. The archive hash was revalidated after cleanup.
- Only the six authorized temporary directories were deleted. All six are absent from the repository; the external archive remains intact.

### Final verification

- Final `npm test` exits `1` only at `test:contract`: `Generated Companion document is missing slider LensBlurAmount`. This is the pre-existing protected-document failure at `HEAD` `ab146a57cb4025ca4d160d6a4dba7a3489486a7e`: the `HEAD` Controller exposes `LensBlurAmount`, the protected `HEAD` Companion document omits it, and the `HEAD` fixture excludes only `ProfileAmount`. The protected document was deliberately not modified.
- Every suite component before that gate passed in the final run. Every component after the gate passed when run individually. HDR-induced contract count/hash/group/order drift was corrected; the contract now reaches only the verified `LensBlurAmount` baseline failure.
- Focused PASS: `test:hdr-develop`, `test:sliders`, `test:controller-feedback`, `test:controller-commands`, `test:queue`, `test:diagnostics`, `test:tone-curve`, `test:point-curve`, `test:lua-polling`, `test:lua-selection`, and `test:polling-contract`.
- Required fixture PASS: `test:profile-amount`, `test:http-builder`, and `test:constrain-crop`. The corrections scope the shared Profile Amount writer assertion around the dedicated HDR Limit branch, model current runtime ranges for fail-closed Builder commands, advance the accepted Builder count to `328`, and avoid assuming every Develop row uses the generic slider factory.
- Explicit JavaScript syntax checks passed for all changed server/test `.js` files; the inline Controller script parsed successfully. `package.json`, `config/sliders.json`, and `tests/contract-fixture.json` parsed successfully. No standalone `luac` is installed, so Lua validation is the passing polling, selection-dispatch, and serialization source-contract coverage. Final `git diff --check` passed.

### Preservation and checkpoint state

- `config/settings.txt` remains the intentional unstaged user preference containing only added `minimize_behavior=normal`; SHA-256 `9ADBD48B3F4B42E32C2FA722F9A80313A7232A668BA40B0A7E44E11323D067E3`.
- Protected files remain unchanged: `app/companion-cheatsheet.html` SHA-256 `FFE9E61A3AB6655F53762A13D07EEC0E4EA1C67FC56A22C60CD44F4866671BFC`; `docs/COMPANION_HTTP_CHEATSHEET.md` SHA-256 `C3B4019EBC588EC4D121252D3266A2B57CC110CB5EDD118ECA314B708CE82069`.
- `stash@{0}` remains object `76bd3118f786b886a30dd81ce3b591f4e14f49fe`, subject `Preserve protected cheat-sheet WIP after Profile checkpoint`.
- Implementation checkpoint commit: `f15531f60381f478431ff94e871c631beb8b9082` (`feat: add HDR and SDR rendition controls`).

## Crop controller accepted checkpoint (2026-08-31)

The user manually accepted the Crop controller after the required one-time LRBridge restart and Lightroom production plug-in reload. Do not request another reload for this checkpoint.

### Accepted layout and behavior

- Crop renders **Aspect Ratio** first and **Angle** second. Aspect retains Original, Camera Crop, all accepted fixed ratios, and Custom Aspect behavior. Angle retains authoritative feedback, text editing, slider, step controls, and Angle Reset.
- One subdued informational line follows Angle and precedes the bottom action bar: `Auto Straighten, Constrain to Image, and Tool Overlay must be controlled manually in Lightroom because they are not exposed through the SDK.` There are no fake, disabled, or separate limitation controls/sections.
- The bottom bar keeps **Reset Crop** on the left and an authoritative **Open Crop Tool** / **Close Crop Tool** action on the right. Open explicitly selects `crop`; Close explicitly selects `loupe`. Legacy `selectCropTool` without `target` explicitly selects `crop`.
- `target` is strictly limited to `crop|loupe` through HTTP admission, server command validation, Lua parsing, and Lua dispatch. Other actions reject a target. Presentation changes only from authoritative `getSelectedTool()` feedback; missing feedback disables the action, and submission does not optimistically change state.
- Crop Angle and categorical feedback poll while Crop is active and clean up on tab exit. Existing UUID/context/Develop-revision, queue, stale-response, accessibility, touch-size, keyboard-focus, and responsive-layout contracts remain intact.

### Final SDK boundary

- Lightroom Classic 15.3 documents no exact Crop Auto Straighten invocation, success/failure contract, or operation-specific completion signal. A manually produced result can still appear through authoritative `straightenAngle` feedback.
- Crop-tool **Constrain to Image** has no documented authoritative readable/writeable SDK interface and is distinct from Transform's `CropConstrainToWarp` / Constrain Crop setting.
- Crop Tool Overlay **Always / Auto / Never** has no documented authoritative SDK state or control. No keyboard, mouse, UI automation, optimistic state, presets, Upright, Angle Reset, or zero-angle substitute is used for any unsupported control.

### Verification and preservation

- All 16 focused Crop/controller/transport/validation/polling/HTTP Builder suites passed. Explicit JavaScript syntax checks passed for every modified `.js` source and the Controller inline script. Adobe Lightroom Classic 15.3 `luac.exe -p` passed for all four modified Lua files. `git diff --check` passed.
- `npm test` exits `1` only at the unchanged protected `test:contract` gate: `Generated Companion document is missing slider LensBlurAmount`. Its eight preceding suites passed, and all 26 post-gate suites passed individually. The protected Companion files were not modified.
- Preserve the intentional unstaged `config/settings.txt` line `minimize_behavior=normal`, protected hashes `FFE9E61A3AB6655F53762A13D07EEC0E4EA1C67FC56A22C60CD44F4866671BFC` and `C3B4019EBC588EC4D121252D3266A2B57CC110CB5EDD118ECA314B708CE82069`, and `stash@{0}` object `76bd3118f786b886a30dd81ce3b591f4e14f49fe`.

## Develop navigation and safe Lens Blur depth checkpoint (2026-09-01)

This checkpoint is manually accepted. It is based on `95ed0f180bc902f576acc403cfe58cc3329b84ba` and is the commit containing this section with message `feat: add develop navigation and safe lens blur depth control`.

### Accepted Develop collapse and Jump-to behavior

- Persisted, accessible collapse controls exist only for these eleven top-level Develop Sliders sections: White Balance, Tone, HDR / SDR Rendition, Presence, Color Mixer, Detail, Lens Corrections, Transform, Lens Blur, Effects, and Calibration. Collapse state is filtered through that exact allowlist before restore or persistence.
- Dedicated Tone Curve and Color Grading tabs, Selection, Crop, Application, Retouching, individual sliders, and nested subsections have no collapse control or collapse identity. Collapsing an allowed Develop section first cancels active local slider, Point Color, Enhance Amount, and Lens Blur gestures; authoritative feedback polling continues for controls inside a collapsed body.
- Develop Sliders, Tone Curve, and Color Grading expose the identical thirteen-entry Jump-to menu in exact Lightroom order: White Balance, Tone, HDR / SDR Rendition, Presence, Tone Curve, Color Mixer, Color Grading, Detail, Lens Corrections, Transform, Lens Blur, Effects, Calibration. The two dedicated entries use the existing tab-selection path; Develop entries retain heading-scroll navigation and existing collapse state.
- The menu uses two column-major columns while width permits and switches to sequential one-column order only at `520px` or narrower. Width controls column count independently from height.
- On open and window/visual-viewport resize, the menu measures the real usable height below its top edge with a small bottom margin. It expands naturally when all entries fit and uses contained `overflow-y: auto` only for genuine overflow. There is no arbitrary height cap, reserved scrollbar gutter, scroll-state listener, fade, or `More items` indicator.
- The Jump-to menu is absent from Selection, Crop, Application, and Retouching. No dedicated-tab content was duplicated, moved, or re-rendered into Develop.

### Accepted Lens Blur Visualize Depth path

- Visualize Depth mutation uses the documented `LrDevelopController.toggleLensBlurDepthVisualization()` SDK call. The legacy Windows-native checkbox writer is not used for this control.
- The Web request and queued command carry an explicit target plus selected-photo UUID, context counter, and Develop counter. Admission reads fresh authoritative native state, avoids a toggle when the target is already satisfied, and fails closed on stale or unavailable context.
- The queue drops a command whose photo/context/Develop binding changes before dequeue. Lua rechecks Develop, target photo identity, and server context before the SDK call and verifies photo/module identity again afterward.
- The Web Controller has no optimistic Visualize Depth state. It disables the switch while pending and settles only after authoritative native readback confirms the requested state in the same current context, with timeout and context-change cancellation.

### Unsupported SDK boundary

- A true Lightroom panel-eye preview switch remains unsupported: there is no accepted authoritative SDK state/mutation path, and LRBridge does not substitute UI automation, keyboard/mouse injection, coordinates, pixels, or optimistic browser state.
- Lens Blur **+ New Refinement** remains unsupported for the same boundary: no accepted documented authoritative SDK command and feedback contract exists. Existing accepted Brush/Depth Refinement behavior is unchanged.

### Verification and lifecycle

- PASS: `test:section-collapse`, `test:controller-commands`, `test:sliders`, `test:controller-color-grading`, `test:color-grading`, `test:color-grading-transport`, `test:tone-curve`, `test:point-curve`, `test:develop-categorical`, `test:lens-blur`, `test:controller-feedback`, `test:controller-http`, `test:controller-proxy`, `test:input`, `test:transport`, and `test:http-transport`.
- Explicit syntax validation passed for the focused changed tests and the Controller's single inline script. `git diff --check` passed. The exclusion audit found no `applyDevelopSettings`, persistent `Enable*` switch, New Refinement implementation, input injection, cursor movement, coordinate/pixel clicking, or native Visualize Depth checkbox writing.
- Manual responsive, collapse, navigation, and Visualize Depth acceptance is complete. The running Web Controller serves `controller.html` and the collapse helper dynamically; the final responsive refinements required only browser refreshes. Do not repeat an LRBridge source restart or Lightroom plug-in reload for this checkpoint. No reload is currently required.

### Preservation

- Keep `config/settings.txt` local and unstaged with only `minimize_behavior=normal`; expected SHA-256 is `9ADBD48B3F4B42E32C2FA722F9A80313A7232A668BA40B0A7E44E11323D067E3`.
- Keep protected hashes `FFE9E61A3AB6655F53762A13D07EEC0E4EA1C67FC56A22C60CD44F4866671BFC` and `C3B4019EBC588EC4D121252D3266A2B57CC110CB5EDD118ECA314B708CE82069`, and preserve `stash@{0}` object `76bd3118f786b886a30dd81ce3b591f4e14f49fe`.
