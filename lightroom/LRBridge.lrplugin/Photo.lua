local LrApplication = import "LrApplication"
local LrFileUtils = import "LrFileUtils"
local LrShell = import "LrShell"

local Photo = {}

local rotations = {
    left = function(photo)
        photo:rotateLeft()
    end,
    right = function(photo)
        photo:rotateRight()
    end
}

local treatments = {
    grayscale = function(photo)
        photo:quickDevelopSetTreatment("grayscale")
    end,
    color = function(photo)
        photo:quickDevelopSetTreatment("color")
    end
}

local cropAspects = {
    original = function(photo)
        photo:quickDevelopCropAspect("original")
    end,
    asshot = function(photo)
        photo:quickDevelopCropAspect("asshot")
    end,
    ["1x1"] = function(photo)
        photo:quickDevelopCropAspect({ w = 1, h = 1 })
    end,
    ["2x3"] = function(photo)
        photo:quickDevelopCropAspect({ w = 2, h = 3 })
    end,
    ["4x5"] = function(photo)
        photo:quickDevelopCropAspect({ w = 4, h = 5 })
    end,
    ["5x7"] = function(photo)
        photo:quickDevelopCropAspect({ w = 5, h = 7 })
    end,
    ["16x9"] = function(photo)
        photo:quickDevelopCropAspect({ w = 16, h = 9 })
    end,
    ["16x10"] = function(photo)
        photo:quickDevelopCropAspect({ w = 16, h = 10 })
    end
}

local function activePhoto()
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    if photo == nil then
        error("No active photo")
    end
    return photo
end

function Photo.rotate(direction)
    local rotate = rotations[direction]
    if rotate == nil then
        error("Unknown photo rotation direction")
    end

    local photo = activePhoto()
    rotate(photo)
    return true
end

function Photo.setTreatment(value)
    local setTreatment = treatments[value]
    if setTreatment == nil then
        error("Unknown photo treatment")
    end

    setTreatment(activePhoto())
    return true
end

function Photo.setCropAspect(mode, w, h)
    if mode == "custom" then
        if type(w) ~= "number" or w % 1 ~= 0 or w < 1 or w > 10000 or
            type(h) ~= "number" or h % 1 ~= 0 or h < 1 or h > 10000 then
            error("Invalid custom photo crop aspect")
        end

        activePhoto():quickDevelopCropAspect({ w = w, h = h })
        return true
    end

    local setCropAspect = cropAspects[mode]
    if setCropAspect == nil then
        error("Unknown photo crop aspect")
    end

    setCropAspect(activePhoto())
    return true
end

function Photo.reveal(scope)
    if scope ~= "active" then
        error("Unknown photo reveal scope")
    end

    local path = activePhoto():getRawMetadata("path")
    if type(path) ~= "string" or path == "" then
        error("Active photo path is unavailable")
    end

    if LrFileUtils.exists(path) ~= "file" then
        error("Active photo file is offline or missing")
    end

    LrShell.revealInShell(path)
    return true
end

return Photo
