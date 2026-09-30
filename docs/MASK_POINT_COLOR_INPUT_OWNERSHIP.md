# Masked Point Color input ownership — September 29

**Manual test accepted:** the user saw no slider jumps in the recorded run and
confirms Toggle Visualize Range visibly worked in Lightroom. Preserve the fix,
regression tests and recording. No repeat capture is needed unless the problem
returns. Other release items remain separate; this is not overall release approval.

The original report involved intermittent jumps in all three masked Hue Shift,
Saturation Shift and Luminance Shift sliders, followed by an unresponsive Visualize
button. The reproduced Controller defect below does not establish whether native
Lightroom also rolled back in the earlier unrecorded run. The `local_Texture`
regression remains separate from this Point Color report.

## Comparison and demonstrated event

The preserved pre-change `controller-point-color.js` and `controller-masking.js`
match HEAD `98d0815` after newline normalization. The recent Visualize Range
change separates the button's reservation from pending edits only when admitting
that button's own request. Ordinary `isBusy()` remains equivalent to HEAD;
`acceptRefreshedState()` still sends accepted snapshots to the child. No evidence
establishes that busy exception as the cause. This follow-up does not change it
or the parent controller.

Scalar `input` previously updated the DOM immediately, then waited 225 ms to
`enqueue()` the edit. Only enqueue recorded `intended` and its intent revision.
During that interval, `applyAuthoritative()` could replace the new DOM value
with older feedback or the previous outstanding intent. An older confirmation
could also clear presentation ownership because the newer input had no revision.

The test drives the actual masked parent/child, production server admission and
production Lua Point Color handler with DOM/SDK doubles. For example:

| Event | Input/display | Submitted/SDK value |
|---|---:|---:|
| Confirmed initial Hue Shift | 10 | 0.10 |
| Browser `input`, debounce still pending | 65 | No command yet |
| Parent snapshot still contains 0.10 | **10** | No command yet |
| Browser `change` reads overwritten slider | 10 | **0.10** |

The same reproduction works for `SatScale` (20), `LumScale` (−10), `Variance`
(0) and `RangeAmount` (50). A real Chromium test independently reproduces the
10-versus-65 display failure against the preserved HEAD child. This demonstrates
a Controller rollback and a path to a wrong submitted value. The simulated SDK
write is not a recording of native Lightroom rolling back.

## Focused correction

- Scalar input immediately owns its intended value and intent revision. Enqueue
  retains that revision. An older completion cannot clear a newer input waiting
  for debounce. The 225 ms cadence, coalescing and serialization are unchanged.
- Release/Reset clear both the timer and its handle. Previously a cancelled
  handle could leave Point Color and the parent marked busy after confirmation.
- Pipeline rebasing cancels outstanding scalar input timers. Tests demonstrated
  an old input reaching a newly selected swatch, and an unsent input firing after
  an SDK failure; both are now cancelled. No uncertain request is retried.
- Authoritative state, server admission, API shapes, SDK writes, scalar ranges,
  conversion/precision, custom range-handle behavior and confirmation remain
  unchanged. Error/timeout messages remain visible and later external Lightroom
  changes are accepted after settlement.

Photo UUID, context counter/time, Develop counter, server epoch and mask ID still
bind the edit generation. Selected swatch index/count and availability still
invalidate the child selection. The existing SDK selected-index check remains;
no new stable swatch identifier is invented.

The earlier accepted masked Hue Shift fix is byte-for-byte intact in
`Masking.lua`: scalar confirmation requires the requested value within 0.000001,
using the same bounded 12 checks, SDK/context errors and no repeated write.
Normal Point Color uses this same child and retains its response cadence. The
three custom Hue/Saturation/Luminance range controls have their separate pointer
ownership path; focused pointer/feedback checks pass without tuning that path.

## Automated evidence

Run only these focused checks:

```text
node tests/mask-point-color-input.js
node tests/mask-point-color-input-browser.js
node tests/mask-point-color-input-browser.js --visualize-after-input-only
node tests/mask-point-color-confirmation.js
node tests/point-color-controller-shared.js
```

The six new regression groups fail against the pre-fix working source and pass
afterward. Coverage includes all five scalar inputs; older confirmation during
a new debounce; repeated left/right and alternating controls; old and duplicate
parent/results; Reset during adjustment including Range's 50 default; photo,
Develop, mask, swatch and unavailable transitions; SDK rejection, admission
timeout, feedback timeout; and later external authoritative changes. The real
Chromium check fails against HEAD and passes with the corrected child. Existing
strict scalar confirmation/tolerance/failure checks and shared global/mask
controls, range handles and Visualize Range checks pass.

