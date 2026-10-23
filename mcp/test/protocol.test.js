import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mockBridge } from './mock-bridge.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const env = m => ({ ...process.env, LRBRIDGE_URL: m.url, LRBRIDGE_MCP_STATE_DIR: m.stateDir });

test('official SDK client initializes over stdio, discovers nine tools and performs owned reads/writes', async t => {
  const m = await mockBridge(); t.after(() => m.close());
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli], env: env(m), stderr: 'pipe' });
  const client = new Client({ name: 'lrbridge-test-client', version: '1.0.0' });
  t.after(() => client.close());
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  const set = tools.find(t => t.name === 'lrbridge_set_slider');
  assert.equal(set.annotations.readOnlyHint, false); assert.equal(set.annotations.destructiveHint, true);
  assert.equal(set.inputSchema.additionalProperties, false);
  assert.ok(set.inputSchema.required.includes('context'));
  const read = await client.callTool({ name: 'lrbridge_get_slider_values', arguments: { sliders: ['Contrast'] } });
  assert.equal(read.isError, false);
  const data = read.structuredContent || JSON.parse(read.content[0].text);
  const written = await client.callTool({ name: 'lrbridge_set_slider', arguments: { requestId: 'protocol-set', context: data.context, slider: 'Contrast', value: 24 } });
  assert.equal(written.isError, false);
  assert.equal((written.structuredContent || JSON.parse(written.content[0].text)).status, 'confirmed');
  const invalid = await client.callTool({ name: 'lrbridge_set_slider', arguments: { requestId: 'invalid', context: data.context, slider: 'Contrast', value: '24' } });
  assert.equal(invalid.isError, true); assert.equal(m.writes.length, 1); assert.equal(stderr, '');
});

for (const protocolVersion of ['2024-11-05', '2025-03-26', '2025-11-25']) {
  test(`legacy ${protocolVersion} initialization/tool discovery speaks clean JSON-RPC stdout`, async t => {
    const m = await mockBridge(); t.after(() => m.close());
    const child = spawn(process.execPath, [cli], { env: env(m), stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => child.kill());
    const pending = new Map(); let serial = 0, buffer = '', stderr = '';
    child.stderr.on('data', b => { stderr += b; });
    child.stdout.on('data', b => {
      buffer += b;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        pending.get(message.id)?.(message); pending.delete(message.id);
      }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      const id = ++serial, timer = setTimeout(() => reject(new Error(`Timeout: ${method}; ${stderr}`)), 5000);
      pending.set(id, message => { clearTimeout(timer); resolve(message); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const initialized = await send('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' } });
    assert.equal(initialized.result.protocolVersion, protocolVersion);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await send('tools/list', {}); assert.equal(listed.result.tools.length, 9);
    const result = await send('tools/call', { name: 'lrbridge_get_status', arguments: {} });
    assert.equal(JSON.parse(result.result.content[0].text).lightroom, 'ready');
    assert.equal(stderr, ''); assert.equal(m.writes.length, 0);
    child.stdin.end();
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('stdio process did not exit on EOF')), 3000); child.once('exit', () => { clearTimeout(timeout); resolve(); }); });
  });
}
