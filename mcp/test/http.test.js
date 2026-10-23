import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, localOrigin } from '../src/http.js';
import { mockBridge } from './mock-bridge.js';

test('only literal loopback origins are accepted and localhost is pinned without DNS', () => {
  assert.equal(localOrigin(), 'http://127.0.0.1:17891');
  assert.equal(localOrigin('http://localhost:17891'), 'http://127.0.0.1:17891');
  assert.equal(localOrigin('http://[::1]:17891'), 'http://[::1]:17891');
  for (const url of ['https://127.0.0.1:17891', 'http://192.168.1.11:17891', 'http://example.com',
    'http://127.0.0.1:17891/api', 'http://user:pass@localhost', 'http://localhost?x=1', 'http://localhost#x', 'file:///tmp/server']) {
    assert.throws(() => localOrigin(url), { code: 'invalid_url' });
  }
});
test('HTTP redirects are refused without contacting the destination', async t => {
  const m = await mockBridge({ intercept({ res }) { res.writeHead(302, { Location: 'http://example.com/control' }); res.end('{}'); return true; } });
  t.after(() => m.close());
  await assert.rejects(new HttpClient({ baseUrl: m.url }).get('/status'), { code: 'redirect_refused' });
  assert.equal(m.requests.length, 1);
});
test('HTTP response size is bounded', async t => {
  const m = await mockBridge({ intercept({ res }) { res.end('x'.repeat(1024 * 1024 + 1)); return true; } });
  t.after(() => m.close());
  await assert.rejects(new HttpClient({ baseUrl: m.url }).get('/status'), { code: 'invalid_response' });
});
test('invalid JSON is rejected without a retry', async t => {
  const m = await mockBridge({ intercept({ res }) { res.end('<html>not JSON</html>'); return true; } });
  t.after(() => m.close());
  await assert.rejects(new HttpClient({ baseUrl: m.url }).get('/status'), { code: 'invalid_response' }); assert.equal(m.requests.length, 1);
});
test('connection failure is reported as offline', async () => {
  const m = await mockBridge(); await m.close();
  const r = await m.service.call('lrbridge_get_status'); assert.equal(r.status, 'offline'); assert.equal(r.bridgeReachable, false);
});
test('HTTP timeout is bounded, including a stalled body; request is not retried', async t => {
  const m = await mockBridge({ intercept({ res }) { res.writeHead(200); res.write('{'); return true; } });
  t.after(() => m.close());
  await assert.rejects(new HttpClient({ baseUrl: m.url, httpTimeoutMs: 30 }).get('/status'), { code: 'http_timeout' });
  assert.equal(m.requests.length, 1);
});
test('cancellation before a write prevents admission', async t => {
  const m = await mockBridge(); t.after(() => m.close());
  const context = await m.ownedContext(), controller = new AbortController(); controller.abort();
  const r = await m.service.call('lrbridge_set_slider', { requestId: 'cancel', context, slider: 'Contrast', value: 24 }, controller.signal);
  assert.equal(r.status, 'rejected'); assert.equal(m.writes.length, 0);
});
test('cancellation after POST remains uncertain and cannot replay', async t => {
  const controller = new AbortController();
  const m = await mockBridge({ intercept({ method }) { if (method === 'POST') controller.abort(); return false; } }); t.after(() => m.close());
  const context = await m.ownedContext();
  const args = { requestId: 'cancel', context, slider: 'Contrast', value: 24 };
  const r = await m.service.call('lrbridge_set_slider', args, controller.signal);
  assert.equal(r.status, 'uncertain'); assert.equal(m.writes.length, 1);
  assert.equal((await m.service.call('lrbridge_set_slider', args)).duplicate, true); assert.equal(m.writes.length, 1);
});
