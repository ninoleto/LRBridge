# LRBridge

LRBridge is a local bridge for controlling Adobe Lightroom Classic from external control surfaces and automation tools.

It is designed for:

- Lightroom Classic users who want physical or browser-based controls.
- Bitfocus Companion users who want Lightroom slider/action control.
- Stream Deck and Loupedeck users who want HTTP-based Lightroom control.
- Developers and AI coding agents that need a clear project map before making forks, patches, or Companion modules.

LRBridge is focused on reliable Lightroom slider/action control through a local HTTP bridge. The Web Controller now supports polling-based feedback for visible sliders. Feedback is useful, but it is not true native realtime readback.

Search keywords: Adobe Lightroom Classic controller, Lightroom HTTP API, Lightroom bridge, Bitfocus Companion Lightroom control, Generic HTTP Requests, Stream Deck Lightroom control, Loupedeck Lightroom knobs, photo editing control surface, Lightroom slider control, Lightroom automation, Electron, Node.js, Lua Lightroom plugin.

---

## Quick links

- Web Controller: http://127.0.0.1:17892/
- Human help page: http://127.0.0.1:17892/help
- Bitfocus Companion HTTP Builder: http://127.0.0.1:17892/bitfocus-companion-cheatsheet
- LRBridge API: http://127.0.0.1:17891/
- Raw API help: http://127.0.0.1:17891/help

---

## What LRBridge is good for

LRBridge lets Lightroom Classic users control Develop sliders and actions from the Web Controller, Bitfocus Companion, Stream Deck HTTP/request plugins, PowerShell, curl, scripts, and other HTTP-capable tools.

Original use case:

```text
Loupedeck device -> Bitfocus Companion -> LRBridge app -> LRBridge Lightroom plugin -> Lightroom Classic
```

LRBridge was originally built so Loupedeck Live hardware could be used with Lightroom Classic through Bitfocus Companion, without depending on the official Loupedeck/Logitech software for slider control.

It is also useful when you want a tablet, touchscreen monitor, old phone, browser shortcut, Stream Deck HTTP setup, or automation script to send simple commands to Lightroom Classic.

The Web Controller includes polling-based feedback for visible sliders. This means it can show current Lightroom slider values, but small delays are normal.

---
## 1. Project summary

LRBridge connects external controllers to Adobe Lightroom Classic.

Command path:

```text
Web Controller / HTTP client / Bitfocus Companion
        ↓
LRBridge app
        ↓
LRBridge local HTTP API
        ↓
Command queue
        ↓
LRBridge Lightroom plugin polling
        ↓
Lightroom SDK / LrDevelopController
        ↓
Lightroom Classic Develop UI
```

Web Controller feedback path:

```text
Web Controller asks for visible slider values
        ↓
LRBridge feedback queue
        ↓
LRBridge Lightroom plugin feedback polling
        ↓
Lightroom SDK / LrDevelopController.getValue()
        ↓
LRBridge feedback state
        ↓
Web Controller value display
```

Feedback is polling-based. It is designed to be useful and lightweight, not perfect realtime feedback.

---

## 2. Current status

Stable enough for normal use:

- LRBridge Electron app.
- Local HTTP API.
- Web Controller.
- Lightroom Classic plugin polling.
- Slider adjustments.
- Slider reset for an individual slider.
- Lightroom Develop actions.
- Command queue.
- Repeated slider adjustment coalescing.
- Configurable polling interval.
- Smoke test.
- Human Web Controller Help page.
- Companion Generic HTTP support.
- Polling-based Web Controller feedback for visible sliders.
- Auto White Balance cooldown in the Web Controller after Temperature/Tint changes.

Advanced or use with care:

- /reset-group and /reset-all for normal UI use. They exist as advanced HTTP endpoints, but can overload Lightroom if abused.
- `/get`
- `/set`
- `/last-result`
- WebSocket command input

Companion integration:

- Generic HTTP Requests works now.
- Native LRBridge Companion module is available as a separate project:
  `https://github.com/ninoleto/companion-module-ninoleto-lrbridge`
- The native module may not be included in official Companion builds yet.

Important design decision:

```text
LRBridge v0.x stays HTTP-first and Lightroom-plugin controlled.
Do not build normal workflows on /get, /set, or /last-result.
```

---

## 3. Repository structure

