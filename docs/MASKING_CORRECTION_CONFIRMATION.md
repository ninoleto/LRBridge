# Regular Masking confirmation under rapid input

Status: the September 30 continuation below adds focused context/queue corrections;
automated checks pass, but native validation remains pending. The user reports good
normal-speed behavior, but extremely fast regular
Masking adjustments show delayed Updating and a confirmation timeout. Preserve the
separately accepted masked Point Color work and its recording.

## Demonstrated faults

The exact message ending **in time** originates in the browser's 3000 ms timer.
The Lua mismatch error has different wording. Neither a browser timeout nor a
later confirmed final result establishes whether Lightroom failed during the
reported event. Existing native logs lack the per-edit sequence/value evidence
needed to assign that event conclusively; the preceding Point Color capture was
scoped to another path.

Two deterministic sequences using the production Controller and state machine,
with simulated SDK feedback, demonstrate LRBridge faults:

1. Finish Texture at 50, then Sharpness at 70. Accept both actual-value confirmations
   before one browser poll. The old server returns only Sharpness's result, even
   though both authoritative values are correct. Texture remains Updating and
   times out. A genuine Texture failure can also be displaced, losing its useful
   error detail. Repeated alternating adjustments reproduce the same problem.
2. Finish Texture at 20, then start dragging to 80 just before the prior deadline.
   The old timer has no local-edit owner: it reports the previous timeout and
   clears the newer displayed value. Late admission of the old end request can
   create the same timer after the new gesture has begun. The 350 ms step-button
   debounce is another exposed interval. An older rejected HTTP request can
   similarly clear newer input and queued work.

The demonstrated rollback is in the Controller. These simulations do not establish
an actual Lightroom rollback or identify the user's exact native event.

## Correction and preserved behavior

- `server/masking-state.js` publishes additive `correctionResults`, retaining the
  latest validated result for each supported parameter, bounded by the existing
  parameter catalog. Clear these results on photo/context or mask selection
  invalidation, including navigating away and back. Return defensive copies.
  Keep the legacy `lastCorrectionResult` and global sequence/stale-result rules.
- `app/controller-masking.js` consumes per-parameter outcomes, with fallback for
  older servers. Local edit revisions identify owners of admission failures and
  completion timers; queued requests retain their owner. New gestures, steps,
  Reset and cancellation invalidate obsolete deadlines without delaying input.
- Real latest HTTP errors, SDK failures, queue rejections and missing confirmation
  remain visible. Matching values alone are not confirmation. A late authoritative
  completion can recover the UI, and subsequent native changes remain authoritative.
- Keep the 100 ms update cadence, 350 ms step debounce, 450 ms state polling and
  3000 ms completion deadline. Queue coalescing, SDK writes/readback, ranges,
  precision and HTTP commands are unchanged. Reset still requires its own result.
- This covers the ordinary `local_*` Amount/Tone/Color/Effects/Detail rows, including
  local Grain Amount. Shared global Grain Size/Roughness, Point Color and Masking
  Tone Curve use their existing separate implementations. The accepted Point Color
  source, its parent integration and both Masking/PointColor Lua files are unchanged
  by this follow-up. No plug-in reload is required.

## Focused verification

```powershell
node tests/masking-correction-confirmation.js
node tests/masking.js --corrections-only
# Set LRBRIDGE_MASKING_CORRECTION_OBSERVER to the prepared private browser-observer.js.
node tests/masking-correction-capture-browser.js
```

Eleven deterministic checks cover alternating/repeated adjustments, obsolete and
delayed deadlines, step debounce, latest versus superseded failures, missing
confirmation, immediate Reset, photo/mask/unavailable transitions, HTTP failures,
duplicate/out-of-order completion and queue rejection. The pre-change snapshot
fails the demonstrated regression sequences; current source passes. Existing
correction metadata, Controller, real isolated HTTP/queue and stale-context checks
pass. Chromium verifies the actual regular-control DOM, cross-slider settlement,
and observer input/status/feedback capture. All automated feedback is simulated;
no commands went to the running Lightroom instance. No broad suite or accepted
Point Color retest was run.

