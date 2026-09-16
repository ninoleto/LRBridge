-- Read-only evidence for a Dust-only settings/preset path. No edit APIs belong here.
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local SDK = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrMD5 = import "LrMD5"
local Diagnostics = {}

function Diagnostics.sanitize(value)
    local text = tostring(value or "Unknown SDK failure")
    text = string.gsub(text, "https?://%S+", "[redacted URL]")
    text = string.gsub(text, "%a:[/\\][^%c]+", "[redacted path]")
    text = string.gsub(text, "\\\\[^%c]+", "[redacted path]")
    text = string.gsub(text, "/[^%s]+", "[redacted path]")
    text = string.gsub(text, "[%c]", " ")
    return string.sub(text, 1, 500)
end

local function quote(value)
    return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(c) return string.format("\\u%04x", string.byte(c)) end) .. '"'
end
function Diagnostics.json(value)
    local kind = type(value)
    if kind == "nil" then return "null" end
    if kind == "string" then return quote(value) end
    if kind == "boolean" or kind == "number" then return tostring(value) end
    local entries = {}
    for key, item in pairs(value) do entries[#entries + 1] = quote(tostring(key)) .. ":" .. Diagnostics.json(item) end
    table.sort(entries)
    return "{" .. table.concat(entries, ",") .. "}"
end
local function digest(value)
    return (string.gsub(LrMD5.digest(value), ".", function(c) return string.format("%02x", string.byte(c)) end))
end

-- Keep scalar flags/values and bounded nested structure; large opaque strings are hashes.
-- Truncation is explicit and cannot be treated as proof that other edits were preserved.
function Diagnostics.summarize(value)
    local seen, nodes, truncated = {}, 0, false
    local function visit(item, depth)
        nodes = nodes + 1
        if nodes > 512 or depth > 12 then truncated = true; return { omitted = true } end
        local kind = type(item)
        if kind == "string" then
            if #item <= 256 then return { type = kind, value = item } end
            return { type = kind, length = #item, hash = digest(item) }
        end
        if kind == "boolean" or kind == "number" and item == item and math.abs(item) < math.huge then
            return { type = kind, value = item }
        end
        if kind ~= "table" then return { type = kind, unsupported = kind ~= "nil" } end
        if seen[item] then truncated = true; return { type = kind, cycle = true } end
        seen[item] = true
        local keys = {}
        for key in pairs(item) do
            if type(key) ~= "string" and type(key) ~= "number" then error("Unsupported settings key") end
            keys[#keys + 1] = key
        end
        table.sort(keys, function(a, b) return type(a) .. tostring(a) < type(b) .. tostring(b) end)
        local children = {}
        for _, key in ipairs(keys) do
            if nodes >= 512 then truncated = true; break end
            children[type(key) .. ":" .. tostring(key)] = visit(item[key], depth + 1)
        end
        seen[item] = nil
        return { type = kind, count = #keys, children = children }
    end
    local data = visit(value, 0)
    return { data = data, hash = digest(Diagnostics.json(data)), truncated = truncated }
end

function Diagnostics.capture(photo, uuid)
    local failureKind, stage = "sdk_unavailable", "context"
    local function requireContext()
        failureKind = "sdk_unavailable"
        local selected = LrApplication.activeCatalog():getTargetPhoto()
        if selected == nil then failureKind = "missing_photo"; error("No selected photo; capture stopped.", 0) end
        if selected ~= photo or photo:getRawMetadata("uuid") ~= uuid then
            failureKind = "photo_changed"; error("Selected photo changed; capture stopped.", 0)
        end
        local module = LrApplicationView.getCurrentModuleName()
        if module ~= "develop" then
            failureKind = "wrong_module"; error("Expected Develop; current module is " .. tostring(module) .. ".", 0)
        end
    end
    local ok, snapshot = LrTasks.pcall(function()
        requireContext()
        stage = "getDevelopSettings"
        local settings = photo:getDevelopSettings()
        if type(settings) ~= "table" or next(settings) == nil then error("Develop settings unavailable or empty.", 0) end
        stage = "summarize settings"
        local fields, fieldCount = {}, 0
        for key, value in pairs(settings) do
            fieldCount = fieldCount + 1
            if type(key) ~= "string" or fieldCount > 1024 then error("Develop settings exceed capture bounds") end
            fields[key] = Diagnostics.summarize(value)
        end
        local preferencesOk, preferences = LrTasks.pcall(function() return SDK.getRemovePanelPreferences() end)
        local toolOk, tool = LrTasks.pcall(function() return SDK.getSelectedTool() end)
        stage = "context after read"
        requireContext()
        stage = "versionTable"
        return { available = true, selectedPhotoUuid = uuid, activeModule = "develop", settings = fields,
            selectedTool = toolOk and tool or nil,
            preferences = preferencesOk and Diagnostics.summarize(preferences) or { available = false },
            sdkVersion = Diagnostics.summarize(LrApplication.versionTable()),
            methods = { applyDevelopPreset = type(photo.applyDevelopPreset), applyDevelopSettings = type(photo.applyDevelopSettings),
                pasteSettings = type(LrApplication.activeCatalog().pasteSettings) } }
    end)
    if ok then return snapshot end
    return { available = false, failureKind = failureKind,
        reason = stage .. ": " .. Diagnostics.sanitize(snapshot) }
end
return Diagnostics
