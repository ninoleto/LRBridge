"use strict";

// Private, explicit-step native graph reference collection. The user supplies
// cropped screenshots; this tool never inspects/captures/injects Lightroom UI.
// It uses existing HTTP/SDK paths and never retries an uncertain edit.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const FIELDS = ["ParametricShadows", "ParametricDarks", "ParametricLights", "ParametricHighlights",
    "ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit"];
const LINEAR = [0, 0, 255, 255];
const NONLINEAR = [0, 0, 64, 32, 128, 166, 192, 224, 255, 255];
const TURNING = [0, 18, 64, 118, 128, 72, 192, 222, 255, 236];
const cases = [
    { id: "rgb-neutral", title: "Non-linear RGB, neutral Parametric", amounts: [0, 0, 0, 0], splits: [25, 50, 75], rgb: NONLINEAR },
    { id: "default", title: "Reported combination, default splits", amounts: [60, -35, -20, -10], splits: [25, 50, 75], rgb: LINEAR },
    { id: "narrow", title: "Same amounts, narrow splits", amounts: [60, -35, -20, -10], splits: [10, 20, 75], rgb: LINEAR },
    { id: "asymmetric", title: "Independent mixed-sign/asymmetric case", amounts: [-40, 25, 45, -30], splits: [20, 65, 90], rgb: LINEAR },
    { id: "rgb-combined", title: "Same asymmetric case with non-linear RGB", amounts: [-40, 25, 45, -30], splits: [20, 65, 90], rgb: NONLINEAR },
    { id: "rgb-turning", title: "Intentional RGB turning point and lifted endpoints", amounts: [10, -20, 25, -15], splits: [30, 55, 80], rgb: TURNING }
].map(item => ({ ...item, values: Object.fromEntries(FIELDS.map((field, i) => [field, [...item.amounts, ...item.splits][i]])) }));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function assertContext(current, pinned) {
    if (current.activeModule !== "develop" || !current.selectedPhotoUuid ||
        !Number.isFinite(current.lastHeartbeatAt) || Date.now() - current.lastHeartbeatAt > 4000)
        throw Error("Open one disposable photo/virtual copy in Develop with the source plug-in enabled.");
    if (pinned && ["selectedPhotoUuid", "contextCounter", "contextChangedAt"].some(key => current[key] !== pinned[key]))
        throw Error("Photo or Develop context changed. Stopped; no remaining test edits will be sent.");
}
function splitPlan(from, target) {
    const current = from.slice(), plan = [];
    while (!same(current, target)) {
        const i = current.findIndex((value, i) => value !== target[i] &&
            target[i] >= (i ? current[i - 1] + 10 : 10) && target[i] <= (i < 2 ? current[i + 1] - 10 : 90));
        if (i < 0) throw Error("No valid split transition.");
        current[i] = target[i]; plan.push({ field: FIELDS[i + 4], value: current[i] });
    }
    return plan;
}

