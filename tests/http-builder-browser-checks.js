"use strict";
const assert = require("node:assert/strict");
const metadata = require("../config/sliders.json");
const stepHelpParagraphs = [
    "Step size controls how much the −/+ slider commands increase or decrease a value when you run them. Use 1 for one adjustment step, or a larger number for a bigger adjustment. The amount each step changes the displayed value depends on the slider.",
    "Choose a positive whole number using the toolbar’s − and + buttons, or type a number directly. The setting updates the generated adjustment commands across both SDK and WIN UI tabs. It does not change Set values or Reset commands.",
    "Changing step size here does not edit your photo. If you already copied an adjustment command into Companion, copy it again to use the new step size.",
    "You can change Step size here or in the toolbar. Both controls use the same setting."
];

module.exports = async function checkBuilder({ evaluate, cdp, width, presentationOnly, toolbarOnly, stepHelpOnly }) {
    const run = evaluate;
    if (stepHelpOnly) return checkStepHelp({run,cdp,width});
    if (toolbarOnly) return checkToolbarRows({run,cdp,width});
    await checkPageOrderAndTop({run, cdp, width});
    await checkJumpNavigation({run, cdp, width});
    if (presentationOnly) return;
    assert.equal(await run('activeExecution'), "sdk", "SDK opens by default");
    assert.equal(await run('document.querySelector("#applyStep")'), null);
    assert.equal(await run('document.querySelectorAll(".card a").length'), 0, "per-card workflow/controller links removed");
    assert.equal(await run('Array.from(document.querySelectorAll(".command details")).every(d=>!d.open&&d.querySelector("summary").textContent==="Show PowerShell script")'), true, "all scripts start collapsed");
    assert.equal(await run('Array.from(document.querySelectorAll(".command button")).filter(b=>b.textContent==="Copy PowerShell").every(b=>!b.closest("details"))'), true, "Copy PowerShell stays outside disclosures");
    assert.equal(await run('Array.from(document.querySelectorAll(".script-command")).every(c=>c.closest(".card").textContent.includes("This action needs several requests. Copy the PowerShell script and run it in PowerShell."))'), true);
    assert.equal(await run('cardRecords.filter(r=>r.execution==="win-ui").length'), 14, "only actions executed through Windows controls use WIN UI");
    assert.equal(await run('cardRecords.filter(r=>r.execution==="sdk").length'), 406, "SDK families, including mixed-feature SDK controls, are retained");
    assert.equal(await run('document.querySelectorAll("select, #httpInventory, #quickSection, #groupNav, .group-nav").length'), 0);
    assert.equal(await run('new Set(cardRecords.map(r=>r.id)).size===cardRecords.length'), true, "unique card identities");
    assert.equal(await run('Array.from(document.querySelectorAll(".workflow")).every(c=>c.querySelector(".command button"))'), true, "every former guidance card must generate executable code");
    const missingActions = await run(`builderCommandFamilies.flatMap(f=>f.types.flatMap(t=>(t.options||[]).map(o=>[f.id,t.id,o.value].join("-")))).filter(id=>!cardRecords.some(r=>r.id===id))`);
    assert.deepEqual(missingActions, [], "all existing fixed actions must survive conversion");
    for (const slider of metadata.filter(s => s.id !== "LensProfileChromaticAberrationScale")) {
        const card = await run(`(()=>{const c=document.querySelector('[data-slider="${slider.id}"]');return c?{labels:Array.from(c.querySelectorAll('.command-label')).map(e=>e.textContent),input:!!c.querySelector('input[data-input="value"]'),paths:Array.from(c.querySelectorAll('.command')).map(c=>c.dataset.path)}:null;})()`);
        assert(card && card.input, "missing Set input: " + slider.id);
        assert.deepEqual(card.labels, [
            ...(slider.adjustSupported !== false ? ["−1 Step"] : []),
            ...(slider.resetSupported !== false ? ["Reset"] : []),
            ...(slider.adjustSupported !== false ? ["+1 Step"] : []), "Set"
        ], "slider operations/order: " + slider.id);
        for (const path of card.paths) assert(path.startsWith("/command?") || path.startsWith("/set?"), path);
    }
    await run(`window.copied=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>window.copied.push(text)}});
        window.field=(id,key)=>document.querySelector('[data-card-id="'+id+'"] input[data-input="'+key+'"]');
        window.enter=(id,key,value)=>{const input=field(id,key);input.value=value;input.dispatchEvent(new Event("input"));};
        window.searchFor=text=>{searchEl.value=text;searchEl.dispatchEvent(new Event("input"));};
        window.paths=id=>Array.from(document.querySelector('[data-card-id="'+id+'"]').querySelectorAll('.command')).map(c=>c.dataset.path);`);
    await checkRefinedPresentation({run, cdp, width});
    await run('searchFor("Lens Blur");document.querySelector("#tab-win-ui").click()');
    assert.equal(await run('searchEl.value'), "Lens Blur");
    assert.equal(await run('cardRecords.filter(r=>!r.card.hidden).every(r=>r.execution==="win-ui")'), true);
    assert.match(await run('document.querySelector("#resultCount").textContent'), /WIN UI/);
    assert.equal(await run('document.querySelector("#resultCount").getBoundingClientRect().top>=toolbar.getBoundingClientRect().bottom'), true, "result count stays below the sticky toolbar");
    assert.equal(await run('Array.from(groups.values()).every(g=>g.section.hidden===g.records.every(r=>r.card.hidden)&&jumpMenu.contains(g.link)!==g.section.hidden)'), true);
    await run('searchFor("Contrast");document.querySelector("#tab-sdk").click()');
    assert.equal(await run('searchEl.value'), "Contrast");
    assert.equal(await run('document.querySelector("[data-slider=Contrast]").hidden'), false);
    await run('document.querySelector("#tab-win-ui").click()');
    assert.match(await run('document.querySelector("#noResults").textContent'), /No matches in WIN UI/);
    assert.equal(await run('document.querySelector("#noResults").hidden'), false);
    await run('document.querySelector("#tab-sdk").click();searchFor("")');
    await run('enter("slider-Exposure","value","1.234")');
    assert.equal(await run('paths("slider-Exposure").at(-1)'), "", "Set precision must be enforced");
    await run('enter("slider-Exposure","value","1.25");enter("selection-extend-left","amount","1.5")');
    assert.equal(await run('paths("selection-extend-left")[0]'), "");
    await run('enter("selection-extend-left","amount","25");enter("crop-custom","width","3");enter("crop-custom","height","2");enter("crop-angle","value","-2.5");enter("color-wheel-shadows","hue","220");enter("color-wheel-shadows","saturation","35");enter("color-scalar-balance","value","-12.5");');
    const savedInputs = await run('Array.from(document.querySelectorAll(".card input,.card textarea")).map(i=>[i.id,i.type==="checkbox"?i.checked:i.value])');
    const savedNonRelative = await run('Array.from(document.querySelectorAll(".command:not([data-relative])")).map(c=>c.dataset.path)');
    await run('document.querySelector("#tab-win-ui").click();document.querySelector("#increaseStep").click();document.querySelector("#increaseStep").click();document.querySelector("#decreaseStep").click()');
    assert.equal(await run('stepSize'), 2, "step buttons apply immediately by one, from either tab");
    await run('stepInput.value="7";stepInput.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"}))');
    assert.equal(await run('stepSize'), 7, "Enter commits direct step entry");
    await run('stepInput.value="3";stepInput.dispatchEvent(new Event("blur"))');
    assert.equal(await run('stepSize'), 3, "leaving the field commits direct entry");
    for (const value of ["0","-2","1.5",""]) {
        await run('stepInput.value='+JSON.stringify(value)+';stepInput.dispatchEvent(new Event("blur"))');
        assert.equal(await run('stepSize'), 3);
        assert.equal(await run('stepInput.value'), "3", "invalid entry restores last valid step");
        assert.match(await run('document.querySelector("#stepError").textContent'), /positive whole number/);
    }
    await run('setStep("1");document.querySelector("#decreaseStep").click()');
    assert.equal(await run('stepSize'), 1, "minimum step stays at one");
    await run('document.querySelector("#tab-sdk").click()');
    await run('searchFor("Exposure")');
    await run(`field("slider-Exposure","value").focus();window.scrollTo(0,document.querySelector('[data-card-id="slider-Exposure"]').getBoundingClientRect().top+scrollY-toolbar.offsetHeight-16);`);
    const before = await run('({y:scrollY,focus:document.activeElement.id,search:searchEl.value})');
    await run('stepInput.value="4";setStep(stepInput.value);setBaseHost("http://192.168.1.11:17892/");');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const after = await run('({y:scrollY,focus:document.activeElement.id,search:searchEl.value})');
    assert.deepEqual(after, before, "Step/base changes must preserve focus, search and scroll");
    assert.deepEqual(await run('Array.from(document.querySelectorAll(".card input,.card textarea")).map(i=>[i.id,i.type==="checkbox"?i.checked:i.value])'), savedInputs, "global settings must not alter card inputs or POST bodies");
    assert.equal(await run('Array.from(document.querySelectorAll(".script-code")).every(e=>e.textContent.includes("http://192.168.1.11:17891"))'), true, "all scripts use the updated address, including hidden cards");
    assert.deepEqual(await run('Array.from(document.querySelectorAll(".command:not([data-relative])")).map(c=>c.dataset.path)'), savedNonRelative, "Step must not change Set, Reset, selection or other commands");
    const relative = await run('Array.from(document.querySelectorAll("[data-relative]")).map(c=>({hidden:c.closest(".card").hidden,path:c.dataset.path,script:c.classList.contains("script-command")?c.querySelector("pre").textContent:null,label:c.querySelector(".command-label").textContent}))');
    assert(relative.some(c => c.hidden), "fixture must cover filtered-out relative controls");
    for (const command of relative) {
        const amount = command.script ? Number(command.script.match(/'amount' = '(-?\d+)'/)[1]) : Number(new URL("http://fixture" + command.path).searchParams.get("amount"));
        assert.equal(Math.abs(amount), 4, command.path);
        assert.match(command.label, /^[−+]/);
    }
    await run('setStep("1.5");setBaseHost("bad host?x=1")');
    assert.equal(await run('stepSize'), 4);
    assert.equal(await run('apiBase'), "http://192.168.1.11:17891");
    assert.match(await run('document.querySelector("#stepError").textContent'), /whole number/);
    assert.match(await run('document.querySelector("#hostError").textContent'), /unchanged/);
    await run('setStep("4");setBaseHost("192.168.1.11")');
    for (const [query, id] of [
        ["develop.set Contrast", "slider-Contrast"], ["selection.extend left", "selection-extend-left"],
        ["photo.rotate right", "photo-rotate-right"], ["application.module library", "application-module-library"],
        ["Color Grading shadows hue", "color-wheel-shadows"], ["custom crop width", "crop-custom"],
        ["Crop Angle Reset", "crop-angle"], ["bokeh SoapBubble", "direct-lens_blur.bokeh.set-1"]
    ]) {
        await run('searchFor(' + JSON.stringify(query) + ')');
        assert.equal(await run('document.querySelector(' + JSON.stringify('[data-card-id="' + id + '"]') + ').hidden'), false, query);
        assert.equal(await run('Array.from(groups.values()).every(g=>g.section.hidden===g.records.every(r=>r.card.hidden)&&jumpMenu.contains(g.link)!==g.section.hidden)'), true, "empty groups and navigation must follow search");
    }
    for (const query of ["clipboard.paste", "export.previous", "remove.selection.action subtract", "local_Exposure", "enhance.denoise.amount.set", "lens-blur/focal-range", "masking.component.add Sky", "point_color.range.translate HueRange"]) {
        await run('selectExecution('+JSON.stringify(query.includes("remove.selection")?"win-ui":"sdk")+');searchFor(' + JSON.stringify(query) + ')');
        assert(await run('document.querySelectorAll(".workflow:not([hidden])").length') > 0, "workflow must be discoverable: " + query);
    }
    assert.deepEqual(await run(`getWorkflowDefinitions().flatMap((d,i)=>{const c=document.querySelector('[data-card-id="workflow-'+i+'"]');selectExecution(c.dataset.execution);searchFor(d.title);return !c.hidden&&c.querySelector('.command button')?[]:[d.title];})`), [], "search must retain every generator within its tab");
    await run('searchFor("no-such-command-xyz")');
    assert.equal(await run('document.querySelector("#noResults").hidden'), false);
    assert.equal(await run('document.querySelectorAll(".command-group:not([hidden])").length'), 0);
    await run('document.querySelector("#clearSearch").click()');
    assert.equal(await run('searchEl.value'), "");
    assert.equal(await run('document.activeElement.id'), "search");
    assert.equal(await run('cardRecords.every(r=>r.card.hidden===(r.execution!==activeExecution))'), true);
    assert.deepEqual(await run('Array.from(document.querySelectorAll(".card input,.card textarea")).map(i=>[i.id,i.type==="checkbox"?i.checked:i.value])'), savedInputs, "tab switches preserve every card input");
    const copyFailures = await run(`(async()=>{
        const failures=[];
        for(const tab of ['sdk','win-ui']) {selectExecution(tab);for(const command of document.querySelectorAll('.card:not([hidden]) .command')) {
            const expected=command.dataset.path,buttons=command.querySelectorAll('button');
            if(command.classList.contains('script-command')) {
                if(!buttons[0].getClientRects().length)failures.push('Copy PowerShell hidden by disclosure');
                if(buttons[0].disabled) {failures.push('default script invalid: '+command.closest('.card').dataset.cardId);continue;}
                buttons[0].click();await Promise.resolve();if(copied.at(-1)!==command.querySelector('pre').textContent)failures.push('script copy');continue;
            }
            if(!expected) {if(Array.from(buttons).some(b=>!b.disabled))failures.push('invalid command enabled');continue;}
            if(!buttons[0].disabled) {buttons[0].click();await Promise.resolve();if(copied.at(-1)!==expected)failures.push(expected+': path');}
            if(!buttons[1].disabled) {buttons[1].click();await Promise.resolve();if(copied.at(-1)!==apiBase+expected)failures.push(expected+': full');}
            buttons[2].click();await Promise.resolve();if(copied.at(-1)!==command.querySelector('pre').textContent||!copied.at(-1).includes(apiBase))failures.push(expected+': PowerShell');
        }}selectExecution('sdk');
        return failures;
    })()`);
    assert.deepEqual(copyFailures, [], "every runnable card Copy pair must match the displayed command");
    assert.deepEqual(await run(`(()=>{const c=Array.from(document.querySelectorAll('.card')).find(c=>c.querySelector('input[type=checkbox]'));const b=c.querySelectorAll('button');const before=[b[0].disabled,b[1].disabled,b[2].disabled];c.querySelector('input[type=checkbox]').click();return {before,after:[b[0].disabled,b[1].disabled,b[2].disabled],prompt:c.querySelector('pre').textContent.includes('Read-Host')};})()`),{before:[true,true,false],after:[false,false,false],prompt:true},"Refinement Reset URL requires confirmation; PowerShell confirms at execution time");
    for (const [id, expected] of [
        ["slider-Exposure", "/set?slider=Exposure&value=1.25"],
        ["selection-extend-left", "/command?command=selection.extend&direction=left&amount=25"],
        ["crop-custom", "/command?command=photo.crop_aspect&mode=custom&w=3&h=2"],
        ["crop-angle", "/command?command=photo.crop_angle.set&value=-2.5"],
        ["color-wheel-shadows", "/command?command=color_grading.wheel.set&region=shadows&hue=220&saturation=35"],
        ["color-scalar-balance", "/command?command=color_grading.value.set&control=balance&value=-12.5"]
    ]) assert((await run('paths(' + JSON.stringify(id) + ')')).includes(expected), expected);
    for (const [id, key] of [["crop-custom", "width"], ["crop-angle", "value"], ["color-wheel-shadows", "hue"]]) {
        await run('enter(' + [id, key, ""].map(JSON.stringify).join(',') + ')');
        assert.equal(await run('paths(' + JSON.stringify(id) + ')[0]'), "", "invalid inputs must clear their request");
    }
    await run('window.textareaCount=document.querySelectorAll("textarea").length;navigator.clipboard.writeText=async()=>{throw Error("unavailable")};window.savedExec=document.execCommand;document.execCommand=()=>{window.fallbackCopy=document.activeElement.value;return true;};document.querySelector("#copyBaseUrl").focus();document.querySelector("#copyBaseUrl").click();');
    assert.equal(await run('window.fallbackCopy'), "http://192.168.1.11:17891");
    assert.equal(await run('document.activeElement.id'), "copyBaseUrl");
    assert.equal(await run('document.querySelectorAll("textarea").length===textareaCount'), true);
    await run('document.execCommand=()=>false;document.querySelector("#copyBaseUrl").click();');
    assert.match(await run('statusEl.textContent'), /^Copy failed/);
    await run('document.execCommand=window.savedExec;navigator.clipboard.writeText=async text=>copied.push(text);setStatus("");');
    const links = await run('Array.from(document.querySelectorAll("a[href]")).map(a=>a.getAttribute("href"))');
    for (const href of new Set(links)) {
        if (href.startsWith('#')) assert.equal(await run('!!document.getElementById(' + JSON.stringify(href.slice(1)) + ')'), true, href);
        else assert(["/", "/help", "/reference/HTTP_WORKFLOWS.md"].includes(href), "unexpected reference " + href);
    }
    await run('searchFor("slider-no-match");document.querySelector("#clearSearch").click();window.scrollTo(0,1500);');
    const toolbar = await run('({top:toolbar.getBoundingClientRect().top,height:toolbar.offsetHeight,search:searchEl.getBoundingClientRect().top,step:stepInput.getBoundingClientRect().top})');
    assert(Math.abs(toolbar.top) < 1 && toolbar.search >= 0 && toolbar.step >= 0, "Search/Step must remain sticky while scrolling");
    assert(toolbar.height < 230, "sticky toolbar must stay compact on phones");
    await run('searchFor("Exposure");field("slider-Exposure","value").focus();');
    const focus = await run('({top:document.activeElement.getBoundingClientRect().top,bottom:toolbar.getBoundingClientRect().bottom})');
    assert(focus.top >= focus.bottom, "toolbar must not cover focused card input");
    await run('document.querySelector("#clearSearch").click()');
    const controls = await run(`['sdk','win-ui'].flatMap(tab=>{selectExecution(tab);return Array.from(document.querySelectorAll('button,input,textarea,summary,select')).filter(e=>e.getClientRects().length).map(e=>({id:e.id,tag:e.tagName,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));})`);
    for (const control of controls) assert(control.width >= 44 && control.height >= 44 && control.left >= 0 && control.right <= width + 1, JSON.stringify(control));
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'), true, "no horizontal overflow");
    await run('selectExecution("win-ui");searchFor("Brush amount");document.querySelector(".card:not([hidden]) details").open=true;');
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'), true, "expanded PowerShell stays within phone width");
    await run('selectExecution("sdk");searchFor("Configure Develop Presets");document.querySelector(".card:not([hidden]) details").open=true;document.querySelector(".card:not([hidden]) textarea").focus();');
    assert.equal(await run('document.activeElement.getBoundingClientRect().top>=toolbar.getBoundingClientRect().bottom'), true, "POST body focus stays below toolbar");
    await run('document.querySelector("#clearSearch").click()');
    // Group navigation must account for the toolbar, not land underneath it.
    await run('openJumpMenu();groups.get("Crop").link.click()');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const anchor = await run('({top:document.getElementById("group-Crop").getBoundingClientRect().top,bottom:toolbar.getBoundingClientRect().bottom})');
    assert(anchor.top >= anchor.bottom, "group heading must stay below sticky toolbar");
    assert(anchor.top - anchor.bottom <= 40, "group navigation must not apply the toolbar offset twice");
    await run('searchFor("Exposure");window.scrollTo(0,2000);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await run('document.querySelector("#toTop").click()');
    assert.deepEqual(await run('({y:scrollY,search:searchEl.value,step:stepSize,value:field("slider-Exposure","value").value})'),{y:0,search:"Exposure",step:4,value:"1.25"}, "Top only scrolls");
    if (process.env.LRBRIDGE_LAYOUT_ARTIFACTS) {
        const fs = require("node:fs"), path = require("node:path");
        for (const [name, query] of [["brush", "Brush amount"], ["workflow", "Paste Settings"], ["sdk-top", ""], ["point-color", "Point Color"], ["mask-point-color", "Masking / Point Color"]]) {
            await run('selectExecution('+JSON.stringify(name==="brush"?"win-ui":"sdk")+');searchFor(' + JSON.stringify(query) + ')');
            await run('document.querySelectorAll("details").forEach(d=>d.open=false)');
            if (name.endsWith("-top")) await run('window.scrollTo(0,0)');
            if (name.endsWith("point-color")) await run('groups.get('+JSON.stringify(query)+').rangeGrid.scrollIntoView({block:"start"})');
            const shot = await cdp.send("Page.captureScreenshot", {format:"png"});
            fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS, {recursive:true});
            fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,"builder-" + name + "-" + width + ".png"), Buffer.from(shot.data,"base64"));
        }
    }
};

