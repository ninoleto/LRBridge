local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDate = import "LrDate"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Profile = {}

local function adobeColorLook()
    return {
        Amount = 1,
        Copyright = "© 2018 Adobe Systems, Inc.",
        Group = { ["x-default"] = "Profiles" },
        Name = "Adobe Color",
        Parameters = {
            CameraProfile = "Adobe Standard",
            ConvertToGrayscale = false,
            FilterList = {},
            LookTable = "E1095149FDB39D7A057BAB208837E2E1",
            PointColors = {},
            ProcessVersion = "15.4",
            ToneCurveName2012 = "",
            ToneCurvePV2012 = { 0, 0, 22, 16, 40, 35, 127, 127, 224, 230, 240, 246, 255, 255 },
            ToneCurvePV2012Blue = { 0, 0, 255, 255 },
            ToneCurvePV2012Green = { 0, 0, 255, 255 },
            ToneCurvePV2012Red = { 0, 0, 255, 255 },
            Version = "18.3"
        },
        SupportsAmount = false,
        SupportsMonochrome = false,
        SupportsOutputReferred = false,
        UUID = "B952C231111CD8E0ECCF14B86BAA7077"
    }
end

local function adobeLandscapeLook()
    return {
        Amount = 1,
        Copyright = "© 2018 Adobe Systems, Inc.",
        Group = { ["x-default"] = "Profiles" },
        Name = "Adobe Landscape",
        Parameters = {
            CameraProfile = "Adobe Standard",
            Clarity2012 = 10,
            ConvertToGrayscale = false,
            FilterList = {},
            Highlights2012 = -12,
            LookTable = "0B3BFB5CFB7DBF7FF175E98F24D316B0",
            PointColors = {},
            ProcessVersion = "15.4",
            Shadows2012 = 12,
            ToneCurveName2012 = "",
            ToneCurvePV2012 = { 0, 0, 64, 60, 128, 128, 192, 196, 255, 255 },
            ToneCurvePV2012Blue = {},
            ToneCurvePV2012Green = {},
            ToneCurvePV2012Red = {},
            Version = "18.3"
        },
        SupportsAmount = false,
        SupportsMonochrome = false,
        SupportsOutputReferred = false,
        UUID = "6F9C877E84273F4E8271E6B91BEB36A1"
    }
end

local function adobePortraitLook()
    return {
        Amount = 1,
        Copyright = "© 2018 Adobe Systems, Inc.",
        Group = { ["x-default"] = "Profiles" },
        Name = "Adobe Portrait",
        Parameters = {
            CameraProfile = "Adobe Standard",
            ConvertToGrayscale = false,
            FilterList = {},
            LookTable = "E5A76DBB8B3F132A04C01AF45DC2EF1B",
            PointColors = {},
            ProcessVersion = "15.4",
            ToneCurveName2012 = "",
            ToneCurvePV2012 = { 0, 0, 66, 64, 190, 192, 255, 255 },
            ToneCurvePV2012Blue = {},
            ToneCurvePV2012Green = {},
            ToneCurvePV2012Red = {},
            Version = "18.3"
        },
        SupportsAmount = false,
        SupportsMonochrome = false,
        SupportsOutputReferred = false,
        UUID = "D6496412E06A83789C499DF9540AA616"
    }
end

local function adobeVividLook()
    return {
        Amount = 1,
        Copyright = "© 2018 Adobe Systems, Inc.",
        Group = { ["x-default"] = "Profiles" },
        Name = "Adobe Vivid",
        Parameters = {
            CameraProfile = "Adobe Standard",
            Clarity2012 = 10,
            ConvertToGrayscale = false,
            FilterList = {},
            LookTable = "2FE663AB0D3CE5DA7B9F657BBCD66DFE",
            PointColors = {},
            ProcessVersion = "15.4",
            ToneCurveName2012 = "",
            ToneCurvePV2012 = { 0, 0, 32, 22, 64, 56, 128, 128, 224, 232, 240, 246, 255, 255 },
            ToneCurvePV2012Blue = {},
            ToneCurvePV2012Green = {},
            ToneCurvePV2012Red = {},
            Version = "18.3"
        },
        SupportsAmount = false,
        SupportsMonochrome = false,
        SupportsOutputReferred = false,
        UUID = "EA1DE074F188405965EF399C72C221D9"
    }
end

