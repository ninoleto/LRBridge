# LRBridge Windows v0.6 beta

This beta preserves the accepted controller layout, 71-choice favorites bar, Quick Copy Settings, Paste Settings and native Export buttons. New features are frozen. Lens Blur **+ New Refinement**, named export presets and broader MIDI2LR parity are deferred.

## Install

1. Use Windows x64 and Lightroom Classic **15.4.1** for the tested beta baseline. SDK 15.3 is the plug-in minimum; some features are version-specific. Dust On deliberately requires Lightroom 15.4.1 and photo ProcessVersion 15.4. Other versions are not certified by this beta.
2. Extract the portable ZIP to a new writable folder. Run `Install Dust Presets.cmd` while Lightroom is closed. The installer checks the bundled SHA-256 hashes and will not overwrite a different existing preset. It needs no administrator account or network access.
3. Start `LRBridge.exe`. In Lightroom, open File > Plug-in Manager > Add and select the included `lightroom/LRBridge.lrplugin` folder. Enable it. Restart Lightroom once after installation so the presets and current plug-in are loaded.
4. Open the Web Controller at `http://127.0.0.1:17892`. Confirm the Lightroom connection indicator before editing. On another device use the computer's LAN address shown by LRBridge. HTTP/WebSocket/controller ports are 17891/17890/17892. Use a trusted private network; there is no authentication or TLS. Do not expose these ports to the internet.

Windows PowerShell 5.1 and Windows accessibility/Win32 support are required for the existing Lens Blur and Profile helper. This is an accepted Windows dependency, not an SDK-only release. macOS is a future port, not a supported package.

## Upgrade without losing preferences

Quit LRBridge before upgrading. Extract into a **new folder**, copy your old `config/settings.txt` and, if present, `config/develop-presets.json` into its `config` folder, then add/repoint Lightroom to the new plug-in and restart Lightroom. Keep the old folder until the upgrade is accepted. Do not overwrite your configuration with the example files. Favorites and collapsed sections are saved per browser/device and origin; keep the same browser profile and controller address. Clearing site data or changing the address does not migrate them. The preset installer leaves identical installed presets alone and refuses differing files.

## Everyday controls

- **Favorites:** Undo and Redo are the defaults. Customize to search, add, remove and reorder any of the 71 choices; Restore defaults restores Undo/Redo. Favorites call the original guarded actions. Routine “command sent” notices expire; errors and required review remain accessible.
- **Selection:** Navigate comes first. Export precedes the final Copy / Paste Settings section. **Quick Copy Settings copies values from the active photo using the categories last chosen in Lightroom's Copy Settings dialog. It does not open that dialog and does not copy from the previous photo.** Choose categories directly in Lightroom when necessary. Paste Settings targets the captured complete selection and requests AI updating. Copying directly in Lightroom before web Paste is supported.
- **Export…** opens Lightroom's full Export dialog. **Export with Previous** reuses Lightroom's last export settings and may start immediately or show a destination chooser. A request acknowledgement never means file export completed.
- **Tools:** Crop, Healing, Distraction Removal, Red Eye and Masking share the guarded controller/history controls. Copy/Paste favorites remain photo-level actions on every tab, including Masking.
- **Develop:** numeric sliders, Tone Curve, Color Grading, Lens Blur and supported Profiles use Lightroom feedback. Unavailable is not zero. A pending value or HTTP acceptance is not authoritative completion.

<details><summary>Native acceptance and known limitations</summary>

Native Quick Copy/Paste acceptance is still pending: one photo, multiple selected photos, selection changes with the active photo unchanged, and native-Lightroom Copy → web Paste. SDK batch true means at least one photo, not all photos. The clipboard cannot be inspected or frozen; it is consumed at execution time. AI-needed readback does not establish completed processing, visual correctness or preservation of every existing mask/AI edit. Uncertain operations require review and never retry automatically.

Export acceptance covers the full dialog, Previous destination chooser and a count of one selected photo only. It does not establish file creation, cancellation or multi-photo export.

People removal dispatch is verified, but successful Adobe processing and Cancel remain unresolved; the user saw the same Adobe error in native Lightroom. Return to Healing is not Cancel. Dust controls are accepted within the recorded test scope; arbitrary-photo redetection and preservation beside populated AI edits remain limited. Required Dust presets must retain their inspected bytes. Red Eye/Pet Eye open/reset/close buttons are accepted; per-eye sliders, identity and broad reset preservation are not established.

Masking creation/component actions and adjustments use SDK inventory and target guards. Actual last-component deletion and comprehensive AI preservation still need bounded native evidence. Masking brush Size/Feather/Flow/Density, Auto Mask and related native options are not supported. Healing Selected Repair Reset uses explicit LRBridge defaults (Opacity 100, Feather 50), not claimed Lightroom factory defaults.

Retain the intermittent Healing unavailable/greyed-out report, Point Color Visualize Range availability and historical unreproduced Blue curve report. Cycle Loupe Info remains a known backend compatibility limitation and is excluded from the Builder/controller choices. These are not newly reproduced failures.

</details>

<details><summary>Lens Blur and Profile Windows dependencies</summary>

Apply, Blur Amount/Cat Eye/Boost with resets, Bokeh and Focus Range editing use SDK writes/readback. Subject and Point/Area activation, refinement disclosure/modes/sliders/resets and Auto Mask use the Windows helper. Visualize Depth uses an SDK mutation with Windows checkbox readback. Native button availability and layout/language/version changes can affect the helper. Subject highlighting is reconciled from SDK ranges/source and action history; the raw source value alone is not a reliable active flag. + New Refinement is deferred.

Profile choices and native fallback labels use Windows accessibility inventory. Supported profile application and Profile Amount use SDK operations; unsupported profiles remain readback-only. The combined Profile availability model still depends on native inventory. Windows automation is retained as implemented; no new automation or macOS equivalent is introduced by release preparation.

</details>

## HTTP and development

The HTTP Builder covers ordinary command URLs and provides an operation inventory for guarded workflows. It does not turn context-dependent actions into permanent URLs. See [HTTP workflows](HTTP_WORKFLOWS.md) and [generated operation inventory](HTTP_OPERATIONS.md).

Developers: Node.js 24 LTS, `npm ci`, then `npm run test:release` (includes the `npm test` checks) and `npm run test:release -- --browser`. Fengari is a locked test-only dependency; `LRBRIDGE_LUA_TEST_RUNTIME` is an optional override. Browser checks use installed Edge/Chrome or `LRBRIDGE_CHROMIUM_PATH`; they use isolated temporary profiles and mock HTTP/SDK state, never production photos. `npm run dist:win` builds from fresh sanitized staging. Do not run live smoke tests as an automated release gate.

Final native and clean-install/upgrade checks are recorded in [the completion review](RELEASE_REVIEW.md) and CODEX_HANDOFF.md. A local candidate is not a published release.