async function checkRefinedPresentation({run, cdp, width}) {
    assert.deepEqual(await run('Array.from(document.querySelectorAll("#introduction p")).map(p=>p.textContent)'), [
        "Create commands for Bitfocus Companion’s Generic: HTTP Requests module, or copy a command to test LRBridge in PowerShell.",
        "Companion: For cards with a URL, set the module’s Base URL to the address below. Add an http: GET action to a Companion button, then use Copy path and paste it into the action’s URI field.",
        "PowerShell: Use Copy PowerShell, paste into PowerShell and run it. Some actions require a complete script instead of a single URL; those cards provide the script.",
        "This page only creates and copies commands. It does not run them. After running a command, allow Lightroom time to respond before repeating it.",
        "Use LRBridge only on a trusted local network or through a trusted VPN. Do not expose its ports directly to the internet."
    ]);
    assert.deepEqual(await run('Array.from(document.querySelectorAll("#introduction strong")).map(e=>e.textContent)'), ["Companion:", "PowerShell:"]);
    assert.equal(await run('document.querySelector("header a")'), null);
    const tabs = await run(`(()=>{const strip=document.querySelector('.execution-tabs'),tab=document.querySelector('#tab-sdk'),note=document.querySelector('#executionDescription'),style=getComputedStyle(tab);return {
        afterIntro:strip.getBoundingClientRect().top>=document.querySelector('#introduction').getBoundingClientRect().bottom,
        aboveToolbar:note.getBoundingClientRect().bottom<=toolbar.getBoundingClientRect().top,
        joined:Math.abs(tab.getBoundingClientRect().bottom-strip.getBoundingClientRect().bottom)<=1,
        divider:getComputedStyle(strip).borderBottomWidth, upper:style.borderTopLeftRadius, lower:style.borderBottomLeftRadius,
        background:style.backgroundColor,bottom:style.borderBottomColor,content:getComputedStyle(note.closest('.execution-switch')).backgroundColor};})()`);
    assert(tabs.afterIntro && tabs.aboveToolbar && tabs.joined);
    assert.equal(tabs.divider, "1px");
    assert(parseFloat(tabs.upper)>0 && tabs.lower==="0px");
    assert.equal(tabs.background,tabs.content);
    assert.equal(tabs.bottom,tabs.content, "active tab joins content through shared divider");
    const descriptions = {sdk:"These commands apply changes through Lightroom’s plug-in SDK.","win-ui":"These commands operate Lightroom’s on-screen controls using Windows automation."};
    await run('document.querySelector("#tab-sdk").focus()');
    for (const [key, execution] of [["ArrowRight","win-ui"],["ArrowLeft","sdk"],["End","win-ui"],["Home","sdk"]]) {
        await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key});
        await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key});
        assert.deepEqual(await run('({execution:activeExecution,focus:document.activeElement.id,description:document.querySelector("#executionDescription").textContent,selected:document.activeElement.getAttribute("aria-selected")})'),
            {execution,focus:"tab-"+execution,description:descriptions[execution],selected:"true"});
        assert.equal(await run('document.activeElement.matches(":focus-visible")&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2'),true);
    }
    assert.deepEqual(await run('Array.from(document.querySelectorAll("#stepHint p")).map(p=>p.textContent)'),stepHelpParagraphs);
    const topStyle = await run('({background:getComputedStyle(document.querySelector("#toTop")).backgroundColor,color:getComputedStyle(document.querySelector("#toTop")).color})');
    assert.deepEqual(topStyle,{background:"rgb(255, 180, 84)",color:"rgb(16, 20, 24)"});
    await run('window.scrollTo(0,toolbar.getBoundingClientRect().top+scrollY);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await run('document.querySelector("#toTop").focus()');
    assert.equal(await run('document.activeElement.matches(":focus-visible")&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2'),true);
    const topPosition = await run('(()=>{const r=document.querySelector("#toTop").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",...topPosition});
    assert.equal(await run('getComputedStyle(document.querySelector("#toTop")).backgroundColor'),"rgb(255, 203, 133)","Top hover remains clear");
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:0,y:0});

    for (const name of ["Point Color", "Masking / Point Color"]) {
        await run('searchFor('+JSON.stringify(name)+')');
        const layout = await run(`(()=>{const g=groups.get(${JSON.stringify(name)}),cards=Array.from(g.rangeGrid.children);return {
            titles:cards.map(c=>c.querySelector('h3').textContent),compact:g.grid.children.length,
            afterCompact:g.rangeGrid.getBoundingClientRect().top>=g.grid.getBoundingClientRect().bottom,
            sameSection:g.rangeGrid.parentElement===g.section,
            columns:getComputedStyle(g.rangeGrid).gridTemplateColumns.split(' ').length,
            tops:cards.map(c=>c.getBoundingClientRect().top),lefts:cards.map(c=>c.getBoundingClientRect().left)};})()`);
        assert.deepEqual(layout.titles,["Hue Range","Sat Range","Lum Range"]);
        assert(layout.compact>0 && layout.afterCompact && layout.sameSection);
        assert.equal(layout.columns,width>=1100?3:1);
        if(width>=1100) assert.equal(new Set(layout.tops).size,1,"three range cards share a desktop row");
        else assert.equal(new Set(layout.lefts).size,1,"range cards stack on phones");
        const saved = await run(`(()=>{const g=groups.get(${JSON.stringify(name)});window.rangeInput=g.rangeGrid.querySelector('input');window.rangeValue=rangeInput.value;window.rangeNodes=Array.from(g.section.querySelectorAll('.card'));return rangeNodes.map(c=>c.dataset.cardId);})()`);
        await run('rangeInput.value="0.1";rangeInput.dispatchEvent(new Event("input"));rangeInput.focus();rangeNodes.find(c=>c.contains(rangeInput)).querySelector("details").open=true;');
        await run('selectExecution("win-ui");selectExecution("sdk");searchFor("HueRange");');
        assert.equal(await run('rangeInput.value'),"0.1");
        assert.equal(await run('rangeInput.closest(".card").hidden'),false,"range generator remains searchable");
        const groupVisibility = await run(`(()=>{const g=groups.get(${JSON.stringify(name)});return {compact:g.grid.hidden,ranges:g.rangeGrid.hidden,group:g.section.hidden,listed:jumpMenu.contains(g.link)};})()`);
        assert.deepEqual(groupVisibility,{compact:true,ranges:false,group:false,listed:true});
        await run('searchFor('+JSON.stringify(name)+')');
        assert.deepEqual(await run('rangeNodes.map(c=>c.dataset.cardId)'),saved);
        assert.equal(await run(`Array.from(groups.get(${JSON.stringify(name)}).section.querySelectorAll('.card')).every((c,i)=>c===rangeNodes[i])`),true,"editing/search/disclosure must retain DOM order and input nodes");
        assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'),true);
        await run('rangeInput.value=rangeValue;rangeInput.dispatchEvent(new Event("input"));document.querySelectorAll("details").forEach(d=>d.open=false)');
    }
    await run('searchFor("");window.scrollTo(0,0)');
}

