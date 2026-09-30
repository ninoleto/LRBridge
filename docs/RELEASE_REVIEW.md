> Historical release status (September 28): the captured SDR Brightness rollback
> has a demonstrated confirmation-error cause and an isolated correction with
> fail-old/pass-new regressions. User observed no jumps in one corrected-source run;
> The user accepts the current Reset responsiveness for the tested controls.
> This remains bounded evidence, not final release approval. Repository evidence,
> measurements and slider inventory: `docs/SHARED_SLIDER_COORDINATION.md`.
> Slider/Reset checkpoint: `246d11b`. The separate worker lifecycle correction now
> passes focused automated checks and the completed native Disable/Enable/Reload
> sequence after the user's Lightroom restart, now explicitly accepted for that sequence.
> A scoped lifecycle commit, integration and fresh private package are authorized.
> Remaining package gates stay open; preserve the older candidate. No publication.

# Windows v0.6 beta completion review

## October 1 reviewed source checkpoint and private test package

Parametric Curve is manually accepted for this release, including changed split
positions. Six newly supplied native graphs and nine prior references support
the correction, with the documented approximation limits retained. No additional
curve tuning or capture is required unless a new problem appears. Accepted shared
slider/Reset, Masking/rapid Grain, Point Color, plug-in lifecycle, Denoise, Dust
controls and Color Grading results stay accepted within their recorded scope.

The amber Masking recovery notice now explicitly directs the user to click
**Close Masking** in this Web Controller, then the same button when it shows
**Open Masking**. Its placement/style and all command behavior are unchanged;
the exact note was checked at desktop and narrow widths.

Lens Blur Visualize Depth remains a **known slow operation** for this private
build. The latest manual observation does not distinguish execution delay from
feedback delay; do not mark performance passed or infer that earlier focused
read changes resolved it. No new optimization is part of this packaging step.

Dust clean-install and legacy-preset migration checks are explicitly deferred to
the fresh package. Preserve the existing VM/package comparison baseline and
accepted current Dust control behavior. Remaining package checks are desktop
startup/restart/settings preservation, Companion/PowerShell commands, phone/tablet
LAN, and clean Dust setup plus legacy migration without duplicate presets. Isolated
installer and packaged-runtime tests do not replace those manual checks. This is
a private test build, not a public release. Constrain Crop feedback work remains
deferred.

## September 28 accepted fixes integrated for private packaging

The feature branch now contains slider/Reset checkpoint `246d11b` and lifecycle
checkpoint `95e3592`, retaining their original history. Production Controller,
bridge and plug-in implementations match the tested isolated worktree; line-ending
differences do not change content. The HTTP inventory is regenerated solely to update
157 source-line references after the bridge edit. All 206 routes and their categories
are unchanged. No slider tuning or additional feature work is included.

Reuse the completed feature checks, bounded native acceptances and 35 cooperative
lifecycle scenarios. Required staging/cleanup and package-integrity checks remain
separate from physical package acceptance. The fresh private package must still pass
desktop startup/restart/settings, Companion/PowerShell, phone/tablet LAN and clean
Dust setup in a later session. Existing limitations and Constrain Crop deferral remain.
The source app, active diagnostic plug-in and previous packages are preserved tonight;
do not start the new package against Lightroom or publish it.

## September 28 native lifecycle sequence passed

The user restarted Lightroom before completing the requested sequence. Logs verify
one command and one feedback supervisor at startup and after each reload/Enable;
both old supervisors stop before replacements. Disable leaves a seven-second gap
without polling records before Enable. No duplicate starts, same-type overlap or
lifecycle failure appears in the window. Older source/package plug-in logs remain
unchanged; final SDK feedback is fresh and the queue empty. The exact diagnostic
modules and served assets match the tested implementation; evidence is preserved.

This passes the exercised native startup, initial reload, Disable, Enable and final
reload sequence. Native rapid toggles, in-flight actions, fault injection and shutdown
cancellation were not tested; reuse existing automated coverage separately. No slider
tests were repeated or code retuned. Slider/Reset checkpoint remains `246d11b`;
the lifecycle result is now explicitly accepted for this sequence. A scoped lifecycle
commit, integration and fresh private package are authorized. No push, publication or
final release approval. Existing package gates and documented limitations remain intact.

The preparation entries below are historical. Their pending lifecycle instructions
are superseded by the accepted result above; do not repeat that native sequence.

## September 28 polling lifecycle correction prepared

The accepted slider/Reset scope is checkpointed locally as `246d11b` (21 files).
Private settings, unrelated work, recordings, stash and old candidate are preserved.
Completed slider checks were reused. A separate uncommitted lifecycle fix registers
the missing Disable/Enable hooks and handles re-enabling while stopped workers drain.
Disabled forced initialization, generation ownership and late responses are guarded;
SDK operations already in flight are not killed or retried. Slider tuning is unchanged.

Two old-code regressions demonstrate the missing Disable registration and lost quick
Enable. Final production Lua passes 35 cooperative SDK scenarios, including a fresh
reload environment, plus public polling compatibility and Adobe Lua syntax checks
for all 40 prepared diagnostic modules. These checks do not establish native behavior.
The same diagnostic plug-in is prepared for one load reload, Disable/Enable, then a
reload of the corrected code. Current source app stays running. Details and acceptance
criteria are in the repository's `docs/POLLING_LIFECYCLE.md`.

Native lifecycle validation and existing package gates remain open. No rebuild,
publication or additional feature acceptance is inferred.

