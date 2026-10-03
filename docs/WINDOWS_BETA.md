# LRBridge Windows v0.6 beta

**Final October 3 UI acceptance:** Calibration's Shadows, Red Primary, Green
Primary and Blue Primary headings/dividers are accepted. The Tools Jump menu
keeps Crop & Straighten, Healing, Red Eye and Masking in the left column and
Develop Sliders, Presets, Selection and Application in the right column, using
the existing Presets shortcut's blue styling. Narrow screens show the four black
links first, followed by the four blue shortcuts. Other Jump menus and slider
behavior are unchanged.

**October 3 Refine beta acceptance:** The user accepts the current Refine
Saturation behavior as a beta compromise, with further improvement deferred.
The terminal-confirmation and blocked-touch corrections, both Curve implementations
and the accepted Parametric preview are preserved. This is not a claim that all
interaction cases are resolved or newly tested.
Close Masking and Close Healing use the existing red Close style. Global Reset
Transform temporarily greys and disables its slider rows for two seconds from the
tap; current Lightroom availability still governs them afterwards.

**October 1 private test update:** Parametric Curve is manually accepted for this
release, including changed split positions; six matching native references and
regression tests are preserved. Small preview approximation differences remain.
Accepted slider/Reset, Masking, Point Color, lifecycle, Denoise and Dust behavior
remain accepted within their tested scope. The Masking recovery notice explains
using the same Web Controller button for Close Masking and then Open Masking.

**Visualize Depth:** responsiveness is manually accepted for this release; the
user reports that the corrected source now feels fast. Focused native reads and
ordered confirmation remove the measured queue/discovery delay. First use still
includes helper startup. The completed packaged Visualize Depth integration check
is preserved; unchanged implementation inputs do not require another recording.
The user reports that the VM Dust test passed. Preserve this bounded result;
the report does not separately establish legacy migration, duplicate-preset checks
or preservation of manual Healing repairs. Automated installer/migration checks
and their native coverage limits remain separate.

**September 27 accepted source:** the latest Copy/Paste, Export and Enhance reports
are accepted within the user's tested scope, including Denoise Reset and its
availability/appearance/alignment. Earlier accepted Profile, slider feedback,
touchscreen Reset, Point Color and presentation fixes remain intact. See the
[completion review](RELEASE_REVIEW.md) for coverage limits and the remaining manual
package checks. The old private build `20260925T022735Z` is unchanged and does not
contain these updates. This is a fresh private candidate, not a published release.

This beta preserves the accepted controller layout, 71-choice favorites bar, Quick Copy Settings, Paste Settings and native Export buttons. New features are frozen. Lens Blur **+ New Refinement**, named export presets and broader MIDI2LR parity are deferred.

## Install

1. Use Windows x64 and Lightroom Classic **15.4.1** for the tested beta baseline. SDK 15.3 is the plug-in minimum; some features are version-specific. Dust On deliberately requires Lightroom 15.4.1 and photo ProcessVersion 15.4. Other versions are not certified by this beta.
2. Extract the portable ZIP to a new writable folder. Run `Install Dust Presets.cmd` while Lightroom is closed. The installer checks the bundled SHA-256 hashes and will not overwrite a different existing preset. It needs no administrator account or network access.
3. Start `LRBridge.exe`. In Lightroom, open File > Plug-in Manager > Add and select the included `lightroom/LRBridge.lrplugin` folder. Enable it. Restart Lightroom once after installation so the presets and current plug-in are loaded.
4. Open the Web Controller at `http://127.0.0.1:17892`. Confirm the Lightroom connection indicator before editing. On another device use the computer's LAN address shown by LRBridge. HTTP/WebSocket/controller ports are 17891/17890/17892. Use a trusted private network; there is no authentication or TLS. Do not expose these ports to the internet.

Windows PowerShell 5.1 and Windows accessibility/Win32 support are required for the existing Lens Blur and Profile helper. This is an accepted Windows dependency, not an SDK-only release. macOS is a future port, not a supported package.

### Dust preset setup

