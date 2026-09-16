return {
    VERSION = { major = 1, minor = 0, revision = 0 },

    LrSdkVersion = 6.0,
    LrSdkMinimumVersion = 4.0,

    LrToolkitIdentifier = "com.nino.lrbridge",
    LrPluginName = "LRBridge",

    LrInitPlugin = "PluginInit.lua",
    LrForceInitPlugin = true,

    LrHelpMenuItems = {
        {
            title = "LRBridge Help",
            file = "Help.lua",
        },
    },

    -- File > Plug-in Extras is available while the selected photo stays in Develop.
    LrExportMenuItems = {
        {
            title = "Capture automatic Dust settings (read-only)",
            file = "CaptureDust.lua",
        },
        {
            title = "Test Dust-only SDK paste (one shot)",
            file = "TestDustPaste.lua",
        },
        {
            title = "Capture Dust controls (read-only)",
            file = "CaptureDustControls.lua",
        },
        {
            title = "Test Dust preset, Reset and Close (one shot)",
            file = "TestDustPreset.lua",
        },
        {
            title = "Start/finish Dust Reset observation (read-only)",
            file = "ObserveDustReset.lua",
        },
        {
            title = "Start/finish Dust Close observation (read-only)",
            file = "ObserveDustClose.lua",
        },
    },

    LrLibraryMenuItems = {
        {
            title = "Start LRBridge Polling",
            file = "StartPolling.lua",
        },
    },
}
