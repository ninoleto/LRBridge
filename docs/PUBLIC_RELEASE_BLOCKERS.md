# RC1 public-release blockers — reconciled 2026-10-12

**Publication is blocked by the current security findings below.** Functional
acceptance and passing regression tests do not resolve caller authentication.
No authentication migration, bind-address change or network redesign is included
in this integration release. Do not publish either RC1 prerelease until the
shared publication conditions have been satisfied.

## Resolved historical items

- The user explicitly tested and accepted LRBridge beta.4, Lightroom plug-in
  beta4.10 and Companion beta4.13 as RC1 on 2026-10-12. Earlier statements that
  native acceptance is pending are superseded within that reported scope.
  No additional manual scenarios are inferred.
- The working plug-in, beta4.10 ZIP and beta4.13 reference overlay agree on all
  four changed file hashes. The other 41 plug-in files and all accepted app/server
  runtime files are retained. RC1 changes only Info.lua version metadata beyond
  that accepted plug-in implementation.
- Companion builds with Node 22.20.0 and pinned Yarn 4.17.0; all **265 tests pass**
  against the integrated RC1 source. The rebuilt package's main.js is
  byte-identical to the accepted beta4.13 TGZ.

## Historical regressions reconciled against current source

| Existing check | Cause and RC1 reconciliation |
| --- | --- |
| tests/lens-blur.js | The accepted amber warning CSS shares a selector with Masking. Checks the exact shared rule and same border/color; focused check passes. |
| tests/develop-presets.js | The accepted blue Presets rule shares styling with Tools shortcuts. Checks the exact shared rule and same color; focused check passes. |
| tests/contract-baseline.js | Stale iterator name, command/route registration order and response key inventories. Explicit fixtures now include accepted Guarded Set, Point Color, capability and Masking context fields. Route, command, slider and ownership assertions remain; focused check passes. |
| tests/controller-http-limits.js | Old Builder title and navigation links. Pins the accepted title and workflow link while still requiring all three reference routes and content; focused check passes. |
| tests/controller-command-tabs.js | LF-only source extraction failed on a CRLF Windows checkout. Normalizes line endings before unchanged command assertions; focused check passes. |
| tests/release-docs-browser.js | Old Dust and developer-reference wording/emphasis. Exact expectations now match accepted source. Phone fixture reaches the toolbar by measured position before asserting stickiness, compactness and touch geometry; 1280/390/320px checks pass. |

Two additional fixture updates retain exact checks: queue diagnostics includes
the accepted Guarded Set and global Point Color commands, and Lua polling checks
the RC1 metadata. No production UI/HTTP source, protected cheat sheets, test
skips, behavioral guards or assertion thresholds were changed to obtain passes.

Initial full runs were **68/75 core** and **9/10 browser**. After the fixture
reconciliation and focused retests, final full runs pass **75/75 core** and
**10/10 browser** checks. Companion passes **265/265 tests**. Detailed evidence
is retained in the local RC1 preparation report.

## Current blockers

1. **Network listeners are not restricted to loopback by default.**
   createBridge() in server/bridge.js leaves httpHost and wsHost undefined;
   listenHttp() and listenWebSocket() omit a host in that case. An isolated
   instance using only ephemeral ports reported `::` for both listeners.
   app/main.js serves the Web Controller on `0.0.0.0`. Other-device reachability
   depends on the host firewall/network; no firewall exposure test or internet
   reachability claim is made.
2. **Commands and internal state updates do not authenticate their caller.**
   In that isolated instance, unauthenticated GET /adjust returned 200 and queued
   a command; an unauthenticated WebSocket message also entered the queue.
   GET /context/update accepted an arbitrary fixture photo UUID, and GET /context
   then reported it. No Lightroom plug-in was attached and no native helper ran.
   This demonstrates command admission and internal context spoofing, not edits
   to real photos. Context counters, revisions, request IDs, epochs and one-use
   claims are ownership safeguards, not caller credentials; they do not close
   this trust boundary.
3. **The earlier security review cannot be declared fully closed.**
   Its original complete finding artifact was not recovered from the targeted
   repository/handoff evidence or available named downloads. The findings above
   were independently reproduced against current source. They do not substitute
   for reconciling additional findings in that original review.

Closing these items requires an explicit reviewed security scope/decision and
matching verification while preserving trusted-LAN/Companion compatibility and
the authoritative plug-in boundary. This integration does not silently introduce
that redesign or treat a documentation warning as a security fix.

## Package acceptance

The working portable installation and settings remain untouched. Automated
checks use offline fixtures. A fresh RC1 installation still needs the ordinary
user-led smoke check: new folder, settings migration, matching plug-in reloaded
once, connection, Companion import and version display. It is not a request to
repeat accepted feature testing and does not remove the blockers above.