`LRBridge Dust On.xmp` and `LRBridge Dust Off.xmp` are LRBridge's preset files for controlling Lightroom Classic's existing Dust feature. The explicit **On** button uses Dust On; **Off** and the main Dust **Reset** use Dust Off. The group is **LRBridge Dust Helper — Do not use manually**. Exact earlier copies in **LRBridge TEST** or **LRBridge Dust Helpers** remain recognized; the installer can migrate their group name at the same filenames with backups, preserving preset identities. Do not import duplicates. **Close**, Size, Visualize Spots and Threshold do not use these preset files. Unavailable state feedback is not a command failure: check the Apply checkbox in Lightroom when status cannot be read.

The app includes the files but does not install them automatically. Run the separate `Install Dust Presets.cmd` command from the extracted LRBridge folder while Lightroom is closed. It copies the files into `%APPDATA%\Adobe\CameraRaw\Settings`; reopen Lightroom afterward to load them. The installer leaves identical files alone, backs up and migrates the exact earlier bundled files, and refuses other different files with the same names.

## Upgrade without losing preferences

Quit LRBridge before upgrading. Extract into a **new folder**, copy your old `config/settings.txt` and, if present, `config/develop-presets.json` into its `config` folder, then add/repoint Lightroom to the new plug-in and restart Lightroom. Keep the old folder until the upgrade is accepted. Do not overwrite your configuration with the example files. Favorites and collapsed sections are saved per browser/device and origin; keep the same browser profile and controller address. Clearing site data or changing the address does not migrate them. The preset installer leaves identical installed presets alone and migrates only the exact known legacy files as described above.

## Everyday controls

- **Favorites:** Undo and Redo are the defaults. Customize to search, add, remove and reorder any of the 71 choices; Restore defaults restores Undo/Redo. Favorites call the original guarded actions. Routine “command sent” notices expire; errors and required review remain accessible.
- **Selection:** Navigate comes first. Export precedes the final Copy / Paste Settings section. **Quick Copy Settings copies values from the active photo using the categories last chosen in Lightroom's Copy Settings dialog. It does not open that dialog and does not copy from the previous photo.** Choose categories directly in Lightroom when necessary. Paste Settings targets the captured complete selection and requests AI updating. Copying directly in Lightroom before web Paste is supported.
- **Export…** opens Lightroom's full Export dialog. **Export with Previous** reuses Lightroom's last export settings and may start immediately or show a destination chooser. A request acknowledgement never means file export completed.
- **Tools:** Crop, Healing, Distraction Removal, Red Eye and Masking share the guarded controller/history controls. Copy/Paste favorites remain photo-level actions on every tab, including Masking.
- **Develop:** numeric sliders, Tone Curve, Color Grading, Lens Blur and supported Profiles use Lightroom feedback. Unavailable is not zero. A pending value or HTTP acceptance is not authoritative completion.

<details><summary>Native acceptance and known limitations</summary>

Tone Curve sometimes remains at “Awaiting authoritative Lightroom feedback” after
using Point Color and other adjustments. The cause is unknown and the issue remains
unresolved. This observation does not establish that the preceding adjustment caused
it. Do not automatically reset photos as a workaround. Current Refine Saturation
behavior is accepted as a beta compromise; further improvement is deferred. The
latest accepted Masking recording covers 18 complete drags and five blocked touches,
with an incomplete startup fragment; it does not provide native Reset coverage.

The user reports Copy/Paste working in the cases tested, with no problems observed. The report does not enumerate photo counts, same-active-photo selection changes or other edge cases; do not claim those as additional native coverage. SDK batch true means at least one photo, not all photos. The clipboard cannot be inspected or frozen; it is consumed at execution time. AI-needed readback does not establish completed processing, visual correctness or preservation of every existing mask/AI edit. Uncertain operations require review and never retry automatically.

The latest Export report says the tested cases work with no problems observed. Earlier specific acceptance covers the full dialog, Previous destination chooser and a count of one selected photo. The latest report does not specify file creation, cancellation or multi-photo export, so those are not newly claimed as tested.

