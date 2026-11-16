import { randomBytes, randomUUID } from 'node:crypto';

// One paired tab, one in-flight write; no note body or token is logged.
export function createBridge(origin, { timeoutMs = 15000, allowedOrigins = [origin] } = {}) {
  const token = randomBytes(32).toString('hex');
  let client = null;
  let job = null;
  const fresh = () => client && Date.now() - client.seen < 5000;
  const finish = (result) => {
    if (!job) return;
    clearTimeout(job.timer);
    const resolve = job.resolve;
    job = null;
    resolve(result);
  };
  const fail = (error) => ({ error });

  async function middleware(req, res, next) {
    if (!req.url?.startsWith('/__local_mcp/')) return next();
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    // Only explicitly configured app origins can pair; never reflect arbitrary origins.
    if (req.headers.host !== new URL(origin).host || !allowedOrigins.includes(req.headers.origin)) {
      return send(403, fail('Connection rejected.'));
    }
    res.setHeader?.('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader?.('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      if (req.headers['access-control-request-method'] !== 'POST') return send(403, fail('Connection rejected.'));
      res.setHeader?.('Access-Control-Allow-Methods', 'POST');
      res.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return send(200, {});
    }
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}` ||
        req.headers['content-type'] !== 'application/json') {
      return send(403, fail('Connection rejected.'));
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 4096) return send(413, fail('Response too large.'));
        chunks.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId)) {
        return send(400, fail('Invalid client.'));
      }
      if (req.url === '/__local_mcp/connect') {
        if ((fresh() || job) && client?.id !== body.clientId) {
          return send(409, fail('Another tab is connected. Disconnect it first.'));
        }
        client = { id: body.clientId, origin: req.headers.origin, seen: Date.now() };
        return send(200, { connected: true });
      }
      if (client?.id !== body.clientId || client.origin !== req.headers.origin) return send(409, fail('Connect this tab first.'));
      client.seen = Date.now();
      if (req.url === '/__local_mcp/poll') {
        return send(200, { job: job ? { deliveryId: job.deliveryId, input: job.input } : null });
      }
      if (req.url === '/__local_mcp/disconnect') {
        finish(fail('Browser disconnected. If delivery had started, outcome is unknown; retry the same request_id.'));
        client = null;
        return send(200, { connected: false });
      }
      if (req.url === '/__local_mcp/ack') {
        if (!job || job.deliveryId !== body.deliveryId) return send(409, fail('Delivery expired.'));
        const result = body.result;
        if (result?.error === 'SAVE_FAILED') {
          finish(fail('Browser could not save. Check the app; retry the same request_id.'));
        } else if (typeof result?.id === 'string' && result.id.startsWith('mcp-') &&
                   typeof result.title === 'string' && result.title.length <= 200 &&
                   typeof result.reused === 'boolean') {
          finish({ status: 'saved', ...result });
        } else return send(400, fail('Invalid save receipt.'));
        return send(200, { acknowledged: true });
      }
      return send(404, fail('Unknown operation.'));
    } catch {
      if (!res.headersSent) send(400, fail('Invalid request.'));
    }
  }

  return {
    token,
    middleware,
    status: () => ({ connected: Boolean(fresh()), busy: Boolean(job), origin, browserOrigin: fresh() ? client.origin : null }),
    create: (input) => {
      if (!fresh()) return Promise.resolve(fail('No connected browser. Open the local app and connect first.'));
      if (job) return Promise.resolve(fail('Another save is in progress. Retry later with the same request_id.'));
      return new Promise((resolve) => {
        job = {
          input, resolve, deliveryId: randomUUID(),
          timer: setTimeout(() => finish(fail('Save receipt timed out. Outcome is unknown; retry the same request_id in the same browser.')), timeoutMs),
        };
      });
    },
    close: () => { finish(fail('MCP server stopped.')); client = null; },
  };
}