function createCollector({ directory, bridge = "http://127.0.0.1:17891", fetchImpl = fetch }) {
    let pin = null, ready = null, inFlight = false, stopped = false;
    const completed = [], events = path.join(directory, "events.jsonl");
    function record(type, data) { fs.appendFileSync(events, JSON.stringify({ utc: new Date().toISOString(), type, data }) + "\n"); }
    const pause = () => new Promise(resolve => setTimeout(resolve, 120));
    async function request(route, edit = false) {
        record(edit ? "edit-request" : "read-request", { route });
        // Exactly one fetch for writes, even on timeout, HTTP failure or malformed response.
        const response = await fetchImpl(bridge + route, { signal: AbortSignal.timeout(5000), cache: "no-store" });
        const data = await response.json(); record(edit ? "edit-response" : "read-response", { route, status: response.status, data });
        if (!response.ok || data.ok === false) { const error = Error(data.error || "HTTP " + response.status); error.httpStatus = response.status; throw error; }
        return data;
    }
    async function context() { const c = await request("/context"); assertContext(c, pin); return c; }
    async function snapshot() {
        await context();
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
            const { request: read } = await request("/feedback/request-many?sliders=" + FIELDS.join(",") + "&purpose=edit");
            let s;
            do {
                try { s = (await request("/feedback/snapshot?id=" + read.id)).snapshot; }
                catch (error) {
                    if (error.httpStatus !== 404) throw error;
                    // An owned write can advance the Develop revision while a
                    // read is queued. Reacquire feedback only; never resend edits.
                    await context(); s = null; break;
                }
                if (!s.complete) await pause();
            } while (!s.complete && Date.now() < deadline);
            if (s && s.complete) {
                const c = await context();
                if (s.context.selectedPhotoUuid !== c.selectedPhotoUuid || s.context.contextCounter !== c.contextCounter ||
                    s.context.developCounter !== c.developCounter) { await pause(); continue; }
                const values = {};
                for (const field of FIELDS) {
                    const item = s.results[field];
                    if (!item || item.available !== true || !Number.isFinite(item.value)) throw Error(field + " feedback is unavailable.");
                    values[field] = item.value;
                }
                const { pointCurve } = await request("/tone-curve/state");
                if (!pointCurve.available || pointCurve.selectedPhotoUuid !== c.selectedPhotoUuid ||
                    pointCurve.contextCounter !== c.contextCounter || pointCurve.developCounter !== c.developCounter)
                    { await pause(); continue; }
                return { context: c, values, pointCurve, sdkSnapshot: s };
            }
            await pause();
        }
        throw Error("SDK feedback did not finish; no edit was retried.");
    }
    async function waitFor(predicate) {
        const end = Date.now() + 10000;
        while (Date.now() < end) {
            const result = await snapshot();
            if (predicate(result)) return result;
            await pause();
        }
        throw Error("Lightroom did not confirm the requested test value. Stopped without retrying the edit.");
    }
    async function scalar(field, value) {
        await context();
        await request("/set?slider=" + field + "&value=" + value, true);
        return waitFor(s => s.values[field] === value);
    }
    async function rgb(points, baseline) {
        await context();
        const query = new URLSearchParams({ channel: "rgb", gestureId: "curve-reference-" + crypto.randomUUID(),
            selectedPhotoUuid: baseline.context.selectedPhotoUuid, contextCounter: String(baseline.context.contextCounter),
            developCounter: String(baseline.context.developCounter), baseline: baseline.pointCurve.curves.rgb.join(",") });
        let ended = false;
        try {
            await request("/tone-curve/gesture/begin?" + query, true);
            query.set("points", points.join(","));
            await context();
            await request("/tone-curve/gesture/end?" + query, true);
            ended = true;
        } finally {
            if (!ended) {
                query.delete("baseline"); query.delete("points");
                await request("/tone-curve/gesture/cancel?" + query, true).catch(error => record("cancel-unconfirmed", { message: error.message }));
            }
        }
        return waitFor(s => same(s.pointCurve.curves.rgb, points));
    }
    return {
        state: () => ({ armed: !!pin, pinnedPhoto: pin?.selectedPhotoUuid || null, completed, ready: ready?.testCase || null,
            busy: inFlight, stopped, next: cases[completed.length] || null }),
        async arm(ack) {
            if (pin || stopped || ack !== "one-disposable-photo") throw Error("Confirm one disposable photo/virtual copy is selected.");
            const baseline = await snapshot(); pin = baseline.context;
            fs.writeFileSync(path.join(directory, "baseline.json"), JSON.stringify(baseline, null, 2)); record("armed", baseline);
        },
        async apply() {
            if (!pin || ready || inFlight || stopped || completed.length === cases.length) throw Error("No test step can be applied now.");
            inFlight = true;
            try {
                const testCase = cases[completed.length]; record("case-start", testCase);
                let latest = await snapshot();
                if (!same(latest.pointCurve.curves.rgb, testCase.rgb)) latest = await rgb(testCase.rgb, latest);
                for (const edit of splitPlan(FIELDS.slice(4).map(f => latest.values[f]), testCase.splits)) latest = await scalar(edit.field, edit.value);
                for (const field of FIELDS.slice(0, 4)) if (latest.values[field] !== testCase.values[field]) latest = await scalar(field, testCase.values[field]);
                if (!same(latest.values, testCase.values) || !same(latest.pointCurve.curves.rgb, testCase.rgb)) throw Error("Final SDK values do not match this case.");
                ready = { testCase, confirmed: latest, confirmedAt: new Date().toISOString() };
                record("case-confirmed", ready);
            } catch (error) { stopped = true; record("stopped-error", { message: error.message }); throw error; }
            finally { inFlight = false; }
        },
        async saveImage(bytes) {
            if (!ready || inFlight || stopped) throw Error("Wait for confirmed test values before pasting the current graph.");
            if (bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error("Paste a PNG crop of the current Lightroom graph.");
            inFlight = true;
            try {
                const after = await snapshot();
                if (!same(after.values, ready.confirmed.values) || !same(after.pointCurve.curves, ready.confirmed.pointCurve.curves) ||
                    after.context.developCounter !== ready.confirmed.context.developCounter) throw Error("Lightroom settings changed after confirmation; this image is not a matched reference.");
                const name = ready.testCase.id;
                fs.writeFileSync(path.join(directory, name + ".png"), bytes, { flag: "wx" });
                const reference = { ...ready, imageSource: "User-supplied crop of Lightroom Parametric graph; no automatic screenshot",
                    capturedAfter: after, imageSha256: crypto.createHash("sha256").update(bytes).digest("hex") };
                fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify(reference, null, 2), { flag: "wx" });
                completed.push(name); record("image-saved", { name, imageSha256: reference.imageSha256 }); ready = null;
            } catch (error) { stopped = true; record("stopped-error", { message: error.message }); throw error; }
            finally { inFlight = false; }
        }
    };
}

