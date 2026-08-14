# Lens Blur Runtime Discovery — Lightroom Classic 15.3

This document is the permanent technical handoff for the Lens Blur runtime investigation completed on 2026-08-13. It records the local Lightroom Classic 15.3 SDK audit, controlled native-Lightroom experiments, negative results, exact observed values, and production recommendations.

The investigation was intentionally separated from production implementation. The remaining controls described here were not added to LRBridge.

## Repository state

- Safe parent/checkpoint: `d0726fd23f1de9e05a7225ec3b84794bc22b5243`
- Branch: `feature/v0.6-more-sdk-and-web-controller`
- The worktree is intentionally uncommitted. It already contains the Lens Blur implementation and Web Controller repair built on the safe parent.
- A clean worktree was not required and no existing work was reset or reverted.
- `config/settings.txt` was untouched and remains `poll_interval_ms=100`.
- `DEBUG_DEVELOP_REFRESH = true` remains set in `app/controller.html`.
- No commit, push, or tag was created during discovery.

## Already implemented before this discovery

The current uncommitted production implementation already supports:

- Explicit Lens Blur Apply controls: `[ Off ][ On ]`.
  - Off calls `LrDevelopController.setValue("LensBlurActive", false)`.
  - On calls `LrDevelopController.setValue("LensBlurActive", true)`.
  - It does not implement MIDI2LR-style negation of `getValue("LensBlurActive")`.
- Blur Amount through `LensBlurAmount`.
- Five Bokeh choices through the Lightroom-native Bokeh API:
  - Circle: `Circle`
  - Bubble: `SoapBubble`
  - 5-Blade: `Blade`
  - Ring: `Ring`
  - Anamorphic: `Anamorphic`
- Cat Eye through `LensBlurCatEye`.
- Boost through `LensBlurHighlightsBoost`.
- Lightroom-native Reset for Blur Amount.
- Lightroom-native Reset for Cat Eye.
- Lightroom-native Reset for Boost.
- A momentary Visualize Depth action through `toggleLensBlurDepthVisualization()`.
- Brush Refinement tool entry through `selectTool("depth_refinement")`.
- Selected-tool feedback through `getSelectedTool()` where available.

The three production Reset buttons use the existing serialized `develop.reset` path and ultimately call:

```lua
LrDevelopController.resetToDefault(param)
```

They do not write hard-coded defaults. Runtime-observed defaults were:

- `LensBlurAmount = 50`
- `LensBlurHighlightsBoost = 50`
- `LensBlurCatEye = 0`

Those values are evidence only, not the implementation of Reset.

### Existing authoritative feedback behavior

`LensBlurActive` is treated as **WRITE-ONLY / INTERMITTENT READBACK**:

- A boolean `true` getter result authoritatively selects On.
- A boolean `false` getter result authoritatively selects Off.
- A nil getter result means unavailable/unknown. Neither button claims selection.
- Nil does not mean Apply is off.
- Off and On remain explicitly usable while feedback is unavailable.
- A locally accepted command is not retained as authoritative state.
- When boolean feedback later becomes available, the existing polling architecture updates presentation automatically.

The Lens Blur state model represents unavailable values explicitly instead of substituting cached or optimistic state. Numeric Lens Blur parameters continue to use the normal authoritative Develop feedback architecture. Bokeh and selected-tool presentation likewise depend on current Lightroom feedback and availability rather than command acceptance.

## Local Lightroom 15.3 SDK findings

The user's local Lightroom Classic 15.3 SDK package was audited across the generated API reference, Develop Controller parameter catalog, Lightroom SDK manuals/controller guide, and sample plug-ins.

The documented Lens Blur-related Develop Controller surface includes:

- `LensBlurActive`
- `LensBlurAmount`
- `LensBlurCatEye`
- `LensBlurHighlightsBoost`
- `LensBlurFocalRange`
- `getSelectedLensBlurBokeh()`
- `setLensBlurBokeh(bokeh)`
- `toggleLensBlurDepthVisualization()`
- `selectTool("depth_refinement")`
- `getSelectedTool()`
- `revealPanel("lensBlurPanel")`
- `addAdjustmentChangeObserver(context, observer, callback)` as a generic Develop-adjustment notification

