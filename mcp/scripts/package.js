import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, 'dist'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lrbridge-mcp-pack-'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const files = [];
function copy(relative) {
  const source = path.join(root, relative);
  if (fs.lstatSync(source).isDirectory()) {
    for (const entry of fs.readdirSync(source).sort()) copy(path.join(relative, entry));
    return;
  }
  if (!fs.lstatSync(source).isFile()) throw new Error('Only regular source files may be packaged.');
  const bytes = fs.readFileSync(source);
  const destination = path.join(stage, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  files.push({ path: relative.replaceAll('\\', '/'), sha256: sha256(bytes) });
}
try {
  // Explicit allowlist. Never copy the parent Electron app, catalog paths,
  // node_modules, credentials, tests, journals or local configuration.
  for (const item of ['src', 'examples', 'README.md', 'TESTING.md', 'LICENSE', 'package.json']) copy(item);
  const lock = fs.readFileSync(path.join(root, 'package-lock.json'));
  // npm pack excludes package-lock.json; shrinkwrap preserves the exact same
  // dependency graph in the distributable and is recognized by npm ci.
  fs.writeFileSync(path.join(stage, 'npm-shrinkwrap.json'), lock);
  files.push({ path: 'npm-shrinkwrap.json', sha256: sha256(lock) });
  let sourceCommit = null, sourceTreeDirty = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    sourceTreeDirty = !!execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* Source archives need not contain Git metadata. */ }
  fs.writeFileSync(path.join(stage, 'SOURCE_MANIFEST.json'), JSON.stringify({
    sourceCommit, sourceTreeDirty, runtime: process.version,
    files: files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  }, null, 2) + '\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
  pkg.files = ['src/', 'examples/', 'README.md', 'TESTING.md', 'LICENSE', 'npm-shrinkwrap.json', 'SOURCE_MANIFEST.json'];
  // This staging-only metadata is deterministic; the source package is untouched.
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'SOURCE_MANIFEST.json'), 'utf8'));
  manifest.files.find(f => f.path === 'package.json').sha256 = sha256(fs.readFileSync(path.join(stage, 'package.json')));
  fs.writeFileSync(path.join(stage, 'SOURCE_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.mkdirSync(output, { recursive: true });
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) throw new Error('Run packaging through npm run pack:local.');
  const result = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', output],
    { cwd: stage, encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  const archive = path.join(output, result[0].filename);
  const digest = sha256(fs.readFileSync(archive));
  fs.writeFileSync(archive + '.sha256', digest + '  ' + path.basename(archive) + '\n');
  process.stdout.write(JSON.stringify({ archive, sha256: digest, sourceCommit, sourceTreeDirty }, null, 2) + '\n');
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