## One pending native capture

The prepared capture below has now finished; do not reuse its link or repeat it
automatically. The September 30 findings follow these historical instructions.

Restart only source LRBridge to load the server changes, then reopen the new
private capture link from the local handoff. Keep the matching source plug-in
already registered. The capture refuses to start with the old server and has no
running preparation deadline. Press **Start trace** when ready; verify **Live trace
recording — Masking → Effects / Detail**. Use regular Texture and Sharpness on one
test photo/mask at the speed that caused trouble. Stop on the error, let feedback
arrive for five seconds, then **Finish trace** and report Lightroom's final values.

The proxy records actual requests/responses independently of the browser's saved
fetch reference. The observer records input, display assignments, statuses and
parent feedback with photo/context/mask/sequence identity. These are returned
SDK-derived snapshots, not per-SDK-call timing or continuous native observation.
If a latest edit still misses its deadline, distinguish queued execution, genuine
SDK failure and delayed feedback from superseded work before making another fix.
Keep the comparison package, VM and earlier recordings unchanged. Release remains
blocked pending the native result and previously documented release gates.

## September 30 finished trace: exact errors remain distinct

The capture lasted 27.592 seconds (September 29 22:17:19.239–22:17:46.831 UTC;
September 30 local time). Originals and independently hashed copies are preserved
via `local-checkpoints/masking-confirmation-recording-current.txt`, including
browser events, all 514 proxied request/response pairs, and a source-app log
snapshot. The private `analyze-capture.js` reproduces `analysis.json` offline.
No source changes, native edits, new recording or functional-test rerun accompany
this analysis.

The user reports a brief error followed by updates and identifies the screenshot
as local Grain Amount with **That correction is no longer available for the
selected mask.** The recorded evidence requires a distinction:

- The exact message is captured on **Dehaze**, along with 31 HTTP 409 responses
  to gesture-begin requests, +6.535 through +6.930 seconds. Those requests still
  carry Develop counter 2 after the server advances to 3 at +6.519 seconds. The
  photo UUID and selected mask remain unchanged. Feedback briefly reports
  `context_changed` with no usable snapshot, then returns the same mask at
  +6.897 seconds. The browser receives the newer global context at +6.938 seconds.
  Responses take 1–2 ms: these are fresh stale-context rejections, not delayed
  responses from an older completed edit. The server rejects admission before
  queueing; the Controller translates every 409 into the quoted availability
  message. That message does not distinguish a stale Develop binding from an
  unsupported parameter. No permanent Dehaze capability loss is established.
- Every one of the 22 captured **local Grain Amount** requests returns HTTP 200.
  The final input is 10 at +22.185 seconds, release at +22.190, request at +22.192,
  and admission at +22.193 as correction sequence 140 (same photo/mask, Develop
  counter 4). A successful admission is not confirmed execution. No confirmation
  for 140 is captured, and returned local Grain values continue to be -67.
- At +25.206 seconds, `correctionFailure` changes the browser value from 10 back
  to -67. The +25.221 display sample contains **Lightroom did not confirm that
  Masking correction in time.** There is no newer Grain edit to supersede this
  final adjustment. The error clears and the row disables at +25.520 during the
  next context refresh; it re-enables at +26.223 still at -67. Final feedback and
  the finished browser state still contain -67. This clearing does not prove the
  requested 10 succeeded. A subsequent recovery outside the recording is unknown.

All usable recorded snapshots have the same photo and selected mask. Develop
counter transitions, unlike photo/mask changes, occur several times. Around the
last Grain request, context responses report 13–15 queued commands; nine remain
just before the next Develop change, then the queue drains. The trace does not
identify individual dequeues, SDK writes or cancellations, so it cannot establish
whether sequence 140 was attempted in Lightroom, dropped as stale, or briefly
changed a value between returned samples. SDK sampled state does not prove an
absence of unsampled native changes.

