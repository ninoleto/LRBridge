# LRBridge Codex Contract

## Project map

LRBridge is a local Windows bridge between browser/HTTP controllers and Adobe Lightroom Classic. The Electron/Web Controller lives in `app/`; the Node HTTP API, authoritative state, and command queue live in `server/`; the Lightroom SDK plug-in lives in `lightroom/LRBridge.lrplugin/`; configuration lives in `config/`; regression coverage lives in `tests/`; and durable supporting documentation lives in `docs/` and the root Markdown files.

## Session startup and evidence

- At the start of every session, read `CODEX_HANDOFF.md`, then verify the current branch, `HEAD`, worktree/index status, configured upstream, and local/upstream equality. Report any material discrepancy before editing.
- Read only targeted, recent sections of `CODEX_HANDOFF.local.md` when detailed diagnostic evidence is necessary. Do not automatically consume the entire long local file.
- Git history, current production source, and current tests are authoritative when handoff text is stale or inconsistent.

## Preservation and Git safety

- Preserve every pre-existing user change in a dirty worktree. Work around unrelated edits and never overwrite them.
- Never use destructive Git commands. Never reset, restore, clean, checkout over changes, stash, stage, commit, or push unless the user explicitly authorizes that operation.
- Never use `git add .`. When staging is authorized, construct an explicit file allowlist, stage only it, and verify the allowlist with `git diff --cached --name-status` and the cached diff.
- Preserve `config/settings.txt`, ignored local handoff/log files, existing stashes, and the protected cheat sheets unless the user explicitly authorizes changing the named artifact.
- Commit or push only after explicit authorization, scoped staging, cached-diff review, and appropriate verification.

## Implementation and verification

- Run focused tests first. Run the full suite only at an appropriate checkpoint or when explicitly requested.
- Require user manual acceptance for Lightroom or UI behavior before checkpointing it.
- Lightroom SDK feedback is authoritative. Never fabricate authoritative state or replace it with optimistic browser state.
- Preserve selected-photo UUID, context-counter, Develop-revision, command-queue, gesture-lifecycle, and stale-response safeguards across every applicable change.
- Do not use Lightroom UI Automation, window scraping, screenshots, keyboard or mouse injection, or similar UI-control techniques.
- Do not add production dependencies without approval.
- Lightroom Lua changes require one explicit plug-in reload request before manual validation. Browser/server-only changes must not trigger unnecessary Lightroom reload requests.

## Handoffs

- Update `CODEX_HANDOFF.md` at accepted checkpoints with concise, sanitized durable state.
- Keep temporary investigations, probe evidence, long logs, and verbose diagnostic history in ignored `CODEX_HANDOFF.local.md`.
- Keep this contract limited to permanent project rules; place checkpoint-specific state and roadmap details in the handoff.
