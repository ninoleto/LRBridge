# Queued numeric nudges — private 0.6.0-beta.3

Use the matching beta.3 application and plug-in. This opt-in API is for future
Companion integration. Companion and existing Web Controller controls are unchanged.
Native Lightroom acceptance is pending.

## Request and numeric semantics

Read `GET http://127.0.0.1:17891/nudge/capabilities` (also linked from `/help`). It
advertises supported slider IDs, numeric steps/precision, limits, the server epoch
and current photo/navigation binding. This is API support; actual availability is
checked by the SDK at execution.

Send `POST /nudge`, `Content-Type: application/json`, directly to port **17891**.
The existing Web Controller proxy does not forward this new POST route.
The body has exactly seven fields:

```json
{
  "requestId": "exposure-001",
  "serverEpoch": "<from capabilities>",
  "slider": "Exposure",
  "steps": [1, 1, -1],
  "selectedPhotoUuid": "<from capabilities.context>",
  "contextCounter": 12,
  "contextChangedAt": 1791250000000
}
```

`steps` is an **ordered array of signed integer counts of the slider's
`numericStep`**, specified in capabilities. It is neither numeric displacement nor
a count of SDK increment/decrement calls. Each entry adds `count * numericStep`,
clamps to current bounds, snaps to the numeric grid anchored at the lower bound,
rounds to metadata precision, then clamps again. Exact endpoints are retained.
The worker computes entries in order and makes one absolute SDK write. Separate
requests remain separate commands/results; reversals never collapse into a net sum.

- Exposure has `numericStep=0.01`, `rangeStep=0.1`. `[1,1,-1]` adds `0.01` away from
  bounds. At `-5`, `[-1,1]` produces `-4.99`; at `5`, `[1,-1]` produces `4.99`.
- Temperature has `numericStep=1`. The baseline and range come from current SDK
  reads. The existing positive-range logarithmic visual-position conversion does
  not apply. A runtime `2000..50000` range uses those actual numeric units; a
  runtime `-100..100` range uses those units instead. These are regression fixtures,
  not measurements of the user's current photo or an assumed Kelvin conversion.
- Profile Amount has `numericStep=1` and existing bounds `0..200`. It is supported
  despite `adjustSupported=false` through the existing absolute `setValue` path.
  Reset remains one write to `100`; the nudge **reads** its subsequent baseline,
  never assumes `100`.

Limits: 4 KiB JSON; 1–64 entries; each nonzero integer in `-1000..1000`; total
absolute counts at most 4096. Work is at most 64 arithmetic steps and one write.
Extra fields, strings/fractions/zero entries, and unsupported sliders are rejected.
Boolean controls and the unreadable legacy lens parameter are not advertised.

## Ordering, bindings and retries

Wait only for Reset's HTTP **queue admission**, then immediately send the nudge.
No client-side value read or Reset-feedback wait is required. Concurrent HTTP
requests have arrival order, so await admission before sending the next intended
operation. The existing serial worker runs the nudge after earlier commands return.
Nudges form coalescing boundaries for earlier edits, including Set, Reset and
categorical changes. `Set → Nudge → Set` and `Reset → Nudge → Reset` retain all
three commands. Separate nudges never coalesce.

Admission, dequeue and a one-use worker claim check server epoch, photo UUID,
navigation `contextCounter` and `contextChangedAt`. After SDK preparation/tracking,
the worker rechecks server binding and actual catalog/photo/UUID, Develop module,
process version, Profile Amount capability and runtime bounds before reading and
writing. Coupled Parametric split and Defringe limits retain the existing ten-unit
neighbor gap. Unavailable values/ranges fail closed.

A relative nudge intentionally uses current same-photo Develop state. Reset or
earlier edits may advance `developCounter`. Admission records that counter;
execution requires it not to decrease and reports the observed counter separately.
No old numeric baseline crosses a revision. Existing absolute/gesture/feedback
revision guards are unchanged. Results are correlated historical receipts; they
do not replace shared feedback or authorize updating a different photo/context.

**Profile-binding limitation:** beta.2 has no generic per-command SDK profile
generation token. The nudge binds the profile observed when execution starts and
rechecks it after yielding preparation. It cannot pin the profile selected at
HTTP admission: a same-photo profile change *before* execution can change which
current Amount is nudged. Explicit `SupportsAmount=false` (also string `"false"`)
blocks writing. Unknown capability retains the existing Look/AILook fallback and
requires a numeric SDK value. No capability is inferred from a profile name.
Revalidate the active profile before deliberately scheduling Amount edits across
profile changes.

