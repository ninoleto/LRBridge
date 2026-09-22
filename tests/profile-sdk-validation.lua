-- Production Lua replay with a real captured Look; all writes/catalog operations are mocks.
local mock, imports = {}, {}
import = function(name) imports[name] = imports[name] or {}; return imports[name] end
local module = assert(load(profileSource))()
local function copy(value)
    if type(value) ~= "table" then return value end
    local out = {}; for k, v in pairs(value) do out[k] = copy(v) end; return out
end
local function settings(look)
    local s = { Look=copy(look), CameraProfile="Adobe Standard", ConvertToGrayscale=false,
        Saturation=0, Vibrance=0, Exposure2012=0.25,
        -- Synthetic unrelated data exercises preservation without retaining a photo's private settings.
        FilterList={ opaque="test filter payload", Version="18.3" },
        LensBlur={ Active=captured.lensBlur.active, BlurAmount=captured.lensBlur.amount,
            FocalRange=captured.lensBlur.focalRange, FocalRangeSource=captured.lensBlur.focalRangeSource } }
    for _, color in ipairs({"Red","Orange","Yellow","Green","Aqua","Blue","Purple","Magenta"}) do
        for _, prefix in ipairs({"HueAdjustment","SaturationAdjustment","LuminanceAdjustment"}) do s[prefix..color] = 0 end
    end
    return s
end

local observed = settings(captured.look)
assert(captured.look.Name == "Adobe Vivid" and captured.look.Parameters.Version == "18.4")
local definition = module.definitions[captured.look.Name]
assert(module.desired(observed, definition), "Captured Adobe Vivid 18.4 must validate")
assert(observed.Look.Parameters.Version == "18.4", "Validation cannot mutate SDK feedback")
local legacy = copy(observed); legacy.Look.Parameters.Version = "18.3"
assert(module.desired(legacy, definition), "The original captured 18.3 Look stays supported")
assert(not module.equal(legacy, observed), "Full graph equality must remain strict, including Version")

for _, version in ipairs({"18.2", "18.5", "19.0", "18.4.0", 18.4, false}) do
    local candidate = copy(observed); candidate.Look.Parameters.Version = version
    assert(not module.desired(candidate, definition), "Unknown/malformed Look version must fail: "..tostring(version))
end
local missing = copy(observed); missing.Look.Parameters.Version = nil
assert(not module.desired(missing, definition), "Missing Look version must fail")
for _, mutate in ipairs({
    function(s) s.Look.UUID = "wrong" end,
    function(s) s.Look.Name = "Adobe Landscape" end,
    function(s) s.Look.Amount = 0.5 end,
    function(s) s.Look.Parameters.LookTable = "wrong" end,
    function(s) s.Look.Parameters.ProcessVersion = "15.5" end,
    function(s) s.Look.Parameters.ToneCurvePV2012[4] = 23 end,
    function(s) s.Look.Parameters.FutureField = true end,
    function(s) s.Look.Parameters.PointColors = nil end,
    function(s) s.ConvertToGrayscale = true end,
    function(s) s.HueAdjustmentRed = nil end,
    function(s) s.AILook = { Active=true } end
}) do
    local candidate = copy(observed); mutate(candidate)
    assert(not module.desired(candidate, definition), "Version compatibility cannot accept a different Look/treatment/AI state")
end

local photo = {}
function photo:getRawMetadata(key)
    if key == "uuid" then return mock.uuid end
    if key == "isVirtualCopy" then return mock.virtualCopy end
    if key == "fileFormat" then return "DNG" end
    error("Unexpected metadata read: "..key)
end
function photo:getDevelopSettings()
    if mock.writes == 0 then return copy(mock.before) end
    mock.reads = mock.reads + 1
    local result = copy(observed)
    if mock.adjustRead then mock.adjustRead(result, mock.reads) end
    return result
end
function photo:applyDevelopSettings(payload, history, constrain)
    mock.writes = mock.writes + 1
    assert(history == "LRBridge: Profile - Adobe Vivid" and constrain == false)
    assert(module.equal(payload.Look, definition.look()), "The established write payload must stay unchanged")
    local keys=0; for _ in pairs(payload) do keys=keys+1 end
    assert(keys == 1, "Same-treatment Profile writes must contain only Look")
    if mock.writeError then error("SDK write failed") end
