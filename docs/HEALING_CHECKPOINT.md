# Healing / Distraction Removal local development checkpoint

## Acceptance and limits — 2026-09-16

The user tested and accepted the current Dust web controls, including Apply On/Off, Reset and Close, following earlier acceptance of Size, Visualize Spots and the integer visualization threshold. Acceptance concerns controlling Lightroom and synchronizing supported native state; visual dust removal remains **unassessed**. This is a local development checkpoint, not a release or a claim that every Healing feature is complete.

- **People Cancel remains unresolved.** The inspected SDK has no documented equivalent; neither returning to manual Healing nor closing Healing is Cancel.
- **People removal dispatch is verified; successful Adobe processing is unverified.** Existing logs show SDK removal invocation for `pp-71` at 2026-09-15 22:54:44. The user reported the same native Lightroom error through web Remove and Lightroom Remove. The narrow inventory repair ignores only regenerated `spots[*].CorrectionID` and `spots[*].CorrectionMasks[*].MaskID`; count, all other target data, photo/context/revision bindings, duplicate rejection and no automatic removal retries remain.
- **Dust depends on the exact inspected native presets below and the tested host/process version.** No dedicated documented automatic-Dust API was found in the installed SDK. The legacy selected-tool identifier `dust` means overall Healing/Remove.
- **Arbitrary-photo redetection and preservation alongside populated other AI adjustments are not fully established.** The observed source/destination could be virtual copies; the native preservation captures contained one manual Healing repair but no populated other AI filters/masks. Runtime checks reject changed unrelated data; this is not broader native validation. LRBridge applies the actual native preset; it does not reconstruct or replay captured repair coordinates.
- **Dust Close has native user acceptance, but no SDK subsection-state getter.** `goToRemove(nil, "manualRemove")` leaves overall Healing open and preserves treatment. The controller still reports a navigation request with preservation checks, not an authoritative collapsed-state boolean.

The checkpoint also retains the existing compact Healing layout, Selected Repair parameter resets and Reflections/People controllers. It does not promote their previously recorded processing, reset/cancel or native-panel limitations to complete features. No additional reload or native capture is required merely to make this checkpoint.

**Later menu cleanup (2026-09-17):** the Red Eye checkpoint removes the temporary Dust and eye-capture registrations from normal File > Plug-in Extras. Diagnostic source is retained for development, including shared modules required by production Dust. This does not remove or change any preset, runtime dependency or backup below. Reload LRBridge once to clear those menu registrations; the accepted Dust behavior and preservation limits above remain unchanged.

## Required native preset dependencies

At this historical checkpoint both presets were uniquely named in native group **LRBridge TEST**. Current source bundles the same identities under **LRBridge Dust Helpers** and recognizes both exact original and renamed files. Use the current installer for a group-only migration; do not import duplicate copies. The fingerprints below describe the original checkpoint files. Saved definitions are under **`C:\Users\nino\AppData\Roaming\Adobe\CameraRaw\Settings\`** (`%APPDATA%\Adobe\CameraRaw\Settings` on this installation).

| Native name / filename | Bytes | MD5 used by LRBridge | SHA-256 for backup verification |
| --- | ---: | --- | --- |
| `LRBridge Dust On` / `LRBridge Dust On.xmp` | 1,779,392 | `ca1e4c9e0e49724b8fd9167c496026ba` | `f13f23d7616ef06ff48cc8b93ac9d4197cbad009c9d6f75550ea2a47aee42301` |
| `LRBridge Dust Off` / `LRBridge Dust Off.xmp` | 2,878 | `6222ed7b14ec731f0d114e24d9bea1d4` | `99f7e11633cfd71d701cf80356117c5fab360b27ad806eec3627dbe456f3abbc` |

The tested host is **Lightroom Classic 15.4.1**, executable build **202606201310-b9f148a4**; the inspected SDK/compiler is **15.3**. Runtime guards require host version 15.4.1; they do not separately pin the executable build. Apply On additionally requires the destination's existing **ProcessVersion `15.4`**, avoiding a process-version migration. Preset On includes opaque native Dust data and source bounds; Off includes the native Dust deletion marker. Neither file may be regenerated from its incomplete SDK settings summary. Renamed, missing, changed or duplicate presets fail closed.

On uses `photo:applyDevelopPreset(preset, nil, nil, true)` once, then requires stable Dust state, no pending AI update and preservation checks. Off/Reset use the inspected deletion preset without AI updating and require absent-Dust readback with preservation. An SDK return alone is insufficient; there are no automatic retries or rollbacks.

## Local backup and restoration

The local-only backup is **`D:\Projects\LRBridge\local-checkpoints\healing-20260916\`**, ignored by Git. It contains:

- `presets\LRBridge Dust On.xmp` and `presets\LRBridge Dust Off.xmp`: byte-for-byte verified copies of the native dependencies.
- `manifest.json`: original paths, names/group, sizes, fingerprints, tested versions and final checkpoint commit hash.
- `checkpoint.bundle`: the checkpoint commit and its reachable Git history, independently verifiable with `git bundle verify`.
- `README.md`, checkpoint check logs and the previous handoff for local reference. These files are not published or included as preset payloads in the source commit.

To restore into a separate directory, clone the bundle (`git clone <backup>\checkpoint.bundle <new-directory>`), then select the commit named in `manifest.json`. This restores the committed source, not unrelated uncommitted local work, Lightroom catalogs, images, application binaries or the external Lua test runtime.

Before restoring presets, verify their SHA-256 values against the table/manifest. With Lightroom closed, preserve any existing conflicting preset files separately and restore the exact two copies into the CameraRaw Settings directory above; do not overwrite other presets. Start Lightroom and confirm the unique names in **LRBridge TEST**. If already present and matching, do not import duplicate copies. Preserve file contents and embedded metadata; do not recreate them through a settings-table write. Use the tested host/process version. Register the restored `lightroom\LRBridge.lrplugin` path, reload it once, then start LRBridge and refresh the controller. A restored or different host still needs its own native acceptance; these backups do not establish compatibility beyond the recorded environment.

Keep this directory with the local development backup. Git alone, or a copy of this repository without the ignored directory, does not contain the required XMP dependencies.

## Checkpoint checks

Passed: focused Dust (74 scenarios plus On timeout), People inventory/workflow, Reflections (46), Healing (177), isolated Healing/People/Reflections and Dust browser runs, all four Dust diagnostic suites, shared history/proxy/sliders/queue/polling checks, JavaScript/JSON/inline Controller/SDK Lua syntax and diff checks. The only checkpoint-time test correction adds the three existing Dust commands to queue-diagnostics expectations; accepted production code is unchanged.

Known failures remain:

| Check | Actual result |
| --- | --- |
| `npm test` | Exits 1 in `masking-phase4-completion.js`: existing `Delete every mask on the selected photo?` wording assertion. The remaining npm sequence is not run. |
| `node tests/contract-baseline.js` | Exits 1: protected Companion document lacks `LensBlurAmount`. |
| `node tests/controller-command-tabs.js` | Exits 1: existing Crop Angle polling expression assertion. |
| `node tests/controller-section-collapse.js` | Exits 1: existing scrollbar-gutter assertion. |

These are retained as failures, not waivers or a full-suite pass. Exact output is in the local backup logs. Protected Companion cheat sheets and local configuration are excluded from this commit.
