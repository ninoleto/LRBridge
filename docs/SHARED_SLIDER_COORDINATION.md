# Shared slider coordination investigation

Status: **Reset responsiveness accepted for the tested controls; slider and Reset
corrections authorized for a scoped local checkpoint**. No jumps were observed in
the first corrected-source run; this is not universal slider or release approval.
Work remains isolated on
`fix/shared-slider-coordination-20260927`, based on `8f9ce61`. The preserved candidate
`20260927T174904Z` / release source `7bd6db9` is stopped and unchanged.

## September 28 focused Reset follow-up result

User report after the fresh capture: **"This feels noticeably more responsive."**
The user subsequently accepted current Reset responsiveness for the tested controls
and requested preservation/checkpointing of these fixes, tests and recorded results.
The 16.546-second recording contains four Resets on four SDR controls. A separate
question about backward jumps in this latest run is pending; do not extend the
earlier no-jump observation or infer final release approval.

| Control | Release → request | Request → SDK begins | SDK return → confirmed display | Total |
| --- | ---: | ---: | ---: | ---: |
| SDR Whites | 1 ms | 119 ms | 150 ms | 273 ms |
| SDR Clarity | 1 ms | 145 ms | 344 ms | 492 ms |
| SDR Highlights | 1 ms | 95 ms | 134 ms | 233 ms |
| SDR Shadows | 1 ms | 173 ms | 166 ms | 343 ms |

All four visual transitions are usable: none was already zero, overlapped another
Reset on that slider or displayed zero before its SDK Reset. The median total is
**308 ms**, versus 477 ms in the prior corrected-source recording; median
SDK-return-to-display is **158 ms**, versus 348 ms. These are small, differently
sized and paced instrumented samples, not a controlled benchmark.

The rapid Clarity → Highlights → Shadows group is a closer comparison. Its previous
release-to-display times were 1110/1356/1481 ms with release gaps of 351/349 ms;
the new times are 492/233/343 ms with gaps of 334/316 ms. In the new trace, Clarity
read 1468 returned SDK zero at 14400.230 ms and posted at 14401.229. The next ready
Highlights read 1470 dequeued at 14402.734 and returned zero at 14494.563, without
an intervening full background polling cycle. This directly supports the intended
confirmation-scheduling improvement.

Each final zero is correlated through `resetToDefault` begin/return, SDK `getValue`,
feedback request ID, HTTP snapshot and rendered local/authoritative value. Recorded
SDK state remains zero afterward, with no older Set or Reset write before any newer
input. All four command handlers completed successfully. SDK event order shows no
target read begun inside their Reset preparation intervals.

The longest case, Clarity at 492 ms, arrived while an ordinary broad snapshot was
already running. Its targeted confirmation waited for the next polling opportunity;
the new draining behavior then serviced Highlights promptly. Shadows read 1471
began and ended just before its command began, at the same recorded millisecond.
The prior value -45 retained confirmation demand; read 1472 later supplied SDK zero
and the display settled at 343 ms. This is the existing bounded pre-command renewal
case, not a read begun during command preparation or a presumed Reset result.

Seven expired snapshot responses and one superseded-read cancellation remain in the
evidence. They are not command failures; all four final Reset confirmations are
backed by successful SDK reads. Preserve these diagnostics and the existing context
guards. No further implementation change or additional manual capture is indicated
by this result. Current source/diagnostic versions remain unchanged, completed tests
are reused, and native HTTP Contrast tests were not repeated.

This verifies the four recorded Reset cases and supports the user's responsiveness
observation. It does not cover other controls or contexts, nor change remaining
package acceptance gates or the separate disabled-worker defect. A scoped local
checkpoint is now authorized. Release remains blocked while the separately tracked
worker defect and remaining package gates are addressed; no build or publication.

## September 28 corrected-source retest and remaining Reset delay

User report: **no jumps observed in this run**. Reset worked, but remained
"acceptable-ish" and noticeably slower than normal Point Color Reset. This is
bounded evidence, not final release approval or universal slider acceptance.

The 121.416-second recording preserves browser input/rendering, HTTP and diagnostic
SDK streams, with one diagnostic command consumer. It contains 51 Resets across all
seven SDR sliders. Of these, 48 have usable post-execution visual transitions: two
were already displaying zero, and a repeated Whites Reset displayed the earlier
Reset's zero before its own SDK call. That repeat is not an execution confirmation.

| Median interval (ms, rounded) | Previous capture | Corrected-source retest |
| --- | ---: | ---: |
| Touch release → request | 1 | 1 |
| Request → SDK Reset begins | 153 | 145 |
| SDK Reset returns → confirmed value displayed | 796 | 348 |
| Touch release → confirmed value displayed | 969 | 477 |

