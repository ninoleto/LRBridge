# LRBridge Codex Handoff

## September 28 accepted fixes integrated; fresh private candidate next

- `feature/v0.6-more-sdk-and-web-controller` now contains the original accepted
  slider/Reset commit **`246d11b1381c07e77fa29aa60e9a721e99c6f8e2`** and the scoped
  lifecycle commit **`95e35920451f4bc5be4f2c385803c1d74e571679`** by fast-forward
  from `8f9ce61`. The isolated branch and its tested implementation remain preserved.
- All 112 runtime/configuration inputs match the tested isolated source, allowing
  line-ending normalization. All 40 production Lua modules and the three verified
  Controller assets match the native-test preparation. The generated HTTP inventory
  then received source-line-number updates only: all 206 routes, classifications and
  command contracts are unchanged. This is packaging integration, not slider tuning.
- Preserve the bounded acceptance: no jumps observed in the earlier corrected run;
  current Reset responsiveness accepted for the tested controls; native lifecycle
  sequence accepted after the user's Lightroom restart. Copy/Paste and Export work
  in the user's tested cases only. Denoise, Raw Details, Super Resolution, Denoise
  Reset/availability/grey appearance/alignment and all earlier accepted checks and
  documented limitations remain intact. Constrain Crop feedback optimization stays deferred.
- Historical root investigation notes have been retained below with a superseded
  marker. The original SDR browser test is preserved locally; its integrated version
  retains those cases and adds the captured-failure regression. Unrelated work,
  private settings, protected cheat sheets, stash and old packages are preserved.
  Active source app and diagnostic plug-in files/registration have not been changed.
- Reuse completed slider/Reset and 35-scenario lifecycle verification. Finish required
  integration/package checks and build only from the committed, sanitized source.
  The next entry will identify the fresh candidate and its remaining manual gates.
  No new desktop launch, Lightroom edits, recording, push or publication tonight.

## September 28 lifecycle acceptance and private package preparation

- The user explicitly accepts the completed native Disable → Enable → Reload
  result for the tested sequence, with Lightroom restarted before the sequence.
  Include the verified lifecycle fix, its tests and documentation in a scoped local
  commit, preserving slider/Reset checkpoint `246d11b` and all bounded results below.
- Integrate both fixes into `feature/v0.6-more-sdk-and-web-controller`, verify runtime
  equality with the tested implementations, and build a fresh private Windows package
  using the existing sanitized workflow. Reuse completed feature/lifecycle checks;
  only integration and packaging verification is needed. Preserve prior packages,
  unrelated work, private settings, recordings and stash contents.
- Package startup/restart/settings preservation, Companion/PowerShell commands,
  phone/tablet LAN use and clean Dust setup remain manual gates for another session.
  Do not launch the new desktop package, change the active Lightroom plug-in entry,
  send photo edits, request recordings, push or publish tonight. Historical preparation
  sections below retain their original evidence and are superseded by this acceptance.

## September 28 native polling lifecycle sequence verified

- User restarted Lightroom before completing the requested Reload → Disable → Enable
  → Reload sequence. The source LRBridge app stayed running. Preserve this actual
  sequence; do not describe the test as having occurred without a Lightroom restart.
- Logs verify the corrected plug-in started one command and one feedback supervisor
  at 04:01:55 local. Initial reload stopped both at 04:02:38 before their replacements
  started at 04:02:39. Disable stopped both at 04:02:42, followed by seven logged
  seconds without polling records until Enable started one pair at 04:02:49. Final
  reload stopped both at 04:02:52 before one final pair started at 04:02:53.
- **Native PASS for this sequence:** no duplicate starts, overlapping supervisors
  of the same type or lifecycle failures in the recorded window. Independent old
  source/package plug-in logs remain unchanged. Final SDK heartbeat is fresh and
  queue empty. All 40 diagnostic modules and three served Controller assets match
  the verified versions. Preserved 50 hash-verified evidence files plus analysis.
- Reuse the completed 35 automated lifecycle scenarios and compatibility/compiler
  checks. Native rapid-toggle, in-flight-operation, injected-failure and shutdown-
  cancellation cases were not added by this run. Earlier limitations stay recorded.
  No new slider/Reset testing or tuning; the accepted fixes remain checkpointed at
  `246d11b`. Lifecycle changes remain uncommitted. No build, push or publication;
  remaining package checks are still open. No further reload/test is requested for
  this completed lifecycle sequence. Detailed evidence is in the ignored local handoff.

## September 28 slider checkpoint complete; polling lifecycle fix awaits native validation

- Scoped local checkpoint **`246d11b1381c07e77fa29aa60e9a721e99c6f8e2`**
  (`Fix shared slider confirmation ownership and Reset readback timing`) contains
  the reviewed 21-file slider/Reset scope, regressions and documentation. User accepts
  Reset responsiveness for the tested controls. Completed checks were reused; the
  bounded recordings/results below are unchanged. Main worktree, private settings,
  stash and preserved candidate remain untouched. Nothing was pushed or built.
- Separate lifecycle cause: `Info.lua` omitted the SDK's Disable/Enable callbacks.
  Unload/app-shutdown callbacks do not substitute for Disable. Existing evidence
  shows a disabled packaged copy still consuming commands alongside the diagnostic
  worker. Also, startup discarded Enable while a stopped generation was draining.
- Uncommitted lifecycle correction, separate from slider tuning: Disable synchronously
  requests stop; Enable uses idempotent startup. Forced initialization cannot revive
  a disabled plug-in. A quick re-enable reserves one replacement pair and waits for
  preceding workers/children to drain; later Disable cancels that start. Stopped
  generations cannot resume on re-enable. Generation-labelled start/stop logs support
  the native check. In-flight SDK operations are not killed or automatically retried.
- **Automated PASS:** 35 cooperative actual-production-Lua lifecycle scenarios,
  public polling command compatibility, Adobe compiler checks for all 40 prepared
  diagnostic modules. Regressions fail against old code for continued consumption
  after Disable and lost quick Enable with hooks alone. Fresh-environment reload,
  late responses, backoff, duplicate startup, observer/child cleanup and action drain
  are covered. These are simulated SDK checks, not physical acceptance.
- Updated `Info.lua`, `PollingLifecycle.lua` and `PluginShutdown.lua` are prepared in
  the existing diagnostic plug-in; prior files and logs are preserved. Current source
  app remains running; Controller/backend and slider/Reset code are unchanged. No app
  restart or new recorder is needed. Exact preparation and evidence paths are local.
- **Next native check:** in Lightroom Plug-in Manager, select the existing diagnostic
  LRBridge entry. Reload once to load this fix; Disable, wait 5 seconds, Enable, wait
  5 seconds; then Reload once more to test the corrected reload lifecycle, and wait
  5 seconds. Keep other entries disabled and send no edits during this check. After
  the user finishes, inspect generation start/stop events and independent worker logs
  before accepting the result. Native lifecycle acceptance remains pending. No rebuild
  or publication; all remaining package gates/limitations and Constrain Crop deferral stay.

## September 28 accepted slider and Reset checkpoint

- The user explicitly accepts **current Reset responsiveness for the tested controls**
  and authorizes a scoped local checkpoint of the slider/Reset corrections, tests and
  documentation. Preserve the recordings and their limits: the first corrected-source
  run had **no jumps observed in that run**; the latest four-Reset run was noticeably
  more responsive. No additional no-jump observation or final release approval is inferred.
- The checkpoint on `fix/shared-slider-coordination-20260927` preserves the shared
  confirmation ownership/error correction, prioritized bounded confirmation reads and
  Lua command-busy rechecks. The four latest native Reset confirmations remain Whites
  273 ms, Clarity 492 ms, Highlights 233 ms and Shadows 343 ms, backed by SDK readback.
- Reuse the completed focused regression, HTTP/queue/context, actual-Lua and browser
  checks documented below. Private settings, unrelated root work, raw recordings,
  diagnostic instrumentation and the stash remain outside this checkpoint.
- **Next, separately:** fix the polling lifecycle defect where disabling/reloading
  can leave old workers consuming commands. Use existing evidence, complete focused
  automated checks, then obtain native lifecycle validation. Do not retune sliders.
  No rebuild or publication; remaining package gates and documented limitations stay.

## September 28 Reset follow-up retest — noticeably more responsive, bounded result

- User finished the fresh capture and reports **"This feels noticeably more responsive."**
  Preserve that observation as stated. A separate question about backward jumps in
  this latest run is pending; do not infer a new no-jump report or final release approval.
- Preserved and hash-verified 70 evidence files for the 16.546-second native capture,
  including browser/HTTP/SDK streams, exact tested source and all 40 diagnostic modules.
  One diagnostic worker remained active; old source/package logs stayed unchanged.
- Four recorded Resets: **SDR Whites 273 ms, Clarity 492 ms, Highlights 233 ms,
  Shadows 343 ms** from touch release to confirmed display. Median total improved
  from 477 to **308 ms**; median SDK-return→display from 348 to **158 ms**. Each
  request began 1 ms after touch release. Samples differ in size and pace.
- The comparable rapid Clarity/Highlights/Shadows sequence improved from
  1110/1356/1481 ms to 492/233/343 ms, with similar tap spacing. All four displayed
  zeros followed actual post-Reset SDK reads. No older write followed Reset before
  new input, and recorded SDK state stayed zero through the remaining capture.
  No command failures or target reads begun during Reset preparation were recorded.
- Shadows correctly renewed one read taken just before its command began; the old
  number was not treated as completed Reset. Clarity's remaining delay included an
  ordinary snapshot already in progress. Existing context invalidation and bounded
  feedback renewal stayed active. No additional implementation change is indicated.
- Source and plug-in remain running at the verified Reset correction; the recorder
  is finished/disarmed. Evidence pointers and detailed timing are in the ignored
  local handoff and `docs/SHARED_SLIDER_COORDINATION.md`. Reuse completed focused
  checks; no HTTP Contrast repeat, new recording, checkpoint, build or publication.
  Release remains blocked pending remaining acceptance; all package gates and the
  separate disabled-plug-in worker issue retain their previous status.

## September 28 corrected-source retest — no jumps observed; Reset follow-up pending

- User report: **no jumps observed in this run**. Reset worked but still felt
  "acceptable-ish," noticeably slower than normal Point Color Reset. This is not
  final release approval. Release remains blocked; no checkpoint, build or publication.
- Preserved the complete 121.416-second browser/HTTP/SDK capture. It contains 51
  Resets; 48 have usable post-execution display transitions (two already zero and
  one repeat whose display preceded its own execution are excluded). Median
  release→request / request→SDK / SDK-return→display / total changed from
  **1 / 153 / 796 / 969 ms** to **1 / 145 / 348 / 477 ms**. Instrumented samples differ
  in pace and size. The worst current transition remained 2514 ms, chiefly readback.
- Demonstrated Whites delay: the feedback worker checked command-busy, yielded,
  then read -74 during Reset preparation. This differed from cached -38 and retired
  Reset demand prematurely. SDK Reset completed at 0, but the display waited for a
  later valid read. Rapid Resets also waited one complete background cycle per read.
- In the existing isolated worktree, the shared Lua guard now rechecks after its
  yield and between snapshot values after their HTTP posts; idle values gain no
  extra delay. Busy timeout/shutdown suppress reads. Ready confirmation reads drain
  in groups of at most four, respecting background fairness. The bridge provides an
  optional dequeue scheduling hint. No optimistic Reset value, Controller change,
  command retry, driver/range change or public Set/Adjust/Reset change. Drag correction,
  photo/context checks and accepted behavior remain. Constrain Crop optimization stays deferred.
- Two captured regressions fail on preserved old Lua and pass on new production Lua;
  fourteen cooperative scenarios plus focused queue/delivery/context, browser Reset,
  polling lifecycle and HTTP compatibility checks pass. Physical timing after this
  follow-up remains untested. Completed native Contrast observations are preserved,
  not repeated. Normal Point Color shows its known target immediately and publishes
  SDK state from its write handler; shared Reset discovers Lightroom's default via
  separate feedback. No native Point Color timing was captured.
- Diagnostic `baseline/lightroom/LRBridge.lrplugin/FeedbackPolling.lua` is prepared
  on disk; all 40 diagnostic modules match this source after removing trace hooks.
  **The user completed the reload; the updated source app is now running.** Process,
  assets/backend, fresh diagnostic load markers and diagnostic-only feedback are
  verified. That fresh recording is now finished; its bounded result is recorded
  above. Exact preparation/evidence paths remain in the ignored local handoff.
- Short next test: adjust Whites → immediate Reset, then quickly adjust/Reset
  Clarity, Highlights and Shadows, watching Lightroom and Controller together.
  Preserve the old candidate, root/private/unrelated work and stash. Disabled-plug-in
  worker defect remains separately tracked. See `docs/SHARED_SLIDER_COORDINATION.md`.

## September 28 captured SDR Brightness rollback — correction prepared, release blocked

- Work remains isolated on `fix/shared-slider-coordination-20260927`, based on
  `8f9ce61`, in `D:\Projects\LRBridge\local-checkpoints\shared-slider-redesign\worktree`.
  The root worktree, private settings, stash, research and candidate `20260927T174904Z`
  are preserved. Index remains empty; no new checkpoint, build or publication.
- The fresh 35.109-second touchscreen capture has complete browser/proxy/SDK streams
  and one verified diagnostic command consumer. The preserved candidate is now quit;
  the tested corrected source is running from this isolated worktree. Fresh capture
  preparation and its exact current link are recorded in the ignored local handoff;
  diagnostic plug-in: `local-checkpoints/shared-slider-redesign/baseline/lightroom/LRBridge.lrplugin`.
  Prior recordings and their corrections remain preserved in the ignored local handoff.
- **Demonstrated failure:** latest `SDRBrightness` input -49 was submitted and written
  by the SDK. A confirmation snapshot expired after a Develop revision; HTTP 404
  arrived before the browser refreshed that revision. The old error branch displayed
  cached authority 0 at 27.697 s, then fresh -49 at 28.397 s. Recorded SDK values stayed
  -49 throughout that rollback, until a later explicit Reset. No late older write or
  value conversion error caused this captured jump.
- Twelve recorded Resets: touch release to request 0–1 ms; request to SDK execution
  81–290 ms; SDK return to visible result 145–1186 ms. Most delay was confirmation
  scheduling, including an obsolete Set read ahead of Reset. These are instrumented
  baseline measurements, not corrected native timing. See `docs/SHARED_SLIDER_COORDINATION.md`.
- Replaced the shared Set/Reset confirmation transport/ownership logic: verify an
  expired snapshot against fresh context, renew only owned reads, cancel superseded
  reads, never render cached authority as a failed confirmation, and retain real errors.
  Server prioritizes compatible edit/Reset reads, coalesces undispatched compatible
  work and admits background work after four confirmations. Existing write ordering,
  SDK requirements, public Set/Adjust/Reset routes and accepted touch Reset remain.
  Same-value pre-execution Reset reads retain their existing bounded retry spacing.