Denoise, Raw Details and Super Resolution are accepted for the tested behavior. Denoise Reset requests Amount 50 through the existing Amount command and waits for Lightroom feedback; it does not toggle Denoise. Amount controls are grey and disabled while Denoise is off/unavailable, and remain adjustable at 50 when On. Reset may be disabled at 50 independently of Amount and the checkbox.

People removal dispatch is verified, but successful Adobe processing and Cancel remain unresolved; the user saw the same Adobe error in native Lightroom. Return to Healing is not Cancel. Dust controls are accepted within the recorded test scope; arbitrary-photo redetection and preservation beside populated AI edits remain limited. Required Dust presets must retain their inspected bytes. Red Eye/Pet Eye open/reset/close buttons are accepted; per-eye sliders, identity and broad reset preservation are not established.

Masking creation/component actions and adjustments use SDK inventory and target guards. Actual last-component deletion and comprehensive AI preservation still need bounded native evidence. Masking brush Size/Feather/Flow/Density, Auto Mask and related native options are not supported. Healing Selected Repair Reset uses explicit LRBridge defaults (Opacity 100, Feather 50), not claimed Lightroom factory defaults.

Masking Radial Gradient Feather and Color Range Refine also remain manual; the
latter is distinct from the supported Refine Saturation adjustment. Red Eye
Pupil Size and Darken must be adjusted directly in Lightroom.

Remove → Selected Add/Subtract are Experimental Windows automation, may stop
responding and do not report the active mode. If they fail, use Lightroom's
buttons. The private-package test reported recovery after resetting Spot Removal;
that is diagnostic evidence, not a recommended workaround, because reset can
clear corrections.

Retain the intermittent Healing unavailable/greyed-out report, Point Color Visualize Range availability and historical unreproduced Blue curve report. Cycle Loupe Info remains a known backend compatibility limitation and is excluded from the Builder/controller choices. These are not newly reproduced failures.

</details>

<details><summary>Lens Blur and Profile Windows dependencies</summary>

Apply, Blur Amount/Cat Eye/Boost with resets, Bokeh and Focus Range editing use SDK writes/readback. Subject and Point/Area activation, refinement disclosure/modes/sliders/resets and Auto Mask use the Windows helper. Visualize Depth uses an SDK mutation with Windows checkbox readback. Native button availability and layout/language/version changes can affect the helper. Subject highlighting is reconciled from SDK ranges/source and action history; the raw source value alone is not a reliable active flag. + New Refinement is deferred.

Create New Refinement in Lightroom: the installed SDK has no documented creation
action. Focus-mode feedback can lag or be unavailable; there is no guarantee of
an always-correct active highlight. Focus Range near/far remains on the SDK path.

Profile choices and native fallback labels use Windows accessibility inventory. Supported profile application and Profile Amount use SDK operations; unsupported profiles remain readback-only. The combined Profile availability model still depends on native inventory. Windows automation is retained as implemented; no new automation or macOS equivalent is introduced by release preparation.

</details>

## HTTP and development

The HTTP Builder provides searchable SDK/WIN UI cards with URLs and complete PowerShell requests/scripts. Scripts fetch fresh context when required and preserve confirmations and result handling. See [HTTP workflows](HTTP_WORKFLOWS.md) and [generated operation inventory](HTTP_OPERATIONS.md).

Developers: Node.js 24 LTS, `npm ci`, then `npm run test:release` (includes the `npm test` checks) and `npm run test:release -- --browser`. Fengari is a locked test-only dependency; `LRBRIDGE_LUA_TEST_RUNTIME` is an optional override. Browser checks use installed Edge/Chrome or `LRBRIDGE_CHROMIUM_PATH`; they use isolated temporary profiles and mock HTTP/SDK state, never production photos. `npm run dist:win` builds from fresh sanitized staging. Do not run live smoke tests as an automated release gate.

Final native and clean-install/upgrade checks are recorded in [the completion review](RELEASE_REVIEW.md). A local candidate is not a published release.
