# Polling worker lifecycle

Status: implementation, focused automated checks and the September 28 native
restart/Disable/Enable/Reload sequence are verified and accepted by the user for the
tested sequence. This work follows slider/Reset checkpoint
`246d11b1381c07e77fa29aa60e9a721e99c6f8e2` and does not change slider tuning.

## September 28 native result

The user reports restarting Lightroom before completing the requested sequence.
The current source LRBridge app remained running. The log distinguishes four
generations, each with exactly one command and one feedback supervisor:

| Transition | Old pair stopped (local time) | Replacement pair started |
| --- | --- | --- |
| Lightroom startup | Previous process exited | 04:01:55 |
| Initial plug-in reload | 04:02:38 | 04:02:39 |
| Disable → Enable | 04:02:42 | 04:02:49 |
| Final plug-in reload | 04:02:52 | 04:02:53 |

Both old supervisors stopped before each replacement started. The seven-second
stop-to-start interval around Disable/Enable contains no intervening polling
records. There are no duplicate starts, overlapping same-type supervisors or
lifecycle failures in this window. The previously stopped source/package plug-in
logs remain unchanged. SDK feedback is current afterward and the queue is empty.
The tested diagnostic modules match the verified implementation.

This is **a native pass for the completed sequence**, including the initial reload
after Lightroom startup in this run. It does not extend to native rapid toggles,
in-flight actions, injected failures or cancellation of application shutdown; keep
the separate automated coverage and earlier SDK limitations. The user subsequently
accepted this completed native result and authorized a scoped lifecycle commit,
integration with the slider/Reset checkpoint and a fresh private package. Evidence
and exact version hashes are preserved locally. No additional lifecycle test or
implementation change is indicated. Package manual checks remain for another session;
this acceptance does not authorize publication or establish final release approval.

## Demonstrated defect

The preserved September 27 capture lists the packaged LRBridge plug-in as disabled
in Lightroom preferences, while its independently rooted log records commands in
the same interval as the diagnostic plug-in. The user's switch was correct.
This lifecycle defect is separate from the later single-worker SDR Brightness
confirmation-error rollback and its accepted correction.

`Info.lua` registered initialization, plug-in unload and application shutdown, but
omitted `LrDisablePlugin` and `LrEnablePlugin`. Disable is a separate SDK event.
The old tests called the unload script directly, so they did not exercise the
missing callback registration. The existing startup guard also discarded an
Enable request while a previous stopped generation still owned workers.

SDK references: Adobe Lightroom Classic SDK 15.3 Programmer's Guide, "Declaring
the contents of a plug-in" and "Customizing plug-in load behavior" (pages 24 and
32), `LrPlugin.enabled` API reference, and the supplied `remote_control_socket`
sample's `Info.lua`/`stop.lua`. The guide documents a fresh Lua environment on
reload; tests must not model that solely by clearing fields in the original `_G`.

## Correction

- Register Disable to the existing synchronous stop script and Enable to the
  existing idempotent initialization script. Keep both shutdown registrations.
- Refuse forced initialization while the SDK reports the plug-in disabled. A
  worker checks ownership before enabled state after yields; a stopped generation
  never revives merely because the plug-in becomes enabled again.
- On a quick re-enable in the same environment, reserve a single successor pair
  and wait for all predecessor workers and feedback children to drain. Duplicate
  callbacks share that reservation. A subsequent Disable cancels it. Preserve the
  existing normal startup delay and polling/backoff intervals.
- Retain the old worker's stop flag across reload, discard late HTTP responses,
  and clean its function contexts/observers. Include a generation label in normal
  start/stop logs so native validation can distinguish worker lifetimes.

An SDK action already dispatched may finish; it is neither forcibly interrupted
nor retried. This fix does not add command receipts, requeue consumed commands,
alter SDK handlers or change public HTTP routes, photo/context checks, browser
feedback, accepted dragging, Reset timing, Point Color or other feature behavior.

Production changes are limited to `Info.lua`, `PollingLifecycle.lua` and the hook
comment in `PluginShutdown.lua`. The existing polling test fixture is extended.
No production dependency, server lease, recorder or package change is introduced.

## Automated evidence

