import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function entries(archive) {
  const bytes = zlib.gunzipSync(archive), files = new Map();
  for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
    const header = bytes.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, ''), 8);
    assert.ok(Number.isSafeInteger(size));
    if (header[156] === 48 || header[156] === 0) files.set(name, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
test('packaging is reproducible and contains only allowlisted source with locked dependencies', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lrbridge-package-test-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  assert.ok(process.env.npm_execpath, 'Run through npm test, as documented.');
  const pack = () => {
    execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'pack:local', '--', output], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000
    });
    return fs.readFileSync(path.join(output, 'lrbridge-mcp-0.1.0.tgz'));
  };
  const first = pack(), second = pack();
  assert.equal(digest(first), digest(second));
  const files = entries(first);
  assert.ok(files.has('package/src/cli.js'));
  assert.ok(files.has('package/examples/codex-config.toml'));
  assert.ok(files.has('package/TESTING.md'));
  assert.ok(files.has('package/LICENSE'));
  assert.equal(files.has('package/package-lock.json'), false);
  for (const name of files.keys()) assert.ok(/^package\/(src\/[^/]+\.js|examples\/[^/]+|README\.md|TESTING\.md|LICENSE|package\.json|npm-shrinkwrap\.json|SOURCE_MANIFEST\.json)$/.test(name), name);
  const manifest = JSON.parse(files.get('package/SOURCE_MANIFEST.json'));
  for (const file of manifest.files) assert.equal(digest(files.get('package/' + file.path)), file.sha256, file.path);
  const locked = JSON.parse(files.get('package/npm-shrinkwrap.json'));
  const sourceLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.deepEqual(locked, sourceLock);
  assert.equal(JSON.parse(files.get('package/package.json')).private, true);
});
