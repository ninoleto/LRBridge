# Shared Windows native feedback investigation

October 2, 2026. Baseline: release checkpoint `bf44384`, private Windows candidate
`20261001T224235Z`, documentation checkpoint `b11159a`, Lightroom Classic 15.4.1.
The eight successful packaged PowerShell/Lightroom integration stages remain valid.
The accepted independent Visualize Depth implementation is unchanged.

## Final focused attempt — verified source correction

The source now discovers Profile from freshly enumerated Lightroom ComboBoxes and
the selected virtual item's owned list. It reads all list siblings, including
collapsed/offscreen items, and retains Browse-marker, pattern, runtime-ID, enabled
state, inventory and selection validation. Process start time, current main window,
ComboBox and linked list ownership are revalidated before returning. There is no
cached control reference, inventory or selected-value substitution.

The missing piece in the rejected native-handle trials was provider initialization:
`FromHandle` exposed the correct HWND as a generic `Pane`, without SelectionPattern.
A private fresh-process registration probe failed inside .NET's
`ProxyManager.LoadDefaultProxies`. Its stack inspection encounters PowerShell's
dynamic method frame. Calling the public registration API through a small C#
method with `NoInlining` preserves a declared frame and exposes the built-in
ComboBox/list providers correctly. Removing `NoInlining` reproduces the failure.
Initialization is lazy and happens only for Profile discovery; the independent
Visualize Depth path is unchanged.