async function main() {
    const parent = process.argv[2]; if (!parent) throw Error("Supply a private evidence parent directory.");
    const directory = fs.mkdtempSync(path.join(path.resolve(parent), "native-"));
    const token = crypto.randomBytes(16).toString("hex"), prefix = "/" + token;
    const collector = createCollector({ directory });
    const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LRBridge Parametric references</title>
<style>body{font:17px system-ui;background:#111921;color:#eee;max-width:820px;margin:25px auto;padding:16px}button{font:inherit;min-height:46px;margin:8px;padding:9px 14px;background:#24647b;color:white;border:1px solid #558a99;border-radius:6px}button:disabled{opacity:.45}#status{white-space:pre-wrap;padding:16px;background:#222f3d}strong{color:#e9c278}pre{white-space:pre-wrap}</style>
<h1>Parametric Curve references</h1><p>In <strong>Lightroom Classic → Develop → Tone Curve → Parametric</strong>, select only one disposable photo or virtual copy. Keep it selected throughout; do not edit in another Controller tab.</p>
<p>Press <strong>Use selected test photo</strong>. For each of six cases, press <strong>Apply next case</strong> and wait for SDK confirmation. Use Windows Snipping Tool yourself to crop just Lightroom’s curve graph; return here and paste it (Ctrl+V), or choose its PNG file. Then apply the next case.</p>
<p>The page sets and verifies the values for you. Crops must show the <strong>Parametric</strong> graph, not the Point Curve. No automatic screen capture, graph guessing or photo switching occurs. Nothing changes until you explicitly apply a case.</p>
<button id="arm">Use selected test photo</button><button id="apply" disabled>Apply next case</button><input type="file" id="file" accept="image/png" disabled><div id="status">Waiting for a disposable test photo.</div><pre id="values"></pre>
<script>
let state;const status=document.querySelector('#status'),arm=document.querySelector('#arm'),apply=document.querySelector('#apply'),file=document.querySelector('#file');
async function api(action,body){const r=await fetch(location.pathname.replace(/\\/$/,'')+'/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':body instanceof Blob?'image/png':'application/json'},body:body instanceof Blob?body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}
async function refresh(){state=await api('state');arm.disabled=state.armed||state.busy||state.stopped;apply.disabled=!state.armed||state.busy||!!state.ready||!state.next||state.stopped;file.disabled=!state.ready||state.busy||state.stopped;document.querySelector('#values').textContent=state.ready?JSON.stringify({case:state.ready.title,values:state.ready.values,rgb:state.ready.rgb},null,2):'';}
async function work(fn,text){arm.disabled=apply.disabled=file.disabled=true;status.textContent=text;try{await fn();await refresh();status.textContent=state.ready?'Values confirmed by Lightroom SDK. Crop the current Parametric graph and paste it here.':state.completed.length===6?'All six references saved. Leave the test copy as it is and tell Codex finished.':state.armed?'Saved '+state.completed.length+' of 6. Ready to apply '+state.next.title+'.':'Ready.';}catch(e){status.textContent='Stopped: '+e.message;await refresh().catch(()=>{});}}
arm.onclick=()=>work(()=>api('arm',{ack:'one-disposable-photo'}),'Reading selected test photo...');apply.onclick=()=>work(()=>api('apply',{}),'Applying one case; waiting for real Lightroom feedback...');
function upload(f){if(!f||file.disabled)return;work(()=>api('image',f),'Checking current settings and preserving your reference...');}
file.onchange=()=>upload(file.files[0]);window.addEventListener('paste',e=>{const item=[...e.clipboardData.items].find(i=>i.type==='image/png');if(item){e.preventDefault();upload(item.getAsFile());}});refresh().catch(e=>status.textContent=e.message);
</script>`;
    const server = http.createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try {
            if (req.method === "GET" && [prefix, prefix + "/"].includes(req.url)) { res.setHeader("Content-Type", "text/html;charset=utf-8"); return res.end(page); }
            const route = req.url?.slice(prefix.length);
            if (!req.url?.startsWith(prefix + "/")) throw Error("Unknown reference session.");
            res.setHeader("Content-Type", "application/json");
            if (req.method === "GET" && route === "/state") return res.end(JSON.stringify(collector.state()));
            if (req.method !== "POST") throw Error("Invalid request.");
            const chunks = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Error("Image too large."); chunks.push(chunk); }
            const body = Buffer.concat(chunks);
            if (route === "/arm") await collector.arm(JSON.parse(body.toString()).ack);
            else if (route === "/apply") await collector.apply();
            else if (route === "/image") await collector.saveImage(body);
            else throw Error("Invalid operation.");
            res.end(JSON.stringify({ ok: true }));
        } catch (error) { res.statusCode = 409; res.end(JSON.stringify({ error: error.message })); }
    });
    server.listen(17897, "127.0.0.1", () => {
        const link = "http://127.0.0.1:17897" + prefix + "/";
        const details = { link, pid: process.pid, directory, cases, createdAt: new Date().toISOString() };
        fs.writeFileSync(path.join(directory, "session.json"), JSON.stringify(details, null, 2));
        fs.writeFileSync(path.join(path.resolve(parent), "native-current.json"), JSON.stringify(details, null, 2));
        console.log(JSON.stringify({ link, directory, pid: process.pid }));
    });
}
module.exports = { FIELDS, cases, assertContext, splitPlan, createCollector };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
