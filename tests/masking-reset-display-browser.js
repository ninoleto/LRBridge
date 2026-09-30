"use strict";

// Production regular Masking renderer/CSS in isolated Chromium with delayed,
// simulated feedback. Never connects to the source app, recorder or Lightroom.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const browser = require("./controller-browser-lifecycle");
const { context, snapshot } = require("./masking");
const sourceFiles = ["controller-masking-corrections.js", "controller-tone-curve.js", "controller-point-color.js", "controller-masking.js"];
const html = fs.readFileSync(path.join(__dirname, "../app/controller.html"), "utf8");
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
const initial = { ok:true, ...snapshot({ corrections:[{parameter:"local_Grain",value:-28,min:-100,max:100}] }),
    ...context(), serverEpoch:"reset-display-fixture", revision:1, correctionFeedbackSequence:0, correctionResults:[] };
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}\nbody{padding:20px}#host{max-width:1100px;margin:auto}</style><div id="host"></div>
${sourceFiles.map(name => '<script src="/' + name + '"></script>').join("\n")}
<script>
const fixture={state:${JSON.stringify(initial)},context:${JSON.stringify(context())},requests:[],holdReset:false,frames:[],assignments:[]};
const controller=LRBridgeControllerMasking.createController({document,getContext:()=>fixture.context,setInterval:()=>1,clearInterval:()=>{},
 fetch:async(url)=>{
  let data;
  if(url==='/api/masking/state') data=fixture.state;
  else {
   const parsed=new URL(url,location.href);
   if(!parsed.pathname.startsWith('/api/masking/correction/')) throw Error('Unexpected fixture route: '+url);
   const kind=parsed.pathname.split('/').pop();
   fixture.requests.push({kind,...Object.fromEntries(parsed.searchParams)});
   data={ok:true,correctionSequence:fixture.requests.length};
   if(kind==='reset'&&fixture.holdReset) await new Promise(resolve=>fixture.releaseReset=resolve);
  }
  return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data))};
 }});
