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
| Crop angle | DIRECT | `LrDevelopController.getRange/getValue/setValue/resetToDefault/startTracking("straightenAngle")` | 6.0 | Current photo in Develop | Tracking automatically ends after another parameter or two seconds | No gate documented | No | Value/range reads; setters have no result contract | Runtime range is verified at execution; Web Controller feedback is authoritative Lightroom state. Range, numeric input, visible behavior, and straightening-only reset passed controlled runtime verification. | Low | `photo.crop_angle.set&value=…`, `photo.crop_angle.reset` | Crop Angle / Reset Angle | Implemented and runtime verified in v0.6 |
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
## Lens Blur runtime verification

Lightroom Classic 15.3 documents the Develop Controller parameters `LensBlurActive`, `LensBlurAmount`, `LensBlurCatEye`, `LensBlurHighlightsBoost`, and `LensBlurFocalRange`, together with `getSelectedLensBlurBokeh()`, `setLensBlurBokeh()`, and `toggleLensBlurDepthVisualization()`. A controlled read-only runtime diagnostic examined the five parameters with `getValue()`, the four scalar-looking parameters with `getRange()`, the dedicated Bokeh getter, and the documented `photo:getDevelopSettings()` members `LensBlur` and `DepthMapInfo`.

The tested photo was on Process Version 6 with Lens Blur manually enabled and recognizable values visible in Lightroom. Nevertheless, all five `getValue()` calls returned nil and `getSelectedLensBlurBokeh()` returned nil. `getRange()` returned `-100..100` for `LensBlurActive` and `0..100` for `LensBlurAmount`, `LensBlurCatEye`, and `LensBlurHighlightsBoost`. These ranges prove only that Lightroom recognizes the parameter identifiers; a successful range read is not evidence that current live state is readable or safely writable. `photo:getDevelopSettings().LensBlur` existed as an empty Lua table with zero top-level keys, while `photo:getDevelopSettings().DepthMapInfo` was nil.

An earlier diagnostic timeout was caused by stale Lightroom-loaded Lua emitting the old result shape against the newer server validator. It was not a GET-length failure. After Lightroom loaded the current diagnostic, request 116 completed in approximately 43 ms: the JSON payload was 1,370 bytes, its URL-encoded form was 2,128 bytes, and the server returned HTTP 200 with an accepted result.

**Conclusion:** Lightroom Classic 15.3 exposes no authoritative usable read contract for the visible Lens Blur state through either tested documented API source. Lens Blur controls are unsupported and deferred; LRBridge must not implement them from the documented ranges alone.

# Color Grading Phase 1 (runtime untested)

Documented identifiers: `SplitToningShadowHue`, `SplitToningShadowSaturation`, `ColorGradeShadowLum`, `ColorGradeMidtoneHue`, `ColorGradeMidtoneSat`, `ColorGradeMidtoneLum`, `SplitToningHighlightHue`, `SplitToningHighlightSaturation`, `ColorGradeHighlightLum`, `ColorGradeGlobalHue`, `ColorGradeGlobalSat`, `ColorGradeGlobalLum`, `ColorGradeBlending`, and `SplitToningBalance`.

The implementation uses `getRange`, `getValue`, `startTracking`, `setValue`, `resetToDefault`, `getActiveColorGradingView`, and `setActiveColorGradingView`. Runtime ranges and values are mandatory; nil is explicitly unavailable. Develop and an active photo are required, and view selection requires Process Version 3+. A wheel request is one LRBridge command but two consecutive SDK `setValue` calls. Runtime totals remain Tested: 88, PASS: 87, FAIL: 1, UNVERIFIED: 0. No Color Grading command is marked PASS. Graphical wheels are Phase 2.

## Constrain Crop runtime verification

On a Process Version 6 photo in Develop, request 2 read `CropConstrainToWarp` as Lua number `0`; `getRange()` returned numeric `-100..100`. The specific `photo:getDevelopSettings().CropConstrainToWarp` member existed and was numeric `0`. The diagnostic recognized only the proven numeric `0/1` representation, wrote the inverse numeric `1`, and `getValue()` immediately read back numeric `1`. The Develop-settings member still reported `0` during that brief write, so it is not an immediate authoritative feedback source.

The diagnostic restored the exact original numeric `0`. Both `getValue()` and the specific Develop-settings member then read numeric `0`, and the server recorded `restored_successfully`. The result was accepted over HTTP 200 and no other Develop parameter was accessed or changed.

**Conclusion:** `CropConstrainToWarp` uses LRBridge's authoritative switch architecture with `getValue()` as feedback and an explicit numeric `0/1` adapter. The broad `-100..100` range is not the Boolean contract and is never used. The permanent Web Controller switch is placed after the Transform sliders and before Effects in Lightroom order.

## Enhance panel state runtime verification

Read-only request 3 called `LrDevelopController.getEnhancePanelState()` in a dedicated asynchronous task for a Process Version 6 photo in Develop. It completed successfully in less than 1 ms as measured by the Lightroom task, and the sanitized result was accepted by the server over HTTP 200.

