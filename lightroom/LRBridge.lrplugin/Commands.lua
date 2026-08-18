local Driver = require "Driver"
local Query = require "Query"
local Selection = require "Selection"
local Application = require "Application"
local Photo = require "Photo"
local Crop = require "Crop"
local ColorGrading = require "ColorGrading"
local Enhance = require "Enhance"
local PointColor = require "PointColor"
local History = require "History"
local LensBlur = require "LensBlur"
local DevelopCategorical = require "DevelopCategorical"
local LrHttp = import "LrHttp"

local Commands = {}

local function sendResult(commandName, slider, value)

    local url =
        "http://127.0.0.1:17891/result" ..
        "?command=" .. tostring(commandName) ..
        "&slider=" .. tostring(slider) ..
        "&value=" .. tostring(value)

    LrHttp.get(url)

end

function Commands.execute(command)

    if command == nil then
        return
    end

    if command.command == "color_grading.wheel.set" then ColorGrading.setWheel(command.region, command.hue, command.saturation); return end
    if command.command == "color_grading.value.set" then ColorGrading.setValue(command.control, command.value); return end
    if command.command == "color_grading.value.reset" then ColorGrading.resetValue(command.control); return end
    if command.command == "color_grading.region.reset" then ColorGrading.resetRegion(command.region); return end
    if command.command == "color_grading.view.set" then ColorGrading.setView(command.view); return end
    if command.command == "enhance.denoise.set" then Enhance.setDenoise(command.enabled, command.amount); return end
    if command.command == "enhance.denoise.amount.set" then Enhance.setDenoiseAmount(command.amount); return end
    if command.command == "enhance.raw_details.set" then Enhance.setRawDetails(command.enabled); return end
    if command.command == "enhance.super_resolution.set" then Enhance.setSuperResolution(command.enabled); return end
    if command.command == "point_color.value.set" then PointColor.setValue(command.field, command.value, command.expectedSelectedIndex); return end
    if command.command == "point_color.range.set" then PointColor.setRange(command.range, command.boundary, command.value, command.expectedSelectedIndex); return end
    if command.command == "point_color.range.translate" then PointColor.translateRange(command.range, command.LowerNone, command.LowerFull, command.UpperFull, command.UpperNone, command.expectedSelectedIndex); return end
    if command.command == "point_color.range_visualization.toggle" then PointColor.toggleRangeVisualization(); return end
    if command.command == "point_color.tool.select" then PointColor.selectTool(); return end
    if command.command == "lightroom.undo" then History.undo(); return end
    if command.command == "lightroom.redo" then History.redo(); return end
    if command.command == "lens_blur.active.set" then LensBlur.setActive(command.enabled); return end
    if command.command == "lens_blur.bokeh.set" then LensBlur.setBokeh(command.value); return end
    if command.command == "lens_blur.depth_refinement.select" then LensBlur.selectDepthRefinement(); return end
    if command.command == "lens_blur.depth_refinement.close" then LensBlur.closeDepthRefinement(); LensBlur.sendCurrentState(); return end
    if command.command == "lens_blur.focal_range.set" then LensBlur.setFocalRange(command.value); LensBlur.sendCurrentState(command.commitId); return end
    if command.command == "develop_categorical.white_balance.set" then DevelopCategorical.setWhiteBalance(command.value); return end
    if command.command == "develop_categorical.process.set" then DevelopCategorical.setProcess(command.value); return end
    if command.command == "develop_categorical.vignette_style.set" then DevelopCategorical.setVignetteStyle(command.value); return end
    if command.command == "develop_categorical.upright_mode.set" then DevelopCategorical.setUprightMode(command.value); return end
    if command.command == "develop_categorical.constrain_crop.set" then DevelopCategorical.setConstrainCrop(command.value); return end
    if command.command == "develop_categorical.upright_tool.select" then DevelopCategorical.selectUprightTool(); return end

    if command.command == "develop.adjust" then

        Driver.adjustSlider(
            command.slider,
            command.amount
        )

        return
    end

    if command.command == "develop.set" then

        Driver.setSlider(
            command.slider,
            command.value
        )

        return
    end

    if command.command == "develop.reset" then

        Driver.resetSlider(
            command.slider
        )

        return
    end

    if command.command == "develop.action" then

        Driver.runAction(
            command.action
        )

        return
    end

    if command.command == "develop.get" then

        local value = Query.getDevelopValue(command.slider)

        sendResult(
            "develop.get.result",
            command.slider,
            value
        )

        return
    end

    if command.command == "selection.navigate" then
        Selection.navigate(command.direction)
        return
    end

    if command.command == "selection.extend" then
        Selection.extend(command.direction, command.amount)
        return
    end

    if command.command == "photo.rotate" then
        Photo.rotate(command.direction)
        return
    end

    if command.command == "photo.treatment" then
        Photo.setTreatment(command.value)
        return
    end

    if command.command == "photo.crop_aspect" then
        Photo.setCropAspect(command.mode, command.w, command.h)
        return
    end

    if command.command == "photo.crop_angle.set" then
        Crop.setAngle(command.value)
        return
    end

    if command.command == "photo.crop_angle.reset" then
        Crop.resetAngle()
        return
    end

    if command.command == "photo.reveal" then
        Photo.reveal(command.scope)
        return
    end

    if command.command == "selection.flag" then
        Selection.setFlag(command.flag)
        return
    end

    if command.command == "selection.rating.set" then
        Selection.setRating(command.rating)
        return
    end

    if command.command == "selection.rating.adjust" then
        Selection.adjustRating(command.direction)
        return
    end

    if command.command == "selection.label.set" then
        Selection.setLabel(command.label)
        return
    end

    if command.command == "selection.label.toggle" then
        Selection.toggleLabel(command.label)
        return
    end

    if command.command == "selection.operation" then
        Selection.runOperation(command.operation)
        return
    end

    if command.command == "application.module" then
        Application.switchModule(command.module)
        return
    end

    if command.command == "application.view" then
        Application.showView(command.view)
        return
    end

    if command.command == "application.action" then
        Application.runAction(command.action)
        return
    end

    if command.command == "application.secondary_view" then
        Application.showSecondaryView(command.view)
        return
    end

end

return Commands
