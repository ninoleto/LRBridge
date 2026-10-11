# Identified Reset completion (private beta.3)

Use port **17891** directly. `GET /reset?slider=Exposure` and the Web Controller's
existing GET Reset requests remain compatible. This optional contract adds
`POST /reset`, `GET /reset/capabilities` and `GET /reset/result`. Companion is
unchanged; integration is a later task. Numeric Nudge retains its separate API.

## Request and result

Fetch `/reset/capabilities` immediately before preparing a new action. It returns
the current server epoch, selected-photo UUID, `contextCounter`,
`contextChangedAt`, `developCounter` and supported slider IDs. The epoch is shared
with Numeric Nudge in this server instance. A client must explicitly use the new
epoch after a restart; old requests are rejected rather than replayed.

```http
POST /reset
Content-Type: application/json

{
  "requestId": "exposure-reset-001",
  "serverEpoch": "<epoch from capabilities>",
  "slider": "Exposure",
  "selectedPhotoUuid": "<UUID from capabilities>",
  "contextCounter": 12,
  "contextChangedAt": 1791320400123
}
```

Exactly these six fields are required. IDs/epoch/UUID use 1–120 ASCII letters,
digits, `:`, `_` or `-`; counters/timestamps are nonnegative safe integers.
The JSON limit is 2 KiB. Unknown fields, unknown/unreadable sliders and sliders
without Reset support are rejected. Selected photo and module must match current
Develop ownership. Reset uses the current slider at execution; admission does
not invent a runtime value or default.

New admission returns `202` with an immutable operation ID and a queued receipt:

```json
{
  "ok": true,
  "status": 202,
  "duplicate": false,
  "receipt": {
    "serverEpoch": "<original epoch>",
    "requestId": "exposure-reset-001",
    "operationId": "rc-1",
    "phase": "queued",
    "result": null
  }
}
```

Poll `GET /reset/result?serverEpoch=<original epoch>&requestId=exposure-reset-001`.
A completed receipt includes, for example:

```json
{
  "serverEpoch": "<original epoch>",
  "requestId": "exposure-reset-001",
  "operationId": "rc-1",
  "slider": "Exposure",
  "selectedPhotoUuid": "<original UUID>",
  "contextCounter": 12,
  "contextChangedAt": 1791320400123,
  "admittedDevelopCounter": 51,
  "executionDevelopCounter": 52,
  "outcome": "observed",
  "invoked": true,
  "resetSucceeded": true,
  "sdkValue": 0.37,
  "valueSource": "sdk",
  "capture": "serial-worker-after-reset",
  "completedAt": 1791320400456,
  "detail": "Reset worker result; observed means SDK Reset returned successfully, followed by an owned SDK read."
}
```

The sample **0.37 is illustrative**, not a Reset default. There is no calculated
target or guessed baseline in a result. `sdkValue` exists only for `observed`.
Profile Amount retains the existing Driver reset operation (absolute SDK write
of 100), but its completion value uses this same generic SDK read; it never
copies the requested 100 into the receipt.

## Ordering and authority

1. Admission adds `develop.reset.correlated` to the existing serial command queue.
2. The existing `AutoStartPolling.lua` worker dispatches `Commands.execute`.
3. `ResetCompletion.execute` obtains a one-use server claim, captures native
   photo/process/profile identity and calls `Driver.resetSlider`.
4. The Driver rechecks ownership after its yielding reveal/sleep/tracking and
   immediately before the SDK mutation. A false Driver return, explicit SDK
   false return or exception cannot produce an observed completion.
5. After a successful Driver return, `ResetCompletion.lua` calls
   **`Query.getDevelopValue(c.slider)` inside that serial execution**. It checks
   native ownership around the read, validates server ownership again, and sends
   the correlated result before returning to the worker.

The worker remains busy through Reset, read and publication; it cannot execute
another editing command between them. Identified Resets form coalescing
boundaries. A preceding Set and a following Set/legacy Reset stay on their
respective sides; repeated identified Resets retain separate operations and
receipts. The queue is not redesigned, and ordinary Set/Adjust semantics are
unchanged. No read is delegated to the independent feedback queue.

**`/feedback/request?purpose=reset` is not proof of Reset completion.** Its
separate reader waits for an already busy worker, but can read while Reset is
still queued. A complete priority feedback snapshot can therefore contain the
pre-Reset SDK value. It never settles an identified receipt.

The software guarantee is that an owned SDK read occurred after this exact
Reset's SDK invocation returned successfully. **Native QA confirmed that the
immediate SDK reads matched Lightroom's completed Reset values in the six cases
recorded below.** SDK doubles separately prove ordering and failure handling.
`observed` reports the owned SDK read; it does not assert a documented universal
completion barrier or runtime UI acceptance. If another native case produces a
pre-Reset/delayed value, record that SDK limitation and do not treat that value
as a confirmed baseline. No arbitrary delay, polling speed or cached feedback
is offered as proof.

## Ownership, retries and terminal states

Every result preserves its original epoch, request/operation IDs, slider, UUID,
navigation counter/timestamp and admitted/execution Develop revisions. Clients
must match **all operation/owner fields** to their intent and current server/photo/
navigation context before consuming a baseline. A retained observation stays a
historical result if navigation later changes; it is not rebound to current
feedback. A preceding Set or Reset's own heartbeat may advance Develop revision;
this is allowed on the same navigation context, and execution revision is
reported separately. If Develop revision advances between the worker's final
validation and server result admission, that receipt becomes uncertain without
a value. This conservative delivery check includes an unreported Reset heartbeat;
it does not invent ownership of a revision. A later edit can make even an owned
baseline obsolete.

