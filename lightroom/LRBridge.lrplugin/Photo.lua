local LrApplication = import "LrApplication"

local Photo = {}

local rotations = {
    left = function(photo)
        photo:rotateLeft()
    end,
    right = function(photo)
        photo:rotateRight()
    end
}

function Photo.rotate(direction)
    local rotate = rotations[direction]
    if rotate == nil then
        error("Unknown photo rotation direction")
    end

    local photo = LrApplication.activeCatalog():getTargetPhoto()
    if photo == nil then
        error("No active photo")
    end

    rotate(photo)
    return true
end

return Photo