The previous sample has 12 actions; current request/SDK statistics use all 51,
while current visual statistics use the 48 transitions above. Phase medians need
not sum to the total median. Samples differ in pace and size and include recorder
overhead; this is not a controlled A/B. Typical delay improved substantially, mostly
after SDK execution. The worst current visible transition still took **2514 ms**
(2348 ms after SDK return), compared with 1321 ms previously.

Within the current request-to-SDK phase, medians are 77 ms to enter the command
handler and 63 ms from handler entry to `resetToDefault`; the SDK call itself takes
about 3 ms. The shared driver includes an existing 50 ms Develop/panel preparation
yield, absent from Point Color's swatch-update path. Those timings identify the
remaining dispatch/preparation cost, but do not demonstrate that the SDK preparation
can safely be removed. This follow-up leaves it intact.

Two avoidable delays are demonstrated:

1. **A confirmation read overtook an active Reset.** Whites Reset was released and
   requested at 59942 ms. Command preparation began at 60010.389; a targeted read
   returned -74 at 60074.629, before `resetToDefault` ran at 60105.739–60108.250.
   The polling guard checked command-busy, slept 80 ms, then read without checking
   again. The read's -74 differed from cached authority -38, so the browser retired
   its Reset read demand as though the value had changed. Actual SDK state then
   became 0, but broad snapshots expired during subsequent edits to another slider.
   Zero rendered at 62456, after another read prompted by a repeated Reset at 62292.
   That repeat's SDK call did not begin until 62457.917. This was delayed Controller
   confirmation; the trace does not show Lightroom reverting the first Reset.
2. **Ready confirmations waited an entire background cycle each.** In the rapid
   Reset burst, Clarity read 1180 was requested at 25182 and its Reset finished at
   25328.857. Contrast read 1179 was serviced at 25451.048–25642, but the already-ready
   Clarity read was not dequeued until 25967.467. Between them the worker polled the
   unrelated feedback families and slept. Server-side priority alone could not
   remove this one-request-per-cycle bottleneck.

`FeedbackPolling.lua` now rechecks command-busy after the existing settling yield,
and between snapshot values after their HTTP posts yield. The latter check adds no
settling interval per value. The capture also contains a broad Shadows read during
Reset preparation at 58092.202 ms. A stuck or stopped command does not cause a read
or a fabricated unavailable value. It also drains at most four ready confirmation
requests per cycle, stopping at an ordinary read, an empty queue or a busy timeout.
The bridge adds an optional `confirmation:true` scheduling hint at SDK dequeue;
its existing FIFO, four-confirmation background fairness and immutable dispatch
context remain. The hint is not a command-completion acknowledgement. Old plug-ins
ignore it; a new plug-in with an old server retains one read per cycle.

No Controller display, generic write queue, driver preparation, slider range,
photo/context validation or public Set/Adjust/Reset contract changed in this
follow-up. The existing settling interval and bounded same-value Reset renewal
remain: a read can still precede a queued command's start, and admission is not
execution. The dragging correction remains byte-for-byte intact. Constrain Crop's
feedback optimization remains deferred.

### Actual normal Point Color Reset comparison

The scalar Reset button in `app/controller-point-color.js` calls
`submit(definition.reset, false)`: it immediately shows the known target, bypasses
the input debounce and queues a scalar Set. Its intended value remains distinct
from authoritative state, with swatch/photo ownership and edit sequencing. In Lua,
`PointColor.setValue` performs the swatch update and calls `sendCurrentState` from
the write handler, posting actual SDK readback directly to `/point-color/result`.
It does not wait for a generic feedback-queue request.

Shared Reset calls Lightroom's `resetToDefault` after Develop/panel preparation
(Profile Amount retains its explicit 100 exception). The result must be discovered
from Lightroom, since defaults and ranges vary. Its visible confirmation uses a
separate read queue. Thus both immediate target presentation and direct post-write
feedback account for Point Color's perceived advantage; copying its optimistic
display would not establish that shared Reset executed. No Point Color action was
recorded in this retest, so there is no measured native Point Color timing comparison.
Point Color code is unchanged.

### Reset follow-up verification and next native check

The sanitized `shared-reset-delay-20260928.json` fixture preserves the two failing
timelines. `shared-reset-confirmation.js` executes the actual production Lua module
with cooperative SDK/HTTP doubles. Both captured cases fail against the preserved
previous Lua and pass with the correction. Fourteen scenarios cover the busy race,
the same race between values in many/all snapshots,
bounded failure/shutdown, photo/module changes, unavailability, ready-read draining,
fairness, legacy responses, many-slider snapshots and empty queues.