The exact returned top-level schema contained all 11 documented fields: Boolean `denoiseState`, `rawDetailsState`, `superResState`, `denoiseEnabled`, `rawDetailsEnabled`, `superResEnabled`, and `enhanceNeedsUpdate`; numeric `denoiseAmount`; and string `denoiseInfoText`, `rawDetailsInfoText`, and `superResInfoText`. For the selected photo, all three state values were false, all three enabled values were true, `denoiseAmount` was 50, and `enhanceNeedsUpdate` was false. The three short informational strings described their respective operations and contained no sensitive data.

**Conclusion:** the selected photo is eligible for Denoise, Raw Details, and Super Resolution according to the enabled flags, and is suitable for a later separately authorized controlled Enhance experiment. No Enhance mutation or processing operation was invoked during this verification.

## Enhance controlled Denoise lifecycle verification

The Lightroom Classic 15.3 SDK documents `setEnhance(paramName, value, denoiseAmount)` as requiring an asynchronous `LrTasks` task while Develop is active. It accepts `denoise`, `rawDetails`, or `superRes`, an explicit Boolean state, and an optional Denoise amount from 1 through 100 (default 50). No return value, processing-status value, callback, confirmation/apply step, cancellation function, or completion function is documented. `changeDenoiseAmount(amount)` changes the amount while Develop is active but does not document starting processing. `toggleEnhance(...)` offers an optional post-toggle callback but is explicitly deprecated in 15.3.

After a harmless unavailable attempt in Library made no Enhance call, LRBridge restored Develop and reduced the selection to the current target. The controlled operation captured one selected photo, four catalog photos, an unchanged target reference, and initial states `denoiseState=false`, `rawDetailsState=false`, `superResState=false`, and `enhanceNeedsUpdate=false`. It then made exactly one processing call: `LrDevelopController.setEnhance("denoise", true, 50)`. Raw Details and Super Resolution were not called because their verified initial states already matched the requested false state.

The SDK call returned without an error after 4,611 ms. During the bounded 185,574 ms diagnostic window, the catalog count remained four and the target reference did not change. The original photo's Develop-settings signature changed, `denoiseState` became true, and `enhanceNeedsUpdate` remained false. A final read-only panel snapshot reported `denoiseAmount=50`, `denoiseState=true`, `rawDetailsState=true` (automatically applied by Denoise), `superResState=false`, `denoiseEnabled=true`, `rawDetailsEnabled=false`, `superResEnabled=false`, and `enhanceNeedsUpdate=false`. No new catalog photo or separate generated-result reference existed to test independently.

**Conclusion:** Lightroom Classic 15.3 applies this Denoise operation to the current catalog photo rather than creating/selecting a new catalog photo. Acceptance is reliably observable as a successful protected call, and the resulting state is reliably readable without names, paths, UUIDs, or metadata. The SDK does not expose a documented processing or completion signal; elapsed call return plus the authoritative panel transition can support `accepted`, `processing/unknown`, `completed`, `failed`, and `unavailable` UI states, but a production UI must label completion conservatively and retain a bounded local timeout without attempting cancellation. The result remains eligible for Denoise adjustment, while Raw Details and Super Resolution are unavailable in the resulting Denoise-selected state.

### Controlled Denoise Off verification

With the Denoised test RAW selected in Develop, the sanitized before state was `denoiseState=true`, `denoiseEnabled=true`, `denoiseAmount=30`, `rawDetailsState=true`, `rawDetailsEnabled=false`, `superResState=false`, `superResEnabled=false`, and `enhanceNeedsUpdate=false`. The catalog contained four photos. LRBridge then made exactly one asynchronous call: `LrDevelopController.setEnhance("denoise", false, 30)`.

The protected call returned successfully and authoritative polling reported `denoiseState=false`. The amount remained available at 30. Raw Details changed to `rawDetailsState=false` and `rawDetailsEnabled=true`; Super Resolution remained off and became enabled. `enhanceNeedsUpdate` remained false, the internally compared target-photo reference was unchanged, and the catalog count remained four. `denoiseEnabled` remained true, so the same photo is eligible for a later explicit On operation. Denoise was not automatically re-enabled.

**Conclusion:** Lightroom Classic 15.3 reliably supports Denoise Off through the explicit Boolean `setEnhance` API. Both On and Off production operations can require a successful protected call plus an authoritative `denoiseState` match to the requested Boolean before reporting applied.

### Controlled Raw Details lifecycle verification

The Lightroom Classic 15.3 SDK documents `LrDevelopController.setEnhance(paramName, value, denoiseAmount)` as requiring an asynchronous `LrTasks` task while Develop is active. `rawDetails` is an allowed parameter. The third argument is optional and documented as the Denoise amount, so neither controlled Raw Details call supplied it. The SDK documents no return value, progress value, callback, cancellation API, or completion API for `setEnhance`.

