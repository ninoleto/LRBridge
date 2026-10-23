import http from 'node:http';

export class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.details = details;
  }
}

export function localOrigin(input = 'http://127.0.0.1:17891') {
  let url;
  try { url = new URL(input); } catch { throw new BridgeError('invalid_url', 'Invalid LRBridge URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new BridgeError('invalid_url', 'Use an HTTP loopback origin only, for example http://127.0.0.1:17891. No path, credentials or remote host.');
  }
  // No DNS, redirects, proxy environment variables or remote fallback.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}

export class HttpClient {
  constructor({ baseUrl, httpTimeoutMs = 3000 } = {}) {
    this.origin = localOrigin(baseUrl);
    this.timeoutMs = httpTimeoutMs;
  }

  request(path, { body, signal, timeoutMs = this.timeoutMs } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new BridgeError('invalid_path', 'Invalid API path.');
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new BridgeError('invalid_path', 'API origin changed.');
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      let finished = false;
      const done = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => req.destroy(new BridgeError('cancelled', 'Request cancelled; an already submitted write may still execute.'));
      const req = http.request(url, {
        method: encoded === undefined ? 'GET' : 'POST',
        agent: false,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store',
          ...(encoded === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) }) }
      }, res => {
        let length = 0;
        const chunks = [];
        res.on('data', chunk => {
          length += chunk.length;
          if (length > 1024 * 1024) req.destroy(new BridgeError('invalid_response', 'LRBridge response exceeds 1 MiB.'));
          else chunks.push(chunk);
        });
        res.on('error', error => done(error));
        res.on('end', () => {
          if (res.statusCode >= 300 && res.statusCode < 400) {
            return done(new BridgeError('redirect_refused', 'LRBridge redirects are not followed.'));
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
            done(null, { status: res.statusCode, data });
          } catch { done(new BridgeError('invalid_response', 'LRBridge did not return a JSON object.', { status: res.statusCode })); }
        });
      });
      const timer = setTimeout(() => req.destroy(new BridgeError('http_timeout', 'LRBridge HTTP request timed out.')), timeoutMs);
      req.on('error', error => done(error instanceof BridgeError ? error : new BridgeError('connection_failed', 'Could not communicate with local LRBridge.', { transportCode: error.code })));
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      req.end(encoded);
    });
  }

  async get(path, options) {
    const { status, data } = await this.request(path, options);
    if (status !== 200 || data.ok === false) throw new BridgeError('api_rejected', `LRBridge rejected read ${path.split('?')[0]}.`, { httpStatus: status });
    return data;
  }
}
