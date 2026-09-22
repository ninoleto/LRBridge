# Remove → Selected

This workflow is separate from **Selected Repair** (Fill, Opacity, Feather,
Refresh, Delete) and from People removal.

The source implementation provides separate **Size**, **Cancel**, **Remove** and
command-only **Add/Subtract** controls, with native selection availability.
The user manually verified that both prototype web buttons activate the
corresponding native Selected controls. The logs correlate 11 Add and 11 Subtract
requests with fresh SDK guards and one dispatch each (145–441 ms to settlement).
Brushing behavior and automated active-mode readback are separate, unverified
items. The normal-controller integration still needs its own manual acceptance.
Automated tests and read-only observations do not establish native acceptance.

## Access and evidence

The installed Lightroom Classic 15.3 SDK reference documents
`getRemovePanelPreferences()` and `setRemovePanelPreferences({ brushSize = value })`.
Size uses that existing SDK command, value, queue and readback. The main Healing
Size remains present. Dust Size keeps its independent fresh-Apply-On requirement.
Selected Size additionally requires fresh native feedback that the manual
selection group and its Size control are active and enabled.

The SDK's selected-spot methods address existing repairs. They do not document
pending selection Add/Subtract, cancellation, submission or refinement mode.
Delete, Refresh, Masking Add/Subtract and tool navigation are not substitutes.

Read-only Windows discovery found a manual group under the native `Remove`
section and its `Collapsible Section` owner. Direct `Mask:` and `Size` labels,
the Size trackbar (native range 1000–100000), one `Cancel` Button and one
`Remove (Bridge View)` control identify the group. The separate People
Cancel/Remove group does not meet those conditions. Missing or duplicate
controls, mixed visibility or changed ownership produce unavailable feedback.
No screen coordinates, pixels, screenshots or global input events identify it.

- **Cancel:** sends one button activation to the verified native Cancel Button.
  Confirmation requires the same group's inactive state and stable unchanged
  SDK repair inventory/preferences.
- **Remove:** sends one target-local activation sequence to the verified named
  native control. Posting is not completion. Confirmation requires the same
  group's inactive state, a stable changed SDK repair inventory, preserved brush
  preferences, and explicit SDK editing readiness.
- **Add/Subtract investigation:** the inspected custom controls expose the generic
  `(Bridge View)` name, MSAA client role, no default action, no UIA invocation or
  selection pattern, and no usable selected-mode value. A second inspection with
  the manual group active and visible confirmed the same metadata, zero MSAA
  children and zero UIA descendants for the three custom panes beside `Mask:`.
  Position beside `Mask:` alone is insufficient to identify them. With the user's
  explicit Selected-only capture permission, window-local renders now identify
  each actual Add/Subtract label and its native handle; the third pane is the
  overlay color swatch. An isolated prototype binds those verified identities
  and uses the existing target-local activation mechanism plus a live SDK guard.
  The user directly observed both native buttons activate from the prototype.
  Normal-controller Add/Subtract now use that same target-local press/release
  through the existing action queue. They report a request sent, without an
  active highlight, selected-mode value or brushing claim.

Normal-controller identification now reads the rendered labels automatically.
The old ignored `config/remove-selected-targets.local.json` is preserved but is
never read by the current implementation. No temporary plug-in, manual capture,
saved handle or configuration edit is part of recovery.

The existing native observer enumerates only bounded custom controls directly
inside the uniquely verified manual Selected group. Each control is rendered
with `PrintWindow`, entirely in memory; the photo, desktop and unrelated windows
are excluded. Built-in Windows English OCR reads four contrast/scale variants.
An exact Add or Subtract word must agree in at least two variants, with no
conflicting label. Exactly one distinct control for each label is required.
Pane order, screen coordinates and an unreadable active-mode value never assign
the action. A blank render, unavailable OCR language, timeout or ambiguity gives
an actual failure reason and disables Add/Subtract only.

An in-memory identity cache lasts at most 15 seconds. Every observation checks
the current process start, candidate set, native handles, owners, class, style,
caption, visibility and enabled state. A changed/expired identity automatically
triggers new label reads in that observation. No old success survives a failed
read. Each action independently forces new label identification after its native
queue wait, compares the exact admitted target identities, then requests the
existing fresh SDK photo/tool/preferences/settings guard. Native identities are
checked again before the same once-only target-local activation sequence.
Size/Cancel/Remove, the separate read-only observer and shared action queue remain
independent of OCR success. Active-mode feedback is still unavailable.

