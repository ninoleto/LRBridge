"use strict";

// Focused presentation/admission check. Production Controller/CSS, isolated
// synthetic feedback only; no running bridge, recorder or Lightroom connection.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const browser = require("./controller-browser-lifecycle");
const { snapshot } = require("./mask-point-color-confirmation");
const context = { activeModule: "develop", selectedPhotoUuid: "photo-a", contextCounter: 4, developCounter: 7, contextChangedAt: 10 };
const initial = { ok: true, ...snapshot(), ...context, serverEpoch: "ui-fixture", revision: 1,
    editFeedbackSequence: 0, lastEditResult: null, pendingOperation: null, lastResult: null };
const sourceFiles = ["controller-masking-corrections.js", "controller-tone-curve.js", "controller-point-color.js", "controller-masking.js", "controller-remove.js"];
const html = fs.readFileSync(path.join(__dirname, "../app/controller.html"), "utf8");
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
const message = "Wait for the current adjustment to finish, then try again.";
const panelHelp = "If Masking opens in Lightroom Classic but the controls here remain unavailable, select a mask in Lightroom Classic. If that does not help, click Close Masking in this Web Controller. Then click the same button again when it shows Open Masking.";
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}\n#layout{max-width:1100px;margin:auto}</style>
<main id="layout" class="content"><div id="dust"></div><div id="host"></div></main><div id="remove-base" hidden></div>
${sourceFiles.map(name => '<script src="/' + name + '"></script>').join("\n")}
<script>
const fixture={state:${JSON.stringify(initial)},context:${JSON.stringify(context)},commands:[],visualizeRequests:[],requests:[],failToggle:false};
fixture.remove={ok:true,...fixture.context,serverEpoch:'dust-fixture',revision:1,available:true,ageMs:0,
 selectedTool:'dust',newSpotType:'heal',brushSize:25,brushFeather:50,visualizeSpots:false,visualizationThreshold:50,
 dust:{available:false,canEnable:true,canDisable:true,canRequestClose:true,token:'a'.repeat(64)},repair:{available:false}};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>JSON.parse(JSON.stringify(data))});
