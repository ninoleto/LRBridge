# macOS porting starting point

This is a source-checkout guide for developers and AI agents, not macOS installation
instructions or a claim of macOS support. It documents the current implementation
and a proposed porting sequence; it does not authorize implementing the port.

## Current status and evidence

As of October 1, 2026, LRBridge's v0.6 release candidate is **Windows-tested**. The
current private release baseline is Windows x64 with Lightroom Classic 15.4.1.
No macOS package or completed macOS validation is established by this repository.
The plug-in's SDK 15.3 metadata does not establish an overall supported Lightroom
minimum, or certify any macOS version or processor architecture.

Start with the [Windows guide](WINDOWS_BETA.md) and
[release review](RELEASE_REVIEW.md) for the scope of existing results. The accepted
Windows runtime includes the slider/Reset, Masking, plug-in lifecycle, Denoise,
Dust, Point Color, Parametric Curve and Visualize Depth corrections. Those results
remain accepted within their recorded scope; they are not macOS test results.
The production baseline reviewed for this guide is commit `98c38ba`; consult
current source and tests when later changes supersede it.

All macOS work below is **proposed and untested**. Links refer to committed source,
tests and public documentation in this repository; no private recording or local
diagnostic setup is required to understand the contracts.

## Architecture and source map

| Layer | Current responsibility and source |
| --- | --- |
| Electron desktop app | [Main process](../app/main.js), [preload](../app/preload.js) and [renderer](../app/renderer.js) manage the window, tray, settings and application actions. The main process embeds the bridge and serves the Web Controller. [Desktop shutdown](../app/desktop-shutdown.js) and [Controller server lifecycle](../app/controller-server-lifecycle.js) coordinate cleanup. |
| HTTP server and queue | [Runtime entry](../bridge.js) starts [the server](../server/bridge.js) and supplies the native backend. [Commands](../server/commands.js), [context](../server/context.js), [slider metadata](../server/sliders.js) and [configuration](../config/sliders.json) provide queueing, validation and state. Default ports are HTTP 17891 and WebSocket 17890; the desktop app serves the Controller on 17892. |
| Web Controller | [Controller HTML](../app/controller.html) contains shared controls and slider coordination; feature modules include [Point Color](../app/controller-point-color.js), [Masking](../app/controller-masking.js), [regular Masking corrections](../app/controller-masking-corrections.js) and [Tone Curve](../app/controller-tone-curve.js). The [proxy](../app/controller-proxy.js) forwards Controller requests to the bridge. Browser rendering is reusable, but capability and input behavior still need macOS/browser verification. |
| Lightroom Lua plug-in | [Manifest](../lightroom/LRBridge.lrplugin/Info.lua), [initialization](../lightroom/LRBridge.lrplugin/PluginInit.lua), [shutdown](../lightroom/LRBridge.lrplugin/PluginShutdown.lua) and [polling lifecycle](../lightroom/LRBridge.lrplugin/PollingLifecycle.lua) own workers. [Command polling](../lightroom/LRBridge.lrplugin/AutoStartPolling.lua), [feedback polling](../lightroom/LRBridge.lrplugin/FeedbackPolling.lua), [commands](../lightroom/LRBridge.lrplugin/Commands.lua), [driver](../lightroom/LRBridge.lrplugin/Driver.lua) and [queries](../lightroom/LRBridge.lrplugin/Query.lua) connect the server to Lightroom SDK operations. Feature modules enforce their own context and SDK requirements. |
| Presets and configuration | [Dust manifest](../resources/presets/manifest.json) identifies the two bundled XMP presets. [Dust](../lightroom/LRBridge.lrplugin/Dust.lua) and [preset validation](../lightroom/LRBridge.lrplugin/DustOnPreset.lua) implement their use. [Plug-in settings](../lightroom/LRBridge.lrplugin/Settings.lua), [desktop settings](../app/desktop-settings.js) and the main process must agree on writable configuration paths. |
| Windows native helpers | [Node backend](../server/windows-lightroom-native.js) owns PowerShell child processes. [Windows helper](../server/windows-lightroom-native.ps1) and [Selected-control identification](../server/windows-remove-selected-identification.ps1) provide Windows-specific native reads/actions. These are not Lightroom SDK implementations. |
| Packaging | [Builder configuration](../electron-builder.yml) and [Windows staging tool](../tools/build-windows-candidate.js) produce the portable Windows artifact, production plug-in closure, sanitized defaults and manifest checks. [Dust installer](../tools/install-runtime-presets.ps1) and its [launcher](../Install%20Dust%20Presets.cmd) are Windows-specific. |

