-- Production Remove/Parser/Commands exercised with SDK and native transport doubles.
removePreferences.newSpotType = "heal_patchmatch"
selectionInvokes, selectionReads = 0, 0
selectionActive, selectionAvailable, selectionSent = true, true, true
selectionToken = "1:2:3:4:5:6:7:8"
local sdk = import "LrDevelopController"
sdk.isAvailableForEditing = function() return selectionScenario ~= "not-ready" end
local http = import "LrHttp"
local originalHttp = http.get
local tasks = import "LrTasks"
local guard
tasks.startAsyncTask = function(fn) guard = fn end
selectionGuardApproved = false
http.get = function(url)
    if string.find(url, "/remove/selection-guard?", 1, true) then
        if string.find(url, "phase=poll", 1, true) then return '{"ok":true,"requested":true}' end
        selectionGuardApproved = string.find(url, "valid=true", 1, true) ~= nil
        return '{"ok":true,"accepted":true}'
    end
    if not string.find(url, "/remove/selection-native?", 1, true) then return originalHttp(url) end
    selectionReads = selectionReads + 1
    if string.find(url, "action=invoke", 1, true) then
        selectionInvokes = selectionInvokes + 1
        assert(selectionInvokes == 1, "Never retry a selection submission")
        if selectionScenario == "guard-photo" then removeUuid = "other-photo" end
        if selectionScenario == "guard-tool" then removeTool = "crop" end
        if selectionScenario == "guard-mode" then removePreferences.newSpotType = "clone" end
        assert(guard, "A live SDK guard is required before native dispatch")
        guard()
        if not selectionGuardApproved then return '{"ok":true,"sent":false,"available":false}' end
        if selectionScenario == "dispatch-error" then error("Native helper disconnected") end
        if selectionScenario == "unsent" then selectionSent = false end
        if selectionScenario == "photo-after" then removeUuid = "other-photo" end
        if selectionScenario == "tool-after" then removeTool = "crop" end
        if selectionScenario == "preferences-after" then removePreferences.brushFeather = 12 end
        if selectionScenario ~= "still-active" then selectionActive = false end
        if selectionScenario == "missing-after" then selectionAvailable = false end
        if selectionScenario == "token-after" then selectionToken = "8:7:6:5:4:3:2:1" end
        if selectionAction == "remove" and selectionScenario ~= "unchanged" or selectionScenario == "cancel-changed" then
            manualPeopleSpots = { { id = "new-repair", opacity = 1 } }
        end
    end
    if selectionScenario == "inactive-before" then selectionActive = false end
    if selectionScenario == "missing-before" then selectionAvailable = false end
    if selectionScenario == "token-before" then selectionToken = "8:7:6:5:4:3:2:1" end
    return '{"ok":true,"available":' .. tostring(selectionAvailable) .. ',"active":' .. tostring(selectionActive) ..
        ',"sent":' .. tostring(selectionSent) .. ',"token":"' .. selectionToken .. '"}'
end
