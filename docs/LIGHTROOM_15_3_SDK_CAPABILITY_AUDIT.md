# Lightroom Classic 15.3 SDK Capability Audit

This document records a read-only audit of the official Lightroom Classic 15.3 SDK reference, guides, release notes and sample plug-ins for potential LRBridge commands.

Audit source: local Lightroom Classic 15.3 SDK API Reference, SDK Guide, Controller Guide, release notes/readme, and sample plug-ins under `C:\Users\nino\Downloads\LrC_15.3_SDK`.

Key:

- **DIRECT** — documented API performs the operation.
- **INDIRECT** — possible using documented APIs, but not Lightroom’s exact native command.
- **INTERACTIVE** — documented API opens Lightroom UI.
- **READ-ONLY** — query/status only.
- **ABSENT** — no matching public SDK capability.
- **ND** — minimum version or behavior is not documented in the 15.3 entry; it is not inferred.

## A. Develop Settings menu

| Lightroom command | Class | Exact SDK API | Min SDK | Scope | Async | Write gate | Dialog | Return/status | Hidden state / ambiguity | Risk | Proposed command | Label | Recommendation |
|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|
| Reset | DIRECT | `LrDevelopController.resetAllDevelopAdjustments()` | 6.0 | Current active photo; Develop active | No requirement documented | No requirement documented | No | No return documented | Depends on active photo/module | Low | Already `develop.action&action=resetAllDevelopAdjustments` | Reset | Already implemented |
| Update to Current Process Version | DIRECT, with version caveat | `LrDevelopController.getProcessVersion()`; `setProcessVersion(value)` | 6.0 | Current photo; Develop active | No requirement documented | No requirement documented | No | Getter returns process version | Setter accepts explicit versions such as `"Version 1"`…`"Version 6"`; SDK does not expose a separate “latest version” constant | Medium | `develop.process_version&version=Version%206` | Update Process Version | Defer v0.7 |
| Copy Settings… native dialog | ABSENT | None found | — | — | — | — | — | — | `openCopySettingsDialog()` does not exist | — | None | — | Exclude |
| Copy settings without dialog | DIRECT | `photo:copySettings()` | 10.3 | The chosen `LrPhoto` | Required | No gate documented | No | Boolean success | Copies the settings subset “already selected in the UI”; no subset parameter | Medium | `develop.settings.copy&scope=active` | Copy Settings | Defer v0.7 |
| Paste Settings, active | DIRECT | `photo:pasteSettings(updateAISettings)` | 10.3; updated 15.3 | Chosen/active photo | Required | `withWriteAccessDo` or prolonged gate | No | Boolean success | Clipboard content/status cannot be queried | Medium | `develop.settings.paste&scope=active&updateAISettings=false` | Paste Settings | Defer v0.7 |
| Paste Settings, selection | DIRECT | `catalog:pasteSettings(photos, updateAISettings)` | 15.3 | Explicit photo array | Required | Write/prolonged gate | No | True if executed for at least one photo | Must capture the intended selection; clipboard status unavailable | Medium | `develop.settings.paste&scope=selected&updateAISettings=false` | Paste Settings to Selection | Defer v0.7 |
| Paste Settings from Previous | ABSENT | None | — | — | — | — | — | — | No API for Lightroom’s “previously selected” photo or native previous-settings state | — | None | — | Exclude |
| Reconstruct “previous” settings | INDIRECT | `source:getDevelopSettings()` + `target:applyDevelopSettings(settings, historyName, flattenAutoNow)` | 3.0 / 6.0 | Explicit source and target photos | `getDevelopSettings()` requires task; apply entry states no task requirement | No gate documented for apply | No | Settings table; apply has no result documented | Experimental settings schema; an adjacent Filmstrip photo is not guaranteed to be Lightroom’s “previous” photo | High | Do not represent as Previous | Apply Develop Settings | Defer v0.7 |
| Sync Settings… native command/dialog | ABSENT | None | — | — | — | — | — | — | No native Sync API and no Sync Settings dialog opener | — | None | — | Exclude |
| Manual settings synchronization | INDIRECT | `getDevelopSettings()` + repeated `applyDevelopSettings()` | 3.0 / 6.0 | One explicit source to explicit targets | Source read requires task | Apply entry does not specify gate | No | Experimental settings table; no batch result | Does not reproduce native Sync subset/dialog behavior | High | `develop.settings.apply` with explicit source UUID/targets | Apply Settings | Defer v0.7 |
| Update AI Settings, active | DIRECT | `photo:updateAISettings()` | 13.3 | One photo | Required | Write/prolonged gate | No | No return documented | Potentially expensive AI recomputation | Medium | `develop.ai.update&scope=active` | Update AI Settings | Implement in v0.6 |
| Update AI Settings, selection | DIRECT | `catalog:updateAISettings(photos)` | 13.3 | Explicit photos; omitted photos means target photos | Required | Write/prolonged gate | No | No return documented | Omitting `photos` changes scope to all target photos; LRBridge should always pass an explicit array | Medium | `develop.ai.update&scope=selected` | Update AI Settings | Implement in v0.6 |
| AI update required status | READ-ONLY | `photo:needsUpdateAISettings()` | 15.3 | One photo | Required | No | No | Boolean | Per-photo only | Low | `status.photo.ai_update_required` | AI Update Required | Defer v0.7 status work |
| Delete AI Empty Masks | DIRECT | `catalog:deleteAllEmptyMasks(photos)` | 14.0 | Explicit photos; omitted array means all target photos | No task requirement documented | Write/prolonged gate | No | No return documented | LRBridge must never omit the explicit scope accidentally | Medium | `develop.ai.delete_empty_masks&scope=active|selected` | Delete Empty Masks | Implement active-only in v0.6 |
| Auto White Balance | DIRECT | `LrDevelopController.setAutoWhiteBalance()` | 7.4 | Current photo; Develop active | No requirement documented | No requirement documented | No | No return documented | Compatible photo/module required | Low | Existing Develop action | Auto White Balance | Already implemented |
| Auto Settings | DIRECT | `LrDevelopController.setAutoTone()` | 7.4 | Current photo; Develop active | No requirement documented | No requirement documented | No | No return documented | Compatible photo/module required | Low | Existing Develop action | Auto | Already implemented |
| Convert to Black & White | DIRECT | `photo:quickDevelopSetTreatment("grayscale")` | 7.4 | Chosen/current photo | No requirement documented | No requirement documented | No | No return documented | API calls the monochrome treatment `grayscale`; this is the documented treatment control | Low | `photo.treatment&value=grayscale` | Black & White | Implement in v0.6 |
| Convert back to Color | DIRECT | `photo:quickDevelopSetTreatment("color")` | 7.4 | Chosen/current photo | No requirement documented | No requirement documented | No | No return documented | Same treatment control | Low | `photo.treatment&value=color` | Color | Implement in v0.6 |
| Toggle HDR Edit Mode | INDIRECT | `photo:getDevelopSettings()` / `applyDevelopSettings({ HDREditMode = ... })` | HDR field documented from 13.0; apply 6.0 | Explicit photo | Read requires task | Apply gate not documented | No | Experimental settings table | No documented toggle method, no documented accepted HDR value contract, and no native toggle semantics | High | None until contract is defined | HDR Edit Mode | Defer v0.7 |
| Match Total Exposures | ABSENT | None | — | — | — | — | — | — | No matching method in reference, guides, release notes, or samples | — | None | — | Exclude |

