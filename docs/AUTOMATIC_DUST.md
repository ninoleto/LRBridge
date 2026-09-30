# Automatic sensor Dust removal

## September 30 scoped acceptance and panel navigation

The user accepts the current Dust implementation and compact On/Off buttons within
the tested scope. This does not establish previously unreported fresh-VM diagnosis,
clean installation, migration or preservation scenarios. Earlier dated evidence and
limitations remain as recorded below.

Rechecked the installed SDK 15.3 `LrDevelopController` reference and existing
[capability research](LRBridge-Distraction-Removal-Research.md). `goToRemove` opens
the overall Remove tool; its documented features are `manualRemove`,
`reflectionRemoval` and `distractingPeopleRemoval`. The legacy `selectTool("dust")`
identifier also means the overall Remove/Healing tool, not the automatic Dust
subpanel. No supported direct Dust-subpanel selector was found in that reference.
Navigation stays unchanged; no keyboard injection or new Windows automation.

## September 29 source changes; fresh-VM diagnosis pending

The current source uses explicit **On / Off** buttons and separately verifies preset
command capability and readable Dust status. **Reset** remains Dust-only. The new
group is **LRBridge Dust Helpers**; the same preset names and identities remain,
and exact legacy **LRBridge TEST** files are still recognized. The installer migrates
only those known legacy bytes with backups. No installed preset was changed during
development. See [the current findings](SEPTEMBER_29_MANUAL_FINDINGS.md) for the
automated evidence, unknown-state rules and minimum native checks. The reported VM
failure is not diagnosed without its version and exact Dust reason. Historical
captures, acceptances, failures and limitations below remain bounded to their dates.

## Dust completion correction (2026-09-20; manual acceptance FAILED)

**The first correction failed native acceptance on a dust-present photo. The revised correction below is unaccepted until both native cases and ordinary sliders pass.** Preserved lifecycle evidence shows On `rb-258` returned normally at 01:47:27, then reported `applied=true`, `needsAIUpdate=true`, `editable=true`. It waited until 01:48:03 and posted an accepted `unknown` result. `rb-124` shows the same pattern. The SDK call returned; the logged editing-ready signal was true while LRBridge's command worker still held the operation. The blocker was the photo-wide AI-update requirement, which both the pre-patch and first-correction success predicates incorrectly treated as ongoing processing. Subsequent Reset/Close requests were rejected by that same blanket AI check. The first inspection found no pending server operation; the exact earlier browser state was not captured.

The Apply checkbox's **[−]** is its indeterminate state: Dust readback is unavailable or older than five seconds. It does not establish processing or a no-dust result. Previously, Apply On waited for a Dust filter for up to 121 samples at 250 ms even after Lightroom returned without applying one. The shared command worker stayed busy throughout that loop, delaying queued edits and feedback. The controller also discarded its local operation after 12 seconds, before the server's 120-second limit, losing the eventual outcome message.

Apply On reads the documented SDK `photo:isAvailableForEditing()` signal, which reports whether a background operation locks the photo. Four identical, preserved, Dust-absent samples with current AI settings and editing readiness on both sides of each read settle as **not applied**, approximately 750 ms after the first qualifying sample. The message is “Dust was not applied. Lightroom is ready for editing; no detection result was provided.” Missing readiness, an AI-update requirement, or an SDK error cannot produce this result. There is no verified Dust-specific detection-result getter here, so LRBridge never infers **No dust detected** from absent treatment, a normal return, or a timeout. Native `rb-104` reached this result at 01:45:08, one second after the SDK returned, and the server accepted it.

Confirmed On retains its three stable, preserved readbacks and additionally waits while Lightroom explicitly reports the photo locked. SDK exceptions and false returns settle immediately as failures. Unknown feedback and processing that outlasts the observation window remain explicitly unknown. Server acceptance rechecks operation ownership, photo/context/Develop binding, absent treatment, original filter token and preservation/completion evidence. Terminal results release only the finished Dust action's local intent and pending operation; late or old-context responses cannot re-lock it. The browser retains slow Dust On requests for the existing server window and consumes terminal feedback before expiring its local request. There are no retries, fabricated detection results, preset changes or changes to Profile/Lens Blur.

