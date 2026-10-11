"use strict";
const assert = require('node:assert/strict');
function install(fixture) {
    const state = fixture.pointColor = { calls: [], selectedPointColor: 1 };
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        if (url.pathname === '/api/point-color/state') {
            const range = {LowerNone:0.1,LowerFull:0.3,UpperFull:0.7,UpperNone:0.9};
            reply({ok:true,context:{...fixture.context,serverEpoch:'beta4-browser'},contextOwned:true,
                state:{available:true,swatchCount:3,selectedIndex:state.selectedPointColor,selectionTransient:false,
                    HueShift:0.2,SatScale:-0.1,LumScale:0.1,Variance:0.1,RangeAmount:0.5,
                    HueRange:range,SatRange:range,LumRange:range}});
        } else if (url.pathname === '/api/point-color/sample') {
            assert.equal(url.searchParams.get('selectedPhotoUuid'),fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get('serverEpoch'),'beta4-browser');
            state.calls.push({target:'pointColorSample',index:Number(url.searchParams.get('selectedIndex'))}); reply({ok:true});
        } else if (url.pathname === '/api/point-color/tool/select') {
            state.calls.push({target:'pointColorPicker'});reply({ok:true});
        } else if (url.pathname === '/api/point-color/range-visualization/toggle') {
            state.calls.push({target:'pointColorVisualize'});reply({ok:true});
        } else return previous(url,reply);
        return true;
    };
}
async function verify({evaluate,waitFor,selectTab,fixture,setViewport}) {
    const state=fixture.pointColor, capture=null;
    await selectTab('sliders');
    for (const width of [1280,390]) {
        await setViewport(width,950);
        await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='Point Color').click()");
        await waitFor(() => evaluate("document.querySelector('#pointColorVisualizeRange')?.tagName==='BUTTON'"), "Point Color momentary button restored");
        const swatches = "Array.from(document.querySelectorAll('.color-mixer-view-content [data-point-color-sample]'))";
        assert.deepEqual(await evaluate(swatches + ".map(e=>e.textContent)"), ["1","2","3","4","5","6","7","8"]);
        assert.deepEqual(await evaluate(swatches + ".map(e=>e.disabled)"), [false,false,false,true,true,true,true,true]);
        assert.equal(await evaluate("document.querySelectorAll('.color-mixer-view-content .point-color-range-track').length"), 3);
        const pickerStyle = await evaluate("(()=>{const p=document.querySelector('#pointColorPickerSelect'),s=getComputedStyle(p);return {background:s.backgroundColor,color:s.color,height:p.getBoundingClientRect().height,icon:!!p.querySelector('svg path')};})()");
        assert.deepEqual({...pickerStyle, height: 44}, {background:"rgb(8, 127, 131)",color:"rgb(255, 255, 255)",height:44,icon:true});
        assert(pickerStyle.height >= 44);
        await evaluate("document.querySelector('#pointColorPickerSelect').click()");
        await waitFor(() => state.calls.at(-1)?.target === "pointColorPicker", "Picker command remains unchanged");
        const targetIndex = state.selectedPointColor === 1 ? 3 : 1;
        await evaluate(swatches + "[" + (targetIndex - 1) + "].click()");
        await waitFor(() => state.calls.at(-1)?.target === "pointColorSample", "Swatch API request");
        assert.equal(await evaluate(swatches + ".find(e=>e.getAttribute('aria-pressed')==='true').textContent"), String(state.selectedPointColor));
        state.selectedPointColor = targetIndex;
        await waitFor(() => evaluate(swatches + ".find(e=>e.getAttribute('aria-pressed')==='true')?.textContent==='" + targetIndex + "'"), "Owned SDK selection highlighted");
        assert.equal(await evaluate(swatches + ".every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44})"), true);
        await evaluate("document.querySelector('#pointColorVisualizeRange').scrollIntoView({block:'center'})");
        assert.equal(await evaluate("document.querySelector('#pointColorVisualizeRange').textContent"), "Toggle Visualize Range");
        assert.equal(await evaluate("(()=>{const r=document.querySelector('#pointColorVisualizeRange').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.height>=36;})()"), true, "Restored toggle button fits the viewport");
        if (capture) await capture("point-color-toggle-" + width);
        await evaluate("document.querySelector('#pointColorVisualizeRange').click()");
        await waitFor(() => state.calls.at(-1)?.target === "pointColorVisualize", "Existing Point Color toggle route");
        await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='Color').click()");
        assert.equal(await evaluate("document.querySelectorAll('.color-mixer-view-content .color-mixer-slider-group').length"), 8);
        await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='HSL').click()");
        assert.equal(await evaluate("document.querySelectorAll('.color-mixer-view-content .color-mixer-slider-group').length"), 3);
        assert.equal(await evaluate("document.querySelectorAll('.color-mixer-view-content input[type=range]').length"), 24);
    }

    return {pointColorSwatches:true, simulated:true};
}
module.exports={install,verify};