**Keep Grain's implementations separate:** Amount is `local_Grain` on the Masking
correction path. Size is global `GrainSize`, Roughness is global `GrainFrequency`;
their source-app log entries use separate `develop.set` commands with masking-panel
preservation. These global parameters are in the Develop fingerprint, so their
updates can invalidate a Masking Develop binding. The capture observer/proxy was
scoped to regular local corrections; the global commands have no captured input
or SDK execution timestamps. Their presence is evidence of interleaved global
work, not proof of which exact update caused a fingerprint transition.

The quoted Grain unavailable screenshot has no matching Grain HTTP 409 or browser
status in this finished recording. Its timing remains unconfirmed and separate;
the user explicitly directed continuation from the two recorded failures without
waiting for that clarification. Do not relabel the captured Grain timeout as the
different screenshot error. Regular Masking remains unaccepted.

## September 30 continuation: context rejection and queued final values

### Evidence and remaining uncertainty

The Develop counter is advanced by `/context/update` when the SDK polling worker
sends a different Develop fingerprint. Photo/mask selection need not change. That
fingerprint includes global `GrainSize` and `GrainFrequency`, but not local Grain
Amount. The recovered SDK log shows global Grain writes around 00:17:24–25 and
00:17:44 local time. Near the first rejection, recorded global Size readback
changes from 25 to 54. These writes can advance the counter. The historical log
does not record the fingerprint's individual inputs or its exact heartbeat, so
assigning a particular counter transition exclusively to those writes would
exceed the evidence. Transient unavailable fingerprint inputs remain distinguishable
only with the new instrumentation; they are not an established cause.

For Dehaze, the Controller's Masking poll arrives before its host context poll.
It correctly refuses to adopt a snapshot with a mismatched Develop binding, but
previously kept submitting the old one: failure cleared `gestureId` while the
pointer remained active, so every new input created another begin request. A
production Controller regression reproduces 32 rejected requests from one held
gesture. The corrected version sends one rejection, stops that gesture, and
requires fresh matching context plus new input. It never retries the rejected
value automatically. Older HTTP failures cannot cancel newer edit ownership.

For final Grain sequence 140, the source queue log puts global Roughness 28 and
Size 34 ahead of its begin/update/end sequence (-41, 31, -48, final 10). Those
global commands reached the plug-in around 00:17:44, after the last returned local
completion (Sharpness sequence 135). No later local correction appears in that
SDK log segment; the queue drains after the Develop invalidation. This supports
cancellation before SDK dispatch, but the old SDK log identifies regular commands
only by name. It lacks sequence-tagged dequeue, write and cancellation events.
There is no defensible exact SDK-write timestamp or confirmed native value 10 for
sequence 140. Post-finish recovery remains unknown.

The production-handler replay demonstrates the corresponding loss: admit sequence
140 at 10 behind global Grain commands; change the fingerprint with the same
photo/mask; dequeue. The old queue discards the stale command, and the old state
machine has already cleared its admission, so no cancellation result survives.
This is a reproduction of the mechanism, not proof of the missing historical
fingerprint inputs.

### Scoped correction

- Regular Masking admission retains all existing validation and returns distinct
  additive error codes for stale context, stale selection, unavailable feedback,
  unavailable parameter, pending operation and invalid values. HTTP statuses and
  public request parameters remain compatible. A 409 is no longer universally
  described as an unavailable control.
- The Controller blocks an already-rejected binding and cancels that held gesture.
  A cancelled pointer cannot transfer its value into another photo/mask or newly
  refreshed context. Fresh deliberate input resumes normally. No automatic replay.
- The regular-correction queue coalesces obsolete **undispatched** absolute values
  for the same parameter and full binding, including pending begins whose final
  command already establishes SDK tracking. It appends the latest value in sequence
  order. Reset, cancel, global writes, different contexts and other operations form
  barriers. Already-dispatched commands are not rewritten. A 12-drag alternating
  replay previously retained 24 commands; it now dispatches the three final values.
