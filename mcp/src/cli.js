#!/usr/bin/env node
import path from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer, VERSION } from './server.js';
import { LRBridgeService } from './service.js';

function milliseconds(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`${name} must be ${min}–${max} milliseconds.`);
  return Number(raw);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('LRBridge MCP: node src/cli.js [--check | --operation ID | --acknowledge ID --reviewed-in-lightroom | --recover-lock | --version]\nNo arguments starts MCP stdio. No TCP listener is opened.\n');
    return;
  }
  if (args.length === 1 && args[0] === '--version') { process.stdout.write(VERSION + '\n'); return; }
  if (args.length && !((args.length === 1 && ['--check', '--recover-lock'].includes(args[0])) ||
      (args.length === 2 && args[0] === '--operation') ||
      (args.length === 3 && args[0] === '--acknowledge' && args[2] === '--reviewed-in-lightroom'))) {
    throw new Error('Invalid arguments. Use --help.');
  }
  const stateDir = process.env.LRBRIDGE_MCP_STATE_DIR;
  if (stateDir && !path.isAbsolute(stateDir)) throw new Error('LRBRIDGE_MCP_STATE_DIR must be an absolute local directory.');
  const options = { baseUrl: process.env.LRBRIDGE_URL, stateDir,
    httpTimeoutMs: milliseconds('LRBRIDGE_MCP_HTTP_TIMEOUT_MS', 3000, 250, 10000),
    readTimeoutMs: milliseconds('LRBRIDGE_MCP_READ_TIMEOUT_MS', 8000, 1000, 20000),
    operationTimeoutMs: milliseconds('LRBRIDGE_MCP_OPERATION_TIMEOUT_MS', 70000, 1000, 120000) };
  const service = new LRBridgeService(options);
  if (args.length) {
    let result;
    if (args[0] === '--check') result = await service.call('lrbridge_get_status');
    if (args[0] === '--operation') result = await service.call('lrbridge_get_operation', { requestId: args[1] });
    if (args[0] === '--acknowledge') result = await service.acknowledge(args[1]);
    if (args[0] === '--recover-lock') result = { recovered: service.journal.recoverLock(), note: 'No edit was sent. Interrupted operations still require review.' };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status && !['read', 'confirmed'].includes(result.status) || args[0] === '--check' && result.lightroom !== 'ready') process.exitCode = 1;
    return;
  }
  // One service/journal per process; the official SDK negotiates both modern and
  // legacy MCP sessions. stdout belongs exclusively to the transport.
  const handle = serveStdio(() => createServer({ service }), { onerror: error => console.error('LRBridge MCP:', error.message) });
  const shutdown = async () => { await handle.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => { console.error('LRBridge MCP:', error.message); process.exitCode = 1; });