The SDK documents `LensBlur` and `DepthMapInfo` as tables returned within `photo:getDevelopSettings()`, but it does not document a stable member-level contract for all of their runtime contents.

The local Lightroom 15.3 SDK does **not** expose a documented API for:

- Subject Focus.
- Point / Area Focus.
- Entering a Lens Blur focal-range tool mode.
- A Visualize Depth state getter.
- Brush Refinement Focus / Blur mode.
- Brush Refinement Amount.
- Brush Refinement Size.
- Brush Refinement Feather.
- Brush Refinement Flow.
- Brush Refinement Auto Mask.
- Brush Refinement Reset.
- Lens Blur image-coordinate selection.

`photo:updateAISettings()` and `catalog:updateAISettings()` are generic AI-settings update operations. The SDK exposes no Lens Blur-specific Subject Focus, Point/Area Focus, or focus-coordinate option through them. They were not called during this investigation.

## Adjustment observer findings

The documented observer signature is:

```lua
LrDevelopController.addAdjustmentChangeObserver(context, observer, callback)
```

The documentation defines the callback as `function(observer)`. Runtime evidence matched the documentation exactly.

Every captured callback contained:

- Exactly one argument.
- Lua type `table`.
- The exact observer object passed during registration.

It supplied:

- No parameter ID.
- No parameter value.
- No changed-setting key.
- No changed-settings table.

The SDK sample plug-ins respond to this generic notification by rereading their own known parameter lists. They do not receive the changed parameter from the callback.

There is no documented `removeAdjustmentChangeObserver()` API. The observer is retained by an `LrFunctionContext`, and its lifetime ends when that function context ends. The temporary diagnostic therefore kept one context alive during capture and ended that context during cleanup.

## Visualize Depth

The action API is documented and already proven functional:

```lua
LrDevelopController.toggleLensBlurDepthVisualization()
```

There is no matching getter.

### Runtime state experiment

The user manually established this sequence on the same healthy Lens Blur photo:

```text
OFF -> ON -> OFF
```

Snapshots A, B, and C compared:

- All five documented Lens Blur `getValue()` candidates.
- Their safe `getRange()` results.
- `getSelectedTool()`.
- `getSelectedLensBlurBokeh()`.
- Complete `photo:getDevelopSettings()` output, normalized recursively.
- The complete runtime `LensBlur` table.
- The complete runtime `DepthMapInfo` table.
- Photo AI-update-needed state.
- Photo editability state.
- Adjustment-change observer events.

Both transitions produced:

- Zero adjustment-observer events.
- Zero changes across 266 normalized Develop-settings entries.
- No Lens Blur getter change.
- No selected-tool change.
- No `LensBlur` table change.
- No `DepthMapInfo` change.
- No AI-update-needed change.
- No photo-editability change.

### Classification

**ACTION-ONLY**

### Production recommendation

Keep the existing momentary Visualize Depth action. Do not fabricate a persistent On/Off indicator, infer state from toggle parity, or retain local state. A persistent indicator must wait for a future authoritative Lightroom getter.

## Focus Range

Focus Range is not a scalar slider in this Lightroom 15.3 runtime.

### Exact authoritative representation

Parameter:

```text
LensBlurFocalRange
```

Lua type:

```text
string
```

Exact format established by six independent native-control movements:

```text
nearOuter nearInner farInner farOuter
```

Both of these sources matched in every capture:

```lua
LrDevelopController.getValue("LensBlurFocalRange")
photo:getDevelopSettings().LensBlur.FocalRange
```

### Dedicated baseline

The starting subject-focused representation was:

```text
-50 30 85 165
```

Related state included:

```text
LensBlur.FocalRangeSource = 1
LensBlur.SampledRange = "30 85"
LensBlur.SubjectRange = "30 85"
```

### FR1 — whole range toward Near

The entire native rectangle was moved toward Near without resizing:

```text
-50 30 85 165
->
-80 0 55 135
```

All four values decreased by `30`. The inner focus width and both outer transition widths remained unchanged.

Additional observations:

