-- Reuse the working read-only capture with control-mapping instructions only.
local LrPathUtils = import "LrPathUtils"
local capture = assert(loadfile(LrPathUtils.child(_PLUGIN.path, "CaptureDust.lua")))
capture({ purpose = "controls" })