## September 28 checkpoint acceptance

The user accepts current Reset responsiveness for the tested controls. Preserve the
shared slider and Reset fixes, focused tests and native recordings in a scoped local
checkpoint. Reuse completed checks. Private settings, unrelated edits, diagnostic
recordings and stash contents remain local and intact. Investigate the old polling
worker lifecycle separately, without retuning accepted sliders. No rebuild or publish.

## September 28 focused Reset follow-up result

Preserved the 16.546-second capture and the user's report **"This feels noticeably
more responsive."** Four Reset results were verified against SDK execution/readback
and Controller display: Whites 273 ms, Clarity 492 ms, Highlights 233 ms, Shadows
343 ms from release to confirmed display. Median total improved from 477 to 308 ms;
median post-SDK confirmation from 348 to 158 ms. The rapid three-control Reset group
improved from 1.11–1.48 seconds to 233–492 ms at similar tap spacing. Sample sizes
and pacing differ; no universal timing guarantee is claimed.

All four displayed zeros came from actual post-Reset SDK feedback; recorded SDK
state stayed zero afterward and no older writes followed Reset before newer input.
No command failure or target read begun inside Reset preparation was recorded.
The expected pre-command unchanged-value retry occurred once and settled correctly.
No implementation change, suite rerun or repeated native Contrast test was needed.

A separate question about backward jumps in this latest run is pending. Do not
infer that observation from the responsiveness report. No final release approval,
checkpoint, build or publication; remaining package gates, accepted limitations and
the separate disabled-plug-in worker defect keep their existing status.

## September 28 corrected-source retest and Reset follow-up

Record **no jumps observed in this run**, without extending acceptance beyond it.
Reset executed but remained noticeably slower than normal Point Color Reset.
The preserved capture has 51 Resets, 48 usable visual transitions. Median total
release-to-display improved from 969 to 477 ms; request dispatch stayed about 1 ms,
and request-to-SDK about 145 ms. SDK-return-to-display improved from 796 to 348 ms,
but the worst current case still took 2514 ms overall. These are instrumented,
differently paced samples, not a controlled benchmark.

The remaining demonstrated delays were a feedback read during Reset preparation
after a missing command-busy recheck, and one ready confirmation per full background
poll cycle. The shared Lua guard now rechecks after yielding; bounded confirmation
draining uses an optional bridge hint and preserves background fairness. No assumed
Reset value is displayed. Dragging, commands, public HTTP compatibility and context
validation remain unchanged. Point Color's immediate known-target display and direct
SDK state publication explain its different path; its code is untouched.

Both captured Lua cases fail on old source and pass on the correction, with focused
browser/queue/context/lifecycle checks passing. Restart the isolated source app and
reload the same diagnostic plug-in once before the next focused physical Reset check.
No new native timing result, checkpoint, package or release approval is claimed.
Completed native Contrast results, previous acceptances, remaining package gates,
Constrain Crop deferral and the separate disabled-worker defect remain intact.

The initial correction record below precedes this Reset follow-up.

## September 28 SDR touchscreen failure and isolated correction

The fresh capture has one diagnostic worker and complete browser/proxy/SDK evidence.
Latest Brightness input -49 reached Lightroom and remained -49 in SDK reads. A
confirmation snapshot expired on a Develop revision before the browser refreshed its
context; the old catch handler displayed cached 0 for about 700 ms. This captured jump
was a Controller rollback. It was not caused by an older SDK write overtaking -49.

Across 12 Resets, release-to-request was 0–1 ms, request-to-SDK 81–290 ms and
SDK-return-to-visible 145–1186 ms. Feedback scheduling dominated the delay; an obsolete
Set confirmation delayed Reset by an SDK read opportunity. These instrumented baseline
times do not establish the corrected source's physical responsiveness.

Shared Set/Reset confirmation now uses owned, cancellable, dispatch-context-checked
reads. Verified revision invalidation renews feedback; genuine failures remain visible
without restoring cached values or resending edits. The server prioritizes compatible
confirmation reads, shares undispatched work, and preserves background fairness.
Existing public HTTP routes, write ordering, SDK code/ranges, touch Reset and all
previously accepted presentation/feature behavior remain unchanged.

Captured VM and actual Controller DOM regressions fail on old source and pass on the
correction. Focused rapid/alternating sliders, immediate/delayed Reset, context guards,
errors/unavailability, external edits, proxy, queue and Companion HTTP compatibility
checks pass in isolation. Native acceptance remains pending; no simulated timing is
reported as Lightroom performance.

The preserved main Contrast HTTP observations remain Set20 stable, Adjust3→35 stable,
Set65→Reset final0 (65 not visually seen). Do not repeat them. Highlight Saturation
working in this one touchscreen run does not universally resolve the original report.
The disabled-plug-in worker lifecycle defect is separate and remains tracked.

Next: quit the old candidate before starting the isolated source app, verify app/assets
and the single diagnostic worker, then record rapid Brightness/alternating SDR drags and
immediate Reset. No Lua changed; no reload is required. Keep release blocked until the
focused native result is assessed. Broader package checks below remain outstanding.

## September 27 new release blocker — SDR quick adjustments

> Historical investigation note preserved during integration. Its pending-test
> instructions are superseded by the accepted September 28 results above.

