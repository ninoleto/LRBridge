# Changelog

## Unreleased

### Added

- Replaced the Web Controller's relative Develop button grids with 93 reusable metadata-driven absolute slider controls, synchronized numeric inputs, individual Reset buttons, and authoritative Lightroom feedback with an explicit unavailable state.
- Corrected generic slider initialization so every new feedback request ID receives a complete snapshot even when Lightroom values are unchanged. Active-photo changes now invalidate old values and distinguish Loading, explicit Unavailable, and feedback errors; runtime SDK ranges are returned with each available value.
- Improved generic slider editing with signed-decimal text fields, step-based `−`/`+` buttons, larger range thumbs, and a metadata-driven logarithmic Temperature visual scale while preserving actual Lightroom values and linear Tint behavior.
- Manual Lightroom Classic 15.3 verification confirmed authoritative generic-slider population after application restart and browser reload, correct Temperature and Tint behavior, signed numeric editing, and smooth debounced `−`/`+` changes with targeted single-slider confirmation and no unrelated repaint.
- Added the canonical absolute Set generator to the HTTP Builder. Slider ranges, steps, and precision come from the shared `config/sliders.json` registry.
- Added a dedicated Web Controller Crop tab containing Open Crop Tool, Reset Crop, Original Aspect, Camera Crop, six fixed aspect-ratio presets, and an LRBridge Custom Crop modal.
- Added fixed 16:10 crop support and a validated Custom Crop contract accepting exact integer Width and Height values from 1 to 10000.
- Added SDK-native Crop Angle controls using the documented `straightenAngle` parameter, authoritative Lightroom feedback, latest-state queue coalescing, and a straightening-only Reset Angle command. Controlled Web Controller verification passed for the range slider, numeric input, visible Lightroom behavior, feedback, and Reset Angle.
- Added a global `LRBridge Help` Plug-in Extras menu contribution to support module-independent Lightroom plug-in initialization.
- Added SDK-native commands for current-selection navigation, flags, ratings, rating adjustment, color-label setting, and color-label toggling through the existing HTTP and WebSocket command paths.
- Added an isolated Lightroom `LrSelection` dispatcher with source-level mapping and polling-resilience coverage.
- Added SDK-native `selection.operation`, `application.module`, `application.view`, `application.action`, and `application.secondary_view` commands through the existing HTTP and WebSocket paths.
- Added an isolated `LrApplicationView` dispatcher for module, primary-view, application-action, and secondary-view control.

### Changed

- Hardened `/set` and `/reset` validation and added latest-state queue coalescing per Develop slider. Relative `/adjust` ordering remains unchanged, and rapid Temperature/Tint interaction retains the existing Auto Tone / Auto White Balance cooldown.
- Fixed Lightroom polling parsing so string `value` and `scope` fields survive queue JSON transport for Photo Treatment and Show in Explorer.
- Expanded `photo.crop_aspect` with fixed `16x10` and `custom` mode. Custom ratios preserve validated `w` and `h` integers from 1 to 10000 and use Lightroom's documented SDK table form; the Web Controller modal is not Lightroom's native Enter Custom dialog. Camera Crop may match Original; Reset Crop remains separate.
- Controlled Lightroom Classic 15.3 testing confirmed Black & White, Color, and Show in Explorer with visible results, exact queue deltas, continued heartbeat, and no execution errors.
- Manual Web Controller verification confirmed Open Crop Tool and all seven crop-aspect modes. The 2:3 preset and Camera Crop may correctly match Original for compatible source-photo metadata; Reset Crop remains a separate complete-crop reset.
- Manual Web Controller verification also confirmed fixed 16:10 and Custom Crop. The exact `{ w = 16, h = 10 }` values survived the complete transport and SDK pipeline, and the LRBridge-owned Custom Crop modal worked as designed.
- Startup module switching was removed. Context heartbeats now report Lightroom state without enqueueing commands, and LRBridge preserves the current module until an explicit `application.module` request. The previous Windows focus/PID watcher, keyboard shortcut, and intermediate one-shot SDK startup switch are removed.
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
# Unreleased

- Added Phase 1 Color Grading metadata, native command transport, strict runtime-range validation, protected/coalescing queue behavior, request-scoped feedback, view selection, HTTP Builder support, and focused tests. Runtime status remains untested in Lightroom; graphical wheels are deferred to Phase 2.