### Copy/paste conclusions

`photo:copySettings()` does not open the native Copy Settings dialog. It silently copies the subset already selected in Lightroom’s UI. The public method provides no argument for selecting that subset.

The 15.3 reference documents Boolean success for copy and paste, but it does not document:

- a clipboard-content query;
- a clipboard-validity query;
- the exact error/false behavior for an empty or invalid Develop clipboard;
- an API for changing the Copy Settings subset.

LRBridge therefore needs result/error reporting before clipboard commands are suitable for controller buttons.

## B. Export menu and direct export

| Capability | Class | Exact SDK API | Min SDK | Scope | Async | Write gate | Dialog | Return/status | Hidden state / ambiguity | Risk | Proposed command | Label | Recommendation |
|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|
| Export… | INTERACTIVE | `photo:openExportDialog()` | 7.4 | Current/chosen photo | No requirement documented | No | Mandatory | No return documented | User completes or cancels dialog | Low | `export.dialog&mode=normal` | Export… | Defer v0.7 |
| Export With Previous Settings | INTERACTIVE | `photo:openExportWithPreviousDialog()` | 7.4 | Current/chosen photo | No requirement documented | No | Mandatory | No return documented | Uses Lightroom’s previous export state and opens a dialog | Low | `export.dialog&mode=previous` | Export With Previous Settings | Defer v0.7 |
| Headless Export With Previous Settings | ABSENT | None | — | — | — | — | — | — | No method executes Lightroom’s previous export settings without UI | — | None | — | Exclude |
| Direct export session | DIRECT | `LrExportSession { photosToExport = photos, exportSettings = settings }` | 1.3 | Explicit photo array | Export work is task-based | No catalog gate normally | No | Session object | Caller owns the complete settings table and output safety | High | `export.run` with validated structured payload | Export | Defer v0.7 |
| Export on current task | DIRECT | `session:doExportOnCurrentTask()` | 1.3 | Session photos | Must already be in an async task | No | No | Blocks until renditions complete | Long-running request; cancellation/progress required | High | Internal execution mode | — | Defer v0.7 |
| Export on new task | DIRECT | `session:doExportOnNewTask()` | 1.3 | Session photos | Starts its own task | No | No | Returns immediately | Command completion is not export completion | High | Internal execution mode | — | Defer v0.7 |
| Rendition progress/results | DIRECT | `session:countRenditions()`; `session:renditions(params)`; `rendition:waitForRender()` | 1.3 | Per session/rendition | Iterator/wait occurs in task | No | No | `waitForRender()` returns success plus output path, or failure plus displayable error | Requires job IDs and persistent result reporting | Medium | `export.status&id=…` | Export Progress | Defer v0.7 |
| Active-photo direct export | DIRECT | `catalog:getTargetPhoto()` + `LrExportSession` | 1.3 session; target API version ND | Active photo | Yes | No | No | Per rendition | Must reject nil/video or unsupported format combinations | Medium | `export.run&scope=active` | Export Active Photo | Defer v0.7 |
| Selected-photo direct export | DIRECT | Capture selection + `LrExportSession` | 1.3 session | Explicit selected array | Yes | No | No | Per rendition | `getTargetPhotos()` can represent the Filmstrip when nothing is selected; LRBridge must validate actual intended scope | High | `export.run&scope=selected` | Export Selected Photos | Defer v0.7 |
| Destination folder | DIRECT | `LR_export_destinationType`, `LR_export_destinationPathPrefix`, subfolder keys | 1.3 export architecture | Session | Yes | No | Only `chooseLater` invokes UI | Rendition path | Path validation and permissions | High | Structured `destination` object | Destination | Defer v0.7 |
| Collision/overwrite | DIRECT | `LR_collisionHandling = "ask"|"rename"|"overwrite"|"skip"` | 1.3 architecture | Session | Yes | No | `"ask"` can be interactive | Per-rendition outcome | `overwrite` is destructive; `ask` is not headless | High | `collision=rename|skip`; exclude overwrite initially | Existing Files | Defer v0.7 |
| JPEG/TIFF/PSD/DNG/original | DIRECT | `LR_format = "JPEG"|"TIFF"|"PSD"|"DNG"|"ORIGINAL"` | 1.3 architecture | Session | Yes | No | No | Rendition result | Options differ by format | Medium | `format=jpeg|tiff|psd|dng|original` | File Format | Defer v0.7 |
| JPEG quality | DIRECT | `LR_jpeg_quality` in `[0,1]` | 1.3 architecture | Session | Yes | No | No | Rendition result | Valid only for JPEG | Low | `jpegQuality=0..1` | JPEG Quality | Defer v0.7 |
| Resize | DIRECT | `LR_size_doConstrain`, `LR_size_doNotEnlarge`, `LR_size_resizeType`, maximum dimensions/megapixels, resolution and units | 1.3 architecture | Session | Yes | No | No | Rendition result | Interdependent validation | Medium | Nested resize payload | Resize | Defer v0.7 |
| Output sharpening | DIRECT | `LR_outputSharpeningOn`, `LR_outputSharpeningMedia`, `LR_outputSharpeningLevel` | 1.3 architecture | Session | Yes | No | No | Rendition result | Media/level only meaningful when enabled | Low | Nested sharpening payload | Output Sharpening | Defer v0.7 |
| Watermarking | DIRECT, ID-based | `LR_useWatermark`, `LR_watermarking_id` | 1.3 architecture | Session | Yes | No | No | Rendition result | SDK cannot create or modify watermark presets; no general watermark-preset enumeration API documented | Medium | `watermarkId=…` | Watermark | Defer v0.7 |
| Filename tokens | DIRECT | `LR_renamingTokensOn`, `LR_tokens`, `LR_tokenCustomString`, sequence fields | 1.3 architecture | Session | Yes | No | No | Output path | Token grammar and collision behavior need strict validation | High | Structured rename payload | File Naming | Defer v0.7 |
| User named still-image export preset enumeration | ABSENT | None | — | — | — | — | — | — | SDK Guide describes presets in Export UI/files, but exposes no public runtime list API | — | None | — | Exclude |
| Execute named user still-image export preset | ABSENT | None | — | — | — | — | — | — | No API accepts a still-export preset name/UUID | — | None | — | Exclude |
| Plug-in-supplied export presets | INDIRECT/infrastructure | `builtInPresetsDir` in an export service provider | Export-service SDK | Plug-in export service | No | No | Used by Export UI | No general command result | Bundled presets must be authored and registered with a plug-in; this does not enumerate or run arbitrary user presets | High | None for LRBridge controller | — | Exclude |
| Video export presets | DIRECT, video only | `LrExportSettings.videoExportPresets()`; `applyVideoExportPreset()` | 4.0 | Export settings table | No | No | No | Preset/settings objects | Not still-image export support | Medium | None in current scope | — | Exclude |