- `FocalRangeSource` changed from `1` to `3`.
- `SampledRange` changed from `"30 85"` to `"0 55"`.
- The layered-depth digest/table changed.
- Fourteen generic adjustment-observer events fired.

### FR2 — whole range toward Far

The entire rectangle was moved toward Far without resizing:

```text
-80 0 55 135
->
-35 45 100 180
```

All four values increased by `45`. The inner focus width and both outer transition widths remained unchanged.

Additional observations:

- `SampledRange` changed from `"0 55"` to `"45 100"`.
- The layered-depth digest/table changed.
- Forty generic adjustment-observer events fired.

### FR3 — Near edge inward

Only the Near/left edge was moved inward toward Far:

```text
-35 45 100 180
->
-20 60 100 180
```

Only components 1 and 2 changed. Both increased by `15`. Components 3 and 4 remained fixed.

`SampledRange` did not change during this isolated Near-edge edit even though the authoritative FocalRange string changed. Fifteen generic observer events fired.

### FR4 — Far edge inward

Only the Far/right edge was moved inward toward Near:

```text
-20 60 100 180
->
-20 60 78 158
```

Only components 3 and 4 changed. Both decreased by `22`. Components 1 and 2 remained fixed.

Additional observations:

- `SampledRange` became `"60 78"`, catching up to the current inner pair.
- The layered-depth digest/table changed.
- Forty-nine generic observer events fired.

### FR5 — Near edge outward

Only the Near/left edge was expanded outward toward Near:

```text
-20 60 78 158
->
-43 37 78 158
```

Only components 1 and 2 changed. Both decreased by `23`. Components 3 and 4 remained fixed.

`SampledRange` again remained stale during this isolated Near-edge edit. Twenty-two generic observer events fired.

### FR6 — Far edge outward

Only the Far/right edge was expanded outward toward Far:

```text
-43 37 78 158
->
-43 37 94 174
```

Only components 3 and 4 changed. Both increased by `16`. Components 1 and 2 remained fixed.

Additional observations:

- The layered-depth digest/table changed.
- Seventeen generic observer events fired.

### Proven component behavior

- Moving the whole rectangle shifts all four components by the same delta.
- Moving the Near edge changes only components 1 and 2.
- Moving the Far edge changes only components 3 and 4.
- The observed Near transition width, `nearInner - nearOuter`, was `80` in every tested state.
- The observed Far transition width, `farOuter - farInner`, was `80` in every tested state.
- The tested `80` transition width is runtime evidence for this photo/state, not a documented universal constant.
- `LensBlur.FocalRange` matched `getValue("LensBlurFocalRange")` after every action.
- `SampledRange` could lag isolated edge changes and must not be used as primary authority.

### Misleading getRange result

`LrDevelopController.getRange("LensBlurFocalRange")` returned numeric bounds:

```text
-100..100
```

That range does not describe the compound string representation. Individual observed components included `-80`, `165`, `174`, and `180`; several valid components exceeded the reported numeric maximum. Numeric slider semantics must not be inferred from `getRange()`.

### Write status

No `LensBlurFocalRange` setter was attempted.

This is important because the Lightroom 15.3 SDK documents the generic `setValue(param, value)` value argument as a number, while this runtime returns `LensBlurFocalRange` as a four-number string. Passing the returned string back to `setValue()` would therefore be outside the documented value contract.

Writing the four-number string is currently:

**UNDOCUMENTED / EXPERIMENTAL / NOT YET PROVEN**

Focus Range must not be described as production-write-safe.

## Focus Range source

The following `photo:getDevelopSettings().LensBlur.FocalRangeSource` values were observed:

```text
FocalRangeSource = 1
=> Subject Focus

FocalRangeSource = 2
=> Point / Area Focus

FocalRangeSource = 3
=> manually moved/resized Focus Range
```

These mappings are runtime evidence from this Lightroom 15.3 photo. They are not documented enums in the SDK.

## Subject Focus

No documented Lightroom SDK Subject Focus command was found.

The user manually invoked Subject Focus after the six range movements. The resulting transition was:

```text
FocalRange:       "-43 37 94 174" -> "-50 30 85 165"
FocalRangeSource: 3 -> 1
```