The user reports backward jumps in **Highlight Saturation** (`SDRBlend`) and the other
six SDR Rendition controls during quick adjustments. The running executable and served
Controller assets are verified as private candidate `20260927T174904Z`, from `7bd6db9`;
the bundled plug-in's 40 Lua modules match that candidate. Both source and packaged
plug-in copies show fresh, distinct command/feedback activity. A single bridge process
does not imply a single Lightroom plug-in command consumer.

All seven SDR controls use the corrected shared Develop-slider implementation and direct
integer values. Focused isolated browser coverage of repeated drags, alternating SDR
controls, delayed feedback, legitimate later Lightroom changes, rejection handling and
Reset after adjustment passes on the unchanged runtime. Existing shared-feedback and HDR
contracts pass too. The ordinary FIFO/SDK loop serializes within each plug-in instance;
two copies can overlap. Logs establish the duplicate consumers but do not prove actual
SDK write order or the complete cause of the reported jumps.

Keep the blocker open. Leave only the packaged plug-in enabled and perform one short
native sequence: two quick Highlight Saturation drags, alternate with SDR Highlights,
then Reset immediately after a drag. If it persists, isolate command/feedback ordering
with the existing diagnostics under that single plug-in. No speculative runtime fix or
rebuild has been made. Rebuild waits for native acceptance; the previous package and
all unrelated work are preserved. Earlier acceptance remains limited to its tested scope.

## September 27 scoped checkpoint and fresh private candidate

- The user reports **Copy/Paste and Export work in the cases tested, with no problems
  observed**. This does not enumerate additional photo counts, output-file checks,
  selection edge cases or AI/mask-preservation scenarios. Earlier specific evidence
  and all SDK limitations remain; the blanket Copy/Paste pending status is superseded.
- **Denoise, Raw Details and Super Resolution are accepted for the tested behavior.**
  Denoise's disabled controls, grey appearance and alignment with standard sliders
  are accepted, and **Denoise Reset is included in this release**. Reset requests
  Amount 50 without toggling Enhance and retains authoritative display until feedback.
  Amount availability uses confirmed On state and existing pending guards; On at 50
  remains adjustable even though Reset is disabled. The checkbox stays independent.
- Copy/Paste keeps its two buttons and three approved help paragraphs with bold labels
  and shortcut. Count/technical Details UI is removed; useful feedback and required
  review remain. Batch and AI results retain their uncertainty limits. Successful
  paste-result messages use italic `#c9a227`; existing error styling is preserved.
- Completed focused clipboard, Denoise model/Reset/availability (including Amount 50),
  Off/On appearance, desktop/narrow alignment and Point Color checks are reused.
  No repeated accepted native/slider suite or new recorder is required.
- The user authorizes the scoped local checkpoint and a fresh private Windows package,
  built from an isolated checkpoint export with public defaults and matching runtime
  resources. Private settings, unrelated edits, research, stash and diagnostic evidence
  stay outside the release. Preserve the old `20260925T022735Z` package. No push or publication.
- Remaining manual package acceptance: startup/restart and settings/favorites preservation;
  Companion/PowerShell commands; phone/tablet LAN use; clean Dust setup and discovery.
  Isolated package tests do not establish these real-use results in advance.

Earlier sections below are historical evidence. Their pending/exclusion/no-build notes
are superseded only by the explicit acceptance and authorized scope above.

Checkpoint preparation passed the existing release staging/route/reference/defaults,
isolated Dust installer, cleanup/diagnostic exclusion, Lua syntax and staged startup
gates. The focused favorites presentation and Enhance contract checks also passed;
obsolete tooltip/custom-grid fixture expectations were reconciled without runtime
changes. Completed feature checks remain applicable; the broad suite and accepted
native scenarios were not rerun. Fresh extracted-package checks follow the build.

## September 27 latest source acceptance and limited note cleanup

The user reports the following physical touchscreen results on the updated source:

| Area | Latest manual result |
| --- | --- |
| AUTO and B&W | Passed. |
| Lens Blur bokeh shapes | Passed. |
| Guided Upright | Passed. |
| Color Mixer / Effects | No problems observed in this session. |
| Copy / Paste Settings | Later accepted for the user's tested cases; see the latest report above. |
| Tone Curve order | Highlights → Lights → Darks → Shadows passed. |
| Detail / Effects layout | Acceptable for this release. |
| HDR / Crop | Existing functionality accepted; missing features deferred. |
| Lens Blur | Accepted for this release with experimental limitations. |

These results supplement the accepted Profile, main-slider, Reset and Point Color
work. They do not claim universal resolution of intermittent jumping or acceptance
of untested cases. Do not repeat these checks for this presentation-only cleanup.

Constrain Crop works in both directions; the user observes approximately two seconds
before a change made directly in Lightroom appears in the Controller. Inspection
found scheduling/cached-state dependencies before rendering: the 500 ms browser poll
permits one categorical request at a time; the server queues a separate SDK refresh
with requests rate-limited to 400 ms apart; the plug-in services it in its sequential feedback loop. The
shared categorical/Profile response can await a Profile read, and it returns the
current cached categorical snapshot rather than awaiting that particular SDK request.
The production-handler probe demonstrates both returning the old snapshot before
SDK arrival and holding fresh categorical feedback behind Profile. Rendering applies
an accepted revision immediately. The exact contribution of each stage to the user's
two-second observation was not measured live. There is no evidence here of an Adobe
limitation. A change would need to separate shared refresh/response responsibilities;
defer it, keeping accepted confirmation/context protections and polling unchanged.

