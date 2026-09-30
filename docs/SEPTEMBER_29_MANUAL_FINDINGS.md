# September 29 source follow-up to private candidate 20260928T025413Z

The user reports that normal use of this candidate feels good. Accepted Masking/
Point Color fixes, regressions and documentation are now in local checkpoint
`75876ea`; other changes remain uncommitted source work, not a new package. The
latest regular Masking sliders/Reset and rapid Grain results are manually accepted
within their tested scope. September 30 also brings scoped manual acceptance of
the current Dust implementation/compact buttons, Masking-open helper wording,
guarded Point Color Visualize Range behavior and Color Grading controls. The new
amber notice and Reset colours below still need visual review; no unreported VM
scenario is inferred. Other items retain their pending checks. The candidate and
VM installation remain the comparison baseline. Previously accepted slider/Reset,
plug-in lifecycle, normal Point Color, masking Hue Shift and Denoise behavior are
preserved. Constrain Crop feedback optimization remains deferred.

## Dust

The old code coupled state readability to command availability at three layers:
Lua discarded capabilities on a failed state read; the server required a known
Apply boolean; the browser offered only a toggle inferred from that boolean.
It also requires Lightroom **15.4.1**, exact inspected preset contents, and Process
Version **15.4** for On. A missing, changed or duplicate preset, an unreadable filter
structure or a version mismatch can therefore disable commands independently of
whether the native Apply checkbox works. Preset folder names do not determine
recognition: unique individual names, exact known file digests and settings scope do.

The current implementation and compact On/Off buttons are manually accepted for
the reported scope. A September 30 check of the installed SDK 15.3 reference found
no documented direct automatic-Dust subpanel selector. `goToRemove` selects manual
Remove, Reflections or People; `selectTool("dust")` names the whole Remove tool.
Opening Remove is distinct from opening Dust. Leave that navigation unchanged.

The Controller now has explicit **On** and **Off** buttons. The existing HTTP field
`dustApply` and commands `remove.dust.on/off` are unchanged. Each button applies its
validated native preset once, including an explicit request for an already displayed
state. No inferred toggle, automatic retry or SDK-return-only confirmation is used.
Omitted `FilterList` is unknown state, not Off. It can retain command capabilities
when the remaining prerequisites are verified; malformed or ambiguous structures
still fail closed. Photo/context/revision/token checks, the write gate, Process
Version and AI readiness requirements, preset scope and before/after preservation
checks remain. Unknown Off completion is now an unknown result, rather than a
fabricated execution error. Real SDK errors remain errors.

Confirmed On/Off text requires fresh feedback. Otherwise the UI says:
“Dust status unavailable. Check the Apply checkbox in Lightroom Classic.”
Main **Reset** independently requires Off capability; it can execute when state is
unknown, is disabled when fresh state is already Off, and uses only the Dust deletion
preset. It does not call the all-Healing reset. Shared Size still requires confirmed
On; its separate availability was not relaxed. Close retains its existing native
navigation request and does not claim a confirmed collapsed panel.

The VM failure's exact trigger is **not yet established**. Requested evidence is
the Lightroom Classic version and the `dust` object from the VM's read-only
`http://127.0.0.1:17891/remove/state` endpoint with the same photo in Develop and Dust
open. Do not presume missing presets or broaden the verified version mapping without
that evidence. The version guard remains deliberately intact.

Both XMP files now use group **LRBridge Dust Helpers**, retaining their names and
UUIDs (`F75BC2062C78A64FA7AAC812010E2C6B` On;
`BD8035E4A54F404CB5D00A22714C7F3C` Off). Only group metadata changed. Recognition
accepts the exact original and renamed digests. The installer migrates only an exact
known legacy file, keeps a `.lrbridge-legacy.bak` backup, and replaces the same XMP
filename. Other conflicting files still stop installation. No installed preset was
changed during this work. Current checksums are in `resources/presets/manifest.json`.

## Masking

**Accepted masked Point Color follow-up:** the user confirms no slider jumps in
the preserved capture and that Toggle Visualize Range visibly worked in Lightroom.
The scalar input ownership/timer cleanup, regression tests and recording are
preserved. No repeat capture unless the problem returns. See
[masked Point Color evidence](MASK_POINT_COLOR_INPUT_OWNERSHIP.md). The separate
pending-adjustment click now has an explanation beside Toggle Visualize Range,
with its existing guard and no queued/retried click. The user now accepts this
release behavior: the immediate click can be blocked and a later click works.
Keep the waiting explanation and completed browser/native evidence; no timing
change or repeat capture. This source UI change remains uncommitted.

