# Release cleanup status

This is a local development checkpoint, not a release candidate or release approval.
No package was built or published during this cleanup. Help and HTTP Builder remain
for the final documentation phase.

## Preserved baseline

Keep the current Profile, Lens Blur, Dust, Healing, Selected and Reset feedback
improvements. Reset is improved with remaining delay: the latest user check measured
480 ms for Texture, 929 ms for Clarity and 830 ms for Dehaze, and the user described
it as good but not perfect. The intermittent monitor-move scheduling stall remains
unresolved. This cleanup makes no performance or recovery changes.

## Development isolation and distribution

- The normal Lightroom menu contains Help, without the Profile/Lens Blur capture
  entry or other temporary prototype commands. Normal command and feedback polling
  still start automatically through the existing lifecycle supervisor.
- The Web Controller no longer loads a diagnostic script from a query-string token
  or contacts a temporary tracing server. Old diagnostic URLs act as normal URLs.
- Polling capture, observer-comparison overrides and detailed Dust trace logging
  are disabled by default. Source developers must explicitly set
  `LRBRIDGE_DEVELOPER_DIAGNOSTICS=1` in the launching process environment. Polling
  capture additionally requires its existing bounded local arm file. No default
  capture-file reads, polling pauses or diagnostic banners are enabled.
- `CaptureProfile.lua` is retained as a guarded source-only developer tool, with
  no normal menu registration. Standalone capture/test/observation Lua scripts,
  SelectedPrototype, test fixtures, research scripts, logs, backups, arm files,
  private preset/settings files and saved native bindings do not enter staging.
- `tools/release-runtime-files.json` is the reviewed app/server allowlist. A newly
  tracked probe no longer becomes distributable automatically. Lightroom files
  are selected from the runtime dependency graph; diagnostic-named modules needed
  for Dust safety and other working controls are deliberately retained.
- The main native helper and `windows-remove-selected-identification.ps1` are
  distributed together in `resources/native`. The latter is a production Selected
  dependency, not the temporary prototype. Selected discovers and verifies current
  controls at runtime and does not read saved process IDs or native handles.
- Private working configuration is preserved locally. Distribution staging writes
  public defaults and an empty preset configuration. Existing recovery backups and
  research remain in their original locations, outside distribution and this
  checkpoint where unrelated.

## Verification and remaining gates

The focused cleanup check evaluates the plug-in menu, parses runtime Lua, verifies
that disabled diagnostics do not access capture files, checks the actual staging
contents and native sibling files, and starts the staged server on isolated ports.
It uses no prototype, diagnostic server, private configuration or live Lightroom.
The production native PowerShell files are syntax checked without executing them.
Feature regressions use mock SDK/native responses; they are not clean-machine or
native acceptance evidence.

Before release, finish Help and HTTP Builder, regenerate and verify their route
inventory, and complete the final release checks. The known broader browser
lifecycle People-state failure remains separate from this cleanup. Preserve all
native acceptance limits in the feature documentation. A historical package is
not a package of this checkpoint.

The smallest startup check is one LRBridge restart, one LRBridge plug-in reload
through Lightroom's Plug-in Manager, and one Web Controller refresh. A full
Lightroom restart is not requested. Check that the capture menu is absent, SDK
context is fresh, and the current photo and controls load without a trace banner.
Do not reload again for browser-only changes.

When packaging is later authorized, perform a single clean-machine install/start
check with only the main LRBridge plug-in enabled, no SelectedPrototype or developer
servers, and no copied private settings or native bindings. Verify native helper
and Windows English OCR availability, Dust preset installation, settings persistence,
SDK reconnection and the preserved Profile/Lens Blur/Dust/Selected paths on a
disposable photo. Selected Add/Subtract and Visualize Range must remain honest
about their unavailable active-mode display. These checks are pending; no
clean-machine or release-ready claim is made here.
