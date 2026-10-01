# Release cleanup status

**2026-09-26 update:** private build `20260925T022735Z` has now been manually tested
by the user. The focused source fixes and bounded additions investigation are
recorded in [the release review](RELEASE_REVIEW.md#september-26-private-package-feedback-fixes--source-retest-pending).
The old package is unchanged. Affected source behavior awaits the short retest in
that review before a fresh release candidate is built, verified and published.
This supersedes the older no-feedback-work scope below for this requested batch
only. Denoise Reset and unrelated uncommitted work remain preserved separately.

The verified startup correction is saved separately in local commit `1b63969`
(`fix: keep Lightroom polling running when getenv is unavailable`), on top of
`e55f64c`. It contains only the three diagnostic guards, four regression-test
files and the relevant handoff. Private configuration and unrelated work remain
outside the commit. The subsequent People fixture and distribution-test updates
remain working changes, separate from that fix commit.

Help and HTTP Builder were accepted on 2026-09-25. The user authorized a scoped
local checkpoint and private Windows portable test build. Reuse the recorded
feature evidence below and run only required build/package and extracted-runtime
checks. This authorization does not include publication or automatic Lightroom
setup changes. Native and clean-machine acceptance remain separate gates.

## Preserved baseline

Keep the current Profile, Lens Blur, Dust, Healing, Selected and Reset feedback
improvements. Reset is improved with remaining delay: the latest user check measured
480 ms for Texture, 929 ms for Clarity and 830 ms for Dehaze, and the user described
it as good but not perfect. The intermittent monitor-move scheduling stall remains
unresolved. This preparation pass makes no performance or monitor-recovery changes.

The cleanup startup regression was separate: Lightroom omits `os.getenv`, and the
initial diagnostic guard called it unconditionally. Missing or failing lookup now
leaves diagnostics disabled. The disabled `Trace.call` wrapper is unchanged.

## Development isolation and distribution

- The normal Lightroom menu contains Help, without the Profile/Lens Blur capture
  entry or other temporary prototype commands. Normal command and feedback polling
  still start automatically through the existing lifecycle supervisor.
- The Web Controller no longer loads a diagnostic script from a query-string token
  or contacts a temporary tracing server. Old diagnostic URLs act as normal URLs.
- Polling capture, observer-comparison overrides and detailed Dust trace logging
  are disabled by default. The Node server supports the explicit
  `LRBRIDGE_DEVELOPER_DIAGNOSTICS=1` option. Lua only consults that option when its
  host actually provides `os.getenv`; real Lightroom omits it and safely stays
  disabled. An environment variable alone does not enable Lua capture there.
  No default capture-file reads, polling pauses or diagnostic banners are enabled.
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
- The staging audit compares the shipping copies of corrected `PollingTrace.lua`
  and `Dust.lua`, plus the startup/lifecycle modules, against current source. It
  checks both `lightroom/` and `runtime/lightroom/`, which supplies the packaged
  plug-in. The source-only corrected `CaptureProfile.lua` remains excluded.
- Both exact Dust On/Off XMP files match the bundled manifest's sizes and SHA-256
  hashes. Their preset directory, manifest and installer are mapped into the
  intended distribution. The installer itself and preset bytes are unchanged.
- Private working configuration is preserved locally. Distribution staging writes
  public defaults and an empty preset configuration. Existing recovery backups and
  research remain in their original locations, outside distribution and this
  checkpoint where unrelated.
- The macOS porting guide is source-only: its links require developer source and
  tests excluded from the portable package. The source README keeps its relative
  guide link; staging turns only that link into an explicit source-repository
  reference. The public-document allowlist stays unchanged, and every remaining
  packaged Markdown link must resolve without adding development evidence.

## Completed verification

| Evidence | Result and limits |
|---|---|
| Real Lightroom, full restart on 2026-09-22 | A new process started at 04:40:53; both SDK loops started at 04:41:04 without missing-`getenv` or loop-failure errors. Advancing heartbeats, all 96 cached values received after startup, current photo and empty queue verified with diagnostics disabled. |
| Real Contrast 0 → 1 check | User completed the check; repeated SDK readbacks confirmed 1, heartbeats advanced and the queue stayed empty. No additional restart or repeat check is needed. This does not verify every feature or the intermittent monitor issue. |
| Missing-`getenv` regressions, reused | The old guard fails the new test. Corrected guards pass with missing, disabled or failing lookup; argument/return forwarding, error identity and yielding are covered. All 25 polling lifecycle and 96 Dust scenarios passed with the function absent. |
| People browser lifecycle, this pass | The broad fixture omitted `/api/people/state` and returned HTTP 500. An explicit unavailable-state fixture now supplies it. The isolated 27-render test passes, including all three People buttons remaining disabled on tab remounts, no People actions, and unchanged strict network/error checks. Application behavior was not changed. |
| Distribution staging, this pass | Corrected Lua copies, both native helpers, exact Dust presets/install files, safe defaults and exclusion rules pass. Runtime Lua parses; disabled diagnostics perform no capture I/O. The staged server starts on isolated ports without SelectedPrototype, a diagnostic server or private configuration. No native helper or live Lightroom is used by this test. |
| Existing feature checks, reused | Profile, Lens Blur, Dust, Selected, Reset and polling checks from cleanup/recovery remain applicable. Native PowerShell syntax was checked without execution. These mock SDK/browser results are not broader native acceptance. |
| Existing preset installer checks, reused | The unchanged installer previously passed installation, repeat installation, conflicting existing files and corrupt-bundle refusal in temporary folders. Real installation on another computer remains pending. |

## Help and HTTP Builder source preparation — 2026-09-24

- Help opens with a visible **Known issues and limitations** section covering delayed
  feedback, monitor moves and the observed manual Library → Develop recovery,
  working Add/Subtract and Visualize Range without active-mode display, and lens
  profiles in Lightroom. The exact action-button guidance is included. Ordinary
  slider dragging and quick changes to different controls are not discouraged.
- Builder copied paths now correctly use direct API port 17891 without the controller's
  `/api` prefix. Metadata still loads through the controller proxy. Slider cards respect
  Adjust/Reset capability flags; numeric fields reject unsupported formats and invalid
  Extend Selection amounts. These changes affect Help/Builder only; controller editing,
  server command handling, Lua and native helpers are unchanged.
- Regenerated and reviewed `server/http-operations.json` and `HTTP_OPERATIONS.md`:
  206 routes, seven additions and no removals. Read/discovery and internal result,
  inventory and Selected protocol routes are classified correctly. Workflow documentation
  records ordinary parameters and Selected token mappings, and distinguishes queue
  admission from confirmed Lightroom execution. Guarded actions remain multi-step workflows.
- Preserved the full route/command fixture assertions while adding the existing seven
  routes and `remove.selection.action`. The Jump-to test now selects the main tab renderer
  instead of a nested renderer, retaining the exact five-tab restriction. The Point Curve
  assertion checks both dirty flags through the accepted transparent tracing wrapper.
- Extended the release runner to include existing startup-diagnostic isolation, cleanup
  staging, Reset and Selected tests, plus broad lifecycle/Reset/Selected browser gates.
  Live smoke tests, native helper execution and unshipped Dust-paste research stay excluded.

| Current automated evidence | Result and limits |
|---|---|
| HTTP generator check and runtime contract | PASS: 206 routes, 94 command formats, 111 slider definitions; dynamic route families and internal classifications checked. |
| Builder command surface and real isolated HTTP admission | PASS: all command families and support flags checked; 103 generated requests queued exactly once with expected parameters, including all five Color Grading operations. No Lightroom execution. |
| Full source release gate plus focused corrections/additions | All 66 distinct checks pass. The initial run was 57/59; its two stale assertions were corrected and rerun successfully. Seven added gates also passed. This is combined evidence, not a claim that the initial run exited zero. |
| Help/Builder browser | PASS at 1280 and 390 pixels: limitations visible first, valid copy paths/full URLs, invalid input blocked, unsupported slider commands absent, internal inventory filtering, focus, and no horizontal page overflow. |
| Release browser gates | All nine pass: six existing gates plus broad lifecycle, Reset and Selected. All use mock state and disposable browser profiles. |
| Release staging and preset installer | PASS: both corrected plug-in copies, both native helpers, exact Dust presets, clean defaults, exclusions, isolated staged startup, installer repeat/conflict/integrity behavior. No Electron package was built. |

The sandbox initially blocked child process/browser launch with EPERM; these checks
passed when rerun with the required execution permission. No assertions were skipped.
Detailed logs and the verified pre-edit FTP backup remain in ignored local storage;
credentials were excluded. Existing private settings, unrelated work, protected
cheat sheets, the stash and the accepted startup/Reset baseline are preserved.

## Remaining release gates

1. Help/Builder UI review and authorization for a local checkpoint/private test
   build are complete. The accepted scroll and tab-focus corrections remain in place.
2. Run required staging/build/ZIP integrity checks, then inspect and start the
   isolated extracted runtime and check its pages/links. Do not repeat unchanged
   feature suites or interpret isolated checks as live Lightroom verification.
3. Clean-machine install/upgrade acceptance,
   followed by the outstanding native workflow acceptance in [the release review](RELEASE_REVIEW.md).
   The accepted Lightroom startup and Contrast check remain valid and were not repeated.
   Reset retains residual delay; the monitor-move issue remains unresolved.
   The pending Denoise Amount-only Reset to 50 requires actual Lightroom validation.
   Fresh Dust installation/discovery and Apply/Reset, plus a copied Builder command
   through PowerShell and Companion, require the user's test session.

## Checks requiring a package or another computer

For the authorized private build, inspect the actual ASAR, external plug-in/native
resources and ZIP manifest. Verify defaults and dependency resolution from the
extracted package without access to this checkout or its installed dependencies.
A staged Node server is not evidence that the packaged Electron app works.

Then perform a clean-machine install/start and an upgrade check: only the main
LRBridge plug-in, no SelectedPrototype/developer servers, no private settings or
saved native bindings. Verify native helper startup, Windows English OCR, Dust
preset installation, settings/favorites persistence, normal app quit/tray behavior,
SDK reconnection and preserved Profile/Lens Blur/Dust/Selected paths on a disposable
photo. Preserve the separate native workflow limitations in the feature documents
(including Copy/Paste and populated AI edits); the startup/Contrast check does not
grant broader acceptance. Automated package evidence does not establish these
manual results. No clean-machine result is claimed.
