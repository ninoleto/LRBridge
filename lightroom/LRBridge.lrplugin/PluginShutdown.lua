local LrTasks = import "LrTasks"
local Lifecycle = require "PollingLifecycle"

-- Disable and unload/reload execute this script directly, without the returned table.
-- Signal synchronously for both hooks; capture this generation for app shutdown.
local state = Lifecycle.stop()

-- Only LrShutdownApp invokes the documented asynchronous completion callback.
return {
    LrShutdownFunction = function(doneFunction, progressFunction)
        LrTasks.startAsyncTask(function()
            -- Do not cancel/retry an SDK action whose outcome may be uncertain.
            while not Lifecycle.isStopped(state) do
                -- Keep Lightroom's shutdown deadline alive; honor cancellation of the wait.
                if progressFunction(0, "Waiting for LRBridge polling to stop") then break end
                LrTasks.sleep(0.1)
            end
            progressFunction(1, "LRBridge shutdown")
            doneFunction()
        end)
    end,
}
