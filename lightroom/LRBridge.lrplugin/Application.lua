local LrApplicationView = import "LrApplicationView"

local Application = {}

local actions = {
    toggle_zoom = LrApplicationView.toggleZoom,
    zoom_in = LrApplicationView.zoomIn,
    zoom_out = LrApplicationView.zoomOut,
    zoom_100 = LrApplicationView.zoomToOneToOne,
    fullscreen_preview = LrApplicationView.fullscreenPreview,
    fullscreen_hide_panels = LrApplicationView.fullscreenHidePanels,
    next_screen_mode = LrApplicationView.nextScreenMode,
    cycle_loupe_info = LrApplicationView.cycleLoupeViewInfo,
    toggle_secondary_display = LrApplicationView.toggleSecondaryDisplay,
    toggle_secondary_fullscreen = LrApplicationView.toggleSecondaryDisplayFullscreen
}

function Application.switchModule(module)
    LrApplicationView.switchToModule(module)
end

function Application.showView(view)
    LrApplicationView.showView(view)
end

function Application.runAction(action)
    local sdkCall = actions[action]
    if sdkCall == nil then
        error("Unknown application action")
    end
    sdkCall()
end

function Application.showSecondaryView(view)
    LrApplicationView.showSecondaryView(view)
end

return Application