The sanitized initial state contained one target photo in Develop and four catalog photos: `denoiseState=false`, `denoiseEnabled=true`, `denoiseAmount=50`, `rawDetailsState=false`, `rawDetailsEnabled=true`, `superResState=false`, `superResEnabled=true`, and `enhanceNeedsUpdate=false`. Exactly one asynchronous `LrDevelopController.setEnhance("rawDetails", true)` call completed successfully in 1,450 ms and returned Lua `nil`. The first authoritative read after return already reported `rawDetailsState=true` (0 ms observed confirmation lag), with Raw Details still enabled. Denoise and Super Resolution remained off and enabled, `enhanceNeedsUpdate` remained false, the target reference was unchanged, and the catalog count remained four. No new photo was created or selected.

With that authoritative On state as the next sanitized before state, exactly one asynchronous `LrDevelopController.setEnhance("rawDetails", false)` call completed successfully in 17 ms and returned Lua `nil`. The first authoritative read after return reported `rawDetailsState=false` (0 ms observed confirmation lag) and `rawDetailsEnabled=true`. Denoise and Super Resolution remained off and enabled, `enhanceNeedsUpdate` remained false, the target reference and four-photo catalog were unchanged, and the photo was again eligible for Raw Details On. Raw Details was not turned on again.

**Conclusion:** Lightroom Classic 15.3 reliably supports independent Raw Details On and Off in place. Production may report applied only after a successful protected call plus a later authoritative `rawDetailsState` match; a bounded missing confirmation is uncertain rather than failed. Denoise ownership remains authoritative when Denoise forces Raw Details On and disables its control.

### Controlled Super Resolution On lifecycle verification

**SDK-only facts:** Lightroom Classic 15.3 spells the parameter `"superRes"`. `LrDevelopController.setEnhance(paramName, value, denoiseAmount)` must run inside an asynchronous `LrTasks` task while Develop is active. The optional third argument is documented specifically as the Denoise amount, so it is not relevant to Super Resolution. The SDK documents no return value, progress value, callback, cancellation API, completion API, generated-file behavior, or catalog-photo behavior for `setEnhance`.

**Controlled runtime observations:** The authorized probe began in Develop with exactly one selected target and four catalog photos. The sanitized Enhance state was `denoiseState=false`, `denoiseEnabled=true`, `denoiseAmount=50`, `rawDetailsState=false`, `rawDetailsEnabled=true`, `superResState=false`, `superResEnabled=true`, and `enhanceNeedsUpdate=false`. Exactly one protected asynchronous `LrDevelopController.setEnhance("superRes", true)` call was made, without a third argument. The worker was accepted, the protected call succeeded, blocked for 3,641 ms, and returned Lua `nil`. The first authoritative post-return panel state was available when the call returned.

After return and a five-poll catalog-stability window, the catalog still contained four photos and no new catalog object had appeared. The original photo remained present, the target-photo reference was unchanged, the selected-photo set remained the same single object, and Develop remained active. The resulting authoritative state was `denoiseState=false`, `denoiseEnabled=false`, `rawDetailsState=true`, `rawDetailsEnabled=false`, `superResState=true`, `superResEnabled=true`, and `enhanceNeedsUpdate=false`. Thus Super Resolution applied in place on this test photo, automatically enabled Raw Details, and made Denoise and independent Raw Details unavailable while leaving its own authoritative control enabled.

**On-probe recommendation:** This was initially Outcome 3, a clearly reversible candidate: the operation was in-place, catalog and selection were unchanged, and authoritative `superResState=true` coexisted with `superResEnabled=true`. A separately authorized Off probe was therefore required before production support.

**Controlled Off runtime observations:** After reloading the cleaned plugin, the same single selected target in Develop authoritatively reported `denoiseState=false`, `denoiseEnabled=false`, `rawDetailsState=true`, `rawDetailsEnabled=false`, `superResState=true`, `superResEnabled=true`, and `enhanceNeedsUpdate=false`. Exactly one protected asynchronous `LrDevelopController.setEnhance("superRes", false)` call was made without a third argument. The worker was accepted, the protected call succeeded in 21 ms, returned Lua `nil`, and the first post-return authoritative read already confirmed `superResState=false` (0 ms observed confirmation lag).

Lightroom restored the dependencies itself: `rawDetailsState=false`, `rawDetailsEnabled=true`, `denoiseState=false`, `denoiseEnabled=true`, `superResEnabled=true`, and `enhanceNeedsUpdate=false`. No Raw Details, Denoise, or amount call was made. Catalog count remained four with zero added or removed catalog objects. The original target remained present and selected, the target reference and one-photo selection were unchanged, and Develop remained active. The photo was again authoritatively eligible for Super Resolution On, but it was not turned On again.

**Final conclusion:** Lightroom Classic 15.3 Super Resolution is a reversible in-place Boolean operation for the tested RAW. Production uses an Off/On switch, exact `setEnhance("superRes", enabled)` calls in an asynchronous task, shared Enhance mutation locking, and authoritative `superResState` confirmation. A successful call without bounded confirmation is uncertain; a real SDK/precondition error is failed.

### Controlled Denoise amount-change verification

The Lightroom 15.3 documentation defines `changeDenoiseAmount(amount)` for values 1 through 100 while Develop is active, but documents no return value, asynchronous-task requirement, completion callback, or rapid-update behavior. A controlled probe used an already-Denoised RAW with authoritative amount 42 and made exactly one asynchronous `LrDevelopController.changeDenoiseAmount(35)` call. The protected call completed without error in approximately 5 ms and returned Lua `nil`. The first authoritative panel read after return already reported amount 35, so no additional confirmation sleep was required.