Focused confirmation priority/HTTP compatibility, Reset queue/delivery, polling
resilience/lifecycle and the actual Controller Reset browser checks pass in isolation.
The captured Brightness rollback regression still passes. Completed physical HTTP
Contrast observations were not repeated. These results do not establish new native
timing or final acceptance.

That source restart, diagnostic reload and focused four-control capture are now
complete, with the bounded results above. No automated native edits, checkpoint,
build or publication. The disabled-plug-in worker defect remains separate and
unresolved.

## September 28 demonstrated SDR Brightness failure

The user reproduced a jump in the fresh 35.109-second touchscreen capture.
Browser, proxy and instrumented SDK evidence cover the full run; only the diagnostic
plug-in consumed commands. Source/package worker logs stayed unchanged. The earlier
disabled-worker defect is separate and does not explain this captured failure.

Times below are milliseconds from Start trace; photo identifiers stay in ignored evidence.

| Boundary | Time | Evidence |
| --- | ---: | --- |
| Latest Brightness input | 25438 | `SDRBrightness=-49`; touch release at 25444 |
| Submitted Set / HTTP admission | 25445 / 25447 | One final Set of -49 |
| Actual SDK write begin / return | 25631.2 / 25633.2 | `setValue(SDRBrightness,-49)` |
| SDK readback | 25854.2 onward | -49; subsequent reads stay -49 |
| Expiry confirmation request | 27448 | Request 4317, browser Develop revision 22 |
| Snapshot HTTP 404 | 27684 | Server revision advanced to 23; snapshot discarded |
| Incorrect browser display | 27697 | Cached authority 0 replaces local -49 |
| Fresh feedback restores display | 28397 | Browser shows -49 again |
| Later, explicit Reset executes | 33248.8 | First subsequent SDK write of 0 |

Earlier requests 4304 and 4309 were invalidated by Develop revisions, leaving
the browser's cached authority at 0. Request 4317 expired before the next browser
context poll. Its error handler still saw matching cached revision 22 and called
`showDevelopSliderLocal(control, control.authoritativeValue)`. That call, not a new
input or SDK write, produced the backward movement.

**This captured rollback was in the Controller. Recorded Lightroom SDK state stayed
-49 throughout it.** There was no old write after the final -49 or slider-specific
conversion error. That bounded finding does not classify every earlier report.
Highlight Saturation worked in this run only; it is not universally accepted.

## Recorded Reset latency

All numbers are milliseconds, rounded. Down→request includes the finger hold;
release→request measures the Controller's activation response. SDK→visible starts
at the SDK mutator's return and ends at the first rendered Reset value.

| # | SDK ID | Down→request | Release→request | Request→SDK begin | SDK return→visible | Release→visible |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | SDRBlend | 66 | 1 | 114 | 145 | 262 |
| 2 | SDRBlend | 33 | 0 | 146 | 819 | 968 |
| 3 | SDRBlend | 100 | 1 | 160 | 492 | 653 |
| 4 | SDRBlend | 167 | 1 | 173 | 794 | 969 |
| 5 | SDRBlend | 134 | 0 | 133 | 1186 | 1321 |
| 6 | SDRBlend | 132 | 0 | 164 | 844 | 1011 |
| 7 | SDRWhites | 117 | 1 | 201 | 797 | 1002 |
| 8 | SDRShadows | 99 | 1 | 290 | 765 | 1058 |
| 9 | SDRHighlights | 83 | 1 | 81 | 985 | 1069 |
| 10 | SDRClarity | 102 | 1 | 88 | 868 | 959 |
| 11 | SDRContrast | 114 | 1 | 98 | 687 | 789 |
| 12 | SDRBrightness | 100 | 1 | 171 | 520 | 694 |

Rows 2 and 3 overlap: they share the first visible zero, not a distinct execution
acknowledgement for each click. Actual SDK calls for both were recorded. Instrumentation
adds read/logging overhead; these are baseline measurements, not fixed native timings.

The dominant delay followed SDK execution. In Reset 5, execution ended at 16563.3
and the SDK observer already saw 0 at 16719.6. Obsolete Set confirmation 4260 was
dequeued at 17048.8 and discarded by its old browser edit generation. Reset read
4262, requested at 16436, did not dequeue until 17629.9; the value rendered at 17749.
Thus confirmation queueing cost another SDK polling opportunity. Touch dispatch itself
was 0–1 ms after release; it is not the demonstrated bottleneck.

## Shared correction and verification