## C. Presets

| Candidate | Class | Exact SDK API | Min SDK | Scope | Async | Write gate | Dialog | Return/status | Ambiguity | Risk | Proposed command | Label | Recommendation |
|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|
| Enumerate Develop preset folders | READ-ONLY | `LrApplication.developPresetFolders()` | 3.0 | Global | No requirement documented | No | No | Array of `LrDevelopPresetFolder` | Root hierarchy only | Low | `develop.presets.list` | Develop Presets | Defer v0.7 |
| Enumerate presets in a folder | READ-ONLY | `folder:getDevelopPresets()` | 3.0 | Folder | No | No | No | Array of `LrDevelopPreset` | Folders/names are user-mutable | Low | Included in preset listing | — | Defer v0.7 |
| Preset folder identity | READ-ONLY | `folder:getName()`, `folder:getPath()` | 3.0 | Folder | No | No | No | Strings | Localized/user-controlled names | Low | Listing fields | — | Defer v0.7 |
| Preset name | READ-ONLY | `preset:getName()` | 3.0 | Preset | No | No | No | String | Names are not guaranteed unique | Low | Listing field | — | Defer v0.7 |
| Preset UUID | READ-ONLY | `preset:getUuid()` | 3.0 | Preset | No | No | No | String | Preferred stable selection key | Low | Listing field | — | Defer v0.7 |
| Preset file/path | READ-ONLY | `preset:getFile()`; folder path API | 3.0 | Preset | No | No | No | File/path information | Availability varies by preset type | Low | Diagnostic field only | — | Defer v0.7 |
| Preset settings | READ-ONLY | `preset:getSetting()` | 3.0 | Preset | No | No | No | Settings data | Documented as experimental | Medium | Do not expose initially | — | Defer v0.7 |
| Resolve Develop preset by UUID | READ-ONLY | `LrApplication.developPresetByUuid(uuid)` | 3.0 | Global | No | No | No | `LrDevelopPreset` when resolvable | Plug-in-hidden presets cannot be retrieved by ordinary ID; missing UUID failure details are not documented | Low | Internal resolver | — | Defer v0.7 |
| Apply Develop preset, active | DIRECT | `photo:applyDevelopPreset(preset, plugin, presetAmount, updateAISettings)` | 3.0; updated 15.3 | One photo | Required | Write/prolonged gate | No | No return documented | Amount `0..200`; AI update defaults false; validate missing preset before entering gate | Medium | `develop.preset.apply&uuid=…&scope=active&amount=100&updateAISettings=false` | Apply Develop Preset | Defer v0.7 |
| Apply Develop preset, selection | DIRECT | `catalog:applyDevelopPreset(photos, preset, plugin, presetAmount, updateAISettings)` | ND in method entry | Explicit photos | Required | Write/prolonged gate | No | No return documented | Explicit selection capture and partial failure reporting needed | Medium | Same with `scope=selected` | Apply Preset to Selection | Defer v0.7 |
| Enumerate metadata presets | READ-ONLY | `LrApplication.metadataPresets()` | 3.0 | Global | No | No | No | Table mapping preset names to unique IDs/paths | Names are user-controlled; use returned ID | Low | `metadata.presets.list` | Metadata Presets | Defer v0.7 |
| Apply metadata preset, active | DIRECT | `photo:applyMetadataPreset(presetId)` | 3.0 | One photo | No task requirement documented | Required | No | No return documented | Missing-ID error behavior not documented | Medium | `metadata.preset.apply&id=…&scope=active` | Apply Metadata Preset | Defer v0.7 |
| Apply metadata preset, selection | INDIRECT batch | Repeated `photo:applyMetadataPreset(presetId)` inside one write gate | 3.0 | Explicit selection | No task requirement documented | Required | No | No batch result | Partial failure handling required | Medium | Same with `scope=selected` | Apply Metadata Preset to Selection | Defer v0.7 |
| Still-image export preset listing/execution | ABSENT | None | — | — | — | — | — | — | No public user-preset list or execute API | — | None | — | Exclude |
| Plug-in hidden Develop presets | DIRECT, plug-in-owned only | `getDevelopPresetsForPlugin()` and plug-in preset application APIs | 3.0 | Presets bundled by that plug-in | Varies | Write gate for application | No | Preset objects | Not user preset enumeration; not appropriate for LRBridge’s general preset picker | Medium | None initially | — | Exclude |
| Video presets | DIRECT, video only | `videoExportPresets()` / `applyVideoExportPreset()` | 4.0 | Video export settings | No | No | No | Video preset/settings | Not Develop or still-image presets | Medium | None | — | Exclude |