- Queue rejection publishes bounded `correctionCancellations` (at most 64), with
  original photo/mask/context/sequence/value and `dispatched: false`. These are
  execution receipts, never authoritative SDK values. They survive context
  invalidation. The Controller retains an interrupted adjustment's error and can
  explain cancellation before Lightroom rather than silently clearing it during
  refresh. Unknown execution stays explicitly unconfirmed.
- The 100 ms input cadence, 350 ms step debounce, 450 ms polling and 3000 ms
  confirmation deadline are unchanged. No timeouts were increased, context checks
  bypassed, edits blindly retried, or successes inferred from matching values.
  Native Lua execution, ranges/precision and Reset defaults are unchanged.
- Scope is regular `local_*` scalar corrections. Point Color, masking Tone Curve,
  normal shared sliders and global Grain keep their accepted implementations.
  Source `controller-point-color.js`, `Masking.lua` and `PointColor.lua` hashes
  match the preserved accepted versions.

### Verification and next native check

Focused commands, all simulated/isolated:

```powershell
node tests/masking-context-replay.js
node tests/masking-correction-confirmation.js
node tests/masking-correction-sdk.js
node tests/masking.js --corrections-only
node tests/queue-resilience.js
node tests/polling-trace.js
```

Seven context/queue regressions pass, alongside the eleven previous confirmation
checks. Pre-change logs preserve failures for the rejection storm, obsolete queue
backlog, missing cancellation receipt and misleading error classification.
Production Lua tests cover a terminal command without a separate begin, delayed
readback, actual Reset defaults, photo/mask changes and real SDK failures without
retries. Isolated Chromium verifies stale held-touch suppression and the corrected
observer. The private diagnostic Driver also passes existing global Grain
HTTP/queue/Parser/SDK safeguards. These are not Lightroom acceptance.

Source LRBridge has been restarted with developer diagnostics. A fresh, unstarted
capture is prepared through `local-checkpoints/masking-context-capture-current.txt`.
It uses the existing recorder and starts its nine-minute window only on **Start
trace**. A private diagnostic plug-in copy adds observation of SDK writes/readback,
fingerprint input changes and command-worker identity; production Lua is unchanged.
Exact paths/link are in the current handoff and private readiness file. Load that
diagnostic copy once for the test; the capture refuses to start unless it is the
only recently observed polling worker. The original registered source plug-in has
not been changed automatically.

On one test photo/mask, rapidly alternate Dehaze and local Grain Amount, interleave
some global Size/Roughness movements, then finish local Amount at 10. Test Dehaze
adjustment followed by Reset. Observe actual Lightroom values, wait five seconds
after input/error, then **Finish trace**. No automated edits or Point Color retest.
The new capture includes input/display, local/global HTTP, queue admission,
supersession, dispatch/cancellation, fingerprint changes, SDK writes/readback and
returned results. In particular, interleaved global edits can still legitimately
invalidate an old Develop binding; this work does not claim otherwise. Native
validation and precise attribution of counter changes remain open. No build or
publication; comparison package and all earlier evidence remain preserved.

## September 30 instrumented native recording: global Grain invalidation

The user finished the new capture and reported the cancellation message under
local Grain Amount with a displayed value of 24. The recording covers 59.855
seconds and ends explicitly with **Finish trace**. All 303 recorded command polls
identify the diagnostic worker, whose SDK write/readback events are present.
All 64 captured source hashes still match. A separate hashed archive is identified
by `local-checkpoints/masking-context-recording-current.txt`; its `FINDINGS.md`
contains exact event references and the complete analysis. Prior evidence remains.

This time the source of the counter change is established. Global Grain Size is
set to 55 at +10.835 seconds. At +11.783 the feedback worker observes Size 64→55;
the fingerprint changes and the server advances Develop 4→5 at +11.784. The
selected photo, mask and photo context counter remain unchanged. No other
fingerprint input changes at that heartbeat; profile/curve components are stable.
Local Grain Amount (`local_Grain`) is distinct from global Size (`GrainSize`) and
Roughness (`GrainFrequency`). Roughness contributed to earlier transitions, but
the immediate cause of this cancellation is Size.

