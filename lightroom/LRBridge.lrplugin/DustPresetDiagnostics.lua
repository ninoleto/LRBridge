-- Inspect only explicitly named native Dust presets; never create or apply one.
local LrApplication = import "LrApplication"
local LrTasks = import "LrTasks"
local Diagnostics = require "DustDiagnostics"
local Presets = {}
function Presets.capture()
    local ok, result = LrTasks.pcall(function()
        local found, scanned = {}, 0
        local folders = LrApplication.developPresetFolders()
        if type(folders) ~= "table" or #folders > 300 then error("Preset folders unavailable or exceed diagnostic bounds.", 0) end
        for _, folder in ipairs(folders) do
            local presets = folder:getDevelopPresets()
            if type(presets) ~= "table" then error("Preset list unavailable.", 0) end
            for _, preset in ipairs(presets) do
                scanned = scanned + 1
                if scanned > 5000 then error("Preset inventory exceeds diagnostic bounds.", 0) end
                local name = preset:getName()
                if name == "LRBridge Dust On" or name == "LRBridge Dust Off" then
                    local settings = preset:getSetting()
                    if type(settings) ~= "table" then error("Named Dust preset settings unavailable.", 0) end
                    local fields, count = {}, 0
                    for key, value in pairs(settings) do
                        count = count + 1
                        if type(key) ~= "string" or count > 1024 then error("Preset settings exceed diagnostic bounds.", 0) end
                        fields[key] = Diagnostics.summarize(value)
                    end
                    found[#found + 1] = { name = name, uuid = preset:getUuid(), file = preset:getFile(), settings = fields }
                end
            end
        end
        return { available = true, presets = found, readOnly = true }
    end)
    if ok then return result end
    return { available = false, reason = Diagnostics.sanitize(result), readOnly = true }
end
return Presets