- Regression replay and real Controller DOM reproduction **fail on old source and
  pass on the correction**. Focused rapid/alternating sliders, immediate/delayed Reset,
  context/photo changes, errors/unavailability, external feedback, queue fairness,
  proxy and public HTTP compatibility checks pass in isolation. Physical acceptance
  remains pending. The inventory covers every slider family and 111 generic IDs.
- Preserve accepted native HTTP observations without repeating: main Contrast Set20
  stayed stable; Adjust3 reached35; Set65 then Reset ended0 (65 was not visually seen).
  SDK trace shows both latter writes in order. Earlier finished-tab0 was not a native
  Lightroom observation. Highlight Saturation worked in this touchscreen run only;
  this is not a universal resolution of the original report.
- **Next:** the corrected source assets/backend and single diagnostic worker are
  verified; the fresh recorder is idle until the user presses Start trace. No plug-in
  reload is needed because no Lua changed. Retest rapid Brightness, alternating SDR
  controls and immediate Reset, observing both Controller and Lightroom. Preserve
  and assess the recording before changing acceptance; keep release blocked.
- The disabled-plug-in worker lifecycle defect remains separate and unresolved.
  A fresh credential-free recovery backup was uploaded and read back successfully
  before implementation; private evidence, manifests and timings remain local.

## September 27 SDR quick-adjustment report — release blocker, diagnosis pending

> Historical investigation note preserved during integration. Its pending-test
> instructions are superseded by the accepted September 28 results above.

- The user reports backward jumps during quick changes to **Highlight Saturation**
  and the other **SDR Rendition** sliders. Keep this as a release blocker; the previous
  accepted results remain bounded and do not establish universal slider stability.
- Actual running app verified: `dist/private-test-20260927T174904Z/LRBridge.exe`,
  PID 33368 owns ports 17890–17892. Served Controller/Point Color/Denoise assets match
  the candidate's ASAR and have `Cache-Control: no-store`; all 40 bundled Lua modules
  match build identification for source checkpoint `7bd6db9`. No source Electron app
  is running. Repository HEAD remains `8f9ce61`, twelve ahead / zero behind the
  configured upstream, with the pre-existing private/unrelated work and stash retained.
- **Setup discrepancy:** both the source and packaged Lightroom plug-in copies are
  actively consuming commands and feedback requests. Their independently rooted logs
  both contain fresh, distinct events during the reported session; Lightroom preferences
  list both installed paths and do not disable the source path. The package plug-in is
  selected. This is not merely an old source log. The bridge's `/next` FIFO has one
  consumer assumption; each plug-in serializes only its own SDK execution. Two consumers
  permit overlapping execution. Existing logs do not establish the actual SDK write
  order or prove this is the sole cause of the reported jumps. User confirmation of
  Plug-in Manager state was requested; no Lightroom UI automation was used.
- Exact affected metadata IDs: `SDRBlend` (Highlight Saturation), `SDRBrightness`,
  `SDRContrast`, `SDRClarity`, `SDRHighlights`, `SDRShadows`, `SDRWhites`. They use the
  shared `createDevelopSliderControl` path: local range input, throttled `/set`, final
  serialized submission, server per-slider coalescing, `Driver.setSlider`, SDK readback
  and shared targeted/panel request-order protection. Values are direct integers with
  current runtime ranges; no SDR-only conversion discrepancy was found. `HDRMaxValue`
  has a separate log2 visual scale and is not the Highlight Saturation control.
- This shared path also serves ordinary Tone, HSL/B&W, Detail, Effects, Calibration,
  lens corrections/transform, parametric Tone Curve and SDK Lens Blur sliders (some
  have their own constraints). Global Point Color uses separate intent/edit sequencing
  and waits for authoritative settlement before advancing its write queue. Its behavior
  cannot simply be transplanted into generic slider/Reset handling.
- Added `tests/controller-sdr-feedback-browser.js`, reusing the isolated browser/mock
  infrastructure and actual production UI handlers. PASS on unchanged runtime: all
  seven controls, repeated drags with held HTTP admission, alternating controls, stale
  feedback after newer confirmation, legitimate subsequent Lightroom values, Reset
  ordered after the admitted drag with the unsent drag cancelled, and rejected writes
  with visible errors/no retry. Existing `tests/release-feedback-fixes.js` and
  `tests/hdr-develop-settings.js` also pass. These checks do not pass the native report.
- **Next native check:** disable the source/other LRBridge plug-in entries and leave
  only the bundled `20260927T174904Z` plug-in enabled. On the same disposable HDR photo,
  quickly drag Highlight Saturation twice, alternate with SDR Highlights, then Reset
  immediately after a drag. Report whether the Controller and Lightroom settle together
  or jump. Verify source polling has stopped before attributing any remaining failure
  to the shared implementation. No plug-in code changed or reload is requested here.
- Runtime, private settings and existing packages are unchanged. No speculative delay,
  suppressed feedback, new recorder, checkpoint, rebuild or publication. Fresh recovery
  and detailed evidence are preserved in the ignored local handoff. Rebuild remains
  deferred until the native retest passes; other package acceptance gates remain pending.

## September 27 fresh private Windows package — ready for manual package checks

- Release source checkpoint: **`7bd6db95f58897922c1984736e9fe8066a573912`**
  (`Checkpoint accepted Copy/Paste, Denoise and release presentation`), on
  `feature/v0.6-more-sdk-and-web-controller`. The reviewed 24-file checkpoint includes
  accepted Copy/Paste and Denoise work, Point Color confirmation/spacing, presentation
  notes, focused tests and acceptance documentation. All mixed Controller hunks were
  reviewed and fall within this accepted scope. A documentation-only follow-up records
  this package result; the package's source commit remains the one above.
- Built with the existing sanitized workflow from an isolated Git export of that
  checkpoint, with publication disabled: Windows x64, LRBridge **0.6.0**, Electron
  **43.1.1**, build **`20260927T174904Z`**. The portable candidate is unsigned/private.
  - ZIP: `D:\Projects\LRBridge\dist\beta-20260927T174904Z\LRBridge-0.6.0-beta-win-x64-portable.zip`
  - Extracted application: `D:\Projects\LRBridge\dist\private-test-20260927T174904Z\LRBridge.exe`
  - Matching bundled plug-in: `D:\Projects\LRBridge\dist\private-test-20260927T174904Z\lightroom\LRBridge.lrplugin`
  - ZIP SHA-256: `50d4d025312058734671841dab16532b96b18cf9eb303e0df23e580ca1966801`.
  - Adjacent `candidate.json`, checksum sidecar and `build-identification.json` identify
    the candidate. Detailed checks and recovery evidence remain in the ignored local handoff.
- **Passed:** required staging/route/reference/defaults and isolated Dust installer
  checks; release cleanup and Lua syntax; focused favorites and Enhance checks;
  builder/ZIP manifest verification; extraction hashes; 69 runtime files and 40 Lua
  modules matched to the checkpoint, including both native helpers and exact Dust
  presets/installer; credential/development-artifact exclusion. Settings are exactly
  `poll_interval_ms=100` and the bundled Develop preset configuration is empty.
- Extracted Electron Node smoke passed two start/stop cycles, empty polling/metadata
  and unchanged settings. Extracted Controller/Help/Builder/reference routes serve the
  checkpoint content; isolated browser checks at 1280/390/320px pass with packaged
  dependencies, working links and no overflow or JS errors. GUI lifecycle was stubbed;
  these checks did not start a second desktop bridge or invoke Lightroom/native helpers.
  Completed feature/physical checks below were reused without a broad suite rerun.
- Private settings, unrelated `.gitignore`/`AGENTS.md`/test edits, research, protected
  cheat sheets, existing stash and diagnostics are preserved. The old private ZIP
  `20260925T022735Z` retains its original checksum. No push, tag or publication.
- **Still manual:** desktop startup/restart and settings/favorites preservation;
  Companion/PowerShell commands; phone/tablet LAN use; clean Dust installation,
  discovery and operation. These are not marked passed. Existing limitations and
  deferred Constrain Crop optimization remain unchanged.
- **Switch to this candidate:** fully quit the running source LRBridge first. To carry
  preferences over, copy its `config/settings.txt` and, if used, `config/develop-presets.json`
  into the new extraction after verifying the fresh defaults; keep the ZIP unchanged.
  Start the extracted `LRBridge.exe`. In Lightroom's Plug-in Manager, disable the old
  source/package LRBridge entries, add/enable the bundled path above and reload that
  plug-in once. Refresh the same Controller address/browser profile to retain favorites.
  Do not run source and package simultaneously. For the separate clean Dust check,
  run the bundled installer while Lightroom is closed and restart Lightroom afterward.

## September 27 accepted release checkpoint and private package preparation

- The user reports that **Copy/Paste and Export work in the cases they tested, with
  no problems observed**. The report does not identify additional photo counts,
  output-file checks, cancellation, fault cases or AI/mask-preservation scenarios;
  do not infer those were tested. This supersedes the earlier blanket Copy/Paste
  pending status while retaining all documented SDK and coverage limitations.
- **Denoise, Raw Details and Super Resolution are accepted for the tested behavior.**
  The user also accepts Denoise's disabled controls, grey appearance and alignment
  with the standard sliders, and explicitly includes **Denoise Reset** in this release.
  Reset uses the existing Amount-only command to request 50, keeps the displayed
  authoritative Amount until feedback, and does not toggle Enhance. Amount controls
  require confirmed Denoise On and retain the existing pending-operation guards;
  Amount remains adjustable at 50 although Reset is disabled. Checkbox availability
  remains independent. No Raw Details/Super Resolution command logic changed.
- Copy/Paste retains its two buttons and the three approved help paragraphs, with
  bold labels/shortcut. The destination-count line and technical Details panel are
  removed. Progress/errors and required acknowledgement remain; results distinguish
  incomplete batch confirmation and pending/unknown AI processing. Successful paste
  result notices use italic dark yellow (`#c9a227`), without changing error styling.
- Reuse the completed focused Copy/Paste browser checks, Denoise model/Reset and
  availability checks (including On at Amount 50), Off/On rendering and desktop/narrow
  alignment checks. These are isolated automated checks, separate from the user's
  bounded native acceptance. No repeated functional slider suite or new recorder.
- Previously accepted Profile, feedback, touchscreen Reset, Point Color, visual
  spacing/notes and all recorded limitations remain intact. Constrain Crop's delay
  note is accepted; its feedback optimization stays deferred.
- The user authorizes a scoped local checkpoint and a fresh private Windows portable
  package, with **no push or publication**. Starting branch is
  `feature/v0.6-more-sdk-and-web-controller`, parent `4c5f863`, ten ahead / zero behind
  the configured upstream, with an empty index. Private settings, unrelated edits,
  research, diagnostic evidence and the existing stash remain outside the checkpoint.
  Build from an isolated export of the checkpoint using the existing sanitized workflow;
  preserve old private build `20260925T022735Z`.
- Remaining **manual package checks**: desktop startup/restart and settings/favorites
  preservation; Companion/PowerShell commands; phone/tablet LAN use; and clean Dust
  installation/discovery/operation. Automated package checks do not pass these in advance.
  Earlier pending/no-build notes below are historical and superseded only within this scope.
- Checkpoint preparation passed the existing release staging/route/reference/defaults,
  isolated Dust installer, cleanup/diagnostic exclusion, Lua syntax and staged startup
  gates, plus the focused favorites presentation and Enhance contract checks. Only
  obsolete tooltip/custom-grid fixture expectations needed reconciliation; runtime
  code stayed unchanged. The broad feature suite and accepted native tests were not repeated.

## September 27 end-of-day handoff — accepted state preserved

- The user accepts the latest visual changes, including Point Color touch spacing,
  bold control names in the Red Eye / Masking notes, the Selected Add/Subtract amber
  notice, and the helper note directly below Constrain Crop:
  "If you change this setting directly in Lightroom Classic, the Web Controller
  checkbox may take a moment to update."
  The Constrain Crop note changes text only; behaviour and feedback timing are unchanged.
- Keep all completed manual checks below marked accepted, with their recorded limits.
  Preserve the accepted Profile, slider feedback/responsiveness, touchscreen Reset,
  Point Color and Color Grading implementations. Do not reopen completed checks or
  claim intermittent jumping is universally resolved.
- Preserve all existing uncommitted work, including Denoise Reset, private settings,
  unrelated edits, stash contents and diagnostic evidence. HEAD remains `4c5f863`,
  ten commits ahead / zero behind upstream; the index is empty. No checkpoint today.
- **Next:** test Copy / Paste Settings and resolve Denoise Reset's release status;
  then create a scoped checkpoint, build a fresh package and complete the remaining
  package/integration checks. Copy / Paste remains untested. Denoise Reset remains
  pending a release decision; its uncommitted implementation must be preserved.
  The old private build `20260925T022735Z` does not contain these source changes.
- Work stopped at the user's request. This final step updates this handoff only:
  no further tests, application changes, commit, build, push or publication.

## September 27 limited release cleanup — latest manual results recorded

- User's source touchscreen results: **AUTO and B&W passed; Lens Blur bokeh shapes
  passed; Guided Upright passed.** Color Mixer / Effects had no problems observed
  in this session; this does not establish universal resolution of intermittent jumping.
- **Tone Curve order passed:** Highlights → Lights → Darks → Shadows. Detail / Effects
  layout is acceptable for this release. Existing HDR / Crop functionality is accepted;
  missing features remain deferred. Lens Blur is accepted with its experimental limitations.
- **Copy / Paste Settings was not tested and remains pending.** Do not repeat the
  accepted checks unnecessarily or infer acceptance for other historical edge cases.
- Constrain Crop: the user reports correct Controller-issued updates, but direct
  Lightroom changes take about two seconds to appear. Source inspection found a
  500 ms browser refresh with one categorical request in flight, a separately queued
  SDK read (requests rate-limited to 400 ms apart) in the sequential plug-in feedback loop, and a shared
  HTTP response that can await Profile refresh. It returns the latest cached SDK state,
  not a result bound to that refresh request. New revisions render without a separate delay.
  An isolated probe through the production handler confirmed both an older response
  before SDK arrival and fresh categorical feedback held behind Profile. These are
  automated scheduling findings, not a live timing breakdown of the reported two seconds.
  No fixed two-second SDK wait or evidence of an Adobe limitation was found. Improving
  this requires separating shared refresh/response responsibilities; defer that work
  and preserve the accepted Profile path, intervals, confirmation and context safeguards.
- Presentation only: bold the actual unsupported control names in the existing Red Eye
  and Masking notes; reuse the Focus Range amber notice styling for Selected Add/Subtract's
  experimental explanation. Text, placement, action buttons and control behaviour stay unchanged.
- Syntax, existing Constrain Crop synchronization checks and the bounded handler probe
  pass. Isolated Chromium visual checks at 1280/390/320px confirm nine bold names,
  unchanged explanations/placement, matching amber styling and no note overflow or commands.
  No repeated native tests, broad slider suite or new recorder. Local evidence remains ignored.
- **Refresh the source Controller only** to load these note changes; no plug-in reload
  or application restart is needed. HEAD remains `4c5f863`; changes are uncommitted.
  All previously accepted fixes, Point Color spacing, Denoise work and unrelated edits
  are preserved. No packaging, push or publication; Copy / Paste, Denoise acceptance and
  the remaining fresh-candidate/native gates in the release review still apply.

