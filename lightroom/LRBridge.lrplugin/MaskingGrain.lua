-- Only actual scoped Grain SDK writes can explain a regular-Masking revision.
-- Unknown/external changes retain the full Develop barrier.
local LrTasks = import "LrTasks"
local LrDevelopController = import "LrDevelopController"
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local M = {}
local serial, busy, receipts, baseline, overflow = 0, false, {}, nil, false
local function finite(n) return type(n) == "number" and n == n and n ~= math.huge and n ~= -math.huge end
local function supported(p) return p == "GrainSize" or p == "GrainFrequency" end
function M.selectedMask()
    local ok, id = LrTasks.pcall(function() return LrDevelopController.getSelectedMask() end)
    return ok and type(id) == "string" and id ~= "" and id or nil
end
local function identity()
    local ok, uuid, mask = LrTasks.pcall(function()
        if LrApplicationView.getCurrentModuleName() ~= "develop" then return nil end
        local photo = LrApplication.activeCatalog():getTargetPhoto()
        return photo and photo:getRawMetadata("uuid"), M.selectedMask()
    end)
    if ok and type(uuid) == "string" and uuid ~= "" and mask then return uuid, mask end
end
local function read(parameter)
    local ok, value = LrTasks.pcall(function() return LrDevelopController.getValue(parameter) end)
    return ok and finite(value) and value or nil
end
function M.write(parameter, command, write)
    if not supported(parameter) or not command or command.preserveMaskingPanel ~= true then return write() end
    serial = serial + 1
    busy = true
    local photo, mask = identity()
    local before = read(parameter)
    local ok, result = LrTasks.pcall(write)
    local after = ok and read(parameter) or nil
    local afterPhoto, afterMask = identity()
    serial = serial + 1
    busy = false
    if ok and photo == command.expectedSelectedPhotoUuid and photo == afterPhoto and mask ~= nil and
        mask == afterMask and finite(before) and finite(after) and
        (command.command ~= "develop.set" or command.value == after) then
        receipts[#receipts + 1] = { parameter = parameter, before = before, after = after,
            photo = photo, mask = mask, serial = serial }
        if #receipts > 128 then receipts = {}; overflow = true end
    else
        overflow = true -- A failed/unreadable write cannot own a later value.
    end
    if not ok then error(result) end
    return result
end
function M.beginObservation() return not busy and serial or nil end
function M.stable(version) return version ~= nil and not busy and version == serial end
function M.prepare(version, frame)
    if not M.stable(version) then return nil end
    local proof = nil
    if not overflow and baseline and frame.photo ~= nil and frame.mask ~= nil and
        frame.photo == baseline.photo and frame.mask == baseline.mask and frame.other == baseline.other and
        finite(frame.GrainSize) and finite(frame.GrainFrequency) then
        local expected = { GrainSize = baseline.GrainSize, GrainFrequency = baseline.GrainFrequency }
        local explained = #receipts > 0
        for _, receipt in ipairs(receipts) do
            if receipt.photo ~= frame.photo or receipt.mask ~= frame.mask or
                receipt.before ~= expected[receipt.parameter] then explained = false end
            expected[receipt.parameter] = receipt.after
        end
        if explained and expected.GrainSize == frame.GrainSize and expected.GrainFrequency == frame.GrainFrequency then
            proof = baseline.fingerprint
        end
    end
    return { frame = frame, through = version, from = proof }
end
function M.commit(observation)
    if not observation then return end
    baseline = observation.frame
    local remaining = {}
    for _, receipt in ipairs(receipts) do
        if receipt.serial > observation.through then remaining[#remaining + 1] = receipt end
    end
    receipts = remaining
    -- Retain uncertainty introduced while the heartbeat HTTP request yielded.
    if observation.through == serial then overflow = false end
end
return M