The Open/Close Masking helper's wording/location is accepted. It now shares the
existing Focus Range notice's amber background, text and border, without moving
or rewriting the notice. This new colour treatment is a separate visual review.

**Point Color Visualize Range:** the shared child reserved its pending request before
calling the parent. The parent mistook that reservation for a competing edit and
returned before HTTP dispatch. The real child/parent regression produced zero
requests before the fix and one afterwards. The parent now distinguishes the
button's own reservation from real pending edits. Existing mask/component/swatch
checks still reach `LrDevelopController.togglePointColorRangeVisualization(true)`;
there is still no reliable getter for a confirmed toggle highlight.

**Rapid corrections:** a second reproduced browser race let a previous completion
clear a newer value before its HTTP admission returned. The final regression uses
valid readback of the earlier submitted 10: newer input 45 reverted to 10 under
the old condition. Result handling now waits until active input and queued
or in-flight admission have given up ownership. The latest failure still clears the
edit and reports the actual error. This applies to the shared local-correction path,
including Texture, Clarity, Dehaze, Grain Amount, Sharpness, Noise Reduction, Moiré
and Defringe. Global Grain Size/Roughness and normal Point Color keep their separate
accepted paths.

The SDK worker serializes corrections and samples confirmation up to 12 times at
50 ms intervals; browser terminal confirmation has a 3-second deadline. Those bounds
and genuine failure reporting were not relaxed. Subsequent instrumented captures
established the Grain/global-context and completion-retention defects; the focused
corrections and Reset display handoff are now manually accepted within their tested
scope. See [regular Masking evidence](MASKING_CORRECTION_CONFIRMATION.md). Preserve
those completed results; do not repeat the rapid-input capture.

## Parametric Curve

**October 1 follow-up:** the mathematical correction is implemented and compared
with six new matched native graphs, in addition to the nine saved references.
A split-aware slope cascade replaces the fixed-offset anchors/residuals. The
native graphs establish that Lightroom displays the Parametric function
independently of RGB, so the old additive RGB contribution is removed. The
separate Point Curve still preserves RGB turns and lifted endpoints. No model
coefficient was refitted to these six cases; maximum measured error is 1.55/100,
and 0.89 for the reported narrow splits, within the unchanged ±2.5 graph tolerance.
Both demonstrated failures have before/after regressions; actual desktop/narrow
Controller checks pass with mock feedback and zero edits. All new native images
and matching SDK values are preserved. The user's latest comparison is closely
matched, including changed splits, and the correction is manually accepted for
this release. No further tuning or repeat capture unless a new problem appears. See
[model, comparisons and verification limits](PARAMETRIC_PREVIEW_MODEL.md).
The historical findings below describe the starting point. This correction is
not a claim of pixel-exact equivalence for every setting; it supersedes the earlier
decision to leave the formula unchanged. Overall package/release checks remain.

Fixed values Highlights -44, Lights -58, Darks -64, Shadows +100 reproduce the hump
without any feedback traffic: using a linear RGB curve and assumed 25/50/75 splits,
the model's shadow/dark anchors become 25.22 then 20.648. Those decreasing anchors
precede interpolation. A 25/44/75 split also reproduces a decline. The exact user's
RGB curve/splits were not captured; these are explicit reproduction assumptions.

This is a demonstrable rendering-model limitation, not evidence that the photo
values need changing. The existing empirical approximation is now labeled beside
the preview, directing the user to Lightroom for its actual curve. No photographic
adjustments or example-fitted formula were introduced; exact visual parity remains
unimplemented. This is a known approximation awaiting the user's release decision
about the preview, not a claimed parity fix or a request to change photo values.

The September 30 split clue was tested through the actual Controller's HTTP
feedback and drawing code. `ParametricShadowSplit`, `ParametricMidtoneSplit` and
`ParametricHighlightSplit` retain SDK absolute percentages in that order. The
renderer multiplies by 2.55 once for the 0–255 SVG; handles invert that conversion.
The sliders keep a 0–100 track and existing coupled bounds. Per-slider feedback
request floors reject older split responses. Default 25/50/75 and asymmetric
10/20/75, 45/60/85 and 20/55/90 feedback reached both the authoritative and displayed
values exactly, with the correct markers and no photographic commands.