## September 27 Point Color touch spacing — accepted, uncommitted

- User's latest physical touchscreen retest of the mask-local confirmation candidate:
  slider behaviour looks good and responsiveness feels "almost instant". Preserve
  that working implementation. This is user-reported acceptance evidence, not a
  measured latency or proof of the earlier intermittent jump's cause.
- CSS-only follow-up: both global and mask-local Point Color scalar rows now have
  32px bottom spacing, accounting for Tone's existing 8px margin plus 16px feedback
  line and 8px grid gap. Desktop/tablet slider centres are 76px apart instead of 52px;
  control dimensions/alignment and Tone's layout are unchanged. The detailed Range
  controls retain separation; below 620px their endpoint values wrap beneath the
  tracks, avoiding their previous narrow-screen overflow with unchanged handles.
- Isolated Chromium/mock-data visual checks at 1280/768/390/320px verify both
  sections, consistent spacing, wrapping, retained control geometry and no commands.
  The extra 320px check retains an existing ~8px Tools-page overflow from the
  surrounding Masking preset/Tone Curve minimum widths; it is outside this change.
  No slider suite or live recorder. Preview/evidence paths stay in the local handoff.
- The user accepts the spacing as part of the latest visual changes. No further
  spacing review or reload is pending. Lua, input/feedback/Reset code, SDK behaviour, Denoise and unrelated work
  are preserved. Confirmation and CSS changes remain uncommitted; no build/push/publication.

## September 27 mask-local Point Color confirmation — successful user retest, uncommitted

- Starting checkpoint remains `4c5f863`; accepted Profile, main-slider feedback,
  touchscreen Reset, preparation timing, global Point Color and Color Grading are
  preserved, as are all pre-existing uncommitted changes including Denoise Reset.
- The user's physical report concerns **only Masking Point Color Hue Shift**.
  A regression through production Lua, server state and parent/shared controllers
  reproduces a confirmation weakness: SDK success plus 12 nonmatching readbacks
  reported confirmed, releasing the pending display as a presumed normalization.
  This is a correction candidate, **not proof of the observed touchscreen cause**.
- Only runtime change: mask-local scalar confirmation now requires the requested
  value within the existing Point Color numeric tolerance (`0.000001`). The same
  bounded reads, errors and context checks remain; no retry, added wait or Hue-only
  exception. Delayed feedback stays pending until a match or bounded failure.
- Focused production-Lua/SDK-double and controller tests pass for delayed/missing
  matches, tolerance, SDK errors, newer edits, photo/Develop/mask/swatch changes,
  exact write counts and Saturation/Luminance. Existing Point Color checks pass.
  These are automated results; the separate 225 ms input-debounce finding is untouched.
- The user completed the requested touchscreen retest and reports good behaviour
  with responsiveness feeling almost instant. No repeat performance test or recorder
  is requested. Preserve the correction; the subsequent CSS spacing is also accepted.
  No commit, packaging, push or publication is authorized by this result alone.

## September 27 accepted follow-up checkpoint — capture cleanup complete

- The user explicitly accepts the tested Profile, feedback, responsiveness and
  touchscreen Reset fixes and authorizes this scoped local checkpoint (parent
  `9ce462f`). Preserve the accepted implementation. No build, push or publication.
- Reused the verified accepted-state recovery archive and independent FTP readback;
  archive SHA-256 `fc00a9079d0e588a82349045d493ad30153038d3022d81e6d379e9b80eccbd3e`.
  Preserved the raw recordings, accepted source copies and all capture-manifest hashes.
  Detailed evidence and the recovery/cleanup locations remain in the ignored local
  handoff. Capture tools, recordings and absolute capture paths are outside release assets.
- Removed only temporary capture loading/marks/observer hooks from six Lua files.
  The accepted non-capture Lua lines are unchanged; normal PollingTrace and Profile
  mismatch diagnostics remain. The working Controller is byte-identical to physical
  acceptance (SHA-256 `95fdfb5a0586a14e76a7603b4f5732f4ce4e0839446ef157818e827c26046098`).
  Only the verified, finished recorder helper was stopped; Lightroom and LRBridge stayed running.
- **Accepted Profile sequence:** Reset All → Auto → Adobe Vivid passed in live Lightroom
  with five stable SDK readbacks. The failing operation had preserved all 167 existing
  non-Look settings; Lightroom added inactive legacy Brightness 50, Contrast 25,
  Exposure 0 and Shadows 5. Only those exact absent-to-default additions on process
  `15.4` qualify, with all six active modern tone values resolved and unchanged.
  Complete Look identity, unrelated settings, context and one-write checks remain.
  Existing Look Version 18.3/18.4 compatibility was present and was not this failure.
- **Accepted feedback/responsiveness:** per-edit pending confirmation and ordered
  submissions remain; Reset cancels older unsent values and follows admitted writes.
  The proven obsolete-snapshot race requires a fresh context before replacement;
  genuine errors remain visible. Skip only the 200 ms preparation wait when already
  in Develop; retain the SDK wake request, 50 ms panel wait, module-transition wait
  and Masking guards. A live Contrast preparation measured 63 ms, previously 264 ms.
- **Accepted physical touch session:** all 8,394 browser events retained; eight deliberate
  Reset taps → eight callbacks → eight HTTP commands → eight successful Lightroom
  executions → eight authoritative zero confirmations. No lost/duplicate activation
  or recorded feedback error/disabling. Two missing native clicks were recovered by
  completed-touch activation; six compatibility clicks produced no duplicate.
  Finger release to confirmation: Contrast 291, Exposure 718; rapid Exposure 539,
  Contrast 228, Highlights 471, Shadows 477, Whites 495, Blacks 534 ms (median 486 ms).
  Callbacks 0–1 ms, HTTP dispatch 0–3 ms, Lua return 100–189 ms, SDK receipt 223–713 ms;
  Controller application followed within 3–5 ms. These are real captured timings.
- Two physical scrolls sent zero Reset commands; both began on panel/label. Scrolling
  from a Reset button and Reset overtaking an unsent same-slider drag remain covered
  only by automation. Completed-touch cancellation, click deduplication and normal
  mouse/keyboard activation retain focused regressions. Controller use was entirely
  touch on a 24-inch screen; the earlier wheel interpretation was incorrect.
  Jumping was **not observed in the latest tests**; intermittent jumping is not
  declared universally resolved. Effects was not exercised in these live captures.
- Accepted Upright red Close styling and separate Lens Blur Experimental notes remain.
  Point Color and Color Grading are untouched. The checkpoint excludes the exact five
  pre-existing Denoise Controller hunks, Denoise implementation/tests, private settings,
  unrelated fixtures/research, AGENTS/.gitignore edits and stash contents; all remain intact.
- Cleanup verification: six-file Lua and working/scoped Controller syntax; captured
  Profile (55 scenarios), preparation (24 commands), polling lifecycle and focused
  Reset/feedback/order regressions. These are automated checks; physical acceptance
  above is reused, not repeated. No broad suite or new slider changes.
- **Unload old diagnostic hooks once:** reload the source plug-in through Lightroom's
  Plug-in Manager, using `D:\Projects\LRBridge\lightroom\LRBridge.lrplugin`.
  Close the recorder page and open/refresh the normal source Controller at
  `http://127.0.0.1:17892/`. No Lightroom or LRBridge application restart is required.