When treatment is stably present and preserved, an AI-update requirement no longer blocks Apply confirmation **if native editing readiness is explicitly true before and after each read**. The result retains “AI settings still need updating in Lightroom”; it confirms the Apply state, not photographic quality or completion of every AI update. Actual locks and unknown readiness cannot qualify for this case. New On dispatch still refuses a pre-existing AI-update requirement, since its preset requests AI updates. Reset uses the inspected Dust-only deletion preset without AI updating, and Close only requests native navigation: these can preserve stale AI on an explicitly editable photo, while retaining all identity, context, token and full preservation checks. Readiness is checked outside LRBridge's own catalog write gate. Close works after Reset too, preserving absent treatment as carefully as present treatment, and continues to report requested rather than claiming the subsection is confirmed closed.

When developer diagnostics are explicitly enabled, sanitized Dust log events distinguish SDK invocation/return, readback transitions, settlement and server result acceptance; readback includes both readiness samples and LRBridge's command-busy flag. Automated mock-SDK/HTTP and isolated-browser checks replay the captured editable/applied/update-needed state, Reset/Close with stale AI, actual locks, unavailable readiness, Close after Reset, unapplied outcomes, failures/unknown feedback, delayed processing, missing evidence, stale responses, photo changes and ordinary Grain Size edits after terminal results. Acceptance remains failed until real Lightroom testing passes; these automated checks do not establish photographic removal quality or populated-AI preservation.

## Earlier native control acceptance; visual removal unassessed

**Accepted 2026-09-16:** the user confirms the updated web controls work, including **Apply On/Off, Reset and Close**, alongside the previously accepted Size and visualization controls. The [local checkpoint and preset restoration record](HEALING_CHECKPOINT.md) lists the required native files, fingerprints, backup and remaining limitations. The historical diagnostic instructions below are not requests for another test.

**Menu cleanup 2026-09-17:** all six temporary Dust commands have been removed from normal File > Plug-in Extras. `CaptureDust.lua`, `CaptureDustControls.lua`, `TestDustPaste.lua`, `TestDustPreset.lua`, `ObserveDustReset.lua` and `ObserveDustClose.lua` remain development utilities, with their supporting modules and tests. Their historical menu instructions below describe the completed investigations, not the current menu. Production `Dust.lua`, its shared helper dependencies, the native LRBridge Dust On/Off presets and the Healing-checkpoint backups are unchanged. LRBridge Help and Start LRBridge Polling remain registered. Reload the LRBridge plug-in once to clear the old diagnostic menu.

The user has explicitly removed photographic quality from acceptance. Visual removal on the smoke photo is **unassessed** and does not block control work. Required behavior is web control changes reaching the corresponding native Lightroom control, native changes synchronizing back wherever SDK readback supports it, and unrelated edits remaining intact. The prior visual-verdict requirements below are historical and superseded by this scope. Do not repeat the successful SDK paste experiment to obtain a photographic verdict.

The compact **Healing → Distraction Removal → Dust** subsection reuses the accepted shared **Size**, **Visualize Spots** and integer **Threshold** controls, retaining their command/gesture/context safeguards. They do not require People or Reflections Apply. **Apply On and Off** now use the two inspected native presets, without a prepared clipboard. The checkbox follows SDK Dust-filter readback; unknown state is indeterminate. **Reset** uses the same Dust Off operation, matching the observed native Reset. Reset and Close remain side by side with 44px touch targets. The Size→25 and Threshold→50 row resets remain separate LRBridge preference defaults.

**Close** invokes documented `goToRemove(nil, "manualRemove")`, retaining the last Healing mode and all edits. It never selects `loupe`, clears Dust, or merely collapses the browser section. The user has now accepted the web operation's native subsection collapse with overall Healing remaining open. The SDK exposes no active-Dust-panel getter, so successful dispatch with full preservation still reports **requested**, never a fabricated Closed/confirmed state. A no-effect SDK call cannot be distinguished from collapse by the captured settings; that specific readback limitation remains visible in the controller.

