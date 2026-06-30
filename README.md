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
- develop.set
- develop.get
- HTTP API
- command queue
- repeated command coalescing
- configurable polling interval
- Companion Generic HTTP support
- two-way value readback for selected Develop settings

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

### Adjust slider

```text
GET /adjust?slider=Exposure&amount=1
GET /adjust?slider=Exposure&amount=-1
```

### Set slider

```text
GET /set?slider=Exposure&value=0
```

### Request current slider value

```text
GET /get?slider=Exposure
GET /last-result
```

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
/set?slider=Exposure&value=0
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

## Test tools

```powershell
node tests/send.js Exposure 1
node tests/set.js Exposure 0
node tests/get.js Exposure
node tests/burst.js Exposure 1 10
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
- Only selected Develop controls are mapped.
- No packaged .exe yet.