The native action restored the subject-derived FocalRange and corresponding layered-depth data. `SubjectRange` remained `"30 85"`. One generic adjustment-observer event fired.

After Lightroom settled, the capture showed no selected-tool change, no AI-update-needed state, and no editability change. That settled snapshot does not prove whether transient AI work occurred internally; it only proves no persistent readable AI-operation flag was exposed afterward.

The result can be observed through `LensBlurFocalRange` and `LensBlur.FocalRange`, but the Subject Focus action itself cannot currently be invoked through a supported SDK API.

### Classification

**NATIVE-TOOL-ONLY**

### Production recommendation

Do not expose a browser Subject Focus button yet.

## Point / Area Focus

No documented Point / Area Focus action, coordinate API, or supported Lens Blur focal-range tool entry was found.

The user manually clicked Lightroom's Point / Area Focus icon and made exactly one image selection. The resulting capture showed:

```text
getSelectedTool(): "loupe" -> "focal_range"
FocalRange:        "-50 30 85 165" -> "-43 37 57 137"
FocalRangeSource:  1 -> 2
SampledRange:      "60 78" -> "37 57"
SampledArea:       "-0.524927 -0.167969 1.475073 1.832031"
                   -> "0.528653 0.525763 0.564470 0.547710"
```

Two generic adjustment-observer events fired. The layered-depth digest/table changed.

Important limitations:

- `getSelectedTool()` returned the string `"focal_range"` at runtime.
- `"focal_range"` is not included in the SDK's documented `getSelectedTool()` or `selectTool()` value lists.
- `SampledArea` is a four-coordinate string, but the SDK provides no supported Lens Blur image-coordinate input API.
- The resulting FocalRange can be observed.
- Replaying the four-number FocalRange string has not been proven.
- No `selectTool("focal_range")` production call was attempted or proven.

### Classification

**NATIVE-TOOL-ONLY / UNDOCUMENTED**

### Production recommendation

Do not use Windows mouse automation, screen-coordinate hacks, synthetic Lightroom canvas clicks, or guessed `selectTool()` values. Do not expose a browser Point / Area Focus action until a supported entry and coordinate contract exists.

## Brush Refinement

The documented tool entry and readback are proven:

```lua
LrDevelopController.selectTool("depth_refinement")
LrDevelopController.getSelectedTool() == "depth_refinement"
```

Entering Brush Refinement from the Point/Area state changed only:

```text
getSelectedTool(): "focal_range" -> "depth_refinement"
```

One generic adjustment-observer event fired. No Develop setting changed merely from entering the tool. No painting occurred anywhere in the investigation.

### Focus / Blur mode

Native sequence tested:

```text
Focus -> Blur -> Focus
```

For both transitions:

- Observer events: zero.
- Develop-settings changes: zero.
- `getSelectedTool()` remained `"depth_refinement"`.
- Exact SDK parameter found: none.
- Read support: none.
- Write support: none documented or tested.
- Authoritative feedback: none.

Classification: **NATIVE-TOOL-ONLY**

### Amount

Native values tested and restored:

```text
100 -> 73 -> 100
```

For both transitions:

- Observer events: zero.
- Develop-settings changes: zero.
- Exact SDK parameter found: none.
- Read support: none.
- Write support: none.
- Authoritative feedback: none.
- Public range/default contract: not discovered; only the displayed/tested values above are proven.

Classification: **NOT RELIABLY IMPLEMENTABLE**

### Size

Native values tested and restored:

```text
42 -> 31 -> 42
```

For both transitions:

- Observer events: zero.
- Develop-settings changes: zero.
- Exact SDK parameter found: none.
- Read support: none.
- Write support: none.
- Authoritative feedback: none.
- Public range/default contract: not discovered; only the displayed/tested values above are proven.

Classification: **NOT RELIABLY IMPLEMENTABLE**

### Feather

Native values tested and restored:

```text
100 -> 63 -> 100
```

For both transitions:

- Observer events: zero.
- Develop-settings changes: zero.
- Exact SDK parameter found: none.
- Read support: none.
- Write support: none.
- Authoritative feedback: none.
- Public range/default contract: not discovered; only the displayed/tested values above are proven.

