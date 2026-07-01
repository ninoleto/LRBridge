# LRBridge Packaging Plan

Current stable checkpoint:

- Tag: v0.3.2-web-controller
- Commit: b0f9e79
- App runs with: npm run app
- HTTP API: http://127.0.0.1:17891
- Web controller: http://127.0.0.1:17892
- Lightroom plugin folder: lightroom/LRBridge.lrplugin

## Current runtime paths

At v0.3.2, the working development setup uses project-local files:

- config/settings.txt
- lrplugin-log.txt

This is working and tested.

Do not casually move these paths while developing. The Lightroom plugin and Electron app must agree on the same settings path.

## Packaging problem

Packaging LRBridge into a Windows EXE will move the app out of the development repo.

That means project-local paths such as:

- D:\Projects\LRBridge\config\settings.txt
- D:\Projects\LRBridge\lrplugin-log.txt

are not safe for a real installer.

## Correct future direction

Before building a public EXE, runtime paths should be redesigned carefully.

Recommended final Windows runtime folder:

%APPDATA%\LRBridge

Expected files:

- %APPDATA%\LRBridge\settings.txt
- %APPDATA%\LRBridge\lrplugin-log.txt

But this must be implemented cleanly and tested in both places:

1. Electron app creates and reads settings.txt.
2. Lightroom plugin creates and reads the same settings.txt.
3. Lightroom plugin writes lrplugin-log.txt.
4. Changing polling in the app is detected by Lightroom plugin.
5. No old project-local lrplugin-log.txt is created.
6. npm test still passes.

## Failed experiment note

A quick live patch attempted after v0.3.2 moved paths to %APPDATA%, but Lightroom plugin logging did not appear in the new folder.

That experiment was discarded by resetting to:

git reset --hard v0.3.2-web-controller

Do not repeat that approach blindly.

## Safe current development flow

Use:

npm run app

Then test with:

npm test

Current stable setup is good for development and manual use.

## Next packaging-safe approach

When attempting runtime path migration again:

1. Add a very small Lightroom-only test first.
2. Confirm PluginInit.lua can write a log to the chosen folder.
3. Only then move Settings.lua.
4. Only then move Electron app settings.
5. Commit each working step separately.

Do not change Electron app and Lightroom plugin paths in one big patch.