`app/controller.html` now shares `readDevelopSliderConfirmation` between Set/step
and Reset. Confirmation demand belongs to an edit generation and photo/context;
superseded Set reads abort. A missing snapshot triggers a fresh context check.
Only a verified revision invalidation renews the read, within ownership/time bounds.
Every applied SDK result still requires its exact dispatch revision and current
photo identity. Transport errors preserve the local display, explicitly report
unconfirmed state, and permit later authoritative feedback; they cannot invent a
new confirmation from cached authority. No failed or uncertain edit is resent.

`server/bridge.js` accepts optional `purpose=edit` on existing feedback endpoints,
using the same context-bound undispatched demand as Reset. Compatible queued
Set/Reset reads share work. Confirmation reads precede background reads, with a
background opportunity after four confirmations to preserve external edits and
availability feedback. Dispatched snapshots remain immutable and expire normally.
Invalidated Reset reads renew promptly; unchanged pre-execution reads retain their
existing bounded spacing so attempts do not exhaust before the SDK write.

The initial drag correction left the generic write queue, SDK code,
ranges/conversions and public Set/Adjust/Reset contracts unchanged. The subsequent
SDK polling follow-up is described above. The replacement is at the faulty confirmation
boundary, not a speculative SDK tracking change. Legacy generic commands still have
no per-edit SDK completion receipt; HTTP admission is not completion. Physical
captures remain necessary to distinguish actual Lightroom behavior.

Point Color provides the ownership reference: it separates intended/authoritative
values, stamps intent revisions, protects newer coalesced edits and settles through
its own edit-sequence feedback. It also waits for settlement before its next write.
Generic sliders retain their existing faster admission-ordered writes; the captured
SDK stream did not demonstrate write reordering. The correction applies the ownership
principle to their read lifecycle, without copying Point Color's swatch protocol,
normalized units or write serialization policy.

- The sanitized captured fixture and VM replay fail on the old cached rollback and
  pass on the replacement. The real Controller browser test also fails on old source
  rendering 0 over -49 and passes on current source, through DOM input, the actual
  confirmation timer, HTTP 404 and fresh readback.
- Focused checks cover all seven SDR IDs, rapid repeated drags, alternation, A→B→A,
  delayed admissions, immediate Reset, delayed SDK execution, external feedback,
  stale revisions, photo changes, genuine errors and unavailable state.
- Isolated server checks cover confirmation priority, compatible read sharing,
  bounded fairness, immutable dispatch context and public Companion Set/Adjust/Reset
  response compatibility/validation. These are automated simulations, not native
  acceptance.
- Previously accepted touch Reset activation and completed native main Contrast
  Set20 / Adjust35 / Set65→Reset0 observations are retained without repeating them.

That initial native retest is now complete, with the bounded result and Reset
follow-up above. A no-jump run alone does not establish universal resolution;
no build or publication before acceptance.

## Affected controls and existing shared path

| UI label in SDR Rendition | Metadata / SDK ID |
| --- | --- |
| Brightness | `SDRBrightness` |
| Contrast | `SDRContrast` |
| Clarity | `SDRClarity` |
| Highlights | `SDRHighlights` |
| Shadows | `SDRShadows` |
| Whites | `SDRWhites` |
| Highlight Saturation | `SDRBlend` |

All seven use direct integer values, unit range/numeric steps and zero displayed
decimal places. Their catalog seed range is -100 to 100; admission and presentation
require the current Lightroom runtime range. `HDRMaxValue` is the separate HDR Limit
control, with a log2 visual scale and 0.1 value precision.

The shared pipeline is `createDevelopSliderControl` in `app/controller.html` →
`/api/set` or `/api/reset` → public `/set` or `/reset` → `server/commands.js` →
`/next` → `Commands.execute` → `Driver.lua` → `LrDevelopController`. Generic
Companion `/adjust` reaches the same Driver through `develop.adjust`.

Current browser submission serialization ends at HTTP admission. Throttled values
coalesce per control; final input owns a local edit generation and bounded feedback
confirmation. The server coalesces queued Set/Reset by slider and captured context,
moving the replacement to the queue tail. Adjacent Adjust commands sum increments.
Dequeue is not an execution receipt. Generic feedback has request IDs/context but
does not identify the edit whose SDK execution preceded a read. These are observed
architectural boundaries; the captured failure above occurs in confirmation error handling.

`Driver.setSlider` starts SDK tracking for generic numeric controls; only HDR Limit
explicitly stops global tracking. Reset calls `resetToDefault`, except Profile Amount
which requests 100. The exact tracking lifecycle must be checked against physical
evidence and the installed SDK contract before changing it. Do not infer that an
open tracking interval by itself proves the failure.

## Inventory of all slider families