**Execution:** Controller or external HTTP client → route validation and queue →
plug-in command poll → context revalidation → SDK operation. Some operations use
the Windows helper instead. HTTP acceptance is not proof of execution.

**Feedback:** SDK reads/results → plug-in feedback → server state and revision →
Controller-owned confirmation/display. Some feature states instead require native
helper readback. Trace both directions before declaring a feature portable.
The [HTTP workflows](HTTP_WORKFLOWS.md) distinguish public actions from internal
plug-in protocol; [HTTP operations](HTTP_OPERATIONS.md) inventories the routes.

## Portability inventory

"Reusable" below means a candidate for reuse, not verified on macOS. An SDK call
alone does not prove that its admission checks, feedback or surrounding paths work.

| Area | Command execution | Feedback / dependency | Proposed macOS treatment |
| --- | --- | --- | --- |
| Server, queue, HTTP and browser UI | JavaScript validation, queueing and transport | Ordered SDK/native results and browser ownership | Reuse contracts and modules. Verify network lifecycle, unavailable capabilities, touch browsers and public clients. |
| General sliders, SDR, Color Grading, Tone Curve and Enhance | SDK feature operations and range-specific conversions | SDK state/confirmation with photo and Develop ownership | First SDK-based candidates. Verify actual SDK behavior, supported photos, ranges and nonzero Reset defaults. Preserve the separate feature coordinators. |
| Regular Masking and Point Color | SDK operations bound to photo, mask/component and swatch | SDK feedback and per-edit results; Visualize Range has limited toggle-state feedback | Verify selected-context behavior on macOS. Preserve command-only/unknown-state presentation where no authoritative getter exists. |
| Lens Blur main SDK controls | SDK Apply, amount, Bokeh and Focus Range paths | Feature-specific state, delayed Apply status and documented Focus Range limitations | Evaluate each control separately using [Lens Blur Lua](../lightroom/LRBridge.lrplugin/LensBlur.lua) and the [Focus Range findings](LENS_BLUR_FOCUS_RANGE_STATE_AND_LIMITATIONS.md). Do not enable all Lens Blur controls from one SDK capability. |
| Lens Blur Visualize Depth | SDK toggle after explicit-state admission | Windows checkbox reads establish current state and confirm the result | Unavailable in an SDK-only macOS version until a verified state path exists. See the concrete trace below. |
| Lens Blur Subject/Point and refinement native controls | Windows native actions | Windows control discovery/readback and context validation | Keep the Windows-dependent controls unavailable. Native macOS equivalents are a later, separately verified task. |
| Profile selection and Amount | SDK profile operations coexist with native paths | [Profile state](../server/profile-native-state.js) and [SDK registry](../server/profile-sdk-registry.js) use Windows inventory/label validation as well as SDK data | Audit per capability; an SDK setter does not establish a usable profile inventory or confirmation. Do not bypass current availability checks. |
| Remove | Shared Size and documented brush preferences use SDK paths; Selected actions use native integration | SDK preferences versus Windows selection discovery/validation | Retain the SDK subset after verification; gate Windows-dependent Selected controls separately. Delivered Add/Subtract commands do not prove active mode or brushing behavior even on Windows. See [Remove contracts](REMOVE_BRUSH_PREFERENCES.md). |
| Dust | Explicit On/Off applies validated SDK presets; main Reset is Dust-only | Preset prerequisites and fresh supported Dust feedback are distinct | Verify preset discovery, AI processing, On/Off/Reset and repair preservation. Unreadable current state alone must not disable verified explicit commands. Installation needs a macOS path/workflow. |
| Favorite Presets, Copy/Paste, Export and selection | SDK workflows, sometimes opening Lightroom dialogs | Selection tokens, request/result ownership, partial results and acknowledgements | Reuse [Copy/Paste](COPY_PASTE_SETTINGS.md), [Export](EXPORT_CONTROLS.md) and HTTP contracts; verify platform dialogs, shortcuts, paths and results. Do not infer completion from an opened dialog. |
| Desktop lifecycle, settings and packaging | Electron plus Windows launch/install scripts | Executable-relative paths, child processes, tray behavior and file staging | Requires explicit macOS design and real testing; current Windows packaging is not a macOS target. |

