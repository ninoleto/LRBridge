# Windows v0.6 beta completion review

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

**Testing order:** Help and Builder review is complete. Build and inspect the private portable candidate, then let the user perform fresh-install and Lightroom acceptance. Do not install presets, repoint the plug-in or send live edits automatically.

**Denoise Reset:** The private candidate includes the pending Amount-only Reset to 50. It must keep Denoise on, preserve Raw Details/Super Resolution and wait for Lightroom feedback. Prior model/mock-browser checks passed; actual Lightroom validation remains required.

**Dust setup dependency (2026-09-24 source review):** Adding the plug-in alone on a fresh computer does not enable Dust Apply on/off or Reset. The runtime resolves the exact presets from Lightroom's registered preset inventory; it does not load them directly from the bundled `resources/presets` folder. The separate `Install Dust Presets.cmd` copies them to CameraRaw Settings, and neither app nor plug-in startup runs it. The development computer already had both presets during the September 16 capture, before the packaging/installer checkpoint. Current files match the bundled hashes; the precise save/import action cannot be established from the capture. Isolated missing-preset and installer checks pass, but actual fresh-computer preset discovery and Dust operation after setup remain release acceptance items. Existing working presets were not changed.

**Compatibility boundary:** The private test target is Windows x64 and Lightroom Classic 15.4.1. SDK metadata declares 15.3; that does not establish an overall supported minimum. Dust's current state/Apply/Close code explicitly requires exactly Lightroom 15.4.1, and Apply on also requires photo ProcessVersion 15.4. Other Lightroom versions remain unverified.

1. **Native Quick Copy/Paste:** still unaccepted. On disposable photos, confirm Lightroom Copy → web Paste without preceding web Copy; Quick Copy with deliberately chosen harmless categories; one destination and a small multi-photo selection; same-active-photo selection changes and authoritative history/results. Only the user performs these operations. Batch true does not mean every photo succeeded. Clipboard contents/timing and AI completion cannot be inspected or frozen by the SDK.
2. **Windows clean install and upgrade:** extract into a new writable folder; verify preset discovery, plug-in loading, normal desktop start/quit/tray, polling/reconnection, helper controls and preservation of settings/favorites with the same browser origin. Automated packaged-runtime checks do not replace a clean machine or real Lightroom session. The candidate is unsigned and unpublished.
3. **Packaged integration checks:** confirm the accepted Help/Builder and their reference links load from the extraction, then run a copied command through PowerShell and Companion on a disposable photo. Export acceptance remains limited to the full Export dialog, Previous destination chooser and one selected-photo count. No completed file export or multi-photo Export acceptance is claimed.

Known limits remain documented in [Windows beta notes](WINDOWS_BETA.md): People processing/Cancel; arbitrary-photo Dust redetection and preservation with populated AI/manual edits; broad copied-mask/AI preservation; actual last-component deletion and broader Red Eye reset preservation; native fault/reconnect cases. Historical Healing/Point Color/Blue-curve reports have no current reproduction. `cycle_loupe_info` remains excluded from visible choices because the prior native test had no visible effect. No speculative fixes or disabled working controls were introduced.

The legacy `tests/dust-paste.js` exercises the unshipped `TestDustPaste.lua` research workflow, not the native Quick Copy/Paste implementation. An exploratory run exceeded four minutes; it remains outside the shipping runtime gate. Its earlier one-photo evidence does not establish general clipboard or AI correctness. Production Dust/clipboard guards retain their own focused tests.

This is a local development candidate, not native acceptance or authorization to push, merge, tag or publish.