Classification: **NOT RELIABLY IMPLEMENTABLE**

### Flow

Native values tested and restored:

```text
100 -> 47 -> 100
```

For both transitions:

- Observer events: zero.
- Develop-settings changes: zero.
- Exact SDK parameter found: none.
- Read support: none.
- Write support: none.
- Authoritative feedback: none.
- Public range/default contract: not discovered; only the displayed/tested values above are proven.

Classification: **NOT RELIABLY IMPLEMENTABLE**

### Auto Mask

Native values tested and restored:

```text
OFF -> ON -> OFF
```

For both transitions:

- Observer events: zero.
- Develop-settings changes: zero.
- Exact SDK parameter found: none.
- Read support: none.
- Write support: none.
- Authoritative feedback: none.

Classification: **NOT RELIABLY IMPLEMENTABLE**

### Reset

The native Brush Refinement Reset was deliberately not pressed because its destructive scope was unknown.

No Lens Blur refinement-specific reset API was found. In particular:

- `resetBrushing()` is deprecated and documented to clear localized-adjustment brushing from the photo. It is not documented as a Lens Blur refinement reset.
- `resetMasking()` clears all masks from the photo and is unsuitable.
- `resetToDefault(param)` requires a Develop parameter name; no Brush Refinement parameter or refinement-reset parameter is documented.

It remains unknown whether the native Lens Blur Reset clears refinement strokes, changes brush preferences, changes Focus/Blur mode, regenerates depth, or performs some combination. Its semantics are potentially destructive.

Classification: **NOT RELIABLY IMPLEMENTABLE / POTENTIALLY DESTRUCTIVE**

## Evidence matrix

| Control | Exact API / representation | Read | Write | Type / Range | Authoritative Feedback | Runtime Proven | Classification | Production Recommendation |
|---|---|---|---|---|---|---|---|---|
| Visualize Depth state | Action only: `toggleLensBlurDepthVisualization()` | No state getter | Momentary toggle only | No state type/range | No | OFF -> ON -> OFF produced no readable change | **ACTION-ONLY** | Keep the existing momentary action; do not add persistent state. |
| Focus Range move | `getValue("LensBlurFocalRange")`; `LensBlur.FocalRange` | Yes | Compound writer not attempted/proven | String: `nearOuter nearInner farInner farOuter`; numeric `getRange=-100..100` is not semantic | Yes, from matching FocalRange strings | Whole Near and Far translation proven | **READ-ONLY / UNDOCUMENTED-EXPERIMENTAL writer** | Do not render a scalar or claim write safety. |
| Focus Range Near edge | Components 1 and 2 of the FocalRange string | Yes | Not attempted/proven | Two numeric tokens within the four-token string; observed transition width `80` | Yes | Inward and outward changes isolated | **READ-ONLY** | Defer structured control until a compound writer is proven. |
| Focus Range Far edge | Components 3 and 4 of the FocalRange string | Yes | Not attempted/proven | Two numeric tokens within the four-token string; observed transition width `80` | Yes | Inward and outward changes isolated | **READ-ONLY** | Defer structured control until a compound writer is proven. |
| Subject Focus | No documented action; native result uses `FocalRangeSource=1` | Result can be observed | No supported action | Four-token FocalRange string derived from subject state | Result only | Manual native action proven | **NATIVE-TOOL-ONLY** | Do not expose a browser Subject Focus button. |
| Point / Area Focus | Native `getSelectedTool()="focal_range"`; `FocalRangeSource=2`; four-coordinate `SampledArea` | Result can be observed | No supported entry or coordinate API | FocalRange string plus SampledArea string | Result only | One native point/area selection proven | **NATIVE-TOOL-ONLY / UNDOCUMENTED** | No browser action, mouse automation, coordinate hacks, or guessed tool call. |
| Brush Focus/Blur | Tool remains `depth_refinement`; no mode parameter found | No | No documented API | Native Focus/Blur UI enum only | No | Focus -> Blur -> Focus tested | **NATIVE-TOOL-ONLY** | Keep native Lightroom-only. |
| Brush Amount | No parameter found | No | No | Numeric UI; observed `100 -> 73 -> 100`; range undocumented | No | Yes, negative SDK result | **NOT RELIABLY IMPLEMENTABLE** | Omit. |
| Brush Size | No parameter found | No | No | Numeric UI; observed `42 -> 31 -> 42`; range undocumented | No | Yes, negative SDK result | **NOT RELIABLY IMPLEMENTABLE** | Omit. |
| Brush Feather | No parameter found | No | No | Numeric UI; observed `100 -> 63 -> 100`; range undocumented | No | Yes, negative SDK result | **NOT RELIABLY IMPLEMENTABLE** | Omit. |
| Brush Flow | No parameter found | No | No | Numeric UI; observed `100 -> 47 -> 100`; range undocumented | No | Yes, negative SDK result | **NOT RELIABLY IMPLEMENTABLE** | Omit. |
| Auto Mask | No parameter found | No | No | Native boolean UI; observed OFF -> ON -> OFF | No | Yes, negative SDK result | **NOT RELIABLY IMPLEMENTABLE** | Omit. |
| Brush Refinement Reset | No Lens Blur refinement-specific reset API | No | Not tested | Unknown scope; potentially destructive | No | Documentation audit only; native Reset deliberately not pressed | **NOT RELIABLY IMPLEMENTABLE / POTENTIALLY DESTRUCTIVE** | Omit until exact scope and supported API are proven. |