```text
LRBridge/
  app/
    controller.html          Web Controller UI
    controller-help.html     Human help page for Web Controller
    index.html               Electron app window
    main.js                  Electron main process and Web Controller proxy server
    preload.js               Electron preload bridge
    renderer.js              Electron renderer logic
    tray.png                 Tray/app icon

  config/
    settings.txt             Polling interval configuration
    sliders.json             Slider metadata registry

  lightroom/
    LRBridge.lrplugin/
      AutoStartPolling.lua   Silent polling startup
      FeedbackPolling.lua     Side-channel feedback polling
      Commands.lua           Executes parsed commands
      Driver.lua             Lightroom SDK control layer
      Info.lua               Lightroom plugin manifest
      Parser.lua             Minimal JSON command parser
      PluginInit.lua         Plugin initialization
      Query.lua              Slider feedback/readback helpers
      Settings.lua           Reads config/settings.txt
      StartPolling.lua       Manual polling command
      Test.lua               Plugin test command

  server/
    commands.js              Command validation, queue, results
    lightroomWake.js         Windows Lightroom wake helper
    sliders.js               Slider registry helper

  tests/
    http-smoke.js            Main HTTP API smoke test

  bridge.js                  Core LRBridge HTTP/WebSocket server
  package.json               Node/Electron scripts and dependencies
  start-bridge.bat           Windows helper script
  README.md                  This file
```

---

## 4. Requirements

Required:

- Windows PC.
- Adobe Lightroom Classic.
- Node.js.
- npm.
- Lightroom Classic plugin support.

Optional:

- Bitfocus Companion.
- Browser or tablet/phone for Web Controller.
- Git for development.

Known development environment:

```text
Windows 11
Node.js
Electron
Lightroom Classic
Local ports 17890, 17891, 17892
```

---

## 5. Ports

LRBridge uses three local ports:

```text
17891  LRBridge HTTP API
17890  LRBridge WebSocket command input, experimental
17892  Web Controller browser UI
```

Default URLs:

```text
LRBridge API:
http://127.0.0.1:17891/

Web Controller:
http://127.0.0.1:17892/

WebSocket:
ws://127.0.0.1:17890/
```

On a LAN, the Web Controller may also be available from another device at:

```text
http://YOUR_PC_LAN_IP:17892/
```

Example:

```text
http://192.168.1.11:17892/
```

---

## 6. Install and run

Install dependencies:

```powershell
cd D:\Projects\LRBridge
npm install
```

Start the full LRBridge Electron app:

```powershell
npm start
```

Start only the backend server:

```powershell
npm run server
```

Run the smoke test while the backend server or app is already running:

```powershell
npm test
```

Expected result:

```text
Smoke test passed.
```

Important:

```text
npm start opens the Electron app.
npm run server starts bridge.js only.
```

---

## 7. Lightroom Classic plugin setup

In Lightroom Classic:

```text
File → Plug-in Manager
```

Add this plugin folder:

```text
D:\Projects\LRBridge\lightroom\LRBridge.lrplugin
```

Then start polling:

```text
Library → Plug-in Extras → Start LRBridge Polling
```

If polling is already running, Lightroom should show:

```text
Polling is already running.
```

Polling interval is stored in:

```text
config/settings.txt
```

Example:

```text
poll_interval_ms=100
```

The Electron app can edit this value. Lightroom reloads the polling setting automatically.

---

## 8. Web Controller

Open the Web Controller:

```text
http://127.0.0.1:17892/
```

The Web Controller provides:

- grouped Lightroom sliders
- `-5`
- `-1`
- `Reset`
- `+1`
- `+5`
- drag strips
- Lightroom action buttons
- crop/healing/red-eye/masking tool tabs
- human help page

The Help button opens:

```text
http://127.0.0.1:17892/help
```

Raw API help is still available through:

```text
http://127.0.0.1:17892/api/help
```

and directly from the LRBridge API:

```text
http://127.0.0.1:17891/help
```

### Web Controller feedback note

The Web Controller can show Lightroom slider feedback values below supported sliders.

Feedback behavior:

```text
The browser asks for values only for sliders currently visible on screen.
Lightroom reads those values through the LRBridge Lightroom plugin.
LRBridge sends changed values back to the browser.
```

This keeps feedback lighter than reading every known slider all the time.

Important:

```text
Feedback is polling-based.
It is not true native realtime feedback.
Small delays are normal, especially while moving sliders quickly.
```

---

## 9. Auto White Balance cooldown

Lightroom Classic can ignore `setAutoWhiteBalance()` for a short time after Temperature or Tint changes.

Practical Web Controller fix:

```text
If the user changes Temperature or Tint, the Auto White Balance Set button is disabled for about 2.2 seconds.
```

During cooldown the button text changes to:

```text
Wait 2s
Wait 1s
Set
```