const fetchFixture=async(request)=>{
 const url=new URL(request,location.href);
 fixture.requests.push(url.pathname);
 if(url.pathname==='/api/masking/state')return response(fixture.state);
 if(url.pathname==='/api/masking/presets')return response({ok:true,presets:[]});
 if(url.pathname==='/api/remove/state')return response(fixture.remove);
 if(url.pathname==='/api/masking/point-color/value'){
  fixture.commands.push(Object.fromEntries(url.searchParams));return response({ok:true,editSequence:fixture.commands.length});
 }
 if(url.pathname==='/api/masking/point-color/range-visualization/toggle'){
  fixture.visualizeRequests.push(Object.fromEntries(url.searchParams));
  if(fixture.failToggle)return response({ok:false,error:'fixture visualization rejection'},409);
  const operationId='visualize-'+fixture.visualizeRequests.length;
  fixture.state.revision++;fixture.state.pendingOperation={operationId,kind:'pointColorVisualize'};
  return response({...fixture.state,operationId});
 }
 throw Error('Unexpected isolated request: '+url.pathname);
};
const controller=LRBridgeControllerMasking.createController({document,getContext:()=>fixture.context,fetch:fetchFixture,setInterval:()=>1,clearInterval:()=>{}});
controller.activate(document.getElementById('host'));
const removeController=LRBridgeControllerRemove.createController({document,getContext:()=>fixture.context,fetch:fetchFixture});
removeController.activate(document.getElementById('remove-base'));removeController.mountDust(document.getElementById('dust'));
const toggle=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Toggle Visualize Range');
const visualizeStatus=()=>document.querySelector('.masking-point-color-visualize-status')?.textContent || '';
const settleEdit=async()=>{
 const command=fixture.commands.at(-1);fixture.state.pointColor[command.field]=Number(command.value);
 fixture.state.revision++;fixture.state.editFeedbackSequence=fixture.commands.length;
 fixture.state.lastEditResult={sequence:fixture.commands.length,kind:'masking.point_color.value.set',maskGroupId:'mask-a',outcome:'confirmed'};
 await controller.refresh();
};
</script>`;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://isolated.test");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(page); }
    if (sourceFiles.includes(url.pathname.slice(1))) {
        res.setHeader("Content-Type", "application/javascript");
        const file = url.pathname === "/controller-masking.js" && process.env.LRBRIDGE_MASKING_UI_SOURCE || path.join(__dirname, "../app", url.pathname.slice(1));
        return res.end(fs.readFileSync(file));
    }
    res.statusCode = 404; res.end();
});

(async () => {
    const resources = { mock: { server }, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const errors = [], layouts = [], artifacts = process.env.LRBRIDGE_UI_ARTIFACTS;
    try {
        const port = await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const target = (await (await fetch(dev.debugUrl + "/json/list")).json()).find(t => t.type === "page");
        const cdp = resources.pageCdp = await browser.connectCdp(target.webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable");
        const evaluate = async expression => {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        const waitFor = async expression => {
            const end = Date.now() + 6000;
            while (!await evaluate(expression)) { if (Date.now() > end) throw Error("Timed out: " + expression); await new Promise(r => setTimeout(r, 20)); }
        };
        const capture = async (selector, name) => {
            if (!artifacts) return;
            fs.mkdirSync(artifacts, { recursive: true });
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'});window.scrollBy(0,-20)`);
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            fs.writeFileSync(path.join(artifacts, name + ".png"), Buffer.from(png.data, "base64"));
        };
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port });
        if (process.argv.includes("--close-colors-only")) {
            await waitFor("!!document.querySelector('#host .masking-panel-button')&&!!document.querySelector('[data-remove-panel=true]')");
            await evaluate("document.querySelector('#remove-base').hidden=false;document.querySelector('#layout').prepend(document.querySelector('#remove-base'))");
            for (const width of [1280, 390, 320]) {
                await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 760 });
                await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 760 });
                // Change only synthetic authoritative readback, never click an
                // operation or reopen unrelated Point Color/Curve checks.
                for (const close of [true, false, true]) {
                    await evaluate(`fixture.state.active=${close};fixture.state.revision++;
                        fixture.remove.selectedTool=${JSON.stringify(close ? "dust" : "loupe")};fixture.remove.revision++;
                        Promise.all([controller.refresh(),removeController.refresh()])`);
                    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                    const layout = await evaluate(`(()=>{
                        const button=selector=>{const e=document.querySelector(selector),s=getComputedStyle(e),b=e.getBoundingClientRect();
                            return {text:e.textContent,positive:e.classList.contains('positive'),danger:e.classList.contains('command-danger'),
                                background:s.backgroundColor,border:s.borderColor,color:s.color,disabled:e.disabled,height:b.height};};
                        return {width:innerWidth,close:${close},overflow:document.documentElement.scrollWidth>innerWidth,
                            masking:button('#host .masking-panel-button'),healing:button('[data-remove-panel=true]')};
                    })()`);
                    assert.equal(layout.width, width);
                    assert.equal(layout.overflow, false, "Open/Close controls do not overflow at " + width);
                    for (const [name, button] of [["Masking", layout.masking], ["Healing Tool", layout.healing]]) {
                        assert.equal(button.text, (close ? "Close " : "Open ") + name);
                        assert.equal(button.disabled, false, "Fresh readback keeps the panel action available");
                        assert.equal(button.positive, !close, "Preserve the existing positive class only for Open " + name);
                        assert.equal(button.danger, close, "Use existing danger class only for Close " + name);
                        assert.equal(button.background, close ? "rgb(116, 47, 58)" : "rgb(42, 111, 151)");
                        assert.equal(button.border, close ? "rgb(154, 68, 82)" : "rgb(58, 140, 192)");
                        if (close) assert.equal(button.color, "rgb(255, 255, 255)");
                        assert(button.height >= 44, "Preserve comfortable panel-button touch targets");
                    }
                    layouts.push(layout);
                    if (layouts.filter(row => row.width === width && row.close === close).length === 1) {
                        await capture(".remove-action-row", "healing-" + (close ? "close" : "open") + "-" + width);
                        await capture(".masking-panel-row", "masking-" + (close ? "close" : "open") + "-" + width);
                    }
                }
            }
            assert.deepEqual(errors, []);
            assert.equal(await evaluate("fixture.commands.length+fixture.visualizeRequests.length"), 0);
            assert.equal(await evaluate("fixture.requests.every(path=>['/api/masking/state','/api/masking/presets','/api/masking/tone-curve/state','/api/remove/state'].includes(path))"), true,
                "Color checks send only synthetic feedback reads and no adjustment/Reset/panel commands: " + await evaluate("JSON.stringify(fixture.requests)"));
            if (artifacts) fs.writeFileSync(path.join(artifacts, "close-colors-results.json"), JSON.stringify(layouts, null, 2));
            console.log("PASS Masking and Healing authoritative Close/Open/Close color transitions: existing red Close and unchanged blue Open; desktop 1280 and touch 390/320 without overflow or edits. Synthetic browser only.");
            return;
        }
        await waitFor("!!document.querySelector('[data-point-color-field=HueShift] input')&&!toggle().disabled");
        // Pending input before debounce and an admitted edit awaiting confirmation
        // both explain the guard; neither click queues or dispatches a toggle.
        const beforeDispatch = await evaluate(`(()=>{
            const range=document.querySelector('[data-point-color-field=HueShift] input[type=range]');
            range.value='65';range.dispatchEvent(new Event('input',{bubbles:true}));toggle().click();
            return {message:visualizeStatus(),requests:fixture.visualizeRequests.length};
        })()`);
        assert.equal(beforeDispatch.message, message, "A pending-adjustment click must explain why no toggle was sent");
        assert.equal(beforeDispatch.requests, 0);
        await evaluate("document.querySelector('[data-point-color-field=HueShift] input[type=range]').dispatchEvent(new Event('change',{bubbles:true}))");
        await waitFor("fixture.commands.length===1&&!controller.getInteractionState().pointColor.writeInFlight");
        await evaluate("toggle().click()");
        await waitFor("!toggle().disabled");
        assert.equal(await evaluate("visualizeStatus()"), message);
        assert.equal(await evaluate("fixture.visualizeRequests.length"), 0);
        if (!process.argv.includes("--message-only")) {
            for (const width of [1280, 390, 320]) {
                await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 760 });
                await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 760 });
                await evaluate("removeController.refresh()");
                const layout = await evaluate(`(()=>{
                    const box=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,bg:s.backgroundColor,color:s.color,disabled:e.disabled};};
                    const help=document.querySelector('.masking-panel-help');
                    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
                        overflowElements:[...document.querySelectorAll('#layout *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth)
                            .map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})),
                        buttons:[...document.querySelectorAll('.dust-toggle-row>button')].map(box),
                        dustWidth:document.querySelector('.dust-controls').getBoundingClientRect().width,
                        help:help.textContent,helpAfterPanel:help.previousElementSibling.className,helpBox:box(help),
                        statusBox:box(document.querySelector('.masking-point-color-visualize-status'))};
                })()`);
                if (artifacts) fs.writeFileSync(path.join(artifacts, "layout-" + width + ".json"), JSON.stringify(layout, null, 2));
                assert.equal(layout.width, width); assert.equal(layout.overflow, false, "No horizontal overflow at " + width);
                assert.equal(layout.help, panelHelp); assert.equal(layout.helpAfterPanel, "masking-panel-row");
                assert.equal(layout.buttons.length, 2);
                const [on, off] = layout.buttons;
                assert.equal(on.y, off.y); assert(off.x >= on.x + on.width + 7);
                assert(on.width >= 44 && on.width <= 120 && on.height >= 44 && off.height >= 44);
                assert.equal(on.disabled, false); assert.equal(off.disabled, false);
                assert.equal(on.bg, "rgb(35, 126, 120)"); assert.equal(off.bg, "rgb(164, 67, 67)");
                for (const box of [layout.helpBox, layout.statusBox]) assert(box.x >= 0 && box.x + box.width <= width);
                layouts.push(layout);
                await capture(".dust-controls", "dust-enabled-" + width);
                await capture(".masking-panel-row", "masking-help-" + width);
                await capture(".masking-point-color #pointColorVisualizeRange", "point-color-wait-" + width);
            }
            await evaluate("fixture.remove.dust.canEnable=false;fixture.remove.dust.canDisable=false;fixture.remove.revision++;removeController.refresh()");
            await waitFor("[...document.querySelectorAll('.dust-toggle-row>button')].every(b=>b.disabled)");
            const disabled = await evaluate("[...document.querySelectorAll('.dust-toggle-row>button')].map(b=>({bg:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color}))");
            assert(disabled.every(b => b.bg === "rgb(68, 68, 68)" && b.color === "rgb(187, 187, 187)"));
            await capture(".dust-controls", "dust-disabled-320");
            await evaluate("fixture.remove.dust.canEnable=true;fixture.remove.dust.canDisable=true;fixture.remove.revision++;removeController.refresh()");
            await waitFor("[...document.querySelectorAll('.dust-toggle-row>button')].every(b=>!b.disabled)");
        }
        await evaluate("settleEdit()");
        await waitFor("!controller.getInteractionState().correctionBusy");
        assert.equal(await evaluate("visualizeStatus()"), "", "The explanation clears when adjustment feedback settles");
        assert.equal(await evaluate("fixture.visualizeRequests.length"), 0, "No automatic retry after adjustment finishes");
        await evaluate("toggle().click()");
        await waitFor("fixture.visualizeRequests.length===1&&controller.getInteractionState().activeOperation?.operationId==='visualize-1'");
        assert.equal(await evaluate("toggle().getAttribute('aria-pressed')"), null, "No invented native On/Off state");
        await evaluate("fixture.state.lastResult={operationId:'visualize-1',kind:'pointColorVisualize',outcome:'confirmed'};fixture.state.pendingOperation=null;fixture.state.revision++;controller.refresh()");
        await waitFor("!controller.getInteractionState().activeOperation&&!toggle().disabled");
        await evaluate("fixture.failToggle=true;toggle().click()");
        await waitFor("fixture.visualizeRequests.length===2&&!controller.getInteractionState().activeOperation");
        assert.match(await evaluate("document.querySelector('.masking-status').textContent"), /Visualize Range is no longer available/, "A real request error remains visible");
        assert.equal(await evaluate("toggle().getAttribute('aria-pressed')"), null);
        assert.deepEqual(errors, []);
        if (artifacts) fs.writeFileSync(path.join(artifacts, "layout-results.json"), JSON.stringify(layouts, null, 2));
        console.log("PASS pending debounce/admitted adjustment explanation; zero blocked/automatic toggle requests; later explicit toggle admitted and confirmed; real HTTP rejection visible. Simulated Lightroom only.");
        if (layouts.length) console.log("PASS desktop 1280 and touch 390/320: compact 116x44 Dust buttons, teal/red enabled, grey disabled, Masking help and pending message fit without horizontal overflow.");
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error); process.exitCode = 1; });