| Relative time | Recorded outcome |
| --- | --- |
| +11.734 s | Local Grain -64 admitted as sequence 56 under Develop 4. |
| +11.784 s | Size feedback advances Develop to 5; Masking context is invalidated. |
| +11.800 s | Latest recorded input in this interrupted Grain gesture is 13; no subsequent value request or end is sent. |
| +11.810–11.829 s | Already-dispatched sequence 55 writes and reads back local Grain 24. |
| +11.862 s | Server rejects sequence 55's completion because its Develop binding was invalidated. |
| +11.997 s | Queue cancels sequence 56 before dispatch; no SDK execution exists for it. |
| +12.095–12.204 s | Fresh SDK-derived state reports Grain 24, and the Controller displays the exact cancellation message. |

The Controller first restores 13→79 from its preceding feedback during context
invalidation, then 79→24 from fresh readback. The later pointerup value of 79 is
that restored display, not fresh user input. This is loss of a queued adjustment
and interruption of newer input, not evidence that Lightroom wrote the newest
value and then rolled it back. The message correctly describes sequence 56.
The screenshot's exact timestamp is unknown; its value/message pair is recorded.

Two more cancelled commands follow global Size observations: local Grain -33,
sequence 110 (Develop 7→8, Size 41→78), and local Sharpness -10, sequence 119
(Develop 9→10, Size 55→48). A later Grain update 51 and Sharpness end 72 are
rejected as stale context. There are three HTTP rejections and three queue
cancellations in this run. There is no Dehaze HTTP rejection here and no recorded
nil/unavailable fingerprint-input flap. These are different events from the prior
unconfirmed Grain 10 / sequence 140.

The actual final Grain drag ends at **18**, admitted as sequence 164 at +44.070.
SDK write/readback confirms 18 and the server accepts the result at +44.508.
There is a second demonstrated fault: the next Size change advances Develop
10→11 at +44.824 and clears that accepted completion before the browser's next
state poll at +44.861. The Controller reports an unconfirmed context change at
+44.878 despite the successful execution. Matching value alone would not prove
success; the SDK trace and accepted result do so in this case.

The user subsequently clicks Grain Reset at +48.000. Sequence 166 performs the
SDK reset at +48.297, reads back stable 0 and receives server acceptance at
+48.503. The Controller displays 0 without error by +48.566 and through capture
end. Earlier Grain Reset and both recorded Dehaze Reset commands also have
confirmed SDK results. The final **10** belongs to Dehaze sequence 186, confirmed
at +58.881. Do not claim the originally planned finish-at-Grain-10 or exact
immediate-after-adjustment Reset sequence was completed.

The remaining defect is the coupling of regular local Masking admission and
completion to the whole Develop fingerprint: known LRBridge global Grain writes
advance it asynchronously, causing `syncContext` to erase admissions/completions,
queue rejection to cancel local work, and the Controller to stop its gesture.
The capture also demonstrates lost completion delivery independently of cancelled
execution. A focused correction must preserve real photo/mask/external-edit
checks, final-value and Reset ordering, and accurate confirmation. Removing
counter checks or blindly retrying edits is not an acceptable substitute.

No additional native capture is needed to establish these mechanisms. This
continuation changes documentation/private analysis only and does not mark
regular Masking accepted. Existing automated results remain separate from the
native failures. Accepted Point Color and other accepted controls are unchanged;
release stays blocked. No test reruns, application edits, build or publication.

## Focused correction for known Grain changes (native verification pending)

`MaskingGrain.lua` records only actual, successful, scoped global Grain Size and
Roughness writes in `Driver.lua`. Each receipt contains SDK values before/after
the write and rechecked photo/mask identity. The heartbeat compares its complete
Grain value changes against that chain and separately compares the fingerprint
of all other watched settings, Profile and Tone Curve. An external change before
or after a known write breaks the chain. A photo/mask change, missing value, SDK
failure, overflow or other changed fingerprint component supplies no compatibility
proof. At most 128 outstanding receipts are retained. A fingerprint read spanning
a Grain write is discarded; the normal next heartbeat acquires a consistent one.
There is no added sleep, edit retry or synthesized SDK value.

