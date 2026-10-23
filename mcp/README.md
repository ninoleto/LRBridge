# LRBridge MCP server — development version 0.1.0

An optional local **stdio MCP server** for Codex and Claude Code. It calls the
existing LRBridge HTTP API; keep the released LRBridge application and its
matching Lightroom Classic plug-in running. This package does not replace the
Electron executable, install another Lightroom plug-in, or open a network listener.

Source baseline: [`v0.6.0-rc.1`](https://github.com/ninoleto/LRBridge/tree/v0.6.0-rc.1),
commit `c03ffdd9170837c0ac1b1ba284c8c7bb3dda34d6`. Dependencies and installation
are confined to `mcp/`. The parent application's lockfile and production code
are unchanged. This development package is not a published LRBridge release.

## What RC1 can safely do

| Operation | This adapter's RC1 behavior |
| --- | --- |
| Discover sliders | Reads all 111 registry entries and current safe capabilities; optional SDK availability |
| Read Develop values | Fresh request-owned SDK snapshots, with photo/context/revision validation |
| Absolute Set | **Contrast, Clarity and Vibrance only**, using guarded `POST /set` |
| Relative adjustment | Advertised numeric Nudge controls, including Exposure; numeric displacement, not SDK increment counts |
| Reset | Advertised identified Reset controls; actual SDK observation, no assumed default |
| Multiple Sets | Sequential independent guarded Sets; prevalidate the whole batch, stop on first non-confirmation |
| Operation lookup | Read-only retrieval of original receipts after a timeout or interrupted session |

**The requested example “Set Exposure to +0.35, Highlights to -40, Shadows to
+25 and Clarity to +10” is refused as an absolute batch on unmodified RC1.**
The shipped guarded Set endpoint and Lua implementation explicitly allow only
Contrast, Clarity and Vibrance. Legacy GET Set has weaker ownership guarantees.
Reading a value and converting an absolute target to a Nudge is also unsafe:
the SDK baseline can change before execution. The adapter uses neither fallback.
Extending absolute Set to other controls requires a separately tested LRBridge
server/plug-in change and a matching application build.

These requests are supported when the relevant SDK controls are available:

- “Read my current Lightroom Develop settings.”
- “Set Contrast to -20, Clarity to +10 and Vibrance to +15.”
- “Increase Vibrance by 5.”
- “Increase Exposure by 0.35.” This is relative to the execution-time value.
- “Reset the Contrast slider.”

No image preview, masks, selection editing, export, preset application or UI
automation is included. Photo context reports the active UUID/key/path supplied
by RC1; it does not invent a catalog ID, filename, selection count or image data.
Photo metadata and requested SDK values are returned to your AI client.

## Windows installation from the development branch

Use native Windows Codex or Claude Code on the same PC as Lightroom and LRBridge.
Install Node.js **22 or 24** (24 recommended) and Git. No paid API key, global npm
package installation, Electron rebuild or Lightroom plug-in reload is needed.

Run in PowerShell. Choose a new directory; leave an existing LRBridge working
copy and installed portable application alone:

```powershell
git clone --branch feature/mcp-server https://github.com/ninoleto/LRBridge.git D:\Projects\LRBridge-MCP
Set-Location D:\Projects\LRBridge-MCP\mcp
npm.cmd ci --omit=dev --ignore-scripts
node .\src\cli.js --version
node .\src\cli.js --check
```

Start the installed LRBridge RC1 application and Lightroom Classic, select a
photo, and open Develop. `--check` makes read-only HTTP requests and prints JSON.
Exit code 0 means a reachable compatible bridge and a recent Develop/photo
heartbeat; it does **not** prove that edits work. Other states exit 1 with details.

The default API address is `http://127.0.0.1:17891`, without `/api`. If you changed
the API port, set `LRBRIDGE_URL` in your MCP configuration to its local origin.
Only `http://127.0.0.1`, `http://[::1]` and `http://localhost` origins are allowed;
`localhost` is pinned to `127.0.0.1`. No DNS, redirects, proxies, LAN addresses,
credentials in URLs or public hosts are used. There is no remote override flag.

WSL/containers/remote Codex sessions have different loopback networks; run this
adapter as a **native Windows process** to control Windows LRBridge. Do not solve
that mismatch by publicly exposing the unauthenticated RC1 HTTP API. The MCP
adapter does not change RC1's existing HTTP/WebSocket listener bindings or its
[documented network limitations](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/PUBLIC_RELEASE_BLOCKERS.md).

## Codex configuration

Add the following table to `%USERPROFILE%\.codex\config.toml`, adjusting paths.
Do not replace unrelated existing settings. A ready-to-copy version is in
[`examples/codex-config.toml`](examples/codex-config.toml).

```toml
[mcp_servers.lrbridge]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Projects\LRBridge-MCP\mcp\src\cli.js']
startup_timeout_sec = 10
tool_timeout_sec = 180

[mcp_servers.lrbridge.env]
LRBRIDGE_URL = 'http://127.0.0.1:17891'
```

Restart Codex, use `/mcp` to inspect the connection, and first ask it to call
`lrbridge_get_status` and `lrbridge_get_slider_values`. Retain your client's
normal approval policy for write tools. The server's tool annotations mark
mutations as potentially destructive, not automatically safe to repeat.

Configuration reference:
[official Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Claude Code configuration

For all your local projects, run this once in PowerShell:

```powershell
claude mcp add --transport stdio --scope user lrbridge -- "C:\Program Files\nodejs\node.exe" "D:\Projects\LRBridge-MCP\mcp\src\cli.js"
claude mcp list
```

Alternatively merge [`examples/claude-code.mcp.json`](examples/claude-code.mcp.json)
into a project's `.mcp.json` and adjust paths. Restart Claude Code and use `/mcp`.
This is Claude **Code** configuration, not `claude_desktop_config.json`.
No `npx` or shell wrapper is needed; the client starts `node.exe` directly.
Allow a tool-call timeout of at least 180 seconds if you override the client's
defaults: a bounded batch may take up to two minutes plus feedback acquisition.

Configuration reference:
[official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp-quickstart).

## Tool contract

| Tool | Arguments |
| --- | --- |
| `lrbridge_get_status` | None |
| `lrbridge_get_photo_context` | None |
| `lrbridge_list_sliders` | Optional `group`, `includeAvailability` (default true) |
| `lrbridge_get_slider_values` | Optional `sliders` array; omitted means all registered sliders |
| `lrbridge_set_slider` | `requestId`, `context`, `slider`, `value` |
| `lrbridge_adjust_slider` | `requestId`, `context`, `slider`, `amount` |
| `lrbridge_reset_slider` | `requestId`, `context`, `slider` |
| `lrbridge_set_multiple_sliders` | `requestId`, `context`, `adjustments: [{slider, value}, ...]` (1–8 unique IDs) |
| `lrbridge_get_operation` | Original `requestId` |

1. Read current values/context. Copy the returned `context` object unchanged:
   `serverEpoch`, `activeModule`, `selectedPhotoUuid`, `contextCounter`,
   `contextChangedAt`, `developCounter`.
2. Use a unique `requestId` (1–100 ASCII letters, digits, `:`, `_`, `-`) for one
   deliberate action. Do not change it or refresh ownership to replay uncertainty.
3. Submit a write. All inputs use strict schemas; unknown fields, strings instead
   of numbers, unsupported controls and off-grid/out-of-range targets are refused.
4. Report `confirmed`, `rejected` or `uncertain` accurately. Batch results also
   expose `partial_failure` and per-item `not_attempted`.

The service checks the captured revision before dispatch. Relative Nudge and
Reset retain RC1's execution-time semantics: earlier same-photo edits may advance
the Develop revision while a command waits. Nudge reads its baseline in the serial
worker, applies numericStep counts with bounds/snapping, then writes once. A
displacement larger than one 1000-count entry is split into ordered entries inside
**one** POST, up to the advertised 4096 total-count bound. No Kelvin conversion is
invented. Exact observed execution bounds and values are preserved in the receipt.

`registryRange` may contain a previously cached runtime range. It is descriptive,
not authority for admission. Current ranges/availability come from the owned SDK
snapshot. An unavailable supported slider is distinct from an unknown slider or
an unsupported MCP operation. Missing feedback causes an error, never a default.

### What confirmation means

- HTTP 202, `queued`, `dispatched` and `executing` are not confirmation.
- Guarded Set needs a matching successful SDK-invocation receipt **and** a later
  request-owned SDK snapshot showing the target in the same photo/context.
- Nudge needs its matching `observed` receipt, a separate finite SDK read matching
  the calculated target, and current ownership/revision. The calculated target is
  never presented as observed feedback by itself.
- Reset needs its matching successful Reset plus the SDK read captured inside the
  same serial worker. Its actual value is returned; no zero/default is assumed.
- A heartbeat can advance the Develop revision after a valid Nudge/Reset receipt
  is retained. The adapter does not assume that its own edit caused that change.
  It acquires a new request-owned SDK snapshot at the later revision, still bound
  to the original server epoch, photo and navigation context, and confirms only
  if its value matches the worker's SDK observation. The original receipt keeps
  its historical revision. Changed values, stale/missing feedback, navigation or
  another revision change during the read remain uncertain. This is a read-only
  confirmation step, never a repeated write or an automatic journal acknowledgement.
  An uncertain/failed worker receipt cannot be upgraded by a matching later value.
- A value can change after observation. These checks do not promise a universal
  Lightroom processing-completion barrier or an atomic SDK compare-and-set.
- Profile Amount inherits RC1's limitation: there is no admission-time profile
  generation token. A same-photo profile change before execution can change which
  current profile Amount is adjusted/reset. Do not schedule Amount edits while
  changing profiles; changes during execution remain guarded by RC1.

Details of the underlying protocols:
[Guarded Set](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/GUARDED_SET.md),
[Numeric Nudge](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/NUMERIC_NUDGE.md),
[identified Reset](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/RESET_COMPLETION.md),
[HTTP workflows](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/HTTP_WORKFLOWS.md).

## Ordering, uncertainty and recovery

Only one MCP write runs at a time per endpoint/journal, including across two
local client processes. A simultaneous writer is rejected as `writer_busy`;
it is not silently queued against a potentially stale photo. LRBridge's own
FIFO boundaries, one-use claims and retained receipts remain in charge of SDK
execution. Companion and manual Lightroom edits can still occur.

Before the **single** POST, the adapter saves the exact request to a durable local
journal, normally `%LOCALAPPDATA%\LRBridgeMCP\<endpoint-hash>`. It stores ownership,
intent and results, not image pixels or photo paths. Use the same journal location
for Codex and Claude Code. `LRBRIDGE_MCP_STATE_DIR` can specify an absolute local
directory; do not use a network share or different directories to bypass locking.

Repeating the identical MCP call returns its stored historical result and never
sends another POST, including after process restart. Reusing the ID with different
arguments is rejected. Up to 8192 operation records are retained without eviction.
A changed LRBridge epoch invalidates old ownership instead of rebinding it.

A timeout, lost response, interrupted process, uncertain SDK result, mismatched
feedback or failed result persistence requires review. Subsequent new writes are
blocked; reads still work. An admitted command can continue after the MCP client
times out or cancels. Closing an MCP process does not cancel Lightroom work.

Read the old receipt, from the AI tool or PowerShell:

```powershell
node .\src\cli.js --operation YOUR_REQUEST_ID
```

After **you inspect Lightroom and the operation's terminal state**, record review:

```powershell
node .\src\cli.js --acknowledge YOUR_REQUEST_ID --reviewed-in-lightroom
```

This command sends no edit. It refuses acknowledgement while the same-epoch
receipt is still queued/dispatched/executing. It never makes the old request ID
reusable, retries the old edit, rolls back an edit, or resumes an interrupted batch.
An AI assistant must not use acknowledgement to bypass human review.

If a process crashed while holding the journal lock, close both AI clients and run:

```powershell
node .\src\cli.js --recover-lock
```

Recovery refuses to remove a lock whose recorded process is still alive. It only
removes the abandoned lock; interrupted operation records still require review.
Preserve an unreadable journal for investigation. Do not delete it to retry edits.
Archive a full journal only after reviewing all operations and stopping clients;
retired request IDs must never be reused.

## Troubleshooting

| Symptom | Check/action |
| --- | --- |
| `connection_failed` / offline | Start LRBridge; check the API port and `LRBRIDGE_URL`. Port 17892 is the web UI, not the direct API. |
| `heartbeat_stale` | Lightroom or its matching plug-in is offline/stalled; wait for current feedback. A running Electron app alone is insufficient. |
| `not_in_develop` / `no_photo` | Select the intended photo and open Develop, then read fresh context. |
| `context_changed` / `stale_feedback` | Photo, module, server or revision changed. No old baseline is rebased automatically. Check operation status before any deliberate new action. |
| `slider_unavailable` | The SDK cannot currently read that control. Inspect the photo/profile/process/HDR capability; no default or simulated capability is substituted. |
| `unsupported_safe_set` | RC1 guarded absolute Set supports only Contrast/Clarity/Vibrance. The requested absolute operation was not sent. |
| `feedback_timeout` / `api_rejected` while reading | SDK snapshot expired, was invalidated, or did not complete. Missing values stay unknown. |
| `uncertain` / `review_required` | Use operation lookup and the human-review procedure above; never generate another request ID as a retry. |
| `writer_busy` | Another writer is active, or a crashed process left a lock. Use the documented recovery procedure only after closing clients. |
| Client cannot launch | Verify the absolute `node.exe` and `src/cli.js` paths. Run `--check` in PowerShell. |
| Running without arguments appears idle | Normal: stdio waits for an MCP client. Start through Codex/Claude Code; do not type arbitrary text into its protocol stream. |

Optional environment settings (milliseconds): `LRBRIDGE_MCP_HTTP_TIMEOUT_MS`
(default 3000, 250–10000), `LRBRIDGE_MCP_READ_TIMEOUT_MS` (8000, 1000–20000),
`LRBRIDGE_MCP_OPERATION_TIMEOUT_MS` (70000, 1000–120000). A shorter client deadline
does not shorten or cancel an already-admitted LRBridge command. No retries are
added when a timeout is increased.

## Development, tests and reproducible packaging

From `mcp/`:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
# Actual RC1 HTTP/queue integration with SDK doubles also needs root dependencies:
npm.cmd --prefix .. ci --ignore-scripts
npm.cmd run test:bridge
# Existing isolated suites; never run tests/http-smoke.js against a real catalog:
npm.cmd --prefix .. run test:guarded-set
npm.cmd --prefix .. run test:release
npm.cmd --prefix .. run test:release -- --browser
npm.cmd run pack:local
```

The new suites use ephemeral loopback servers and isolated temporary journals.
Protocol tests use the official MCP SDK client plus legacy stdio initialization
for 2024-11-05, 2025-03-26 and 2025-11-25. Actual RC1 route tests use a mock SDK
worker, not Lightroom. Existing Lua regressions exercise production Lua against
SDK doubles. See [verification and manual acceptance](TESTING.md).

`pack:local` produces `dist/lrbridge-mcp-0.1.0.tgz` and a SHA-256 sidecar. It uses
an explicit source allowlist, includes dependency notices via normal npm packages,
and converts the locked dependency graph to `npm-shrinkwrap.json` in staging
because npm excludes `package-lock.json` from tarballs. `SOURCE_MANIFEST.json`
records per-file hashes, source commit, dirty status and Node version. No install
scripts or publication run. Same source, Node and npm versions produce the same
archive bytes; build release candidates from a clean reviewed commit. The package
is marked `private` to prevent accidental npm publication.

For a future approved archive, Windows can extract it with built-in `tar`:

```powershell
New-Item -ItemType Directory D:\Tools\LRBridge-MCP
tar -xf .\lrbridge-mcp-0.1.0.tgz -C D:\Tools\LRBridge-MCP
Set-Location D:\Tools\LRBridge-MCP\package
npm.cmd ci --omit=dev --ignore-scripts
node .\src\cli.js --check
```

Use that extracted `src\cli.js` path in the client configuration. Node and npm
dependencies are not bundled into the archive; `npm ci` needs registry access.
Parent-repository protocol documents/tests remain available through GitHub.
Publishing a GitHub or npm release is a separate owner-approved action.

This adapter follows LRBridge's ISC licensing. Existing project notices are
preserved; dependencies retain their own licenses. Official SDK documentation:
[TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/),
[stdio transport](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio).