Relevant Microsoft references: [public provider registration](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.clientsettings.registerclientsideproviderassembly?view=netframework-4.8.1),
[built-in ComboBox/list providers](https://source.dot.net/UIAutomationClientSideProviders/MS/Internal/AutomationProxies/Main.cs.html)
and [provider bootstrap](https://raw.githubusercontent.com/dotnet/wpf/main/src/Microsoft.DotNet.Wpf/src/UIAutomation/UIAutomationClient/MS/Internal/Automation/ProxyManager.cs).
These explain the approach; actual native measurements below establish its effect.

Two comparable corrected observations used the actual packaged transport with a
private read-only timed copy of the source helper, against Lightroom Classic 15.4.1.
Each ran one cold snapshot, one repeated snapshot and one label read, with a Lens
Blur full-state read submitted 100 ms after each Profile request. The original
production transport deadlines remained unchanged.

| Measurement | Original baseline | Corrected source, two observations |
| --- | ---: | ---: |
| Complete original Profile read, diagnostic-only completion | 7935 ms | — |
| Cold Profile snapshot including helper startup | Timed out at ~5018 ms | 846 / 1064 ms |
| Repeated snapshot / label | Both timed out at ~5s | 393–499 ms |
| Lens Blur full-state total, including queue wait | Expired at ~3s without execution | 1170–2074 ms, available |
| Profile execution timeouts per three-pair run | 3 | 0 |
| Full-state queue expirations per run | 3 | 0 |
| Helper restarts per run | 3 | 0 |
| Completed requests per run | 0 of 6 | 6 of 6 |

Both corrected snapshot inventories exactly match the original eight labels,
positions and enabled states; selected Profile remains **Adobe Color**. Photo/SDK
context stayed unchanged, and all private observation helpers stopped. The final
run measured Lens Blur queue waits **399–948 ms** and execution **928–1126 ms**:
the shared queue still serializes these operations, but expensive desktop discovery
no longer occupies it for five seconds in this context. No separate Profile helper
was added. Isolation was considered and remains a mitigation option only if a
future measured case requires it.

The subsequent running-source review verified the real server and served Controller,
then the user **passed the offscreen test**: with Lightroom showing Color Grading,
Controller Profile changes applied correctly and immediately in Lightroom. Controller
feedback arrived slightly later, settled correctly and stayed usable. This delay
remains documented; no gesture-to-confirmation timing was measured.

Post-test reads used the current selected Profile as the expectation, not a hardcoded
earlier choice. Native and live server state both reported **Adobe Color** at that
verification. A read-only native check confirmed `IsOffscreen=true`, all eight
inventory entries and the correct selected item. Discovery took 416 ms / 827 ms
including the private read-only helper startup. Three actual source API reads took
156/213/172 ms; those latencies do not measure Controller confirmation after a click.
The main source helper remained PID 15456, with completed reads 1807 → 1815 and
execution timeouts/queue expirations/restarts still **0/0/0**. No agent edit was sent.

Scope and limits: offscreen Profile behavior is now manually accepted for the tested
context. The real Windows fixture additionally covers 48 collapsed/offscreen options
and changing/recreated owners; this remains distinct from Lightroom testing.
Other catalogs, localized controls and actual process restarts were not exercised.
The precise cost behind every earlier seven historical execution timeouts remains
unknown. Lens Blur full-state discovery still costs roughly one second; no claim
of instantaneous feedback or a general native-helper performance solution is made.

Focused checks pass:

- `node tests/profile-native-discovery.js`: real hidden Windows fixture controls,
  cold provider bootstrap, complete virtual inventory, fresh selection, ambiguous
  inventory, changed/recreated process/window/control ownership and recovery. The
  old discovery and a broken bootstrap fail; the correction passes.
- `node tests/profile-native.js`: existing production state/HTTP/SDK fixtures,
  including photo/context changes and late feedback, with discovery contracts
  updated for the verified native-owner route.
- `node tests/lens-blur-native-polling.js` and
  `node tests/native-read-comparison.js`: existing focused queue deadlines,
  no replay, fresh confirmation, action ordering, observer and shutdown safeguards.

The Controller, public HTTP routes, SDK commands, slider coordination and independent
Depth implementation were not changed. No SDK/photo edit was sent during this attempt.
All timing instrumentation is private. Candidate `20261001T224235Z` remains the
unchanged package baseline and does **not** contain this source correction. The user
quit that package and started source LRBridge for the accepted review, retaining the
existing production plug-in. A future replacement package must include the corrected
external helper; no plug-in change or reload is required. No commit, build or publication
was performed.

The following sections preserve the preceding investigation and rejected experiments.

## Established cause and two different deadlines

The [shared transport](../server/windows-lightroom-native.js) gives a queued
background `readState` request three seconds to reach the helper. Expiry removes
the undispatched job, reports unavailable feedback and increments
`stateQueueTimeouts`. It does **not** terminate the active helper. A dispatched
operation instead has a five-second execution deadline. That timeout rejects the
operation, terminates/restarts that helper and increments `timedOut` and
`helperRestarts`. Neither event confirms an operation or replays an edit.

An instrumented read-only observation using the actual packaged transport and
copies of the production PowerShell functions reproduced both events: two Profile
snapshots and one Profile-label read each exceeded five seconds; each paired
full-state read expired in the queue after about three seconds and never executed.
The phase records attribute **these three new execution timeouts** to Profile
discovery. The earlier seven execution timeouts recorded in `b11159a` have no
operation history and cannot all be assigned to Profile retrospectively.

One original Profile read was separately allowed to finish for diagnosis, with a
15-second observation limit. This changed no production deadline. It returned the
valid eight-option inventory, selected **Adobe Color**, and took 7935 ms including
helper startup. Native-function phases measured:

| Phase | Time |
| --- | ---: |
| Desktop-descendant search for Browse | 4067 ms |
| Desktop-descendant search for its ComboBox | 3320 ms |
| Reading linked inventory items | 33 ms |
| Reading the current selection | 8 ms |

The dominant observed cost is accessibility discovery in
[`Get-ProfileDiscovery`](../server/windows-lightroom-native.ps1), not enumeration
of the eight options. The precise provider/application responsible for the slow
desktop traversal has not been identified. Other observations showed Browse
discovery alone failing to finish within the execution deadline, so these timings
are a bounded sample, not a constant cost.

## Callers and practical effect

The [Controller](../app/controller.html) requests categorical/Profile and full
Lens Blur state from its 500 ms feedback tick while the sliders tab is active.
Categorical/Profile polling also runs on the tools tab. Each browser read has an
in-flight guard. The [Profile state owner](../server/profile-native-state.js)
shares in-flight reads and applies its existing 750 ms refresh gate. Thus the
evidence does not establish an unbounded duplicate request queue.

[`/develop-categorical/state`](../server/bridge.js) calls Profile refresh, which
submits `readProfileSnapshot`. A photo/context or SDK Profile-label change also
starts the existing context-refresh chain: a label read followed by up to two
inventory reads. Labels currently use the same full discovery function. In-flight
label and inventory reads have separate ownership, so both may be admitted, but
the shared transport serializes execution.

`/lens-blur/state` submits the background `readState` to that same transport. A
single slow Profile read can exceed both its three-second queue allowance and
the helper's five-second execution limit. In successful read-only comparison
rounds where Profile failed fast, full-state execution took about 0.7–1.2 seconds:
window discovery contributed roughly 0.6–0.8 seconds, with the remaining time in
classification and current control readback. These reads did not establish another
execution-timeout cause in the tested context.

Practical effects are delayed/unavailable native Profile option inventory and
temporary unavailable shared Lens Blur feedback: Apply status, Brush Refinement
Amount/Size/Feather/Flow, Auto Mask, refinement disclosure/mode/Reset and Focus Range
button availability. Commands using the shared native action queue may wait behind
an active discovery read; this observation sent no actions and does not establish
action failures. SDK slider values and the independent Visualize Depth/Selected
readers are separate paths. The independent depth reader recorded no timeout or
restart in the observations. Preserve its accepted behavior and the successful
SDK/HTTP integration results.

## Small corrections evaluated and rejected

Restricting search to the main-window subtree or native list windows made reads
quick, but lost the valid Profile inventory. Profile's accessibility list can be
outside those discovery scopes. These are availability regressions, not fixes.
Filtering desktop accessibility roots by process still exceeded the deadline.
Resolving the ComboBox directly from Browse's native owner also did not improve
the paired observation: Browse discovery still timed out before that lookup.

| Comparable three-pair observation | Original | Direct-owner trial |
| --- | ---: | ---: |
| Profile execution timeouts | 3 | 3 |
| Full-state queue expirations | 3 | 3 |
| Helper restarts | 3 | 3 |
| Completed native requests | 0 | 0 |

All trial production edits were removed; the helper source was restored byte for
byte. Temporary timing and read-only guards remain only in private diagnostic
copies. No timeout increase, stale-value substitution, error suppression, queue
redesign or edit retry was adopted. No replacement package or plug-in reload is
needed for the retained documentation/test work.

Resolving the remaining discovery cost requires a verified way to reach the
virtual Profile list without the broad accessibility traversal, or a separately
designed discovery lifecycle that retains fresh identity/inventory/context checks.
That preceding investigation stopped without a correction. The later authorized
focused attempt above supplies the verified provider/native-owner route and records
its remaining coverage limits. Preserve the original measurements as the baseline.

## Focused verification

Both focused checks below pass. No broader suite or completed live command test was
repeated.

- `node tests/lens-blur-native-polling.js`: production transport with simulated
  accessibility/SDK feedback. Extended coverage separates three-second queue
  expiry from five-second execution timeout/restart; expired work is discarded,
  no read is replayed, late terminated-helper replies cannot confirm recovery,
  and a fresh replacement-helper read is required. Existing fair polling, proxy,
  photo/context and independent depth cases remain in the same focused test.
- `node tests/native-read-comparison.js`: existing simulated shared-read pause,
  recovery, action ordering and independent observer safeguards.
- Actual Lightroom timing/queue observations above are separate native evidence.
  Simulated checks do not establish native speed or a successful correction.

The current package, previous recordings, source settings and stash are preserved.
Auto Mask and Constrain Crop performance remain deferred; neither was changed.