### Visualize Depth: SDK command, Windows state dependency

The actual [server route](../server/bridge.js) for `/lens-blur/visualize-depth`:

1. Validates the requested `enabled` state and current photo/context binding.
2. Acquires a fresh `readDepthVisualization` result from the native backend, then
   revalidates context after the asynchronous read.
3. Returns unavailable if it cannot establish the current checkbox state. If the
   state already matches, no toggle is needed.
4. Otherwise queues the owned SDK toggle. The plug-in revalidates context before
   calling `LrDevelopController.toggleLensBlurDepthVisualization()`.
5. The Controller obtains focused native readback to display the confirmed state.

The SDK operation is a **toggle**, not an explicit setter or a verified getter.
Removing the native read would make an explicit On/Off request unsafe. Do not
replace it with an optimistic state, a blind toggle or a retry after uncertainty.

The Windows implementation now uses an independent read-only helper to avoid
waiting behind unrelated native work. Its [timing evidence](VISUALIZE_DEPTH_TIMING.md)
and [latency regression](../tests/lens-blur-depth-latency.js) document the accepted
improvement; neither establishes macOS support. SDK return timing also does not
measure when Lightroom finishes painting the overlay.

## Practical porting sequence — proposed

1. **Establish an isolated macOS baseline.** Read the contract and handoff, record
   the exact source revision, and use a separate worktree without disturbing
   Windows work or packages. Record macOS, CPU, Lightroom, Node and Electron
   versions. Confirm installed SDK documentation before claiming a platform API.
   Choose a disposable catalog/photo for later native editing tests.

2. **Resolve paths and settings before enabling editing.** In
   [app/main.js](../app/main.js), the packaged portable root is the directory of
   `process.execPath`; the Lightroom launcher defaults to a Windows `.exe` path.
   In [Settings.lua](../lightroom/LRBridge.lrplugin/Settings.lua), configuration
   paths and the fallback parent traversal contain backslashes. A failed read
   silently falls back to the polling default, so a running worker does not prove
   correct settings discovery. Decide and verify a writable macOS configuration
   location shared by app and plug-in, separate from immutable bundle resources.
   Inspect the production Lua closure for other path assumptions. Verify spaces,
   non-ASCII names and filename case; preserve settings and preset UUIDs on upgrade.
   Do not import a developer's personal settings into defaults. Browser favorites
   and collapsed sections are browser-origin storage, not these settings files.

3. **Bring up an SDK-only runtime.** The native backend factory already returns an
   unavailable backend when `process.platform !== "win32"`; it does not launch the
   Windows helper on that branch. This is useful source-level groundwork, not a
   tested macOS startup. Verify that core server/Controller startup and shutdown
   work without PowerShell, that failed capability reads stay honest, and that
   each unsupported control explains its missing capability. A suitable proposed
   message is “Unavailable on macOS: native state feedback is not implemented.”
   Keep command availability separate from feedback availability where the
   existing contract allows it, particularly Dust. Do not disable an entire SDK
   panel just because a different control needs Windows readback.

