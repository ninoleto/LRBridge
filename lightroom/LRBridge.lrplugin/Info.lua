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

    -- Diagnostic scripts are retained for development, without normal menu registrations.
    -- Dust runtime helpers and native preset dependencies remain in place.

    LrLibraryMenuItems = {
        {
            title = "Start LRBridge Polling",
            file = "StartPolling.lua",
        },
    },
}
