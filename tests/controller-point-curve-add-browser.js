"use strict";
// Real Controller DOM/handlers, production HTTP routes/queue, production Lua
// with SDK doubles. All ports/photos are isolated; this is not native acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const browser = require("./controller-browser-lifecycle");
const { createBridge } = require("../server/bridge"), commands = require("../server/commands");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const root = path.join(__dirname, ".."), linear = [0, 0, 255, 255];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function sdkExecute(queue, binding, initialCurves = {}, channel = "rgb") {
    const state = lauxlib.luaL_newstate(); lualib.luaL_openlibs(state);
    const source = fs.readFileSync(process.env.LRBRIDGE_TONE_CURVE_LUA_SOURCE || path.join(root, "lightroom/LRBridge.lrplugin/ToneCurve.lua"), "utf8");
    const writes = [], readback = [], fields = [];
    lua.lua_pushjsfunction(state, L => {
        fields.push(to_jsstring(lua.lua_tostring(L, 1)));
        writes.push(Array.from({ length: lua.lua_gettop(L) - 1 }, (_, i) => lua.lua_tonumber(L, i + 2))); return 0;
    });
    lua.lua_setglobal(state, to_luastring("writeCurve"));
    lua.lua_pushjsfunction(state, L => { readback.push(Array.from({ length: lua.lua_gettop(L) }, (_, i) => lua.lua_tonumber(L, i + 1))); return 0; });
    lua.lua_setglobal(state, to_luastring("readCurve"));
    const asLua = value => Array.isArray(value) ? `{${value.join(",")}}` : JSON.stringify(value);
    const commandLua = command => `{${Object.entries(command).map(([key, value]) => `${key}=${asLua(value)}`).join(",")}}`;
    const context = JSON.stringify({ activeModule: "develop", ...binding });
    const script = `_PLUGIN={path='fixture'}
      package.preload.PollingTrace=function() return {new=function() return {mark=function() end} end} end
      local photo={getRawMetadata=function() return '${binding.selectedPhotoUuid}' end}
      local values={${Object.entries({ rgb: 'ToneCurvePV2012', red: 'ToneCurvePV2012Red', green: 'ToneCurvePV2012Green', blue: 'ToneCurvePV2012Blue' })
        .map(([name, field]) => `${field}=${asLua(initialCurves[name] || linear)}`).join(',')},ToneCurveName2012='Custom',CurveRefineSaturation=100}
      local sdk={getValue=function(field) return values[field] end,getRange=function() return 0,100 end,startTracking=function() end,stopTracking=function() end,
        setValue=function(field,value) values[field]=value;writeCurve(field,table.unpack(value)) end}
      function import(name)
        if name=='LrDevelopController' then return sdk end
        if name=='LrApplication' then return {activeCatalog=function() return {getTargetPhoto=function() return photo end} end} end
        if name=='LrApplicationView' then return {getCurrentModuleName=function() return 'develop' end} end
        if name=='LrTasks' then return {pcall=pcall} end
        if name=='LrHttp' then return {get=function() return [=[${context}]=] end} end
        error('Unexpected import: '..name)
      end
      local curve=(function() ${source}\nend)()
      ${queue.map(command => {
        const method = { "tone_curve.gesture.begin": "beginGesture", "tone_curve.gesture.end": "endGesture" }[command.command];
        assert(method, "Only the admitted begin/end may reach the SDK fixture");
        return `assert(curve.${method}(${commandLua(command)}),'SDK fixture rejected ${method}')`;
      }).join("\n")}
      local actual=curve.readSnapshot();assert(actual,'Production SDK fixture readback unavailable');readCurve(table.unpack(actual.curves.${channel}))`;
    try { const result = lauxlib.luaL_dostring(state, to_luastring(script)); assert.equal(result, lua.LUA_OK, result === lua.LUA_OK ? "" : to_jsstring(lua.lua_tostring(state, -1))); }
    finally { lua.lua_close(state); }
    return { writes, readback: readback[0], fields };
}
async function main() {
    commands.resetQueueForTests();
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40 });
    const requests = [], exceptions = [], curves = Object.fromEntries(["rgb", "red", "green", "blue"].map(channel => [channel, linear.slice()]));
    let binding, origin, heldPhase = null;
    const heldAdmissions = [];
    async function get(route) { const response = await fetch(origin + route); const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body; }
    async function feedback() {
        return get("/tone-curve/feedback?" + new URLSearchParams({ ...binding, name: "Custom", refineSaturation: 100, refineMin: 0, refineMax: 100,
            ...Object.fromEntries(Object.entries(curves).map(([channel, points]) => [channel, points.join(",")])) }));
    }
    const style = fs.readFileSync(path.join(root, "app/controller.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://127.0.0.1");
            if (url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
                return res.end(`<!doctype html><style>${style}</style><div id="status"></div><div id="content"></div>
                  <script src="/controller-tone-curve.js"></script><script>
                  window.controller=LRBridgeToneCurve.createController({document,window,fetch:window.fetch.bind(window),setInterval:()=>1,clearInterval:()=>{},setStatus:text=>{document.getElementById('status').textContent=text;}});
                  document.getElementById('content').append(controller.element);
                  controller.activate(${JSON.stringify({ activeModule: "develop", ...binding })});</script>`);
            }
            if (url.pathname === "/controller-tone-curve.js") {
                res.writeHead(200, { "Content-Type": "application/javascript" });
                return res.end(fs.readFileSync(process.env.LRBRIDGE_TONE_CURVE_SOURCE || path.join(root, "app/controller-tone-curve.js")));
            }
            if (url.pathname.startsWith("/api/tone-curve/")) {
                requests.push(req.url);
                const response = await fetch(origin + req.url.replace(/^\/api/, ""));
                const body = await response.text();
                const deliver = () => {
                    res.writeHead(response.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(body);
                };
                if (heldPhase && url.pathname.endsWith("/gesture/" + heldPhase)) {
                    heldAdmissions.push(deliver); return;
                }
                return deliver();
            }
            res.writeHead(404); res.end();
        } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
    });
    const resources = { mock: { server }, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    try {
        await bridge.start(); origin = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const context = await get("/context/update?" + new URLSearchParams({ activeModule: "develop", selectedPhotoUuid: "isolated-add-photo", selectedPhotoKey: "isolated-add-photo", developFingerprint: "fixture-linear" }));
        binding = { selectedPhotoUuid: "isolated-add-photo", contextCounter: context.contextCounter, developCounter: context.developCounter };
        await feedback();
        const base = "http://127.0.0.1:" + await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(target => target.type === "page").webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        async function run(expression) { const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value; }
        async function wait(expression) {
            const until = Date.now() + 5000;
            while (!await run(expression)) {
                if (Date.now() >= until) throw Error("Timed out: " + expression + " " + JSON.stringify(await run("({state:window.controller?.getState(),status:document.getElementById('status')?.textContent})")) + " " + JSON.stringify(requests));
                await pause(20);
            }
        }
        const state = () => run("controller.getState()");
        const preview = () => run("document.querySelector('.point-curve-preview-marker').getAttribute('display')");
        async function refresh() { await wait("!controller.getState().requestInFlight"); await run("controller.refresh()"); }
        async function touch(selector) {
            const point = await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'center'});
                const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        }
        async function admissionHeld() {
            const until = Date.now() + 5000;
            while (!heldAdmissions.length) {
                assert(Date.now() < until, "Admission was not held: "+JSON.stringify(await state())+" "+JSON.stringify(requests));
                await pause(10);
            }
        }
        async function add(armDirectly = false) {
            await cdp.send("Page.bringToFront");
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
            const button = await run("(()=>{const b=document.querySelector('.point-curve-add-button');b.scrollIntoView();const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
            if (armDirectly) await run("document.querySelector('.point-curve-add-button').click()");
            else {
                await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [button] });
                await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            }
            await wait("controller.getState().addPointArmed");
            const rectangle = await run("(()=>{const graph=document.querySelector('.point-curve-graph');graph.scrollIntoView();const r=graph.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()");
            const point = { x: rectangle.x + rectangle.width * 100 / 255, y: rectangle.y + rectangle.height * 105 / 255 };
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await wait("!!controller.getState().awaitingTarget");
        }
        await cdp.send("Page.navigate", { url: base }); await wait("!!window.controller && !!controller.getState().authoritative");
        await add();
        const target = (await state()).awaitingTarget.points;
        const pendingPreview = await preview();
        await pause(15); await feedback(); await refresh();
        assert((await state()).awaitingTarget, "Unchanged SDK heartbeat with a later timestamp must not supersede the insertion");
        assert.equal(pendingPreview, "inline", "Pending Add must remain visibly pending after HTTP admission until SDK feedback");
        assert.equal(await preview(), "inline", "Heartbeat must not erase the pending point");
        assert(!requests.some(request => request.includes("/gesture/cancel?")), "Heartbeat must not send cancellation that deletes queued SDK work");
        const queue = []; for (let command; (command = commands.getNextCommand());) queue.push(command);
        assert.deepEqual(queue.map(command => command.command), ["tone_curve.gesture.begin", "tone_curve.gesture.end"], "Queued insertion must survive heartbeat before SDK dequeue");
        const sdk = sdkExecute(queue, binding);
        assert.deepEqual(sdk.writes, [target], "Production Lua must write the exact intended point once");
        assert.deepEqual(sdk.readback, target, "Production Lua readSnapshot must return the point stored by SDK doubles");
        curves.rgb = sdk.readback; await feedback(); await refresh();
        assert.equal((await state()).awaitingTarget, null, "Only matching SDK feedback confirms addition");
        assert.equal(await preview(), "none");
        assert.equal(await run("document.querySelectorAll('.point-curve-point').length"), 3, "Confirmed point renders as an authoritative handle");

        commands.resetQueueForTests(); requests.length = 0;
        await run("controller.deactivate()"); curves.rgb = linear.slice(); await feedback();
        await run(`controller.activate(${JSON.stringify({ activeModule: "develop", ...binding })})`); await wait("controller.getState().authoritative?.curves.rgb.length===4");
        await add();
        curves.rgb = [0, 0, 80, 50, 255, 255]; await feedback(); await refresh();
        assert.equal((await state()).awaitingTarget, null, "A genuinely changed external curve still supersedes the incompatible insertion");
        assert.equal(await preview(), "none");
        await wait("!controller.getState().requestInFlight"); await pause(40);
        assert(requests.some(request => request.includes("/gesture/cancel?")), "Real external change cancels obsolete work");

        commands.resetQueueForTests(); await run("controller.deactivate()"); curves.rgb = linear.slice(); await feedback();
        await run(`controller.activate(${JSON.stringify({ activeModule: "develop", ...binding })})`); await wait("controller.getState().authoritative?.curves.rgb.length===4");
        await add();
        await run(`controller.applyContext(${JSON.stringify({ activeModule: "develop", selectedPhotoUuid: "different-photo", contextCounter: binding.contextCounter + 1, developCounter: 0 })})`);
        assert.equal((await state()).awaitingTarget, null, "Actual photo/context change retires pending insertion");
        assert.equal(await preview(), "none", "Pending point cannot be presented on another photo");

        const redBaseline = [0, 0, 131, 130, 173, 172, 255, 255], redTarget = [0, 0, 173, 172, 255, 255];
        async function prepareDelete(phase) {
            heldPhase = null; heldAdmissions.splice(0).forEach(release => release());
            await run("controller.deactivate()"); await pause(40); commands.resetQueueForTests(); requests.length = 0;
            curves.red = redBaseline.slice(); await feedback();
            await run(`controller.activate(${JSON.stringify({ activeModule: "develop", ...binding })})`);
            await wait("controller.getState().authoritative?.curves.red.length===8");
            await run("document.querySelector('.point-curve-channel-red').click()");
            await touch('.point-curve-point[data-point-index="1"] .point-curve-hit-target');
            await wait("controller.getState().selectedPointIndex===1 && !controller.getState().gestureActive");
            heldPhase = phase; await touch(".point-curve-delete-button"); await admissionHeld();
        }
        await prepareDelete("begin");
        await feedback(); await refresh();
        assert.equal((await state()).gestureActive, true, "Unchanged feedback must retain Delete admission ownership, not remap a missing drag index");
        assert(!requests.some(request => request.includes("/gesture/cancel?")), "Captured unchanged Red feedback must not cancel queued Delete");
        assert(!requests.some(request => request.includes("/gesture/end?")), "End waits for its own Begin admission");
        heldPhase = "end"; heldAdmissions.splice(0).forEach(release => release()); await admissionHeld();
        await feedback(); await refresh();
        assert.equal((await state()).gestureActive, true, "Unchanged feedback during End admission retains the one-shot owner");
        assert(!requests.some(request => request.includes("/gesture/cancel?")));
        heldPhase = null; heldAdmissions.splice(0).forEach(release => release()); await wait("!!controller.getState().awaitingTarget");
        const deletion = []; for (let command; (command = commands.getNextCommand());) deletion.push(command);
        assert.deepEqual(deletion.map(command => command.command), ["tone_curve.gesture.begin", "tone_curve.gesture.end"]);
        const deleted = sdkExecute(deletion, binding, curves, "red");
        assert.deepEqual(deleted.writes, [redTarget], "Production SDK fixture writes exactly the captured Red deletion target");
        assert.deepEqual(deleted.fields, ["ToneCurvePV2012Red"], "Delete writes only the selected channel");
        assert.deepEqual(deleted.readback, redTarget);
        curves.red = deleted.readback; await feedback(); await refresh();
        assert.equal((await state()).awaitingTarget, null); assert.equal((await state()).selectedPointIndex, null);
        assert.equal(await run("document.querySelectorAll('.point-curve-point').length"), 3);

        await prepareDelete("begin");
        curves.red = [0, 0, 110, 150, 255, 255]; await feedback(); await refresh();
        assert.equal((await state()).gestureActive, false, "A genuinely conflicting external curve still cancels Delete");
        heldPhase = null; heldAdmissions.splice(0).forEach(release => release()); await pause(50);
        assert(!requests.some(request => request.includes("/gesture/end?")), "Late Begin cannot submit cancelled Delete");
        assert.equal((await state()).awaitingTarget, null);
        assert(requests.some(request => request.includes("/gesture/cancel?")));

        await prepareDelete("begin");
        await run(`controller.applyContext(${JSON.stringify({ activeModule: "develop", ...binding, developCounter: binding.developCounter + 1 })})`);
        heldPhase = null; heldAdmissions.splice(0).forEach(release => release()); await pause(50);
        assert(!requests.some(request => request.includes("/gesture/end?")), "A real Develop binding change before End cannot submit stale deletion");
        assert.equal((await state()).awaitingTarget, null);

        for (const phase of ["begin", "end"]) {
            await prepareDelete(phase);
            await run(`controller.applyContext(${JSON.stringify({ activeModule: "develop", selectedPhotoUuid: "different-photo", contextCounter: binding.contextCounter + 1, developCounter: 0 })})`);
            await run("document.getElementById('status').textContent='New photo status'");
            heldPhase = null; heldAdmissions.splice(0).forEach(release => release()); await pause(50);
            assert.equal((await state()).awaitingTarget, null, "Late " + phase + " admission cannot recreate obsolete Delete");
            assert.equal(await run("document.getElementById('status').textContent"), "New photo status", "Late admission must not overwrite another context's status");
            if (phase === "begin") assert(!requests.some(request => request.includes("/gesture/end?")));
        }
        const nativeBlue = require("./fixtures/deep-blue-native-curve.json").curves.blue;
        for (const native of [nativeBlue, [0,34,...nativeBlue.slice(2,-2),253,223], [2,34,...nativeBlue.slice(2,-2),253,223]]) {
            for (const operation of ["add", "delete", "drag"]) {
                heldPhase = null; heldAdmissions.splice(0).forEach(release => release());
                await run("controller.deactivate()"); await pause(40); commands.resetQueueForTests(); requests.length=0;
                curves.blue = native.slice(); await feedback();
                await run(`controller.activate(${JSON.stringify({activeModule:"develop",...binding})})`);
                await wait("JSON.stringify(controller.getState().authoritative?.curves.blue)==="+JSON.stringify(JSON.stringify(native)));
                await wait("!controller.getState().requestInFlight");
                await run("document.querySelector('.point-curve-channel-blue').click()");
                assert.equal(await run("document.querySelector('.point-curve-add-button').disabled"), false);
                if (operation === "add") await add(true);
                if (operation === "delete") {
                    await run("document.querySelectorAll('.point-curve-hit-target')[2].dispatchEvent(new MouseEvent('click',{bubbles:true}))");
                    await touch(".point-curve-delete-button"); await wait("!!controller.getState().awaitingTarget");
                }
                if (operation === "drag") {
                    // Hold only the HTTP acknowledgement so the actual touch
                    // lifecycle submits one terminal edit, not intermediate writes.
                    heldPhase="begin";
                    const coordinates=await run("(()=>{const g=document.querySelector('.point-curve-graph');g.scrollIntoView({block:'center'});const m=g.getScreenCTM();return {a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f}})()");
                    const contact=(x,y)=>({x:coordinates.a*x+coordinates.c*(255-y)+coordinates.e,
                        y:coordinates.b*x+coordinates.d*(255-y)+coordinates.f});
                    const hit=contact(native[4],native[5]);
                    assert.equal(await run(`document.elementFromPoint(${hit.x},${hit.y})?.classList.contains('point-curve-hit-target')`),true,
                        JSON.stringify(await run(`(()=>{const e=document.elementFromPoint(${hit.x},${hit.y});return {hit:${JSON.stringify(hit)},element:e?.outerHTML,status:document.getElementById('status').textContent,state:controller.getState()}})()`)));
                    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[contact(native[4],native[5])]});
                    await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[contact(130,160)]});
                    await admissionHeld();
                    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
                    heldPhase=null;heldAdmissions.splice(0).forEach(release=>release());
                    await wait("!!controller.getState().awaitingTarget");
                }
                const target=(await state()).awaitingTarget.points;
                assert.equal(target[0],native[0]);assert.equal(target[target.length-2],native[native.length-2]);
                const untouched=operation==="add"?target.filter((_,i)=>i<4||i>=6):
                    operation==="delete"?[...native.slice(0,4),...native.slice(6)]:
                    target.filter((_,i)=>i<4||i>=6);
                if(operation==="add")assert.deepEqual(untouched,native);
                if(operation==="delete")assert.deepEqual(target,untouched);
                if(operation==="drag"){
                    assert.deepEqual(untouched,native.filter((_,i)=>i<4||i>=6));
                    assert.deepEqual(target.slice(4,6),[130,160]);
                }
                await feedback();await refresh();
                assert((await state()).awaitingTarget,"An unchanged native heartbeat cannot erase the pending inset edit");
                assert(!requests.some(url=>url.includes("/gesture/cancel?")),"Native endpoint shape must not cancel a pending point edit");
                const queue=[];for(let command;(command=commands.getNextCommand());)queue.push(command);
                assert.deepEqual(queue.map(c=>c.command),["tone_curve.gesture.begin","tone_curve.gesture.end"]);
                const sdk=sdkExecute(queue,binding,curves,"blue");
                assert.deepEqual(sdk.writes,[target]);assert.deepEqual(sdk.fields,["ToneCurvePV2012Blue"]);
                assert.deepEqual(sdk.readback,target);curves.blue=sdk.readback;
                await feedback();await refresh();assert.equal((await state()).awaitingTarget,null);
                assert.deepEqual((await state()).authoritative.curves.blue,target);
            }
        }
        assert.deepEqual(exceptions, []);
        console.log("Point Curve Add/Delete/drag regression passed: rendered native inset touches, unchanged feedback during Begin/End admission, exact production HTTP/queue/Lua write/readback and selected-channel scope, external curve/photo changes and late admission ownership.");
    } finally { heldAdmissions.splice(0).forEach(release => release()); await browser.cleanup(resources); await bridge.stop(); commands.resetQueueForTests(); }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