Duplicate Develop preset names are safe only if LRBridge presents names for display but submits UUIDs. A missing UUID should be rejected before the catalog write operation.

## D. Photo and Library commands

| Lightroom command | Class | Exact SDK API | Min SDK | Scope | Async | Write gate | Dialog | Return/status | Ambiguity | Risk | Proposed command | Label | Recommendation |
|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|
| Set as Reference Photo | ABSENT | None | — | — | — | — | — | — | Reference-view layout APIs do not assign the reference photo | — | None | — | Exclude |
| Lock to Second Window | ABSENT | None | — | — | — | — | — | — | Secondary-display views exist, but reference lock does not | — | None | — | Exclude |
| Show in Explorer | DIRECT composition | `photo:getRawMetadata("path")` + `LrShell.revealInShell(path)` | Path field 3.0; reveal 1.3 | One photo/file | Metadata read may require async depending on context | No | Opens Explorer, not a Lightroom dialog | No return documented | Offline/missing files need rejection | Low | `photo.reveal&scope=active` | Show in Explorer | Implement in v0.6 |
| Go to Folder in Library | INDIRECT | Derive folder/source; `catalog:setActiveSources({folder})`; optionally `setSelectedPhotos()` | Active sources 3.0 | Photo/folder/UI | No requirement documented | No | No | No return documented | Must identify folder object and preserve/restore selection; changes UI source | Medium | `application.source.activate&type=folder&id=…` | Go to Folder | Defer v0.7 |
| Go to Collection | INDIRECT | `photo:getContainedCollections()` + `catalog:setActiveSources()` | Collection metadata/current source APIs 3.0 | One photo/UI | No requirement documented | No | No | Collection list | A photo can belong to multiple collections; native menu requires a user choice | Medium | Collection-list then activate command | Go to Collection | Defer v0.7 |
| Edit In | ABSENT generally | No general Edit In target API | — | — | — | — | — | — | No editor enumeration or equivalent native menu command | — | None | — | Exclude |
| Edit in Photoshop | DIRECT | `LrDevelopController.editInPhotoshop()` | 7.4 | Current photo; Develop active | No requirement documented | No | May launch external Photoshop UI | No return documented | External application availability/state | High | `photo.edit&target=photoshop` | Edit in Photoshop | Defer v0.7 |
| Photo Merge | ABSENT | None | — | — | — | — | — | — | No HDR/panorama merge API | — | None | — | Exclude |
| Enhance | DIRECT | `LrDevelopController.setEnhance(paramName, value, denoiseAmount)` | 15.3 | Current photo; Develop active | Required | No gate documented | No | No return documented | `paramName`: `denoise`, `rawDetails`, `superRes`; denoise amount `1..100`; computation/availability may be substantial | High | `develop.enhance&type=denoise|rawDetails|superRes&enabled=true&amount=50` | Enhance | Defer v0.7 |
| Generate using Firefly | ABSENT | None | — | — | — | — | — | — | Generative/masking primitives are not the Lightroom Firefly menu workflow | — | None | — | Exclude |
| Set Flag | DIRECT | Existing `LrSelection` flag APIs | 6.0-era selection API | Selection | No | No | No | No return documented | Already supported | Low | Existing commands | Pick/Reject/Unflag | Already implemented |
| Set Rating | DIRECT | Existing `LrSelection` rating APIs | 6.0-era selection API | Selection | No | No | No | No return documented | Already supported | Low | Existing commands | Rating | Already implemented |
| Set Color Label | DIRECT | Existing `LrSelection` label APIs | 6.0-era selection API | Selection | No | No | No | No return documented | Already supported | Low | Existing commands | Color Label | Already implemented |
| Reset Export Status | ABSENT mutation; READ-ONLY status | `photo:getRawMetadata("isExported")` | Status field 13.3 | One photo | Metadata query context | No | No | Boolean `isExported` | No setter for ordinary export status; publish edited flags are different | Low for query | `status.photo.exported` | Exported | Defer status; exclude reset |
| Add Shortcut Keyword | ABSENT | None | — | — | — | — | — | — | Shortcut-keyword UI state has no public API | — | None | — | Exclude |
| Add to Quick Collection | INDIRECT/conditional | `photo:addOrRemoveFromTargetCollection(include_selected)` | 7.4; `include_selected` added 15.2 | One photo or current selection | No requirement documented | No gate documented | No | No return documented | Acts on the current **target collection**, which is not guaranteed to be Quick Collection | Medium | `collection.target.toggle&scope=active|selected` | Add/Remove from Target Collection | Defer v0.7 |
| Activate Quick Collection | DIRECT UI | `catalog:setActiveSources({ LrCatalog.kQuickCollectionIdentifier })` | 3.0 | Application source | No | No | No | No return documented | Activates source; does not add photos | Low | `application.source.activate&type=quick_collection` | Show Quick Collection | Defer v0.7 |
| Create stack from existing photos | ABSENT | None | — | — | — | — | — | — | `catalog:addPhoto(..., stackWithPhoto, position, ...)` applies while importing/adding a new photo; it is not an existing-selection stack command | — | None | — | Exclude |
| Add existing photos to stack | ABSENT | None | — | — | — | — | — | — | No public method | — | None | — | Exclude |
| Expand/collapse stack | ABSENT mutation | None | — | — | — | — | — | — | Collapse state is queryable but not settable | — | None | — | Exclude |
| Unstack existing photos | ABSENT | None | — | — | — | — | — | — | No public method | — | None | — | Exclude |
| Query stack state | READ-ONLY | `getRawMetadata("isInStackInFolder")`, `"stackInFolderIsCollapsed"`, `"stackPositionInFolder"`, `"stackInFolderMembers"`, `"topOfStackInFolderContainingPhoto"` | Metadata fields documented in `LrPhoto` | One photo/stack | Metadata query context | No | No | Booleans, number, photo arrays/objects | Folder-stack state only | Low | `status.photo.stack` | Stack Status | Defer v0.7 |
| Create Virtual Copies | DIRECT | `catalog:createVirtualCopies(copyName)` | 5.0 | Currently selected photos **and videos** | Required | No gate documented | No | Array of new `LrPhoto` objects | New virtual copies automatically become selected; optional name applies to every copy | Medium | `photo.virtual_copy.create&scope=selected&name=…` | Create Virtual Copies | Defer v0.7 |
| Rotate Left | DIRECT | `photo:rotateLeft()` | 3.0 | Explicit/active photo | No requirement documented | No gate documented | No | No return documented | Already implemented active-only | Low | Existing `photo.rotate&direction=left` | Rotate Left | Already implemented |
| Rotate Right | DIRECT | `photo:rotateRight()` | 3.0 | Explicit/active photo | No requirement documented | No gate documented | No | No return documented | Already implemented active-only | Low | Existing `photo.rotate&direction=right` | Rotate Right | Already implemented |
| Rotate selected photos | INDIRECT batch | Repeated `photo:rotateLeft()` / `rotateRight()` | 3.0 | Explicit captured selection | No requirement documented | No gate documented | No | Per-call result absent | Partial failure and video handling | Medium | `photo.rotate&scope=selected` | Rotate Selected | Defer v0.7 |
| Email Photos | ABSENT | None | — | — | — | — | — | — | No native Email Photos API | — | None | — | Exclude |
| Remove Photos from catalog | DIRECT | `LrSelection.removeFromCatalog()` | 14.3 | Current selection | No requirement documented | No gate documented | SDK entry documents no confirmation | No return documented | Destructive catalog mutation and broad implicit scope | High | None until safeguarded | Remove from Catalog | Exclude |
| Delete from disk | ABSENT | None | — | — | — | — | — | — | No documented Lightroom catalog delete-from-disk command API | — | None | — | Exclude |
| Remove from collection | DIRECT | `collection:removePhotos(photos)` | 3.0-era collection API | Explicit regular collection/photos | No task requirement documented | Required | No | No return documented | Collection identity/list architecture required; smart collections are not mutable this way | Medium | `collection.photos.remove&id=…` | Remove from Collection | Defer v0.7 |
| Add to collection | DIRECT | `collection:addPhotos(photos)` | 3.0-era collection API | Explicit regular collection/photos | No task requirement documented | Required | No | No return documented | Collection lookup and smart/published collection distinctions | Medium | `collection.photos.add&id=…` | Add to Collection | Defer v0.7 |
| View Options | ABSENT | None | — | — | — | — | — | — | View/layout switching APIs do not expose the View Options dialog/settings | — | None | — | Exclude |

