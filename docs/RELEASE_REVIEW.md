# Windows v0.6 beta completion review

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

Reload the source plug-in once through Plug-in Manager to unload the old Lua hooks:
`D:\Projects\LRBridge\lightroom\LRBridge.lrplugin`. Close the recorder tab and
open/refresh the normal source Controller at `http://127.0.0.1:17892/`. No Lightroom
or LRBridge restart or repeat of the accepted physical sequence is requested.

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

### Short retest before rebuilding

Run the updated source bridge, load/reload the **source** plug-in once, and refresh
the Controller. On a disposable photo:

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

If those pass, build a new identified candidate from accepted source and run the
existing package gates. Keep original package evidence and pending acceptance
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
within the recorded limits above. No repetition is required for capture cleanup.
The earlier source retest record still lacks explicit results for AUTO/B&W separately,
Effects, Circle/Bubble/5-blade highlight timing, Upright Open/Close preserving correction
and crop, layout/notices and the existing Transform Constrain Crop versus Crop-panel
Constrain to Image control. Confirm existing results before any remaining focused
checks. Then build and verify a fresh private candidate in a new writable extraction;
complete the package/native gates below before publication. The old private package
must not run beside the source app or be published as containing these fixes. Do not
install presets, repoint the plug-in or send live edits automatically.

**Denoise Reset:** The private candidate includes the pending Amount-only Reset to 50. It must keep Denoise on, preserve Raw Details/Super Resolution and wait for Lightroom feedback. Prior model/mock-browser checks passed; actual Lightroom validation remains required.

**Dust setup dependency (2026-09-24 source review):** Adding the plug-in alone on a fresh computer does not enable Dust Apply on/off or Reset. The runtime resolves the exact presets from Lightroom's registered preset inventory; it does not load them directly from the bundled `resources/presets` folder. The separate `Install Dust Presets.cmd` copies them to CameraRaw Settings, and neither app nor plug-in startup runs it. The development computer already had both presets during the September 16 capture, before the packaging/installer checkpoint. Current files match the bundled hashes; the precise save/import action cannot be established from the capture. Isolated missing-preset and installer checks pass, but actual fresh-computer preset discovery and Dust operation after setup remain release acceptance items. Existing working presets were not changed.

**Compatibility boundary:** The private test target is Windows x64 and Lightroom Classic 15.4.1. SDK metadata declares 15.3; that does not establish an overall supported minimum. Dust's current state/Apply/Close code explicitly requires exactly Lightroom 15.4.1, and Apply on also requires photo ProcessVersion 15.4. Other Lightroom versions remain unverified.

1. **Native Quick Copy/Paste:** still unaccepted. On disposable photos, confirm Lightroom Copy → web Paste without preceding web Copy; Quick Copy with deliberately chosen harmless categories; one destination and a small multi-photo selection; same-active-photo selection changes and authoritative history/results. Only the user performs these operations. Batch true does not mean every photo succeeded. Clipboard contents/timing and AI completion cannot be inspected or frozen by the SDK.
2. **Windows clean install and upgrade:** extract into a new writable folder; verify preset discovery, plug-in loading, normal desktop start/quit/tray, polling/reconnection, helper controls and preservation of settings/favorites with the same browser origin. Automated packaged-runtime checks do not replace a clean machine or real Lightroom session. The candidate is unsigned and unpublished.
3. **Packaged integration checks:** confirm the accepted Help/Builder and their reference links load from the extraction, then run a copied command through PowerShell and Companion on a disposable photo. Export acceptance remains limited to the full Export dialog, Previous destination chooser and one selected-photo count. No completed file export or multi-photo Export acceptance is claimed.

Known limits remain documented in [Windows beta notes](WINDOWS_BETA.md): People processing/Cancel; arbitrary-photo Dust redetection and preservation with populated AI/manual edits; broad copied-mask/AI preservation; actual last-component deletion and broader Red Eye reset preservation; native fault/reconnect cases. Historical Healing/Point Color/Blue-curve reports have no current reproduction. `cycle_loupe_info` remains excluded from visible choices because the prior native test had no visible effect. No speculative fixes or disabled working controls were introduced.

The legacy `tests/dust-paste.js` exercises the unshipped `TestDustPaste.lua` research workflow, not the native Quick Copy/Paste implementation. An exploratory run exceeded four minutes; it remains outside the shipping runtime gate. Its earlier one-photo evidence does not establish general clipboard or AI correctness. Production Dust/clipboard guards retain their own focused tests.

This is a local development candidate, not native acceptance or authorization to push, merge, tag or publish.
