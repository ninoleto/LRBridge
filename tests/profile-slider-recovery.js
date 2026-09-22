"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createProfileNativeState, ProfileUnavailableError } = require("../server/profile-native-state");
const { createProfileModel } = require("../app/controller-develop-categorical");

// Production server/controller models, simulated SDK and native inventory. No Lightroom connection.
async function run() {
    const helper = fs.readFileSync(path.join(__dirname, "../server/windows-lightroom-native.ps1"), "utf8");
    const discovery = helper.slice(helper.indexOf("function Get-ProfileDiscovery("), helper.indexOf("function ConvertTo-ProfileLabelSnapshot("));
    assert.doesNotMatch(discovery, /\.IsOffscreen/, "A slider's revealPanel scroll cannot invalidate Profile inventory");
    assert.match(discovery, /-not \$combo\.Current\.IsEnabled/, "Disabled native Profile controls remain rejected");
    assert.match(discovery, /\$discoveries\.Count -ne 1/, "Discovery must remain unique");

    let time = 1000, develop = 1, selected = "Adobe Color", nativeAvailable = true;
    const names = ["Adobe Color", "Adobe Landscape", "Adobe Vivid", "Adaptive Color"];
    const native = () => ({ available: true, processId: 100, mainHwnd: 101, comboHwnd: 102, listHwnd: 103,
        expanded: false, browsePosition: 5, browseLabel: "Browse...", selectedCount: 1,
        selected: { position: names.indexOf(selected), label: selected },
        patterns: { selection: true, expandCollapse: true, selectionItem: true },
        options: names.map((label, position) => ({ label, position, enabled: true, selectionItem: true })) });
    const profile = createProfileNativeState({ readProfileSnapshot: async () => {
        if (!nativeAvailable) throw new ProfileUnavailableError("Native inventory temporarily unreadable");
        return native();
    } }, { now: () => time });
    const model = createProfileModel();
    const binding = () => ({ contextCounter: 1, selectedPhotoKey: "photo-1", selectedPhotoUuid: "photo-1",
        contextChangedAt: 1000, previousDevelopCounter: 0, developCounter: develop, developChangedAt: time });
    const sdk = () => ({ contextCounter: 1, selectedPhotoKey: "photo-1", selectedPhotoUuid: "photo-1",
        developCounter: develop, label: selected, source: "Look.Name", supportsAmount: false });
    const publish = () => model.apply(profile.get());
    const token = name => profile.get().options.find(option => option.label === name).token;
    async function settle() {
        assert.equal(profile.observeSdkProfile(sdk()), true);
        await profile.refresh(true); publish();
        assert.equal(profile.observeSdkProfile(sdk()), true);
        await profile.refresh(true); publish();
        assert.equal(model.presentation().inventoryStable, true);
    }
    profile.syncContext(binding());
    model.beginContext(1, "photo-1", "photo-1");
    await settle();

    let browserGeneration = 0;
    async function select(name) {
        const generation = ++browserGeneration;
        assert.equal(model.begin(token(name), generation), true);
        const admission = profile.admitSdkSelection(token(name));
        model.setConfirmationAfterRevision(generation, admission.confirmationAfterRevision, admission.generation);
        // Simulate the SDK applying and validating this one requested Profile.
        selected = name; develop++; time += 1000; profile.syncContext(binding());
        await profile.refresh(true);
        publish();
        assert.notEqual(model.getPending(), null, "A matching native label cannot confirm the write");
        assert.equal(profile.recordSdkValidation(admission.generation, name, "confirmed"), true);
        assert.equal(publish().confirmed, true);
        await settle();
        assert.equal(model.presentation().authoritativeLabel, name);
        assert.equal(model.getPending(), null);
    }
    await select("Adobe Landscape");
    const priorToken = token("Adobe Vivid");
    const staleSdk = sdk();
    // Ordinary Exposure/Sharpness activity advances Develop revision, not the selected-photo context.
    for (let n = 0; n < 4; n++) {
        time += 1000; develop++;
        assert.equal(profile.syncContext(binding()), false);
        assert.equal(profile.observeSdkProfile(staleSdk), false, "Old Develop feedback is still rejected");
        await settle();
        assert.equal(token("Adobe Vivid"), priorToken, "Ordinary slider edits must not invalidate unchanged inventory");
    }
    await select("Adobe Vivid");

    // A real temporary read failure still disables admission, then fresh inventory recovers automatically.
    const expiredToken = token("Adobe Color");
    nativeAvailable = false;
    for (let n = 0; n < 4; n++) {
        time += 6000;
        await profile.refresh(true); publish();
        assert.equal(profile.observeSdkProfile(sdk()), true);
        publish();
    }
    assert.equal(model.presentation().inventoryStable, false);
    assert.throws(() => profile.admitSdkSelection(expiredToken), /unavailable|updating/);
    nativeAvailable = true;
    await profile.refresh(true); publish();
    assert.equal(model.presentation().inventoryStable, false, "One fresh inventory cannot bypass stabilization");
    assert.equal(profile.observeSdkProfile(sdk()), true);
    await profile.refresh(true); publish();
    assert.equal(model.presentation().inventoryStable, true, "Recovery needs no server/model restart");
    assert.throws(() => profile.admitSdkSelection(expiredToken), /stale/);
    assert.throws(() => profile.admitSdkSelection(token("Adaptive Color")), /readback-only/);
    await select("Adobe Color");

    profile.syncContext({ ...binding(), contextCounter: 2, selectedPhotoKey: "photo-2", selectedPhotoUuid: "photo-2",
        previousDevelopCounter: develop, contextChangedAt: time + 1 });
    assert.equal(profile.observeSdkProfile(sdk()), false, "Old photo feedback cannot restore inventory");
    assert.equal(profile.get().available, false);
    console.log("Profile slider recovery: selection -> ordinary edits -> selection, temporary failure recovery and stale-context guards passed (simulated).");
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