The normal global Develop counter continues advancing. Optional SDK heartbeat
fields `maskingGrainFromFingerprint` and `maskingGrainMaskId` identify a transition
from the server's exact previous fingerprint on the same photo and mask. The
server exposes `maskingCorrectionDevelopFloor` and the observed mask identity.
An old binding is usable for a regular correction only inside that continuously
proven interval, with the existing photo UUID, photo context, selected mask,
server epoch, revision, availability, pending-operation and admission checks.
Unproven changes reset the interval. Old plug-ins which supply no proof keep the
previous strict behavior. Existing public Set/Reset/Masking HTTP routes and request
arguments are unchanged; new feedback fields are additive.

For that narrow compatible transition, Masking state retains regular admissions
and per-parameter completion records without advancing their captured timestamp.
Actual SDK write/readback remains necessary for success. A queued command keeps
its original identity and is validated at both dequeue and SDK execution; its
later result is checked against that admission and the current compatible context.
Point Color and Tone Curve keep their full Develop binding. Their controller and
SDK edit logic are unchanged; the shared binding helper permits the exception
only for command names beginning `masking.correction.`.

Regular Controller edits use the stable compatible context identity, including
while host context polling and Masking polling arrive in either order. A separate
regular-correction request generation preserves pending admission and held input
through a known Grain change while parent operations keep their existing generation
checks. `controller.html` carries the two new feedback fields to Masking; its
unrelated presentation work is untouched. Genuine changes still cancel the old
held gesture and cannot replay it into another photo or mask. Coalescing and Reset
queue ordering are reused, with no delay/timeout or range/precision changes.

Five pre-change failure logs are preserved privately, including the exact queued
-64/lost-13 mechanism and confirmed-18 completion loss. Seven final production
HTTP/state/queue/Controller regression groups pass:

- Queued local work and subsequent input 13 survive an explained Grain transition.
- Confirmed 18 remains available before the browser's next poll.
- Held input and delayed admission survive either polling order.
- Browser confirmation clears pending state without a false timeout.
- Rapid local/global interleaving retains final values and Reset ordering.
- A revision between adjustment and Reset cannot cause an older write after Reset.
- Missing/mismatched proof and real photo/module/mask changes retain rejection.

Additional focused evidence: the actual Driver, receipt classifier and heartbeat
functions pass simulated rapid chains, Reset, external Grain/other/Profile/Curve
edits, SDK failure, unavailable reads, mixed snapshots, HTTP yield and bounded
history checks. The actual regular Masking Lua handler accepts the proven interval
and rejects an unproven revision/wrong mask; a targeted Point Color command still
rejects the old Develop binding. Existing regular confirmation/context replay,
correction HTTP, Grain navigation/feedback and queue tests pass. Isolated Chromium
exercises real DOM controls with the production host context provider and recorder
observer. The matching diagnostic copy passes the Lua checks. These automated
results are **not physical Lightroom acceptance**.

The source app has been restarted with diagnostics, and a fresh recorder prepared
using the existing infrastructure. Its clock starts only with **Start trace**;
it requires matching source hashes and the intended diagnostic worker exclusively.
The new private plug-in includes the corrected source plus the existing SDK/input/
queue recorder hooks and ownership-classification observations. Previous plug-ins,
captures, private settings and the comparison package are preserved. One manual
plug-in switch/reload is required because the correction includes Lua changes.
The exact app, diagnostic plug-in and recording URL are in the current capture's
private readiness file. No new recording was started during implementation.

Native check: on one test photo/mask, rapidly alternate local Amount and global
Size/Roughness; end Amount at 13 and pause to inspect Lightroom. Then adjust Amount
and immediately Reset; wait three seconds, Finish trace and report errors, jumps,
and Lightroom's actual final Amount. Do not infer a passed sequence from this plan.
Release remains blocked pending that result. No checkpoint, build or publication.