async function checkPageOrderAndTop({run, cdp, width}) {
    const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const scroll = async y => { await run('window.scrollTo(0,'+y+')'); await settle(); };
    const state = () => run(`({tab:activeExecution,search:searchEl.value,step:stepSize,base:apiBase,
        values:Array.from(document.querySelectorAll('input,textarea')).map(i=>[i.id,i.value,i.checked]),
        cards:cardRecords.map(r=>[r.id,r.card.parentElement.className])})`);
    const topState = () => run('({disabled:toTop.disabled,hidden:toTop.hidden})');
    assert.equal(await run('scrollY'),0);
    assert.deepEqual(await topState(),{disabled:false,hidden:false},"Top is permanently available");
    const order = await run(`(()=>{const nodes=['header','.base-section','.execution-tabs','#executionDescription','#toolbar','#resultCount','#cardGroups'].map(s=>document.querySelector(s));return nodes.map((n,i)=>{
        const r=n.getBoundingClientRect();return {selector:n.id||n.className||n.tagName,top:r.top,bottom:r.bottom,domOrder:!i||!!(nodes[i-1].compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING)};});})()`);
    assert(order.every((r,i)=>r.domOrder&&(!i||r.top>=order[i-1].bottom)),"title/intro, Base URL, tabs/note, toolbar, result count, cards");
    const alignment = await run(`(()=>{const selectors=['#introduction','section[aria-labelledby=baseHeading]','.execution-tabs button','#search','#resultCount'];return selectors.map(s=>document.querySelector(s).getBoundingClientRect().left);})()`);
    assert(alignment.every(left=>Math.abs(left-alignment[0])<1),"content left edges align");
    assert.equal(await run('document.querySelector("section[aria-labelledby=baseHeading]").getBoundingClientRect().width===document.querySelector("#commandPanel").getBoundingClientRect().width'),true,"Base URL and cards share the same content width");
    const warning = await run(`(()=>{const p=document.querySelector('#introduction #networkWarning'),s=getComputedStyle(p);return {tag:p.tagName,text:p.textContent,color:s.color,weight:s.fontWeight};})()`);
    assert.deepEqual(warning,{tag:"P",text:"Use LRBridge only on a trusted local network or through a trusted VPN. Do not expose its ports directly to the internet.",color:"rgb(125, 211, 199)",weight:"700"});
    const marker = await run('toolbar.getBoundingClientRect().top+scrollY');
    for (const y of [200,Math.floor(marker)-1,Math.ceil(marker)+1,Math.floor(marker)-1,0]) {
        await scroll(y);
        assert.deepEqual(await topState(),{disabled:false,hidden:false});
        assert.equal(await run('document.querySelector("#stepControls").hidden'),false);
    }
    // Step controls follow Jump even before the toolbar sticks.
    await run('jumpTo.focus({preventScroll:true})');
    await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",windowsVirtualKeyCode:9});
    await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",windowsVirtualKeyCode:9});
    assert.equal(await run('document.activeElement.id'),'decreaseStep');
    const original = await state();
    await run('window.savedBaseNode=document.querySelector("section[aria-labelledby=baseHeading]");hostInput.value="192.168.1.22";setBaseHost(hostInput.value);setStep("3");window.topTestInput=document.querySelector("[data-slider=Contrast] input[data-input=value]");topTestInput.value="17";topTestInput.dispatchEvent(new Event("input"))');
    for(const tab of ["sdk","win-ui"]) {
        await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:0,y:0});
        await run('selectExecution('+JSON.stringify(tab)+');searchEl.value="Lens Blur";filterCards()');
        assert.equal(await run('document.querySelector("section[aria-labelledby=baseHeading]")===savedBaseNode&&!savedBaseNode.closest("[role=tabpanel]")&&baseUrlEl.textContent===apiBase'),true,"one shared Base URL survives tab switches");
        const saved = await state();
        await run('window.scrollTo(0,toolbar.getBoundingClientRect().top+scrollY+250)'); await settle();
        const sticky = await run('({top:toolbar.getBoundingClientRect().top,height:toolbar.offsetHeight,step:stepInput.getBoundingClientRect().top,search:searchEl.getBoundingClientRect().top})');
        assert(Math.abs(sticky.top)<1&&sticky.step>=0&&sticky.search>=0&&sticky.height<230,"toolbar stays sticky and compact");
        assert.equal((await topState()).disabled,false);
        assert.equal(await run('getComputedStyle(toTop).backgroundColor'),"rgb(255, 180, 84)");
        assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'),true);
        if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS&&tab==="sdk") {
            const fs=require("node:fs"),path=require("node:path");
            fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,{recursive:true});
            const shot=await cdp.send("Page.captureScreenshot",{format:"png"});
            fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,"builder-sticky-"+width+".png"),Buffer.from(shot.data,"base64"));
        }
        const point = await run('(()=>{const r=toTop.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
        await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
        await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
        await settle();
        assert.equal(await run('scrollY'),0);
        assert.equal((await topState()).hidden,false);
        assert.deepEqual(await state(),saved,"Top preserves tab, search, step, Base URL, all values and card ordering");
    }
    await run('hostInput.value='+JSON.stringify(original.values.find(v=>v[0]==="hostInput")[1])+';setBaseHost(hostInput.value);setStep('+JSON.stringify(String(original.step))+');topTestInput.value='+JSON.stringify(original.values.find(v=>v[0].includes("slider-Contrast")&&v[0].includes("value"))[1])+';topTestInput.dispatchEvent(new Event("input"));selectExecution("sdk");searchEl.value="";filterCards();setStatus("")');
    await scroll(0);
}