Rendering waits at most 350 ms and permits only one outstanding render worker per
helper. OCR waits are also bounded, with a 1500 ms identification deadline. This prevents a stalled render from blocking
ordinary Selected observation indefinitely. Recognition uses the installed
Windows English OCR language; other Lightroom UI languages are not verified.
See Microsoft's [OCR API](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync)
and [PrintWindow behavior](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow).

**Restart recovery is prepared, not manually accepted.** Real read-only discovery
identified both controls in process12292 despite the preserved file still naming
process6352. A 46-second observation had 64/64 available reads across automatic
renewals, with maximum native execution781ms, while Profile reads occupied the
shared action helper for1047–1822ms. Profile inventory itself was unavailable in
that panel state; this run verifies queue isolation, not Profile acceptance.

The subsequent manual test accepted Subtract but **failed Add**. In that live
Subtract-selected appearance, Add was recognized by only one original variant;
the fresh two-match requirement therefore rejected its identification. The same
control crop reproduced the failure offline. An additional inverted 3x variant
now supplies the second Add match while retaining all original variants needed
by Subtract. The two-match threshold, uniqueness requirement and context/native
guards are unchanged. Both actual appearances and swatch/blank negatives pass;
27/27 live read-only samples remained available in that same Lightroom session.
This corrects the demonstrated identification failure; actual Subtract-to-Add
activation acceptance remains failed until the user observes it in Lightroom.

`/remove/diagnostics/refinement` keeps the last 100 operation events and current
label readings, including HTTP admission/rejection, dequeue, SDK invocation and
guard, selected HWND, native press/release post results, SDK result and settlement.
The browser's `removeController.refinementDiagnostics()` keeps its last 40 local
pointer/staging/admission/error events without sending extra requests. These are
read-only diagnostic views; posted input never claims a confirmed active mode.
The earlier implementation retained only the last result, so an overwritten Add
attempt cannot be reconstructed from its generic SDK command-name log.

The original hidden-panel discovery established identity only. The later active
captures and the user's button-activation verification are distinct evidence;
neither establishes successful brushing, cancellation or removal.

## Ownership and settlement

Commands carry the existing UUID, module, context, Develop revision, epoch and
Remove revision binding through admission, queue dequeue, SDK execution and
result acceptance. Native identity is rechecked after the shared Windows queue
wait. A short-lived challenge requires a fresh SDK photo/tool/mode check from a
read-only SDK check immediately before activation: normal context heartbeats
pause while the SDK command worker is busy. Add/Subtract use the proven sequential
protocol: immediate queue acknowledgement, status polling, a fresh SDK
photo/tool/full-Develop-settings/preferences snapshot after queue wait, one guard
reply, native revalidation and one completion result. No SDK HTTP request is held
open waiting for a second SDK HTTP request. Existing Cancel/Remove flow is preserved.

Add/Subtract settle as `requested` only after native delivery and SDK preservation
checks. Known pre-input rejection reports `Not sent`; uncertain/partial delivery
stays unknown with no retry. Settlement releases the operation's editing
restrictions without requiring unavailable automated mode readback. The independent
native observer never posts input or changes its command whitelist.

Remove has one native invocation per operation. An uncertain submission cannot
be resubmitted against the same continuously active selection. Observed
inactivity or a changed control identity permits a new selection. The SDK does
not expose an identity for unsubmitted selection contents; cancellation and
recreation entirely between observations cannot be distinguished by content.

Confirmed, rejected/stale, failed and unknown results settle the matching
operation. Unknown feedback is not reported as successful removal. Unfinished
Selected Size input is discarded when its native availability is lost.
Native discovery runs independently of SDK state responses, so it cannot hold
Dust feedback open. Profile FIFO ordering, per-reader poll coalescing, command
priority and Lens Blur feedback paths remain in place.

## Intermittent availability correction

The unchanged active selection produced 111 consecutive `/remove/state` samples
over 40 seconds: 33 unavailable samples, 28 samples with native age at least
2500 ms, and a maximum native age of 4211 ms. The photo/context and known native
identity stayed unchanged; SDK feedback stayed current. These categories overlap.
The old state layer discarded native exceptions, so those responses alone did
not identify the failed native operation.

Read-only reproduction using the existing native transport established that
Profile label discovery occupied the shared helper for 3690–3906 ms. Each of
three Selected reads queued behind it expired after 3003–3018 ms. Independent
Selected reads also scanned 2852 windows and took 547–987 ms. The 750 ms refresh
delay, controller polling and queue waits could not maintain the 2500 ms budget.
Additionally, any pending SDK brush command suppressed native refreshes, including
Size interactions.