Throughout the probe, `denoiseState=true`, `denoiseEnabled=true`, `rawDetailsState=true`, `superResState=false`, and `enhanceNeedsUpdate=false` remained unchanged. The internally compared target-photo reference also remained unchanged. No On/Off Enhance call was made.

**Conclusion:** amount-only editing while Denoise is On is supported. Production updates use `changeDenoiseAmount`, a 250 ms UI debounce, a single in-flight amount lock, and bounded authoritative confirmation. The fast synchronous-looking runtime transition does not establish that unconstrained rapid calls are safe, so debouncing and serialization remain required.

## Point Color structured API verification

### Documented Lightroom Classic 15.3 contract

Global Point Color is documented through `selectTool("point_color")`, `getValue("PointColors")`, `getSelectedPointColorSwatchIndex(false)`, `selectPointColorSwatch(index, false)`, `addPointColorSwatch(swatch, false)`, `updateSelectedPointColorSwatch(swatch, false)`, `deletePointColorSwatch(deleteAll, index, false)`, and `togglePointColorRangeVisualization(false)`. The selection range is integer 1 through 8. `false` targets global Point Color; `true` targets local Point Color in Masking. Selection, add, update, and delete require Develop and Process Version 3 or newer. `selectTool` and `getSelectedTool` require Develop. The Point Color methods do not document an `LrTasks.startAsyncTask` requirement.

The documented scalar ranges and add defaults are: `SrcHue` 0..6; `SrcSat` and `SrcLum` 0..1; `HueShift`, `SatScale`, `LumScale`, and `Variance` -1..1 with default 0; and `RangeAmount` 0..1 with default 0.5. `HueRange`, `SatRange`, and `LumRange` each contain numeric `LowerNone`, `LowerFull`, `UpperFull`, and `UpperNone` values in 0..1. Add returns `(boolean, string)`, selecting an identical existing swatch when applicable. Update returns `(boolean, string)`. Delete returns Boolean false for an out-of-bounds index. No return value is documented for selection or visualization toggle. No authoritative Range Preview state getter is documented.

### Read-only runtime schema

On a Process Version 6 Color-treatment photo in Develop, zero swatches produced `selectedIndex=0`. After one sample was added with Lightroom's dropper, `getValue("PointColors")` returned one swatch and `getSelectedPointColorSwatchIndex(false)` returned 1. Lightroom reported `getSelectedTool()` as `"loupe"` while retaining selected Point Color index 1.

The live swatch contained exactly the 11 documented top-level keys: numeric `SrcHue`, `SrcSat`, `SrcLum`, `HueShift`, `SatScale`, `LumScale`, `Variance`, and `RangeAmount`, plus table-valued `HueRange`, `SatRange`, and `LumRange`. Each nested range contained exactly the four documented numeric keys. No extra runtime keys or unsupported values were present. Initial source values were `SrcHue=0.23149`, `SrcSat=0.05301`, and `SrcLum=0.2597`; shifts and Variance were 0; RangeAmount was 0.5.

### Visualize Range authoritative-state investigation

The complete Lightroom Classic 15.3 generated API reference documents `togglePointColorRangeVisualization(isForMasking)` only as toggling the Point Color panel checkbox. It documents no return value, getter, callback, property, or boolean state. The complete documented `getValue(param)` parameter list includes global `PointColors` and local `local_PointColors`, but no range-visualization parameter. The documented Point Color table contains only the three source coordinates, five adjustment scalars, and three nested range tables. `getSelectedPointColorSwatchIndex(false)` reports only selection, `getSelectedTool()` reports tool identity such as `point_color`, and `addAdjustmentChangeObserver` supplies only a generic change notification without a changed property or value. No matching getter or alternate visualization-state symbol exists in the supplied SDK samples or searchable local SDK files. Therefore no unsupported `getValue` name was guessed or brute-forced.

A read-only runtime comparison used one selected global test swatch in Develop. The OFF baseline, direct-Lightroom ON state, and restored direct-Lightroom OFF state were identical across `PointColors`, swatch count 1, selected index 1, selection-transient false, all five adjustment scalars, all 12 detailed-range boundaries, all three source-derived markers, active module, selected photo, context counter, and Develop counter. Only the normal heartbeat timestamp advanced. Direct Lightroom checkbox changes therefore produce no documented readable state delta and no adjustment-change evidence in LRBridge's existing production paths.

A temporary controlled wrapper captured all Lua return values from the documented toggle with `pcall` and did not read or write `PointColors`. On a visually confirmed OFF-to-ON transition, the call completed successfully with exactly zero Lua return values. On a visually confirmed ON-to-OFF transition, Lightroom turned visualization off but the SDK call did not return to the wrapper or raise a catchable Lua error, while the independent LRBridge heartbeat continued. Repeated cache-safe and URL-encoded diagnostics reproduced the asymmetric behavior. The toggle return is therefore neither a resulting-state boolean nor a reliable completion signal.