4. **Verify desktop and plug-in lifecycle.** Adapt Lightroom discovery/launch only
   after verifying the actual macOS application location and launch mechanism.
   Decide Dock/menu, window close/reopen, tray, quit and single-instance behavior;
   Windows minimize semantics are not evidence for macOS. The server is embedded
   in Electron, while native helpers are child processes. Preserve bounded server
   shutdown and ownership of all spawned children. Register the matching production
   `.lrplugin` manually for the initial test; verify its macOS installation path
   instead of assuming the Windows portable layout. Test Disable → Enable → Reload
   and app/Lightroom restarts: one command worker and one feedback worker may own
   the active generation. Do not install a second consuming copy accidentally.

5. **Install and verify Dust independently.** Retain the XMP identities and
   **LRBridge Dust Helpers** group, with **LRBridge Dust On** and **LRBridge Dust Off**.
   The Windows installer targets `%APPDATA%\Adobe\CameraRaw\Settings`; the correct
   macOS destination, any catalog-specific preset setting and restart requirements
   need verification. Preserve the [manifest](../resources/presets/manifest.json)
   integrity checks and installer semantics: identical content is a no-op; only
   the known legacy `LRBridge TEST` payload is migrated; changed user content is
   refused rather than overwritten; legacy backups must not become duplicate
   imported presets. Do not generate replacement UUIDs. Verify clean install,
   migration, no duplicates and preservation of manual Healing repairs after
   Dust Reset. Opening Remove is not the same as opening the Dust subpanel; no
   supported direct Dust-subpanel route is established by the current research.

6. **Design a separate private macOS artifact.** The current staging workflow and
   `electron-builder.yml` target Windows x64 only. Inspect them for reusable
   allowlists, sanitized defaults, plug-in dependency closure and content hashes;
   do not assume `pack:win` produces a macOS bundle. Keep a matching production
   plug-in and required preset assets, including Color Grading metadata used by
   both runtimes. Exclude private configuration, diagnostic bootstraps, captures
   and research modules. Decide supported architectures, minimum OS, distribution
   format, signing/notarization and install locations after checking the actual
   macOS toolchain and requirements. Test bundle relocation, upgrades and settings
   preservation. Documentation links also need checking in the packaged layout.

7. **Treat native macOS replacements as later work.** Prefer verified SDK facilities.
   Replacing a Windows helper requires separate authorization, control identity,
   permission, context, execution and readback evidence on macOS. Do not introduce
   keyboard injection, guessed native controls or assumed success as a portability
   shortcut. This guide does not expand the native-integration exceptions in the
   repository contract. Auto Mask performance optimization remains deferred.

## Behavior the port must preserve

- **Edit ordering and confirmation ownership.** Coalescing must retain the final
  intended value; older writes or snapshots must not overtake a newer edit.
  Read renewal after an obsolete snapshot is not permission to retry an edit.
  Settled controls must still accept legitimate external Lightroom changes and
  report genuine failures. See [shared coordination](SHARED_SLIDER_COORDINATION.md),
  [captured rollback replay](../tests/shared-slider-confirmation-replay.js),
  [Reset confirmation](../tests/shared-reset-confirmation.js) and
  [feedback delivery](../tests/reset-feedback-delivery.js).
- **Touch and Reset.** Preserve gesture start/update/end/cancel, pointer-up Reset
  and duplicate-click suppression. Reset must follow the final adjustment and
  display the SDK-confirmed result, which is not always zero. While waiting, older
  feedback must not replace the current owned display or a newer user adjustment.
  Use [touch Reset coverage](../tests/main-slider-reset-touch-browser.js),
  [Masking Reset ownership](../tests/masking-reset-display.js) and its
  [rendered regression](../tests/masking-reset-display-browser.js).
- **Real context changes versus compatible work.** Retain photo UUID, active
  module, server epoch, context counter/timestamp, Develop revision, selected mask,
  component and swatch ownership wherever applicable. Known LRBridge Grain
  Size/Roughness changes on the same photo/mask must not discard compatible local
  Grain work or erase confirmed results. That exception is not permission to ignore
  external edits or actual photo/mask changes. See [Masking confirmation](MASKING_CORRECTION_CONFIRMATION.md),
  [coordination regressions](../tests/masking-grain-coordination.js) and
  [SDK regressions](../tests/masking-grain-sdk.js).
