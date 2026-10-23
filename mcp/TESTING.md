# MCP verification and manual acceptance

Development baseline: `v0.6.0-rc.1`, commit
`c03ffdd9170837c0ac1b1ba284c8c7bb3dda34d6`. No Lightroom Classic instance,
personal computer or real catalog is available in the development environment.
The owner subsequently ran the limited Windows/Lightroom checks recorded below.
The follow-up Contrast Set/Reset check passed on the first revision-confirmation
fix. A subsequent batch exposed a queued-feedback dispatch race; its adapter fix
passes automated checks and awaits native retesting. Full native acceptance
remains pending.

## Automated evidence

Run the commands in [README.md](README.md#development-tests-and-reproducible-packaging).
The tests never use port 17891 or a real Lightroom worker: each fixture binds an
ephemeral loopback port and gives the adapter a temporary private journal.

- `npm test` covers the official MCP client over stdio, three legacy initialization
  versions, tool discovery/schema rejection, all 111 registry entries, SDK reads,
  numeric units/ranges, Set/Nudge/Reset, receipt identity, stale ownership/revisions,
  offline heartbeat, network failure, cancellation and timeouts, duplicate IDs,
  journal persistence/failure, interrupted calls, interprocess exclusion, batch
  prevalidation/partial failure, and loopback/redirect/response-size restrictions.
  The revision-confirmation cases reproduce a heartbeat after an accepted worker
  receipt and require fresh owned SDK evidence; changed values, unavailable/stale
  feedback, changed ownership and uncertain worker receipts cannot confirm.
  A further 22 dispatch-confirmation cases cover later same-owner bindings before
  SDK dispatch, immutable partial snapshots, strict admission baselines, batch
  stopping, unavailable/changed values and durable duplicate behavior.
- `npm run test:bridge` runs the adapter against the actual RC1 HTTP handlers,
  command queue and receipt stores with an isolated SDK worker double. It checks
  Set, Nudge, Reset, duplicate behavior, stale photo rejection and later same-photo
  heartbeats after retained Nudge/Reset receipts. The batch fixture holds the SDK
  worker until each new empty confirmation request is admitted, advances the same
  photo's revision, then lets the actual RC1 handler bind and complete the read.
- The existing `test:guarded-set`, `test:numeric-nudge` and `test:reset-completion`
  suites exercise production Lua, parsers/worker ordering and SDK doubles. The
  adapter does not change their implementations or fixtures.
- Packaging checks compare two generated archives byte-for-byte, verify every
  manifest hash and dependency pin, and reject unintended package contents.
- `.github/workflows/mcp.yml` checks Node 22/24 on Windows/Linux, the real-route
  integration fixture, local packaging, and existing RC1 regression on Windows.
  A workflow definition is not evidence that a hosted run has passed.

Local results: **126/126 MCP tests**, **8/8 actual-route integration tests**, and the
separate existing Guarded Set check (**33 SDK/ownership/envelope scenarios**) pass.
The existing Numeric Nudge and Reset completion checks also pass after this fix.
`npm audit --omit=dev` reports **0 vulnerabilities** in the MCP production graph.
The browser runner returned **9/10** using Chromium 153.0.8010.0 with a Linux
container launch wrapper. `release-docs-browser` failed on its existing early
`document.body.dataset` access while `document.body` was null; the identical
failure reproduced on untouched RC1. No browser fixture was patched.
For fix commit `ad6d902cd10b4921f1f2637ecd0786ef4c38fd3e`,
[hosted run 40030357076](https://github.com/ninoleto/LRBridge/actions/runs/40030357076)
passed all five jobs: MCP, actual-route integration and packaging on Windows/Linux
with Node 22/24, plus the existing Windows Guarded Set, **75/75 core** and
**10/10 browser** checks. Later CI status is recorded in the pull request.
The Linux development runtime is Node 24.19.0 and npm 11.9.0. The parent application's
core release runner returned **71/75**: four failures reproduced on the untouched
RC1 tag (`controller-proxy`, `controller-feedback-snapshot-proxy`,
`controller-http-limits`, `release-preparation`). They involve the existing
disconnected-response assertion, unavailable `os.networkInterfaces()` syscall,
and missing Windows `powershell.exe`. No parent source/fixture was changed to
make those checks pass. Hosted Windows CI and native Lightroom acceptance remain
distinct.

## Owner-provided Windows/Lightroom evidence — 2026-10-23

The owner supplied native Codex transcripts and Lightroom screenshots for commit
`b4102a0fd284a070c9ac4ee350b554c42a2ae89c`, with Node 24.18.0, PowerShell 7.6.7,
Codex CLI 0.164.0 and the existing RC1 application/plug-in. Lightroom's exact
version was not supplied. Personal photo paths, UUIDs and screenshots are omitted.

| Check | Observed evidence |
| --- | --- |
| Installation, connection and discovery | `--check` reported ready; Codex connected with nine tools |
| Exposure, Contrast, Highlights, Shadows, Clarity, Vibrance | SDK read returned zero for all six, matching the screenshot |
| Guarded Contrast Set | 0 to +10, tool confirmed, fresh SDK read and screenshot agreed |
| Relative Vibrance adjustment | 0 to +5, tool confirmed and screenshot agreed |
| Contrast Reset | Worker observed 0 and screenshot agreed; adapter returned `observation_revision_changed` and stopped without retrying |

That Reset exposed an over-conservative adapter revision check. The fix preserves
the historical receipt and obtains fresh SDK feedback under the same original
photo/navigation/epoch owner when the current revision has advanced. Only a value
matching the successful worker observation confirms. All other ownership, receipt,
readback and no-replay checks remain in force. Both new positive regression cases
failed against the original adapter and passed after the fix. The original
uncertain journal entry is not rewritten or automatically acknowledged by upgrading.

### Follow-up Contrast retest on the fix

The owner supplied a native Codex transcript with a clean `feature/mcp-server`
checkout at `ad6d902cd10b4921f1f2637ecd0786ef4c38fd3e`, equal to its upstream.
Fresh SDK context was read before each operation on the same test photo:

| Operation | Tool status | Fresh SDK Contrast read afterward |
| --- | --- | ---: |
| `lrbridge_set_slider` to +10 | Confirmed | +10 |
| `lrbridge_reset_slider` | Confirmed | 0 |

The transcript reports only Contrast changed and no retries. This establishes a
successful native Set/Reset check on the fixed adapter; the abbreviated output
does not establish whether that run exercised the later-revision recovery path.
The automated cases cover that path and its failure conditions. Claude Code,
additional controls/photo types, batches and the remaining race/interruption
checks below still require native testing.

### Subsequent batch attempt and dispatch-confirmation fix

The next native Codex transcript requested Contrast +10, Clarity +5 and Vibrance
+10 from initial SDK values of 0. The first result was `uncertain` with
`stale_feedback`; Clarity and Vibrance were `not_attempted`. The client stopped
without retries, rollback, further writes or a final SDK read. The supplied
Lightroom screenshot showed Contrast +10, Clarity 0 and Vibrance 0. This visual
evidence does not retroactively confirm the MCP operation or clear its journal.

The same failure was reproduced with the actual RC1 HTTP handlers: a queued
`purpose=edit` confirmation read legitimately binds to a later same-photo revision
at SDK dispatch, but the adapter required its earlier request-time revision. Four
positive mocked cases and the actual-route batch failed before the adapter fix.
Post-execution confirmation now accepts the request's later dispatch binding only
under its original owner, keeps that binding immutable once seen, and verifies
the exact revision is still current when the read completes. All numeric values
still come from correlated SDK results and must match the successful operation.
Admission reads remain strict; no read or mutation is resubmitted. Existing
uncertain records are not rewritten, acknowledged or resumed by an upgrade.

The native trace abbreviates the tool JSON, so the individual mismatched context
fields from that run are unavailable. The regression establishes a real protocol
mismatch producing the same reported failure. **The fixed three-slider batch
still requires a native retest.**

## Windows and Lightroom manual checklist

Use disposable photos in a test catalog. Existing published installations remain
unchanged. Run the standalone MCP server next to the released RC1 application
and its matching plug-in; there is no new plug-in to reload for this adapter.

1. **Installation and stdio:** install with the locked dependencies, run `--check`,
   then connect from native Windows Codex and Claude Code separately. Verify all
   nine tools, normal write approval prompts, and clean startup/shutdown.
2. **Reads:** select a photo in Develop. Compare Exposure, Contrast, Highlights,
   Shadows, Clarity, Vibrance and Temperature with Lightroom's displayed values.
   Confirm unavailable controls stay unavailable. Repeat with RAW and rendered
   photos; record Temperature's actual range/units without assuming Kelvin.
3. **Guarded Set:** deliberately set Contrast, Clarity and Vibrance to nondefault
   targets. Check both the actual Lightroom values and reported SDK observations.
   Try a manual coarse edit while an MCP Set is preparing: a baseline conflict
   must reject rather than overwrite the changed baseline.
4. **Unsupported absolute targets:** request Exposure/Highlights/Shadows absolute
   Set, alone and in a batch with a supported control. All absolute operations
   in that request must be refused before any photo edit.
5. **Relative Nudge:** increase Vibrance by 5 and Exposure by 0.35. Check returned
   baseline/target/SDK value, numeric precision and edge clamping. Where available,
   test Temperature and Profile Amount; do not change profiles while scheduling
   Amount operations because RC1 lacks an admission-time profile-generation token.
6. **Reset:** move Contrast away from its reset value, then Reset. Compare its
   actual SDK observation with Lightroom. Repeat Exposure and RAW/rendered
   Temperature; verify a nonzero reset baseline is not replaced by zero.
7. **Navigation:** change photo/module before dispatch and while a call is pending.
   Verify rejection/uncertainty and that no old intent follows the new photo. Test
   returning to the original photo: its new navigation counter must invalidate
   the old context. Never treat an old receipt as the current photo's settings.
8. **Ordering/batches:** send a supported three-control batch and observe distinct
   sequential receipts. Induce an unavailable/stale second target. The first edit
   remains, later targets are not attempted, and there is no rollback.
9. **Interrupted connection:** on disposable data, stop Lightroom/LRBridge or the
   MCP process during a queued call. Inspect the operation using the original ID.
   Restarting MCP must not repeat a write. Other writes must remain blocked after
   uncertainty until you inspect Lightroom and explicitly acknowledge review.
   Acknowledgement while a receipt remains pending must be refused.
10. **Other controllers:** repeat with the existing Web Controller/Companion
    connected. Confirm their behavior is unchanged and that intervening edits
    cause safe conflicts or accurate historical/uncertain reporting.

Record Lightroom version, installed LRBridge version, Node version, AI client
version, photo type, tool result and the observed native value for each case.
Do not mark native acceptance complete based on mocked tests or HTTP admission.
