# Changelog

## Unreleased

### Added

- Added a global `LRBridge Help` Plug-in Extras menu contribution to support module-independent Lightroom plug-in initialization.
- Added SDK-native commands for current-selection navigation, flags, ratings, rating adjustment, color-label setting, and color-label toggling through the existing HTTP and WebSocket command paths.
- Added an isolated Lightroom `LrSelection` dispatcher with source-level mapping and polling-resilience coverage.
- Added SDK-native `selection.operation`, `application.module`, `application.view`, `application.action`, and `application.secondary_view` commands through the existing HTTP and WebSocket paths.
- Added an isolated `LrApplicationView` dispatcher for module, primary-view, application-action, and secondary-view control.

### Changed

- Startup now waits for the first valid Lightroom context heartbeat and admits exactly one SDK-native `application.module / library` command per bridge lifecycle. The previous Windows focus, PID-watcher, and keyboard-shortcut mechanism was removed.
- The deprecated `/wake-lightroom` compatibility endpoint now queues the same SDK-native Library command without activating Lightroom or simulating keyboard input. New integrations should use `/command?command=application.module&module=library`.
- Queue diagnostics now count all seven selection command families as ordinary commands without exposing their payload values.
- The generic `/command` route now copies `action` correctly and normalizes HTTP rating query values before shared validation.
- The generic `/command` route now accepts `operation`, `module`, and `view`; strict shared allowlists reject missing, repeated, incorrectly cased, non-string, and unknown values.
- Queue diagnostics count the five new command families as ordinary FIFO commands. They do not consume the protected reserve because they are reversible UI/selection controls rather than reset/recovery operations.

### Documentation

- Documented selection schemas, allowed values, queued-versus-executed semantics, current-selection scope, Lightroom Classic first/last compatibility, Color Label Set metadata behavior, and the absence of keyboard or AutoHotkey automation.
- Documented the new application-control schemas, allowed values, SDK-only behavior, and module-switching semantics. v0.6.0 remains unreleased.

## v0.5.2

Stability and hardening checkpoint for the existing LRBridge feature set. This is a maintenance release, not a feature release.

### Changed

- Prematurely closed LRBridge upstream responses now terminate Web Controller proxy requests cleanly instead of leaving them pending.
- Malformed Web Controller request targets now receive a controlled client error instead of causing an unhandled request-handler rejection.
- Lightroom adjustment amounts are now limited to safe integer step counts, preventing fractional or out-of-range values from being interpreted differently by the app and Lightroom plug-in.
- Lightroom command polling now isolates command execution failures so one failing SDK operation cannot permanently stop subsequent command processing.
- WebSocket command payloads are now limited to 64 KiB to reduce resource abuse. Normal LRBridge and Companion commands are unaffected.
- The Bridge HTTP API now uses explicit conservative request, header, keep-alive, and header-count limits to reduce slow-client resource use. This does not add authentication or rate limiting.
- The Web Controller now cancels abandoned API proxy requests and avoids writing responses after clients disconnect.
- The Web Controller HTTP server now uses explicit conservative request, header, keep-alive, and header-count limits to reduce slow-client resource use. This does not add authentication or rate limiting.
- Web Controller shutdown now closes idle connections and force-closes remaining HTTP connections after a short grace period, preventing stalled clients from delaying application exit.

### Documentation

- Clarified LRBridge network exposure, trusted-network use, Companion addressing, Windows Firewall scoping, Tailscale restrictions, and public-exposure warnings. No authentication or security feature was added.

## v0.2.0-autostart

Autostart Lightroom polling with UI wake.

Tagged version:

```text
v0.2.0-autostart
```

### Added

- Lightroom plug-in startup using `PluginInit.lua`
- Silent auto polling file:
  - `AutoStartPolling.lua`
- Windows Lightroom wake helper:
  - `server/lightroomWake.js`
- LRBridge Node startup watcher for Lightroom Classic
- Automatic Lightroom wake to Library when Lightroom starts
- Slider commands switch Lightroom back to Develop through the Lightroom driver
- No manual `Plug-in Extras → Start LRBridge Polling` needed in normal use

### Working startup flow

```text
Start LRBridge
        ↓
Start Lightroom Classic
        ↓
LRBridge detects Lightroom window
        ↓
LRBridge wakes Lightroom UI by switching to Library
        ↓
Lightroom plug-in autostarts polling
        ↓
First slider command switches to Develop and moves slider
```

### Important behavior

When Lightroom starts directly into Develop, LRBridge wakes it by switching to Library first.

This is intentional.

Without that UI wake, Lightroom may receive commands but not apply Develop slider changes live.

### Still kept as fallback

Manual menu item still exists:

```text
Library → Plug-in Extras → Start LRBridge Polling
```

This is only a fallback now.

Normal use should not require it.

## v0.1.1-help

Adds the help endpoint and smoke test coverage.

Tagged version:

```text
v0.1.1-help
```

### Added

- `/help` endpoint
- `/help` documentation in `README.md`
- `/help` documentation in `PROJECT_STATE.md`
- `/help` smoke test coverage

### Help endpoint

```text
GET /help
```

Example:

```text
http://127.0.0.1:17891/help
```

LAN example:

```text
http://192.168.1.11:17891/help
```

The endpoint returns:

- reliable endpoints
- experimental endpoints
- one-way control notes
- amount behavior reminder

## v0.1.0-one-way

Stable one-way Lightroom slider control.

Tagged version:

```text
v0.1.0-one-way
```

### Working

- Node.js HTTP bridge
- Lightroom Classic polling plugin
- Companion-friendly HTTP control
- `/status`
- `/sliders`
- `/groups`
- `/adjust`
- `/reset`
- `/reset-group`
- `/reset-all`
- command queue
- repeated adjust command coalescing
- configurable polling interval
- duplicate polling protection
- Lightroom panel reveal before slider movement
- Windows start script
- npm scripts:
  - `npm start`
  - `npm run smoke`
  - `npm test`

### Reliable use path

```text
Companion / HTTP client
        ↓
LRBridge
        ↓
Lightroom plugin polling
        ↓
LrDevelopController increment/reset
        ↓
Lightroom slider visibly moves
```

### Important decision

LRBridge is currently a one-way controller.

Use Lightroom itself as the visible source of truth.

Do not use controller feedback yet.

### Experimental / not trusted

- `/get`
- `/last-result`
- `/set`
- two-way feedback/readback
- absolute value setting

### Known amount behavior

```text
Exposure amount=1 ≈ 0.1 Exposure
Contrast amount=1 ≈ about 5 points
Highlights amount=1 ≈ about 5 points
Shadows amount=1 ≈ about 5 points
Whites amount=1 ≈ about 5 points
Blacks amount=1 ≈ about 5 points
```

### Current mapped sliders

```text
Exposure
Contrast
Highlights
Shadows
Whites
Blacks
Temperature
Tint
Texture
Clarity
Dehaze
Vibrance
Saturation
Sharpness
LuminanceNR
ColorNR
```

### Important mapping note

```text
LuminanceNR → LuminanceSmoothing
```

Do not change it back to:

```text
LuminanceNoiseReduction
```

### Smoke test

```powershell
npm test
```

Expected result:

```text
Smoke test passed.
```