**Conclusion:** authoritative Visualize Range feedback is unavailable. LRBridge must not expose `rangeVisualization`, infer state from toggle parity, or retain a guessed On/Off value. Direct Lightroom interaction can change the checkbox in the same photo/tool context without any readable signal, so even deterministic reset behavior on a later context transition could not make same-context feedback authoritative. Production retains the honest momentary **Toggle Visualize Range** action and its existing `point_color.range_visualization.toggle` command, with no independent timer or fabricated state. All temporary wrapper and diagnostic routes were removed after measurement.

### Controlled update/restore result

A complete recursive copy of the selected live swatch changed only `HueShift` from 0 to 0.05 and was passed to `updateSelectedPointColorSwatch(completeSwatch, false)`. The call returned true. Authoritative readback kept one swatch at selected index 1, reported HueShift 0.05, and preserved all three nested range tables. The exact full-table comparison nevertheless failed. Immediate restoration with the exact original complete swatch also returned true and restored HueShift to 0, sample count to one, selected index to 1, and all nested ranges exactly.

The authoritative restored swatch did not equal the original: Lightroom normalized source values from `SrcHue=0.23149`, `SrcSat=0.05301`, and `SrcLum=0.2597` to `0.23`, `0.05`, and `0.26`. Thus even a complete-table scalar update altered source fields that the caller did not modify. Update/restoration is not lossless under the required preservation contract.

**Conclusion at this probe stage:** production Point Color editing was blocked pending further review. The browser cannot sample Lightroom's image canvas. Range Preview can only be a momentary toggle because the SDK exposes no state getter. All temporary probe commands, routes, state caches, imports, and Lua diagnostic files were removed.

### Native Lightroom UI source-coordinate comparison

A fresh Point Color sample that had never been passed to `updateSelectedPointColorSwatch()` was read without moving any Point Color control (STATE A). It contained `SrcHue=1.094715`, `SrcSat=0.453009`, `SrcLum=0.048692`, `HueShift=0`, `SatScale=0`, `LumScale=0`, `Variance=0`, and `RangeAmount=0.5`. Its Hue range was `LowerNone=0`, `LowerFull=0.33000001311302`, `UpperFull=0.6700000166893`, `UpperNone=1`; Saturation range was `0`, `0.27000001072884`, `0.62999999523163`, `1`; and Luminance range was `0`, `0.059999998658895`, `0.41999998688698`, `0.97000002861023` in the same field order.

The user then changed Hue Shift solely through Lightroom's native Point Color UI. STATE B reported `HueShift=0.23000000417233`. Every other scalar, all three source coordinates at their original six-digit precision, sample count 1, selected index 1, and all 12 nested range values remained exactly equal to STATE A. After the user returned native Hue Shift to exactly zero, STATE C matched STATE A exactly.

**Safety finding:** native Lightroom UI editing does not normalize `SrcHue`, `SrcSat`, or `SrcLum`. The earlier SDK full-table update normalization to two decimal places is therefore not normal Point Color canonicalization and is not semantically equivalent to native behavior. At this investigation stage production remained blocked while omission behavior was tested separately.

### Omitted-source-fields update probe

The 15.3 update documentation says the submitted table “should have” all 11 listed fields and directs callers to retrieve, modify, and resubmit the selected swatch. Unlike the add API, it does not mark fields optional or specify defaults. It does not explicitly say every field is required, explicitly prohibit omission, or define retained/default behavior for omitted fields. Runtime verification was therefore required.

The authoritative fresh default STATE A contained one swatch at selected index 1: `SrcHue=4.067554`, `SrcSat=0.092361`, `SrcLum=0.331798`, `HueShift=0`, `SatScale=0`, `LumScale=0`, `Variance=0`, and `RangeAmount=0.5`. Hue range was `LowerNone=0`, `LowerFull=0.33000001311302`, `UpperFull=0.6700000166893`, `UpperNone=1`; Saturation range was `0`, `0`, `0.27000001072884`, `0.81999999284744`; and Luminance range was `0`, `0.43000000715256`, `0.79000002145767`, `1` in the same field order.

The newly constructed candidate contained exactly `HueShift`, `SatScale`, `LumScale`, `Variance`, `RangeAmount`, `HueRange`, `SatRange`, and `LumRange`. All nested ranges were deep copies of STATE A and HueShift alone was changed to 0.05. `SrcHue`, `SrcSat`, and `SrcLum` were absent. `updateSelectedPointColorSwatch(candidate, false)` completed normally but returned false with sanitized SDK error text `SrcHue should be a number b/w 0 and 6`.

Authoritative STATE B matched STATE A exactly across all 11 fields, every numeric value, all nested tables, sample count 1, and selected index 1. Because the update was rejected without changing state, no restore call was needed or attempted.

**Classification: REJECTED.** The SDK requires at least `SrcHue` and refuses this complete non-source table shape without mutation. Omission of all three source coordinates is not a safe update pattern.

### Production selected-swatch slider architecture