async function checkJumpNavigation({run, cdp, width}) {
    const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const values = () => run(`({tab:activeExecution,search:searchEl.value,step:stepSize,base:apiBase,
        inputs:Array.from(document.querySelectorAll('input,textarea')).map(i=>[i.id,i.value,i.checked])})`);
    const options = () => run('Array.from(jumpMenu.children).map(link=>[link.dataset.groupId,link.textContent])');
    assert.equal(await run('document.querySelectorAll("#groupNav,.group-nav").length'),0,"old section rows are removed");
    assert.equal(await run('jumpTo.textContent'),"Jump to…");
    assert.equal(await run('document.querySelectorAll("select").length'),0,"native select removed");
    assert.deepEqual(await run('Array.from(document.querySelectorAll(".toolbar-controls > div,.toolbar-controls > button")).map(e=>e.className||e.id)'),["search-controls","jump-controls","step-controls","toTop"],"toolbar control order");
    const initial = await values();
    const expectedOrder = await run('Array.from(groups).map(([name,g])=>[g.section.id,name])');
    await run('window.jumpTestInput=document.querySelector("[data-slider=Contrast] input[data-input=value]");jumpTestInput.value="23";jumpTestInput.dispatchEvent(new Event("input"));setStep("5")');
    for(const [tab,query] of [["sdk",""],["win-ui",""],["sdk","Point Color"],["win-ui","Brush"],["sdk","Contrast"],["win-ui","Contrast"],["sdk","no-such-section"]]) {
        await run('window.scrollTo(0,40)'); await settle();
        await run('selectExecution('+JSON.stringify(tab)+');searchEl.value='+JSON.stringify(query)+';filterCards()');
        await settle();
        assert.equal(await run('scrollY'),40,"tab/search option refresh does not navigate");
        const actual = await options();
        const expected = await run('Array.from(groups).filter(([,g])=>g.records.some(r=>!r.card.hidden)).map(([name,g])=>[g.section.id,name])');
        assert.deepEqual(actual,expected,"only sections with active-tab search matches");
        assert.deepEqual(actual,expectedOrder.filter(([id])=>actual.some(([listed])=>listed===id)),"original group names and order");
        assert.equal(await run('jumpTo.disabled'),!actual.length);
        assert.equal(await run('jumpMenu.hidden'),true,"option updates never open or select a section");
        assert.equal(await run('document.querySelector("#resultCount").getBoundingClientRect().bottom<=document.querySelector("#collection").getBoundingClientRect().top'),true,"result count remains above cards");
        if(!actual.length) continue;
        await run('window.scrollTo(0,toolbar.getBoundingClientRect().top+scrollY+50);jumpTo.focus({preventScroll:true})'); await settle();
        const beforeRefresh = await run('({scroll:scrollY,focus:document.activeElement.id})');
        await run('updateGroupNavigation()'); await settle();
        assert.deepEqual(await run('({scroll:scrollY,focus:document.activeElement.id})'),beforeRefresh,"refreshing dropdown options preserves focus and scroll");
        const saved = await values();
        for(const [id] of actual) {
            await run('openJumpMenu();jumpMenu.querySelector('+JSON.stringify('[data-group-id="'+id+'"]')+').click()'); await settle();
            const bounds = await run('(()=>{const h=document.getElementById('+JSON.stringify(id)+').querySelector("h2").getBoundingClientRect();return {top:h.top,bottom:h.bottom,toolbar:toolbar.getBoundingClientRect().bottom};})()');
            assert(bounds.top>=bounds.toolbar&&bounds.bottom<=900,"section heading fully visible below toolbar: "+id+" "+JSON.stringify(bounds));
            assert.equal(await run('jumpMenu.hidden&&jumpTo.getAttribute("aria-expanded")==="false"'),true,"selection closes the popup");
        }
        assert.deepEqual(await values(),saved,"navigation preserves tab, search, step, Base URL and all entered card values");
        const touch = await run('(()=>{const r=jumpTo.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,toolbar:toolbar.offsetHeight};})()');
        assert(touch.width>=44&&touch.height>=44&&touch.left>=0&&touch.right<=width&&touch.toolbar<230,"compact touch dropdown within viewport");
        assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'),true);
    }
    await checkOpenJumpPopup({run,cdp,width,settle,values});
    await run('jumpTestInput.value='+JSON.stringify(initial.inputs.find(i=>i[0]==="slider-Contrast-value")[1])+';jumpTestInput.dispatchEvent(new Event("input"));setStep('+JSON.stringify(String(initial.step))+');selectExecution("sdk");searchEl.value="";filterCards();window.scrollTo(0,0)'); await settle();
}