### Completed On, Reset and Close evidence

| Exact capture | Observed result |
| --- | --- |
| `lrbridge-dust-preset-20260916-025610.jsonl` | Completed at 03:02:58. One SDK On-preset call returned normally with no return value; stable Dust-filter presence and user-confirmed checked Apply establish On state. Other 172 Develop fields and one manual Healing repair remained unchanged. User clicked neither Reset nor Close in this run. |
| `lrbridge-dust-reset-20260916-032326.jsonl` | Completed at 03:25:34. User clicked the small Dust Reset once. Only Dust data disappeared; manual repair/preferences/other settings survived, Healing stayed open. Final complete fingerprint matches the pre-On baseline. |
| `lrbridge-dust-close-20260916-033201.jsonl` | Valid baseline and three valid snapshots; completed at 03:32:22. User clicked Dust's own Close: subsection collapsed, main Healing controls became active. All 173 Develop settings, Dust treatment, manual repair and preferences stayed identical; overall selected tool remained `dust`. |

These captures did not contain existing other AI filters or masks, so preservation of populated AI adjustments remains guarded but not natively exercised. Source-independent repair generation is also unproven: the On source/destination may be virtual copies and share several repair regions/input digests. No captured coordinates or raw FilterList are replayed by LRBridge; it applies the actual user-authored native preset with AI updating. Do not repeat the successful On proof for a visual-quality verdict or to test Close.

### Completed controls capture and saved presets

Exact file: `lrbridge-dust-controls-20260916-014351.jsonl`. Valid baseline **01:43:51**, 26 later valid samples, normal completion **01:47:59**, no failed reads or truncated fields. The selected photo and Develop module remained consistent.

| Native action | SDK observation |
| --- | --- |
| Size→37 | Shared `brushSize`: 62.655→3→37 (the intermediate 3 was also sampled) |
| Visualize Spots on | Shared `visualizeSpots`: false→true |
| Threshold→64 | Shared `visualizationThreshold`: 51→64 |
| Apply unchecked | At 01:45:21, the single Dust filter disappears from `FilterList`; the other 171 Develop settings stay unchanged |

Both named presets appear in the controls capture and their saved XMP definitions were inspected in the CameraRaw Settings folder, group **LRBridge TEST**. **On** includes source-photo bounds, `ProcessVersion=15.4`, and a **1,776,747-character opaque table** absent from the SDK getter summary. LRBridge applies the real native preset object, never reconstructs that incomplete getter. Its exact inspected MD5 is `ca1e4c9e0e49724b8fd9167c496026ba`; On is available only on ProcessVersion15.4 so it cannot migrate the destination process version. The accepted one-shot SDK proof supplies the control/state evidence above; it does not establish arbitrary-photo redetection.

**Off** contains a native Dust `IsSignalForDelete=true` marker and a 302-character table, without ProcessVersion or unrelated edit categories. The implementation locates **LRBridge Dust Off**, checks its exact inspected file digest and deletion scope, and uses documented `photo:applyDevelopPreset(preset, nil, nil, false)` once inside a synchronous catalog write gate. AI updating is disabled. It binds the original photo/catalog/module/tool, revalidates queue/context/revision and full before-state, rejects pending AI updates and changed/missing/duplicate presets, and compares every unrelated Develop field, non-Dust filter, manual repair and shared preference after the call. Only absent-Dust readback plus preservation confirms Off. There is no automatic retry or rollback. SDK return alone cannot confirm state.

This supports the observed **Lightroom 15.4.1** filter schema and pinned On/Off artifacts; replacing either requires inspection. The existing Off controller was accepted by the user. New On dispatch uses `applyDevelopPreset(preset, nil, nil, true)` once, rejects pending AI before invocation, then requires three stable matching-state reads with AI current and complete preservation. The server allows On processing up to 120 seconds; timeout is unconfirmed and never retries. SDK exceptions are caught inside the catalog gate without automatic rollback. Close compares the entire Dust/settings state too, since navigation must preserve treatment.

### Accepted loading state