| Family | Current implementation / transport | Values and ownership to preserve |
| --- | --- | --- |
| Profile Amount | Shared Develop control; `Driver` | 0–200 integers, Reset 100, strict confirmed Profile capability, no Adjust. |
| Basic Tone, Color, Presence | Shared Develop control; `Driver` | Per-ID metadata and current runtime ranges; Exposure range step 0.1/numeric step 0.01; Temperature visual conversion depends on the runtime range; White Balance ownership. |
| HDR Limit and SDR Rendition | Shared Develop control; `Driver` | Runtime range mandatory, photo/context admission, immediate unavailability, no cached authority across render; no Adjust. HDR Edit Mode is a checkbox on the same generic API, not a slider. |
| Detail / sharpening / conventional noise reduction | Shared Develop control; `Driver` | Metadata precision and SDK aliases, including LuminanceNR → LuminanceSmoothing and ColorNR → ColorNoiseReduction. |
| HSL and B&W Mixer | Shared Develop control; `Driver` | Hue/Saturation/Luminance × eight colors and eight GrayMixer values; treatment changes and replacement rows must invalidate old ownership. |
| Effects and Calibration | Shared Develop control; `Driver` | Metadata precision/ranges, dependent vignette controls. Grain Size/Roughness shown in Masking still use shared global controls with verified `preserveMaskingPanel` ownership. |
| Lens corrections, Defringe and Transform | Shared Develop control; `Driver`; compound Defringe presentation delegates to shared endpoint controls | Native ranges, low/high constraints, numeric precision, unavailable states. Lens profile and chromatic-aberration toggles are not sliders. |
| Parametric Tone Curve regions and splits | Shared Develop controls; compound split presentation | Ordered split constraints and minimum gaps; coalescing must not invalidate a coupled range. |
| SDK Lens Blur Amount / Bokeh Bias / Boost | Shared Develop controls; `Driver` | `LensBlurAmount`, `LensBlurCatEye`, `LensBlurHighlightsBoost`; preserve SDK availability and runtime ranges. |
| Crop Angle | Separate functions in `controller.html`; `photo.crop_angle.*`; `Crop.lua` | -45–45, step 0.1; crop-only Reset and photo/tool context; separate pending/throttle state. |
| Color Grading scalar sliders and wheels | `controller-color-grading.js` scalar/pair dispatchers; `color_grading.*`; `ColorGrading.lua` | Four hue/saturation/luminance triplets plus Blending/Balance (14 SDK parameters), runtime ranges; paired wheel writes; own pending revisions and Reset tracker. |
| Global and mask Point Color | Shared `controller-point-color.js` with distinct context adapters; `point_color.*` / `masking.point_color.*` | Five scalar fields; UI hundredths conversion (UI -100–100 or 0–100 ↔ SDK -1–1 or 0–1); three ordered four-boundary ranges and range translation. Preserve photo/swatch/mask identity, operation sequencing, normalization/error handling. |
| Global and mask Point Curve / Refine Saturation | `controller-tone-curve.js`; `tone_curve.*` / `masking.tone_curve.*`; respective Lua handlers | Ordered curve points/channels and integer Refine Saturation in runtime range; explicit begin/update/end/cancel; global versus local tracking and mask group ownership. |
| Mask correction sliders | `controller-masking.js` + `controller-masking-corrections.js`; `masking.correction.*`; `Masking.lua` | Twenty visible catalog definitions (Refine Saturation belongs to the curve editor); three hidden legacy toning definitions retained. Range width ≤20 uses two decimals, otherwise integers. Group/photo/revision ownership and local tracking. |
| Develop Preset Amount | `controller-develop-presets.js`; `develop_preset.amount.set`; `DevelopPresets.lua` | 0–200 integers, Reset 100; preset capability, intent revisions and authoritative settlement; does not use generic Profile Amount. |
| Denoise Amount | Separate `controller-denoise-state.js` model + `controller.html`; Enhance routes/Lua | 1–100 integers, Reset 50; confirmed On/availability and pending guards; checkbox independent; accepted disabled styling/layout preserved. |
| Lens Blur refinement brush | Separate `createLensBlurNativeSlider`, `controller-lens-blur.js`, native server helper | Amount/Feather/Flow integer, Size step 0.1/one decimal, live min/max; per-interaction request ownership, pending values, native verified control identity. |
| Lens Blur focal range | Separate dual-handle UI/model; `/lens-blur/focal-range/set`; SDK `LensBlurFocalRange` | Paired range, commit ID and confirmed state; no conversion to generic scalar commands. |
| Remove brush / threshold / selected repair | `controller-remove.js`; remove routes/state; `Remove.lua` | Size 1–100; Feather/Threshold 0–100; repair Opacity/Feather UI 0–100 ↔ SDK 0–1; intentional LRBridge Reset targets, selected repair/context/operation ownership. |
| Reflections Amount | `controller-reflections.js`; reflections routes/state; `Reflections.lua` | -100–100 integers; intentional Reset 100; callback and native readback, operation identity and availability. |