Keeping Shadows/Darks/Lights/Highlights fixed at 60/-35/-20/-10 and a linear RGB
base, 25/50/75 yields increasing model anchors; changing only the splits to
10/20/75 makes neighboring anchors fall from 12.7 to 7.12. The final drawn spline
also dips. The model moves region centers when splits move but applies empirically
weighted tone offsets independent of region width; its existing residual
calibration is likewise only an approximation. Narrow regions expose this limit.
Eight fixed-tone/split cases, including the original reported tone values, are
preserved. These synthetic examples do not establish the exact latest native
curve or the user's unrecorded split/RGB values. No demonstrated unit, ordering
or stale-feedback defect warrants changing that flow. The formula stays unchanged
rather than adding a fit for one case; exact native parity remains unresolved.

## Lens Blur Visualize Depth timing

**Latest October 1 manual report:** Visualize Depth still feels slow. The report
does not distinguish action delay from confirmation delay. Keep this as a known
issue in the next private package; native performance has not passed. Do not start
another optimization project as part of packaging.

Previously admission awaited `readState`: window discovery, Lens Blur/refinement
discovery, brush tracks/edits, Apply, Visualize Depth, Auto Mask and focus actions.
Then the SDK command queue and photo/context validation preceded the documented
toggle. Confirmation awaited another full Windows read, potentially behind an
already active poll. The native `setCheckbox` writer's 120 ms sleep is **not** on
this route; Visualize Depth is an SDK operation.

Admission and pending confirmation now use a dedicated read of the existing
Visualize Depth checkbox. It still freshly discovers and validates the native
control and requires agreement between BM_GETCHECK and accessibility state. It
does not click Windows controls, reuse cached checkbox values, or read unrelated
refinement controls. The existing `/lens-blur/state` route accepts optional
`depthOnly=true`; ordinary requests are unchanged. Targeted responses update only
Visualize Depth after context validation, preserve other controls, and do not
request an unrelated SDK Lens Blur refresh. A full read already active at click
time is followed immediately by a targeted confirmation read instead of waiting
for the next regular poll. Existing SDK dispatch/context safeguards and the
7-second confirmation deadline remain.

The user still reports slow operation after that first optimization; it did not
establish acceptable native timing. Inspection found a smaller remaining issue:
the focused read still called general window discovery, which synchronously read
min/max/position for every unrelated trackbar. `Get-DepthVisualizationState` now
opts out of just those reads. Fresh window identity/geometry, unique Lens Blur
anchor/button validation and native/accessibility checkbox agreement remain.
Ordinary full discovery retains its track values. No caching, Windows write,
timeout extension or context relaxation was added.

`tests/lens-blur-depth-discovery.ps1` imports the production functions with
in-memory Win32/process doubles: the old code performs 60 unnecessary track reads
for 20 fixture sliders and fails; the correction performs zero and passes. Each
read still obtains a fresh checkbox value; disagreement, unavailable/ambiguous
controls and changed ownership fail closed. Full discovery still performs all 60
track reads. The existing targeted-route check also passes fresh confirmation,
old-photo rejection and unchanged route validation. No native Windows discovery
or Lightroom command is invoked by these tests.

Before Lightroom changes, the HTTP route waits for the existing serialized native
helper's fresh explicit-state read, then SDK queue dispatch and context checks.
The SDK toggle has no inserted sleep. After admission, the Controller requests a
fresh targeted confirmation; if that read precedes SDK execution, a subsequent
poll must obtain the result. The correction avoids unrelated track reads in both
fresh-read phases. It does **not** quantify saved time on the user's machine.
Available older full-poll evidence lacks a synchronized current click, helper
queue/read, SDK execution, visible native change and displayed-confirmation timeline.
Those phases must remain distinct; no native latency improvement is claimed yet.
Apply behavior and the accepted shared-slider timing are unchanged.

## Other requested presentation and Color Grading changes

- Lens Corrections Distortion/Vignetting stay present and grey/noninteractive when
  unavailable, using their existing availability and shared-slider logic.
- Blending user edits are rounded to whole numbers before dispatch; range step is
  1. Blending and Balance have 44px minus/plus buttons stepping by 1, with existing
  ranges, dispatcher and Reset paths. Public HTTP still accepts existing fractional
  values where it did before; color wheels are unchanged.
