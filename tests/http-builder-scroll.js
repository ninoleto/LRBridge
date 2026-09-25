"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function checkScroll({run,cdp,width}) {
    const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const scroll = async y => {await run('window.scrollTo(0,'+y+')');await settle();};
    const state = () => run(`({tab:activeExecution,search:searchEl.value,step:stepSize,
        values:Array.from(document.querySelectorAll('input,textarea')).map(e=>[e.id,e.value,e.checked])})`);
    await scroll(0);
    assert.equal(await run('document.querySelector("#toolbarMarker")'),null);
    assert.deepEqual(await run('Array.from(document.querySelector(".toolbar-controls").children).map(e=>e.className||e.id)'),['search-controls','jump-controls','step-controls','toTop']);
    const layout = async () => {
        const info=await run(`(()=>{const bar=toolbar.getBoundingClientRect();return {height:bar.height,
            rows:['.search-controls','.jump-controls','#stepControls','#toTop'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top-bar.top,bottom:r.bottom-bar.top,center:(r.top+r.bottom)/2-bar.top};}),
            controls:Array.from(document.querySelectorAll('.toolbar-controls button,.toolbar-controls input,#baseStepControls button,#baseStepInput')).map(e=>{
                const r=e.getBoundingClientRect();return {id:e.id,width:r.width,height:r.height,left:r.left,right:r.right,hidden:!e.getClientRects().length};})};})()`);
        const [search,jump,step,top]=info.rows;
        const sameRow=items=>items.every(r=>Math.abs(r.center-items[0].center)<1);
        if(width>1000) assert(sameRow(info.rows)&&search.right<jump.left&&jump.right<step.left&&step.right<top.left);
        else if(width>520) assert(search.bottom<jump.top&&sameRow([jump,step,top])&&jump.right<step.left&&step.right<top.left);
        else assert(search.bottom<jump.top&&jump.bottom<step.top&&sameRow([step,top])&&step.right<=top.left);
        for(const item of info.controls) assert(!item.hidden&&item.width>=44&&item.height>=44&&item.left>=0&&item.right<=width,JSON.stringify(item));
        assert(info.height<=(width>1000?70:width>520?124:175),'compact toolbar: '+info.height);
        assert.equal(await run('toTop.disabled||toTop.hidden||document.querySelector("#stepControls").hidden'),false);
        assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true);
        assert.equal(await run('parseFloat(document.documentElement.style.getPropertyValue("--toolbar-height"))===Math.ceil(toolbar.getBoundingClientRect().height)'),true);
        return info;
    };
    const atTop=await layout();
    const formerDock=await run('toolbar.getBoundingClientRect().top+scrollY');
    await scroll(formerDock+100);
    assert.deepEqual(await layout(),atTop,'scrolling does not resize or hide controls');
    assert.equal(await run('toolbar.getBoundingClientRect().top'),0);
    await run('searchEl.focus({preventScroll:true})');
    for(const id of ['clearSearch','jumpTo','decreaseStep','stepInput','increaseStep','toTop']) {
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',windowsVirtualKeyCode:9});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',windowsVirtualKeyCode:9});
        assert.equal(await run('document.activeElement.id'),id,'keyboard order');
    }
    if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS) {
        fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,{recursive:true});
        const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,'builder-permanent-toolbar-'+width+'.png'),Buffer.from(shot.data,'base64'));
    }
    await checkOrdering({run});
    await checkSteps({run,cdp,width,settle});
    await run('searchEl.value="Contrast";filterCards()');
    const saved=await state();
    for(const start of [0,formerDock+80]) {
        await scroll(start);
        await run('jumpTo.click();jumpMenu.firstElementChild.click()');await settle();
        const heading=await run('(()=>{const r=groups.get("Basic").section.querySelector("h2").getBoundingClientRect();return {top:r.top,bottom:r.bottom,bar:toolbar.getBoundingClientRect().bottom};})()');
        assert(heading.top>=heading.bar&&heading.top-heading.bar<=40&&heading.bottom<=900,JSON.stringify(heading));
        assert.equal(await run('jumpMenu.hidden'),true);
        assert.deepEqual(await state(),saved);
    }
    await run('toTop.click()');await settle();
    assert.equal(await run('scrollY'),0);
    assert.deepEqual(await state(),saved);
    await run('searchEl.value="";filterCards();document.activeElement.blur()');await settle();
    // Slow/full-collection input checks run at desktop and narrow-phone widths, not at every CSS breakpoint.
    if(width===1280||width===320) await checkContinuousScrolling({run,cdp,width,settle});
    await scroll(0);
};