Custom range handles (Defringe, parametric splits, Point Color and Lens Blur focus)
are included above even where the rendered input is not an HTML range element.
The generic catalog has 111 entries including three switches. Some catalog entries
are exposed only through their supported API/presentation; metadata is not evidence
that every parameter is available on every Lightroom photo.

## Broader coordination contract and remaining gates

The captured correction above replaces shared confirmation handling and scheduling.
It does not introduce end-to-end write receipts/client tokens; that broader protocol
item remains distinct from the demonstrated display rollback. Do not claim the entire
contract below or physical slider acceptance from passing simulations.

- An edit has an explicit owner (server epoch, client/session, intent sequence,
  photo/context and parameter). A confirmation identifies executed work and its
  authoritative readback. Admission cannot be reported as SDK completion.
- User presentation and SDK authority are separate. An older read cannot settle a
  newer intent, including equal-value A→B→A sequences. After settlement, subsequent
  Lightroom edits remain visible; failures and unavailable states must be surfaced.
- Coalescing may supersede unsent absolute values. It must preserve relative Adjust
  semantics, terminal gesture/Reset ordering and relevant command barriers. An old
  client retry or queued value cannot run after the final owned intent.
- Photo/module/context changes cancel pending work. Verify ownership again at the
  SDK write boundary, including yields during preparation. Develop revisions need
  explicit treatment for own writes versus external changes; do not remove guards.
- Reset cancels older unsent drag/step values and owns its confirmation. Preserve
  accepted touchscreen activation, SDK defaults, and Profile/Denoise exceptions.
- Preserve public Set/Adjust/Reset URLs, parameter validation and rejected unsupported
  operations. Optional protocol additions cannot require old Companion clients to
  generate new identifiers. Ordinary SDK increments are not assumed to equal one
  numeric step; SDR Adjust stays unsupported.
- Use Point Color as a reference for intent/settlement ownership. Its swatch API,
  normalized units and mask-specific operation protocol cannot be copied unchanged.
- Replay the captured failing sequence against old production code and require a
  failing assertion at the observed boundary; run the same regression against the
  replacement. Include rapid repeat drags, alternating sliders, A→B→A, immediate
  Reset, Set/Adjust/Reset mixes, photo/context transitions, external Lightroom edits,
  SDK exceptions, unavailable/range changes and late confirmations.
- Exercise real HTTP handlers, queue, Lua Driver with controlled SDK doubles and
  the actual Controller browser. Distinguish model assertions, production-path
  simulation, physical SDK traces and user acceptance in every report.
- Native retest must establish whether Lightroom itself stays at the intended value
  for Companion routes, alongside Controller appearance. Keep release blocked until
  that retest passes. No package rebuild or publication during diagnosis.

The September 28 capture now supplies a concrete confirmation-error reproduction;
its fixture fails old source and passes the correction. Prior passing simulations
remain guard coverage. Reuse the completed native main Contrast HTTP observations;
the next physical test targets the changed touchscreen confirmation and Reset paths.

## Generic parameter inventory at the baseline

Ranges below are catalog seeds, not a substitute for Lightroom availability or runtime ranges. The full per-ID flags remain in `config/sliders.json`. No metadata has been changed.