Create a unique request ID for each deliberate action: 1–120 ASCII letters,
digits, `:`, `_` or `-`. Identical retries in the same epoch return the original
receipt and never enqueue again, before or after completion. Reusing an ID with
different intent returns `409`. Keep the **entire original body**, including its
binding, on retry. A plug-in high-water mark consumes operations before yielding;
the server one-use claim prevents replay even after a plug-in reload.

Up to 8192 accepted receipts are retained per server epoch without eviction;
capacity exhaustion rejects new requests with `503`. A new server process changes
the epoch and rejects old bodies. Never automatically replace an ID/epoch after
uncertainty or restart: inspect Lightroom first. Operations expire after 60 seconds
when next inspected, with no automatic retry. A claimed operation lacking completion
is `uncertain`; a pre-claim stale/expired command has not performed the nudge.
Ordinary queue capacity also applies (`503`).

## Completion and authority

New requests return `202` with a `queued` receipt. Identical retries return `200`
with `duplicate:true`. Poll:

```text
GET /nudge/result?serverEpoch=<original epoch>&requestId=exposure-001
```

Example completion (illustrative, not native evidence; detail text omitted):

```json
{
  "ok": true,
  "receipt": {
    "serverEpoch": "<original epoch>",
    "requestId": "exposure-001",
    "operationId": "nn-1",
    "phase": "complete",
    "result": {
      "requestId": "exposure-001", "operationId": "nn-1", "slider": "Exposure",
      "selectedPhotoUuid": "<original photo UUID>",
      "contextCounter": 12, "contextChangedAt": 1791250000000,
      "admittedDevelopCounter": 40, "executionDevelopCounter": 41,
      "outcome": "observed", "invoked": true,
      "baselineValue": 0.37, "requestedValue": 0.38, "sdkValue": 0.38,
      "valueSource": "sdk", "matchesRequested": true, "min": -5, "max": 5
    }
  }
}
```

`baselineValue` is an SDK read after preceding commands return. `requestedValue`
is calculated. `sdkValue` is a **separate SDK read after writing**;
`matchesRequested` can be false. `observed` means that read was available, not
that later Lightroom processing cannot change it. `requested` means the write
returned but readback was unavailable. Other outcomes: `unavailable`, `stale`,
`failed`, `uncertain`. Timeout/context invalidation can omit values and `invoked`.
`/nudge/claim`, `/nudge/validate`, `/nudge/operation-result` are internal protocol.

The installed Adobe 15.3 SDK reference describes Reset as resetting the current
photo and `getValue` as reading its current adjustment. It exposes no separate
Reset-completion token. Tests execute production Lua with mock SDK values,
including nonzero Reset defaults, and check that baseline reads follow Reset and
yielding preparation. **Native Reset-to-read ordering still requires live QA.**
No guessed default, cached feedback or arbitrary settling delay establishes it.
The existing Driver preparation sleep is unchanged and is not treated as proof.

## Private live QA

Exit LRBridge; launch the private beta.3 EXE, register its bundled
`lightroom/LRBridge.lrplugin`, and **reload the plug-in once** before validation.
Use disposable photos in Develop. Existing controls do not exercise the new API.
From the package folder, run the included PowerShell helper:

```powershell
.\tools\test-numeric-nudge.ps1 -Slider Exposure -Steps '1,1,-1'
.\tools\test-numeric-nudge.ps1 -Slider Temperature -Steps '10,10,-5'
.\tools\test-numeric-nudge.ps1 -Slider ProfileAmount -Steps '1,1,-1'
```

The helper fetches context, queues Reset, immediately queues a nudge, and polls
its receipt. It never retries a mutation. First observe a native Reset on the
chosen photo and record its actual value. Move the value away from Reset, run the
helper and compare `baselineValue` to that native result. Compare `sdkValue` and
the ordered arithmetic with Lightroom. Try RAW and rendered photos for Temperature
and record actual ranges. For Profile Amount, test an enabled creative/adaptive
profile and one where Amount is disabled. At limits use `-SkipReset -Steps '-1,1'`
or `'1,-1'`; separate requests should each have their own receipt. Test navigating
to another photo/module while commands wait. Inspect any uncertainty before retry.

Leave Clipboard/Export views polling. State should refresh without routine query
receipt and queue-length lines. Real editing logs, failures and explicit polling
traces remain. Poll intervals, query admission, delivery and feedback are unchanged.