Selected observation now uses one lazy read-only helper through the existing
bounded transport. All native actions, Profile and Lens Blur retain their
original shared queue, coalescing and ordering. The observer accepts only
`readRemoveSelection`. Its native discovery enumerates current handles, then
snapshots only the named manual Remove section and its parent. Every read
rechecks current ownership, uniqueness, visibility and enabled state; availability
is never cached. SDK brush writes no longer suppress this observation. The
2500 ms freshness requirement, photo/context guards and submission quarantine
remain unchanged.

`selection.read` exposes duration, queue/execution timing, in-flight age and
failure information. A failed read immediately replaces availability with
unknown, retains its reason and disables controls. The status tooltip exposes
that reason. Timing-only changes do not advance the editing revision.

A 45-second read-only run against the same active Lightroom panel used
300–1200 ms polling gaps and real slow Profile/Lens reads: 71 state samples,
zero unavailable/stale samples, maximum age 1870 ms, 35 successful native reads
and no Selected queue expirations. Read duration after startup stayed at or below
189 ms. A separate timed simulation exercised five pending SDK Size operations
under 3800 ms Profile reads and polling jitter; maximum selection age was 1122 ms.
These results do **not** constitute native Cancel/Remove/Size acceptance.

## Focused verification and manual acceptance

Automated entry points:

- `node tests/remove-selection.js`
- `node tests/remove-selection-refinement.js`
- `node tests/remove-selection-polling.js`
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/remove-selection-native.ps1`
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/remove-selected-label-ocr.ps1` (Windows OCR; saved control crops only)
- `node tests/controller-browser-lifecycle.js --selected-only`

Regression coverage includes the existing Dust SDK/browser tests, Remove
preferences, Profile and Lens Blur native polling.

For automatic identification/recovery, quit and reopen the updated source
LRBridge app once, then restart Lightroom. Keep the temporary SelectedPrototype
plug-in disabled. Open a pending Remove selection and refresh the normal Web
Controller: Subtract, then Add, once each, must activate the corresponding native
button and settle promptly; Selected Size, Cancel and Remove must remain usable.
Use no manual captures, configuration changes or temporary SDK plug-in. This is
the required restart-acceptance sequence. There are no Lua changes in this fix
and no separate plug-in reload is needed.

For the current Add failure retest, keep this Lightroom session/photo/selection
open. Quit/reopen **only LRBridge** to load the new OCR variant and diagnostics,
refresh the controller, request Subtract once and wait for settlement, then
request Add once. Lightroom must visibly switch to Add. Do not accept enabled
buttons or a sent-request acknowledgment as proof of the mode change.

Broader existing Selected checks, separate from this focused restart acceptance:

0. Leave Selected active for at least 60 seconds. Its status and Size/Cancel/Remove
   availability must remain stable. Edit Selected Size repeatedly, including a
   held drag and numeric draft; check main Size synchronization and recovery after
   each SDK operation. Inspect `/remove/state` if availability changes: preserve
   `selection.ageMs`, `selection.read`, reason, identity, context and operation ID.

Then use disposable test photos:

1. With no pending selection, confirm Selected Size, Cancel and Remove are
   disabled. Create a manual Remove selection in Lightroom and leave it pending.
2. Confirm Selected Size enables and synchronizes with the main Healing Size and
   Lightroom's Size in both directions. Dust Size must remain disabled with Dust
   Apply Off. Click web Subtract once and verify Lightroom activates Subtract;
   click web Add once and verify Lightroom activates Add. Each must settle as a
   sent request and release ordinary editing, with no invented active highlight.
   Repeat with browser/Lightroom focus changes. Test brushing separately: Subtract
   should shrink and Add should grow the selection. Stop on uncertainty; no retry.
3. Click web Cancel once. Confirm Lightroom discards the pending selection,
   existing repairs remain, the web reports cancellation and ordinary sliders
   work. Repeat cancellation directly in Lightroom and check web availability.
4. Create another selection and click web Remove. Repeated clicks must not submit
   twice. Check Lightroom's actual result, pending/completion feedback, subsequent
   control availability and ordinary slider usability.
5. Change photos while a selection or operation is present. Old input/results
   must not act on or label the new photo. Test a closed/collapsed panel and
   temporarily unavailable feedback; neither should appear as a confirmed action.
6. Smoke-check Dust Apply → Reset → Close and Lens Blur feedback after photo
   changes. This work does not change People Cancel.

These steps require actual Lightroom results before acceptance or checkpointing.
