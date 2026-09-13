# Delete Component implementation and validation

This work extends the Add/Subtract implementation on `fcdb5e8` and is included in the subsequently authorized integrated component-actions checkpoint. The user reported Add/Subtract working live and accepted the final action-row labels. Delete Component has automated validation; a separate live report of its selection and last-component outcomes remains outstanding. See `CODEX_HANDOFF.md` for checkpoint scope and current verification. No push or release is authorized.

## SDK calling convention

The installed Lightroom Classic 15.3 reference at `C:/Users/nino/Downloads/LrC_15.3_SDK/API Reference/modules/LrDevelopController.html`, entry `LrDevelopController.deleteMaskTool` (line 910), documents deleting a tool from the current mask while Develop and Masking are active. Its heading is `(id, param)`, with an empty `id` description and the component-ID description under `param`. That heading alone does not establish a two-argument runtime contract.

The implementation calls `LrDevelopController.deleteMaskTool(componentId)` once. The single-ID convention is corroborated by the [published MIDI2LR implementation](https://github.com/rsjaffe/MIDI2LR/blob/e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc/src/plugin/Mask.lua), and matches LRBridge's accepted mask-ID API calls. MIDI2LR was consulted only for the calling convention; no implementation was copied. The installed documentation does not describe last-component behavior. Neither signature experimentation nor a second whole-mask deletion is used as a fallback.

## Authoritative lifecycle

- `/masking/component/delete` admits the original photo, mask and component with context/Develop counters, context timestamp, server epoch and Masking revision. Queue admission and dequeue retain the existing operation ownership checks. The UI disables conflicting actions and duplicate clicks.
- Public admission includes `beforeSelectedMaskId` and `beforeSelectedMaskToolId`. Lua results and every server completion/cancellation include `targetMaskId` and `targetToolId`. The browser requires both targets to match its original operation.
- Fresh complete inventories must prove that exactly the target component disappeared and all other groups/components survived. Group IDs and parent-component IDs before/after travel with the result. Neither an SDK call returning normally nor a surviving selection proves deletion.
- Recovery preserves a valid Lightroom selection. With no usable component selection, it selects the next surviving component, or the previous component at the end. Yielding server checks are followed by fresh SDK selection checks before each recovery write. Recovery is bounded, and never repeats deletion.
- If the last component also removes its parent, the accepted surviving-mask/empty-photo recovery handles the SDK outcome without invoking `deleteMask`. If Lightroom instead reports a complete parent group with `Tools = {}`, the inventory and UI retain that empty group, with no selected component. Incomplete creation placeholders still fail closed; Add/Subtract's unfinished-inventory behavior remains covered.
- `confirmed` means removal and usable selection (or an authoritative empty state) are reconciled. `deleted` means removal is proven but selection recovery is incomplete/cancelled. `parentRemoved` and `remainingComponentCount` describe the original target's result independently of any newer selected group. Invalid selection cannot erase valid removal proof.

## Automated evidence

- `npm run test:masking-component-delete`: 56 real HTTP/queue/Parser/Commands/Lua scenarios with a mocked SDK. Covers ordinary next/previous selection, native/user selections, missing/invalid target and removal proof, both last-component outcomes, reopening/navigating retained empty groups, partial recovery, duplicate commands/results, and photo/module/mask/component changes.
- `npm run test:masking-components`: all 74 existing Add/Subtract scenarios pass. Existing creation and 53 whole-mask deletion scenarios pass.
- `node tests/controller-browser-lifecycle.js --mask-create-only`: creation, Add/Subtract, whole-mask deletion and Delete Component browser checks pass, including Undo/Redo, target IDs, partial selection, stale replies, and continuous page geometry at 1280/768/390/320 pixels.
- Focused Masking/history and JavaScript/Lua syntax checks pass. `npm run test:masking` passes `tests/masking.js`, then stops at the unchanged pre-existing Delete All wording assertion in `tests/masking-phase4-completion.js:711`.

The Lua execution tests reuse the temporary Fengari runtime identified in the local handoff via `LRBRIDGE_LUA_TEST_RUNTIME`; no dependency was added. Mocked last-component outcomes do not establish which behavior Lightroom 15.3 actually performs.

## Reload and live acceptance

After completing source validation, restart LRBridge once, reload the production `D:/Projects/LRBridge/lightroom/LRBridge.lrplugin` once, then refresh the Web Controller once. A Lightroom application restart is not required.

Use a test mask with three components: delete its middle component, verify the survivor selection and unchanged parent, then Undo/Redo. Delete a final component on a disposable mask and record whether Lightroom removes the parent or retains it empty; the Controller's outcome must match. Repeat with the only mask on the photo if the parent is removed. Check rapid duplicate clicks and a native photo/mask/component change during an in-flight request. The explicit checkpoint authorization does not turn these outstanding live checks into accepted observations.