async function checkOpenJumpPopup({run,cdp,width,settle,values}) {
    const key = async (key,code) => {
        await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key,windowsVirtualKeyCode:code,...(key==="Enter"?{text:"\r"}:{})});
        await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key,windowsVirtualKeyCode:code}); await settle();
    };
    const point = selector => run('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    const tap = async p => {
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...p,id:1}]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await settle();
    };
    await run('selectExecution("sdk");searchEl.value="";filterCards();window.scrollTo(0,toolbar.getBoundingClientRect().top+scrollY+50)'); await settle();
    const saved = await values();
    const page = () => run('({scroll:scrollY,height:document.documentElement.scrollHeight,toolbar:toolbar.getBoundingClientRect().height,card:document.querySelector(".card:not([hidden])").getBoundingClientRect().top})');
    const closedPage = await page();
    await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    try {
        await tap(await point('#jumpTo'));
        assert.equal(await run('jumpMenu.hidden'),false,"tap opens the custom popup without hover");
        assert.deepEqual(await page(),closedPage,"opening overlays cards without page or toolbar shifts");
        assert.equal(await run('jumpTo.getAttribute("aria-expanded")'),"true");
        const open = await run(`(()=>{const r=jumpMenu.getBoundingClientRect(),panel=getComputedStyle(jumpMenu);return {width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
            columns:panel.gridTemplateColumns.split(' ').length,gap:panel.gap,border:panel.borderTopWidth+' '+panel.borderTopColor,background:panel.backgroundImage,radius:panel.borderRadius,
            scroll:jumpMenu.scrollHeight>jumpMenu.clientHeight,items:Array.from(jumpMenu.children).map(a=>{const s=getComputedStyle(a),r=a.getBoundingClientRect();return {height:r.height,font:s.fontSize,weight:s.fontWeight,background:s.backgroundColor,color:s.color,padding:s.paddingLeft,right:s.paddingRight,wrap:s.whiteSpace,left:r.left,top:r.top};})};})()`);
        assert(Math.abs(open.width-Math.min(620,width-16))<=1&&open.left>=0&&open.right<=width&&open.top>=0&&open.bottom<=900,"open popup fits viewport at about 620px wide");
        assert.equal(open.columns,width>520?2:1,"two columns on desktop/tablet, one on narrow phones");
        assert.equal(open.gap,"10px");
        assert.equal(open.border,"2px rgb(209, 138, 54)","Web Controller amber panel border");
        assert.equal(open.background,"linear-gradient(rgb(122, 76, 24) 0%, rgb(95, 57, 18) 100%)","Web Controller amber panel gradient");
        assert.equal(open.radius,"16px");
        assert(open.scroll,"full SDK list must scroll within the popup");
        for(const item of open.items) assert(item.height>=54&&item.font==="16px"&&Number(item.weight)>=600&&["rgb(16, 16, 16)","rgb(26, 26, 26)"].includes(item.background)&&item.color==="rgb(244, 244, 244)"&&parseFloat(item.padding)>=16&&parseFloat(item.right)>=16&&item.wrap==="normal",JSON.stringify(item));
        const rows=Math.ceil(open.items.length/open.columns);
        for(let i=0;i<open.items.length;i++) {
            assert.equal(open.items[i].left,open.items[Math.floor(i/rows)*rows].left,"original order runs down each column, like the Web Controller");
            if(i%rows) assert(open.items[i].top>=open.items[i-1].top+open.items[i-1].height+9,"buttons have clear vertical spacing");
        }
        if(open.columns===2) assert(open.items[rows].left>open.items[0].left&&open.items[rows].top===open.items[0].top,"columns begin on the same row");
        await run('window.longLink=jumpMenu.lastElementChild;window.longTitle=longLink.textContent;longLink.textContent="Masking / Long section name with several readable words and aVeryLongUnbrokenNameThatMustWrapWithoutClipping"');
        assert.equal(await run('longLink.getBoundingClientRect().height>54&&longLink.scrollWidth<=longLink.clientWidth'),true,"long section names wrap without clipping");
        await run('longLink.textContent=longTitle');
        if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS) {
            const fs=require("node:fs"),path=require("node:path"),shot=await cdp.send("Page.captureScreenshot",{format:"png"});
            fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,"builder-popup-open-"+width+".png"),Buffer.from(shot.data,"base64"));
        }
        // Browser-simulated touch pans the open list; this is not an Android device test.
        const start = await run('(()=>{const p=jumpMenu.getBoundingClientRect(),a=Array.from(jumpMenu.children).filter(a=>{const r=a.getBoundingClientRect();return r.left<p.left+p.width/2&&r.top>p.top+240&&r.bottom<p.bottom-8;}).at(-1),r=a.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...start,id:2}]});
        for(let i=1;i<=8;i++) {
            await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:start.x,y:start.y-i*30,id:2}]});
            await new Promise(resolve=>setTimeout(resolve,25));
        }
        await new Promise(resolve=>setTimeout(resolve,120));
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await settle();
        assert.equal(await run('jumpMenu.scrollTop>100'),true,"finger swipe scrolls the list");
        assert.equal(await run('jumpMenu.hidden'),false,"swipe must not select an item");
        assert.deepEqual(await page(),closedPage,"popup finger scroll must not scroll the page");
        assert.deepEqual(await values(),saved);
        // Tap a fully visible item after scrolling; the preceding swipe cannot swallow a fresh tap.
        const target = await run(`(()=>{const p=jumpMenu.getBoundingClientRect(),a=Array.from(jumpMenu.children).find(a=>{const r=a.getBoundingClientRect();return r.top>p.top+4&&r.bottom<p.bottom-4}),r=a.getBoundingClientRect();return {id:a.dataset.groupId,x:r.left+r.width/2,y:r.top+r.height/2};})()`);
        await tap({x:target.x,y:target.y});
        assert.equal(await run('jumpMenu.hidden'),true,"touch selection closes the popup");
        assert.equal(await run('(()=>{const r=document.getElementById('+JSON.stringify(target.id)+').querySelector("h2").getBoundingClientRect();return r.top>=toolbar.getBoundingClientRect().bottom&&r.bottom<=innerHeight;})()'),true,"touch-selected heading is visible below toolbar");
        assert.deepEqual(await values(),saved);
        await tap(await point('#jumpTo'));
        await tap({x:2,y:Math.min(880,open.bottom+16)});
        assert.equal(await run('jumpMenu.hidden'),true,"outside tap dismisses popup");
    } finally { await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:false}); }
    await run('jumpTo.focus({preventScroll:true})');
    await key('ArrowDown',40);
    assert.equal(await run('document.activeElement===jumpMenu.firstElementChild'),true,"keyboard opens onto first section");
    assert.equal(await run('document.activeElement.matches(":focus-visible")&&getComputedStyle(document.activeElement).outlineStyle!=="none"'),true);
    await key('End',35);
    assert.equal(await run('document.activeElement===jumpMenu.lastElementChild&&jumpMenu.scrollTop>0'),true);
    await key('Home',36); await key('ArrowDown',40);
    assert.equal(await run('document.activeElement===jumpMenu.children[1]'),true);
    await key('Escape',27);
    assert.equal(await run('jumpMenu.hidden&&document.activeElement===jumpTo'),true,"Escape closes and returns focus to trigger");
    await key('Enter',13);
    assert.equal(await run('!jumpMenu.hidden&&document.activeElement===jumpMenu.firstElementChild'),true,"Enter opens keyboard navigation: "+await run('JSON.stringify({hidden:jumpMenu.hidden,focus:document.activeElement.outerHTML.slice(0,180)})'));
    await key('Enter',13);
    assert.equal(await run('jumpMenu.hidden'),true,"keyboard selection closes the menu");
    assert.deepEqual(await values(),saved);
    await run('jumpTo.focus({preventScroll:true})'); await key('ArrowDown',40); await key('End',35); await key('Tab',9);
    assert.equal(await run('jumpMenu.hidden&&document.activeElement.id==="decreaseStep"'),true,"Tab leaves popup in normal toolbar order");
    await run('window.scrollTo(0,toolbar.getBoundingClientRect().top+scrollY);openJumpMenu()'); await settle();
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:400,deviceScaleFactor:1,mobile:width<500}); await settle();
    assert.equal(await run('(()=>{const r=jumpMenu.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&jumpMenu.scrollHeight>jumpMenu.clientHeight;})()'),true,"open popup resizes to available short-screen space");
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    await run('closeJumpMenu()'); await settle();
}

