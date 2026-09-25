"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

module.exports=async function checkTabs({run,cdp,width}) {
    const settle=()=>run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const key=async (key,code,modifiers=0)=>{
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,windowsVirtualKeyCode:code,modifiers});
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode:code,modifiers});
    };
    const point=id=>run('(()=>{const r=document.getElementById('+JSON.stringify(id)+').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    const mouse=async (type,p)=>cdp.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});
    const shared=()=>run(`({search:searchEl.value,step:stepSize,steps:[stepInput.value,baseStepInput.value],
        inputs:Array.from(document.querySelectorAll('.card input,.card textarea')).map(e=>[e.id,e.value,e.checked])})`);
    const snapshot=()=>run(`({focus:document.activeElement.id,scroll:scrollY,active:activeExecution,
        tabs:Array.from(document.querySelectorAll('[role=tab]')).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,top:r.top,bottom:r.bottom,left:r.left,right:r.right,selected:e.getAttribute('aria-selected')};})})`);
    await run(`window.tabEvents=[];window.originalTabScrollBy=window.scrollBy;
        window.scrollBy=function(...args){tabEvents.push({type:'scrollBy',args,focus:document.activeElement.id,y:scrollY,stack:new Error().stack});return originalTabScrollBy.apply(this,args)};
        for(const type of ['pointerdown','focusin','pointerup','click']) document.addEventListener(type,event=>tabEvents.push({type,target:event.target.id,focus:document.activeElement.id,y:scrollY,active:activeExecution}),true);
        searchEl.value='Lens Blur';filterCards();
        window.savedTabCard=document.querySelector('#slider-Contrast-value');savedTabCard.value='17';savedTabCard.dispatchEvent(new Event('input'));
        window.savedTabNodes=Array.from(document.querySelectorAll('.card input,.card textarea'));`);
    const records=[];
    const save=()=>{
        if(!process.env.LRBRIDGE_LAYOUT_ARTIFACTS)return;
        fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,{recursive:true});
        fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS,'builder-tab-input-'+width+'.json'),JSON.stringify(records,null,2));
    };
    const visibleTabs=async(top=180)=>{
        await run('window.scrollTo(0,document.querySelector(".execution-tabs").getBoundingClientRect().top+scrollY-'+top+')');await settle();
        assert((await run('scrollY'))>0,'partially scrolled page');
        assert.equal(await run('Array.from(document.querySelectorAll("[role=tab]")).every(t=>{const r=t.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight})'),true,'tabs visible');
    };
    const assertSelected=async expected=>{
        const actual=await run(String.raw`(()=>{const visible=cardRecords.filter(r=>!r.card.hidden),tab=document.getElementById('tab-'+activeExecution);return {
            active:activeExecution,selected:Array.from(document.querySelectorAll('[role=tab][aria-selected=true]')).map(e=>e.dataset.execution),
            border:getComputedStyle(tab).borderBottomColor,description:document.querySelector('#executionDescription').textContent,
            label:document.querySelector('#commandPanel').getAttribute('aria-labelledby'),count:document.querySelector('#resultCount').textContent,
            visible:visible.length,expected:cardRecords.filter(r=>r.execution===activeExecution&&searchEl.value.trim().toLowerCase().split(/\s+/).every(w=>r.search.includes(w))).length,
            total:cardRecords.filter(r=>r.execution===activeExecution).length,correct:visible.every(r=>r.execution===activeExecution)};})()`);
        assert.equal(actual.active,expected);assert.deepEqual(actual.selected,[expected]);
        assert.equal(actual.border,'rgb(22, 29, 36)','selected tab joins the content panel, including while hovered');
        assert.equal(actual.description,expected==='sdk'?'These commands apply changes through Lightroom’s plug-in SDK.':'These commands operate Lightroom’s on-screen controls using Windows automation.');
        assert.equal(actual.label,'tab-'+expected);
        assert.equal(actual.visible,actual.expected);assert(actual.visible>0&&actual.correct);
        assert.equal(actual.count,actual.visible+' of '+actual.total+' '+(expected==='sdk'?'SDK':'WIN UI')+' command cards');
    };
    const activate=async (expected,input,pendingStep)=>{
        const before=await snapshot(),saved=await shared(),p=await point('tab-'+expected);
        if(pendingStep!==undefined){saved.step=pendingStep;saved.steps=[String(pendingStep),String(pendingStep)];}
        await run('tabEvents.length=0');
        if(input==='mouse')await mouse('mousePressed',p);
        else await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
        const pressed=await snapshot();
        if(input==='mouse')await mouse('mouseReleased',p);
        else await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const released=await snapshot();
        // Check the entire selected presentation immediately after release, before waiting for a paint.
        if(released.active===expected) await assertSelected(expected);
        await settle();
        const settled=await snapshot(),events=await run('tabEvents');
        const record={input,target:expected,pendingStep,before,pressed,released,settled,events};records.push(record);save();
        if(records.length===1)console.log('Builder first tab click '+width+'px: '+JSON.stringify(record));
        assert.equal(pressed.active,before.active,'activation remains on click/release, not pointer-down');
        for(const phase of [pressed,released,settled]) {
            assert.equal(phase.scroll,before.scroll,'visible tab cannot scroll on focus: '+JSON.stringify(record));
            assert.deepEqual(phase.tabs.map(({selected,...rect})=>rect),before.tabs.map(({selected,...rect})=>rect),'tab cannot move beneath pointer');
        }
        assert.equal(released.active,expected,'first click/tap activates synchronously');
        await assertSelected(expected);
        assert.deepEqual(await shared(),saved,'search, shared Step and card values survive switching');
        assert.equal(await run('savedTabNodes.every((e,i)=>document.querySelectorAll(".card input,.card textarea")[i]===e)'),true);
        assert.equal(events.some(e=>e.type==='scrollBy'),false,'no application focus-scroll correction for tabs');
    };
    await visibleTabs();
    for(const input of ['mouse','touch']) {
        if(input==='touch')await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        for(const expected of ['win-ui','sdk']) {
            await activate(expected,input);
            await activate(expected,input); // Already-selected tab must be harmless too.
        }
        // Leave an actual toolbar Step edit uncommitted; clicking the tab commits on blur and must still activate once.
        const p=await point('stepInput');await mouse('mousePressed',p);await mouse('mouseReleased',p);
        await key('a',65,2);await cdp.send('Input.insertText',{text:input==='mouse'?'4':'6'});
        await activate('win-ui',input,input==='mouse'?4:6);
        await activate('sdk',input);
        if(input==='touch')await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    }
    // Base URL Step editing must not move either the field or the visible tabs on focus.
    await visibleTabs(700);
    const basePoint=await point('baseStepInput'),baseScroll=await run('scrollY');
    assert(basePoint.y>=0&&basePoint.y<900,'Base URL Step input is visible with tabs');
    await mouse('mousePressed',basePoint);await mouse('mouseReleased',basePoint);
    assert.equal(await run('scrollY'),baseScroll,'visible Base URL control does not scroll on focus');
    await key('a',65,2);await cdp.send('Input.insertText',{text:'8'});
    await activate('win-ui','mouse',8);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await activate('sdk','touch');
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await visibleTabs();
    // Native Tab enters the selected tab; arrow keys/Home/End maintain the roving tab stop.
    await run('document.querySelector("#baseIncreaseStep").focus({preventScroll:true})');
    const beforeKeyboard=await snapshot(),saved=await shared();
    await key('Tab',9);
    assert.equal(await run('document.activeElement.id'),'tab-sdk');
    for(const [name,code,expected] of [['ArrowRight',39,'win-ui'],['ArrowLeft',37,'sdk'],['End',35,'win-ui'],['Home',36,'sdk']]) {
        await key(name,code);await assertSelected(expected);
        assert.equal(await run('document.activeElement.id'),'tab-'+expected);
        assert.equal(await run('document.activeElement.matches(":focus-visible")'),true);
        assert.equal(await run('Array.from(document.querySelectorAll("[role=tab]")).filter(t=>t.tabIndex===0).length'),1);
        assert.equal(await run('scrollY'),beforeKeyboard.scroll,'visible keyboard tabs do not cause correction');
    }
    await key('Tab',9);assert.equal(await run('document.activeElement.id'),'search');
    await key('Tab',9,8);assert.equal(await run('document.activeElement.id'),'tab-sdk');
    assert.deepEqual(await shared(),saved);
    await checkObscuredKeyboardFocus({run,cdp,key,settle});
    await run('window.scrollBy=originalTabScrollBy');
    save();
};

async function checkObscuredKeyboardFocus({run,cdp,key,settle}) {
    await run('searchEl.value="";filterCards();window.keyboardCard=document.querySelector("#slider-Contrast-value");window.beforeKeyboardCard=Array.from(document.querySelectorAll("button,input,textarea,summary,a[href]")).filter(e=>e.getClientRects().length);beforeKeyboardCard=beforeKeyboardCard[beforeKeyboardCard.indexOf(keyboardCard)-1];beforeKeyboardCard.focus({preventScroll:true});window.scrollTo(0,keyboardCard.getBoundingClientRect().top+scrollY-20)');await settle();
    await key('Tab',9);await settle();
    assert.equal(await run('document.activeElement===keyboardCard'),true,'actual keyboard traversal reaches card input');
    assert.equal(await run('keyboardCard.getBoundingClientRect().top>=toolbar.getBoundingClientRect().bottom'),true,'obscured keyboard field clears sticky toolbar');
    assert.equal(await run('document.activeElement.matches(":focus-visible")'),true);
}
