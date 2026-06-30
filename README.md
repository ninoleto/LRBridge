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

Working:

- develop.adjust
- develop.reset
- develop.get
- HTTP API
- command queue
- repeated command coalescing
- configurable polling interval
- Companion Generic HTTP support
- two-way value readback for selected Develop settings
- slider metadata registry

Experimental / not trusted yet:

- develop.set

## Requirements

- Windows PC running Lightroom Classic
- Node.js
- Lightroom Classic plugin support
- Bitfocus Companion optional, currently tested from Companion running on another machine

## Start LRBridge

From the project folder:

```powershell
node bridge.js
```

Default ports:

```text
HTTP: 17891
WebSocket: 17890
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

Polling interval is configured in:

```text
config/settings.txt
```

Example:

```text
poll_interval_ms=50
```

## HTTP API

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

### Adjust slider

```text
GET /adjust?slider=Exposure&amount=1
GET /adjust?slider=Exposure&amount=-1
```

For Exposure, Lightroom moves in 0.1 steps, so:

```text
/adjust?slider=Exposure&amount=10
```

means roughly +1.0 Exposure.

Most other sliders move in 1-point steps.

### Reset slider

```text
GET /reset?slider=Exposure
```

This uses Lightroom's single-slider reset command and is preferred over `/set` for returning a slider to default.

### Request current slider value

```text
GET /get?slider=Exposure
GET /last-result
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

Example actions:

```text
/adjust?slider=Exposure&amount=1
/adjust?slider=Exposure&amount=-1
/reset?slider=Exposure
```

Avoid using `/set` in Companion for now.

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

## Test tools

```powershell
node tests/send.js Exposure 1
node tests/get.js Exposure
node tests/burst.js Exposure 1 10
```

Manual HTTP tests:

```powershell
curl.exe "http://localhost:17891/status"
curl.exe "http://localhost:17891/sliders"
curl.exe "http://localhost:17891/adjust?slider=Exposure&amount=1"
curl.exe "http://localhost:17891/reset?slider=Exposure"
curl.exe "http://localhost:17891/set?slider=Exposure&value=1"
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
- `/set` is experimental and should not be used for normal control.
- Only selected Develop controls are mapped.
- No packaged .exe yet.