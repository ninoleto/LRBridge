return {
    VERSION = { major = 1, minor = 0, revision = 0 },

    LrSdkVersion = 6.0,
    LrSdkMinimumVersion = 4.0,

    LrToolkitIdentifier = "com.nino.lrbridge",
    LrPluginName = "LRBridge",

    LrInitPlugin = "PluginInit.lua",
    LrForceInitPlugin = true,

    LrLibraryMenuItems = {
        {
            title = "Start LRBridge Polling",
            file = "StartPolling.lua",
        },
    },
}