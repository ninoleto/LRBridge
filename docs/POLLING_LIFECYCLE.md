# Polling lifecycle

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