Native photo, module, process and (for Amount) Look/AILook identity are rechecked
after yielding preparation, SDK reads and before publishing. Server ownership
is independently checked on claim, validation and result admission. There is no
generic admission-time profile-generation token: a same-photo profile change
before execution can change which current Amount is reset. Changes during
execution invalidate its observation. Explicit disabled Amount support is
unavailable; no capability is guessed from profile names.

Phases are `queued`, `dispatched`, `executing`, then `complete` with a terminal
outcome. Dispatch alone means only that the worker received the command.

| Outcome | Meaning |
|---|---|
| `observed` | Successful SDK Reset invocation followed by an owned finite SDK read in the serial worker. Native value agreement is recorded for the tested cases below. |
| `stale` | Ownership/lifecycle changed before invocation, or dispatch was rejected; no successful Reset baseline. |
| `unavailable` | Queue admission/capability/read unavailable. Check `invoked` and `resetSucceeded`; Reset may have succeeded but its read failed. |
| `failed` | Driver/SDK Reset failed. A subsequent read cannot turn this into success; no SDK value is published. An exception may still have had a partial native effect. |
| `timeout` | Sixty seconds elapsed before an execution claim. The old command can no longer claim or run. |
| `uncertain` | Claimed operation lost ownership, lifecycle or result delivery, or timed out. Inspect Lightroom before any new action. |

Transport/server invalidation may leave invocation flags unknown (omitted),
because the server cannot infer how far a claimed native worker progressed.
Pending receipts are swept every second while the server runs, and also checked
at every access. Shutdown terminates pending receipts; late results are rejected.
Terminal outcomes cannot be overwritten. Capacity is **8192 receipts per epoch**;
no ID is evicted, so an old retry cannot execute again. Exhaustion returns `503`.

Retry the **identical full body** with the same ID/epoch. It returns `200`,
`duplicate:true` and the original receipt without another queue entry, even
after failure, timeout or plug-in reload. Changed intent with the same ID returns
`409`. Queue refusal returns `503`/`409` with a terminal unavailable receipt;
retrying that ID only retrieves that refusal. Invalid/stale admission without a
receipt never queued a Reset. Never automatically make a new ID/epoch after
uncertainty. Result lookup in the wrong epoch or for an unknown ID returns `404`.
Receipts use `Cache-Control: no-store`.

`/reset/claim`, `/reset/validate` and `/reset/operation-result` are internal
plug-in protocol, matching the existing receipt infrastructure pattern. These
local endpoints are not an authentication boundary and must not be driven by
Companion as public editing APIs.

## Verification and native test

Run `npm run test:reset-completion`. It executes the production independent
feedback reader against the queued-Reset race and the production serial worker/
Parser/Driver/Query against SDK doubles, using the actual `/next` command
envelope. Malformed or duplicated envelope/command fields are rejected.
Non-default values cover Exposure,
Contrast, Vibrance, Temperature and Profile Amount, failure returns/exceptions,
SDK read failure, navigation/process/profile changes, correlation/retries/reload,
queue coalescing, admission refusal and bounded lifecycle. These are isolated
tests and do not edit Lightroom. Existing Web Controller Reset/browser and
Numeric Nudge checks remain separate regressions.

Native Reset QA was accepted by the user on October 7, 2026:

| Case | Preceding Set | Immediate SDK Reset value | Lightroom comparison |
|---|---:|---:|---|
| Exposure | 2.75 | 0 | Confirmed |
| Contrast | -48 | 0 | Confirmed |
| Vibrance | 36 | 0 | Confirmed |
| RAW Temperature, SDK range 2000–50000 | 4500 | 5150 | Confirmed |
| JPEG Temperature, SDK range -100–100 | -60 | 0 | Confirmed |
| Artistic profile Amount | 41 | 100 | Confirmed |

Disabled Profile Amount returned unavailable without invocation or a value.
Two queued identified Resets retained distinct receipts across a later Set and
legacy Reset; identical early/terminal retries preserved their original results.
Legacy GET Reset and the existing Web Controller GET proxy executed successfully.
Old epoch/photo/navigation requests were rejected before enqueue, and retained
receipts kept their original ownership. Mid-execution/result-delivery ownership
changes and SDK failure injection have automated coverage; they were not injected
into the native Lightroom session. This acceptance covers the recorded cases.

Register the fresh candidate's matching plug-in and **reload it once** after
loading the new EXE. Native commands must wait for the user's readiness. On a
disposable Develop photo, run this helper while the user watches Lightroom:

```powershell
# Default invocation is read-only preflight.
.\tools\test-reset-completion.ps1
# After user readiness: non-default Set -> identified Reset -> original receipt.
.\tools\test-reset-completion.ps1 -Run -Slider Exposure -SetValue 2.75
```

Compare the printed immediate `sdkValue` with Lightroom's actual completed Reset
value. Repeat with Contrast/Vibrance, RAW and rendered Temperature (use a valid
value for the actual range), and enabled Profile Amount. Check disabled Amount
with Reset only. Repeat a deliberate Reset with a fresh ID and verify identical
retry uses the original operation ID. Change photo/module during a queued run;
it must yield stale/uncertain without a value for the new owner. No UI automation,
screenshots, keyboard/mouse injection or faster polling is used.
