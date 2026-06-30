const baseUrl = process.env.LRBRIDGE_URL || "http://127.0.0.1:17891";

async function getJson(path) {
    const url = baseUrl + path;
    const response = await fetch(url);
    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error("Invalid JSON from " + url + ": " + text);
    }

    return {
        status: response.status,
        ok: response.ok,
        data: data
    };
}

async function expectOk(path) {
    const result = await getJson(path);

    if (!result.ok || result.data.ok === false) {
        console.log("FAIL:", path);
        console.log(result);
        process.exit(1);
    }

    console.log("OK:", path);
}

async function expectBad(path) {
    const result = await getJson(path);

    if (result.ok || result.data.ok !== false) {
        console.log("FAIL, expected error:", path);
        console.log(result);
        process.exit(1);
    }

    console.log("OK bad request:", path);
}

async function main() {
    console.log("LRBridge smoke test");
    console.log("Base URL:", baseUrl);
    console.log("");

    await expectOk("/status");
    await expectOk("/sliders");
    await expectOk("/groups");

    await expectOk("/adjust?slider=Exposure&amount=1");
    await expectOk("/reset?slider=Exposure");

    await expectOk("/reset-group?group=Basic");
    await expectOk("/reset-all");

    await expectBad("/adjust?slider=BadSlider&amount=1");
    await expectBad("/adjust?slider=Exposure");
    await expectBad("/reset-group?group=BadGroup");
    await expectBad("/set?slider=Exposure&value=1");

    console.log("");
    console.log("Smoke test passed.");
}

main().catch(function (err) {
    console.error(err);
    process.exit(1);
});