## Current production recommendation

### SAFE TO KEEP / IMPLEMENT NOW

The following current uncommitted controls are backed by the prior runtime evidence and current architecture:

- Explicit Apply Off/On.
- Blur Amount.
- Five Bokeh choices.
- Cat Eye.
- Boost.
- Lightroom-native Reset for Blur Amount.
- Lightroom-native Reset for Cat Eye.
- Lightroom-native Reset for Boost.
- Momentary Visualize Depth action.
- Brush Refinement tool entry through `selectTool("depth_refinement")`.
- Honest unavailable/unknown presentation whenever authoritative feedback is absent.

### NOT READY

Do not add these controls to production yet:

- Persistent Visualize Depth indicator.
- Focus Range writer/editor.
- Subject Focus browser action.
- Point / Area Focus browser action.
- Brush Refinement Focus/Blur selector.
- Brush Refinement Amount.
- Brush Refinement Size.
- Brush Refinement Feather.
- Brush Refinement Flow.
- Brush Refinement Auto Mask.
- Brush Refinement Reset.

## Future investigation

The following are possible future isolated experiments, not current supported behavior:

1. Run a controlled `LensBlurFocalRange` write experiment using a known captured four-number string, with explicit before/after evidence and a safe restoration plan. This would be an undocumented string write against an SDK setter whose documented value type is numeric.
2. Test whether `selectTool("focal_range")` works despite being undocumented, but only in an isolated diagnostic. A successful experiment would still not make the value officially supported.
3. Search future Lightroom Classic SDK releases for an authoritative Visualize Depth getter and proper Lens Blur Subject Focus, Point/Area Focus, Focus Range, and refinement-control APIs.
4. Do not expose any unsupported control until its read, write, range/type, failure behavior, restoration behavior, and authoritative feedback contract are proven.

These are explicitly **FUTURE EXPERIMENTS**. They must not be represented as behavior supported by the current Lightroom Classic 15.3 SDK or current LRBridge production code.

## Cleanup / final safety state

- `Help.lua` was restored byte-for-byte.
- Original `Help.lua` SHA-256: `0f6fa4f08c031a1a246300edcce3a6d145ee5e5c60ebf983b4fe46d381e15077`.
- The temporary observer's function context ended, unregistering the observer.
- All temporary command, result, log, and evidence files were removed.
- No temporary diagnostic globals remained after context cleanup.
- `config/settings.txt` remained unchanged.
- `DEBUG_DEVELOP_REFRESH = true` remained enabled.
- No Lightroom launch or restart occurred.
- No UI automation was used.
- No Windows mouse automation, screen-coordinate hack, or synthetic canvas click was used.
- No Focus Range setter was attempted.
- No Brush Refinement Reset was invoked.
- No commit, push, or tag was created.
- `git diff --check` passed after cleanup.