Red Eye and Masking limitation notes now bold their actual control names. Selected
Add/Subtract's existing experimental notice reuses the Focus Range amber background
and border; its wording, placement and buttons are unchanged. Syntax and existing
Constrain Crop synchronization checks pass, as does the bounded handler probe.
Isolated source-page Chromium checks at 1280/390/320px verify unchanged text, nine
bold names, matching notice treatment and no note overflow or write commands.
These are mock/rendering checks, not additional native acceptance. Refresh only the
source Controller; no plug-in reload or application restart is required for this cleanup.
Changes remain uncommitted on `4c5f863`; no candidate was built, pushed or published.

## September 27 accepted follow-up checkpoint — diagnostic cleanup complete

The user accepts the tested Profile, feedback, responsiveness and touchscreen Reset
fixes. This scoped local checkpoint follows `9ce462f`; it removes temporary capture
loading, marks and observer hooks from six Lua files and preserves all functional
fixes and normal diagnostics. A comparison with the verified accepted-state recovery
backup found no other Lua changes and a byte-identical working Controller. The
finished recorder helper was identity-verified and stopped; Lightroom and the source
LRBridge application stayed running. Raw captures, source copies and capture hashes
remain preserved outside release assets.

The checkpoint excludes the same pre-existing Denoise Reset Controller hunks as
`9ce462f`, along with the Denoise module/tests, private settings and unrelated work.
The working folder still contains them. Do not mistake this checkpoint for acceptance
of Denoise Reset or copy the dirty working folder directly into a release package.

That checkpoint required one source plug-in reload to unload old Lua hooks, using
`D:\Projects\LRBridge\lightroom\LRBridge.lrplugin`, and the normal source Controller
at `http://127.0.0.1:17892/`. The user subsequently tested the cleaned-up source.
The current note cleanup needs only a browser refresh, as stated above.

