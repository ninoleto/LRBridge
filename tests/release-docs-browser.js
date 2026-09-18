"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
const browser=require("./controller-browser-lifecycle");
const root=path.resolve(__dirname,".."),errors=[];
const staticFiles={"/help":"app/controller-help.html","/builder":"app/companion-cheatsheet.html","/controller-http-inventory.js":"app/controller-http-inventory.js"};
const bodies={"/api/help":{operationInventory:require("../server/http-operations.json")},"/api/sliders":{sliders:require("../config/sliders.json")},"/api/color-grading":{colorGrading:require("../server/color-grading").getMetadata()}};
const server=http.createServer((req,res)=>{
    const url=new URL(req.url,"http://fixture");if(req.method!=="GET") throw Error("Unexpected mutation request");
    if(bodies[url.pathname]) {res.setHeader("Content-Type","application/json");res.end(JSON.stringify(bodies[url.pathname]));return;}
    const file=staticFiles[url.pathname];if(file){res.setHeader("Content-Type",file.endsWith(".js")?"application/javascript":"text/html");res.end(fs.readFileSync(path.join(root,file)));return;}
    if(url.pathname==="/favicon.ico"){res.writeHead(204);res.end();return;}
    errors.push(req.url);res.writeHead(404);res.end();
});
(async()=>{
    const resources={mock:{server},browser:null,browserCdp:null,pageCdp:null,browserProfileDirectory:null};
    try {
        const port=await browser.listen(server);resources.browserProfileDirectory=browser.createBrowserProfileDirectory();
        resources.browser=browser.launchBrowser(browser.findBrowserExecutable(),resources.browserProfileDirectory);
        const dev=await browser.waitForDevTools(resources.browser,resources.browserProfileDirectory);
        resources.browserCdp=await browser.connectCdp(dev.browserWebSocketUrl);
        const targets=await (await fetch(dev.debugUrl+"/json/list")).json();resources.pageCdp=await browser.connectCdp(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
        const cdp=resources.pageCdp;await cdp.send("Runtime.enable");await cdp.send("Page.enable");
        cdp.onEvent=m=>{if(m.method==="Runtime.exceptionThrown")errors.push(JSON.stringify(m.params));};
        async function evaluate(expression){const r=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
        for(const width of [1280,390]) for(const page of ["help","builder"]) {
            await cdp.send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<500});
            await cdp.send("Page.navigate",{url:"http://127.0.0.1:"+port+"/"+page});
            let ready=false;for(let n=0;n<100;n++){ready=await evaluate(page==="builder"?'!!document.querySelector("#httpInventory input[type=search]")':'document.body && document.body.textContent.includes("Windows v0.6 beta")');if(ready)break;await new Promise(r=>setTimeout(r,50));}assert(ready);
            if(page==="builder") {
                await evaluate('document.querySelector("#httpInventory").closest("details").open=true;const input=document.querySelector("#httpInventory input[type=search]");input.value="clipboard";input.dispatchEvent(new Event("input"));input.focus();');
                assert.match(await evaluate('document.querySelector("#httpInventory").textContent'),/clipboard\/action/);
                assert.match(await evaluate('document.querySelector("#httpInventory").textContent'),/Not generated as a permanent URL/);
                assert.equal(await evaluate('document.querySelectorAll("#httpInventory button").length'),0);
                assert.equal(await evaluate('document.activeElement.type'),"search");
            }
            const geometry=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
            assert.equal(geometry.width,width,"mobile page must use the device viewport, not scaled desktop text");
            assert(geometry.scroll<=geometry.width+1,JSON.stringify({page,width,geometry}));
            if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS){fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,{recursive:true});const shot=await cdp.send("Page.captureScreenshot",{format:"png"});fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,page+"-"+width+".png"),Buffer.from(shot.data,"base64"));}
        }
        assert.deepEqual(errors,[]);console.log("Help/Builder rendered at desktop and phone widths: inventory filter, focus, non-action workflow guidance and no horizontal page overflow passed.");
    } finally {await browser.cleanup(resources);}
})().catch(e=>{console.error(e);process.exitCode=1;});
