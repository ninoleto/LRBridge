return {
    VERSION = { major = 0, minor = 6, revision = 0 },

    LrSdkVersion = 15.3,
    LrSdkMinimumVersion = 15.3,

    LrToolkitIdentifier = "com.nino.lrbridge",
    LrPluginName = "LRBridge",

    LrInitPlugin = "PluginInit.lua",
    LrForceInitPlugin = true,
    LrShutdownPlugin = "PluginShutdown.lua",
    LrShutdownApp = "PluginShutdown.lua",

    LrHelpMenuItems = {
        {
            title = "LRBridge Help",
            file = "Help.lua",
        },
    },

    -- Diagnostic scripts are retained for development, without normal menu registrations.
    -- Dust runtime helpers and native preset dependencies remain in place.

}
