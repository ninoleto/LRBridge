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

function Photo.setCropAspect(mode)
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