This avoids sending Auto White Balance while Lightroom is still internally tracking Temperature/Tint changes.

This is a Web Controller usability workaround, not a backend API change.

---

## 10. HTTP API

The LRBridge API runs on:

```text
http://127.0.0.1:17891/
```

All current stable commands are HTTP GET requests.

This is intentional for easy testing, browser use, curl use, Companion Generic HTTP, and future Companion plugin development.

---

## 11. API: help

```text
GET /help
```

Example:

```text
http://127.0.0.1:17891/help
```

Returns current endpoint information and usage notes.

---

## 12. API: status

```text
GET /status
```

Example:

```text
http://127.0.0.1:17891/status
```

Returns queue status, result status, and supported sliders.

---

## 13. API: sliders

```text
GET /sliders
```

Example:

```text
http://127.0.0.1:17891/sliders
```

Returns slider metadata from:

```text
config/sliders.json
```

AI agents should inspect this endpoint or `config/sliders.json` before adding UI controls or Companion actions.

---

## 14. API: groups

```text
GET /groups
```

Example:

```text
http://127.0.0.1:17891/groups
```

Returns available slider groups.

---

## 15. API: adjust slider

```text
GET /adjust?slider=Exposure&amount=1
GET /adjust?slider=Exposure&amount=-1
```

Example:

```text
http://127.0.0.1:17891/adjust?slider=Exposure&amount=1
```

`amount` means number of Lightroom increment/decrement steps.

It is not always equal to exact slider UI points.

Typical behavior:

```text
Exposure amount=1    roughly 0.1 Exposure
Contrast amount=1    usually 5 points
Highlights amount=1  usually 5 points
Shadows amount=1     usually 5 points
Whites amount=1      usually 5 points
Blacks amount=1      usually 5 points
```

Avoid very large amount values unless intentional.

---

## 16. API: reset slider

```text
GET /reset?slider=Exposure
```

Example:

```text
http://127.0.0.1:17891/reset?slider=Exposure
```

This uses Lightroom's single-slider reset behavior through `LrDevelopController.resetToDefault()`.

Prefer `/reset` over `/set` for returning sliders to default.

---

## 17. API: reset group

```text
GET /reset-group?group=Basic
```

Example:

```text
http://127.0.0.1:17891/reset-group?group=Basic
```

Queues reset commands for every slider in that group.

---

## 18. API: reset all

```text
GET /reset-all
```

Example:

```text
http://127.0.0.1:17891/reset-all
```

Queues reset commands for all mapped sliders.

Use carefully.

---

## 19. API: action

```text
GET /action?action=setAutoTone
GET /action?action=setAutoWhiteBalance
GET /action?action=selectCropTool
GET /action?action=resetCrop
```

Example:

```text
http://127.0.0.1:17891/action?action=setAutoTone
```

Known actions are validated in:

```text
server/commands.js
```

Executed by:

```text
lightroom/LRBridge.lrplugin/Driver.lua
```

---

## 20. Experimental API: get

```text
GET /get?slider=Exposure
GET /last-result
```

Important:

```text
/get is experimental.
/last-result is a single temporary result slot.
/last-result clears after read.
Do not build Companion feedback or Web Controller feedback on this.
```

The Web Controller uses dedicated feedback endpoints instead of `/get` and `/last-result`.

Dedicated feedback endpoints used by LRBridge:

```text
GET /feedback/request?slider=Exposure
GET /feedback/request-many?sliders=Exposure,Contrast
GET /feedback/request-all
GET /feedback/next
GET /feedback/result?id=...&slider=...&value=...
GET /feedback/value?slider=Exposure
GET /feedback/all
```

These endpoints are for LRBridge feedback polling and may change while the feedback system is still being refined.

---

## 21. Experimental API: set

```text
GET /set?slider=Exposure&value=1&experimental=1
```

Important:

```text
/set is experimental and unreliable in Lightroom Classic.
Use /adjust or /reset for normal control.
```

Without this flag, LRBridge rejects `/set`:

```text
experimental=1
```

---

## 22. Supported controls

The current source of truth for supported sliders is:

```text
config/sliders.json
```

Do not hardcode a separate list in new integrations unless there is a good reason.

Current UI groups include:

```text
Basic
Color
Presence
Detail
Color Mixer / HSL
B&W Mixer
Effects
Calibration
Lens / Defringe
Transform
Tone Curve
```

Some Lightroom SDK mappings are known to be unreliable or unsolved.

Example:

```text
LensProfileChromaticAberrationScale
```