controller.activate(document.getElementById('host'));
const row=()=>document.querySelector('[data-masking-correction=local_Grain]');
const range=()=>row().querySelector('input[type=range]');
const number=()=>row().querySelector('input[type=text]');
const status=()=>row().querySelector('.develop-slider-state').textContent;
const reset=()=>row().querySelector('button.reset');
const complete=(index,value)=>{
 const request=fixture.requests[index];
 fixture.state.corrections[0].value=value;
 const result={sequence:index+1,gestureId:request.gestureId,parameter:'local_Grain',maskGroupId:fixture.state.selectedMaskGroupId,
  kind:request.kind==='reset'?'masking.correction.reset':'masking.correction.gesture.end',outcome:'confirmed',detail:null,completedAt:Date.now()};
 fixture.state.correctionResults=[result];fixture.state.lastCorrectionResult=result;
 fixture.state.correctionFeedbackSequence=index+1;fixture.state.revision++;
};
const start=value=>{
 const r=range();r.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch'}));
 r.value=String(value);r.dispatchEvent(new Event('input',{bubbles:true}));
};
const end=()=>range().dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch'}));
const observe=()=>{
 const native=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
 for(const element of [range(),number()]) Object.defineProperty(element,'value',{
  get(){return native.get.call(this);},set(value){const before=native.get.call(this);native.set.call(this,value);
   if(before!==native.get.call(this))fixture.assignments.push({at:performance.now(),type:this.type,before,after:native.get.call(this)});}});
 fixture.recordFrames=true;
 const frame=()=>{if(!fixture.recordFrames)return;fixture.frames.push({range:range().value,number:number().value,status:status()});requestAnimationFrame(frame);};
 requestAnimationFrame(frame);
};
</script>`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://isolated.test");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(page); }
    if (sourceFiles.includes(url.pathname.slice(1))) {
        res.setHeader("Content-Type", "application/javascript");
        return res.end(fs.readFileSync(path.join(__dirname, "../app", url.pathname.slice(1))));
    }
    res.statusCode = 404; res.end();
});

(async () => {
    const resources = {mock:{server}, browser:null, browserCdp:null, pageCdp:null, browserProfileDirectory:null};
    const errors = [], artifacts = process.env.LRBRIDGE_RESET_DISPLAY_ARTIFACTS;
    try {
        const port = await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const target = (await (await fetch(dev.debugUrl + "/json/list")).json()).find(t=>t.type==="page");
        const cdp = resources.pageCdp = await browser.connectCdp(target.webSocketDebuggerUrl);
        cdp.onEvent = event => {if(event.method==="Runtime.exceptionThrown")errors.push(event.params.exceptionDetails);};
        await cdp.send("Runtime.enable");
        const evaluate = async expression => {
            const r=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
            if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
            return r.result.value;
        };
        const waitFor = async expression => {
            for(let n=0;n<100;n++) {
                if(await evaluate(expression))return;
                await new Promise(resolve=>setTimeout(resolve,25));
            }
            throw Error("Timed out: "+expression);
        };
        const capture = async name => {
            if(!artifacts)return;
            fs.mkdirSync(artifacts,{recursive:true});
            await evaluate("row().scrollIntoView({block:'center'})");
            const clip=await evaluate("(()=>{const r=row().getBoundingClientRect();return {x:Math.max(0,r.x-8)+scrollX,y:Math.max(0,r.y-35)+scrollY,width:r.width+16,height:r.height+70,scale:1};})()");
            const png=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip});
            fs.writeFileSync(path.join(artifacts,name+".png"),Buffer.from(png.data,"base64"));
        };
        await cdp.send("Page.navigate",{url:"http://127.0.0.1:"+port});
        await waitFor("!!row()&&!range().disabled");
        await evaluate("start(-14);end()");
        await waitFor("fixture.requests.some(r=>r.kind==='end')&&!reset().disabled");
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate("controller.getState().corrections[0].value"),-28,"browser still holds the older parent");
        const immediate = await evaluate("complete(fixture.requests.findLastIndex(r=>r.kind==='end'),-14);fixture.holdReset=true;observe();reset().click();[range().value,number().value]");
        await capture("reset-admission");
        assert.deepEqual(immediate,["-14","-14"],"captured -14 must not be replaced by -28 at Reset click");
        await evaluate("controller.refresh()"); // delayed preceding edit confirmation
        await new Promise(resolve=>setTimeout(resolve,250));
        await evaluate("fixture.releaseReset();fixture.holdReset=false");
        await waitFor("status()==='Resetting…'");
        // A scalar read alone is insufficient; wait for Reset's matching result.
        await evaluate("fixture.state.corrections[0].value=0;fixture.state.revision++;controller.refresh()");
        await new Promise(resolve=>setTimeout(resolve,450));
        await capture("reset-pending-desktop");
        await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await capture("reset-pending-narrow");
        const held=await evaluate("fixture.recordFrames=false;({frames:fixture.frames,assignments:fixture.assignments,status:status()})");
        if(artifacts)fs.writeFileSync(path.join(artifacts,"delayed-feedback.json"),JSON.stringify(held,null,2)+"\n");
        assert.ok(held.frames.length>10,"sample actual rendering frames during delayed feedback");
        assert.ok(held.frames.every(r=>r.range==="-14"&&r.number==="-14"),"stale/unconfirmed values never replace the held display");
        assert.equal(held.assignments.length,0,"also reject transient assignments between sampled frames");
        assert.equal(held.status,"Resetting…");
        await evaluate("complete(fixture.requests.findLastIndex(r=>r.kind==='reset'),37);controller.refresh()");
        assert.deepEqual(await evaluate("[range().value,number().value,status()]"),["37","37",""]);
        await capture("reset-confirmed-narrow");
        await evaluate("reset().click()");await waitFor("status()==='Resetting…'");
        await evaluate("start(55)");
        await evaluate("complete(fixture.requests.findLastIndex(r=>r.kind==='reset'),0);controller.refresh()");
        assert.deepEqual(await evaluate("[range().value,number().value]"),["55","55"],"newer input owns display over Reset feedback");
        await evaluate("end()");await waitFor("fixture.requests.at(-1).kind==='end'&&fixture.requests.at(-1).value==='55'");
        await evaluate("complete(fixture.requests.length-1,55);controller.refresh()");
        await waitFor("status()===''");
        assert.deepEqual(errors,[]);
        console.log("PASS isolated Masking Reset rendered handoff: "+held.frames.length+" delayed-feedback frames, no old assignments, nonzero confirmation and newer input; no native edits.");
    } finally {await browser.cleanup(resources);}
})().catch(error=>{console.error(error);process.exitCode=1;});