Following explicit product review, selected-swatch Point Color slider control is implemented with the source-coordinate normalization retained as a documented Adobe SDK limitation. LRBridge reads `PointColors` and the global selected index authoritatively, exposes only `available`, `selectedIndex`, `HueShift`, `SatScale`, `LumScale`, `Variance`, and `RangeAmount`, and never exposes source coordinates or nested ranges to the browser.

Before every scalar write LRBridge rereads the current complete selected swatch, deep-copies every field and nested table, changes exactly one allowlisted adjustment scalar, and calls `updateSelectedPointColorSwatch(completeSwatch, false)`. Source coordinates and nested ranges are copied verbatim from the immediately current Lightroom table; LRBridge does not intentionally alter them. Adobe rejects updates with omitted source fields and may normalize source-coordinate precision when the required complete swatch is submitted. This is an Adobe Point Color update API side effect, not an LRBridge-generated source edit.

Production scope is the currently selected global swatch only: Hue Shift, Saturation Shift, Luminance Shift, Variance, Range, and the momentary `togglePointColorRangeVisualization(false)` action. Sample creation, deletion, selection controls, source/range editing, browser sampling, and local/masked Point Color remain unsupported. Writes are globally serialized, same-field pending values coalesce, context and selected-index guards discard stale edits, and authoritative feedback follows direct Lightroom changes through the existing polling worker and Develop controller cadence.

### Production detailed range controls

Production selected-swatch control now also exposes the documented `HueRange`, `SatRange`, and `LumRange` tables. Each public nested range is strictly limited to numeric `LowerNone`, `LowerFull`, `UpperFull`, and `UpperNone` fields in normalized SDK range 0..1, ordered `LowerNone <= LowerFull <= UpperFull <= UpperNone`. The Web Controller presents each as one compact four-handle control in 0..100 integer units, with pointer and keyboard operation and without fabricated per-range resets because initial boundaries are sample-dependent.

The dedicated `point_color.range.set` command modifies exactly one boundary. It participates in the same globally serialized Point Color pipeline as scalar writes; only pending writes with the same selected index, context generation, range, and boundary coalesce. Lua rereads the authoritative PointColors table and selected index, deep-copies the complete live swatch, validates the current and proposed ordering, changes `completeSwatch[range][boundary]`, submits the complete swatch, and immediately republishes all scalar and nested range state. This lets normal RangeAmount changes and direct Lightroom range edits reconcile every handle authoritatively. The documented Adobe source-coordinate normalization side effect still applies to these required complete-swatch updates.

### Native sample marker and range translation probe

The SDK identifies `SrcHue` (0..6), `SrcSat` (0..1), and `SrcLum` (0..1) as the sampled source color coordinates. It defines `LowerNone` and `UpperNone` as the outer left/right limits and `LowerFull` and `UpperFull` as the inner left/right limits. Adobe does not document the detailed-range sample-marker coordinate transform or center/group-drag persistence behavior, so both were measured read-only in Lightroom Classic 15.3.

For an untouched selected swatch with `SrcHue=0.92`, `SrcSat=0.49`, and `SrcLum=0.15`, native Hue center drag moved Hue boundaries from `0 / 0.41999998688698 / 0.5799999833107 / 1` to `0.03999999910593 / 0.46000000834465 / 0.62000000476837 / 1`. Native Saturation center drag moved its boundaries from `0 / 0.37000000476837 / 0.54000002145767 / 1` to `0.059999998658895 / 0.43000000715256 / 0.60000002384186 / 1`. An isolated Luminance center drag moved `0.019999999552965 / 0.37000000476837 / 0.54000002145767 / 1` to `0.03999999910593 / 0.38999998569489 / 0.56000000238419 / 1`. In every valid measurement all three `Src*` fields and both unrelated ranges remained exact. The intended delta was applied to every boundary; a boundary already at 0 or 1 remained clipped, shortening only that outer feather. Undo restored the authoritative baseline. Readings taken while unrelated Lightroom controls were also moved were explicitly excluded.

The marker mapping is deterministic. Hue is a source-relative cyclic domain, so `HueRange` uses marker `0.5` regardless of `SrcHue`. `SatRange` uses `SrcSat` directly. `LumRange` uses the standard linear-to-display transfer: `12.92 * SrcLum` at or below `0.0031308`, otherwise `1.055 * SrcLum^(1/2.4) - 0.055`. Independent fresh samples corroborated the Luminance transform: `SrcLum=0.048692` maps to approximately `0.2446`, centered in the native full range `0.06..0.42`, and `SrcLum=0.331798` maps to approximately `0.6111`, centered in `0.43..0.79`. Lightroom constrains `LowerFull <= marker <= UpperFull`.

Production now renders outer feather triangles, a bordered full-range box with independently draggable edges, and a small read-only source marker. Edge writes retain `point_color.range.set` and enforce the marker constraint. Full-box drag computes one absolute translated four-boundary target: the delta is limited so neither inner edge crosses the marker, while each outer boundary is clipped independently to 0..1 like Lightroom. It sends one `point_color.range.translate` operation, never four boundary writes. The command shares global Point Color serialization, coalesces only the same selected-index/context/range translation, rereads and deep-copies the complete live swatch, replaces only the targeted nested range, and republishes authoritative feedback. Source fields are never intentionally changed by translation; Adobe's required-full-swatch normalization limitation remains applicable.

