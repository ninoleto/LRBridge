local Lifecycle = require "PollingLifecycle"
local state = Lifecycle.begin()

Lifecycle.start(state, "commands", "LRBridgePollingStarted", function(running)
    local run = dofile(_PLUGIN.path .. "\\AutoStartPolling.lua")
    run(running)
end)

Lifecycle.start(state, "feedback", "LRBridgeFeedbackPollingStarted", function(running, startChildTask)
    local run = dofile(_PLUGIN.path .. "\\FeedbackPolling.lua")
    run(running, startChildTask)
end)