This unsupported control is intentionally not shown in the Web Controller.

---

## 23. Companion usage today

Bitfocus Companion can use LRBridge in two ways.

### Method 1: Companion Generic HTTP Requests

Use:

```text
Generic HTTP Requests
```

Recommended Companion base URL:

```text
http://127.0.0.1:17891
```

For another machine on the LAN:

```text
http://YOUR_LRBRIDGE_PC_IP:17891
```

Recommended Companion actions:

```text
/adjust?slider=Exposure&amount=1
/adjust?slider=Exposure&amount=-1
/reset?slider=Exposure
/action?action=setAutoTone
/action?action=setAutoWhiteBalance
```

For a full copy/paste list of Bitfocus Companion HTTP paths for every supported slider and action, see:

```text
docs/COMPANION_HTTP_CHEATSHEET.md
```

When the Web Controller server is running, it is also available in the browser:

```text
http://127.0.0.1:17892/bitfocus-companion-cheatsheet
```

Regenerate it after slider/action changes with:

```bash
npm run generate:cheatsheet
```

### Method 2: Native LRBridge Companion module

Native Companion module repo:

```text
https://github.com/ninoleto/companion-module-ninoleto-lrbridge
```

Use this path for a cleaner Companion setup with LRBridge sliders and actions available from Companion dropdown menus.

If the module is not available in the official Companion build yet, use the GitHub repo for the current development version and setup instructions.

---

## 24. Native Companion module architecture

The native Bitfocus Companion module should not contain Lightroom logic.

Correct architecture:

```text
Companion module
        ↓
HTTP requests
        ↓
LRBridge app
        ↓
LRBridge Lightroom plugin
        ↓
Lightroom Classic SDK
```

The Companion module should:

- configure LRBridge host/IP
- configure LRBridge port
- expose slider adjustment actions
- expose slider reset actions
- expose Lightroom action commands
- optionally load slider metadata from `/sliders`
- optionally load groups from `/groups`
- use LRBridge feedback endpoints if value feedback is added to the Companion module later

The Companion module should not:

- talk directly to Lightroom
- duplicate Lightroom SDK logic
- assume `/get` is reliable
- depend on `/last-result`
- include generic keyboard shortcut sending

Current module repo:

```text
https://github.com/ninoleto/companion-module-ninoleto-lrbridge
```

---

## 25. Development workflow for humans

Create a branch:

```powershell
git switch main
git pull
git switch -c my-change-name
```

Make changes.

Run smoke test with LRBridge running:

```powershell
npm test
```

Commit:

```powershell
git status --short
git add .
git commit -m "Describe change"
```

Merge:

```powershell
git switch main
git merge my-change-name
git push origin main
```

Tag important checkpoints:

```powershell
git tag v0.x.x-short-name
git push origin v0.x.x-short-name
```

---

## 26. Development workflow for AI agents

AI agents should follow this process.

### Step 1: inspect project state

```powershell
git status --short
git branch --show-current
git log --oneline -5
```

### Step 2: inspect relevant files

Common files:

```text
bridge.js
server/commands.js
server/sliders.js
config/sliders.json
app/controller.html
app/main.js
lightroom/LRBridge.lrplugin/Driver.lua
lightroom/LRBridge.lrplugin/Commands.lua
lightroom/LRBridge.lrplugin/Parser.lua
lightroom/LRBridge.lrplugin/Query.lua
```

### Step 3: avoid unsafe assumptions

Do not assume:

- `/get` is reliable.
- `/set` is reliable.
- controller feedback is instant or event-based. It is polling-based.
- WebSocket is preferred over HTTP.
- Lightroom SDK calls always behave immediately.
- every item in `Driver.lua` should automatically appear in the Web Controller.

### Step 4: prefer small branches

Use one branch per logical change.

Examples:

```text
web-controller-layout-fix
readme-human-ai
package-portable-windows
companion-plugin-initial-http
feedback-state-api
```

### Step 5: test

At minimum:

```powershell
npm test
```

For UI changes:

```powershell
npm start
```

Then manually test:

```text
Web Controller
Lightroom command execution
Help page
affected slider/action
```

### Step 6: commit clearly

Good commit messages:

```text
Add Auto White Balance cooldown after WB slider changes
Polish web controller help and remove unsupported lens control
Fix web controller startup and UI status handling
```

Bad commit messages:

```text
fix
update
stuff
final
```

---

## 27. Coding rules for AI agents

Follow these rules unless explicitly told otherwise:

