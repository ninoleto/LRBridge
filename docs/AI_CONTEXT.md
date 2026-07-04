
LRBridge AI Context

LRBridge is a local bridge for controlling Adobe Lightroom Classic from external tools.

One-sentence summary

LRBridge lets Adobe Lightroom Classic be controlled from a browser Web Controller, Bitfocus Companion, Stream Deck HTTP/request plugins, Loupedeck workflows, PowerShell, curl, scripts, and other HTTP-capable tools.

Main purpose

LRBridge provides reliable one-way Lightroom control.

It can:

move Develop sliders left or right
reset one slider
run supported Lightroom actions
expose simple local HTTP endpoints
provide a browser Web Controller
provide a Bitfocus Companion Generic HTTP command builder

Live feedback/readback from Lightroom is not implemented as stable functionality yet.

Important user-facing URLs
Web Controller: http://127.0.0.1:17892/
Human Help: http://127.0.0.1:17892/help
Bitfocus Companion HTTP Builder: http://127.0.0.1:17892/bitfocus-companion-cheatsheet
LRBridge API: http://127.0.0.1:17891/
Raw API Help: http://127.0.0.1:17891/help
Main architecture

Web Controller / HTTP Client / Bitfocus Companion Generic HTTP
to LRBridge Electron App
to LRBridge local HTTP API
to Command Queue
to Lightroom Classic Plugin Polling
to Lightroom SDK / LrDevelopController
to Lightroom Classic Develop UI

Key files
bridge.js: core HTTP/WebSocket server
app/main.js: Electron main process and Web Controller proxy server
app/controller.html: Web Controller UI
app/controller-help.html: human help page
app/companion-cheatsheet.html: readable Bitfocus Companion HTTP Builder
config/sliders.json: slider metadata registry
server/commands.js: command validation, queue, results
server/sliders.js: slider registry helper
lightroom/LRBridge.lrplugin/: Lightroom Classic plugin
tests/http-smoke.js: main API smoke test
docs/COMPANION_HTTP_CHEATSHEET.md: generated Companion HTTP reference
Safe normal commands
/adjust?slider=Exposure&amount=1
/adjust?slider=Exposure&amount=-1
/reset?slider=Exposure
/action?action=setAutoTone
Dangerous advanced commands

These endpoints exist, but they are not available in the Web Controller UI because they can send many commands to Lightroom quickly and may overload or crash Lightroom:

/reset-group?group=Basic
/reset-all

Use at your own risk.

Current limitations
LRBridge is focused on reliable one-way control.
Live Lightroom value feedback is not stable yet.
/get, /set, /last-result, and native Companion feedback/state should be treated as experimental unless updated later.
The native Bitfocus Companion plugin is planned, but the current practical workflow is Generic HTTP Requests.
Search keywords

Adobe Lightroom Classic controller, Lightroom Classic HTTP API, Lightroom bridge, Lightroom automation, Lightroom slider control, Bitfocus Companion Lightroom, Generic HTTP Requests, Stream Deck Lightroom control, Loupedeck Lightroom control, Lightroom knobs, photo editing control surface, Electron Lightroom app, Node.js Lightroom bridge, Lua Lightroom plugin.