`node tests/lua-polling-resilience.js` passes source checks and **35 cooperative
mock-SDK cases executing production Lua**. New cases include actual Info.lua
Disable/Enable dispatch, disabled forced initialization, rapid toggles, duplicate
Enable, long in-flight action drain, backoff, late command/feedback responses,
observer cleanup and reload into a genuinely separate Lua/global/module environment.
Existing uncertain-action/no-replay and treatment-child cleanup cases remain.

The continued-consumption regression fails against the saved old plug-in. The
quick re-enable regression also fails with only callback registration added to the
old lifecycle code. Both pass with the final correction. Tests may select that
preserved source using `LRBRIDGE_POLLING_PLUGIN_SOURCE`; no production file needs
to be overwritten for old-code comparisons.

`node tests/polling-command-contract.js` passes. Adobe's bundled Lua compiler parses
all 40 prepared diagnostic modules, which match current source after removal of the
existing trace-only hooks. No live edit or repeated native Contrast check was sent.
The accepted slider/Reset suites and recordings are reused, not claimed as new runs.

## Native check performed September 28

Keep the current source LRBridge app running and other LRBridge plug-in entries
disabled. Use the same diagnostic entry already installed in Lightroom:

1. Reload Plug-in once to load the new lifecycle code and callback registrations.
2. Disable; wait five seconds. Enable; wait five seconds.
3. Reload Plug-in again; wait five seconds. This checks reload after the correction
   itself is loaded. Report completion and any Lightroom error.

No Controller edits or capture page are required. After completion, inspect the
preserved log offsets: both old supervisors must stop, Disable must leave no
continued polling, and each enabled/reloaded lifetime must have one command and
one feedback supervisor. Verify other plug-in logs remain unchanged. The initial
upgrade reload is distinct from validating reload with the corrected code running.

Automated results did not pre-pass this native check; the result above records
the subsequent physical evidence. An old installed candidate does not acquire these
fixes automatically; its files remain preserved. The accepted lifecycle source is
included in the authorized checkpoint and private package preparation. Package
manual checks remain pending; publication is not authorized.

## Earlier accepted lifecycle checkpoint (historical record)

The record below is retained with its original scope and limitations. The September
28 correction above supersedes only the missing Disable/Enable handling and the
refusal of a start request during draining. Older adjacent-test status is historical;
consult the current handoff for later acceptance and fixes. The SDK's first-load
unload-hook limitation and the limits of forced unload still apply.

This SDK-only cleanup follows local checkpoint `7d58514`. It removes **Start LRBridge Polling** from Library > Plug-in Extras. LRBridge Help remains. No editing API, queue, photo/context binding, controller or Dust preset dependency is changed.

## Startup and recovery

`Info.lua` retains `LrInitPlugin` / `LrForceInitPlugin`. `PluginInit.lua` starts two independently supervised runners through `PollingLifecycle.lua`, after the existing one-second startup delay:

- Commands: `AutoStartPolling.lua`, the same `/next` queue, configured polling interval and once-per-second settings reload.
- Feedback: `FeedbackPolling.lua`, the same request order, 0.1-second cycle sleep, 0.75-second context heartbeat and asynchronous Treatment reads.

Each supervisor reserves ownership before scheduling. Ownership remains reserved during recovery; the legacy `LRBridge*PollingStarted` flags describe an active attempt and clear on failure/exit. Duplicate initialization and the retained, unregistered `StartPolling.lua` compatibility entry use that same ownership guard.

A yield-safe `LrTasks.pcall` encloses each entire runner, including loading and initialization. Unexpected errors are logged with URL/path redaction, flags clear, and the runner starts fresh after a fixed one-second backoff. An unexpected normal return receives the same treatment. A returned empty/unavailable HTTP response continues normal polling, so an ordinary server outage needs no manual restart. Persistent exceptions retry at the bounded rate; a blocked SDK call must return before recovery can proceed.

Recovery **never stores, requeues or replays a dispatched edit**. The existing protected `Commands.execute` attempt and busy/completion bookkeeping remain. If a dequeue response is lost or an action's outcome is uncertain, recovery proceeds to the next queue item; it does not infer success or retry the previous action.