1. Preserve the working command path.
2. Do not rewrite large files unnecessarily.
3. Do not remove existing slider mappings without checking usage.
4. Do not add feedback based on `/last-result`.
5. Do not make `/set` a normal production feature yet.
6. Keep Web Controller changes simple and browser-compatible.
7. Keep Lightroom Lua code conservative.
8. Prefer HTTP for Companion integration first.
9. Document any known Lightroom SDK workaround.
10. Always keep Git clean before and after a change.

---

## 28. Testing

Start app:

```powershell
npm start
```

Start server only:

```powershell
npm run server
```

Run smoke test:

```powershell
npm test
```

Manual API tests:

```powershell
curl.exe "http://127.0.0.1:17891/help"
curl.exe "http://127.0.0.1:17891/status"
curl.exe "http://127.0.0.1:17891/sliders"
curl.exe "http://127.0.0.1:17891/groups"
curl.exe "http://127.0.0.1:17891/adjust?slider=Exposure&amount=1"
curl.exe "http://127.0.0.1:17891/reset?slider=Exposure"
curl.exe "http://127.0.0.1:17891/reset-group?group=Basic"
curl.exe "http://127.0.0.1:17891/reset-all"
```

Expected smoke test ending:

```text
Smoke test passed.
```

---

## 29. Troubleshooting

### App does not open

Use:

```powershell
npm start
```

If only the backend is needed:

```powershell
npm run server
```

If Electron or Node is stuck:

```powershell
taskkill /IM electron.exe /F
taskkill /IM node.exe /F
npm start
```

### Smoke test fails with ECONNREFUSED

The LRBridge HTTP API is not running.

Start the app or server first:

```powershell
npm start
```

or:

```powershell
npm run server
```

Then rerun:

```powershell
npm test
```

### Web Controller does not open

Open manually:

```text
http://127.0.0.1:17892/
```

### Commands queue but Lightroom does not move

Check:

- Lightroom Classic is running.
- A photo is selected.
- The LRBridge Lightroom plugin is installed.
- Polling has started from Plug-in Extras.
- The LRBridge app is running.

### Auto White Balance sometimes does nothing

Lightroom can ignore Auto White Balance shortly after Temperature/Tint changes.

The Web Controller has a cooldown workaround.

After changing Temperature or Tint, wait until the button changes back to:

```text
Set
```

Then press Auto White Balance.

### `/set` does not work reliably

Expected.

Use:

```text
/adjust
/reset
```

not `/set`.

### Feedback does not work

Check these first:

```text
1. LRBridge app is running.
2. Lightroom Classic is running.
3. LRBridge Lightroom plugin polling is running.
4. FeedbackPolling.lua is included in the plugin.
5. The Web Controller page was refreshed after starting LRBridge.
```

Feedback is polling-based, so a small delay is normal.

Do not use `/get` or `/last-result` as the source of truth for Web Controller or Companion feedback.


---

## 30. Packaging plan

Preferred first release format:

```text
Portable Windows ZIP
```

Reason:

- no installer required
- no admin rights
- easier testing
- config can stay close to app
- easier to share with Lightroom/Companion users
- simpler rollback

Possible future formats:

```text
LRBridge-portable-v1.0.0.zip
LRBridge-installer-v1.0.0.exe
```

Portable target layout:

```text
LRBridge/
  LRBridge.exe
  config/
    settings.txt
    sliders.json
  lightroom/
    LRBridge.lrplugin/
  app/
  docs/
```

---

## 31. Version checkpoints

Useful known tags:

```text
v0.4.31-auto-wb-cooldown
```

Add future checkpoint tags after stable milestones.

Suggested next milestones:

```text
v0.4.32-readme-human-ai
v0.5.0-portable-package
v0.6.0-companion-plugin-initial-http
v0.7.0-state-api-feedback
```

---

## 32. Known limitations

- Lightroom plugin polling must be running.
- Web Controller feedback is polling-based, not true realtime.
- Native Companion module lives in a separate GitHub repo and may not be included in official Companion builds yet.
- `/get` is experimental.
- `/set` is experimental.
- Lightroom SDK calls can have timing quirks.
- Some Lightroom controls are not mapped.
- Some mapped Lightroom controls may be SDK-version dependent.
- No packaged release yet.
- Windows is the primary target.

---

## 33. Safe design principles

LRBridge should remain:

```text
small
local
transparent
HTTP-first
Lightroom-controlled
Companion-friendly
easy to debug
easy to fork
```

The core should not become a heavy Lightroom replacement UI.

The goal is a reliable bridge:

```text
external controller → Lightroom Classic
```

not a full duplicate of Lightroom's Develop panel.