async function checkOrdering({run}) {
    assert.equal(await run('cardRecords.length'),420);
    assert.equal(await run('sliders.filter(s=>s.id!=="LensProfileChromaticAberrationScale").every(s=>sliderPresentation.has(s.id))'),true,'all public slider IDs have an explicit panel/control position');
    assert.equal(await run('Array.from(groups.keys()).every(name=>builderPanelOrder.some(([listed])=>listed===name))'),true,'no unlisted group silently appended after metadata');
    assert.equal(await run('["Tone","Color","Color Mixer / HSL","Lens / Defringe"].some(name=>groups.has(name))'),false,'metadata names mapped to the intended panels');
    assert.deepEqual(await run('Array.from(document.querySelectorAll(".command-group > h2")).map(e=>e.textContent)'),await run('builderPanelOrder.map(([name])=>name)'));
    assert.deepEqual(await run('Array.from(groups.get("Basic").grid.children).map(e=>e.dataset.slider)'),['Exposure','Contrast','Highlights','Shadows','Whites','Blacks']);
    await run('window.orderedCards=Array.from(document.querySelectorAll(".card"));window.orderInput=document.querySelector("#slider-Contrast-value");orderInput.value="17";orderInput.dispatchEvent(new Event("input"))');
    for(const [tab,query] of [['sdk','contrast'],['sdk','Point Color'],['win-ui','Brush'],['sdk','no-such-result'],['sdk','']]) {
        await run('selectExecution('+JSON.stringify(tab)+');searchEl.value='+JSON.stringify(query)+';filterCards()');
        assert.equal(await run('orderedCards.every((e,i)=>document.querySelectorAll(".card")[i]===e)'),true,'filter preserves existing elements and order');
        assert.equal(await run('orderInput.value'),"17");
        const visible=await run('Array.from(document.querySelectorAll(".command-group:not([hidden]) > h2")).map(e=>e.textContent)');
        assert.deepEqual(await run('Array.from(jumpMenu.children).map(e=>e.textContent)'),visible,'Jump reflects the same filtered panel order');
        if(query==='contrast') assert.equal(await run('document.querySelector(".card:not([hidden])").dataset.cardId'),'slider-Contrast','main Basic Contrast precedes HDR/local/masking matches');
    }
    for(const group of ['Point Color','Masking / Point Color']) {
        assert.deepEqual(await run('Array.from(groups.get('+JSON.stringify(group)+').rangeGrid.children).map(c=>c.querySelector("h3").textContent)'),['Hue Range','Sat Range','Lum Range']);
        assert.equal(await run('groups.get('+JSON.stringify(group)+').grid.nextElementSibling===groups.get('+JSON.stringify(group)+').rangeGrid'),true);
    }
}