## E. Other high-value documented capabilities

| Candidate | Class | Exact SDK API | Min SDK | Scope | Async | Write gate | Dialog | Return/status | Ambiguity | Risk | Proposed command | Label | Recommendation |
|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|
| Undo | DIRECT | `LrUndo.undo()` | 6.0 | Global Lightroom undo stack | No requirement documented | No | No | No result; `canUndo()` queries availability | The affected operation is hidden global state and may be unrelated to LRBridge | High | `application.history&action=undo` | Undo | Defer v0.7 |
| Redo | DIRECT | `LrUndo.redo()` | 6.0 | Global Lightroom redo stack | No requirement documented | No | No | No result; `canRedo()` queries availability | Same global-state risk | High | `application.history&action=redo` | Redo | Defer v0.7 |
| Undo/redo availability | READ-ONLY | `LrUndo.canUndo()`, `LrUndo.canRedo()` | 6.0 | Global | No | No | No | Boolean | Does not identify the pending operation | Low | `status.application.undo` | Undo Available | Defer v0.7 |
| Crop aspect ratio | DIRECT | `photo:quickDevelopCropAspect(aspectRatio)` | 7.4 | Current/chosen photo | No requirement documented | No gate documented | No | No return documented | Original worked as documented. Camera Crop uses `"asshot"` and may visibly match Original. Fixed ratios and validated custom integers use exact `{ w, h }` tables. LRBridge provides its own modal rather than opening Lightroom's native Enter Custom dialog. Reset Crop remains separate. | Low | `photo.crop_aspect&mode=original|asshot|1x1|2x3|4x5|5x7|16x9|16x10|custom&w=…&h=…` | Original Aspect / Camera Crop / fixed and custom ratios | Expose strict fixed mappings and validated custom dimensions in v0.6 |
| Create snapshot | DIRECT | `photo:createDevelopSnapshot(snapshotName, updateInPlace)` | 3.0 | One photo | No task requirement documented | Required | No | Boolean success | `updateInPlace` changes same-name behavior; needs naming validation | Medium | `develop.snapshot.create&name=…&update=false` | Create Snapshot | Defer v0.7 |
| List snapshots | READ-ONLY | `photo:getDevelopSnapshots()` | 3.2 | One photo | No requirement documented | No | No | Snapshot records/IDs | Requires list/status response architecture | Low | `develop.snapshots.list` | Snapshots | Defer v0.7 |
| Apply snapshot | DIRECT | `photo:applyDevelopSnapshot(id)` | 3.2 | One photo | No requirement documented | No gate documented in entry | No | No return documented | Snapshot IDs are photo-specific and mutable | Medium | `develop.snapshot.apply&id=…` | Apply Snapshot | Defer v0.7 |
| Delete snapshot | DIRECT | `photo:deleteDevelopSnapshot(id)` | 5.0 | One photo | No requirement documented | Write behavior must be guarded | No | No return documented | Destructive and ID is photo-specific | High | `develop.snapshot.delete&id=…` | Delete Snapshot | Defer v0.7 |
| Add keyword | DIRECT | `photo:addKeyword(keyword)` | 1.3-era photo API | One photo; batch by iteration | No task requirement documented | Required | No | No return documented | Requires keyword-object lookup; duplicate names can exist in different hierarchy positions | Medium | `photo.keyword.add&id=…&scope=active|selected` | Add Keyword | Defer v0.7 |
| Remove keyword | DIRECT | `photo:removeKeyword(keyword)` | 1.3-era photo API | One photo; batch by iteration | No task requirement documented | Required | No | No return documented | Requires exact keyword object; batch partial failure | Medium | `photo.keyword.remove&id=…` | Remove Keyword | Defer v0.7 |
| Create keyword | DIRECT | `catalog:createKeyword(name, synonyms, includeOnExport, parent, returnExisting)` | 3.0 | Catalog | No task requirement documented | Required | No | Keyword object | Hierarchy, synonyms, export state, and duplicates require a richer payload | Medium | `keyword.create` | Create Keyword | Defer v0.7 |
| Activate source | DIRECT | `catalog:setActiveSources(sources)` | 3.0 | Application UI/catalog source | No | No | No | No return documented | Requires stable serialization of folders, collections, publish sources, and special identifiers | Medium | `application.source.activate&id=…` | Show Source | Defer v0.7 |
| Extend selection | DIRECT | `LrSelection.extendSelection(direction, amount)` | 14.3 | Filmstrip/Grid selection | No | No | No | No return documented | Follows current ordering | Low | Existing `selection.extend` | Extend Selection | Already implemented |
| Start tether | DIRECT | `LrTether.startTether()` | ND | Global tether session | API entry determines task behavior; no catalog gate | No | May invoke camera/tether UI or device interaction | Limited status through tether queries | Camera/device state and destination configuration | High | `tether.action&action=start` | Start Tether | Defer v0.7 |
| Stop tether | DIRECT | `LrTether.stopTether()` | ND | Global | No catalog gate | No | No | Tether status queries available | Interrupts hardware workflow | High | `tether.action&action=stop` | Stop Tether | Defer v0.7 |
| Trigger tethered capture | DIRECT | `LrTether.triggerCapture()`; `triggerCaptureBlocking()` | ND | Active tether session | Async/blocking variants | No | No | Pending-download count/status APIs | Hardware action; blocking and download lifecycle | High | `tether.capture` | Capture | Defer v0.7 |
| Tether status | READ-ONLY | `isTetherActive()`, `numDownloadsPending()`, `getAdvanceSelectionOnTetheredCapture()` | ND | Global | No | No | No | Boolean/count | Hardware-dependent | Low | `status.tether` | Tether Status | Defer v0.7 |
| Impromptu slideshow | DIRECT | `LrSlideshow.startSlideshow()`, `stopSlideshow()` | ND | Current selection/application | No requirement documented | No | No | No return documented | Current source/selection and slideshow state determine result | Medium | `application.slideshow&action=start|stop` | Start/Stop Slideshow | Defer v0.7 |
| Mask status/list | READ-ONLY | `LrDevelopController.getAllMasks()`, `getSelectedMask()`, `getSelectedMaskTool()` | New masking APIs documented in 15.3 reference | Current photo; Develop active | Some masking APIs require task; method-specific | No for reads | No | Mask/tool tables or IDs | IDs and schema are stateful and photo-specific | Medium | `status.develop.masks` | Mask Status | Defer v0.7 |
| Create/delete/invert masks | DIRECT | `createNewMask`, add/subtract/intersect tools, `deleteMask`, `deleteMaskTool`, `invertMask`, `duplicateAndInvertMask`, related APIs | Method-specific, current 15.3 reference | Current photo; Develop active | Method-specific | Method-specific | No | Mostly no robust result contract | Complex state IDs, selection state, AI processing and destructive operations | High | Structured `develop.mask.*` family | Masking | Defer v0.7 |
| Current process version | READ-ONLY | `LrDevelopController.getProcessVersion()` | 6.0 | Current photo; Develop active | No | No | No | Version string | Module/photo-dependent | Low | `status.develop.process_version` | Process Version | Defer v0.7 |
| HDR state | READ-ONLY/INDIRECT | `photo:getDevelopSettings().HDREditMode` | Field from 13.0 | One photo | Required | No for read | No | Experimental settings value | No stable public enum/toggle contract | Medium | Diagnostic only initially | HDR Edit Mode | Defer v0.7 |
| Read metadata | READ-ONLY | `photo:getRawMetadata(key)`, `getFormattedMetadata(key)`; catalog batch metadata APIs | Base APIs 1.3; fields added by version | Photo(s) | Many metadata calls must be made from task | No | No | Typed/raw or formatted value | Field availability and formatting vary by media/version | Low | `status.photo.metadata&fields=…` | Photo Metadata | Defer v0.7 |
| Write catalog metadata | DIRECT | `photo:setRawMetadata(key, value)` | Base API 1.3; key-specific versions vary | One photo; batch by iteration | No task requirement documented | Required | No | No general result | Only documented writable keys; does not mean “Save Metadata to File” | Medium | `photo.metadata.set` with allow-list | Set Metadata | Defer v0.7 |
| Save metadata to file | ABSENT | None found | — | — | — | — | — | — | Catalog metadata setters are not equivalent to Lightroom’s Save Metadata to File command | — | None | — | Exclude |
| Read metadata from file | ABSENT | None found | — | — | — | — | — | — | No native Read Metadata from File command API | — | None | — | Exclude |
| Publish status | READ-ONLY / provider infrastructure | Published-photo/service object getters; `photo:getRawMetadata("isExported")` | Varies; `isExported` 13.3 | Published photo/service | Often task/provider context | Mutations generally gated | No | State objects/flags | Publish workflow is provider-specific, not a compact controller command | Medium | Status only if later needed | Publish Status | Defer/exclude action |
| History-step navigation | ABSENT | None | — | — | — | — | — | — | Global undo exists, but no public Develop history list or “go to history step” API | — | None | — | Exclude |
| Compare/Survey orchestration | INDIRECT | Application view switching plus `catalog:setSelectedPhotos()` | View APIs 6.0-era; catalog selection API 3.0 | Application UI/selection | No | No | No | No result documented | Correct visible result depends on selection count and compatible Library state | Medium | Existing view command plus selection setup | Compare/Survey | Existing view support; no new compact command |
| Reference View layout | DIRECT layout only | `LrApplicationView.showView("develop_reference_horiz"|"develop_reference_vert")` | Method/value version varies | Application UI | No | No | No | No result documented | Does not set the reference photo | Low | Existing application view commands | Reference View | Existing view support |