- **Point Color's separate coordinator.** Preserve immediate input ownership,
  timer cleanup, selected swatch identity and strict masked Hue Shift confirmation.
  Parent snapshots cannot overwrite a newer edit. Visualize Range keeps its pending
  adjustment guard and visible waiting explanation; it does not queue or retry the
  blocked click. See [ownership findings](MASK_POINT_COLOR_INPUT_OWNERSHIP.md),
  [input regressions](../tests/mask-point-color-input.js),
  [browser coverage](../tests/mask-point-color-input-browser.js) and
  [confirmation checks](../tests/mask-point-color-confirmation.js).
- **Public HTTP and truthful results.** Preserve methods, paths, ranges, precision,
  validation, context tokens, request IDs, acknowledgements and response meaning.
  Keep Companion-facing Set, Adjust and Reset compatible. An admitted request,
  delivered native event, partial paste or pending AI operation is not full success.
  Never blindly replay an uncertain mutation. Consult [HTTP workflows](HTTP_WORKFLOWS.md),
  [validation](../tests/input-validation.js), [transport limits](../tests/http-transport-limits.js)
  and [polling contract](../tests/polling-command-contract.js).
- **Worker ownership and existing visual models.** Preserve the accepted
  [plug-in lifecycle](POLLING_LIFECYCLE.md) and [lifecycle regression](../tests/polling-lifecycle.js).
  Do not retune sliders or the accepted [Parametric preview](PARAMETRIC_PREVIEW_MODEL.md)
  as part of a port. Its native references and approximation limits remain valid
  evidence for the tested Windows graph, not proof of macOS equivalence.

## Validation plan and existing commands

This is a checklist for a later macOS session. **None of these macOS checks has
been run for this guide.** Keep automated fixtures, actual SDK execution and user
observation as separate evidence categories.

1. Record the exact app, source, plug-in and platform versions. Verify path/case
   handling and that only the intended plug-in consumes commands.
2. Run isolated transport, context, queue and lifecycle regressions. Resolve test
   harness/platform blockers explicitly; a skipped Windows test is not a macOS pass.
3. Verify source desktop/server startup, port conflicts, quit/restart and settings
   persistence, first without Lightroom and then with the matching plug-in.
4. Verify plug-in Disable → Enable → Reload and Lightroom restart. Check worker
   ownership and absence of late responses from the disabled generation.
5. On a disposable photo or virtual copy, verify one SDK Set/Adjust/Reset end to end,
   then rapid drags, alternating controls and immediate Reset. Compare Controller
   display with actual Lightroom values; browser-only success is insufficient.
6. Exercise unavailable controls, external Lightroom edits, photo/mask/swatch
   changes and failures during pending input. Verify both retained final values
   for compatible work and rejection of genuinely stale work. Check the separate
   Point Color and regular Masking paths without merging their coordinators.
7. Verify unsupported native controls remain unavailable with explanations. For
   SDK-only functionality, verify feedback as well as command execution. Visualize
   Depth stays unavailable until its explicit-state contract can be satisfied.
8. Verify Dust clean install/migration and all supported preset/clipboard/export
   workflows within explicit scenarios. Test Companion/HTTP clients and phone/tablet
   LAN access separately; PowerShell is not assumed to be installed on macOS.
9. Only after source acceptance, validate the separate private artifact: matching
   assets/plug-in, clean defaults, no diagnostics, install/relocation, launch/quit,
   settings-preserving upgrade, and native/LAN checks from the packaged runtime.

From a source checkout with the lockfile's dependencies installed, these existing
commands provide useful focused starting points. Inspect their fixtures and
prerequisites before running them on a new platform:

