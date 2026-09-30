"use strict";
const assert = require("node:assert/strict");
const { fixture } = require("./masking-context-replay");
const { harness } = require("./masking-correction-confirmation");
const { flushAsync } = require("./masking");
const commands = require("../server/commands");

const cases = {
    async queuedAndLatest() {
        await fixture(async f => {
            const mask = f.state().selectedMaskGroupId;
            await f.update({ developFingerprint: "grain-before", maskingGrainMaskId: mask });
            await f.refresh();
            const old = f.binding();
            await f.send("update", "local_Grain", -64, "mg-captured-56");
            await f.update({ developFingerprint: "grain-after", maskingGrainMaskId: mask,
                maskingGrainFromFingerprint: "grain-before" });
            const queued = commands.getNextCommand();
            assert.ok(queued, "captured seq56: known global Grain must not discard queued local -64");
            assert.equal(queued.value, -64);
            await f.complete(queued);
            const latest = await f.send("end", "local_Grain", 13, "mg-captured-56", old);
            assert.equal(latest.status, 200, "ongoing old-bound gesture can submit latest input13 across proven Grain change");
            const final = commands.getNextCommand(); assert.equal(final.value, 13); await f.complete(final);
            assert.equal(f.state().corrections.find(c => c.parameter === "local_Grain").value, 13);
            assert.equal(f.state().correctionCancellations.length, 0);
        });
    },
    async completedBeforePoll() {
        await fixture(async f => {
            const mask = f.state().selectedMaskGroupId;
            await f.update({ developFingerprint: "grain-before", maskingGrainMaskId: mask }); await f.refresh();
            await f.send("end", "local_Grain", 18, "mg-captured-164");
            const final = commands.getNextCommand(); await f.complete(final);
            await f.update({ developFingerprint: "grain-after", maskingGrainMaskId: mask,
                maskingGrainFromFingerprint: "grain-before" });
            const state = (await f.request("/masking/state")).body;
            assert.ok(state.correctionResults.some(r=>r.sequence===final.correctionSequence && r.outcome==="confirmed"),
                "captured seq164: an accepted completion must survive until the browser reads it");
            assert.equal(state.corrections.find(c=>c.parameter==="local_Grain").value,18);
        });
    },
    async heldInputAndAdmission() {
        for (const hostFirst of [true,false]) {
            const h = await harness();
            try {
                const delayed = h.hold("begin");
                h.start(-64,"local_Grain"); await flushAsync();
                await h.compatibleDevelop(hostFirst);
                const c = h.control("local_Grain");
                assert.equal(c.range.disabled,false,"known Grain revision must not interrupt held local input");
                c.range.value="13"; c.range.dispatch("input");
                delayed.resolve(); await flushAsync(); await h.end("local_Grain");
                assert.equal(h.last().command.value,13,"latest held input must reach the production handler");
                h.complete(h.last()); await h.catchUpContext();
                assert.equal(c.number.value,"13"); assert.equal(c.status.textContent,"");
            } finally { h.close(); }
        }
    },
    async browserConfirmation() {
        const h=await harness();
        try {
            await h.drag(18,"local_Grain"); h.complete(h.last());
            await h.compatibleDevelop(); await h.clock.advance(3000);
            assert.equal(h.control("local_Grain").status.textContent,"","known Grain feedback must not erase confirmed18");
            assert.equal(h.control("local_Grain").number.value,"18");
        } finally {h.close();}
    },
    async interleaveResetAndRealChanges() {
        await fixture(async f=>{
            const mask=f.state().selectedMaskGroupId;
            let previous="base";
            await f.update({developFingerprint:previous,maskingGrainMaskId:mask}); await f.refresh();
            const scope="&preserveMaskingPanel=true&selectedPhotoUuid=recorded-photo&contextCounter="+f.binding().contextCounter;
            for(let i=0;i<8;i++) {
                await f.send("end","local_Grain",i+1,"mg-interleave-"+i);
                await f.request("/set?slider="+(i%2?"GrainFrequency":"GrainSize")+"&value="+(20+i)+scope);
                const local=commands.getNextCommand(); await f.complete(local);
                assert.ok(commands.getNextCommand().slider);
                const next="known-"+i;
                await f.update({developFingerprint:next,maskingGrainMaskId:mask,maskingGrainFromFingerprint:previous});
                previous=next;
            }
            await f.send("end","local_Grain",80,"mg-before-reset");
            await f.send("reset","local_Grain",null);
            await f.send("end","local_Grain",13,"mg-after-reset");
            const reset=commands.getNextCommand(),after=commands.getNextCommand();
            assert.equal(reset.command,"masking.correction.reset"); assert.equal(after.value,13);
            await f.complete(reset); await f.complete(after);
            assert.equal(f.state().corrections.find(c=>c.parameter==="local_Grain").value,13);
            const old=f.binding();
            await f.send("end","local_Grain",90,"mg-real-external");
            await f.update({developFingerprint:"external",maskingGrainMaskId:mask});
            assert.equal(commands.getNextCommand(),null,"unexplained external Develop edits remain a hard barrier");
            assert.equal((await f.send("end","local_Grain",91,"mg-real-external",old)).status,409);
            await f.refresh(); await f.send("end","local_Grain",92,"mg-real-photo");
            await f.update({selectedPhotoUuid:"another-photo",developFingerprint:"other",maskingGrainMaskId:mask,
                maskingGrainFromFingerprint:"external"});
            assert.equal(commands.getNextCommand(),null,"even a matching fingerprint proof cannot cross photo change");
        });
        const h=await harness();
        try {
            h.start(13,"local_Grain");await flushAsync();await h.compatibleDevelop();
            await h.changeMask("other-mask");const count=h.requests.length;
            h.control("local_Grain").range.value="65";h.control("local_Grain").range.dispatch("input");await h.end("local_Grain");
            assert.equal(h.requests.length,count,"compatible history cannot carry held input into another mask");
        }finally{h.close();}
    },
    async revisionDuringReset() {
        await fixture(async f=>{
            const mask=f.state().selectedMaskGroupId;
            await f.update({developFingerprint:"reset-before",maskingGrainMaskId:mask});await f.refresh();
            await f.send("end","local_Grain",80,"mg-old-revision-before-reset");
            await f.update({developFingerprint:"reset-after",maskingGrainMaskId:mask,maskingGrainFromFingerprint:"reset-before"});
            assert.equal((await f.send("reset","local_Grain",null)).status,200);
            const writes=[];let command;
            while((command=commands.getNextCommand())){writes.push(command.command.endsWith("reset")?"reset":command.value);await f.complete(command);}
            assert.equal(writes.at(-1),"reset","an old-revision adjustment cannot execute after Reset");
            assert.equal(f.state().corrections.find(c=>c.parameter==="local_Grain").value,0);
            assert.equal(f.state().lastCorrectionResult.outcome,"confirmed");
        });
    },
    async unknownTransitions() {
        for (const change of [
            {maskingGrainFromFingerprint:"wrong-previous"},
            {maskingGrainFromFingerprint:""},
            {maskingGrainMaskId:"different-mask"},
            {activeModule:"library"},
            {selectedPhotoUuid:"different-photo"}
        ]) await fixture(async f=>{
            const mask=f.state().selectedMaskGroupId;
            await f.update({developFingerprint:"proven-base",maskingGrainMaskId:mask});await f.refresh();
            const old=f.binding();await f.send("end","local_Grain",13,"mg-protected");
            await f.update({developFingerprint:"changed",maskingGrainMaskId:mask,
                maskingGrainFromFingerprint:"proven-base",maskingCorrectionDevelopFloor:0,...change});
            assert.equal(commands.getNextCommand(),null,"unproven/context-changing transition must cancel: "+JSON.stringify(change));
            assert.equal((await f.send("end","local_Grain",18,"mg-protected",old)).status,409);
        });
    }
};
async function main(){let failed=0;for(const name of process.argv[2]?[process.argv[2]]:Object.keys(cases))try{await cases[name]();console.log("PASS "+name);}catch(e){failed++;console.error("FAIL "+name+": "+e.message);}if(failed)throw Error(failed+" Grain coordination regressions failed");}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cases};
