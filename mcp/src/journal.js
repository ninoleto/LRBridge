import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { BridgeError } from './http.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const fingerprint = value => hash(JSON.stringify(canonical(value)));

// Write-ahead records survive MCP restarts. No record eviction, automatic replay,
// automatic lock recovery, or implicit acknowledgement of an uncertain operation.
export class Journal {
  constructor(origin, stateDir) {
    const root = stateDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), 'LRBridgeMCP');
    this.directory = path.join(root, hash(origin).slice(0, 24));
    this.lock = path.join(this.directory, 'writer.lock');
    this.origin = origin;
  }
  init() { fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 }); }
  filename(id) { return path.join(this.directory, hash(id) + '.json'); }
  read(id) {
    const file = this.filename(id);
    if (!fs.existsSync(file)) return null;
    try {
      if (fs.statSync(file).size > 256 * 1024) throw new Error('Oversized record');
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record.version !== 1 || record.origin !== this.origin || record.requestId !== id ||
          !['pending', 'complete', 'uncertain'].includes(record.state) || !Array.isArray(record.operations) ||
          typeof record.fingerprint !== 'string') throw new Error('Invalid record');
      return record;
    } catch { throw new BridgeError('journal_error', 'Operation journal is unreadable. Preserve it and inspect before further edits.'); }
  }
  records() {
    this.init();
    return fs.readdirSync(this.directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(file => {
      try {
        const id = JSON.parse(fs.readFileSync(path.join(this.directory, file), 'utf8')).requestId;
        if (this.filename(id) !== path.join(this.directory, file)) throw new Error();
        return this.read(id);
      } catch { throw new BridgeError('journal_error', 'Operation journal is unreadable. Preserve it and inspect before further edits.'); }
    });
  }
  blocked() { return this.records().filter(r => !r.reviewed && r.state !== 'complete').map(r => r.requestId); }
  save(record) {
    this.init();
    const temporary = path.join(this.directory, randomUUID() + '.tmp');
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(record) + '\n');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, this.filename(record.requestId));
      // Persist the rename where directory fsync is supported.
      if (process.platform !== 'win32') {
        const dir = fs.openSync(this.directory, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  async exclusive(fn) {
    this.init();
    try { fs.mkdirSync(this.lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new BridgeError('writer_busy', 'Another MCP writer holds the journal lock. After a crash, close both clients and use --recover-lock.');
      throw error;
    }
    let result;
    try {
      fs.writeFileSync(path.join(this.lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      result = await fn();
      return result;
    } finally {
      try { fs.rmSync(this.lock, { recursive: true }); }
      catch (error) {
        // Never turn an already-applied, journaled edit into a "rejected"
        // response just because cleanup failed. The retained lock blocks writes.
        if (result && typeof result === 'object') {
          result.journalWarning = 'Could not release the writer lock. Close clients and inspect/recover the lock before further writes.';
        } else throw error;
      }
    }
  }
  recoverLock() {
    if (!fs.existsSync(this.lock)) return false;
    const ownerPath = path.join(this.lock, 'owner.json');
    if (fs.existsSync(ownerPath)) {
      const { pid } = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new BridgeError('journal_error', 'Invalid lock owner.');
      try { process.kill(pid, 0); }
      catch (error) {
        if (error.code === 'ESRCH') { fs.rmSync(this.lock, { recursive: true }); return true; }
        throw error;
      }
      throw new BridgeError('writer_busy', 'Lock owner is still running; close its MCP client first.');
    }
    // Explicit CLI recovery only, after both clients have been closed.
    fs.rmSync(this.lock, { recursive: true });
    return true;
  }
}