Feedback context cleanup removes its SDK observers. Tone Curve and Preset Amount also release their cached observer ownership, allowing registration in the replacement context. Read-only Treatment tasks are invalidated and drained before restarting their parent; stale responses cannot publish new feedback after cancellation.

## Shutdown and reload

`LrShutdownPlugin` and `LrShutdownApp` both register `PluginShutdown.lua`, but have different contracts. The plug-in unload hook executes the script directly, so the stop signal is sent immediately when the file loads. Only the application-exit hook invokes its returned `LrShutdownFunction(doneFunction, progressFunction)` callback. Application shutdown reports progress while draining and honors cancellation of the wait. See the Adobe SDK Guide, pages 24 and 28 ([Adobe guide](https://ioconsolerykerprodcdn.azureedge.net/static/installers/lr/sdk/2022/cross_platform/v13/doc/Lightroom%20Classic%20SDK%20Guide_1655133965.pdf)).

Shutdown marks the generation as stopping. Both loops stop consuming requests, late command responses are discarded before dispatch, and a currently executing SDK action is never replayed. The application-exit callback waits for supervisors and their Treatment tasks unless the user cancels that wait. Plug-in unload has no asynchronous completion callback: Lightroom controls teardown, so draining an action across forced unload is not promised. Restart attempts during draining are refused in the same environment; an old generation's late completion cannot clear the new generation's flags.

The SDK documents that the plug-in unload script is only executed after a user load/reload through Plug-in Manager (or catalog-structure approval) in the current session. A first reload after automatic application startup may therefore omit it. Native validation must distinguish the host's reload from an observed stop signal; merely seeing replacement loops start does not prove the shutdown hook ran.

The initial upgrade from `7d58514` requires **quitting Lightroom completely and reopening it once**. Its already-loaded loops have no shutdown hooks. A legacy started flag without supervised ownership blocks a new generation and logs the need for this restart. After that first clean load, File > Plug-in Manager > LRBridge > Plug-in Author Tools > Reload Plug-in uses the new shutdown lifecycle. The user has completed that restart and loaded the final code by reloading the plug-in; **no further reload is needed for this checkpoint**. No LRBridge/server restart or browser refresh is required for these Lua/menu changes.

## Verification and limits

- `npm run test:lua-polling` includes 25 cooperative mock-SDK scenarios executing the production startup, shutdown, supervisor, parser, runners and observer ownership methods. Coverage includes automatic startup, server unavailability/reconnection, normal intervals/order/Treatment feedback, loader/settings/HTTP/sleep failures, duplicate starts during startup/running/backoff, no edit replay, observer reinstallation, delayed responses, child draining, direct plug-in unload, asynchronous application shutdown/progress/cancel and generation isolation after reload. Tests use virtual time and in-memory HTTP, with no native failure injection.
- The Lua execution tests reuse the external Fengari test runtime selected by `LRBRIDGE_LUA_TEST_RUNTIME`; no production dependency is added. Installed Adobe Lua compiler syntax checks cover changed Lua files.
- Focused menu/Dust diagnostics, polling serialization, queue resilience, server lifecycle, Tone Curve split and Point Curve checks pass, along with 53 Red Eye scenarios and their expiry/revision/timeout/late-result checks. Changed JavaScript/Lua syntax and diff checks pass.
- Adjacent scripts retain failures reproduced from their `7d58514` versions against the unchanged relevant source: generic sliders omit `redEyeController` in a history fixture; Lua selection expects the older two-argument `Driver.setSlider` call; Develop Presets rejects existing picker scrollbar-gutter markup. These are deferred, along with earlier unrelated failures and Export. No full-suite pass is claimed.
- Native check completed: the user performed a complete Lightroom restart and the final Plug-in Manager reload. Logs confirm the final shutdown request, both old supervisors stopping, then one replacement command loop and one replacement feedback loop. Library context feedback was fresh afterward and the queue empty. This establishes ordinary startup/reload behavior; unexpected failures, server reconnection and long-running application-exit/cancel cases remain mock-SDK validation, without native fault injection.

The accepted Healing, Dust, People, Reflections and four-button Red Eye boundaries from the preceding checkpoints remain unchanged.