The production Dust server/browser/plug-in behavior has been loaded and accepted by the user. The later menu cleanup requires one plug-in reload to clear cached diagnostic entries; no repeat preset application or new capture is needed. Restoration into another checkout is covered by the dependency record above; it requires loading that checkout's plug-in once and starting its server/controller. Keep arbitrary-photo redetection and populated-AI preservation outside the accepted claim.

Checkpoint verification passes 74 Dust HTTP/queue/Parser/Lua scenarios plus On timeout, including missing/changed presets, actual state confirmation, preservation categories, Close requested-only results and no retries. Dust and Healing/People/Reflections browser runs, the retained mock-SDK/diagnostic suites, Lua/JS syntax and polling checks also pass. The attempted full suite and three separate checks retain the existing failures listed in the [checkpoint record](HEALING_CHECKPOINT.md#checkpoint-checks); protected cheat sheets remain unchanged. Historical capture instructions below are retained as evidence, not a request to rerun them.

### Completed single SDK paste

The exact local `lrbridge-dust-paste-20260916-010216.jsonl` completed at **01:05:34**, with sample 361 and a finished record at 362. It includes a valid baseline, final validation, 22 observation samples, one SDK invocation and a true return. Only `FilterList` changed; the remaining 171 Develop fields and all monitored preservation fingerprints stayed unchanged, with no pending AI-update state. The baseline contained no manual repairs or non-Dust filters, limiting those preservation conclusions. The destination's single `(1072,3307)-(1183,3417)` region differs from the source capture's two regions at the same recorded dimensions/crop/orientation; input digests match. These results support destination-specific processing and an SDK paste path, not confirmed Apply checkbox semantics or an independent Controller implementation. The `20260916-005717` read-only capture followed a manual paste and is not SDK proof.

### Original controls capture sequence (completed; retained reference)

Adobe's [15.3 preset fix discussion](https://community.adobe.com/bug-reports-674/p-creating-a-preset-with-just-remove-selected-fails-1552164) includes Dust among native preset categories. This supports the native-preset investigation but supplies no safe Dust settings schema or SDK on/off contract. Do not construct a filter-ID command, copy another photo's repair coordinates, or treat `EnableDistractionRemoval` as a Dust-only toggle.

The new **File → Plug-in Extras → Capture Dust controls (read-only)** reuses the working launch/baseline/observation flow. Reload the production plug-in **once** to load this menu item. On the already Dust-treated test photo, follow this control-only sequence:

1. If Create Develop Preset offers Dust separately, save **LRBridge Dust On** with **only Dust selected**, leaving Apply checked.
2. Run **Capture Dust controls (read-only)** and wait for **Dust controls capture ready**.
3. Set native Dust **Size→37**, wait three seconds; enable **Visualize Spots**, set **threshold→64**, wait three seconds; then uncheck native **Dust Apply once**.
4. If the Dust-only preset option exists, save **LRBridge Dust Off** with **only Dust selected** after unchecking Apply. Keep the same photo selected and make no further photo edits until **Dust controls capture finished**.

No paste, reapplication or image-quality judgment is requested. The diagnostic itself performs reads/module navigation only. It records the same SDK settings and preferences, plus the native definitions/file paths of only the two explicitly named presets at baseline/end. Missing/unreadable presets are recorded separately and do not invalidate the control capture. The existing summarizer now includes preference changes, selected-tool changes and named preset evidence:

```powershell
node scripts/summarize-dust-capture.js (Join-Path $env:TEMP '<exact-lrbridge-dust-controls-filename>')
```

The saved definitions and control mappings were subsequently inspected and implemented as described above. Their mere existence was insufficient; the completed SDK On and native Reset/Close evidence now defines the implementation and remaining limits.

Use the current loading and native acceptance sequence above. The original controls capture does not need to be repeated.

Focused checks pass: the read-only diagnostic and 21 startup/error cases; all 37 mock-SDK paste cases using the updated summarizer; isolated Dust and People browser checks, including touch widths; SDK Lua compilation and JavaScript syntax. The completed native paste/source files were also re-read with the updated summarizer. People production files and unrelated pre-existing work are unchanged. These checks do not replace native control acceptance.

## SDK background

The installed Lightroom executable reports **15.4.1 (202606201310-b9f148a4)**. The installed reference is SDK **15.3**. No dedicated automatic sensor-Dust API was found in its API reference. `getSelectedTool()` / `selectTool("dust")` describe the overall Healing/Remove tool; that identifier does not invoke automatic Dust detection.

Adobe's current [Dust instructions](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/distraction-removal-dust.html) document automatic removal and per-photo redetection when **native Dust settings are pasted**. They do not establish equivalent behavior for an arbitrary SDK settings table. The accessible [newer release documentation](https://helpx.adobe.com/lightroom-classic/desktop/troubleshooting/fixed-issues.html) supplies no dedicated Dust SDK contract. The official [SDK landing page](https://developer.adobe.com/lightroom-classic) sends downloads to the Developer Console; that page did not expose a retrievable newer API reference during this investigation. This is an access/evidence limit, not proof that no newer SDK exists.

## Controlled SDK paste proof (completed; retained diagnostic design)

**File → Plug-in Extras → Test Dust-only SDK paste (one shot)** runs `TestDustPaste.lua`. It is separate from the working read-only capture. It never copies settings, creates a preset, reconstructs `FilterList`, applies a settings table, selects another photo or invokes native Dust Apply. Its sole photo-write call is documented `photo:pasteSettings(true)`, once, inside a synchronous catalog write gate in an SDK task. The user must explicitly confirm that the clipboard has been prepared with only Dust; the plug-in cannot inspect the clipboard.

The command retains the menu-entry catalog/photo and reads the UUID inside the task. If needed it navigates to Develop once on that same photo. Two stable before-state reads are required, including full-content fingerprints of every Develop field, the complete manual-spot inventory, shared Remove preferences, all non-Dust filters and their enclosing data. Readable summaries reuse `DustDiagnostics`; large summaries may be shortened, but full fingerprints include every value or reject unsupported/oversized data. Existing automatic Dust, pending AI updates, another diagnostic or an LRBridge command prevent dispatch. Unreadable preservation data also prevents dispatch.

A valid baseline is written/flushed before **Prepared - paste once** can be offered. The confirmation is an explicit user assertion of Dust-only clipboard preparation, not a claim of SDK verification. Inside the write gate, the original context and complete before-state are checked again. The invocation is recorded/flushed before dispatch, and a session latch blocks further attempts even if the SDK throws or returns false. Those outcomes are recorded separately from the subsequent observations. No automatic retry, rollback, broad AI-update call or success claim is made. The user must not reload/relaunch to bypass the one-attempt guard.

The test observes the same destination for approximately three minutes after SDK return, then shows **Dust SDK paste capture finished**. A module/photo/command change stops observation without changing selection or retrying the paste. Any already-dispatched paste may still be running in Lightroom. The end of the observation window is not a native completion signal. Failures preserve the sanitized failing step and whether dispatch was attempted; capture-file failures never authorize another paste.

### Original native sequence (completed; do not repeat for a visual verdict)

1. Fully quit **LRBridge**, including its tray process, to isolate this proof from background/queued commands; keep Lightroom open. Reload the production **LRBridge.lrplugin once** to load the new menu command.
2. On the Dust-treated **source** in Develop, choose **Settings → Copy Settings**. Clear all categories, then select **only Remove → Dust** and click **Copy**. Do not select the entire Remove category or any other edit category.
3. Select a disposable **different destination photo**, or a virtual copy of that different photo, in Develop. It must have dust in different locations, no prior automatic Dust treatment, and no pending AI-update warning. Prefer a destination with existing edits/manual repairs/AI adjustments to test their preservation; an absent adjustment cannot establish preservation for that category. Note the destination's visible dust and existing edits before the test.
4. Run **File → Plug-in Extras → Test Dust-only SDK paste (one shot)**. Choose **Prepared - paste once** only after completing the Dust-only copy above. Do not run the read-only capture alongside it and do not click native Apply or Paste.
5. Keep the same photo selected, make no edits and leave LRBridge closed until **Dust SDK paste capture finished** appears. If stopped, report the exact message instead of retrying.

**Historical proof instructions:** the original test requested visual removal review. That requirement is superseded by the current control-focused scope above; visual removal is unassessed. An SDK true return still does not establish a native Apply checkbox state or preservation of pre-existing edits absent from the baseline.

The completed file is `lrbridge-dust-paste-20260916-010216.jsonl`. Inspect the proof and source with:

```powershell
node scripts/summarize-dust-paste.js (Join-Path $env:TEMP 'lrbridge-dust-paste-20260916-010216.jsonl') (Join-Path $env:TEMP 'lrbridge-dust-capture-20260916-000322.jsonl')
```

The proof summarizer reuses the existing capture summarizer, reports the explicit preparation and SDK invocation/return separately, compares complete preservation fingerprints across all recorded samples (including transient differences), and presents source/destination repair regions for review. It never declares fresh detection or visible removal. A match/difference in input digests alone is not an acceptance criterion.

Focused verification covers 37 mock-SDK proof scenarios, plus the retained read-only diagnostic tests and startup scenarios. Lua SDK15.3 compilation and JavaScript syntax checks pass. These checks validate the diagnostic's gates and evidence handling; the completed native paste evidence is recorded above.

The completed paste supports investigating a native-authored Dust-only preset. Inspect its full settings and preservation behavior before using documented preset application with AI updating. A manually prepared clipboard is not a repeatable controller implementation; no controller Dust Apply/off/reset action is enabled by this proof.

## Native Dust filter evidence: 2026-09-16 00:03:22

Inspected exactly `%TEMP%\lrbridge-dust-capture-20260916-000322.jsonl` with the existing summarizer and a separate comparison of all snapshot fields. The file contains one valid baseline at 00:03:22, 22 valid subsequent samples and normal completion at 00:06:41. All reads were of the same selected photo in Develop. There were no failed reads or truncated settings.

| Observation | Previous no-dust capture, `20260915-233950` | New capture, `20260916-000322` |
| --- | --- | --- |
| Develop fields captured | 172 | 172 |
| Develop settings changes | None | Only `FilterList`, at sample 7 / 00:03:38 |
| `FilterList` | Empty throughout | Empty baseline, then one filter named `Dust Removal` |
| Shared Remove preferences | Unchanged | Unchanged |
| Overall selected tool | `loupe` → `dust` | Unchanged |
| Native outcome reported by user | Lightroom's no-dust message | Apply stayed checked; Size and additional-spots instructions appeared |

The new `FilterList.Filters[1]` contains observed `FilterID=6`, `Name="Dust Removal"`, and a title identifying the Dust Removal panel. The name/title distinguish this data from ordinary Healing. Filter ID 6 is an observation on this 15.4.1 host, not a documented portable API enum. All other 171 Develop settings stayed unchanged, including the general `EnableDistractionRemoval=true` and `EnableRetouch=true` flags. There was no newly exposed, separate Dust Apply boolean.

The filter contains two `Images` entries. They include reference-image rectangles (108×108 and 96×95 regions), alpha/color descriptors, image/input digests and source/destination bounds. This is photo-specific repair data; two entries do not establish that two visible dust spots were successfully removed. `CompressedSettings` references an opaque `Table_...` string of 6,087 bytes. The diagnostic intentionally recorded its length/hash, not the string contents; `truncated=false` means the structural capture limit was not exceeded, not that this opaque payload can be reconstructed or interpreted.

This run establishes native Dust-specific state creation beyond the reported panel change. Neither that state nor the panel proves visually successful removal, and the diagnostic performed no SDK writes. Do not copy this `FilterList` to another photo: it includes source repair data, and replacing a destination's whole filter list could also affect unrelated filters. Removing the obvious rectangles or image records would not establish that the remaining opaque settings are safe or instruct fresh detection.

## Native capture evidence: 2026-09-15 23:39:50

The exact file `%TEMP%\lrbridge-dust-capture-20260915-233950.jsonl` was inspected using the existing summarizer with an explicit path. It has a valid baseline at 23:39:50, 22 valid subsequent samples through 23:43:32 and a normal completion record. All samples retain the same photo in Develop, with no failed samples or truncated settings. Launch records show both menu entry and task start in Develop, so this run did not exercise navigation from Library.

All **172 Develop settings** stayed unchanged. Shared Remove preferences also stayed unchanged: Visualize Spots was false and the raw SDK visualization threshold was 58.6. The only snapshot change was `selectedTool` from `loupe` to `dust` at sample 6 (23:40:24), identifying overall Healing/Remove navigation. The summarizer's `changes` list compares Develop settings only; the tool and preferences were checked separately. General flags `EnableDistractionRemoval=true` and `EnableRetouch=true` stayed unchanged and cannot identify automatic Dust Apply.

The user clicked native Dust Apply and reports Lightroom displayed **“Lightroom wasn't able to find any dust in your photo.”** The diagnostic worked; Lightroom's no-dust outcome comes from that native message, not from the unchanged SDK settings. Actual dust removal remains untested. The capture has no native action/dialog marker and does not establish the exact Apply time or expose a Dust-specific result.

At that checkpoint, the missing evidence was an observable Dust-specific settings delta or repair payload. The newer capture above now supplies that delta, but neither visually successful removal nor a safe SDK command is established. Do not derive a write payload from these unchanged general flags or repeat the same no-dust photo. No plug-in reload is needed for this evidence-only update.

## Supported candidates in the installed SDK

| Method | Documented contract | Dust limitation |
| --- | --- | --- |
| `photo:applyDevelopPreset(preset, plugin, amount, true)` | SDK 15.3 adds automatic AI-setting updates; requires an async task and catalog write gate | Need a native-authored minimal Dust payload and evidence of target-photo redetection/preservation |
| `catalog:applyDevelopPreset(photos, preset, plugin, amount, true)` | SDK 15.3 batch preset application with AI updating | Batch behavior is outside this single-photo task |
| `photo:pasteSettings(true)` | Single-photo paste since SDK 10.3; SDK 15.3 adds AI updating; async task and catalog write gate | Closest documented candidate to native Dust-only paste, but clipboard scope and SDK redetection remain unverified |
| `photo:copySettings()` | Copies the categories already selected in Lightroom's UI; async task; returns success boolean | No settings-category argument; success does not prove that only Dust was copied |
| `catalog:pasteSettings(photos, true)` | SDK 15.3 pastes the current clipboard settings and updates AI settings | Clipboard scope cannot be assumed Dust-only; do not use it blindly |
| `photo:applyDevelopSettings(settings, historyName, flattenAuto)` | Applies a settings table; available since SDK 6.0 | `flattenAuto` does not document Dust redetection or AI updating |
| `photo:updateAISettings()` / `photo:needsUpdateAISettings()` | Updates a photo's AI settings / reports whether updating is needed | Not Dust-specific; neither documents creating a Dust operation on an untreated photo |
| `preset:getSetting()` | Reads native preset settings | Adobe marks settings-table contents experimental and version-sensitive |

These methods predate the installed 15.4.1 host. That establishes API-version compatibility, not proof of Dust behavior. No speculative settings table, copied repair coordinates, global enable toggle or broad reset has been applied.

### Candidate route and remaining validation

The strongest documented connection to fresh detection is **native Copy Settings with only Remove → Dust selected**, followed by paste. Adobe explicitly says detection reruns for each destination photo. The completed SDK `photo:pasteSettings(true)` proof above supports that route but still depends on a user-prepared clipboard. The SDK reference inspected here provides no argument to restrict copy to Dust and no API to inspect the clipboard's Develop-setting categories. Blind paste would risk unrelated edits. No suitable Dust preset was found in the two standard user preset roots inspected; the newer native-preset evidence is recorded above.

A native-authored, inspectable Dust-only preset would be preferable for repeatable operation if Lightroom can supply one that requests redetection without source repair data. `applyDevelopPreset(..., true)` is documented, but its settings schema and Dust behavior are not. The installed reference/samples contain no `FilterList`, `FilterID`, `CompressedSettings` or automatic-Dust schema. The captured filter is result state, not evidence that a minimal table such as `{ FilterID = 6 }` is a supported command.

Any future preset proof must first establish the exact native Dust-only input and its scope, bind the destination identity, save complete pre-operation state, and invoke once without retries. Verify every other Develop field and non-Dust filter, existing manual repairs and shared preferences remain intact. AI-updating methods act on the photo's AI settings generally, so preservation of existing AI edits must also be established. The completed clipboard proof exercised a different destination; it did not test a preset or the Apply-off operation. A successful SDK return is not authoritative Apply-state readback. Visual removal remains unassessed and is not an acceptance requirement.

## Controls

Existing Healing **Visualize Spots**, its integer **Threshold**, and LRBridge threshold **Reset → 50** already use documented shared `getRemovePanelPreferences()` / `setRemovePanelPreferences()` fields. They require neither People nor Reflections Apply. Reuse these controls; 50 is LRBridge's reset default, not a claimed native Dust reset.

Dust Size reuses the shared `brushSize` control verified by the completed capture. Apply On/Off, Dust Reset and Close are implemented and accepted as described above. Overall Healing open/close and existing whole-spot reset remain unchanged; Dust Reset is scoped to Dust treatment.

## Prepared read-only capture

The menu registration uses `LrExportMenuItems`, which adds commands to **File → Plug-in Extras**. The initial registration incorrectly used `LrLibraryMenuItems` (Library menu); it was corrected after the user found File → Plug-in Extras empty. The existing Library polling command remains in place. Lightroom preferences and successful reload logs identify the production plug-in at `D:\Projects\LRBridge\lightroom\LRBridge.lrplugin`.

The first launch subsequently failed with Library grid visible behind a generic warning. That build did not record menu-entry context, so it cannot establish who or what changed modules. The corrected launcher binds the selected photo object and module at menu entry, reads that object's UUID inside its SDK task, and logs both menu-entry and task-start context. If needed, it requests Develop once through documented `LrApplicationView.switchToModule("develop")`. It never selects or restores a photo. Missing/changed selection aborts; two consecutive valid settings reads on the original photo in Develop are required before saving the baseline. Readiness polling is bounded to 100 checks with 0.1-second waits.

**Capture sequence (Develop entry completed successfully above):** after loading the corrected plug-in, select the disposable test photo with Dust Apply initially off (Library or Develop), and choose **File → Plug-in Extras → Capture automatic Dust settings (read-only)**. Wait for **Dust capture ready**; it appears only after a valid baseline has been written and flushed. Dismiss it, then check native **Distraction Removal → Dust → Apply once**. Keep the same photo selected and make no other edits during capture. If startup fails, report the specific warning; do not click Apply. The current diagnostic is already loaded; do not reload for another capture with this version.

The diagnostic records a detached baseline and subsequent SDK settings for up to three minutes in a new `lrbridge-dust-capture-*.jsonl` file in the system temporary directory. It captures version, scalar settings, bounded nested data, hashes of opaque strings and shared visualization preferences. It reports truncation explicitly and stops on photo/module change. It may navigate to Develop, but never changes photo edits, creates/applies presets, applies Dust, pastes settings or changes photo selection. No server restart is needed.

`DustCapture:` entries in the existing `lrplugin-log.txt` record launch context, navigation, readiness and actual sanitized failures. The warning distinguishes missing photo/identity, changed photo, wrong module, unavailable SDK settings and capture-file failures, with the failing step and sanitized detail. Paths/URLs from SDK errors are redacted; logging failure cannot trigger edits or another navigation request. The capture-file path is displayed separately to locate any partial evidence.

Pass the exact capture path to `node scripts/summarize-dust-capture.js <capture-path>` to avoid inspecting a different attempt. First identify the exact Dust-only field changes. Then establish a minimal coordinate-free preset/settings path, validate redetection and preservation on a test photo, and only then enable corresponding Controller actions. SDK return alone must not be reported as successful image removal.