### Marker availability and precision correction

The first marker-aware production reader incorrectly used `LowerFull <= derivedMarker <= UpperFull` as part of selected-swatch existence validation. A fractional disagreement caused `readState()` to publish `available=false, selectedIndex=0`, replacing valid controls with the no-sample message even while Lightroom retained the selected Point Color. This was a category error: source-derived marker agreement is an interaction concern, while existence is authoritative `PointColors` plus selected index and structurally valid scalar/range data.

Production now gates existence only on Develop/PV eligibility, valid `PointColors`, selected index, the five adjustment scalars, and structurally ordered nested ranges. Marker calculation never turns a valid selected swatch into no sample. A transient SDK/malformed read publishes no replacement result, preserving the server's last state within the same context; context changes still clear state through the existing context architecture. A genuine index zero remains `available=true, selectedIndex=0`, and leaving eligible Develop/PV remains unavailable.

Each raw marker is converted to an effective interaction marker by clamping it to the authoritative current `LowerFull..UpperFull` interval. This accommodates Adobe's source-coordinate normalization and the inferred, undocumented Luminance display transform without rewriting source or range data. If a marker cannot be calculated, the selected swatch remains fully present while marker-dependent inner-edge/group interactions are disabled; specific writes are rejected cleanly and authoritative state is republished.

Marker rendering retains exact precision: `markerUiExact = markerSdkExact * 100`, with no scalar-style rounding. Integer inner edges use `floor(markerUiExact + 1e-8)` as the maximum LowerFull tick and `ceil(markerUiExact - 1e-8)` as the minimum UpperFull tick. The epsilon addresses floating representation only. Server and Lua compare proposed ranges to the exact effective SDK marker with a correspondingly small tolerance, so the visible dot and legal integer ticks cannot disagree.

The momentary `point_color.tool.select` action calls exactly `LrDevelopController.selectTool("point_color")` in Develop. Routes are `/point-color/tool/select` and `/api/point-color/tool/select`; the always-visible Web Controller button is **Select Color Picker**. It activates Lightroom's global Point Color tool but neither creates a sample nor modifies PointColors. Sample existence continues to use PointColors and selected index because runtime previously showed a retained selected swatch while `getSelectedTool()` reported `loupe`.

### Transient selected-index correction

A subsequent three-minute live picker/edit stress monitor observed `available:selectedIndex` transition `True:1 -> True:0 -> True:1`; the zero-index interval lasted approximately 6.4 seconds while Lightroom visibly retained its Point Color panel and data. The Lua reader's former `index <= 0` branch published the same no-selected state used for an empty PointColors table, so the browser incorrectly destroyed its controls and displayed the no-sample message. Marker validity was no longer involved in this second failure.

Production now counts actual numeric table-valued PointColors entries by iterating keys rather than relying on Lua's length operator, and publishes strict `swatchCount` independently of `selectedIndex`. `swatchCount=0, selectedIndex=0` is genuine no-sample state and clears retained display data. `swatchCount>0, selectedIndex=0` is `selectionTransient=true`, not sample deletion.

The server Point Color state object retains the last complete authoritative selected-swatch snapshot only within its current context counter. During an index-zero transition it returns the retained scalars, ranges, and effective markers with `displaySelectedIndex`, keeping the controller visually stable. If no selected snapshot has yet been observed, it reports a narrow selection-in-progress state without fabricated controls. Context counter changes, leaving the eligible context, and authoritative zero swatches clear retention, preventing cross-photo display leakage.

All scalar, individual boundary, and full-range translation admission is blocked while `selectionTransient=true` or authoritative `selectedIndex=0`; pending browser operations are invalidated by the selection generation change, server routes reject mutation, and Lua still verifies the selected index immediately before every write. The picker action remains enabled, and Visualize Range remains an independent momentary action. When a valid selected index returns, authoritative values replace the retained snapshot and editing resumes.

### Degenerate detailed-range failure and safety threshold

Later direct observation corrected the interpretation of the apparent disappearance. Lightroom's Point Color panel can remain visually populated after its authoritative `PointColors` table has already become empty; focusing Lightroom forces the panel to repaint and reveal the same broken state LRBridge reported earlier. A subsequent monitor that included independent swatch count repeatedly observed `available=true, swatchCount=0, selectedIndex=0`, not a populated table with a transient zero index. LRBridge therefore continues to report genuine empty `PointColors` immediately. Same-context retention applies only to the distinct case `swatchCount>0, selectedIndex=0` and never conceals authoritative sample loss.

The failure was isolated with single SDK writes followed by authoritative readback. Hue remained valid at an inner width of approximately `0.00999999046326` (`LowerFull=0.49000000953674`, `UpperFull=0.5`) and Saturation remained valid at approximately `0.01000001311302` (`LowerFull=0.41999998688698`, `UpperFull=0.43`). Setting either to exact zero width returned SDK success and initially retained count/index 1, but approximately three seconds later `PointColors` became empty and the selected index became 0. For Luminance, `0.70..0.71` was safe around exact marker `0.70836965034447`. A narrower positive interval `0.70836965034447..0.70999997854233` (width approximately `0.00163032819786`) initially read back successfully, then emptied `PointColors` before the intended zero-width follow-up could be admitted. Thus the last tested safe width for all three dimensions is one Web Controller unit (`0.01` SDK), while the first observed breaking widths are zero for Hue/Saturation and approximately `0.00163` for Luminance.