end
local catalog = {}
function catalog:getTargetPhoto() return mock.otherPhoto and {} or photo end
function catalog:withWriteAccessDo(_, callback)
    if mock.beforeWrite then mock.beforeWrite() end
    callback()
end
imports.LrApplication.activeCatalog = function() return catalog end
imports.LrApplicationView.getCurrentModuleName = function() return mock.activeModule end
imports.LrDate.currentTime = function() return mock.clock end
imports.LrTasks.sleep = function(seconds) mock.clock = mock.clock + seconds end
imports.LrTasks.pcall = pcall
imports.LrHttp.get = function(url) mock.feedback[#mock.feedback+1]=url; return "ok" end

local scenarios = 0
local function scenario(label, options)
    options = options or {}
    mock = { uuid="fixture-photo", activeModule="develop", virtualCopy=false,
        before=settings(module.definitions["Adobe Color"].look()), clock=0, reads=0, writes=0, feedback={},
        adjustRead=options.adjustRead, beforeWrite=options.beforeWrite, writeError=options.writeError }
    local ok, err = pcall(module.api.set, "Adobe Vivid", 91)
    local success = options.error == nil
    assert(ok == success, label..": "..tostring(err))
    if not success then assert(string.find(tostring(err), options.error, 1, true), label..": "..tostring(err)) end
    assert(mock.writes == (options.writes or 1), label..": no duplicate/retry writes")
    assert(#mock.feedback == 1 and string.find(mock.feedback[1], "status="..(success and "confirmed" or "failed"), 1, true), label..": authoritative terminal result")
    if options.reads then assert(mock.reads == options.reads, label..": wrong number of stable reads: "..mock.reads) end
    scenarios = scenarios + 1
end

scenario("captured 18.4", {reads=5})
scenario("legacy 18.3", {reads=5, adjustRead=function(s) s.Look.Parameters.Version="18.3" end})
scenario("serialization settles before confirmation", {reads=6, adjustRead=function(s,n) if n==1 then s.Look.Parameters.Version="18.3" end end})
scenario("transient wrong Look", {reads=7, adjustRead=function(s,n) if n<=2 then s.Look.UUID="wrong" end end})
scenario("version alternation cannot satisfy stable readback", {error="stable validated Profile state", adjustRead=function(s,n) if n%2==0 then s.Look.Parameters.Version="18.3" end end})
scenario("unknown version", {error="stable validated Profile state", adjustRead=function(s) s.Look.Parameters.Version="18.5" end})
scenario("wrong Look with matching label", {error="stable validated Profile state", adjustRead=function(s) s.Look.Parameters.LookTable="wrong" end})
scenario("active AI Look", {error="stable validated Profile state", adjustRead=function(s) s.AILook={Active=true} end})
scenario("Exposure changed", {error="unrelated Develop setting changed", adjustRead=function(s) s.Exposure2012=1 end})
scenario("Lens Blur changed", {error="unrelated Develop setting changed", adjustRead=function(s) s.LensBlur.Active=false end})
scenario("unrelated nested Version changed", {error="unrelated Develop setting changed", adjustRead=function(s) s.FilterList.Version="18.4" end})
scenario("unrelated setting removed", {error="unrelated Develop setting changed", adjustRead=function(s) s.FilterList=nil end})
scenario("unrelated setting added", {error="unrelated Develop setting changed", adjustRead=function(s) s.FutureSetting=true end})
scenario("same-treatment mixer changed", {error="unrelated Develop setting changed", adjustRead=function(s) s.HueAdjustmentRed=1 end})
scenario("SDK write exception", {error="SDK write failed", writeError=true, reads=0})
scenario("SDK read exception", {error="SDK read failed", adjustRead=function() error("SDK read failed") end})
scenario("photo changed before write", {error="context changed before", writes=0, beforeWrite=function() mock.otherPhoto=true end})
scenario("photo changed during validation", {error="context changed during", adjustRead=function() mock.otherPhoto=true end})
scenario("UUID changed during validation", {error="context changed during", adjustRead=function() mock.uuid="another-photo" end})
scenario("virtual copy changed during validation", {error="context changed during", adjustRead=function() mock.virtualCopy=true end})
scenario("module changed during validation", {error="context changed during", adjustRead=function() mock.activeModule="library" end})
print("Profile SDK validation: captured Look checks and "..scenarios.." simulated production-Lua write/readback scenarios passed.")