## September 30 native Grain verification — accepted within recorded scope

The user reported no observed errors or jumps during very fast repeated Grain
movements. The recording finished normally after 35.930 seconds, from
2026-09-30 00:10:02.910 to 00:10:38.840 UTC. It has been preserved separately with
matching SHA-256 hashes for browser, proxy, server and SDK evidence. All 69 source
and diagnostic fingerprints match. All 195 recorded command polls came from the
intended diagnostic worker; actual sequence-tagged SDK operations are present.

The trace contains 1,898 input events across local Grain Amount (`local_Grain`),
global Size (`GrainSize`) and global Roughness (`GrainFrequency`). All 29 completed
range gestures delivered their last recorded input to the SDK: nine Amount,
twelve Size and eight Roughness. Coalescing intentionally omits intermediate
positions. Of 79 local protocol admissions, 36 were superseded before dispatch
and 43 dispatched, including gesture begins. All 33 actual local Set writes and
two local Resets produced confirmed SDK readback accepted by the server. Every
gesture-end confirmation, including the final numeric entry, reached the browser.
All 86 global Grain SDK operations have matching ownership receipts with actual
readback: 80 Set calls and six Resets.

Photo, selected mask and photo context remained constant. The full Develop counter
advanced from 1 to 13 while the proven regular-correction compatibility floor
stayed at 1. There were no command cancellations, request rejections, HTTP errors
or rendered error states. All 166 recorded Masking state responses retained the
latest required completion or a later one. Two direct examples exercise the
previously lost-completion mechanism: sequence 47 confirmed before Develop 8→9,
and sequence 51 confirmed before Develop 9→10; both records survived the transition
and reached the browser afterward. Six results with an older but compatible
Develop binding were accepted. Held input continued through such transitions,
and every recorded drag endpoint was submitted and delivered.

Use the actual ending, not the preparation plan. Amount first Reset from 32 to 0;
later a drag ended at -14 and Reset followed 518 ms after release. Sequence 77
executed Reset at +31.259 s, read back 0 and confirmed it. No older local Set was
written afterward. The preceding -14 SDK write had already completed, while its
browser confirmation was still pending at the Reset click. This proves the
recorded order, not a native Reset while the preceding SDK write was still pending.
The user then typed Amount 13: sequence 79 wrote it at +34.343 s, read back 13 at
+34.457 s, was accepted at +34.563 s and appeared with confirmed, cleared status
at +34.721 s. Final values were **Amount 13, Size 25, Roughness 50**, matching SDK
readback and Controller state; Size/Roughness ended at their recorded Reset values.

A separate, small Controller display edge remains documented. At the later
Amount Reset click (+30.923 s), the renderer assigned -28 from parent result 73
over the displayed -14. At +30.932 s, the already-completed result 76 restored
-14. A DOM sample at +30.926 s contains -28 and `Updating…`, without an error.
Thus this is a 9 ms old-value assignment in the Controller; the recording does
not establish that the user saw a painted jump, and the user explicitly saw none.
The SDK had written and confirmed -14 and did not write -28 again. The current
`resetCorrection` clears `desiredValue`, allowing `renderCorrections` to use the
older parent entry during this handoff. Reset subsequently confirmed 0 normally.
Keep this regular Masking display-ownership issue as a focused follow-up, separate
from accepted shared-slider Reset responsiveness and the corrected Grain context
coordination. No implementation was changed during this analysis.

**Acceptance:** rapid local/global Grain coordination is manually accepted for the
recorded run. The previously demonstrated cancellations, interrupted final input
and erased confirmations did not recur. Recorded Reset execution/ordering passed;
the brief Controller handoff above remains open. No repeat of the completed rapid
Grain capture is required. Actual photo/mask changes and conflicting external edits
were not performed in this recording; their existing automated safeguards remain
separate evidence. Accepted Point Color, other accepted controls and the remaining
UI/release checklist are preserved. No new functional tests, live edits, reload,
commit, build or publication were performed. This is not overall release approval.

## September 30 focused regular Reset display correction

