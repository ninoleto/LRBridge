local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local SDK = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrHttp = import "LrHttp"
local Parser = require "Parser"
local RedEye = {}
local base = "http://127.0.0.1:17891/red-eye/"
local bindings = { "expectedServerEpoch", "expectedRedEyeRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }
local tools = { loupe = true, crop = true, dust = true, redeye = true, masking = true, upright = true,
    point_color = true, local_point_color = true, depth_refinement = true }
local seenEpoch, highestOperation = nil, 0
local function encode(value)
    return (string.gsub(tostring(value == nil and "null" or value), "([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function bindingUrl(c)
    local url = ""; for _, k in ipairs(bindings) do url = url .. "&" .. k .. "=" .. encode(c[k]) end; return url
end
local function photoMatches(c)
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    return c.expectedActiveModule == "develop" and LrApplicationView.getCurrentModuleName() == "develop" and
        photo ~= nil and photo:getRawMetadata("uuid") == c.expectedSelectedPhotoUuid and photo:getRawMetadata("isVideo") ~= true
end
local function read(c)
    local s = { available = false, openSupported = type(SDK.goToEyeCorrection) == "function",
        closeSupported = type(SDK.selectTool) == "function", resetSupported = type(SDK.resetRedeye) == "function",
        reason = "Red Eye tool state unavailable." }
    local ok, tool = LrTasks.pcall(function()
        if not photoMatches(c) then return nil end
        local value = SDK.getSelectedTool()
        if photoMatches(c) and tools[value] then return value end
    end)
    if ok and tool then s.available, s.selectedTool, s.reason = true, tool, nil end
    return s
end
local function snapshotUrl(s)
    local url = ""
    for _, k in ipairs({ "available", "selectedTool", "openSupported", "closeSupported", "resetSupported", "reason" }) do
        url = url .. "&" .. k .. "=" .. encode(s[k])
    end
    return url
end
local function validate(c)
    local body = LrHttp.get(base .. "validate?operationId=" .. encode(c.operationId) .. bindingUrl(c))
    return type(body) == "string" and string.find(body, [["valid":true]], 1, true) ~= nil
end
function RedEye.sendRequestedSnapshot(json)
    local c = Parser.parse(json)
    if not c or c.command ~= "red_eye.query" or not c.requestId then return false end
    LrHttp.get(base .. "query-result?requestId=" .. encode(c.requestId) .. bindingUrl(c) .. snapshotUrl(read(c)))
    return true
end
function RedEye.execute(c)
    local invoked = false
    local function result(outcome, detail, snapshot)
        LrHttp.get(base .. "operation-result?operationId=" .. encode(c.operationId) .. bindingUrl(c) ..
            "&operationKind=" .. encode(c.operationKind) .. "&outcome=" .. outcome .. "&detail=" .. encode(detail) ..
            "&invoked=" .. tostring(invoked) .. snapshotUrl(snapshot or read(c)))
    end
    local ok = LrTasks.pcall(function()
        local kind = c.operationKind
        if not ({ red_eye = true, pet_eye = true, reset = true, close = true })[kind] or
            not validate(c) or not photoMatches(c) then result("stale", "Red Eye context changed."); return end
        local number = tonumber(string.match(c.operationId or "", "^re%-(%d+)$"))
        if not number then result("failed", "Invalid Red Eye operation."); return end
        if seenEpoch ~= c.expectedServerEpoch then seenEpoch, highestOperation = c.expectedServerEpoch, 0 end
        if number <= highestOperation then return end
        highestOperation = number
        local before = read(c)
        if not before.available or before.selectedTool ~= c.expectedSelectedTool or not validate(c) then
            result("stale", "Photo or active tool changed before the Red Eye request."); return
        end
        -- HTTP validation yields. Recheck native photo/tool immediately before the only mutation.
        before = read(c)
        if not before.available or before.selectedTool ~= c.expectedSelectedTool or not photoMatches(c) or
            kind == "close" and before.selectedTool ~= "redeye" then
            result("stale", "Photo or active tool changed before the Red Eye request."); return
        end
        local supported = kind == "close" and before.closeSupported or kind == "reset" and before.resetSupported or
            (kind == "red_eye" or kind == "pet_eye") and before.openSupported
        if not supported then result("failed", "Red Eye action unavailable in Lightroom."); return end
        invoked = true
        local accepted
        if kind == "close" then accepted = SDK.selectTool("loupe")
        elseif kind == "reset" then accepted = SDK.resetRedeye()
        else accepted = SDK.goToEyeCorrection(kind) end
        if accepted == false then result("failed", "Lightroom rejected the Red Eye request."); return end
        if not photoMatches(c) then result("stale", "Photo changed during the Red Eye request."); return end
        if kind == "reset" then result("requested", "Reset requested"); return end
        local target = kind == "close" and "loupe" or "redeye"
        for attempt = 1, 21 do
            local after = read(c)
            if not photoMatches(c) then result("stale", "Photo changed during tool confirmation."); return end
            if after.available and after.selectedTool == target then result("confirmed", "Tool state confirmed.", after); return end
            if attempt < 21 then
                LrTasks.sleep(0.1)
                if not validate(c) then result("stale", "Red Eye context changed during tool confirmation."); return end
            end
        end
        result("failed", "Lightroom did not confirm the requested tool state. No retry sent.")
    end)
    if not ok then LrTasks.pcall(function() result("failed", "Lightroom Red Eye request failed; result unconfirmed. No retry sent.") end) end
end
return RedEye
