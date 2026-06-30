local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"
local LrDevelopController = import "LrDevelopController"

local sliderMap = {
    Exposure = "Exposure",
    Contrast = "Contrast",
    Highlights = "Highlights",
    Shadows = "Shadows",
    Whites = "Whites",
    Blacks = "Blacks",

    Temp = "Temperature",
    Tint = "Tint",

    Texture = "Texture",
    Clarity = "Clarity",
    Dehaze = "Dehaze",

    Vibrance = "Vibrance",
    Saturation = "Saturation",

    Sharpness = "Sharpness",
    LuminanceNR = "LuminanceNoiseReduction",
    ColorNR = "ColorNoiseReduction",
}

local function parseCommand(json)
    local slider = string.match(json, [["slider":"([^"]+)"]])
    local amount = string.match(json, [["amount":([%-]?%d+)]])

    if amount then
        amount = tonumber(amount)
    end

    return slider, amount
end

local function adjustSlider(slider, amount)
    local developSlider = sliderMap[slider]

    if developSlider == nil then
        LrDialogs.message("LRBridge", "Unknown slider: " .. tostring(slider))
        return
    end

    local ok, err = pcall(function()
        if amount > 0 then
            for i = 1, amount do
                LrDevelopController.increment(developSlider)
            end
        elseif amount < 0 then
            for i = 1, -amount do
                LrDevelopController.decrement(developSlider)
            end
        end
    end)

    if not ok then
        LrDialogs.message("LRBridge slider error", slider .. " → " .. developSlider .. "\n\n" .. tostring(err))
    end
end

local function executeCommand(json)
    local slider, amount = parseCommand(json)

    if slider == nil or amount == nil then
        return
    end

    adjustSlider(slider, amount)
end

LrDialogs.message("LRBridge", "Polling started.")

LrTasks.startAsyncTask(function()
    while true do
        local result = LrHttp.get("http://127.0.0.1:17891/next")

        if result ~= nil and string.find(result, "developAdjust") then
            executeCommand(result)
        end

        LrTasks.sleep(0.5)
    end
end)