-- Resolver for the inspected native preset, shared by the accepted proof and controller.
-- Never reconstructs the incomplete SDK getter or writes captured repair data.
local App = import "LrApplication"
local Files = import "LrFileUtils"
local MD5 = import "LrMD5"
local Preset = {}
Preset.digest = "ca1e4c9e0e49724b8fd9167c496026ba"
Preset.sourceUuid = "B7A5079E-65BC-400B-A41D-91579B06666D"

function Preset.resolve()
    local version = App.versionTable()
    if version.major ~= 15 or version.minor ~= 4 or version.revision ~= 1 then
        error("This Dust preset mapping requires Lightroom 15.4.1.", 0)
    end
    local folders, found, scanned = App.developPresetFolders(), nil, 0
    if type(folders) ~= "table" or #folders > 300 then error("Preset inventory unavailable.", 0) end
    for _, folder in ipairs(folders) do
        for _, preset in ipairs(folder:getDevelopPresets()) do
            scanned = scanned + 1
            if scanned > 5000 then error("Preset inventory exceeds bounds.", 0) end
            if preset:getName() == "LRBridge Dust On" then
                if found then error("Duplicate LRBridge Dust On presets.", 0) end
                found = preset
            end
        end
    end
    if not found then error("LRBridge Dust On preset is missing.", 0) end
    local contents = Files.readFile(found:getFile())
    if type(contents) ~= "string" or #contents > 2000000 then error("Dust On preset file unavailable or too large.", 0) end
    local digest = MD5.digest(contents)
    if #digest ~= 32 or string.find(digest, "[^%x]") then
        digest = string.gsub(digest, ".", function(c) return string.format("%02x", string.byte(c)) end)
    end
    if string.lower(digest) ~= Preset.digest then error("Dust On preset differs from the inspected definition.", 0) end
    local settings = found:getSetting()
    local allowed = { AllowFilters = true, CompatibleVersion = true, FilterList = true, ProcessVersion = true, Version = true }
    if type(settings) ~= "table" then error("Dust On preset settings unavailable.", 0) end
    for key in pairs(settings) do if not allowed[key] then error("Dust On preset includes other settings.", 0) end end
    local filters = settings.FilterList and settings.FilterList.Filters
    local f = type(filters) == "table" and filters[1]
    if settings.AllowFilters ~= 1 or settings.ProcessVersion ~= "15.4" or type(f) ~= "table" or #filters ~= 1 or
        f.FilterID ~= 6 or f.Name ~= "Dust Removal" or
        f.Title ~= "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal" or f.Images ~= nil or f.IsSignalForDelete ~= nil then
        error("Dust On preset no longer matches its inspected scope.", 0)
    end
    return found
end
return Preset