The focused `--visualize-after-input-only` follow-up runs each of the three shifts
independently in real Chromium. Against the pre-cleanup child (with the Visualize
reservation fix already present), old parent feedback repaints 65 as 10/20/−10.
After release and confirmed feedback the cancelled timer handle still makes
`hasPendingEdits()` true. The enabled Visualize button receives a click, but
`sendOperation()` returns false at `correctionBusy(true)` before HTTP: zero
requests and no server error. With the unchanged current correction each shift
retains 65, releases busy after confirmation, and dispatches one toggle request.
An intentional synthetic HTTP 409 stays visible without a fabricated toggle
state. This verifies the timer cleanup addresses a demonstrated cause of the
second symptom; the subsequent recorded native test is now accepted below.

The same already-prepared observer records the toggle click and interaction
state even when no request follows, and records fetch/HTTP status and error body
when a request fails. Its plumbing was tested with both outcomes. The live
capture and production runtime were not restarted or changed for this follow-up.

The new tests can replay the immutable child with
`LRBRIDGE_POINT_COLOR_TEST_SOURCE`; the input test's `--demonstrate-weakness`
prints the pre-fix events. Recorder plumbing is checked with synthetic feedback
only using optional `LRBRIDGE_POINT_COLOR_OBSERVER`. No live Lightroom edits,
native UI automation or screenshots are part of these tests.

## Completed native capture — user accepted

The September 29 capture ran from 02:17:22.144 to 02:17:58.808 UTC and finished
normally at the user's request. Original streams and independently hashed copies
are preserved. The user explicitly confirms no visible slider jumps and working
Visualize Range in Lightroom, and accepts the manual test. Do not test again on
the finished page or repeat the capture unless the problem returns.

- 473 scalar `input` events across all five rows; 615 display snapshots. No scalar
  displayed-value mismatch against the latest input or Reset was recorded. The
  only five programmatic range-input value assignments were the five Reset clicks.
- 55 admitted Point Color commands: 52 scalar writes and three custom full-range
  translations. All have confirmed results whose first recorded SDK-derived
  snapshots match the requested values. One photo/mask/swatch binding throughout.
- Five Visualize clicks: at +9.496 s the parent silently returned before HTTP
  because Saturation was awaiting confirmation and Hue was queued. This is real
  pending work, not a stale timer. The next four clicks sent requests within 3–5 ms,
  each received HTTP 200 and a confirmed plug-in operation result. Click to reported
  completion was 56, 291, 204 and 191 ms. These are result-arrival timings, not exact
  SDK execution timestamps or proof of a visible native On/Off state.
- Final busy flag false; zero queued edits and zero awaiting confirmations. No
  HTTP errors. A guarded Visualize click has no explanatory feedback in this
  implementation; this remains a separate open usability issue. It does not reopen
  the accepted slider fix or authorize further tuning.

Reset evidence was preserved without retuning: four resets during the command
backlog waited 1.06–1.50 s before dispatch and 1.52–1.95 s until feedback arrived.
The later Hue reset with no backlog dispatched in 2 ms and received feedback in
344 ms. This is the Point Color queue, not the accepted standard slider Reset
implementation. No responsiveness acceptance is inferred from eventual completion.

The observer's input/value-assignment/state records and proxy request/response
records are intact. The live app captured its fetch reference before injection,
so the browser stream contains no fetch events; the proxy provides those events.
There are no per-SDK-write hooks, so unsampled native changes cannot be ruled out.
The user's visible Lightroom outcome is accepted for this run. Other release
work remains pending. No further runtime changes, tests, recordings or photo
edits were made during analysis or recording this acceptance.

## Source pair and capture procedure used

Keep the running source app and `D:\Projects\LRBridge\lightroom\LRBridge.lrplugin`.
The current source EXE is `D:\Projects\LRBridge\node_modules\electron\dist\electron.exe`
with `D:\Projects\LRBridge\app\main.js`. This browser-only correction needs no
app restart or Lightroom reload; the fresh capture page loads the corrected JS.

Historical procedure: open **Masking → Point Color**, use **Start trace**, make
repeated/alternating adjustments and Reset, press **Toggle Visualize Range**, then
**Finish trace**. The completed capture and user observations above are the record;
these are not instructions to repeat the accepted test.

The observer records browser input, value assignments (including writer stacks),
HTTP requests/results, and the real SDK-derived Masking snapshots with mask,
swatch and context identity. It does not add per-SDK-call instrumentation or
invent evidence between readbacks. All previous recordings and the comparison
package/VM remain intact. Other September 29 findings retain their documented
pending native checks; cosmetic work is paused.