- **Packaging state:** this source checkpoint contains the accepted follow-up fixes;
  the old private build `20260925T022735Z` is unchanged. Do not run it alongside the
  source app. No replacement candidate has been built. Retain the outstanding gates
  in [release review](docs/RELEASE_REVIEW.md#remaining-acceptance-and-limitations):
  the latest manual results above supersede the earlier pending source-check list.
  Copy / Paste and Denoise acceptance plus fresh/package/native integration checks remain;
  the deferred Crop-panel presentation still lacks explicit equivalence/preservation evidence.
  Do not repeat accepted source checks or Profile/touch sessions unnecessarily.
  HDR/SDR preset support stays **unverified**, not impossible; deferred additions are
  not new release requirements. Next authorized phase is remaining acceptance and a
  freshly verified candidate; publication remains a later explicitly authorized step.

## Private-package feedback fixes — scoped source checkpoint, native retest pending (2026-09-26)

- User completed manual testing of private build `20260925T022735Z` and requested
  this focused source-fix batch plus a local checkpoint, with packaging/publication
  targeted by September 30. Starting HEAD verified as `f1c4cd0`, eight ahead/zero
  behind the configured upstream, index empty. No push or publication this pass.
- Full pre-edit recovery archive uploaded and downloaded back with all 445 manifest
  entries verified; credentials excluded. Detailed evidence stays in the ignored
  local handoff. Preserve Denoise Reset, private configuration, research and stash.
- Fixed a reproducible shared-slider display race: ordinary panel snapshots now
  advance the same per-slider feedback floor as targeted reads. A delayed older
  response can no longer undo newer confirmation. Rapid two-slider HSL/Effects,
  delayed responses, exact writes and photo/Develop guards pass in mocks; the
  regression fails against the pre-edit source. Native retest remains necessary.
- B&W treatment-read failures are labelled beside B&W and no longer replace AUTO's
  status. AUTO commands/errors are unchanged. Lens Blur bokeh now reads SDK state
  immediately after its action and checks it through a bounded SDK-only route,
  avoiding unrelated Windows-helper reads. Pending requests are not confirmed
  highlights. Upright Close selects `loupe` and preserves corrections/crop.
- Tone Curve order, Detail/Effects grouping, HDR emphasis and Copy/Paste, Lens Blur,
  Red Eye, Masking and Experimental Selected Add/Subtract guidance are updated.
  Color Grading and Masking Point Color implementations are untouched. Add/Subtract
  stopping until Spot Removal was reset is recorded as user evidence; cause remains
  unknown and reset is not recommended because it can clear corrections.
- Bounded investigation ended: no new preset controls. HDR/SDR minimal exports and
  independent behavior were unavailable for verification; Crop overlay and Auto
  Straighten have no verified route. The developer's Constrain example identifies
  the existing `CropConstrainToWarp` setting with both checkboxes, superseding the
  old “distinct setting” statement below. No preset dependency needed; a Crop
  presentation awaits native 15.4.1 equivalence/preservation verification.
- Source/mock Lua/HTTP and desktop/narrow CSS browser checks are distinct from
  Lightroom acceptance. See [completed fixes, evidence and exact short retest](docs/RELEASE_REVIEW.md#september-26-private-package-feedback-fixes--source-retest-pending).
  This checkpoint is authorized source work, not acceptance of the new behavior.
  Next: run source bridge, reload source plug-in once and refresh the Controller;
  retest AUTO/B&W, rapid Green/Aqua/Effects, bokeh timing and Upright Close, then
  glance at the changed layout/notices. Rebuild only after those checks pass.
- The old ZIP and extracted test package are unchanged. Do not publish them as
  containing these fixes. Reuse prior unaffected evidence; no full-suite rerun,
  broad automation investigation, new dependencies, keyboard injection or unrelated
  refactoring is required for this batch.

## Help and HTTP Builder accepted; private portable test build authorized (2026-09-25)

- **The user accepted both Help and HTTP Builder** and authorized a local checkpoint and private Windows portable test ZIP. This supersedes earlier pending Builder review and packaging deferrals. No push, release publication or automatic Lightroom setup change is authorized.
- **Accepted checkpoint saved:** `e56429c0beb1ed866b4659dae4044be95cef1237` (25 explicitly staged Builder/reference/test/preparation files). Pending Denoise Reset, private configuration, unrelated fixtures/research and the existing stash remain intact outside it. A full recovery backup and FTP readback were verified before the checkpoint; no credentials were included.
- **Private build completed:** `dist/beta-20260925T022735Z/LRBridge-0.6.0-beta-win-x64-portable.zip`, Windows x64 v0.6.0, Electron 43.1.1. SHA-256: `4d03c5f2485f8b7511bf8fe57a27584c23bd879f7fbeb547cce4967d1c706d52`. Separate writable extraction: `dist/private-test-20260925T022735Z`. The adjacent `build-identification.json` records the checkpoint and exact pending Denoise runtime file hashes. This is an unsigned, unpublished private candidate.
- **Package checks passed:** release staging/route/reference/isolated preset installer checks; cleanup/defaults/dependencies/Lua syntax/isolated staged startup; existing portable build; ZIP manifest and extracted SHA-256 checks (140 files plus manifest, 540 ASAR entries, 40 runtime Lua modules). Current Help, Builder, linked references, both Dust presets/installer and native resources were verified; credentials, private settings and development/checkpoint artifacts are excluded. Fixed package-only reference gaps and reconciled the recorded compatibility wording; no runtime behavior was changed in this build turn.
- **Extracted checks passed:** existing packaged Electron Node smoke (two start/stop cycles, metadata, empty queue and settings preservation), and the extracted controller handler serving exact current Help/Builder/reference bytes on disposable loopback ports. Chromium checks at 1280/390/320px verified pages, local links/anchors, no horizontal overflow and 406 SDK / 14 WIN UI cards. GUI lifecycle was stubbed for page checks; native helpers and Lightroom were never invoked. No desktop GUI/tray, physical Android, clean-machine or live Lightroom result is claimed. Reused earlier feature evidence instead of repeating the full suite.
- Preserve the accepted searchable SDK/WIN UI cards, executable requests/PowerShell scripts, shared address and Step controls, ordinary sticky toolbar and amber Jump menu. The scrolling/docking and tab-focus regressions are corrected. The final introduction and Base URL helper wording are accepted.
- Reuse recorded isolated Builder command/PowerShell, classification, browser, wheel/touch scrolling and first-click tab evidence. Latest content checks passed at 1280/390/320px. These were synthetic/browser checks, not live Lightroom or physical Android tests. Reuse the accepted startup/Contrast and improved Reset-feedback baseline.
- Checkpoint accepted Builder, its references/tests and release-preparation documentation only. Preserve pending Denoise Reset implementation/tests and unrelated settings/research work outside the checkpoint. The private package includes the current Denoise Reset candidate for the user's actual Lightroom test; it is not accepted merely by inclusion.
- Required remaining manual acceptance: extracted plug-in loading; fresh Dust preset installation/discovery and Apply/Reset; Denoise Reset in Lightroom; copied Builder requests through PowerShell and Companion; clean Windows install/upgrade, native helpers, reconnection and desktop quit/tray; native Quick Copy/Paste and completed/multi-photo Export. Preserve the other bounded limitations in `docs/RELEASE_REVIEW.md`, including the unresolved monitor-move stall and residual feedback delay.
- The tested beta baseline is Windows x64 / Lightroom Classic 15.4.1. SDK 15.3 is metadata, not a verified application minimum; Dust On also requires photo ProcessVersion 15.4. Only focused build/package gates and extracted-package checks are required now; do not repeat unchanged feature suites.

## Help accepted; scoped local checkpoint (2026-09-24)

- **Help wording and presentation are accepted.** This entry supersedes earlier Help placement requirements and earlier statements that Help is awaiting acceptance. Preserve the approved section order, yellow headings/dividers/content boxes, compact plug-in setup, Known issues wording and final Ko-fi support section. Dust limitations sit between Selected Add/Subtract and Visualize Range; the setup instructions remain at `#dust-setup`. Companion is optional; this release controls Lightroom Classic on Windows, with browser access from phones/tablets on the local network.
- **Checkpoint scope:** accepted Help, its focused text/link/layout checks, the detailed Dust setup clarification, the static Dust prerequisite note and final Crop & Straighten formatting. The Dust note stays yellow/italic with only Apply/Reset white, bold and upright; its underlined Help link opens `/help#dust-setup` in a new tab. Crop's note bolds only Auto Straighten, Constrain to Image and Tool Overlay. These presentation changes preserve wording, control availability, status messages and runtime command behavior.
- **Verification:** this final turn ran only a focused Crop markup/syntax check and checkpoint diff review. Earlier focused Help/link/layout checks passed at 1280/390/320px; the Dust note's isolated rendered-style check passed at desktop/narrow CSS widths. Prior mocked Dust controller checks passed. These are automated source/browser results, not packaged-app or new real Lightroom acceptance. Do not repeat the accepted startup restart/Contrast test or the accepted improved Reset-feedback tests.
- **Denoise Reset remains uncommitted and awaits actual Lightroom validation.** It uses the SDK-documented default Amount 50 through the existing Amount-only command, keeps Denoise on, waits for Lightroom feedback and preserves Raw Details/Super Resolution. Automated Enhance/model/mock-browser checks passed earlier; no real Denoise Reset test is claimed. Preserve this work; do not substitute toggling Denoise off or infer a default from a screenshot.
- **Dust dependency:** Apply on uses the installed LRBridge Dust On preset; Apply off/main Reset use Dust Off. Close, Size, Visualize Spots and Threshold do not require the presets. App/plug-in startup does not install them, and the runtime resolves Lightroom's preset inventory rather than the package copies. The development machine already had the exact presets during the September 16 capture; the precise save/import action is unproven. Isolated installer and missing-preset checks passed without changing working presets. Actual fresh-machine/package discovery and operation remain unverified. Dust's implementation is gated to Lightroom 15.4.1, with photo ProcessVersion 15.4 additionally required for Apply on; SDK 15.3 metadata is not a verified overall minimum. Reconcile broader compatibility claims before release.
- **Preserved outside this scoped checkpoint:** unfinished HTTP Builder/reference/inventory work (`app/companion-cheatsheet.html`, `server/http-operations.json`, `docs/HTTP_OPERATIONS.md`, `docs/HTTP_WORKFLOWS.md`, `tools/generate-http-reference.js`, Builder tests and the Builder-only portion of `tests/release-docs-browser.js`); Denoise implementation/tests and the Denoise portion of `app/controller.html`; People/lifecycle fixture and release-check/fixture updates; `docs/RELEASE_CLEANUP.md` and `docs/RELEASE_REVIEW.md`; local `.gitignore`, `AGENTS.md`, `config/settings.txt`, research/probe files and the existing stash. All remain intact. The inventory has already been regenerated in the working tree; the older stale-inventory failure is historical, not a fresh result. Review current source and rerun only relevant Builder checks next.
- **Next: finish HTTP Builder.** Preserve Help and accepted runtime fixes. After Builder, prepare a **private test package** and complete outstanding essential release checks, including fresh Dust setup, actual Denoise Reset behavior and compatibility claims. Evaluate other recorded native/clean-install limitations only as release blockers; do not expand feature scope or resume unrelated investigations. Packaging and live Dust testing remain deferred until Builder is finished. No package, push or publication tonight. **Stop after saving this checkpoint; remaining work is limited to release blockers.**

## Release preparation resumed — scoped startup fix committed (2026-09-22)

- Saved the accepted missing-`getenv` correction as local commit **`1b63969`**, on top of `e55f64c`: exactly three Lua guards, four regression-test files and the startup/functional-check handoff. Private settings, unrelated changes and the stash are preserved. The user authorized this separate fix commit only; later fixture/report work remains uncommitted. No push, package build or publication.
- Resolved the broader People browser failure in the fixture: `/api/people/state` was absent and produced HTTP 500. Added unavailable-state feedback with assertions that all three People actions stay disabled on each Tools remount and no action is sent. The isolated **27-render seven-tab lifecycle passes**, retaining strict request/response/error checks. No application behavior change.
- The strengthened distribution staging check passes for current corrected Lua in both plug-in copies, both required native helpers, exact manifest-verified Dust presets and installer mappings, clean defaults and exclusion of private/development artifacts. Isolated staged-server startup uses no SelectedPrototype or diagnostic server. It is not a packaged Electron or clean-machine result.
- Actual remaining automated failure: **`node tools/generate-http-reference.js --check` fails because `server/http-operations.json` needs regeneration.** Leave generation and coverage-fixture alignment for the final Help/HTTP Builder phase, then run final release gates. Historical 58/58 release checks from 2026-09-18 are not a current full-suite result. See [updated readiness and ordered remaining work](docs/RELEASE_CLEANUP.md).
- Reuse the accepted full Lightroom restart and real Contrast **0 → 1** check; no repeat, restart or performance investigation. Reset retains improved feedback with residual delay; the intermittent monitor-move stall remains unresolved. Final Help must start with the recorded Known issues and limitations, without discouraging ordinary slider dragging or quick changes to different controls.

## Cleanup startup regression — fresh startup and functional check verified (2026-09-22)

- **Release preparation resumed after verified recovery.** The user authorizes a separate local fix commit containing only this correction, its regressions and relevant handoff updates. Reuse the completed full Lightroom restart and Contrast check; do not repeat them. Resolve the People-state browser fixture failure and verify distribution contents, keeping Help/HTTP Builder for the final content phase. No push, package build or publication.
- The post-cleanup startup check had failed: both SDK polling supervisors repeatedly failed while loading `PollingTrace.lua`, with `attempt to call field 'getenv' (a nil value)`. Lightroom's real Lua environment omits `os.getenv`; the cleanup test masked this by providing a stub. Server context had no heartbeat or photo, no slider values, and one queued edit had never been dequeued. Native helper timeout reports did not establish the cause of this SDK startup failure.
- Corrected only the optional diagnostic gates in `PollingTrace.lua`, `Dust.lua` and source-only `CaptureProfile.lua`: absent or failing environment lookup leaves diagnostics disabled. The disabled dot-call wrapper is unchanged; regression checks verify nil/trailing-nil arguments and returns, no returns, original error identity and coroutine yielding/resumption. Startup/lifecycle, command execution, Reset feedback, Profile, Lens Blur, Dust and Selected behavior remain intact. **Do not revert `e55f64c` or reset to its parent.** Comparison uses the exact `release-cleanup-before-20260922-040419/payload/project` backup.
- The existing supervisors picked up the correction automatically: real SDK heartbeats and slider readbacks resumed, with 96 cached values and the existing queued Contrast command processed. No commands were submitted by the agent. The corrected missing-`getenv` test fails on the cleanup version and passes on the correction; 25 production-Lua polling lifecycle scenarios, 96 Dust scenarios and isolated staging/startup checks pass with the function absent. A targeted LRBridge plug-in reload was requested once under AGENTS.md; the user instead restarted Lightroom completely, followed by the fresh-session verification below.
- Help, HTTP Builder and packaging remain paused. Reset remains improved with residual delay; the intermittent monitor-move scheduling stall remains unresolved. Detailed live evidence and the fresh verified pre-correction recovery backup belong in the ignored local handoff.
- **New-session verification:** the user restarted Lightroom completely instead of performing the targeted plug-in reload. The new process started at 04:40:53; both polling loops started at 04:41:04 without missing-`getenv` or loop-failure errors. Four live samples showed advancing SDK heartbeats (65–582 ms old), active Develop/current-photo feedback and an empty command queue. All 96 cached slider values were received after the new session began, independently of the previous automatic recovery. Developer diagnostics remain disabled.
- **Functional check completed:** the user reported done after the requested Contrast **0 → 1** change. The new session logged Contrast commands, and three subsequent live samples returned authoritative **Contrast 1** with advancing SDK feedback IDs/timestamps, advancing heartbeats, and an empty queue. No current-session missing-`getenv`, loop or command-execution errors were found. This verifies recovery of the cleanup startup failure; it does not establish a monitor-move fix or eliminate residual feedback latency. No further restart/reload or repeat test is requested.

## Release cleanup and local development checkpoint (2026-09-22)

- The user authorized release cleanup and a reviewed **local Git checkpoint**, preserving the current improvements. This supersedes earlier no-checkpoint instructions for the relevant completed work. No push, publication, package build or release-ready declaration is authorized. Help and HTTP Builder are reserved for the final phase. Do not resume a performance investigation as part of cleanup.
- Removed the development-only Profile/Lens Blur SDK capture entry from the normal Lightroom menu and the Reset tracing loader from the normal controller. Polling captures, observer-comparison overrides and detailed Dust traces now require explicit `LRBRIDGE_DEVELOPER_DIAGNOSTICS=1`; without it, polling diagnostics perform no capture-file I/O. Normal SDK polling startup and working control dependencies remain intact. Source-only diagnostic tools and prior captures are preserved outside distribution.
- Distribution now uses a reviewed app/server file allowlist plus the Lightroom runtime dependency graph. Both native helper files, including the production Selected label-identification dependency, are included. Prototypes, fixtures, logs, backups, private config and saved bindings are excluded. An isolated staging/startup check uses no SelectedPrototype or diagnostic server. No release package was built. See [cleanup scope and remaining checks](docs/RELEASE_CLEANUP.md).
- Preserve Reset as **improved, with remaining feedback delay** and preserve Profile, Lens Blur, Dust, Healing and Selected fixes. **The intermittent monitor-move stall remains unresolved.** Temporary captures are stopped; remaining normal LRBridge processes are not terminated. Private settings, protected references, unrelated research and the existing stash stay outside the checkpoint.
- To load the cleanup later: one LRBridge restart, **one explicit LRBridge plug-in reload in Plug-in Manager**, and one controller refresh. The changed Lua/menu needs that reload before manual validation; no full Lightroom restart is requested. Check absent capture menu/banner and fresh SDK/current-photo feedback. Native startup/menu and clean-machine validation are still pending, separate from the authorized development checkpoint.
- Focused cleanup checks pass: sanitized staging and isolated startup, default-off/developer-on tracing, 25 polling lifecycle scenarios, Profile, Lens Blur, 96 Dust scenarios, 33 Selected production-Lua/HTTP cases plus 22 refinement cases, and isolated Reset/Selected browser checks. Lua/PowerShell syntax and diff checks pass. A stale capture-menu expectation was corrected to match the intentional removal. The broader known People-state lifecycle failure was not re-investigated; final Help/HTTP inventory checks and clean-machine validation remain release gates.

### Final Help requirements — record now, implement last

Help must begin with a short **Known issues and limitations** section:

- Feedback can arrive after Lightroom has already applied an action.
- Moving Lightroom between monitors can temporarily interrupt control. Manually switching Library → Develop has restored operation in testing; the underlying issue remains unresolved.
- Selected Add/Subtract and Visualize Range do not display their active mode in LRBridge.
- Lens profile selection must be done in Lightroom Classic.

Use clear action-button guidance: **“After clicking an action button, allow Lightroom time to respond before clicking it again. Repeated clicks can queue additional actions.”** Do not imply that normal slider dragging or adjusting different controls quickly is unsupported. Help/HTTP Builder wording and inventory regeneration have intentionally not been done in this cleanup.

## Slider Reset feedback — user-confirmed improvement, residual latency remains (2026-09-22)

- After the latest rapid Texture → Clarity → Dehaze Reset check, the user reports: **"this feels good.. not perfect, but the best we got so far"**. Preserve this as the current improved baseline, not a claim that all Reset delay is eliminated. Actual click-to-display times were **480 / 929 / 830 ms**; browser response-to-display was **1 / 2 / 3 ms**. All three Reset commands executed once in order and all values came from Lightroom. Texture first updated through an already-running broad read; Clarity and Dehaze through targeted reads. This run did not reproduce the early-read retry branch; focused regression coverage does.
- The shared Reset path requests small, bounded readbacks promptly; same-photo pending demand can follow Develop revisions until SDK dispatch, then retains its full fixed context. Reset snapshot responses can wait briefly for immediate SDK-result delivery. A read returning the pre-reset value keeps bounded feedback demand alive rather than falling back to normal polling. Ordinary/compound edit submissions, authoritative feedback, context/stale-response/gesture safeguards and the separate Profile Amount path are preserved. Existing four-attempt/four-second demand bounds and at most two active targeted batches remain.
- Focused queue/delivery/proxy/browser and adjacent slider checks pass, including reads overtaking delayed Reset execution, no-op bounds, revision changes and stale results. The broader seven-tab browser fixture has a separately reproduced pre-existing People-state failure; no full-suite pass is claimed. No Lua change or Lightroom reload was needed for this Reset work. Capture is stopped; Lightroom and the plug-in remain running. No further test or restart is needed now. Source remains uncommitted; no staging/commit/push is authorized by this feedback. Detailed evidence and recovery backups are in the ignored local handoff.
- After restarting both Lightroom and LRBridge, the user reports that monitor moves currently work in their testing. This is a current observation, **not conclusive resolution of the intermittent monitor issue**.
- Preserve the feedback backlog correction and all existing Profile, Lens Blur, Dust and Selected fixes. **The underlying Lightroom scheduling stall remains unresolved.** Help, Builder and packaging remain paused.

## Feedback backlog correction — prompt live feedback confirmed (2026-09-22)

- Server-only correction bounds/coalesces queued feedback reads, expires unrenewed demand, removes invalid-context snapshots and rejects obsolete replies. Treatment/Color Grading snapshot eviction now removes queued work too. Obsolete `clipboard.query`/`export.query` reads are pruned without discarding edits or changing action ordering/one-use claims. All 20 focused checks pass, including the simulated nine-minute pause/resume regression and existing Profile, Lens Blur, Dust and Selected coverage.
- After the user's LRBridge restart, the updated server was verified live. The user confirmed prompt Lightroom and controller response after one monitor move and an Exposure gesture. The move window contained command/feedback interpoll gaps of **1.565/1.625 seconds**; both existing loops returned from sleep without a module switch. The final Exposure update was dequeued in **279 ms** and reached the authoritative server cache in **685 ms** (**833 ms** from the gesture's first update). Exact browser receipt time was not instrumented; visible promptness is the user's confirmation.
- The first Exposure readback after polling resumed took **5.505 seconds**, comprising **4.904 seconds before the read request arrived** and **601 ms from request to cached feedback**. Only one Treatment read preceded it; no stale-read backlog was dispatched. The reason for the controller request delay was not established. This run did **not** reproduce a sustained SDK pause or large backlog; long-pause coverage remains simulated. **The underlying Lightroom scheduling stall remains unresolved.** No automatic module switching, simulated input, plug-in reload or further app restart occurred. Capture is stopped; source remains uncommitted, Help/Builder/packaging remain paused. Detailed evidence is in the ignored local handoff.

## Healing after a monitor move — spontaneous recovery confirmed, cause unresolved (2026-09-21)

- The controlled trace captured both SDK polling loops paused inside their normal `LrTasks.sleep(0.1)` calls for roughly seven seconds. Earlier HTTP/SDK work had completed; the server and native Selected reads remained responsive.
- **The user confirms they did not touch the computer during the recorded pause or recovery.** Feedback resumed without a click, brush stroke or other user intervention. Later, after submitting the log for review, they manually tested Healing and confirmed it worked normally again.
- This verifies spontaneous recovery and subsequent Healing usability in this run. **The cause of this pause and the earlier longer freezes remains unresolved; this is not a complete fix and overall acceptance remains failed.** Do not infer that a photo click caused or was required for this recovery.
- Scoped diagnostics and detailed evidence remain in the ignored local handoff and capture files. No behavioral fix, automatic input, command replay or OCR/coordinate change was made. Preserve the existing production fixes; Help, HTTP Builder and packaging remain paused.

## Remove → Selected Add/Subtract activation manually verified (2026-09-20)

- The user directly observed both temporary prototype web buttons activate the corresponding native **Remove → Selected** Add/Subtract controls in Lightroom. **Native button activation is manually verified.** Brushing behavior and automated active-mode readback remain separate, unverified items.
- The current protocol-4 prototype logs correlate 22 requests (11 Add, 11 Subtract) with fresh SDK guards, one native dispatch per request and requested settlement in 145–441 ms. Earlier seven real read-only validations and a 90-second browser/native readiness observation passed. Full operation IDs, captures and timings remain in the ignored local handoff/prototype evidence.
- Continue with command-only Add/Subtract actions in the normal controller, preserving the existing action queue, SDK/photo/context validation, separate read-only observer, Selected Size/Cancel/Remove, Dust, Profile and Lens Blur fixes. No active-mode highlight or mode-readback claim. The temporary prototype remains working and preserved.
- **2026-09-21 manual normal-controller test: Subtract works; Add acceptance FAILED.** Automatic label identification removes saved session bindings, but the current Subtract-selected appearance gave Add only one OCR match. An added inverted 3x variant fixes that captured/live identification failure while retaining the original Subtract variants and two-match requirement. Focused diagnostics now record admission, OCR targets, SDK guard, both native posts and settlement. Current-session read-only checks pass; actual Subtract-to-Add switching still requires user confirmation. Keep Lightroom open; the pending short retest requires only LRBridge app reload plus browser refresh. See `docs/REMOVE_SELECTED.md` and the latest local handoff. Help, HTTP Builder and packaging remain paused; People Cancel remains separate.

## Current source work — Lens Blur Apply acceptance FAILED (2026-09-19)

- Work in `D:\Projects\LRBridge`; preserve the failing `D:\Projects\lrbridge_exe` package and all existing changes. Help, HTTP Builder and packaging remain paused. Historical release-preparation instructions below are superseded by this scope.
- Preserve both working Profile fixes: exact Look Version 18.4 compatibility and native inventory discovery when Profile is offscreen. Preserve current Healing/checkbox/Color Mixer corrections, Lens Corrections note, Point Color toggle, and Apply waiting guidance.
- **Latest manual acceptance FAILED with the latest backend loaded.** Switching photos usually leaves Apply Unknown. Clicking Apply successfully enables Lens Blur, then feedback works until the next photo switch. Do not activate Apply to discover status.
- User captured: `Lens Blur native state queue wait expired`, `waitMs: 3000`, `activeOperation: 'readProfileSnapshot'`, `queueDepth: 0`. Profile work blocks the queued Lens Blur read during normal use. The earlier 20-request burst improvement did not validate this workflow.
- Normal-cadence reproduction confirmed the cause: Profile's label/two-snapshot context-refresh chain, plus controller Profile polls, repeatedly overtook a queued Lens Blur read and exhausted its three-second queue wait. Individual real reads took roughly 0.6–1.1 seconds; the chain caused the expiry.
- **Unaccepted source correction prepared:** Profile discovery and Lens Blur state reads now retain arrival order; full-state coalescing and editing-command priority remain. The identical normal-cadence trace changed from two expiries to zero, with confirmed native Off and valid Profile inventory. Automated slow-Profile/On-Off/context tests pass. These use simulated photo contexts; actual Lightroom selection was unchanged. Evidence: `local-checkpoints/lens-apply-profile-contention-2026-09-19T03-55-20-168Z/`.
- Next session: load the changed source backend when the user resumes, then manually switch between existing On/Off photos and verify status without clicking Apply. No Lua change or plug-in reload is required. Keep acceptance **failed** until this manual sequence passes; automated evidence does not replace it.
- User stopped testing for the night. Do not request more manual testing/restarts tonight. Preserve reproduction, captures and detailed findings in `CODEX_HANDOFF.local.md`; no checkpoint/commit is authorized.

## Windows v0.6 beta release preparation (2026-09-18)

The user authorized implementation, a **local development checkpoint** and verified recovery backup before final native acceptance. Parent checkpoint `3d53766f7d6443971b89bcb334cc6b61344f211f` and earlier `2c7e61e` / `127fe4c` are preserved. No push, merge, tag or publication is authorized.

- **Scope frozen:** keep the working Lens Blur and Profile Windows helper paths unchanged. Windows automation is an explicitly accepted dependency for this Windows beta, superseding earlier blanket SDK-only/scope-defect proposals. No new automation was added. Lens Blur **+ New Refinement**, named Export presets, macOS packaging and extra MIDI2LR parity are deferred. Accepted layout, all 71 favorites, Selection ordering and **Quick Copy Settings** are retained.
- **Completed:** current Help/README/references; precise active-photo/last-native-categories Quick Copy explanation; 199-route generated HTTP inventory with grouped Builder search and explicit multi-step gaps; removal of stale-context/end-only examples; readable desktop/phone Help and Builder. Existing command/selection/gesture/queue/AI safeguards are unchanged. Protected generated references were explicitly authorized for this pass; the pre-existing stash was not applied or altered.
- **Verification:** final `npm run test:release` passed **58/58** isolated checks, including all `npm test` commands and production feature/package gates. Fengari 0.1.5 is now a locked dev dependency. Favorites, shared history, Copy/Paste, Export, Red Eye and Help/Builder browser fixtures passed; new Help/Builder rendered at 1280 and 390 device widths, and Red Eye at 1280/768/390/320. Current route/selection/preset/lifecycle/scroll/focus assertions replaced stale assumptions without dropping safeguards. Production npm audit is zero after updating existing transitive `qs` to 6.16.0; focused HTTP checks passed afterward. No automated run touched Lightroom photos, native clipboard or exports.
- **Candidate:** `dist/beta-20260918T014736Z/LRBridge-0.6.0-beta-win-x64-portable.zip`, SHA-256 `4b2d643c4e29d54805c6ece84d4e1e99da72635106f7a28a491dc8b8034c86c8`. Clean explicit staging; 136 files plus independently verified ZIP manifest, 538 ASAR entries, 39 required Lua modules, exact native Dust presets and a hash-checking installer that refuses differing installed files. XMP bytes are protected from Git line-ending conversion. Private settings/credentials/backups/research/captures and dev dependencies are excluded. Color Grading metadata is present in ASAR and the plug-in. Plug-in VERSION is 0.6; SDK minimum is 15.3; native baseline remains Lightroom 15.4.1, with Dust's existing exact version/ProcessVersion gate retained.
- **Packaged checks:** exact candidate Electron Node runtime loaded modules/metadata, served read-only HTTP, polled an empty queue, stopped/restarted listeners and preserved settings using ephemeral loopback ports with no Windows helper. This is not a full native desktop/Lightroom clean-install acceptance. Candidate is **unsigned**, local and unpublished. Normal desktop helper startup and real Lightroom/preset discovery still need the user check below.
- **Remaining manual checks:** native Quick Copy/Paste is **not accepted**. Guide disposable-photo tests one step at a time: native Lightroom Copy → web Paste without preceding web Copy; Quick Copy with deliberately chosen harmless categories; one destination and a small complete selection, including changing selected members while the active photo stays the same; authoritative history/results. AI/mask preservation is a separate limited-evidence case. Check clean install/upgrade, preset discovery, normal desktop/tray start/quit, helper controls, polling/reconnection and settings/favorites preservation at the same browser origin. Review the candidate Help/Builder. Export evidence stays exactly the full dialog, Previous destination chooser and one selected-photo count; no completed file or multi-photo export is claimed.
- **Loading:** quit the existing LRBridge instance, extract the candidate into a new writable folder, preserve/copy old private config as described in `docs/WINDOWS_BETA.md`, install the bundled Dust presets while Lightroom is closed, then start the new LRBridge and add/repoint the included plug-in in Lightroom. Restart Lightroom once to load its presets/current plug-in and refresh the controller with Ctrl+R. No additional reload loops are needed.
- **Known limits retained:** People processing/Cancel; arbitrary-photo Dust redetection and populated-AI preservation; copied-mask/AI completion; actual last-component deletion, broad Red Eye reset preservation and native fault cases. Intermittent Healing/Point Color/Blue-curve reports remain unreproduced. Cycle Loupe Info stays excluded. A separate exploratory legacy `tests/dust-paste.js` research-workflow run exceeded four minutes; it is outside the shipping runtime gate, whose production Dust and native clipboard tests pass. Earlier one-photo Dust evidence is not general Copy/Paste acceptance.
- **Preservation/recovery:** `.gitignore`, `AGENTS.md`, private settings/preset configuration, nine unrelated research/probes, ignored evidence and stash `76bd3118f786b886a30dd81ce3b591f4e14f49fe` remain outside this checkpoint. Pre-edit full FTP backup was uploaded/downloaded and all 306 manifest entries verified using unchanged configuration. After checkpointing, create the fresh full recovery archive/Git bundle with current private config/research/required presets, exclude credentials, upload to the unchanged `/files/LRBridge/` destination and independently download/check hashes and manifest. Sanitized verification records belong in the ignored local handoff.

Public reference: [completion review and remaining acceptance](docs/RELEASE_REVIEW.md), [installation/upgrade](docs/WINDOWS_BETA.md), [HTTP workflows and Builder gaps](docs/HTTP_WORKFLOWS.md). Detailed automated evidence is under ignored `local-checkpoints/beta-preparation-before-20260918-025121/` and `local-checkpoints/release-checks-2026-09-18T01-43-47-537Z/`. Historical entries below retain their original scope/evidence; this section supersedes their obsolete roadmap and SDK-only release wording.

## Copy/Paste and favorites development checkpoint (2026-09-18)

The user explicitly authorized a **development checkpoint** of the current implementation before remaining native Copy/Paste checks. Parent: `2c7e61ed511a92289976620520f55829adc7a669`, the accepted native Export button checkpoint, on `feature/v0.6-more-sdk-and-web-controller`. This is not a release or a claim of native Copy/Paste acceptance. No push, merge, tag, release or version bump.

- **Included:** SDK-native Quick Copy Settings / Paste Settings; complete-selection request ownership and once-only dispatch; a compact persistent favorites bar with all 71 existing History/Selection/Application choices, grouped search, browser-local saved order and Undo/Redo defaults; Navigate first and the entire Copy/Paste section last after Export; brief action-named sent notices outside the bar, persistent errors and original uncertainty review. The final label is **Quick Copy Settings**. Help: “Copies settings from the active photo without opening a dialog. Uses the categories last selected in Lightroom’s Copy Settings dialog.” Existing `clipboard.copy` IDs/preferences and Paste Settings behavior are preserved.
- **SDK behavior:** Copy calls the active photo's `copySettings()` once, using Lightroom's last chosen categories; it does not open the native category chooser. Paste uses the captured complete selection, one `photo:pasteSettings(true)` or one `catalog:pasteSettings(capturedPhotos, true)` call. Catalog/photo/full selection are revalidated, including inside Paste's write gate. No per-photo mutation loop, selection rewrite, UI automation or automatic retry. SDK clipboard contents/validity and detailed AI preservation/completion are not observable. Batch true means at least one photo; AI readback reports pending status only. Photo-level scope applies even from Masking.
- **Actual user evidence:** the user likes the compact favorites design, its expanded chooser and the Selection ordering. Native Copy/Paste has **not been confirmed by the user**. Final wording/feedback has automated evidence below, not a new native acceptance claim. Export retains only its previously accepted observations: full Export dialog, Previous destination chooser and one selected-photo count; no completed file export or multi-photo test is claimed.
- **Focused verification:** 61 Copy/Paste and 42 Export HTTP/queue/production-Lua mock-SDK scenarios, including stale full selection, duplicate ownership, uncertainty/expiry/late results, AI wording and queue-order checks; isolated favorites Chromium fixtures with the final Quick Copy label at desktop/phone widths, all 71 choices, persistence, shared availability, duplicate guards, focus/scroll stability, four-second status expiry, explicit error dismissal and original required review; shared-history, 65 tab-action descriptors, proxy and queue diagnostics/resilience checks; syntax and scoped diff review. Mock-SDK checks use the existing external Fengari runtime. No automated run touches production photos/clipboard/exports. No full-suite pass is claimed; retained unrelated failing checks remain listed below.
- **Outstanding manual checks:** confirm the current Copy/Paste plug-in code is loaded, then guide disposable-photo testing one step at a time: native-Lightroom Copy to web Paste without web Copy; Quick Copy using deliberately chosen harmless categories; single- and small multi-photo destination scope, including a selection change with the active photo unchanged; authoritative history/feedback and uncertainty handling. Copied masks, AI updates and preservation alongside existing populated AI/manual edits require separate controlled evidence. Ordinary paste acceptance must not imply comprehensive AI acceptance. Do not trigger these actions autonomously. Checkpointing itself needs no restart; browser-only wording requires Ctrl+R, and the earlier native Copy/Paste addition needs its one initial plug-in reload only if not already loaded.
- **Preservation/recovery:** personal settings, `.gitignore`/`AGENTS.md` changes, nine research/probe files, ignored local evidence and the stash are excluded from the focused commit. Protected cheat sheets and native/backup Dust presets are retained. Create a fresh full recovery archive of this checkpoint plus current private configuration/research/presets, upload using the unchanged `/files/LRBridge/` configuration, and independently verify ZIP, checksum sidecar and manifest. Never include credentials. Sanitized hash/readback evidence belongs in the ignored local handoff.

Next: inspection-only comparison with current official MIDI2LR source/documentation (record its revision), reconciliation of issue notes, Help/HTTP Builder coverage and safe request examples, then packaging/release readiness. Do not implement MIDI2LR differences automatically. v0.6 remains SDK-only with future macOS portability; native Copy chooser/shortcut automation and custom named Export presets remain outside scope. Feature behavior stays unchanged during this review.

Details: [Copy/Paste contract and limits](docs/COPY_PASTE_SETTINGS.md), [favorites, feedback and layout](docs/CONTROLLER_FAVORITES.md). Historical checkpoints below retain their original evidence and limitations; completed toolbar/Copy/Paste implementation supersedes their older “assess next” roadmap entries.

## Native Export local checkpoint (2026-09-17)

The user accepted the two native Export buttons after restarting LRBridge and Lightroom and authorized a focused local checkpoint on `feature/v0.6-more-sdk-and-web-controller`. Parent: `127fe4c9f30d0f607d32cd207dcd31f236da1f6e`, the verified pushed polling checkpoint. This supersedes older statements that native Export is deferred. No push, tag, release or version bump. No further restart, plug-in reload or controller refresh is required for checkpointing.

- **Exact native observations:** **Export…** opens Lightroom's full Export dialog; **Export with Previous** opens Lightroom's destination-folder chooser; the web controller correctly shows **one selected photo**. This acceptance establishes button behavior only. Completed file export, dialog cancellation, multi-photo export and comprehensive native safeguard/regression testing are **not claimed**. The agent invoked no production export.
- **Implemented:** compact Export section on Selection; validated `/export/state` and `/export/action` routes for `export.dialog` and `export.previous`. Portable SDK calls `photo:openExportDialog()` / `photo:openExportWithPreviousDialog()` run once per request on the active photo, without looping over or rewriting selection. Previous explains that it reuses Lightroom's last export settings and may start immediately; the observed folder chooser is not a promise of prompts with other settings. Feedback reports requested, never completed. The older capability audit's inaccurate Previous limitation is corrected. Custom named-export-preset support remains deferred.
- **Safeguards:** retained catalog object/path, active UUID and exact complete selection membership are revalidated immediately before invocation after a one-use claim. Same-active-photo selection changes are detected. Existing context/Develop counters, timestamps, epoch, queue ownership and stale-response checks remain. Consumed request IDs/claims prevent duplicate dispatch; uncertain results require explicit review and never retry automatically. Export actions preserve edit ordering across queue coalescing. Read-only selection queries use bounded demand-driven FIFO work; existing polling loops/intervals and accepted editing features are unchanged.
- **Focused checks reused:** 42 HTTP/queue/production-Lua mock-SDK scenarios, state expiry/uncertainty/late-result/request-ID checks and four queue-order cases; isolated Export browser checks including warning, duplicate clicks, stale state, no retries, focus, inactive polling and 44px targets at 1280/768/390/320 widths. Existing Red Eye browser, shared history/proxy, queue, polling/lifecycle, Tone Curve and input/transport checks passed during implementation, with JavaScript/JSON/SDK Lua syntax checks. Checkpoint review changes documentation only. No broad rerun or full-suite pass is claimed; unrelated failures below remain outside this change.
- **Preservation and recovery:** personal settings, unrelated research/probes, `.gitignore`/`AGENTS.md` backup-rule changes, protected cheat sheets, ignored evidence, the stash and native/backup Dust presets remain outside the commit. A full pre-edit FTP backup was uploaded and download/checksum verified using the existing configuration. The authorized fresh backup follows this commit and includes the checkpoint Git bundle, current private configuration/research and required presets; verification details belong in the ignored local handoff. Credentials are excluded. Do not change server/network settings.

Details: [Export controls and acceptance boundary](docs/EXPORT_CONTROLS.md). Existing remaining roadmap and limits:

- Improve the shared Undo/Redo toolbar appearance/layout and assess **Copy Settings / Paste Settings**. Custom named Export presets remain deferred.
- Resolve or retain documented SDK/native gaps: **People Cancel** and successful Adobe processing; **Dust** arbitrary-photo redetection and preservation with populated AI edits; Red Eye selected-eye controls/readback and broader reset preservation. Masking brush controls and native Reset Sliders Automatically / Use Fine Adjustment remain unsupported/deferred; actual last-component deletion behavior still lacks native confirmation. Optional shortcut support is post-v0.6 only.
- Retain the intermittent **Point Color Visualize Range** availability issue and historical unreproduced **Blue Tone Curve** issue. Existing unrelated test failures remain listed in the earlier checkpoints; do not widen this Export checkpoint to repair them.

## Polling lifecycle local checkpoint (2026-09-17)

Focused follow-up to local Red Eye checkpoint `7d5851471fe4fcf5dd607038e140e3936ccd1cb8`, on `feature/v0.6-more-sdk-and-web-controller`. The user authorized a separate local checkpoint and completed the manual Lightroom restart/reload checks. The final native reload confirms orderly supervisor replacement and current feedback; native fault injection and long-running app-exit behavior are not claimed tested. No push, tag, release or version bump. Preserve all accepted editing behavior, personal settings/research files and Dust native/backup presets. Export remains deferred.

- Removed **Start LRBridge Polling** from Library > Plug-in Extras; retained LRBridge Help and automatic command/feedback startup. The old script delegates to the shared startup path only for a cached older menu.
- Added a shared SDK-only supervisor: duplicate ownership is separate from active-loop flags, flags clear on failure/exit, and each runner restarts after a logged failure with a fixed one-second backoff. Normal polling intervals, ordering, feedback and context safeguards remain. Recovery never replays/requeues a dequeued or uncertain photo-editing command.
- Added plug-in/application shutdown hooks. The file sends a stop signal directly for plug-in unload; only application exit invokes the asynchronous completion/progress/cancel callback. Stop consumes no further commands or replays, rejects late responses and invalidates old generations. App shutdown drains actions/read-only Treatment tasks unless its wait is cancelled; plug-in teardown remains host-controlled. Tone Curve/Preset Amount release cached observer ownership when their feedback context ends.
- Loading is complete in the current session: the user performed the initial full Lightroom restart and loaded the final code through Plug-in Manager > LRBridge > Plug-in Author Tools > Reload Plug-in. No further reload, LRBridge/server restart or browser refresh is needed for this checkpoint. A future installation over `7d58514` needs a complete Lightroom quit/reopen once because that older code lacks shutdown hooks.
- Focused checks: 25 production-Lua cooperative mock-SDK lifecycle scenarios plus polling source checks; menu/Dust diagnostics and 21 Dust startup scenarios; polling serialization, queue resilience, server lifecycle, Tone Curve split and Point Curve tests; 53 Red Eye scenarios plus expiry/revision/timeout/late-result checks. Changed Lua/JavaScript syntax and diff checks pass. No native failure injection or broad suite rerun.
- Native result: the final user-triggered Plug-in Manager reload logged shutdown requested, both old supervisors stopped, then exactly one new start each for commands and feedback. A subsequent read found fresh Library context feedback and an empty command queue. This confirms the ordinary reload path; the failure/reconnection/long-action cases remain mock-SDK checks. App-exit waiting is distinct from the SDK's host-controlled plug-in unload.
- Adjacent failures reproduced from checkpoint test versions: `generic-develop-sliders.js` lacks `redEyeController` in a history fixture; `lua-selection-dispatch.js` expects the obsolete two-argument Driver call; `develop-presets.js` rejects existing picker scrollbar-gutter markup. Leave these and previously listed failures for later.

Details and test/native boundaries: [Polling lifecycle](docs/POLLING_LIFECYCLE.md). This supersedes the older handoff's statement that the Library polling menu command remains.

## Red Eye / diagnostic-menu local checkpoint (2026-09-17)

The user **manually tested and accepted all four Red Eye buttons: Open Red Eye, Open Pet Eye, Reset and Close**, and authorized a local checkpoint on `feature/v0.6-more-sdk-and-web-controller`. Parent: Healing checkpoint `57680edffb8a1c70dc494ec82eef2ff63c746c50`. This preserves the accepted Healing, Dust, People and Reflections behavior and keeps v0.6 SDK-only: no Windows UI automation or simulated keystrokes. No push, tag, release or version bump is authorized.

- **Accepted UI:** compact Open Red Eye / Open Pet Eye and Reset Red Eye / Close rows, 44px touch targets, native overall tool status, helper text, existing Undo/Redo, navigation and collapse behavior. `goToEyeCorrection("red_eye" | "pet_eye")` explicitly requests each mode. `getSelectedTool()` confirms overall `redeye` only; mode buttons remain momentary. Guarded Close calls `selectTool("loupe")` only while the intended photo and Red Eye tool still match.
- **Reset limit:** `resetRedeye()` is dispatched once on the bound photo and still reports **Reset requested**. The four-button acceptance does not establish SDK completion readback, exhaustive Pet Eye reset scope or preservation alongside populated Healing, Dust and unrelated edits. No broader native reset-preservation claim follows.
- **Unsupported eye controls:** Pupil Size, Darken and Add Catchlight have **no verified SDK control route**. One bounded native read found stored fields in `RedEyeInfo`, but no selected-eye identity; Remove selection getters reject eye context and all tested generic value getters return nil. Stored correction data is not selected-eye/default readback; neither mode's actual slider ranges is established. No per-eye writes, geometry replay, cosmetic sliders or catchlight checkbox were added. Optional `EnableRedEye` remains deferred. Details: [Red Eye controls](docs/RED_EYE_CONTROLS.md); raw probe evidence remains local.
- **Preserved safeguards:** existing command queue, selected-photo UUID, context/Develop counters, context timestamp, server epoch, semantic revision, single-operation ownership, native execution revalidation, duplicate/stale-result rejection and no automatic retries. Failed or ambiguous feedback retains pending history protection until reconciliation.
- **Menu cleanup:** remove the six temporary Dust registrations and eye-capture registration from normal File > Plug-in Extras. Their diagnostic scripts remain development utilities without normal menu exposure; LRBridge Help, Start LRBridge Polling and plug-in startup remain. Production Dust and its shared helper dependencies are unchanged. Installed **LRBridge Dust On/Off** and the local Healing preset backups were verified against the SHA-256 values in [HEALING_CHECKPOINT.md](docs/HEALING_CHECKPOINT.md); none was modified or removed.
- **Loading:** the four-button implementation is already loaded and accepted. To clear the old diagnostic menu, open **File > Plug-in Manager > LRBridge > Plug-in Author Tools > Reload Plug-in** once, then close the manager and reopen File > Plug-in Extras. No LRBridge/server restart or browser refresh is needed for this menu-only change.
- **Checkpoint checks passed:** 53 Red Eye HTTP/queue/Parser/Commands/mock-SDK scenarios plus revision/expiry/timeout/late-result checks; 74 Dust scenarios plus On timeout; People workflows; 46 Reflections and 177 Healing scenarios. Isolated Red Eye and Dust browser regressions pass, including compact touch layouts and history/stale-response behavior. Menu/startup assertions, eye diagnostics and retained Dust diagnostics (21 startup, 25 observation, 44 preset, 37 paste scenarios), shared history/proxy/queue/polling checks, scoped JavaScript/JSON/inline Controller/SDK Lua syntax and staged diff checks pass. Personal/research/protected files and native/backup preset hashes remain unchanged.
- **Known unrelated failures:** retain the prior Delete All wording, protected Companion `LensBlurAmount`, Crop Angle polling and scrollbar-gutter failures listed below. The full suite is not claimed passing and is not being rerun for this checkpoint.
- **Next task:** Export, left untouched here. Retain the existing People Cancel/processing, Dust redetection/populated-AI preservation and Masking limitations from the Healing checkpoint; eye sliders require new verified SDK targeting evidence before further work.

Personal `config/settings.txt`, the nine unrelated research/probe files, protected cheat sheets, ignored evidence/backup files and the existing stash stay outside this checkpoint. The prior Healing checkpoint and required preset backup remain intact.

## Healing / Distraction Removal local development checkpoint (2026-09-16)

The user **tested and accepted the current Dust web controls, including Apply On/Off, Reset and Close**, following prior Size/visualization/threshold acceptance, and authorized this local checkpoint on feature/v0.6-more-sdk-and-web-controller. This supersedes the pending-acceptance/loading instructions archived in the ignored local handoff. No repeat capture, Lightroom reload, push, release tag or version bump is required or authorized for checkpointing. The parent is 20b3384c21ae114465926f7cfacb755b141741c9 (startup ahead3/behind0, empty index).

- **Included work:** compact Healing / Distraction Removal layout, Selected Repair per-parameter resets, guarded Reflections and People controllers, and Dust controls. Preserve photo UUID/context/Develop revision, queue/gesture/stale-response protections and native feedback ownership. This does not declare every Healing feature complete.
- **People boundary:** native **Cancel remains unresolved**; closing Healing or Return to Healing is not Cancel. The redundant People-only Close Remove Tool action is removed; overall Healing open/close remains. The inventory comparator ignores only regenerated spots[*].CorrectionID and spots[*].CorrectionMasks[*].MaskID, in both snapshots and execution validation. All other target data/count/photo/stale protections remain, with duplicate prevention and no automatic removal retries.
- **People live evidence:** existing pp-71 logs at 2026-09-15 22:54:44 verify SDK removal dispatch. The user reports the same native Lightroom error through web Remove and Lightroom Remove. **Successful Adobe processing remains unverified.** No broader removal-success claim follows from callback/inventory or mock tests.
- **Dust acceptance:** native-authoritative Apply On/Off, shared Size/Visualize Spots/integer threshold, Dust-only Reset and Close work in the user's test. Reset reuses the verified Off deletion; Close requests manual Healing, retains Dust treatment and leaves overall Healing open. SDK subsection-state readback is unavailable, so Close still reports requested with preservation checks, not an authoritative collapsed state. Visual removal is **unassessed**, outside control acceptance.
- **Dust dependencies/limits:** uniquely named native **LRBridge Dust On** and **LRBridge Dust Off**, group **LRBridge TEST**, under %APPDATA%\Adobe\CameraRaw\Settings. MD5 respectively ca1e4c9e0e49724b8fd9167c496026ba and 6222ed7b14ec731f0d114e24d9bea1d4. Tested Lightroom **15.4.1**, build **202606201310-b9f148a4**; On requires existing photo ProcessVersion **15.4**. **Arbitrary-photo redetection and preservation alongside populated AI adjustments are not fully established.** Actual preset application is one-shot, with full preservation/state checks and no clipboard requirement, coordinate reconstruction, automatic retries or rollback.
- **Restoration:** [dependency record](docs/HEALING_CHECKPOINT.md) contains exact names/locations, sizes, MD5/SHA-256 fingerprints and restore instructions. Verified native files are backed up locally in **local-checkpoints/healing-20260916/presets/**; the ignored directory also holds manifest, checkpoint Git bundle and check logs. Git alone does not preserve these XMP dependencies. Keep the local backup with this checkpoint.
- **Checkpoint checks passed:** 74 Dust HTTP/queue/SDK scenarios plus On timeout; People workflow/inventory regressions; 46 Reflections and 177 Healing scenarios; complete isolated Healing/People/Reflections browser run and separate Dust browser run. Diagnostic suites pass (21 startup, 25 button-observation, 44 preset and 37 paste scenarios). History, proxy, generic sliders, polling contract, queue diagnostics/resilience, Lua polling resilience, scoped JS/JSON/inline Controller/SDK Lua syntax and diff checks pass. Only this turn's test adjustment adds the three existing Dust commands to the queue-diagnostics expectations; no production behavior changed after native acceptance.
- **Known failing checks, retained:** full npm test exits1 in masking-phase4-completion.js at the existing **Delete every mask on the selected photo?** wording assertion; it does not run the later suites. Separate contract-baseline.js exits1 because the protected Companion document lacks **LensBlurAmount**. controller-command-tabs.js exits1 at its old **Crop Angle polling** assertion; controller-section-collapse.js exits1 at its existing **scrollbar-gutter** assertion. No broad investigation or protected-document edit. Exact output is retained in the ignored local backup; the full suite is not passing.
- **Preserved outside checkpoint:** config/settings.txt, unrelated Masking research/probes/tests and the historical external Distraction Removal research report remain in the worktree. Protected cheat sheets, ignored logs/local handoff and the existing stash remain intact. The archived pre-checkpoint handoff is also copied into the local backup.

## Healing controls local checkpoint (2026-09-14)

The user reports that the current Healing controls **appear to work in live use** and explicitly authorizes this local checkpoint. This is initial successful feedback, not exhaustive validation of every repair type, race, history operation or preservation case. The earlier accepted Remove slider interaction repair remains the baseline. This checkpoint follows and preserves Masking checkpoint `b22c6c82485f2211c0f2d09d67a5ceafcd496fbb` on `feature/v0.6-more-sdk-and-web-controller`. No push, release, tag or version bump is authorized. This section supersedes the prior uncommitted Healing notes, archived in the ignored local handoff.

- **First task next session:** add individual **Selected Repair Opacity Reset** and **Selected Repair Feather Reset** buttons. They are currently missing. Establish each reset value and its semantics first: use a verified native default/reset contract if one exists, otherwise explicitly agree/document an LRBridge default. The current SDK evidence does not establish selected-repair defaults. Never substitute the whole-photo **Reset Spot Removal** action, or assume the brush Feather default applies. No Reset functionality was added during checkpointing.
- **Completed tool and brush controls:** compact adjacent Open Healing Tool / Close Healing Tool and Reset Spot Removal buttons; Remove | Heal | Clone new-stroke tabs; Size, mode-appropriate brush Feather, Use generative AI, Detect objects, Tool Overlay, Visualize Spots and threshold. Opening explicitly calls `goToRemove("heal_patchmatch", "manualRemove")`; closing uses `selectTool("loupe")`. Native tool/mode/preference readback is authoritative; an open panel does not prove native controls-enabled state. The whole-photo Reset retains its existing scope/request feedback. Brush-only orange LRBridge defaults remain Size 25, Feather 50 and Threshold 50.
- **Completed Selected Repair controls:** Fill (Remove, Heal, Clone, Generative Remove), Opacity, Feather, Refresh and Delete, distinct from preferences for new strokes. Fill uses `setSelectedSpotType(spotType,useGenAI)`: heal_patchmatch/false, heal/false, clone/false, heal_patchmatch/true. Type readback does not confirm completion of generative processing. Refresh reports request-only confirmation; Delete requires fresh inventory proof of original removal and preservation of remaining repairs, following native selection.
- **Verified parameter mappings:** on the same selected Heal repair, native Opacity 50→75 mapped root `Opacity` .50→.75 with Feather .33 unchanged; native Selected Feather 33→60 mapped root `Feather` .33→.60 with Opacity .75 unchanged. Each full, untruncated selected parameter comparison differed only at the requested root field. The documented one-argument `setSelectedSpotParams(spotParams)` receives a fresh complete copy with only that field replaced; strict native confirmation checks other parameters, other repairs and brush preferences. The schema/defaults/partial-update semantics remain undocumented; detailed behavior across all repair types is not claimed exhaustively live-tested.
- **Interaction safeguards:** confirmed/displayed/requested values remain separate; raw SDK fractions are preserved under whole-number percentage presentation. Untouched formatting never writes. One SDK operation runs at a time, with latest targets coalesced per field, accumulated ± input and held-drag/late-ack protection. Photo/module/context/Develop/server epoch/revision/mode/repair guards, explicit original/result repair tokens, native selection revalidation, shared Undo/Redo, caret/focus and page position remain. Unavailable/unstable reads cannot enable cached repair mutations. No fabricated preference history or polling-driven opener/mode/selection restoration.
- **Greyed-out issue:** **intermittent, currently not reproducible; cause and fix unconfirmed**. No further focus trials tonight. The saved focus sequence was confounded by explicit Open/mode commands and did not diagnose the issue. The Feather comparison contained one unstable snapshot during the native edit and then recovered with getters succeeding. Develop module identity is not application-foreground evidence. Preserve diagnostics; make no speculative focus changes.
- **Verification reused:** latest 161 HTTP/queue/Parser/Commands/Lua mock-SDK scenarios and isolated Chromium Remove regression pass. Coverage includes both parameter fields, queued cross-field edits, delayed/out-of-order feedback, multiple polls during held drag, ten ± clicks, reversal, mode/selection changes, unavailable recovery, preservation, shared history and stable geometry at 1280/768/390/320. Supporting shared-history, proxy, queue diagnostics and syntax checks pass. Checkpoint integration checks for generic sliders, normal Develop categorical, polling contract, Lua polling resilience, finite input and queue resilience pass. Known unrelated failures remain separately recorded: Delete All wording in `tests/masking-phase4-completion.js` and protected Companion `LensBlurAmount` coverage in `tests/contract-baseline.js`. No full-suite pass is claimed.
- **Evidence and documentation:** sanitized contracts/findings are in [Healing selected-repair notes](docs/HEALING_SELECTED_REPAIR.md) and [Remove brush preferences / Distraction audit](docs/REMOVE_BRUSH_PREFERENCES.md). The SDK-only diagnostic reader and capture script belong to this checkpoint. Raw captures, exact paths, browser profiles and detailed verification remain in ignored `CODEX_HANDOFF.local.md` sections 63–71 and existing temporary diagnostic directories; do not force-add them.
- **Remaining roadmap:** selected-repair Reset semantics/buttons first; focused manual acceptance of remaining edge cases as needed. Distraction Removal is audit-only: Reflections has documented action/amount/quality/readback support; People has actions and partial feedback; automatic Dust support was not established (`selectTool("dust")` only opens manual Healing). Masking brush controls remain deferred, with no retry of the denied native inspection; optional configured shortcuts remain a post-v0.6 proposal. Retain Point Color Visualize Range availability and the historical unreproduced Blue-curve issue, plus the existing shared-toolbar/Copy-Paste/Export roadmap.

Protected settings and Companion files, unrelated Masking research/scripts/tests, the existing stash, native probe/helper and diagnostic evidence remain outside this scoped checkpoint. Checkpointing changes no production source from the latest passing/live-tested build; **no bridge restart, plug-in reload, browser refresh or Lightroom restart is required tonight**. Start next session with this handoff and a fresh read-only Git check.

## Integrated Masking component-actions checkpoint (2026-09-13)

This explicitly authorized local checkpoint follows `fcdb5e8861e32959e819c1a7eedc3746f89e74dc` on `feature/v0.6-more-sdk-and-web-controller`. It integrates Add/Subtract components, Delete Component, the final button labels and selected-component inversion with their required tests/docs. Git history identifies the checkpoint hash. No push, release or version bump is authorized. This section supersedes the older Add/Subtract next-task statements below.

- **User-tested:** Add/Subtract was reported working in Lightroom. The final **Add | Subtract | Delete Component** row labels were explicitly accepted. Earlier accepted creation, whole-mask deletion/selection, shared history and scrolling behavior remains the baseline. These observations do not establish exhaustive acceptance of every component type or race condition.
- **Implemented, with automated verification:** Add/Subtract reuse the descriptive touch picker and call the documented current-mask SDK methods. Delete Component calls `deleteMaskTool(componentId)` once, requires fresh removal proof and carries the original mask/component IDs through admission and results. It preserves surviving selection or performs bounded next/previous recovery. Last-component outcomes follow Lightroom inventory: parent removed or retained empty, without an additional whole-mask deletion. Live confirmation of the actual last-component outcome remains outstanding.
- **Component inversion:** the persistent selected-component heading follows authoritative inventory type/subtype. `toggleInvertMaskTool(componentId)` is used, never whole-mask inversion. A checkbox requires an authoritative boolean `Inverted`; otherwise the action accurately reports request-only confirmation. Original photo, mask/component, context/Develop revision, queue ownership and stale/duplicate safeguards remain. Inversion and deletion have not been separately reported as exhaustively live-tested.
- **Verification at checkpoint:** 74 Add/Subtract, 56 Delete Component, 49 inversion and 53 whole-mask deletion HTTP/queue/Parser/Commands/Lua scenarios pass with a mocked SDK, plus all 12 creation choices, `tests/masking.js`, shared-history and polling-contract checks. The existing isolated Chromium `--mask-create-only` runner passes creation/component actions, both last-component outcomes, history, stale/duplicate safeguards, all 12 inversion headings and continuous geometry at 1280/768/390/320 widths. These are fixtures, not additional live Lightroom acceptance. JavaScript/JSON/inline Controller parsing and diff checks pass. The command-name contract fixture now includes creation and component commands. Lua fixtures use the existing external Fengari runtime via `LRBRIDGE_LUA_TEST_RUNTIME`; no dependency or lockfile changed.
- **Known limitations:** the pre-existing Delete All wording assertion in `tests/masking-phase4-completion.js` remains separate from component-action checks. The protected Companion contract mismatch concerning `LensBlurAmount` remains unrelated. Retain the unresolved Point Color Visualize Range availability issue and historical, unreproduced Blue-curve issue.
- **Deferred:** Masking brush Size/Feather/Flow/Density, A/B/Erase and Auto Mask. The SDK audit is complete. The read-only native probe is preserved, but its live inspection was rejected by automatic approval review; no Masking native identity/readback/write support was established. AGENTS.md was not changed and the denied probe must not be retried or repackaged. Historical Lens Blur control captures are not Masking evidence.
- **Post-v0.6 proposal only:** optional, explicitly configured shortcut support could be considered in a separate design/authorization pass. It is not implemented, does not provide authoritative brush-state feedback and does not authorize keyboard/mouse/UI Automation fallbacks in current work.

At that checkpoint, the next task was SDK-supported Remove-panel brush Size/Feather. The completed work is now included in the Healing checkpoint above, with initial successful live feedback. These preferences are distinct from Masking brushes and existing removal-spot adjustments. Preserve protected settings/Companion files, unrelated research/scripts, saved diagnostics, the native probe and the existing stash. Checkpointing itself requires no runtime restart or reload.

## Masking controls and lifecycle checkpoint (2026-09-13)

This local checkpoint on `feature/v0.6-more-sdk-and-web-controller` records the accumulated Masking implementation after `066364843b5327a625a77e9c4e7ce8229af9e097`. The user explicitly authorized the checkpoint and confirmed the repaired deletion case. Git history identifies the resulting commit; no push, release or version bump is authorized. This section supersedes older next-task and deferred-feature statements below where they conflict.

### Completed implementation and live observations

- Masking scalar corrections, shared Point Color/Refine controls, compatible saved presets and the shared Tone Curve host are integrated with authoritative SDK feedback and context/gesture safeguards. Saved presets, including custom-preset discovery after creation/deletion, are accepted and closed. Their native preset-name limitation is accepted; do not reopen that research or recreate `nino_test`. Existing inert regression fixtures remain historical evidence.
- Grain has its accepted divider/subheading after Texture, Clarity and Dehaze, then Amount, Size and Roughness, with the shared-global explanation beneath. Amount remains `local_Grain`; Size/Roughness use photograph-wide `GrainSize`/`GrainFrequency` through the existing global slider path. The user confirmed visible adjustments and subsequently reported the Lightroom/Web scrolling repairs working. Masking Grain writes preserve Lightroom's panel position; same-context Tone Curve feedback retains its rendered graph and layout and polls silently.
- One sticky Undo/Redo pair serves every page through the shared SDK history path and authoritative availability. Tab/mask/slider-group dependencies and duplicate pairs are removed; in-flight and connection safeguards remain. Automated checks cover the original mask-local/shared-Grain availability mismatch, tab switching and history synchronization; do not claim every history scenario was independently repeated live.
- Create New Mask uses Lightroom's exact labels/order: Select Subject, Select Sky, Select Background, Select People, Select Landscape, Select Objects; Brush, Linear Gradient, Radial Gradient; Color Range, Luminance Range, Depth Range. The responsive touch dialog/sheet provides large targets, three/two columns, natural scrolling, Close/Escape support and stable underlying page position. The user reported creation working and the touch picker satisfactory; this is not exhaustive live acceptance of all 12 native tool lifecycles.
- Delete Mask uses the bound selected whole-group ID; Delete All Masks uses `resetMasking`, asks once with the current count and preserves global Develop settings. Fresh complete inventories prove removal; empty inventory is a normal state with Create available. Operation-scoped recovery preserves a valid surviving selection, otherwise selects the next surviving group or previous at the end, then verifies its component. No selection is forced by polling.
- **Latest user-confirmed case:** deletion succeeds, another mask is selected, editing continues, and the false warning is gone. Web displays **“Mask deleted; inventory and selection confirmed by Lightroom.”** The proven cause was the admission response omitting `beforeSelectedMaskId`, making the browser discard the operation before its valid confirmation arrived. The server now publishes that target. Obsolete-warning recovery requires the same operation's authoritative result and context, while preserving unrelated errors; surviving selection alone never proves removal. The original captured operation was independently confirmed by Lua, HTTP and server reconciliation.
- Tone Curve movement/addition/deletion and responsiveness were reported working. With color channels reset, Linear/Medium/Strong Contrast names agreed in both applications; individual color-channel edits correctly showed Custom. Shared Add/Delete remain above the graph and Reset Selected Channel below, with one stable status area and silent routine feedback.

### Verification and preservation

Reused completed validation: 53 HTTP/queue/Parser/Commands/Lua deletion scenarios with a mocked SDK; the isolated Chromium regression reproducing the actual missing-field admission/confirmation sequence, warning ownership, genuine-error preservation and stale-photo rejection; existing browser creation/deletion/empty-state/Undo/Redo/partial-selection checks, including 1280/768/390/320 touch widths; focused history/Masking checks; and earlier Grain/Tone Curve continuous-geometry checks. These are automated fixtures, not additional Lightroom manual acceptance. The latest deletion wording/selection acceptance above is the user's live result. Detailed diagnostics and test history remain in ignored `CODEX_HANDOFF.local.md`, especially sections 46, 49–59.

The checkpoint preserves the integrated earlier Masking support required by these features; it does not declare every unfinished Phase 4 control accepted. Preserve `config/settings.txt`, protected Companion documents, local capture/research files, ignored logs/handoffs/browser profiles, the temporary visibility probe and the existing stash. The known protected-document contract mismatch about `LensBlurAmount` remains unrelated; do not modify the protected documents to hide it. Checkpointing changes no runtime behavior and requires no new restart, plug-in reload or browser refresh.

### Resume next time

1. **Next feature, not implemented:** Add/Subtract mask components using the existing touch picker and documented `addToCurrentMask` / `subtractFromCurrentMask` methods. Inspect installed SDK signatures and existing context/creation lifecycles when this work begins.
2. **Unresolved:** intermittent Point Color Visualize Range toggle availability. The prior busy-state explanation is an unconfirmed read-only finding; no repair or instrumentation for that issue was authorized by the deletion work.
3. **Native checkbox limitation:** no documented native read/write integration was found for Reset Sliders Automatically or Use Fine Adjustment. MIDI2LR commit `e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc`, checked in Database.lua, Client.lua, Limits.lua, Mask.lua and Preferences.lua, provided no Reset Sliders Automatically implementation. Fine2/4/8/16 call Limits.Fine to change internal MIDI value mapping; the LocalHue/FineAdjustment label lookup does not operate Lightroom's native checkbox. Do not substitute fake synchronized switches, UI automation or private hooks.
4. **Deferred design:** improve the shared toolbar and assess Copy/Paste Settings and possibly Export when that task starts; none of those actions was added here.
5. **Historical issue:** the earlier Blue-channel confirmation failure has not recurred in recent user testing. Its original cause remains unknown; do not claim it was proven fixed. Preserve strict confirmation and diagnostic evidence.

Start the next session with AGENTS.md, this checkpoint and read-only Git verification; inspect remaining dirty changes before editing. Do not restart LRBridge or reload Lightroom solely because the Codex session is new.

## Masking Phase 3 visibility checkpoint (2026-09-07)

Masking Phase 3 adds authoritative visibility control for the selected mask group and its selected component. Lightroom Classic 15.3 runtime probes proved that `getAllMasks()` returns authoritative boolean `Hidden` values for both objects and that `LrDevelopController.toggleHideMask(maskId)` / `toggleHideMaskTool(toolId)` change them with authoritative readback. Production state and UI therefore follow Lightroom feedback only; pending requests retain the last confirmed presentation.

- The two exact three-column rows remain **Previous Mask | visibility | Next Mask** and **Previous Component | visibility | Next Component**, with `Mask n of m` and `Component n of m` feedback directly below their rows. A visible item has one open-eye inline SVG, neutral styling, and **Hide Mask** / **Hide Component**. An authoritatively hidden item has one crossed-eye inline SVG, the accepted dark-red styling, and **Mask Hidden** / **Component Hidden**; its accessible action remains Show and clicking restores visibility.
- **Open Masking** preserves an already complete authoritative mask/component selection. If masks exist without a complete selection, it uses the fresh post-open `getAllMasks()` inventory to select Lightroom's first mask and that mask's first component, then settles only after authoritative selection readback. A photo with no masks remains a successful open state with disabled controls and the photographer-facing message **No masks available.**
- Visibility and selection operations share the serialized Masking lifecycle. Every command remains bound to selected-photo UUID, Masking context, context timestamp, Develop revision, server epoch, semantic Masking revision, selected mask ID, selected component ID, and prior authoritative `Hidden` state, with queue admission/dequeue, stale-response, context-cancellation, and exact settlement protections preserved.
- Both isolated Lightroom visibility probes passed with original visibility, inventory, and selection restored. The user then manually accepted automatic Open Masking selection and both visibility controls, and visually reviewed the final UI as good enough. Focused `test:masking` and `test:controller-browser` passed after the final presentation change.
- The master **Masking Corrections** switch remains deferred and was not implemented. Phase 1 mask navigation and Phase 2B component navigation remain unchanged.
- The existing protected-document contract mismatch, `Generated Companion document is missing slider LensBlurAmount`, remains unrelated and unchanged. Neither protected Companion document was modified.
- This checkpoint is based on Phase 2B commit `f04c7ca3f04d6d486b3f9bdc14d120eb82606f3e`. Git history is authoritative for the resulting Phase 3 commit.

## Masking Phase 2B component-navigation checkpoint (2026-09-06)

Masking Phase 2B adds bounded **Previous Component** / **Next Component** navigation within the currently selected mask. The Controller presents authoritative Lightroom feedback as `Component n of m`; direct component selections in Lightroom update the Web Controller, and Controller selections update Lightroom without changing the selected mask group. Navigation stops at the first and last component and never wraps.

- Rapid component input is retained as a bounded desired index and executed as serialized, authoritative one-step commands. Component, mask-group, and Open/Close Masking operations cannot overlap. Each operation preserves the selected-photo UUID, context counter/timestamp, Develop revision, server epoch, semantic Masking revision, selected mask ID, selected component ID, protected queue ownership, stale-response rejection, and exact Lightroom/server readback reconciliation.
- Core live acceptance used a real three-component mask ordered **Background 1**, **Sky 1**, and **Brush 1**. The user confirmed correct `Component 1 of 3` feedback, working Previous/Next Component controls, Lightroom-to-Web and Web-to-Lightroom synchronization, unchanged mask-group selection, no observed error, and continued Phase 1 Previous/Next Mask behavior.
- Do not describe the complete 15-step procedure as manually passed. Rapid reversal, repeated boundary clicks, and photo/module context cancellation are covered by the passing automated contracts but were not repeated manually in the shortened acceptance session.
- Component visibility, mask visibility, and the Masks panel master **Masking Corrections** eye/switch remain deferred pending separate Lightroom 15.3 runtime probes. Do not infer or implement those capabilities from component navigation.
- This checkpoint is based on `a769f957e035415f2405d324846903b51c3e053a`. The required validation lifecycle consumed one LRBridge restart and one production plug-in reload; checkpointing requires neither another restart nor another reload.

## Authoritative Masking Phase 1 checkpoint (2026-09-06)

Masking Phase 1 is manually accepted on Lightroom Classic 15.3. Open Masking, Close Masking, Previous Mask, and Next Mask work, including rapid navigation, and the former false `That mask change is no longer available` error did not recur in the accepted test. This checkpoint starts from `ced19b232555a1c9919c33f064ef30ea6c819519`; Git history is authoritative for its final commit hash.

- Masking state is authoritative Lightroom SDK feedback. Lightroom 15.3's actual `getAllMasks()` inventory is a dense array of mask-group tables with group `ID` and a nested dense `Tools` array containing tool `ID` values; observed optional group metadata is `Name` and `Hidden`, and observed optional tool metadata is `Name`, `Type`, `Subtype`, `Hidden`, `Inverted`, and finite `MaskSubCategoryID`. The reader normalizes only that evidenced schema and fails closed for malformed tables, missing navigation data, duplicate or invalid usable identifiers, and unreconciled selected mask or selected mask tool.
- The Web Controller provides authoritative Open/Close Masking and bounded Previous/Next Mask controls with confirmed `Mask n of m` presentation. Navigation never wraps. Rapid clicks update a clamped desired group index, while LRBridge serializes the final intent into exactly one safe Lightroom one-step command at a time. Direction reversal updates the destination rather than executing a stale click sequence, and desired state is never presented as confirmed Lightroom state.
- Every query and operation remains bound to the selected-photo UUID, module/context counters and timestamp, Develop revision, server epoch, and Masking revision. Unique query IDs reject duplicated, stale, and out-of-order Lightroom results; only one authoritative Masking operation may be pending; context/photo/module/epoch changes cancel queued intent; and every subsequent navigation step uses newly confirmed state and bindings.
- Masking revision is semantic command-binding state, not polling freshness. An identical authoritative Lightroom snapshot completes its unique query and may advance `capturedAt`, but it does not increment the revision. A genuinely changed panel state, inventory/selection/tool state, context binding, or required operation lifecycle does increment it. Previously, every accepted identical poll incremented the revision, so `/masking/state` could return revision N while its own routine refresh made N immediately stale and caused false HTTP 409 responses for both panel and navigation commands; semantic comparison removed that race without accepting old revisions or weakening stale-context checks.
- Panel and navigation failures have distinct persistent photographer-facing error ownership. Routine polling does not erase a real error; the next deliberate action or a later successful Masking operation clears it. Successful panel operations clear older navigation errors and successful navigation clears older panel errors. Ignored or disabled clicks do not create false errors.
- Phase 1 intentionally preserves the legacy `selectMaskingTool` action and does not implement mask creation, deletion, duplication, inversion, AI-mask creation, Add/Subtract/Intersect, local mask sliders, or any other mask mutation. Those capabilities belong to a separately researched and manually accepted Phase 2, which is intentionally deferred.
- MIDI2LR (`e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc`) and LRControl (`2d9ad6c7a5075dbb042d05dd50b89ab4bf36b8da`) were architectural/behavioral references only. Both repositories are GPL-3.0; no GPL source was copied into LRBridge. LRControl predates the modern Masking API and supplied no usable Masking implementation.
- Focused Masking state-machine, rendered-controller, HTTP admission, queue, polling, browser-lifecycle, controller integration, JavaScript/JSON/Lua syntax, and diff checks cover the accepted behavior. The known protected-document `npm test` mismatch remains `Generated Companion document is missing slider LensBlurAmount`; do not edit the protected Companion cheat sheets to conceal it.

## Favorite Presets and native PresetAmount checkpoint (2026-09-04)

This section supersedes the older warnings below that Preset Amount still uses preset reapplication or awaits the final-intent workaround. The accepted checkpoint is based on `8a4562bcd31549643013f3afe337a5fec944ca04`; Git history and `.codex-handoff-2026-09-04.md` record the resulting checkpoint hash.

- Presets are applied once, without an Amount argument. The ordinary call is `photo:applyDevelopPreset(preset, _PLUGIN)`; AI-enabled favorites retain `photo:applyDevelopPreset(preset, _PLUGIN, nil, true)`. Interactive Amount uses one dedicated `LrDevelopController.setValue("PresetAmount", value)` operation with immediate native readback and authoritative observer/poll feedback.
- `amountEnabled` is an explicit UUID-bound per-favorite opt-in, defaults false, and is saved alongside the existing `updateAISettings` boolean. Native Amount range/availability fails closed. Server epoch, state revision, context timestamp, feedback ID, and browser intent ownership prevent stale/out-of-order feedback from rolling back a newer desired value. The old Amount-by-preset-reapplication path and temporary trace hooks are absent.
- The Lightroom 15.3 SDK exposes no reliable authoritative active-preset UUID/name for this integration. The selected preset shown by LRBridge therefore remains its Favorite Presets apply cursor; identity is never inferred from Amount or Develop settings.
- Develop Sliders retains the compact `Auto` / permanently labeled `B&W` / authoritative status presentation. Confirmed B&W alone uses the established restrained green active style. Presets separately uses authoritative `PHOTO MODE` Color/B&W segments and the prominent amber B&W alert. Both share the existing Treatment command and authoritative feedback state; pending intent never replaces confirmed selection.
- The Presets surface is now photographer-facing `FAVORITE PRESETS`: `Selected preset`, `Prev`, `Next`, `Manage Favorite Presets`, `+ Add to Favorites`, matching AI/Amount option cards, dark warm-yellow Alias fields, Preset-before-Folder card order, and a `17px`/`700` Preset value. Technical SDK/queue/revision language was removed from normal UI copy.
- Final Amount unavailable text is `Amount slider unavailable: Make sure it is enabled under Preset Options. If enabled, Lightroom Classic does not support it for this preset.` Its prefix through the colon alone is emphasized at `#f4f7fa` and weight `700`; availability logic is unchanged. Final AI/B&W copy and exact DOM order are recorded in the local checkpoint handoff.
- Focused Presets, Treatment/controller, sliders, diagnostics, feedback, and Lua polling suites pass, as do all changed JavaScript syntax checks, inline Controller parsing, changed JSON parsing, and `git diff --check`. The established protected-document `test:contract` mismatch remains unchanged; do not edit the protected companion cheat sheets to hide it.
- The final Amount-prefix and Preset-name styling were manually accepted as good enough. Treat this checkpoint as the baseline and wait for the user’s next LRBridge task rather than continuing Presets polish.
- Preserve the intentional local `config/settings.txt` change, ignored handoffs/browser profiles, protected cheat sheets, and `stash@{0}`. No LRBridge restart or Lightroom reload was performed during the final UI-polish/checkpoint work.

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

## Controller lifecycle and preset inventory stability checkpoint (2026-09-03)

The user manually confirmed that the Controller repair works. Preserve this checkpoint as a browser/server-only correction; it does not change the Lightroom Lua plug-in or the experimental Preset Amount design.

### Resolved regressions

- Profile recovery now treats an increasing authoritative `contextChangedAt` as a new server epoch when LRBridge restarts and its revision counters reset. The selected-photo UUID, request generation, context, and stale-response safeguards remain authoritative.
- Jump-to insertion is owned only by direct child sections. Every render first deactivates controllers and polling, disconnects observers, removes document listeners and menus/sentinels, and cancels scheduled animation frames before rebuilding content. The corrected lifecycle avoids duplicated observers/listeners and unbounded `requestAnimationFrame` retries.
- Controller metadata startup errors are reported by the metadata request itself; later render failures are no longer mislabeled as slider-metadata load failures.
- The Presets controller automatically requests authoritative inventory on first activation for the current LRBridge process. Automatic, manual Refresh Presets, and Add Presets requests share one coalesced operation. Explicit not-loaded/loading/ready/error states preserve configured UUIDs, aliases, ordering, AI flags, cursor, Amount, Treatment, Alias drafts, and dirty state. Missing UUID is shown only after a successful complete inventory proves absence, and a failed refresh retains any previous successful snapshot.

### Verification and live evidence

- `npm run test:controller-browser` passed its isolated ephemeral-loopback, seven-tab lifecycle gate: 27 renders beginning at Presets, Profile epoch recovery to Adobe Landscape, Jump-to ownership/navigation, stable observer/listener/interval/rAF counts, no browser exceptions or required-request failures, and explicit browser/CDP/server/socket/profile cleanup.
- All 36 non-contract scripts in the broad `package.json` test chain passed individually, including Profile/Profile Amount, Develop Presets, Jump-to/collapse, commands, Color Grading, Tone Curve/Point Curve, generic sliders, lifecycle/context/proxy/feedback, and all adjacent suites.
- Syntax checks passed for all nine changed/new JavaScript files. The single inline Controller script compiled with `vm.Script`. `package.json`, `config/sliders.json`, `config/develop-presets.example.json`, and `tests/contract-fixture.json` parsed as JSON. The exclusion audit and `git diff --check` passed; only existing line-ending advisories were emitted.
- `npm run test:contract` remains a visible exit-1 exception only at `Generated Companion document is missing slider LensBlurAmount`. Neither protected Companion file was modified, and this exception was not reinterpreted as passing.
- The changed server source was loaded by exactly one LRBridge restart. Replacement Electron PID `34112` owns ports `17890`-`17892`; `queueLength` is `0`; `/api/context` is current and UUID-bound; Profile is authoritative as Adobe Color; Tone Curve feedback is available; preset inventory moved automatically to ready without Add Presets; and all 12 configured UUIDs resolved. No Lightroom plug-in reload was performed because no Lua changed.

### First next task: Preset Amount remains experimental

1. Establish an authoritative capability/application-success signal for presets such as AR01 that disable Lightroom's native Amount control or do not respond to Amount. Fail closed without classifying support from preset names, folders, aliases, or missing settings.
2. Correct rapid minus/plus desired/submitted/committed reconciliation so polling or an older completion cannot roll the local value back over newer queued intent.

Do not restart LRBridge or reload the Lightroom plug-in merely for this completed checkpoint. Restart the source process only after a future server-code change; request a plug-in reload only after a future Lua change.