The captured -14 → -28 → -14 display handoff is corrected only in the regular
Controller's `resetCorrection`. It reads the current range display before starting
Reset and retains it through the existing `desiredValue` ownership mechanism.
Admission alone cannot replace that display, nor can an older parent snapshot or
the preceding adjustment's completion. The matching confirmed Reset result clears
the hold and renders the SDK value; the code never substitutes an assumed zero.
No authoritative state, SDK handler, public route, queue or delay was changed.

The preceding admitted sequence is also marked handled when Reset takes ownership.
The focused replay found why this matters: if Reset admission fails while the
preceding successful adjustment's result is still arriving, that older result
previously cleared the newer Reset error. This was reproduced automatically; it
was not an additional native failure observed in the recording. Retiring that
preceding completion preserves the real Reset failure instead. A newer confirmed
Reset or later adjustment still has a higher sequence and can settle normally.

The existing ownership lifecycle remains responsible for newer input, cancellation,
failure and context changes. New edits replace the held value and supersede old
Reset admission/results. Real photo/mask/unproven Develop changes or unavailability
release it. A missing Reset result still fails at the existing three-second
deadline; a late genuine confirmation can recover. Holding a display is neither
confirmation nor an instruction to write that held value to Lightroom.

Focused verification, with no live Lightroom edits:

- `tests/masking-reset-display.js`: the production Controller/state-machine replay
  fails before the change on the exact stale -28 assignment and the late preceding
  completion clearing a Reset admission failure. All ten cases pass afterward:
  the captured delayed handoff, nonzero confirmed Reset, newer input during delayed
  admission, SDK failure, admission failure, unchanged timeout/late recovery,
  mask/photo/external-Develop changes and unavailable controls. The captured case
  also checks compatible Grain feedback and the unchanged request order.
- `tests/masking-reset-display-browser.js`: actual regular Masking renderer and
  production CSS in isolated Chromium fail before the fix at the Reset click.
  Afterward, 187 animation-frame samples retain -14 through delayed admission,
  the preceding confirmation and a scalar read without Reset confirmation. DOM
  setter observation detects no stale assignment between frames. Matching Reset
  confirmation displays 37, demonstrating that the result is not assumed zero;
  later input remains in control over older Reset feedback. Desktop and 390 px
  images were inspected. These values are simulated fixture results, not claims
  about Lightroom's native Grain default.
- The eleven existing `tests/masking-correction-confirmation.js` cases pass.
  Completed queue/SDK/Grain and Point Color checks were reused, not broadly rerun.
  Their implementations are unchanged. The recorded rapid Grain acceptance and
  all original recordings are preserved.

The running source HTTP Controller returns the changed file byte-for-byte with
`Cache-Control: no-store`. A refresh of the normal source Controller tab loads it;
there is no server change requiring restart and no Lua change requiring reload.
The current diagnostic plug-in remains suitable. No new recording is needed to
establish this display correction. This is automated/rendered verification;
ordinary user UI acceptance remains required before checkpointing the new change.

Preserve the existing unfinished Dust/VM installation checks, Lens Blur timing,
Color Grading and presentation review, the separate masked Point Color pending-click
usability issue, Parametric preview limitation and package/integration gates.
No commit, package build or publication was performed for this correction.

## Latest native acceptance and local checkpoint scope

The user manually accepts the latest regular Masking slider and Reset behavior
within the tested scope: no observed jumps or errors, responsive adjustments and
acceptable Reset delay. This includes the source correction for the short Reset
display handoff. Preserve the independently recorded rapid Grain acceptance and
masked Point Color fixes/results. No further timing tuning or completed capture
replay is requested.

The scoped local checkpoint includes the accepted coordination, confirmation,
context safeguards and display ownership changes with their regression coverage
and this documentation. Reuse completed checks; selective staging may require a
small integration check of the exact staged subset. Unrelated changes and the
new small UI requests remain outside this checkpoint until reviewed. Native
acceptance stays limited to the user's tested behavior; genuine photo/mask and
external-change negative cases retain their separate automated evidence.
