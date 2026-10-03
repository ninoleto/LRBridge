"use strict";
// Naming and strict migration checks only. Never install into the user's preset directory.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), cp = require("node:child_process"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), manifest = require("../resources/presets/manifest.json");
const group = "LRBridge Dust Helper — Do not use manually";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const md5 = bytes => crypto.createHash("md5").update(bytes).digest("hex");
const replaceGroup = (text, name) => text.replace(group, name);
assert.equal(manifest.group, group);
const digests = [];
for (const item of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, "resources/presets", item.name)), text = bytes.toString("utf8");
    assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256);
    assert.equal((text.match(/LRBridge Dust Helper — Do not use manually/g) || []).length, 1);
    assert.equal(text.match(/<crs:Group>[\s\S]*?<rdf:li[^>]*>([^<]+)</)[1], group);
    const on = item.name === "LRBridge Dust On.xmp";
    assert.equal(text.match(/crs:UUID="([^"]+)"/)[1], on ? "F75BC2062C78A64FA7AAC812010E2C6B" : "BD8035E4A54F404CB5D00A22714C7F3C");
    assert.equal(text.match(/<crs:Name>[\s\S]*?<rdf:li[^>]*>([^<]+)</)[1], on ? "LRBridge Dust On" : "LRBridge Dust Off");
    // Matching the known complete-file hashes after replacing only Group proves
    // UUIDs, settings, table payloads and every other byte are unchanged.
    const original = Buffer.from(replaceGroup(text, "LRBridge TEST"));
    const previous = Buffer.from(replaceGroup(text, "LRBridge Dust Helpers"));
    assert.equal(sha(original), item.legacySha256); assert.equal(original.length, item.legacyBytes);
    assert.equal(sha(previous), item.previousGroupSha256); assert.equal(previous.length, item.previousGroupBytes);
    const validator = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin", on ? "DustOnPreset.lua" : "Dust.lua"), "utf8");
    for (const variant of [bytes, original, previous]) assert(validator.includes('"' + md5(variant) + '"'), "Known preset bytes must remain validated");
    digests.push({ name: item.name, sha256: sha(bytes), md5: md5(bytes) });
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-dust-group-"));
try {
    const bundle = path.join(temp, "bundle");
    fs.mkdirSync(path.join(bundle, "tools"), { recursive: true });
    fs.cpSync(path.join(root, "resources/presets"), path.join(bundle, "resources/presets"), { recursive: true });
    fs.copyFileSync(path.join(root, "tools/install-runtime-presets.ps1"), path.join(bundle, "tools/install-runtime-presets.ps1"));
    function install(target, status = 0) {
        const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(bundle, "tools/install-runtime-presets.ps1"), "-TargetDirectory", target], { encoding: "utf8", windowsHide: true });
        assert.equal(result.status, status, (result.stdout || "") + (result.stderr || "") + (result.error || ""));
    }
    const fresh = path.join(temp, "fresh"); install(fresh); install(fresh);
    for (const [label, oldGroup, suffix, hashProperty] of [
        ["legacy", "LRBridge TEST", ".lrbridge-legacy.bak", "legacySha256"],
        ["previous", "LRBridge Dust Helpers", ".lrbridge-previous-group.bak", "previousGroupSha256"]
    ]) {
        const target = path.join(temp, label); fs.mkdirSync(target);
        for (const item of manifest.files) {
            const text = fs.readFileSync(path.join(root, "resources/presets", item.name), "utf8");
            fs.writeFileSync(path.join(target, item.name), replaceGroup(text, oldGroup));
            // An existing original migration backup must survive a later rename.
            if (label === "previous") fs.writeFileSync(path.join(target, item.name + ".lrbridge-legacy.bak"), replaceGroup(text, "LRBridge TEST"));
        }
        install(target); install(target);
        assert.equal(fs.readdirSync(target).filter(f => f.endsWith(".xmp")).length, 2);
        for (const item of manifest.files) {
            assert.equal(sha(fs.readFileSync(path.join(target, item.name))), item.sha256);
            assert.equal(sha(fs.readFileSync(path.join(target, item.name + suffix))), item[hashProperty]);
            if (label === "previous") assert.equal(sha(fs.readFileSync(path.join(target, item.name + ".lrbridge-legacy.bak"))), item.legacySha256);
        }
    }
    const conflict = path.join(temp, "conflict"); fs.mkdirSync(conflict);
    for (const item of manifest.files) fs.writeFileSync(path.join(conflict, item.name), replaceGroup(fs.readFileSync(path.join(root, "resources/presets", item.name), "utf8"), "LRBridge Dust Helpers"));
    fs.writeFileSync(path.join(conflict, manifest.files[1].name + ".lrbridge-previous-group.bak"), "unrelated backup");
    install(conflict, 1);
    for (const item of manifest.files) assert.equal(sha(fs.readFileSync(path.join(conflict, item.name))), item.previousGroupSha256, "Validate the entire set before writing");
    fs.writeFileSync(path.join(fresh, manifest.files[0].name), "modified private preset"); install(fresh, 1);
    assert.equal(fs.readFileSync(path.join(fresh, manifest.files[0].name), "utf8"), "modified private preset");
    fs.writeFileSync(path.join(bundle, "resources/presets", manifest.files[1].name), "corrupt bundled preset");
    const untouched = path.join(temp, "must-remain-absent"); install(untouched, 1); assert(!fs.existsSync(untouched));
    console.log("Dust naming: metadata-only bytes, identities/settings, three validated variants, fresh install/idempotence, both naming migrations, preserved backups, no duplicates and checksum/conflict safeguards passed.");
} finally {
    const resolved = fs.realpathSync(temp), allowed = fs.realpathSync(os.tmpdir()) + path.sep;
    assert(resolved.startsWith(allowed) && path.basename(resolved).startsWith("lrbridge-dust-group-"));
    fs.rmSync(resolved, { recursive: true, force: true });
}