local function adobeMonochromeLook()
    return {
        Amount = 1,
        Copyright = "© 2018 Adobe Systems, Inc.",
        Group = { ["x-default"] = "Profiles" },
        Name = "Adobe Monochrome",
        Parameters = {
            CameraProfile = "Adobe Standard",
            Clarity2012 = 8,
            ConvertToGrayscale = true,
            FilterList = {},
            LookTable = "73ED6C18DDE909DD7EA2D771F5AC282D",
            PointColors = {},
            ProcessVersion = "15.4",
            ToneCurveName2012 = "",
            ToneCurvePV2012 = { 0, 0, 64, 56, 128, 128, 192, 197, 255, 255 },
            ToneCurvePV2012Blue = { 0, 0, 255, 255 },
            ToneCurvePV2012Green = { 0, 0, 255, 255 },
            ToneCurvePV2012Red = { 0, 0, 255, 255 },
            Version = "18.3"
        },
        SupportsAmount = false,
        SupportsMonochrome = false,
        SupportsOutputReferred = false,
        UUID = "0CFE8F8AB5F63B2A73CE0B0077D20817"
    }
end

local function artistic01Look()
    return {
        Amount = 1,
        Cluster = "Adobe",
        Copyright = "© 2018 Adobe Systems, Inc.",
        Group = { ["x-default"] = "Artistic" },
        Name = "Artistic 01",
        Parameters = {
            ConvertToGrayscale = false,
            FilterList = {},
            LookTable = "E1095149FDB39D7A057BAB208837E2E1",
            PointColors = {},
            ProcessVersion = "15.4",
            RGBTable = "BD510A12D9BF555B0328CD473B1392E0",
            RGBTableAmount = 0.5,
            Version = "18.3"
        },
        SupportsMonochrome = false,
        UUID = "DEA6FAEE53043AC17C1EB384D11F32F7"
    }
end

local function adobeStandardLookTombstone()
    return {}
end

local supportedProfiles = {
    ["Adobe Color"] = { look = adobeColorLook, grayscale = false },
    ["Adobe Landscape"] = { look = adobeLandscapeLook, grayscale = false },
    ["Adobe Portrait"] = { look = adobePortraitLook, grayscale = false },
    ["Adobe Standard"] = {
        look = adobeStandardLookTombstone,
        lookAbsent = true,
        cameraProfile = "Adobe Standard",
        grayscale = false
    },
    ["Adobe Vivid"] = { look = adobeVividLook, grayscale = false },
    ["Adobe Monochrome"] = { look = adobeMonochromeLook, grayscale = true, includeTreatment = true },
    ["Artistic 01"] = { look = artistic01Look, grayscale = false }
}

local function inDevelop()
    return string.lower(tostring(LrApplicationView.getCurrentModuleName())) == "develop"
end