async function checkSteps({run,cdp,width,settle}) {
    const inputs=['stepInput','baseStepInput'];
    const state=()=>run('Array.from(document.querySelectorAll(".card input,.card textarea")).map(e=>[e.id,e.value,e.checked])');
    const nonRelative=()=>run('Array.from(document.querySelectorAll(".command:not([data-relative])")).map(e=>[e.dataset.path,e.textContent])');
    const original=await state(),commands=await nonRelative();
    await run('window.stepNodes=[stepInput,baseStepInput];window.stepRefreshes=0;relativeCommands.push(()=>stepRefreshes++)');
    const synced=async n=>assert.deepEqual(await run('[stepSize,stepInput.value,baseStepInput.value]'),[n,String(n),String(n)]);
    for(const [id,minus,plus] of [['baseStepInput','baseDecreaseStep','baseIncreaseStep'],['stepInput','decreaseStep','increaseStep']]) {
        await run('document.getElementById('+JSON.stringify(plus)+').click()');await synced(2);
        await run('document.getElementById('+JSON.stringify(minus)+').click()');await synced(1);
        await run('document.getElementById('+JSON.stringify(minus)+').click()');await synced(1);
        await run('window.currentStep=document.getElementById('+JSON.stringify(id)+');currentStep.value="7";currentStep.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"}))');await synced(7);
        const refreshed=await run('stepRefreshes');
        await run('currentStep.dispatchEvent(new Event("blur"))');
        assert.equal(await run('stepRefreshes'),refreshed,'blur after Enter cannot repeat command updates');
        for(const value of ['0','-1','1.5','']) {
            await run('currentStep.value='+JSON.stringify(value)+';currentStep.dispatchEvent(new Event("blur"))');await synced(7);
            assert.equal(await run('stepInput.getAttribute("aria-invalid")==="true"&&baseStepInput.getAttribute("aria-invalid")==="true"'),true);
            assert.match(await run('document.querySelector("#baseStepError").textContent'),/positive whole number/);
        }
        await run('currentStep.value="3";currentStep.dispatchEvent(new Event("blur"))');await synced(3);
        assert.equal(await run('Array.from(document.querySelectorAll(".command[data-relative] .path")).some(e=>e.textContent.includes("amount=3"))'),true);
        assert.equal(await run('Array.from(document.querySelectorAll("[data-execution=win-ui] .command[data-relative] .path")).some(e=>e.textContent.includes("amount=3"))'),true,'hidden WIN UI adjustments also update');
        await run('setStep("1")');
    }
    assert.deepEqual(await state(),original,'Set and other entered values unchanged');
    assert.deepEqual(await nonRelative(),commands,'Set, Reset and other commands unchanged');
    assert.equal(await run('stepNodes[0]===stepInput&&stepNodes[1]===baseStepInput'),true);
    assert.equal(await run('["stepInput","baseStepInput","decreaseStep","increaseStep","baseDecreaseStep","baseIncreaseStep","stepError","baseStepError"].every(id=>document.querySelectorAll("#"+id).length===1)'),true,'unique Step control/error IDs');
    for(const id of inputs) {
        const {root}=await cdp.send('DOM.getDocument');
        const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#'+id});
        const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
        assert.match(nodes[0].description.value,/You can change Step size here or in the toolbar\. Both controls use the same setting\./);
    }
    await run('relativeCommands.pop()');await settle();
}