Native Lightroom comparison showed that dragging Hue's two inner controls together can also make authoritative `PointColors` empty while the panel remains stale until repaint. Because state disappears, exact native breaking boundaries cannot be recovered after the event; importantly, native UI does not impose a reliably safe minimum. The failure is therefore reachable through both Lightroom's native control path and a successful `updateSelectedPointColorSwatch` path, rather than being an LRBridge false-state report or an SDK-only behavior.

Production uses `POINT_COLOR_MIN_FULL_RANGE_UI=1`, corresponding to normalized minimum width `0.01`. The Web Controller stops either inner edge before it reduces the interval below one integer UI unit and never moves the opposite edge. Server admission rejects narrower individual-edge and translation targets. Lua repeats the check immediately before the Adobe call and republishes authoritative state without calling `updateSelectedPointColorSwatch` on rejection. A `2e-8` normalized comparison allowance covers the measured float32 readback error at exact `0.01`; it is not an interaction tolerance. Full-box translation preserves the inner width and is subject to the same server/Lua barrier. Structural state sanitation still accepts Lightroom's authoritative ordered ranges independently, so LRBridge does not falsify readback. The exact Luminance marker positioning and floor/ceil integer constraints remain unchanged.

Manual guard verification kept Point Color populated while all three inner ranges were narrowed to the protected minimum, translated, and combined with scalar, RangeAmount, picker, and visualization operations. During that pass an independent outer-handle reliability issue was found: a browser `pointercancel` or unexpected pointer-capture loss left the handle marked dirty without committing its last valid position, after which stale-feedback protection could make it appear unresponsive. Both termination paths now commit the last clamped outer-boundary position through the same serialized command pipeline; they do not bypass server or Lua validation.

## Lightroom history (Undo and Redo)

The Lightroom Classic 15.3 SDK includes the documented `LrUndo` namespace. Its generated API reference documents `LrUndo.undo()` as undoing the last history state and `LrUndo.redo()` as redoing the last undone history state. The same reference documents `LrUndo.canUndo()` and `LrUndo.canRedo()` as authoritative queries for whether the corresponding Lightroom command is currently enabled; all four functions are listed as supported since SDK 6.0. Bundled remote-control samples also exercise Lightroom undo and redo from plug-in code. No menu invocation, keyboard injection, or LRBridge-owned inverse-operation stack is required.

Production commands `lightroom.undo` and `lightroom.redo` travel through the existing serialized Lightroom command queue and invoke `LrUndo` on Lightroom's task. Availability is returned through the existing feedback-polling loop rather than a second timer. Context changes invalidate the cached availability until Lightroom republishes it. The toolbar's disabled states come from `LrUndo.canUndo()` and `LrUndo.canRedo()`.

The Web Controller uses Lightroom's native global `LrUndo` state directly: availability mirrors `LrUndo.canUndo()` and `LrUndo.canRedo()`. After every generic Develop slider mutation, LRBridge starts or restarts a three-second **Busy** period because Lightroom's Develop history state is not immediately reliable after SDK-driven changes; once Busy expires, the buttons resume authoritative mirroring through the existing history polling. Independently, Lightroom may group rapid Develop changes into one global history entry labeled **Multiple Settings**. That grouping is Lightroom behavior, so one native Undo can revert several rapidly grouped adjustments. LRBridge does not rewrite, split, synthesize, or otherwise manipulate Lightroom's history stack; this native grouping is distinct from the Web Controller's Busy/mirroring behavior.

User runtime verification confirmed that these commands mirror Lightroom Classic's native **Edit > Undo** and **Edit > Redo** behavior. They operate on Lightroom's global Undo/Redo history; they are not the per-photo Develop History panel. Consequently, Undo can affect Lightroom operations outside individual Develop adjustments whenever Lightroom itself places those operations on its Undo stack. This is native Lightroom behavior, not an LRBridge synthetic history system. Native Ctrl+Z and LRBridge Undo behaved consistently under a clean runtime lifecycle, and invoking Undo from the Web Controller while the browser held focus did not prevent the SDK action.

`LrUndo.undo()` and `LrUndo.redo()` can return before an affected Develop value becomes visible through Lightroom feedback. LRBridge therefore requests the normal authoritative feedback after a history command and does not predict or locally reverse Develop or Point Color values. No additional arbitrary delay is inserted.

An earlier apparent failure in which Undo seemed to send Lightroom to Library was contaminated by LRBridge's former one-shot startup `application.module = library` command. That ordinary FIFO command had been queued by the first context heartbeat of a new bridge lifecycle and could execute later even after Lightroom was manually returned to Develop. Clean-lifecycle tests showed that `LrUndo` itself did not cause the switch. The automatic startup command has now been removed; context heartbeats do not enqueue module changes, while explicit `application.module` commands remain supported.
