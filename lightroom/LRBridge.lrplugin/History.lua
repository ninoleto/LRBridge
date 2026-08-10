local LrHttp = import "LrHttp"
local LrUndo = import "LrUndo"

local History = {}
local sequence = 0

function History.sendCurrentState()
    local okUndo, canUndo = pcall(LrUndo.canUndo)
    local okRedo, canRedo = pcall(LrUndo.canRedo)
    local available = okUndo and okRedo and type(canUndo) == "boolean" and type(canRedo) == "boolean"
    sequence = sequence + 1
    LrHttp.get("http://127.0.0.1:17891/history/result?sequence=" .. tostring(sequence) .. "&available=" .. tostring(available) ..
        "&canUndo=" .. tostring(available and canUndo or false) .. "&canRedo=" .. tostring(available and canRedo or false))
    return available
end

function History.undo()
    if LrUndo.canUndo() then LrUndo.undo() end
    History.sendCurrentState()
end

function History.redo()
    if LrUndo.canRedo() then LrUndo.redo() end
    History.sendCurrentState()
end

return History