async function checkContinuousScrolling({run,cdp,width,settle}) {
    await run('window.scrollTo(0,0)');await settle();
    assert.equal(await run('cardRecords.filter(r=>!r.card.hidden).length'),406,'scroll the complete SDK collection');
    const max=await run('document.documentElement.scrollHeight-innerHeight');
    await cdp.send('Performance.enable');
    const before=(await cdp.send('Performance.getMetrics')).metrics;
    await run(`window.scrollProbe={frames:[],tasks:[],reads:0,writes:0};
        window.originalBarRect=toolbar.getBoundingClientRect;toolbar.getBoundingClientRect=function(){scrollProbe.reads++;return originalBarRect.call(this)};
        window.originalSetProperty=document.documentElement.style.setProperty;document.documentElement.style.setProperty=function(...args){scrollProbe.writes++;return originalSetProperty.apply(this,args)};
        window.scrollLongTasks=new PerformanceObserver(list=>scrollProbe.tasks.push(...list.getEntries().map(e=>e.duration)));scrollLongTasks.observe({type:'longtask'});
        window.scrollSampling=true;window.sampleScroll=t=>{scrollProbe.frames.push([t,scrollY]);if(scrollSampling)requestAnimationFrame(sampleScroll)};requestAnimationFrame(sampleScroll);`);
    const input=width===1280?'mouse':'touch';
    if(input==='touch') await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const phases=[];
    for(let cycle=0;cycle<2;cycle++) for(const direction of [-1,1]) {
        const start=await run('performance.now()');
        if(input==='touch') {
            // Explicit finger events work on Windows headless Chromium, where synthetic touch gestures can be no-ops.
            let y=await run('scrollY'),swipes=0;
            while(direction<0?y<max-1:y>1) {
                const startY=direction<0?800:220;
                await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:12,y:startY,id:1}]});
                for(let i=1;i<=6;i++) {
                    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:12,y:startY+direction*i*95,id:1}]});
                    await new Promise(resolve=>setTimeout(resolve,8));
                }
                await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
                await new Promise(resolve=>setTimeout(resolve,80));
                const next=await run('scrollY');
                assert(direction<0?next>y:next<y,'finger swipe must move the page: '+JSON.stringify({y,next,direction}));
                y=next;swipes++;
                if(swipes%100===0) console.log('Builder touch cycle '+(cycle+1)+(direction<0?' down':' up')+': '+Math.round(y)+' / '+max+'px');
                assert(swipes<1200,'touch scrolling cannot loop without reaching the end');
            }
        } else await cdp.send('Input.synthesizeScrollGesture',{x:12,y:700,yDistance:direction*(max+400),speed:45000,gestureSourceType:input,preventFling:true});
        await settle();
        const end=await run('({time:performance.now(),y:scrollY})');
        assert(Math.abs(end.y-(direction<0?max:0))<2,'gesture reaches end of full collection: '+JSON.stringify({input,max,direction,...end}));
        phases.push({cycle,direction,start,end:end.time});
    }
    const data=await run(`scrollSampling=false;scrollLongTasks.disconnect();toolbar.getBoundingClientRect=originalBarRect;document.documentElement.style.setProperty=originalSetProperty;scrollProbe`);
    if(input==='touch') await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    const after=(await cdp.send('Performance.getMetrics')).metrics;
    const metric=name=>after.find(m=>m.name===name).value-before.find(m=>m.name===name).value;
    const gaps=data.frames.slice(1).map((f,i)=>f[0]-data.frames[i][0]);
    const report={width,input,cycles:2,distance:max,frames:data.frames.length,maxFrameGap:Math.max(0,...gaps),maxLongTask:Math.max(0,...data.tasks),toolbarReads:data.reads,rootStyleWrites:data.writes,layouts:metric('LayoutCount'),styleRecalculations:metric('RecalcStyleCount'),maxScrollPause:0};
    for(const phase of phases) {
        const samples=data.frames.filter(([t])=>t>=phase.start&&t<=phase.end);
        assert(new Set(samples.map(f=>f[1])).size>10,'continuous intermediate scroll positions, not only endpoints');
        assert(samples.some(([,y])=>y>500&&y<3000),'gesture crosses former docking area');
        let lastMovement=samples[0][0];
        for(let i=1;i<samples.length;i++) {
            if(samples[i][1]!==samples[i-1][1]||samples[i][1]<=1||samples[i][1]>=max-1) lastMovement=samples[i][0];
            else report.maxScrollPause=Math.max(report.maxScrollPause,samples[i][0]-lastMovement);
        }
    }
    console.log('Builder continuous scroll: '+JSON.stringify(report));
    if(process.env.LRBRIDGE_LAYOUT_ARTIFACTS) fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,'builder-scroll-'+width+'.json'),JSON.stringify({report,phases,...data}));
    assert.equal(data.reads,0,'closed-popup scrolling must not measure the toolbar');
    assert.equal(data.writes,0,'closed-popup scrolling must not rewrite root layout styles');
    assert(report.maxFrameGap<750&&report.maxLongTask<500&&report.maxScrollPause<750,'scrolling stall: '+JSON.stringify(report));
};