## Ranked recommendations

### Best compact v0.6 additions

These use direct documented APIs, have a compact payload, and can be tested without hidden menu state:

1. **Black & White / Color**
   - `photo.treatment&value=grayscale|color`
   - Uses `photo:quickDevelopSetTreatment(value)`.
   - Low implementation and runtime risk.
2. **Crop Aspect**
   - `photo.crop_aspect&mode=original|asshot|1x1|2x3|4x5|5x7|16x9|16x10`
   - `photo.crop_aspect&mode=custom&w=16&h=10`
   - Uses `photo:quickDevelopCropAspect()` with fixed mappings or exact validated integer `{ w, h }` arguments from 1 to 10000.
   - Camera Crop may match Original; Reset Crop remains separate.
3. **Show in Explorer**
   - `photo.reveal&scope=active`
   - Uses the documented photo path plus `LrShell.revealInShell(path)`.
   - Reject offline/missing paths.
4. **Update AI Settings — active photo**
   - `develop.ai.update&scope=active`
   - Uses `photo:updateAISettings()`.
   - Requires async task and catalog write gate.
5. **Delete Empty AI Masks — active photo**
   - `develop.ai.delete_empty_masks&scope=active`
   - Uses `catalog:deleteAllEmptyMasks({ activePhoto })`.
   - Always pass an explicit photo array; never rely on omitted-photo target scope.

