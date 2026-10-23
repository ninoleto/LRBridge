# MCP verification and manual acceptance

Development baseline: `v0.6.0-rc.1`, commit
`c03ffdd9170837c0ac1b1ba284c8c7bb3dda34d6`. No Lightroom Classic instance,
personal computer or real catalog is available in the development environment.
No real Lightroom integration or Windows installation acceptance is claimed.

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
- `npm run test:bridge` runs the adapter against the actual RC1 HTTP handlers,
  command queue and receipt stores with an isolated SDK worker double. It checks
  Set, Nudge, Reset, duplicate behavior and stale photo rejection.
- The existing `test:guarded-set`, `test:numeric-nudge` and `test:reset-completion`
  suites exercise production Lua, parsers/worker ordering and SDK doubles. The
  adapter does not change their implementations or fixtures.
- Packaging checks compare two generated archives byte-for-byte, verify every
  manifest hash and dependency pin, and reject unintended package contents.
- `.github/workflows/mcp.yml` checks Node 22/24 on Windows/Linux, the real-route
  integration fixture, local packaging, and existing RC1 regression on Windows.
  A workflow definition is not evidence that a hosted run has passed.

Local results: **77/77 MCP tests**, **5/5 actual-route integration tests**, and the
separate existing Guarded Set check (**33 SDK/ownership/envelope scenarios**) pass.
`npm audit --omit=dev` reports **0 vulnerabilities** in the MCP production graph.
The browser runner returned **9/10** using Chromium 153.0.8010.0 with a Linux
container launch wrapper. `release-docs-browser` failed on its existing early
`document.body.dataset` access while `document.body` was null; the identical
failure reproduced on untouched RC1. No browser fixture was patched.
Hosted CI status is recorded separately in the pull request.
The Linux development runtime is Node 24.19.0 and npm 11.9.0. The parent application's
core release runner returned **71/75**: four failures reproduced on the untouched
RC1 tag (`controller-proxy`, `controller-feedback-snapshot-proxy`,
`controller-http-limits`, `release-preparation`). They involve the existing
disconnected-response assertion, unavailable `os.networkInterfaces()` syscall,
and missing Windows `powershell.exe`. No parent source/fixture was changed to
make those checks pass. Windows CI/manual verification remains distinct.

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
