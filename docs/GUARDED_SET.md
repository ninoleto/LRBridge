# Optional guarded Set — private beta.4

Legacy `GET /set?slider=Contrast&value=24`, `/adjust` and both Reset contracts
retain their existing request formats and behavior. This optional absolute Set
workflow supports Contrast, Clarity and Vibrance. It is used once per accumulated
Companion fine-button batch, not once per physical press. Numeric Nudge is intact.

Read `GET /set/capabilities` on port 17891 for version 1 support, current server
epoch, supported sliders and photo context. Acquire a fresh request-owned SDK
baseline through the existing feedback API. Never use a displayed preview as
the baseline. Example (replace all identities with current returned values):

```http
POST /set
Content-Type: application/json

{"requestId":"companion-fine-example-1","serverEpoch":"current-epoch","slider":"Contrast","expectedValue":23,"value":31,"selectedPhotoUuid":"current-photo-uuid","contextCounter":7,"contextChangedAt":1791640000000}
```

Both numeric values must be finite and within -100..100. The target is absolute;
the server does not invent or accumulate relative steps. Unknown fields and
invalid ownership tokens are rejected. HTTP 202 means queued, not applied.

```json
{"ok":true,"status":202,"duplicate":false,"receipt":{"serverEpoch":"current-epoch","requestId":"companion-fine-example-1","operationId":"gs-1","phase":"queued","result":null}}
```

Read `GET /set/result?serverEpoch=current-epoch&requestId=companion-fine-example-1`.
An example terminal `receipt.result` is:

```json
{"serverEpoch":"current-epoch","requestId":"companion-fine-example-1","operationId":"gs-1","slider":"Contrast","selectedPhotoUuid":"current-photo-uuid","contextCounter":7,"contextChangedAt":1791640000000,"expectedValue":23,"requestedValue":31,"admittedDevelopCounter":12,"outcome":"applied","reason":"sdk-returned","invoked":true,"completedAt":1791640000120}
```

`applied` means this owned SDK invocation returned successfully. `requestedValue`
is the target, **not an observed/current SDK value**. It must not populate
authoritative display state. Request separate normal SDK feedback to confirm
the current value. A later coarse adjustment can already have changed it.

## Exact execution location and ownership

The existing serial worker dispatches `develop.set.guarded` through Parser and
Commands into `GuardedSet.execute`. The command claims its unique receipt once.
It calls the unchanged `Driver.setSlider` with its existing `resolveValue` hook.
Inside that hook, **after reveal/sleep/startTracking and immediately before the
SDK Set**, GuardedSet validates the receipt, rechecks actual catalog/photo UUID,
module, process and plug-in lifecycle, checks the SDK range, and reads
`LrDevelopController.getValue(c.slider)`. It compares that actual value with
`expectedValue`. A mismatch returns nil from the hook, so Driver does not write.
The subsequent `setValue` uses the unchanged Driver path. There is no independent
feedback queue in this comparison or write path.

The server independently checks server epoch, photo UUID, context counter/time
and admitted Develop revision at admission, dequeue, claim, validation and
settlement. Native ownership is checked around yielding preparation and reads.
SDK exceptions after entering the write are uncertain, never automatically
treated as safe to replay. Failed baseline/range reads reject without invocation.

## Ordering, retries and lifecycle

- A guarded Set is a FIFO coalescing boundary. It neither replaces a pending
  Reset/Set nor disappears under a later Set/Reset. Each receipt describes its
  own operation. Existing coalescing between ordinary commands is unchanged.
- Retry only the **identical full request body and request ID**. It returns the
  existing receipt and never enqueues again. Changed payload with a reused ID
  returns HTTP 409. This also applies to retained terminal refusals.
- Phases are queued, dispatched, executing and complete. Terminal outcomes are
  applied, rejected or uncertain. Rejected with `invoked:false` is definite
  non-execution. `baseline-mismatch` may be rebased using a new SDK baseline and
  a new ID. Never rebase/replay an uncertain write.
- Queued/dispatched expiry or ownership loss rejects without invocation.
  After a claim, expiry/ownership loss is conservative uncertainty. Stop also
  settles outstanding receipts. Timeout is 15 seconds; the sweep runs each second.
- At most 8192 IDs are retained per server epoch with no eviction. Capacity or
  queue refusal cannot silently forget an accepted ID. Epoch changes invalidate
  old requests; clients must not convert an unknown old receipt into a new edit.
- `/set/claim`, `/set/validate` and `/set/operation-result` are internal plug-in
  protocol, not Companion button actions or permanent Builder URLs.

## Companion behavior and ordering boundary

The private module adds one configurable `fine_step` action and six down-only
presets. It accumulates ordered ±1 presses over an 80 ms window, clamps each press
in order, reads a fresh SDK baseline, and submits one guarded absolute target.
Only one fine batch is outstanding across the three controls. Native ordinary
rotaries retain immediate `/adjust`; no fine acquisition, debounce or receipt
promise is inserted into that sender. Advanced SDK controls keep their existing
absolute workflows, and the accepted Reset coordinator keeps its owned replay.

FIFO order is the order **admitted by the bridge**. Unsubmitted fine presses may
be deferred/rebased after intervening native coarse edits; the client does not
claim that a debounced press has already entered the command queue. Bounds are
applied in press order within each fine batch against that fresh baseline. Reset
explicitly retires unsent earlier fine intent; following fine input waits for
Reset ownership/acquisition and uses the new baseline. Photo/connection changes
retire pending intent with an explicit status. No input is carried to a new photo.

Pending storage is bounded to 4096 presses. Unavailable feedback defers writes;
prolonged failure retires the intent with an explicit error. Lost admission may
retry the identical ID once. An uncertain completion blocks only fine replay,
with an explicit error requiring Reset or a photo change; native coarse dispatch
remains available. Optimistic targets are never labeled SDK confirmation.

## Verification limits

Automated tests use actual server routes, queue, Parser, Commands, Driver and
worker with SDK doubles, plus the actual Companion module and feedback scheduler.
They do not establish native Lightroom completion timing or UI responsiveness.
The immediate SDK comparison is not a documented atomic SDK compare-and-set
primitive; native QA must exercise manual edits/navigation during preparation.
No global locks, new TCP transport, polling worker, production dependency or
Companion installation is introduced. Security findings remain separate public
release blockers in `PUBLIC_RELEASE_BLOCKERS.md`.