Only syntax and focused Profile, preparation, polling, Reset/feedback/order checks
were run for cleanup; previous physical and desktop/narrow presentation evidence is
reused. Those automated checks do not extend the live coverage below. Packaging,
push and publication were not performed. The old private build `20260925T022735Z`
remains unchanged. Remaining acceptance and candidate verification are listed under
[Remaining acceptance and limitations](#remaining-acceptance-and-limitations).

### Accepted physical touchscreen session

The user accepted the completed physical session as the most responsive so far,
with none of the previous problems noticed. The 00:08 recording contains all
8,394 browser events. Eight deliberate Reset taps (two individual, then six in quick
succession) each reached the callback, HTTP endpoint and Lightroom exactly once.
Every command succeeded and actual SDK feedback confirmed zero. There were no lost
or duplicate activations, feedback error callbacks or recorded temporary disabling.
Two Exposure taps again had no native click, but the new touch path dispatched both;
six native compatibility clicks were consumed without repeating a command.

Times below run from finger release to confirmed Controller value, not optimistic
display or simulated timing:

| Reset in recorded order | Confirmation |
| --- | ---: |
| Contrast, individual | 291 ms |
| Exposure, individual | 718 ms |
| Exposure, rapid group | 539 ms |
| Contrast, rapid group | 228 ms |
| Highlights | 471 ms |
| Shadows | 477 ms |
| Whites | 495 ms |
| Blacks | 534 ms |

Callbacks took 0–1 ms; HTTP submission 0–3 ms; Lightroom command return 100–189 ms;
SDK-result receipt 223–713 ms; browser application followed within 3–5 ms. Median
confirmed display time was 486 ms. Two recorded scroll gestures sent no Reset.
They began on the panel/Contrast label, so scrolling *from* a Reset button remains
verified only by the automated cancellation checks. The recorded post-drag Resets
followed range release by 483/750 ms, with no unsent write remaining; overtaking an
unsent same-slider drag is also automated-only coverage. These bounds do not justify
another speculative change or a claim of universal resolution of intermittent jumping.

Preserve the accepted source, including Profile, feedback correction, conditional
preparation and Denoise work. Controller SHA-256 is
`95fdfb5a0586a14e76a7603b4f5732f4ce4e0839446ef157818e827c26046098`.
The earlier acceptance-only step preserved this source and raw recording without
rerunning tests. The subsequently authorized cleanup/checkpoint is described above.

### Correction and preceding evidence

The following chronology records earlier findings and checks; earlier pending-capture
or reload instructions are superseded by the accepted checkpoint state above.

September 27 Reset follow-up: the user confirms the missed taps in the recordings
and reports that sliders now feel OK, with no observed backward jumps in the latest
tests. This is not a claim that intermittent jumping is universally resolved.
Four enabled touch down/up pairs across three saved captures had no browser click,
Reset callback or HTTP command; the preceding range interactions had already ended.

Shared slider Reset buttons now use a completed primary-touch tap to invoke their
existing callback, including compound Reset. Movement beyond finger-jitter tolerance,
scrolling, pointer cancellation/lost capture, another pointer, context-menu, disabled
or detached buttons and photo/context navigation cancel the tap. Later touch-origin
compatibility clicks are consumed without blocking ordinary mouse/keyboard clicks.
The previous edit may advance Develop revision during a tap; queued Reset ownership
already permits that, and authoritative feedback checks still bind to the submission
revision. The normal Reset queue cancels older unsent drag values and orders Reset
after admitted writes. Range handling, feedback correction, Profile, conditional
preparation wait and Denoise are unchanged.

The four captured missed taps (repository fixture
`tests/fixtures/reset-touch-missed-click-20260926.json`)
fail before/pass after in the focused isolated-browser test. Four fast buttons,
cancellation/navigation, mouse/keyboard click paths, legacy compatibility clicks,
compound Reset and held drag → Reset → late change/click checks pass, with exact
callback/HTTP counts. Those are synthetic event/SDK-double regressions; the subsequent
physical acceptance and exact coverage limits are recorded above. The working state
now stays unchanged, with no further reload, recording or broad test cycle requested.

Source remains based on `9ce462f`, with this follow-up uncommitted. The previous
request-ID slider fix was insufficient. Current changes add per-edit confirmation
ownership, preserve pending state across unchanged numeric commits, and serialize
Reset with earlier admitted writes while cancelling older unsent drag values.
Regressions cover later polls with pre-edit values, obsolete timeout results,
rapid Basic/Green/Aqua/Effects edits, drag → Reset → new edit, rejected commands,
photo changes, compound Reset and Profile Amount capability checks.

The complete live capture now identifies operation 2, Adobe Color → Adobe Vivid,
failing on `Shadows` missing → `5`. The prior Contrast exception qualified.
All 167 existing non-Look fields remained identical, including all resolved active
Auto adjustments. Lightroom added four inactive legacy defaults: Brightness 50,
Contrast 25, Exposure 0 and Shadows 5. The remaining differences were the requested
Vivid Look. The 18.3/18.4 compatibility handling was present and was not the failure.
Profile validation now accepts only those exact absent-to-default additions on
process `15.4`, with all six modern tone values resolved and unchanged. Other
settings, complete Look identity, context, one-write behavior and five stable
readbacks stay checked. The complete captured SDK pair (repository fixture
`tests/fixtures/profile-reset-auto-vivid-20260926.json`)
reproduces the old failure and passes the correction; 55 production-Lua scenarios
and focused Profile HTTP contracts pass. The subsequent **live Profile-only check
passed**: operation 3 completed Reset All → Auto → Adobe Vivid with five identical
SDK readbacks, the same four legacy additions and unchanged active adjustments.
The Controller received validation generation 3, failed generation 0, and available
Adobe Vivid feedback. No further Profile repetition or plug-in reload is needed
for the remaining slider capture.

**Contrast jumping: not reproduced in this capture; remains unresolved.** Three
SDK writes in the subsequent slider-only capture applied in order: -94 → 9 → 91.
The browser retained requested 91 as pending through intermediate SDK feedback 9,
then confirmed 91. All 1,334 browser events were retained through Finish. Individual
Contrast Reset took approximately 100 ms to Lua dispatch, 365 ms to SDK reset,
474 ms to first SDK value 0 and 479 ms to browser application. About 264 ms was in
the existing plug-in preparation step, which includes fixed 200+50 ms waits. This
is live timing, not a simulated result or acceptance of perceived responsiveness.

One obsolete snapshot returned HTTP 404 after the Develop revision changed; the
browser discarded it without a visible error or temporary disabling. Reset followed
completed drag confirmation, so a queued drag followed immediately by Reset is not
yet verified live. The wheel
description was incorrect: the user operates the Controller entirely by touch on a
24-inch touchscreen, with the mouse confined to another monitor. The recorded
drags were touch input; “scrolling” meant touch scrolling, with no Controller mouse
or keyboard use. Both Contrast drags reached pointerup normally, but the earlier
recorder omitted pointer type, pointercancel, lostpointercapture and scroll events.
These missing paths are investigation targets, not established causes. The next
bounded native capture targets quick neighbouring-slider edits, touch scrolling
and tapping Reset using the existing recorder with expanded passive event logging.
The measured Reset preparation delay remains a separate finding. No speculative
main-slider correction or synthetic substitute for live touchscreen use was made.
Temporary capture hooks must be removed before release, after affected native checks.

The subsequent 23:04 touchscreen capture retained all 7,954 events. Four Green/Aqua
drags reached pointerup normally; eleven cancellations occurred during scrolling
on labels/backgrounds, with none on a range drag. Intermediate SDK feedback did
not replace pending values, and Green/Aqua stayed enabled. Jumping remains **not
reproduced in this capture; unresolved**. No Effects edit was recorded.

It did prove a feedback classification race: the server discarded snapshots 17733
and 17759 after Develop revisions changed, before the browser's context poll caught
up. This briefly labelled two already-unavailable Lens Correction controls as
Feedback error; it did not disable Green/Aqua. The focused browser correction
verifies fresh context and replaces only a demonstrably obsolete read. Unchanged
context, failed context verification and genuine transport failures still report
errors. No gesture handling, requested/confirmed value rules, SDK writes or polling
delays changed. Both captured failures fail the old source and pass the correction;
focused intent/ordering and isolated browser Reset checks pass. The corrected-source
23:24 live touchscreen retest **passed this obsolete-feedback race**: fresh context
reads and replacement snapshots handled repeated revision changes without visible
Feedback error labels or enabled-to-disabled transitions. All 6,495 browser events
were retained. Nineteen Green/Aqua H/S/L drags submitted/applied in order, with no
backward display jump. Jumping remains **not reproduced in this capture; unresolved**.
Four pointer cancellations were on labels during scrolling, none on range drags.

The first Green Reset touch produced pointerup but no click or command despite
remaining enabled; its cause remains unproven. Later successful Aqua and Green
Reset taps reached browser confirmation in approximately 642 ms and 391 ms. These are
live measurements, separate from the unchanged preparation delay; neither Reset
overlapped an older queued write. The corrected-source capture again contains a
first Reset touch with no click/command, despite no movement, cancellation, default
prevention or disabled button. The browser's reason for omitting click remains
unproven. The subsequent focused activation correction above no longer relies on
that click to deliver a completed touch tap.

The five successful rapid Resets in that capture confirmed in 979–1,177 ms. HTTP
dispatch took 0–1 ms, Lua entry followed after 118–478 ms, and each command spent
264–272 ms in the plug-in before returning. SDK results arrived another 347–613 ms
later; browser application followed within 5–13 ms. No later drag overwrote Reset;
an unsent same-slider drag overtaken by Reset remains unverified live. Effects was
not exercised. These timings are native observations, not test-clock simulation.

A separate small preparation correction skips the existing 200 ms module-transition
wait only when SDK already reports Develop active. It retains the SDK module/wake
request, 50 ms panel preparation, the wait for real module transitions and the
special Masking path. The recorded 24-command sequence (repository fixture
`tests/fixtures/touch-slider-preparation-20260926.json`)
fails before/passes after in production-Lua replay with SDK doubles; existing Grain
HTTP/queue/SDK navigation guards pass. An old Grain fixture needed stubs for newer,
unrelated command modules; production features were unchanged. The next native
capture verified the updated Driver load: Contrast Reset entered Lua 77 ms after
click, reached SDK reset at 140 ms, received SDK feedback at 329 ms and applied it
in the browser at 334 ms. Preparation took about 63 ms in this operation; overall
Reset responsiveness is not declared resolved. Two other taps in that capture
still lacked clicks/commands, motivating the activation correction above. No
further plug-in/application restart is required. No package or Profile repetition.

The repaired browser recorder retained 1,339 events through Finish in the
Profile-only retest. One background snapshot HTTP 404 was logged after Reset All;
it was not a Profile validation failure or a reproduced touch feedback/disable case.

Upright Close is red with white text; Open/Close actions are unchanged. Lens Blur
uses the requested short, separate Experimental notes, with **+ New Refinement**
bold beneath Open Brush Refinement and the SDK detail retained in Help. Browser
checks at 1280/390/320px pass. Focused Lua/transport/browser checks pass, including
existing Adobe Vivid startup without automatic writes. Earlier slider Reset timings
remain simulated, not claimed as live Lightroom performance. Denoise Reset,
Masking Point Color and Color Grading remain preserved. HDR preset support stays
unverified. No package was rebuilt or published; the old private ZIP is unchanged.

## September 26 private-package feedback fixes — source retest pending

The user completed manual testing of private build `20260925T022735Z` and reported
the issues addressed below. That ZIP is unchanged and contains none of this batch.
Target: affected-behavior retest, fresh packaging/verification and publication by
September 30. Publication and rebuilding remain subsequent steps after retest.

- B&W treatment-read errors now identify B&W beside its control. Background B&W
  reads no longer overwrite AUTO's status; genuine command errors retain their
  existing reporting. AUTO execution is unchanged.
- Shared sliders now advance their feedback request floor for both panel and
  targeted snapshots. A reproducible mock race previously displayed an old zero
  or earlier value after a newer SDK value had confirmed the edit. The same test
  passes after the fix, with unchanged submitted values and no extra writes.
  Point Color's per-edit ordering informed this correction; Color Grading and
  Masking Point Color are unchanged. This establishes a display race, not proof
  that every reported native occurrence had the same cause.
- Bokeh reads SDK state immediately after its SDK action and uses a bounded
  SDK-only confirmation path independent of the Windows helper. Requested values
  never become active merely because HTTP accepted them. Older full feedback is
  rejected after newer bokeh feedback; photo/context/Develop guards remain.
- Upright Open/Close uses `selectTool("upright"|"loupe")` with tool readback. Close
  does not write correction values or reset transforms/crop.
- Tone Curve is Highlights → Lights → Darks → Shadows (split controls unchanged).
  Detail has Enhancement, Sharpening and Manual Noise Reduction divisions, with
  Luminance/Color groups; Effects has Post-Crop Vignetting and Grain divisions.
  Visualize HDR is bold. Copy/Paste, Lens Blur, Red Eye, Masking and Selected
  Add/Subtract guidance is corrected in the Controller and Help.
- Selected Add/Subtract remain **Experimental Windows automation**, with no active
  mode readback. The user observed that they stopped responding until Spot Removal
  was reset. Cause remains undiagnosed; broad automation changes are out of scope.
  Use Lightroom's Add/Subtract if needed. Reset Spot Removal is not a recommended
  workaround because it can clear corrections.

Focused evidence: `release-feedback-fixes` reproduces the slider race on the
saved pre-edit source and passes on the correction; it covers rapid Green/Aqua
and Effects edits, delayed/reordered responses, unknown feedback, exact writes,
and photo/Develop ownership. It also verifies bokeh pending/confirmed presentation
and rejection of stale photo/full-poll results. `release-sdk-fixes` executes the
production Lua with mocked SDK calls and exercises actual HTTP routes, including
Upright correction preservation and bypass of the native helper. These are not
live Lightroom acceptance. Controller and Help render checks pass at desktop and
390/320 CSS-pixel widths; no physical phone test is claimed.

Adjacent focused gates passed for generic sliders, categorical controls, command
tabs, Lens Blur, HDR, Constrain Crop, section collapse, Lua selection/command
dispatch, Masking inversion, Red Eye, clipboard and Reset queue/delivery. Existing
isolated Denoise Reset, Copy/Paste and Reset-feedback browser gates passed; the
Denoise candidate remains unchanged and outside this checkpoint. Generated HTTP
inventory still has 206 routes. The full release suite and package build were not
rerun in this pass.

### Bounded additions investigation

Installed reference: Lightroom Classic SDK 15.3; tested application baseline:
Windows Lightroom Classic 15.4.1. No new presets, dependencies, automation or
keyboard injection were added.

| Candidate | Evidence and release decision |
|---|---|
| Visualize HDR | No matching getter/setter/action in the installed Develop controller catalog. No minimal exported On/Off presets were available in the inspected project resources or installed CameraRaw Settings. Independent preset application and preservation could not be established; deferred. |
| Preview for SDR Display | [Adobe's HDR documentation](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/hdr-output.html) describes HDR/SDR copy, preset and sync support, but supplies no isolated checkbox key or guarantee that it can be applied without HDR/rendition changes. The installed reference has no matching checkbox operation. Existing SDR rendition sliders are separate. No minimal exports or live isolated-preset verification; deferred. |
| Constrain to Image | The [developer-published example](https://community.adobe.com/feature-requests-676/p-shortcut-key-for-constrain-crop-666054) explicitly identifies the Crop and Transform checkboxes as the same `CropConstrainToWarp` setting. LRBridge already reads/writes it in `DevelopCategorical.lua` for Transform/Lens Manual; it is absent from the installed 15.3 parameter list. The earlier assertion that they are distinct is superseded. No preset dependency is warranted. Keep the working existing control; a Crop presentation is deferred until native checkbox equivalence and crop/mask preservation are verified on 15.4.1. |
| Crop Tool Overlay | `getRemovePanelPreferences`/`setRemovePanelPreferences` document Remove `toolOverlay` only. No Crop-overlay API or minimal isolated preset established; deferred. |
| Auto Straighten | The installed catalog exposes `straightenAngle`, but no verified Auto Straighten calculation/action. Replaying an angle or selecting Upright Level is not equivalent; deferred. |

Future preset work must begin with minimal exported On/Off pairs, inspect all
settings fields, and verify repeated On and repeated Off plus preservation of
unrelated adjustments, crop and masks on disposable photos. Only then bundle
assets/setup and expose independent On/Off actions; never infer a toggle from
browser memory. This bounded pass has ended; no speculative preset controls ship.

### Earlier source retest sequence — latest results recorded above

This was the earlier source retest request on a disposable photo. The latest manual
results above supersede its pending status; do not repeat accepted checks for note cleanup.

1. AUTO should still act in Lightroom; any unavailable treatment message must
   clearly identify B&W. Check the B&W control separately.
2. Drag Green Saturation, immediately drag Aqua, then make two quick Effects
   adjustments. Watch both displayed values through confirmation and compare
   their settled values with Lightroom. No zero/earlier-value flashes.
3. Select Circle → Bubble → 5-Blade, allowing each pending request to finish.
   Compare highlight timing with Lightroom; no premature confirmation.
4. Open Guided Upright on a photo with a correction, then Close. Verify the tool
   exits while the correction and crop remain unchanged.
5. Glance at Tone Curve order, Detail/Effects dividers and the revised notices at
   desktop/narrow widths. Previously tested Color Grading and Masking Point Color
   were not changed and need no repeated broad audit.

When the remaining gates and build authorization are satisfied, build a new identified
candidate from accepted source and run the existing package gates. Keep original
package evidence and pending acceptance
items below scoped to what was actually reported; the general manual-testing
statement does not independently certify every historical edge case.

Help and HTTP Builder were accepted on 2026-09-25. A local checkpoint and private Windows portable test build are authorized; see [source checks and remaining acceptance](RELEASE_CLEANUP.md). Packaged-runtime checks and the manual acceptance items below remain distinct. This candidate is not approved for publication.

Feature scope is frozen. The working Lens Blur and Profile Windows helper dependencies are accepted for this release. Lens Blur **+ New Refinement**, named export presets, macOS packaging and additional MIDI2LR parity are deferred. The previous comparison at official MIDI2LR revision `e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc` is retained; it was not repeated.

## Completed preparation

- Help, README and references describe the accepted favorites/Selection layout, Quick Copy Settings, Paste Settings, Export and implemented editing tools. Quick Copy uses values from the active photo and the categories last chosen in Lightroom's native Copy Settings dialog; it opens no dialog and does not copy from the previous photo.
- The accepted Builder provides searchable SDK/WIN UI command cards, simple URLs and complete copyable PowerShell requests/scripts. The reference inventory contains **206 registered HTTP routes**; internal polling, diagnostics and protocol routes are excluded from the command cards. Copied URLs use direct API port 17891 without `/api`. Slider operations honor capabilities and numeric validation. Scripts obtain required fresh context, selection tokens and request IDs when run, preserve confirmations and inspect results without automatically retrying edits. [HTTP workflows](HTTP_WORKFLOWS.md) describe those contracts and limitations. Shared Step controls update relative commands without changing Set values or Reset commands.
- Existing outdated assertions were reconciled with current production behavior: Selection/Masking order, picker scrolling, current preset button and component requirement, lifecycle-owned slider tasks, full Driver command binding, favorites' focus-preserving `aria-disabled`, current routes/diagnostics and public defaults independent of personal configuration. Functional safeguards were retained.
- Fengari 0.1.5 is a locked development dependency. `npm ci` installs the Lua test runtime; no external Temp installation is required. Browser tests require installed Edge/Chrome or `LRBRIDGE_CHROMIUM_PATH` and use disposable profiles/mock state. `npm run test:release` runs 68 source/feature/staging checks, including Reset, Selected and diagnostic isolation; `npm run test:release -- --browser` runs ten browser gates, including broad lifecycle, Reset, Selected and Help/Builder. Live smoke/capture scripts are excluded.
- The existing transitive `qs` dependency was updated to 6.16.0 for its [upstream security fix](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g); the production npm audit reports zero known vulnerabilities at preparation time. HTTP validation/transport checks passed after the update.
- The clean Windows build stages only public runtime files, fresh settings, 39 transitive Lua modules and exact Dust presets. It preserves the Windows helper, includes Color Grading metadata inside ASAR and with the plug-in, and excludes private configuration, credentials, backups, research and development captures. Plug-in metadata is v0.6 with SDK 15.3 minimum; the native test baseline is Lightroom 15.4.1. Dust On retains its exact Lightroom/Process Version gate.
- The Dust installer verifies the complete bundled set before writing, leaves identical presets alone and refuses different existing files. Tests cover installation, repeat installation, conflicts, corrupted bundles and Lua syntax without touching installed presets or Lightroom.

## Remaining acceptance and limitations

**Testing order:** Profile, feedback, responsiveness and touchscreen Reset are accepted
within the recorded limits above; the mask-local Point Color confirmation candidate
also has a successful user touchscreen retest. The latest AUTO/B&W, bokeh, Guided
Upright, Color Mixer / Effects, Tone Curve, layout and existing HDR / Crop results are
recorded above. Preserve them without repeated checks. Copy/Paste, Export and Enhance
now have the bounded acceptance above; the package/native gates below remain pending. A new Crop-panel
presentation stays deferred without explicit checkbox equivalence and crop/mask
preservation evidence; this does not revoke acceptance of the existing control.
Build and verify the authorized fresh private candidate in a new writable extraction
and complete the package/native gates before publication. The old private package
must not run beside the source app or be published as containing these fixes. Do not
install presets, repoint the plug-in or send live edits automatically.

**Denoise Reset:** Included by the user's release decision. The Amount-only Reset to 50 keeps Denoise on, preserves Raw Details/Super Resolution command logic and waits for Lightroom feedback. Prior focused model/browser checks and the user's acceptance are recorded above; no additional native scenarios are inferred.

**Dust setup dependency (2026-09-24 source review):** Adding the plug-in alone on a fresh computer does not enable Dust Apply on/off or Reset. The runtime resolves the exact presets from Lightroom's registered preset inventory; it does not load them directly from the bundled `resources/presets` folder. The separate `Install Dust Presets.cmd` copies them to CameraRaw Settings, and neither app nor plug-in startup runs it. The development computer already had both presets during the September 16 capture, before the packaging/installer checkpoint. Current files match the bundled hashes; the precise save/import action cannot be established from the capture. Isolated missing-preset and installer checks pass, but actual fresh-computer preset discovery and Dust operation after setup remain release acceptance items. Existing working presets were not changed.

**Compatibility boundary:** The private test target is Windows x64 and Lightroom Classic 15.4.1. SDK metadata declares 15.3; that does not establish an overall supported minimum. Dust's current state/Apply/Close code explicitly requires exactly Lightroom 15.4.1, and Apply on also requires photo ProcessVersion 15.4. Other Lightroom versions remain unverified.

1. **Windows startup/restart and settings preservation:** extract into a new writable folder; verify matching plug-in loading, normal desktop start/quit/tray, polling/reconnection, helper controls and preservation of settings/favorites with the same browser origin. Automated packaged-runtime checks do not replace a real desktop/Lightroom session. The candidate is unsigned and unpublished.
2. **Packaged integrations and LAN:** verify copied commands through PowerShell and Companion on disposable photos, and Controller access/use from a phone/tablet on the private LAN. Copy/Paste and Export's source acceptance does not establish these package integrations. Batch paste success still means at least one photo; AI completion and comprehensive preservation remain unverified.
3. **Clean Dust setup:** on a clean setup, install the bundled presets while Lightroom is closed, restart Lightroom, then confirm preset discovery and Dust operation. Existing-machine success and isolated installer checks do not establish this clean-setup result.

Known limits remain documented in [Windows beta notes](WINDOWS_BETA.md): People processing/Cancel; arbitrary-photo Dust redetection and preservation with populated AI/manual edits; broad copied-mask/AI preservation; actual last-component deletion and broader Red Eye reset preservation; native fault/reconnect cases. Historical Healing/Point Color/Blue-curve reports have no current reproduction. `cycle_loupe_info` remains excluded from visible choices because the prior native test had no visible effect. No speculative fixes or disabled working controls were introduced.

The legacy `tests/dust-paste.js` exercises the unshipped `TestDustPaste.lua` research workflow, not the native Quick Copy/Paste implementation. An exploratory run exceeded four minutes; it remains outside the shipping runtime gate. Its earlier one-photo evidence does not establish general clipboard or AI correctness. Production Dust/clipboard guards retain their own focused tests.

This is a local development candidate, not native acceptance or authorization to push, merge, tag or publish.