async function checkToolbarRows(options) {
    return require('./http-builder-scroll')(options);
}

async function checkStepHelp({run,cdp,width}) {
    assert.deepEqual(await run('Array.from(document.querySelectorAll("#stepHint p")).map(p=>p.textContent)'),stepHelpParagraphs);
    assert.equal(await run('document.querySelectorAll("#stepHint").length'),1);
    assert.deepEqual(await run('Array.from(document.querySelector(".execution-notes").children).map(e=>[e.id,e.textContent])'),[["executionDescription","These commands apply changes through Lightroom’s plug-in SDK."]]);
    assert.equal(await run('stepInput.getAttribute("aria-describedby")'),"stepHint stepError");
    await run('window.scrollTo(0,toolbar.getBoundingClientRect().top+scrollY+10)');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const {root}=await cdp.send('DOM.getDocument');
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#stepInput'});
    const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
    assert.equal(nodes[0].description.value.replace(/\s+/g,' ').trim(),stepHelpParagraphs.join(' '),"step input exposes the complete explanation to assistive technology");
    await run('window.scrollTo(0,0)');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const layout=await run(`(()=>{const hint=document.querySelector('#stepHint'),box=hint.closest('section[aria-labelledby=baseHeading]'),heading=document.querySelector('#stepHeading'),line=heading.previousElementSibling;
        const r=hint.getBoundingClientRect(),b=box.getBoundingClientRect(),h=heading.getBoundingClientRect(),d=line.getBoundingClientRect();return {
            box:!!box,heading:heading.tagName,title:heading.textContent,small:parseFloat(getComputedStyle(heading).fontSize)<parseFloat(getComputedStyle(document.querySelector('#baseHeading')).fontSize),
            divider:line.tagName,border:getComputedStyle(line).borderTopWidth,ordered:line.previousElementSibling.getBoundingClientRect().bottom<=d.top&&d.bottom<=h.top&&h.bottom<=r.top,
            contained:r.left>=b.left&&r.right<=b.right&&r.bottom<=b.bottom,paragraphs:Array.from(hint.children).every(p=>p.scrollWidth<=p.clientWidth&&parseFloat(getComputedStyle(p).fontSize)>=14),
            connected:toolbar.contains(stepInput),outside:!toolbar.contains(hint)};})()`);
    assert.deepEqual(layout,{box:true,heading:'H3',title:'Step size',small:true,divider:'HR',border:'1px',ordered:true,contained:true,paragraphs:true,connected:true,outside:true});
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true);
    if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS) {
        await run('window.scrollTo(0,document.querySelector("#stepHeading").getBoundingClientRect().top+scrollY-24)');
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,{recursive:true});
        const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,'builder-step-help-'+width+'.png'),Buffer.from(shot.data,'base64'));
    }
}