```sh
npm run test:lifecycle
npm run test:input
npm run test:queue
npm run test:http-transport
npm run test:polling-contract
node tests/polling-lifecycle.js
node tests/shared-slider-confirmation-replay.js
node tests/shared-reset-confirmation.js
node tests/reset-feedback-delivery.js
node tests/masking-correction-confirmation.js
node tests/masking-grain-coordination.js
node tests/masking-grain-sdk.js
node tests/masking-reset-display.js
node tests/mask-point-color-input.js
node tests/mask-point-color-confirmation.js
node tests/parametric-native-reference.js
```

These exercise production handlers/models with isolated transports or SDK doubles;
the Parametric test compares preserved native reference data. They do not operate
or certify Lightroom on macOS. Lua harnesses use the existing `fengari` development
dependency. Browser regressions additionally need a compatible Chromium executable:
[the shared harness](../tests/controller-browser-lifecycle.js) supports
`LRBRIDGE_CHROMIUM_PATH`, while its automatic discovery currently searches Windows
locations. Verify launch/cleanup on macOS before using it. Then relevant checks are:

```sh
node tests/main-slider-reset-touch-browser.js
node tests/masking-reset-display-browser.js
node tests/mask-point-color-input-browser.js
```

The [package scripts](../package.json), [release runner](../tools/run-release-checks.js)
and [packaged native-helper test](../tests/packaged-native-depth.js) include
Windows-specific checks. Do not rename them into macOS verification or run live
smoke/edit scripts against a user's catalog without an agreed test sequence.
Use focused tests during implementation and the appropriate release gates at the
later packaging checkpoint.

## Known limits, open questions and agent handoff

Existing limits stay visible: Parametric preview is an accepted approximation;
Visualize Range does not invent a confirmed active highlight; some Lens Blur
state is delayed or incomplete; native Selected actions have separate command and
mode-feedback limits; Copy/Paste and Export result scope must remain precise.
Auto Mask performance and Constrain Crop feedback optimization remain deferred.
Lens Blur + New Refinement and named Export presets are not port prerequisites.
See the [release review](RELEASE_REVIEW.md) for current accepted scope and open gates.

Before claiming macOS support, resolve the actual supported OS/CPU/Lightroom/SDK
matrix, writable shared settings location, plug-in and preset install paths,
application discovery, lifecycle semantics, firewall/LAN behavior, bundle resource
layout and distribution requirements. Whether any native state currently read on
Windows has a sufficient supported SDK equivalent on macOS remains an evidence
question. Do not promise native parity in the initial SDK-based port.

**Read these first:**

1. [Repository contract](../AGENTS.md) and the current concise
   [handoff](../CODEX_HANDOFF.md); historical entries do not override current code.
2. This guide, [Windows release scope](WINDOWS_BETA.md) and
   [release review](RELEASE_REVIEW.md).
3. [Desktop entry](../app/main.js), [runtime entry](../bridge.js),
   [server](../server/bridge.js), [native backend boundary](../server/windows-lightroom-native.js)
   and [plug-in settings](../lightroom/LRBridge.lrplugin/Settings.lua).
4. [HTTP workflows](HTTP_WORKFLOWS.md), [shared slider coordination](SHARED_SLIDER_COORDINATION.md),
   [Masking confirmation](MASKING_CORRECTION_CONFIRMATION.md),
   [Point Color ownership](MASK_POINT_COLOR_INPUT_OWNERSHIP.md) and
   [plug-in lifecycle](POLLING_LIFECYCLE.md), with the linked regressions.
5. [Windows staging](../tools/build-windows-candidate.js),
   [builder configuration](../electron-builder.yml), [preset manifest](../resources/presets/manifest.json)
   and [installer semantics](../tools/install-runtime-presets.ps1).

**Bounded first task for a later, explicitly authorized macOS session:** in an
isolated checkout, record platform/toolchain versions, run the isolated
`test:lifecycle`, `test:input` and `test:queue` checks, inspect the unavailable
native-backend path, and propose the app/plug-in settings and resource locations.
Report exact failures and an SDK-only capability matrix separating action from
feedback. Stop before photo edits, native automation, installer changes or building
a distributable. That supplies a reviewable starting point for the first port
implementation without reopening accepted Windows behavior.
