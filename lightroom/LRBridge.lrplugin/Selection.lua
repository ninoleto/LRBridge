local LrSelection = import "LrSelection"

local Selection = {}

local navigation = {
    next = LrSelection.nextPhoto,
    previous = LrSelection.previousPhoto,
    first = LrSelection.selectFirstPhoto,
    last = LrSelection.selectLastPhoto
}

local flags = {
    pick = LrSelection.flagAsPick,
    reject = LrSelection.flagAsReject,
    none = LrSelection.removeFlag
}

local ratingAdjustments = {
    increase = LrSelection.increaseRating,
    decrease = LrSelection.decreaseRating
}

local labelToggles = {
    red = LrSelection.toggleRedLabel,
    yellow = LrSelection.toggleYellowLabel,
    green = LrSelection.toggleGreenLabel,
    blue = LrSelection.toggleBlueLabel,
    purple = LrSelection.togglePurpleLabel
}

local function callMapped(mapping, value, operation)
    local sdkCall = mapping[value]
    if sdkCall == nil then
        error("Unknown selection " .. operation)
    end
    sdkCall()
end

function Selection.navigate(direction)
    callMapped(navigation, direction, "navigation direction")
end

function Selection.setFlag(flag)
    callMapped(flags, flag, "flag")
end

function Selection.setRating(rating)
    LrSelection.setRating(rating)
end

function Selection.adjustRating(direction)
    callMapped(ratingAdjustments, direction, "rating adjustment")
end

function Selection.setLabel(label)
    LrSelection.setColorLabel(label)
end

function Selection.toggleLabel(label)
    callMapped(labelToggles, label, "label toggle")
end

return Selection
