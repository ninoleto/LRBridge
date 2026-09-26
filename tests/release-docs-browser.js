"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
const browser=require("./controller-browser-lifecycle");
const checkBuilder=require("./http-builder-browser-checks");
const root=path.resolve(__dirname,".."),errors=[];
const helpOnly=process.argv.includes("--help-only");
const builderToolbarOnly=process.argv.includes("--builder-toolbar-only");
const builderStepHelpOnly=process.argv.includes("--builder-step-help-only");
const builderTabsOnly=process.argv.includes("--builder-tabs-only");
const builderPresentationOnly=process.argv.includes("--builder-presentation-only")||builderToolbarOnly||builderStepHelpOnly||builderTabsOnly;
const builderOnly=process.argv.includes("--builder-only")||builderPresentationOnly;
const staticFiles={"/help":"app/controller-help.html","/builder":"app/companion-cheatsheet.html","/controller-http-inventory.js":"app/controller-http-inventory.js"};
for(const name of ["HTTP_WORKFLOWS.md","HTTP_OPERATIONS.md","WINDOWS_BETA.md"]) staticFiles["/reference/"+name]="docs/"+name;
const bodies={"/api/help":{operationInventory:require("../server/http-operations.json")},"/api/sliders":{sliders:require("../config/sliders.json")},"/api/color-grading":{colorGrading:require("../server/color-grading").getMetadata()}};
const unavailable=new Set();
let reversedMetadata=false;
const server=http.createServer((req,res)=>{
    const url=new URL(req.url,"http://fixture");if(req.method!=="GET") throw Error("Unexpected mutation request");
    if(unavailable.has(url.pathname)) {res.writeHead(503);res.end();return;}
    if(bodies[url.pathname]) {
        const body=builderToolbarOnly&&reversedMetadata&&url.pathname==='/api/sliders'?{sliders:[...bodies[url.pathname].sliders].reverse()}:bodies[url.pathname];
        const delay=builderToolbarOnly&&url.pathname===(reversedMetadata?'/api/color-grading':'/api/sliders')?150:0;
        setTimeout(()=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify(body));},delay);return;
    }
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
        const widths=(builderToolbarOnly||builderTabsOnly)&&process.env.LRBRIDGE_BUILDER_WIDTHS?process.env.LRBRIDGE_BUILDER_WIDTHS.split(',').map(Number):builderStepHelpOnly||builderTabsOnly?[1280,390,320]:builderToolbarOnly?[1280,1001,1000,999,861,860,859,621,620,619,521,520,519,390,320]:builderPresentationOnly?[1280,768,390,320]:[1280,390,320];
        assert(widths.every(width=>Number.isInteger(width)&&width>=320),'valid test widths');
        let collectionOrder;
        for(const width of widths) for(const page of helpOnly?["help"]:builderOnly?["builder"]:["help","builder"]) {
            reversedMetadata=width<=520;
            await cdp.send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<500});
            await cdp.send("Page.navigate",{url:"http://127.0.0.1:"+port+"/"+page});
            let ready=false;for(let n=0;n<100;n++){ready=await evaluate(page==="builder"?'document.body.dataset.ready==="true"':'!!document.querySelector("#support-development")');if(ready)break;await new Promise(r=>setTimeout(r,50));}assert(ready);
            if(page==="builder") {
                if(builderTabsOnly) await require('./http-builder-tabs')({run:evaluate,cdp,width});
                else await checkBuilder({evaluate,cdp,width,presentationOnly:builderPresentationOnly,toolbarOnly:builderToolbarOnly,stepHelpOnly:builderStepHelpOnly});
                if(builderToolbarOnly) {
                    const order=await evaluate('Array.from(document.querySelectorAll(".card")).map(c=>c.dataset.cardId)');
                    if(collectionOrder) assert.deepEqual(order,collectionOrder,'metadata arrival/slider order cannot change collection order');
                    collectionOrder=order;
                }
                for(const href of builderPresentationOnly?[]:["/reference/HTTP_WORKFLOWS.md"]) {
                    const response=await fetch("http://127.0.0.1:"+port+href);
                    assert.equal(response.status,200,href);
                    assert.equal(await response.text(),fs.readFileSync(path.join(root,"docs/HTTP_WORKFLOWS.md"),"utf8"));
                }
            } else {
                const headings=await evaluate('Array.from(document.querySelector("main").children).flatMap(el=>{if(el.matches("h2"))return [el.textContent];if(el.matches("section")&&!el.previousElementSibling?.matches("h2")){const heading=el.querySelector(":scope > h2, :scope > h3");return heading?[heading.textContent]:[];}return [];})');
                assert.deepEqual(headings,[
                    "What the Web Controller is for", "Security and network exposure",
                    "Bitfocus Companion integration methods", "PowerShell example", "Web Controller and API ports",
                    "Known issues and limitations", "Set up the Lightroom plug-in", "Support development"
                ],"the original idea belongs in the introduction, delays in Known issues, and support stays last");
                const layout=await evaluate(`(()=>{
                    const reference=Array.from(document.querySelectorAll("main > h2")).find(h=>h.textContent==="Bitfocus Companion integration methods");
                    const measure=heading=>{
                        const box=heading.nextElementSibling,style=getComputedStyle(heading),rect=heading.getBoundingClientRect(),boxRect=box.getBoundingClientRect(),previous=heading.previousElementSibling;
                        return {id:heading.id,outside:heading.parentElement.tagName==="MAIN"&&box.matches("section.box"),label:box.getAttribute("aria-labelledby"),color:style.color,divider:style.borderBottomWidth+" "+style.borderBottomStyle+" "+style.borderBottomColor,gap:boxRect.top-rect.bottom,before:previous?rect.top-previous.getBoundingClientRect().bottom:null,aligned:rect.left===boxRect.left&&rect.right===boxRect.right};
                    };
                    return {reference:measure(reference),sections:["controller-purpose","connection-addresses-title","known-issues","install-plugin","support-development"].map(id=>measure(document.getElementById(id))),intro:document.querySelector("section[aria-labelledby=controller-purpose] > h3").textContent};
                })()`);
                assert.equal(layout.intro,"The original idea behind LRBridge");
                const innerDividers=await evaluate(`(()=>Array.from(document.querySelectorAll(".help-content-divider")).map(line=>{
                    const box=line.parentElement,rect=line.getBoundingClientRect(),parent=box.getBoundingClientRect(),style=getComputedStyle(line),boxStyle=getComputedStyle(box),next=line.nextElementSibling;
                    return {tag:line.tagName,boxed:box.matches("section.box"),section:box.getAttribute("aria-labelledby"),next:next.id||next.textContent,
                        border:style.borderTopWidth+" "+style.borderTopStyle+" "+style.borderTopColor,
                        innerLeft:rect.left-parent.left-parseFloat(boxStyle.borderLeftWidth)-parseFloat(boxStyle.paddingLeft),
                        innerRight:parent.right-rect.right-parseFloat(boxStyle.borderRightWidth)-parseFloat(boxStyle.paddingRight),
                        before:rect.top-line.previousElementSibling.getBoundingClientRect().bottom,after:next.getBoundingClientRect().top-rect.bottom};
                }))()`);
                assert.deepEqual(innerDividers.map(line=>[line.section,line.next]),[["controller-purpose","The original idea behind LRBridge"],["install-plugin","dust-setup"]],"only the two requested positions get an inner divider");
                for(const line of innerDividers){
                    assert(line.tag==="HR"&&line.boxed);
                    assert.equal(line.border,layout.reference.divider,"inner dividers must match the existing divider colour and thickness");
                    assert(Math.abs(line.innerLeft)<1&&Math.abs(line.innerRight)<1,"divider must span the box's inner content width");
                    assert(Math.abs(line.before-16)<1&&Math.abs(line.after-16)<1,"divider must have 16px of space above and below");
                }
                const introduction=await evaluate('document.querySelector("section[aria-labelledby=controller-purpose]").innerText');
                assert.match(introduction,/This release runs on Windows and controls Adobe Lightroom Classic, not the cloud-based Lightroom app/);
                assert.match(introduction,/Phones and tablets can access the Web Controller on the local network while LRBridge and Lightroom Classic run on the Windows computer/);
                assert(introduction.includes("Bitfocus Companion is optional. You can use the Web Controller with just LRBridge and Lightroom Classic."));
                assert.doesNotMatch(introduction,/Lightroom Classic\s+\d|minimum.*\d/i,"Help must not infer a supported minimum Lightroom version from SDK metadata");
                for(const section of layout.sections) {
                    assert(section.outside&&section.aligned,section.id+": heading must sit outside and align with its content box");
                    assert.equal(section.label,section.id);
                    assert.equal(section.color,layout.reference.color,section.id+": use the existing yellow heading style");
                    assert.equal(section.divider,layout.reference.divider,section.id+": divider must match Companion");
                    assert(Math.abs(section.gap-layout.reference.gap)<1,section.id+": heading-to-box spacing must match Companion");
                    if(section.before!==null) assert(Math.abs(section.before-layout.reference.before)<1,section.id+": section gap must match Companion");
                }
                const powershell=await evaluate('(()=>{const heading=Array.from(document.querySelectorAll("main > h2")).find(el=>el.textContent==="PowerShell example"),section=heading.nextElementSibling;return {text:section.innerText,example:section.querySelector("pre").textContent,link:section.querySelector("a").getAttribute("href")};})()');
                assert(powershell.text.includes("LRBridge accepts HTTP requests to adjust Lightroom sliders and run actions."));
                assert(powershell.text.includes("For more commands and ready-to-copy examples, open the HTTP Builder."));
                assert.equal(powershell.example,'curl.exe "http://127.0.0.1:17891/adjust?slider=Exposure&amount=1"');
                assert.equal(powershell.link,"/bitfocus-companion-cheatsheet");
                const ports=await evaluate(`(()=>{
                    const section=document.querySelector("#connection-addresses"),table=section.querySelector("table");
                    return {boxed:section.matches(".box")&&table.parentElement===section&&section.querySelector(":scope > p")!==null,text:section.innerText,scroll:table.scrollWidth,width:table.clientWidth,urls:Array.from(table.querySelectorAll("tbody td:nth-child(2) code")).map(code=>{
                        const range=document.createRange();range.selectNodeContents(code);
                        const rects=Array.from(range.getClientRects()),cell=code.closest("td").getBoundingClientRect();
                        return {text:code.textContent,lines:rects.length,fitsCell:rects.every(r=>r.left>=cell.left&&r.right<=cell.right),fitsPage:rects.every(r=>r.left>=0&&r.right<=innerWidth)};
                    })};
                })()`);
                assert(ports.boxed,"ports explanation and table must share the content box");
                assert.deepEqual(ports.urls.map(url=>url.text),["http://127.0.0.1:17892","http://127.0.0.1:17892/help","http://127.0.0.1:17891"]);
                assert.doesNotMatch(ports.text,/Raw API|direct API help/);
                assert(ports.scroll<=ports.width+1,"addresses must not require horizontal table scrolling");
                for(const url of ports.urls) {
                    assert.equal(url.lines,1,"local URL must stay readable without an orphaned last character: "+url.text);
                    assert(url.fitsCell&&url.fitsPage,"local URL must fit its cell and viewport: "+url.text);
                }
                assert.doesNotMatch(await evaluate('document.querySelector("main").innerText'),/Safe everyday commands/);
                const install=await evaluate('(()=>{const section=document.querySelector("[aria-labelledby=install-plugin]"),list=section.querySelector("ol");return {steps:Array.from(list.children).map(li=>li.textContent.trim()),start:list.start,overriddenNumbers:list.querySelectorAll("[value]").length,paragraphs:Array.from(section.querySelectorAll(":scope > p")).map(p=>p.textContent),emphasis:Array.from(section.querySelectorAll("strong")).map(s=>s.textContent),text:section.innerText,links:section.querySelectorAll("a").length};})()');
                assert.deepEqual(install.steps,[
                    "Open Lightroom Classic.",
                    "Go to File → Plug-in Manager and click Add.",
                    "Browse to your LRBridge folder, open lightroom, and select LRBridge.lrplugin.",
                    "Make sure the plug-in is enabled, then click Done."
                ]);
                assert.equal(install.start,1);
                assert.equal(install.overriddenNumbers,0,"plug-in setup numbering must run continuously from 1 through 4");
                assert.deepEqual(install.paragraphs,[
                    "The plug-in is included with LRBridge. Find the folder containing LRBridge.exe. Inside it, the lightroom folder contains LRBridge.lrplugin — this is the plug-in folder you need to select.",
                    "On the computer running LRBridge:",
                    "Keep LRBridge running while using the Web Controller.",
                    "Using a newer LRBridge folder? Make sure Lightroom loads the plug-in from that same folder. Remove the older LRBridge entry from Plug-in Manager and add the current one.",
                    "Healing → Dust: To use Apply on/off and Reset through LRBridge, you need to add two Dust presets to Lightroom. Close Lightroom Classic and run Install Dust Presets.cmd from your LRBridge folder. This adds both presets automatically. Reopen Lightroom when it finishes. If Apply and Reset already work, you can skip this step."
                ]);
                assert.deepEqual(install.emphasis,["LRBridge.exe","lightroom","LRBridge.lrplugin","Lightroom Classic","File → Plug-in Manager","Add","lightroom","LRBridge.lrplugin","Done","LRBridge running","Using a newer LRBridge folder?","Healing → Dust:","Install Dust Presets.cmd"]);
                assert.equal(install.links,0);
                assert.doesNotMatch(install.steps.join(" "),/Dust/,"Dust setup must stay separate from the compact general plug-in steps");
                assert.doesNotMatch(install.text,/Restart Lightroom|ZIP|[Dd]ownload|[Ee]xtract|Recommended locations|Documents\\|Desktop\\|Program Files/);
                assert.doesNotMatch(await evaluate('document.querySelector("main").innerHTML'),/href="\/reference\/WINDOWS_BETA\.md"/);
                assert.equal(await evaluate('document.querySelectorAll("#using-controller, #using-tools, #using-favorites, #find-controls").length'),0,"long control walkthroughs must be removed");
                const knownSections=await evaluate(`(()=>{
                    const box=document.querySelector("section[aria-labelledby=known-issues]"),rect=box.getBoundingClientRect();
                    return Array.from(box.querySelectorAll(":scope > h3")).map(heading=>{
                        const parts=[],items=[];let node=heading.nextElementSibling;
                        while(node&&!node.matches("h3")){parts.push(node.textContent.trim());items.push(...Array.from(node.querySelectorAll("li")).map(li=>li.textContent));node=node.nextElementSibling;}
                        const h=heading.getBoundingClientRect();
                        return {heading:heading.textContent,text:parts.join(" "),items,inside:h.left>=rect.left&&h.right<=rect.right&&h.top>=rect.top&&h.bottom<=rect.bottom};
                    });
                })()`);
                assert.deepEqual(knownSections.map(section=>section.heading),[
                    "How LRBridge controls Lightroom Classic", "Update delays and temporarily unavailable buttons",
                    "Understanding messages", "If the controller stops responding", "Control and feedback limitations",
                    "Information read from Lightroom’s interface", "Unsupported controls"
                ]);
                assert(knownSections.every(section=>section.inside),"Known issues subheadings must stay inside the content box");
                const controlLimits=await evaluate(`(()=>{
                    const heading=Array.from(document.querySelectorAll("section[aria-labelledby=known-issues] > h3")).find(h=>h.textContent==="Control and feedback limitations"),entries=[];
                    let node=heading.nextElementSibling;
                    while(node&&!node.matches("h3")){
                        if(node.matches("p")&&node.children.length===1&&node.firstElementChild.matches("strong")&&node.textContent===node.firstElementChild.textContent) entries.push({label:node.textContent,paragraphs:[]});
                        else if(entries.length) entries.at(-1).paragraphs.push(node.textContent);
                        node=node.nextElementSibling;
                    }
                    return entries;
                })()`);
                assert.deepEqual(controlLimits.map(entry=>entry.label),["Healing → Remove → Selected Add/Subtract","Healing → Dust","Point Color → Visualize Range","Lens Blur focus controls","Copy / Paste Settings"],"control limitations must use bold paragraph labels in order");
                assert.deepEqual(controlLimits[1].paragraphs,[
                    "LRBridge controls Dust Apply on/off and Reset by applying two included presets in Lightroom Classic. If those presets are not installed, these buttons are unavailable. Dust Size, Visualize Spots and Threshold do not require the presets.",
                    "This setup is only necessary if you want to use Dust Apply or Reset through LRBridge. See Set up the Lightroom plug-in for instructions.",
                    "LRBridge’s current Dust implementation is restricted to Lightroom Classic 15.4.1. Support for other versions has not been established."
                ]);
                assert.doesNotMatch(controlLimits[1].paragraphs.join(" "),/Install Dust Presets\.cmd|close Lightroom|reopen Lightroom/,"Dust installation steps belong only in the setup section");
                const dustSetupLink=await evaluate('(()=>{const link=document.querySelector("section[aria-labelledby=known-issues] a[href=\\"#install-plugin\\"]");return link?{label:link.textContent,href:link.getAttribute("href"),target:document.querySelector(link.getAttribute("href"))?.textContent}:null;})()');
                assert.deepEqual(dustSetupLink,{label:"Set up the Lightroom plug-in",href:"#install-plugin",target:"Set up the Lightroom plug-in"});
                const delay=await evaluate('(()=>{const p=document.querySelector("#buttons-unavailable");return {tag:p.tagName,section:p.closest("section").getAttribute("aria-labelledby"),text:p.textContent};})()');
                assert.equal(delay.tag,"P");
                assert.equal(delay.section,"known-issues","button delays belong inside Known issues");
                assert.equal(delay.text,"Some buttons briefly become unavailable during or after edits to allow Lightroom time to update. This includes Auto Tone and Auto White Balance after slider changes. Undo and Redo may also have a short delay. Wait until the button becomes available again.");
                const interfaceControls=knownSections[0].text;
                assert.deepEqual(knownSections[0].items,[
                    "Healing → Remove → Selected: Add, Subtract, Cancel and Remove",
                    "Lens Blur: Subject Focus and Point / Area Focus",
                    "Lens Blur → Brush Refinement: open/close, Focus/Blur, Amount, Size, Feather, Flow, Auto Mask and resets"
                ]);
                assert.match(interfaceControls,/official plug-in SDK and Windows interface automation/);
                assert.match(interfaceControls,/Many editing controls use the SDK to apply changes without locating or clicking buttons/);
                assert.match(interfaceControls,/operating Lightroom’s own on-screen interface/);
                assert.match(interfaceControls,/depend on Lightroom’s current layout and state/);
                assert.match(interfaceControls,/may not always be able to confirm their current state/);
                assert.match(interfaceControls,/use the corresponding control directly in Lightroom Classic/);
                assert.doesNotMatch(interfaceControls,/Profile|Visualize Depth/,"reading interface feedback must not be confused with operating those controls");
                const support=await evaluate('(()=>{const section=document.querySelector("main > section:last-child"),link=section.querySelector("a"),rect=link.getBoundingClientRect();return {id:section.getAttribute("aria-labelledby"),text:section.querySelector("p").textContent,label:link.textContent,href:link.getAttribute("href"),fitsPage:rect.left>=0&&rect.right<=innerWidth};})()');
                assert.equal(support.id,"support-development","support must be the final Help section");
                assert.equal(support.text,"LRBridge is an independent project. If you find it useful, you can support its development on Ko-fi. Donations are optional and appreciated.");
                assert.equal(support.label,"Support LRBridge on Ko-fi");
                assert.equal(support.href,"https://ko-fi.com/ninoleto");
                assert(support.fitsPage,"support link must fit the viewport");
                const helpLinks=await evaluate('Array.from(document.querySelectorAll("a[href]")).map(a=>({label:a.textContent.trim(),href:a.getAttribute("href")}))');
                assert.deepEqual(helpLinks.filter(link=>link.label.includes("HTTP Builder")).map(link=>link.href),["/bitfocus-companion-cheatsheet","/bitfocus-companion-cheatsheet"]);
                for(const link of helpLinks) assert.doesNotMatch(link.href,/\[[^\]]*\]\(|[<>]/,"HTML href must contain a destination, not pasted Markdown: "+link.label);
                const anchors=await evaluate('Array.from(document.querySelectorAll("[aria-labelledby]")).flatMap(el=>el.getAttribute("aria-labelledby").split(/\\s+/)).filter(id=>!document.getElementById(id))');
                assert.deepEqual(anchors,[],"section headings must have valid accessible references");
                const limits=await evaluate('document.querySelector("section[aria-labelledby=known-issues]").innerText');
                assert.match(limits,/Lightroom Classic may apply a change before the Web Controller displays the updated value or button state/);
                assert.match(limits,/Moving Lightroom between monitors can interrupt the Web Controller’s updates and responsiveness, including ordinary sliders/);
                assert.match(limits,/try switching Lightroom to Library and then back to Develop/);
                assert.match(limits,/Loading means the controller is waiting for values from Lightroom/);
                assert.match(limits,/Unavailable means the control cannot currently be used or its value cannot be read\. It does not mean the value is zero/);
                assert.match(limits,/Availability may depend on the selected photo, active Lightroom tool, photo type or Lightroom version/);
                assert.match(limits,/Connection or error messages can indicate a connection problem, a missing update or an action that could not be completed/);
                assert.match(limits,/Command sent means the request has been submitted\. It does not confirm that Lightroom has applied the change or finished an edit, export or AI operation/);
                assert.match(limits,/cannot verify the contents of Lightroom’s copied settings or confirm every result when settings are pasted to multiple photos/);
                assert.match(limits,/Review the affected photos in Lightroom Classic, especially when masks or AI-based edits are involved/);
                assert.match(knownSections[3].text,/Check the Web Controller’s connection status/);
                assert.deepEqual(knownSections[3].items,["LRBridge is running.","The LRBridge plug-in is enabled in Lightroom Classic.","A photo is selected.","Lightroom is in Develop when using editing controls.","No Lightroom dialog is blocking interaction."]);
                assert.match(knownSections[3].text,/Allow Lightroom to finish any current processing\. If the Web Controller remains disconnected, reload the browser page/);
                assert.doesNotMatch(limits,/Reset feedback has improved|in our tests|underlying issue remains unresolved|user-reported issue remains unresolved/);
                assert.match(knownSections[4].text,/Experimental: Add\/Subtract use Windows interface automation, may stop responding and do not report the active mode/);
                assert.match(knownSections[4].text,/use Add\/Subtract directly in Lightroom/);
                assert.match(knownSections[4].text,/LRBridge can switch Visualize Range on or off, but the Web Controller does not display its current state/);
                assert.match(knownSections[4].text,/Focus Range \(near\/far\) uses the Lightroom SDK/);
                assert.match(knownSections[4].text,/Focus-mode feedback may lag or be unavailable/);
                assert.deepEqual(knownSections[5].items,["Camera Profile choices and names","Lens Blur Visualize Depth state"]);
                assert.match(knownSections[5].text,/This is separate from how LRBridge sends changes to these settings/);
                assert.match(knownSections[5].text,/controls may temporarily appear unavailable or may not display their current state correctly/);
                assert.match(limits,/Changing lens profiles is not supported in LRBridge/);
                assert.match(limits,/Select and configure your lens profile directly in Lightroom Classic/);
                assert(limits.includes("After using an action button, allow Lightroom time to respond before using it again. Repeated clicks may queue additional actions that run later."));
            }
            const geometry=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
            if(geometry.width!==width || geometry.scroll>geometry.width+1) {
                console.error(page,width,await evaluate('Array.from(document.querySelectorAll("body *")).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>'+width+').slice(0,20)'));
            }
            assert.equal(geometry.width,width,page+": mobile page must use the device viewport, not scaled desktop text");
            assert(geometry.scroll<=geometry.width+1,JSON.stringify({page,width,geometry}));
            if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS){
                fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,{recursive:true});
                const shot=await cdp.send("Page.captureScreenshot",{format:"png"});
                fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,page+"-"+width+".png"),Buffer.from(shot.data,"base64"));
                if(page==="help") for(const id of ["controller-purpose","connection-addresses-title","known-issues","install-plugin","support-development"]) {
                    const clip=await evaluate('(()=>{const h=document.getElementById('+JSON.stringify(id)+'),box=h.nextElementSibling,y=Math.max(0,h.getBoundingClientRect().top+scrollY-48),bottom=Math.min(document.documentElement.scrollHeight,box.getBoundingClientRect().bottom+scrollY+80);return {x:0,y,width:innerWidth,height:Math.ceil(bottom-y),scale:1};})()');
                    const sectionShot=await cdp.send("Page.captureScreenshot",{format:"png",clip,captureBeyondViewport:true});
                    fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,page+"-"+width+"-"+id+".png"),Buffer.from(sectionShot.data,"base64"));
                }
            }
        }
        if(!helpOnly&&!builderPresentationOnly) {
            for(const failedPath of ["/api/sliders","/api/color-grading"]) {
                unavailable.add(failedPath);
                await cdp.send("Page.navigate",{url:"http://localhost:"+port+"/builder"});
                let ready=false;
                for(let n=0;n<100;n++) {
                    ready=await evaluate('document.body.dataset.ready==="true" && document.querySelector("#loadError")?.textContent.includes("could not load")');
                    if(ready)break;await new Promise(r=>setTimeout(r,50));
                }
                assert(ready,"metadata failures must be visible: "+failedPath);
                assert.equal(await evaluate('baseUrlEl.textContent'),"http://localhost:17891");
                assert.equal(await evaluate('!!document.querySelector(\"[data-card-id=application-module-library] .command\")?.dataset.path'),true,"static actions survive metadata failures");
                assert.equal(await evaluate(failedPath==="/api/sliders"?'!!document.querySelector(\"[data-card-id=color-wheel-shadows]\")':'!!document.querySelector(\"[data-slider=Contrast]\")'),true,"independent metadata must still render");
                unavailable.delete(failedPath);
            }
        }
        assert.deepEqual(errors,[]);
        if(!builderOnly) console.log("Accepted Help layout and text checks passed at 1280/390/320px.");
        if(builderTabsOnly) console.log("Builder tab interaction passed at "+widths.join('/')+"px: actual mouse press/release and emulated touch in both directions, unchanged tab positions/scroll, atomic selected state/count/cards, Step edits, preserved inputs and accessible keyboard navigation. No live Lightroom or physical-device testing.");
        else if(builderStepHelpOnly) console.log("Builder Step size text/layout passed at 1280/390/320px: exact wording, divider/subheading inside Base URL, accessible input description, retained tab description and no clipping/overflow. No behavior suites or live Lightroom requests.");
        else if(builderToolbarOnly) console.log("Builder permanent toolbar passed at "+widths.join('/')+"px: responsive rows, touch/keyboard controls, synchronized Step inputs/validation, unchanged Set/Reset, stable panel/Contrast ordering with reversed metadata arrival, preserved elements, Top and section offsets. Continuous wheel/touch scrolling runs at 1280/320px. No executable requests, live Lightroom or physical Android test.");
        else if(builderPresentationOnly) console.log("Builder presentation passed at 1280/768/390/320px: amber popup grid, 54px items, wrapping/order, simulated touch scrolling/selection/outside dismissal, keyboard/Escape, viewport limits, filtering, heading offsets and preserved inputs. No actual Android test, executable scripts or live Lightroom requests.");
        else if(!helpOnly) console.log("Builder cards passed at 1280/390/320px: complete collection, search and groups, hidden-card Step updates, preserved inputs/focus/scroll, all Copy pairs, metadata errors, clipboard fallback, sticky toolbar, touch targets and no overflow. No live Lightroom requests.");
    } finally {await browser.cleanup(resources);}
})().catch(e=>{console.error(e);process.exitCode=1;});
