# LRBridge

LRBridge is an experimental bridge for controlling Adobe Lightroom Classic from Bitfocus Companion or other external tools.

Current architecture:

```text
Companion / HTTP client
        ↓
LRBridge Node.js server
        ↓
Lightroom Classic plugin polling
        ↓
Lightroom SDK / LrDevelopController
```

## Current status

Reliable enough for use:

- develop.adjust
- develop.reset
- HTTP API
- command queue
- repeated command coalescing
- configurable polling interval
- duplicate polling protection
- Companion Generic HTTP support
- slider metadata registry
- reset individual sliders
- reset slider groups
- reset all mapped sliders
- HTTP smoke test
- Windows start script
- npm start/smoke scripts
- help endpoint

Experimental / not trusted yet:

- develop.get
- develop.set
- two-way feedback/readback

Important decision:

```text
LRBridge currently uses Lightroom as the visible source of truth.
The controller moves sliders, and the user sees the real value directly in Lightroom.
Controller-side feedback is not used for now.
```

## Requirements

- Windows PC running Lightroom Classic
- Node.js
- Lightroom Classic plugin support
- Bitfocus Companion optional, currently tested from Companion running on another machine

## Start LRBridge

From the project folder:

```powershell
npm start
```

Alternative direct command:

```powershell
node bridge.js
```

Windows batch file:

```powershell
.\start-bridge.bat
```

Default ports:

```text
HTTP: 17891
WebSocket: 17890
```

## Smoke test

With LRBridge running:

```powershell
npm run smoke
```

Expected ending:

```text
Smoke test passed.
```

## Lightroom setup

Load the plugin folder in Lightroom Classic:

```text
D:\Projects\LRBridge\lightroom\LRBridge.lrplugin
```

Then start polling manually:

```text
Library → Plug-in Extras → Start LRBridge Polling
```

If polling is already running, Lightroom should show:

```text
Polling is already running.
```

Polling interval is configured in:

```text
config/settings.txt
```

Example:

```text
poll_interval_ms=50
```

## HTTP API

### Help

```text
GET /help
```

Example:

```text
http://127.0.0.1:17891/help
```

This returns the current reliable endpoints, experimental endpoints, and basic usage notes.

### Status

```text
GET /status
```

Example:

```text
http://127.0.0.1:17891/status
```

### Supported sliders endpoint

```text
GET /sliders
```

Example:

```text
http://127.0.0.1:17891/sliders
```

This returns slider metadata from:

```text
config/sliders.json
```

### Supported groups endpoint

```text
GET /groups
```

Example:

```text
http://127.0.0.1:17891/groups
```

Current groups:

```text
Basic
Color
Presence
Detail
```

### Adjust slider

```text
GET /adjust?slider=Exposure&amount=1
GET /adjust?slider=Exposure&amount=-1
```

Important:

```text
amount = number of Lightroom increment steps
```

It does not always mean exact slider points.

Known behavior:

```text
Exposure amount=1 ≈ 0.1 Exposure
Contrast amount=1 ≈ 5 points
Highlights amount=1 ≈ 5 points
Shadows amount=1 ≈ 5 points
Whites amount=1 ≈ 5 points
Blacks amount=1 ≈ 5 points
```

For Exposure:

```text
/adjust?slider=Exposure&amount=10
```

means roughly +1.0 Exposure.

Avoid large values unless you want big jumps.

### Reset slider

```text
GET /reset?slider=Exposure
```

This uses Lightroom's single-slider reset command and is preferred over `/set` for returning a slider to default.

### Reset slider group

```text
GET /reset-group?group=Basic
GET /reset-group?group=Color
GET /reset-group?group=Presence
GET /reset-group?group=Detail
```

This queues reset commands for every slider in the selected group.

### Reset all mapped sliders

```text
GET /reset-all
```

This queues reset commands for all supported sliders:

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

### Experimental get slider

```text
GET /get?slider=Exposure
GET /last-result
```

Important:

```text
/get is currently experimental and not reliable enough for controller feedback.
Do not depend on /get for Companion feedback.
Use Lightroom's visible sliders as the source of truth.
```

### Experimental set slider

```text
GET /set?slider=Exposure&value=1&experimental=1
```

Important:

```text
/set is currently experimental and unreliable in Lightroom.
Use /adjust or /reset for normal control.
```

Without `experimental=1`, LRBridge rejects `/set`.

## Companion setup

Use the Companion Generic HTTP Requests module.

If LRBridge runs on ANTEC:

```text
Base URL:
http://192.168.1.11:17891
```

Recommended actions:

```text
/adjust?slider=Exposure&amount=1
/adjust?slider=Exposure&amount=-1
/reset?slider=Exposure
/reset-group?group=Basic
/reset-all
```

Avoid using these in Companion for now:

```text
/get
/set
```

## Supported sliders

Currently known:

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

## Lightroom slider locations

### Basic panel

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
```

### Detail panel

```text
Sharpness   → Detail → Sharpening → Amount
LuminanceNR → Detail → Noise Reduction → Luminance
ColorNR     → Detail → Noise Reduction → Color
```

LRBridge reveals the relevant Lightroom panel before moving or resetting a mapped slider.

## Test tools

Recommended visual movement tests:

```powershell
node tests/send.js Exposure 1
node tests/burst.js Exposure 1 10
curl.exe "http://localhost:17891/reset?slider=Exposure"
```

Manual HTTP tests:

```powershell
curl.exe "http://localhost:17891/help"
curl.exe "http://localhost:17891/status"
curl.exe "http://localhost:17891/sliders"
curl.exe "http://localhost:17891/groups"
curl.exe "http://localhost:17891/adjust?slider=Exposure&amount=1"
curl.exe "http://localhost:17891/reset?slider=Exposure"
curl.exe "http://localhost:17891/reset-group?group=Basic"
curl.exe "http://localhost:17891/reset-all"
```

Smoke test:

```powershell
npm run smoke
```

Experimental tests only:

```powershell
node tests/get.js Exposure
curl.exe "http://localhost:17891/set?slider=Exposure&value=1&experimental=1"
```

## Development workflow

After a working change:

```powershell
git add .
git commit -m "Short description"
git push
```

## Current limitations

- Lightroom polling must be started manually.
- Native Companion module does not exist yet.
- HTTP Generic Requests are used for now.
- `/get` is experimental and should not be used for controller feedback.
- `/set` is experimental and should not be used for normal control.
- Only selected Develop controls are mapped.
- No packaged .exe yet.