### Best v0.7 features

1. Develop preset listing and UUID-based application.
2. Direct export jobs with a validated settings schema, job IDs, progress and rendition results.
3. Copy/paste Develop settings with clipboard error reporting and explicit active/selection scope.
4. Snapshot listing, creation, application and guarded deletion.
5. Virtual-copy creation with returned photo IDs and selection-change reporting.
6. Metadata preset listing and UUID-based application.
7. Keyword and collection listing plus stable object identifiers.
8. Undo/redo with `canUndo`/`canRedo` feedback and clear global-state warnings.
9. Mask-list/status architecture before exposing mask mutations.
10. Tether status and carefully guarded capture controls.
11. Process-version status and explicit version setting.
12. Enhance controls with compatibility and long-running-operation reporting.

### Exclude

- Paste Settings from Previous.
- Native Sync Settings.
- Native Copy Settings dialog.
- Headless Export With Previous Settings.
- User named still-image export preset enumeration/execution.
- Match Total Exposures.
- Native HDR Edit Mode toggle until Adobe documents a stable command/value contract.
- Set as Reference Photo.
- Lock to Second Window.
- General Edit In target selection.
- Photo Merge.
- Generate using Firefly.
- Reset Export Status mutation.
- Add Shortcut Keyword.
- Stack creation/add/remove/expand/collapse for existing photos.
- Email Photos.
- Delete photos from disk.
- View Options.
- Save Metadata to File / Read Metadata from File.
- Develop history-step navigation.
- Any reconstruction advertised as Lightroom’s native Previous or Sync behavior.

