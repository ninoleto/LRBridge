# Contributor handoff — 0.6.0-rc.1

Forks, issues and pull requests are welcome, including work with AI coding
agents. Continued maintenance, review times and future releases are not
promised. Keep the existing license terms and notices; LRBridge's package
metadata declares ISC. The Companion module retains its separate MIT license.

## Start from the released source

Use [tag v0.6.0-rc.1](https://github.com/ninoleto/LRBridge/tree/v0.6.0-rc.1),
which matches the portable package's source commit manifest. The homepage on
`main` links to this source; its older application files are not the RC1 baseline.
Fork the repository, clone your fork and create a working branch from the tag:

```powershell
git switch -c my-change v0.6.0-rc.1
npm ci
npm run test:release
npm run test:release -- --browser
npm run dist:win
```

Use Windows x64. The verified build used Node **24.18.0**, npm **12.0.2**,
Electron **43.1.1** and electron-builder **26.15.3** from the lockfile.
`npm run dist:win` creates a new sanitized staging tree and portable ZIP under
`dist/`; the release manifest records the source commit and cleanliness. Build
release assets from a clean commit. The portable executable is unsigned.

The tested application baseline is Lightroom Classic **15.4.1**, Companion
**5.0.1**, LRBridge beta.4 with the beta4.10 plug-in, and Companion beta4.13
implementation, all packaged as 0.6.0-rc.1. Other Lightroom versions and macOS
are unverified. Native manual acceptance covers the user's tested scenarios.

## Project map and verification

Read `AGENTS.md`, the current opening of `CODEX_HANDOFF.md`, and
[HTTP_WORKFLOWS.md](HTTP_WORKFLOWS.md) before changing behavior. Historical
handoff entries describe earlier checkpoints; source, tests and current user
instructions determine the present state.

- `app/`: Electron shell and Web Controller.
- `server/`: HTTP/WebSocket interfaces, authoritative state and command queue.
- `lightroom/LRBridge.lrplugin/`: Lightroom SDK plug-in.
- `tests/`: isolated regression fixtures; do not direct them at a live catalog.
- `tools/`: allowlisted packaging and release checks; `resources/presets/` holds
  the required Dust presets.

RC1 passes **75/75 core**, **10/10 browser**, and four checks against the packaged
executable/ASAR/plug-in. The [Companion source](https://github.com/ninoleto/companion-module-ninoleto-lrbridge/tree/v0.6.0-rc.1)
passes **265/265** tests using Node **22.20.0** and Yarn **4.17.0**. Its handoff
documents `LRBRIDGE_REFERENCE` and package commands; no private beta ZIP is needed.

Preserve SDK-authoritative feedback, photo UUID/context/revision ownership,
queue order, gesture lifecycle and stale-response guards. A queued command or
HTTP acknowledgement is not Lightroom completion. Keep native helpers and
Dust resources intact. Never use automated tests to edit a user's photos.
Lua behavior changes need one plug-in reload before user-led manual validation.
Keep personal settings, logs and credentials out of commits and packages.

## Known limitations and contribution scope

The owner explicitly accepted the [documented limitations](PUBLIC_RELEASE_BLOCKERS.md)
for publication. Default listeners bind beyond loopback; HTTP/WebSocket commands
and internal context updates do not authenticate callers. Use only a trusted LAN
or private VPN; do not expose ports 17890–17892 via public forwarding or tunnels.
The earlier complete security review remains unreconciled. Publication acceptance
does not claim those issues are fixed or that a complete security audit passed.

Feedback is polling-based, and some native controls can report unavailable or
delayed confirmation. macOS, Lens Blur + New Refinement and named Export presets
remain deferred. See [WINDOWS_BETA.md](WINDOWS_BETA.md) for detailed feature limits.

Start focused changes from the release tag and target `release/0.6.0-rc.1` for
RC1-based pull requests. Explain the concrete behavior change, tests run and any
manual Lightroom verification. Discuss broad authentication/network changes as
a separate scope so trusted-LAN and Companion compatibility can be reviewed.
Include relevant context and reproduction steps when using an AI coding agent;
review its changes and never provide it with credentials or private catalogs.