- Color Grading controls are now manually accepted within the reported scope.
  All enabled Reset buttons use the shared orange Reset palette, including
  Blending, Balance, Luminance, Region and its confirmation. Enabled-only CSS
  selectors leave previous disabled colours/opacity untouched; command handlers
  and wheels are unchanged. Only the new colours need visual review.
- Disabled Favorite Presets Amount has grey track/thumb/value. Narrow field padding
  permits the unchanged three-digit value to remain readable; no availability or
  preset command logic changed.
- Requested People Cancel, Masking Reset Sliders Automatically and Use Fine
  Adjustment explanations use existing helper styling and bold control names.
  No automation was added for these controls.

## Verification and minimum native checks

Passed automated checks: 102 Dust HTTP/queue/Lua scenarios; existing Dust browser
regression adapted to On/Off; real shared Point Color/Masking child-parent and
correction-race regressions; Masking Phase 4 contracts; Lens Blur transport, SDK
guards, polling and targeted old-photo confirmation; Color Grading UI and public
HTTP transport; preset staging/install/idempotence/legacy migration/conflict/integrity
checks. Focused browser checks cover integer edits, +/- boundaries, Reset routes,
unknown Dust commands and independent prerequisites, depth confirmation, helper
placement and desktop/390px/320px layouts. Browser captures were inspected locally.
No live Lightroom commands or VM changes were sent. No full repository suite ran.
September 30 adds only the focused production PowerShell regression/targeted route
check and `tests/release-followup-browser.js`: exact amber notice/Reset CSS and
unchanged disabled appearance, no overflow at 1280/390/320 px, and the eight
Parametric split-flow cases with older-feedback rejection. Browser captures were
inspected. Completed slider, Grain and Point Color suites/captures were reused.

The October 1 packaging instruction moves Dust clean-install and legacy-preset
migration testing to the fresh package and carries Visualize Depth latency as a
known issue. Accepted controls and Parametric comparisons need no repeat capture.
The updated Masking notice explicitly identifies the same Web Controller button:
**Close Masking**, then **Open Masking**; wording, bold labels, unchanged amber
appearance and placement were checked at desktop and narrow widths.

Earlier minimum native checks on matching source app/plug-in (do not repeat
the accepted masked Point Color, regular Masking/Reset or rapid Grain tests):
1. Verify that the changed PowerShell helper is loaded (source was already
   restarted for October 1 Parametric collection; no automatic repeat restart or
   Lightroom plug-in reload). On one idle photo with Lens Blur open, use Visualize Depth once
   each way, observing when Lightroom changes and when the Controller confirms.
   If latency is still unclear, the next evidence should be one focused timed
   sequence for those phases, not another slider audit.
2. Review the new amber Masking notice and orange Color Grading Reset colours.
   Browser refresh is sufficient for CSS. Do not repeat accepted Color Grading
   behavior, Dust controls, masked Point Color, Masking/Reset or rapid Grain tests.
3. The original VM cause, renamed-preset clean installation/legacy migration and
   any other previously unreported Dust scenario remain unverified. Obtain only
   the missing version/reason or installation evidence when returning to that gate;
   preserve the VM/package baseline. Current scoped acceptance is not proof of
   those additional scenarios.

The other requested presentation changes have been implemented and checked at
desktop/narrow widths; user review/acceptance remains separate from those browser
checks. Parametric Curve is now manually accepted for this release with its
documented approximation limits; no further tuning/capture is pending. Source
changes outside `75876ea` still await review/checkpoint/package follow-through after the remaining
decisions and acceptances; preserve the current comparison package and VM.

The Dust button layout, Masking-open wording and guarded-click explanation are now
manually accepted as described above. New colours need only a browser refresh;
the new depth-read helper needs a source LRBridge restart. No plug-in reload is
required for this follow-up. No app restart or native edit was sent during it.

Historical source-pair setup (already completed; not a reload request):
run source only after fully quitting the packaged app. From `D:\Projects\LRBridge`,
`npm start` launches `D:\Projects\LRBridge\node_modules\electron\dist\electron.exe`
with `D:\Projects\LRBridge\app\main.js`. Match it to
`D:\Projects\LRBridge\lightroom\LRBridge.lrplugin`, enable only that LRBridge entry,
and **Reload Plug-in once** for the changed Dust Lua. Controller:
`http://127.0.0.1:17892/`. No source app was launched by this work. Keep all earlier
package startup/settings, Companion, LAN and clean-install manual gates pending
unless the user explicitly reports the corresponding result.