## Direct answers to the 20 special questions

1. **Can LRBridge open the native Copy Settings dialog?**
   No. No documented dialog-opening API exists.
2. **Can LRBridge copy settings without opening the dialog?**
   Yes. `photo:copySettings()`.
3. **Can LRBridge programmatically choose exactly which settings are copied?**
   No. The method copies the subset already selected in Lightroom’s UI; there is no subset argument.
4. **Can LRBridge paste settings to the active photo?**
   Yes. `activePhoto:pasteSettings(updateAISettings)` in an async task and catalog write gate.
5. **Can LRBridge paste settings to all selected photos?**
   Yes. Lightroom 15.3 adds `catalog:pasteSettings(photos, updateAISettings)` for an explicit photo array.
6. **Is there a direct SDK equivalent of Paste Settings from Previous?**
   No.
7. **Is there a direct SDK equivalent of Sync Settings?**
   No. Manual get/apply is only an indirect reconstruction.
8. **Can LRBridge open the normal Export dialog?**
   Yes. `photo:openExportDialog()`.
9. **Can LRBridge open Export With Previous Settings?**
   Yes. `photo:openExportWithPreviousDialog()`.
10. **Can Export With Previous Settings run without a dialog?**
    No documented API does that.
11. **Can LRBridge run a user’s named still-image export preset?**
    No. There is no public still-image preset enumeration/execution API.
12. **Can LRBridge apply a named Develop preset by UUID?**
    Yes. Resolve it with `LrApplication.developPresetByUuid(uuid)` and apply it with the photo or catalog preset API. UUID, not display name, should be authoritative.
13. **Can LRBridge toggle HDR Edit Mode?**
    Not through a direct documented toggle API. Experimental Develop settings expose `HDREditMode`, but that is an indirect and insufficiently documented mechanism.
14. **Can LRBridge convert a photo to Black & White through a documented API?**
    Yes. `photo:quickDevelopSetTreatment("grayscale")`; `"color"` reverses the treatment.
15. **Can LRBridge run Match Total Exposures?**
    No documented API was found.
16. **Can LRBridge Update AI Settings?**
    Yes. `photo:updateAISettings()` or `catalog:updateAISettings(photos)`.
17. **Can LRBridge Delete AI Empty Masks?**
    Yes. `catalog:deleteAllEmptyMasks(photos)`.
18. **Can LRBridge reveal a photo in Windows Explorer?**
    Yes. Obtain its documented path and call `LrShell.revealInShell(path)`.
19. **Can LRBridge add selected photos to Quick Collection?**
    Not reliably through a dedicated Quick Collection mutation API. `addOrRemoveFromTargetCollection(true)` affects whichever collection Lightroom currently designates as the target; that target is not guaranteed to be Quick Collection.
20. **Can LRBridge create, expand, collapse, or remove stacks?**
    No for existing catalog photos. The SDK exposes stack metadata for querying, but no documented stack-management methods. The `stackWithPhoto` option while adding a new catalog photo is not equivalent.