| Group | ID / label | SDK parameter | Seed min…max | Range / numeric step | Decimals | Scale | Adjust | Reset |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Profile | `ProfileAmount` / Profile Amount | `ProfileAmount` | 0…200 | 1 / 1 | 0 | direct | no | 100 |
| HDR / SDR Rendition | `HDREditMode` / HDR Edit Mode | `HDREditMode` | 0…1 | 1 / 1 | 0 | direct | no | no |
| HDR / SDR Rendition | `HDRMaxValue` / HDR Limit | `HDRMaxValue` | 1…8 | 0.1 / 0.1 | 1 | log2 | no | SDK default |
| HDR / SDR Rendition | `SDRBrightness` / Brightness | `SDRBrightness` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| HDR / SDR Rendition | `SDRContrast` / Contrast | `SDRContrast` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| HDR / SDR Rendition | `SDRClarity` / Clarity | `SDRClarity` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| HDR / SDR Rendition | `SDRHighlights` / Highlights | `SDRHighlights` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| HDR / SDR Rendition | `SDRShadows` / Shadows | `SDRShadows` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| HDR / SDR Rendition | `SDRWhites` / Whites | `SDRWhites` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| HDR / SDR Rendition | `SDRBlend` / Highlight Saturation | `SDRBlend` | -100…100 | 1 / 1 | 0 | direct | no | SDK default |
| Basic | `Exposure` / Exposure | `Exposure` | -5…5 | 0.1 / 0.01 | 2 | direct | SDK increments | SDK default |
| Basic | `Contrast` / Contrast | `Contrast` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Basic | `Highlights` / Highlights | `Highlights` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Basic | `Shadows` / Shadows | `Shadows` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Basic | `Whites` / Whites | `Whites` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Basic | `Blacks` / Blacks | `Blacks` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color | `Temperature` / Temperature | `Temperature` | -100…100 | 1 / 1 | 0 | temperature | SDK increments | SDK default |
| Color | `Tint` / Tint | `Tint` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color | `Vibrance` / Vibrance | `Vibrance` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color | `Saturation` / Saturation | `Saturation` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Presence | `Texture` / Texture | `Texture` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Presence | `Clarity` / Clarity | `Clarity` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Presence | `Dehaze` / Dehaze | `Dehaze` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `Sharpness` / Sharpness | `Sharpness` | 0…150 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `SharpenRadius` / Sharpen Radius | `SharpenRadius` | 0.5…3 | 0.1 / 0.01 | 2 | direct | SDK increments | SDK default |
| Detail | `SharpenDetail` / Sharpen Detail | `SharpenDetail` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `SharpenEdgeMasking` / Sharpen Masking | `SharpenEdgeMasking` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `LuminanceNR` / Luminance Noise Reduction | `LuminanceSmoothing` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `LuminanceNoiseReductionDetail` / Luminance NR Detail | `LuminanceNoiseReductionDetail` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `LuminanceNoiseReductionContrast` / Luminance NR Contrast | `LuminanceNoiseReductionContrast` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `ColorNR` / Color Noise Reduction | `ColorNoiseReduction` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `ColorNoiseReductionDetail` / Color NR Detail | `ColorNoiseReductionDetail` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Detail | `ColorNoiseReductionSmoothness` / Color NR Smoothness | `ColorNoiseReductionSmoothness` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentRed` / Hue Red | `HueAdjustmentRed` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentOrange` / Hue Orange | `HueAdjustmentOrange` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentYellow` / Hue Yellow | `HueAdjustmentYellow` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentGreen` / Hue Green | `HueAdjustmentGreen` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentAqua` / Hue Aqua | `HueAdjustmentAqua` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentBlue` / Hue Blue | `HueAdjustmentBlue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentPurple` / Hue Purple | `HueAdjustmentPurple` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `HueAdjustmentMagenta` / Hue Magenta | `HueAdjustmentMagenta` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentRed` / Saturation Red | `SaturationAdjustmentRed` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentOrange` / Saturation Orange | `SaturationAdjustmentOrange` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentYellow` / Saturation Yellow | `SaturationAdjustmentYellow` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentGreen` / Saturation Green | `SaturationAdjustmentGreen` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentAqua` / Saturation Aqua | `SaturationAdjustmentAqua` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentBlue` / Saturation Blue | `SaturationAdjustmentBlue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentPurple` / Saturation Purple | `SaturationAdjustmentPurple` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `SaturationAdjustmentMagenta` / Saturation Magenta | `SaturationAdjustmentMagenta` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentRed` / Luminance Red | `LuminanceAdjustmentRed` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentOrange` / Luminance Orange | `LuminanceAdjustmentOrange` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentYellow` / Luminance Yellow | `LuminanceAdjustmentYellow` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentGreen` / Luminance Green | `LuminanceAdjustmentGreen` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentAqua` / Luminance Aqua | `LuminanceAdjustmentAqua` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentBlue` / Luminance Blue | `LuminanceAdjustmentBlue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentPurple` / Luminance Purple | `LuminanceAdjustmentPurple` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Color Mixer / HSL | `LuminanceAdjustmentMagenta` / Luminance Magenta | `LuminanceAdjustmentMagenta` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerRed` / B&W Red | `GrayMixerRed` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerOrange` / B&W Orange | `GrayMixerOrange` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerYellow` / B&W Yellow | `GrayMixerYellow` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerGreen` / B&W Green | `GrayMixerGreen` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerAqua` / B&W Aqua | `GrayMixerAqua` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerBlue` / B&W Blue | `GrayMixerBlue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerPurple` / B&W Purple | `GrayMixerPurple` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| B&W Mixer | `GrayMixerMagenta` / B&W Magenta | `GrayMixerMagenta` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `PostCropVignetteAmount` / Vignette Amount | `PostCropVignetteAmount` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `PostCropVignetteMidpoint` / Vignette Midpoint | `PostCropVignetteMidpoint` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `PostCropVignetteFeather` / Vignette Feather | `PostCropVignetteFeather` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `PostCropVignetteRoundness` / Vignette Roundness | `PostCropVignetteRoundness` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `PostCropVignetteHighlightContrast` / Vignette Highlights | `PostCropVignetteHighlightContrast` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `GrainAmount` / Grain Amount | `GrainAmount` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `GrainSize` / Grain Size | `GrainSize` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Effects | `GrainFrequency` / Grain Roughness | `GrainFrequency` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `ShadowTint` / Shadow Tint | `ShadowTint` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `RedHue` / Red Primary Hue | `RedHue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `RedSaturation` / Red Primary Saturation | `RedSaturation` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `GreenHue` / Green Primary Hue | `GreenHue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `GreenSaturation` / Green Primary Saturation | `GreenSaturation` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `BlueHue` / Blue Primary Hue | `BlueHue` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Calibration | `BlueSaturation` / Blue Primary Saturation | `BlueSaturation` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `LensProfileDistortionScale` / Profile Distortion | `LensProfileDistortionScale` | 0…200 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `LensProfileEnable` / Enable Profile Corrections | `LensProfileEnable` | 0…1 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `AutoLateralCA` / Remove Chromatic Aberration | `AutoLateralCA` | 0…1 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `LensProfileChromaticAberrationScale` / Profile Chromatic Aberration Scale (old SDK / unsolved) | `LensProfileChromaticAberrationScale` | 0…200 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `LensProfileVignettingScale` / Profile Vignetting | `LensProfileVignettingScale` | 0…200 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `LensManualDistortionAmount` / Manual Distortion | `LensManualDistortionAmount` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `VignetteAmount` / Manual Lens Vignetting Amount | `VignetteAmount` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `VignetteMidpoint` / Manual Lens Vignetting Midpoint | `VignetteMidpoint` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `DefringePurpleAmount` / Purple Defringe Amount | `DefringePurpleAmount` | 0…20 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `DefringePurpleHueLo` / Purple Hue Low | `DefringePurpleHueLo` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `DefringePurpleHueHi` / Purple Hue High | `DefringePurpleHueHi` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `DefringeGreenAmount` / Green Defringe Amount | `DefringeGreenAmount` | 0…20 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `DefringeGreenHueLo` / Green Hue Low | `DefringeGreenHueLo` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens / Defringe | `DefringeGreenHueHi` / Green Hue High | `DefringeGreenHueHi` | 0…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Transform | `PerspectiveVertical` / Transform Vertical | `PerspectiveVertical` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Transform | `PerspectiveHorizontal` / Transform Horizontal | `PerspectiveHorizontal` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Transform | `PerspectiveRotate` / Transform Rotate | `PerspectiveRotate` | -10…10 | 0.1 / 0.01 | 2 | direct | SDK increments | SDK default |
| Transform | `PerspectiveScale` / Transform Scale | `PerspectiveScale` | 50…150 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Transform | `PerspectiveAspect` / Transform Aspect | `PerspectiveAspect` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Transform | `PerspectiveX` / Transform X Offset | `PerspectiveX` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Transform | `PerspectiveY` / Transform Y Offset | `PerspectiveY` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricDarks` / Curve Darks | `ParametricDarks` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricLights` / Curve Lights | `ParametricLights` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricShadows` / Curve Shadows | `ParametricShadows` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricHighlights` / Curve Highlights | `ParametricHighlights` | -100…100 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricShadowSplit` / Curve Shadow Split | `ParametricShadowSplit` | 10…70 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricMidtoneSplit` / Curve Midtone Split | `ParametricMidtoneSplit` | 20…80 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Tone Curve | `ParametricHighlightSplit` / Curve Highlight Split | `ParametricHighlightSplit` | 30…90 | 1 / 1 | 0 | direct | SDK increments | SDK default |
| Lens Blur | `LensBlurAmount` / Blur Amount | `LensBlurAmount` | 0…100 | 1 / 1 | 0 | direct | no | SDK default |
| Lens Blur | `LensBlurCatEye` / Cat Eye | `LensBlurCatEye` | 0…100 | 1 / 1 | 0 | direct | no | SDK default |
| Lens Blur | `LensBlurHighlightsBoost` / Boost | `LensBlurHighlightsBoost` | 0…100 | 1 / 1 | 0 | direct | no | SDK default |