local mixerColors = { "Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta" }
local colorSchemaKeys = {}
local graySchemaKeys = {}
for _, color in ipairs(mixerColors) do
    colorSchemaKeys[#colorSchemaKeys + 1] = "HueAdjustment" .. color
    colorSchemaKeys[#colorSchemaKeys + 1] = "SaturationAdjustment" .. color
    colorSchemaKeys[#colorSchemaKeys + 1] = "LuminanceAdjustment" .. color
    graySchemaKeys[#graySchemaKeys + 1] = "GrayMixer" .. color
end

local function graphEqual(left, right, visited)
    if type(left) ~= type(right) then return false end
    if type(left) ~= "table" then return left == right end
    visited = visited or {}
    if visited[left] == right then return true end
    visited[left] = right
    for key, value in pairs(left) do
        if not graphEqual(value, right[key], visited) then return false end
    end
    for key, _ in pairs(right) do
        if left[key] == nil then return false end
    end
    return true
end

local function schemaMatches(settings, grayscale)
    if settings.ConvertToGrayscale ~= grayscale then return false end
    if grayscale then
        if settings.Saturation ~= nil or settings.Vibrance ~= nil then return false end
        for _, key in ipairs(colorSchemaKeys) do if settings[key] ~= nil then return false end end
        for _, key in ipairs(graySchemaKeys) do if type(settings[key]) ~= "number" then return false end end
    else
        if type(settings.Saturation) ~= "number" or type(settings.Vibrance) ~= "number" then return false end
        for _, key in ipairs(graySchemaKeys) do if settings[key] ~= nil then return false end end
        for _, key in ipairs(colorSchemaKeys) do if type(settings[key]) ~= "number" then return false end end
    end
    return true
end

local function treatmentKey(key)
    if key == "ConvertToGrayscale" or key == "Saturation" or key == "Vibrance" then return true end
    for _, candidate in ipairs(colorSchemaKeys) do if key == candidate then return true end end
    for _, candidate in ipairs(graySchemaKeys) do if key == candidate then return true end end
    return false
end

local function unchangedOutsideProfile(before, after, definition)
    local treatmentChanges = before.ConvertToGrayscale ~= definition.grayscale
    local function ignored(key)
        return key == "Look" or key == "AILook" or
            (treatmentChanges and treatmentKey(key))
    end
    for key, value in pairs(before) do
        if not ignored(key) and not graphEqual(value, after[key]) then return false end
    end
    for key, value in pairs(after) do
        if not ignored(key) and not graphEqual(value, before[key]) then return false end
    end
    return true
end

local function desiredState(settings, definition)
    if not schemaMatches(settings, definition.grayscale) then return false end
    if definition.cameraProfile ~= nil and settings.CameraProfile ~= definition.cameraProfile then
        return false
    end
    if definition.lookAbsent then
        if settings.Look ~= nil then return false end
    elseif not graphEqual(settings.Look, definition.look()) then
        return false
    end
    return settings.AILook == nil or
        (type(settings.AILook) == "table" and settings.AILook.Active ~= true)
end

local function percentEncode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

local function sendValidation(generation, requestedProfile, status)
    LrHttp.get(
        "http://127.0.0.1:17891/develop-categorical/profile-validation" ..
        "?generation=" .. tostring(generation) ..
        "&profile=" .. percentEncode(requestedProfile) ..
        "&status=" .. status
    )
end

local function buildPayload(definition, before)
    local payload = { Look = definition.look() }
    if definition.includeTreatment or before.ConvertToGrayscale ~= definition.grayscale then
        payload.ConvertToGrayscale = definition.grayscale
    end
    return payload
end

local function applyAndValidate(requestedProfile, generation)
    local definition = supportedProfiles[requestedProfile]
    if definition == nil then error("Unsupported Profile target") end
    if not inDevelop() then error("Profile selection requires the Develop module") end
    if type(generation) ~= "number" or generation < 1 or generation ~= math.floor(generation) then
        error("Invalid Profile generation")
    end

    local catalog = LrApplication.activeCatalog()
    if catalog == nil then error("Profile selection requires an active catalog") end
    local photo = catalog:getTargetPhoto()
    if photo == nil then error("Profile selection requires a target photo") end
    if tostring(photo:getRawMetadata("fileFormat")) == "VIDEO" then error("Profile selection is unavailable for videos") end
    local uuid = tostring(photo:getRawMetadata("uuid"))
    local virtualCopy = photo:getRawMetadata("isVirtualCopy") == true
    local before = photo:getDevelopSettings()
    if type(before) ~= "table" then error("Complete pre-Profile settings were unavailable") end
    local payload = buildPayload(definition, before)

    catalog:withWriteAccessDo("LRBridge Profile", function()
        if not inDevelop() or catalog:getTargetPhoto() ~= photo or
            tostring(photo:getRawMetadata("uuid")) ~= uuid or
            (photo:getRawMetadata("isVirtualCopy") == true) ~= virtualCopy then
            error("Profile photo context changed before the SDK write")
        end
        photo:applyDevelopSettings(
            payload,
            "LRBridge: Profile - " .. requestedProfile,
            false
        )
    end)

    local deadline = LrDate.currentTime() + 6.5
    local stableSettings = nil
    local stableCount = 0
    while LrDate.currentTime() <= deadline do
        if not inDevelop() or catalog:getTargetPhoto() ~= photo or
            tostring(photo:getRawMetadata("uuid")) ~= uuid or
            (photo:getRawMetadata("isVirtualCopy") == true) ~= virtualCopy then
            error("Profile photo context changed during SDK validation")
        end
        local current = photo:getDevelopSettings()
        if type(current) ~= "table" then error("Complete post-Profile settings were unavailable") end
        if not unchangedOutsideProfile(before, current, definition) then
            error("An unrelated Develop setting changed during Profile validation")
        end
        if desiredState(current, definition) then
            if stableSettings ~= nil and graphEqual(stableSettings, current) then
                stableCount = stableCount + 1
            else
                stableSettings = current
                stableCount = 1
            end
            if stableCount >= 5 then return end
        else
            stableSettings = nil
            stableCount = 0
        end
        LrTasks.sleep(0.35)
    end
    error("Lightroom did not produce a stable validated Profile state")
end

function Profile.set(requestedProfile, generation)
    local ok, message = LrTasks.pcall(applyAndValidate, requestedProfile, generation)
    local sent, sendError = LrTasks.pcall(sendValidation, generation, requestedProfile, ok and "confirmed" or "failed")
    if not sent then error(sendError) end
    if not ok then error(message) end
end

return Profile
