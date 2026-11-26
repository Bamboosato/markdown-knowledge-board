import { randomBytes, randomUUID } from 'node:crypto';
import { accessSchemas, accessResults, accessError } from './note-schema.mjs';
import { metadataActions as brokerMetadataActions } from './metadata-schema.mjs';
const brokerCapabilities = ['create_note', ...Object.keys(accessSchemas)];
function supportedOperations(body) {
  if (!Object.hasOwn(body, 'supportedOperations')) return body.protocolVersion === 2 ? ['create_note', 'search_notes', 'get_note', 'update_note'] : ['create_note'];
  if (!Array.isArray(body.supportedOperations) || body.supportedOperations.some(v => typeof v !== 'string')) throw new Error('Invalid capabilities.');
  return brokerCapabilities.filter(name => body.supportedOperations.includes(name));
}
function supportedMetadataActions(body, operations) {
  if (!operations.includes('preview_custom_metadata_changes') || !operations.includes('apply_custom_metadata_changes')) return [];
  if (!Object.hasOwn(body, 'supportedMetadataActions')) return ['add', 'update', 'upsert'];
  if (!Array.isArray(body.supportedMetadataActions) || body.supportedMetadataActions.some(v => typeof v !== 'string')) throw new Error('Invalid metadata actions.');
  return brokerMetadataActions.filter(action => body.supportedMetadataActions.includes(action));
}

// One paired tab, one in-flight write; no note body or token is logged.
export function createBridge(origin, { timeoutMs = 15000, allowedOrigins = [origin], token = randomBytes(32).toString('hex'), auto } = {}) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid pairing credential.');
  let client = null;
  let job = null;
  const fresh = () => client && Date.now() - client.seen < 5000;
  let polls=0;
  const probe=()=>({connected:Boolean(fresh()),poll:polls,key:client?.key,origin:client?.origin});
  const ensureConnection=()=>auto ? auto.ready(probe) : Promise.resolve(fresh()?null:'NOT_CONNECTED');
  const finish = (result) => {
    if (!job) return;
    if (job.operation !== 'create_note' && typeof result.error === 'string') result = { error: { code: 'OUTCOME_UNKNOWN', message: result.error } };
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
        if (bytes > (req.url === '/__local_mcp/ack' ? 1048576 : 4096)) return send(413, fail('Response too large.'));
        chunks.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId)) {
        return send(400, fail('Invalid client.'));
      }
      if (req.url === '/__local_mcp/auto') {
        if (!auto) return send(400,fail('Automatic opening is unavailable.'));
        const ownsSession=client?.id===body.clientId && client.origin===req.headers.origin && fresh();
        if (auto.state==='off' && body.action==='forget') return send(200,{automatic:'off'});
        if (auto.state==='off' && (!ownsSession || body.action!=='enable')) return send(403,fail('Connect this tab first.'));
        try {auto.configure(req.headers.origin,body);} catch {return send(403,fail('Automatic connection settings rejected. Check the registered profile.'));}
        if (body.action==='enable' && ownsSession) client.key=body.key;
        if (body.action==='pause' || body.action==='forget') {
          finish(fail('Disconnected. Check the receipt before retrying.'));
          client=null;
        }
        return send(200,{automatic: auto.state});
      }
      if (req.url === '/__local_mcp/connect') {
        if (auto && !auto.accept(req.headers.origin,body.profileKey)) return send(403,fail('Use the registered profile or resume automatic connection.'));
        if ((fresh() || job) && client?.id !== body.clientId) {
          return send(409, fail('Another tab is connected. Disconnect it first.'));
        }
        const operations = supportedOperations(body);
        client = { id: body.clientId, origin: req.headers.origin, seen: Date.now(), protocolVersion: body.protocolVersion === 2 ? 2 : 1, noteAccess: body.noteAccess === true, supportedOperations: operations,
          metadataActions: supportedMetadataActions(body, operations) };
        client.key=body.profileKey;
        return send(200, { connected: true, protocolVersion: 2, brokerMetadataActions, autoAvailable:Boolean(auto) });
      }
      if (client?.id !== body.clientId || client.origin !== req.headers.origin) return send(409, fail('Connect this tab first.'));
      client.seen = Date.now();
      if (req.url === '/__local_mcp/permissions') {
        client.noteAccess = body.noteAccess === true;
        return send(200, { updated: true });
      }
      if (req.url === '/__local_mcp/poll') {
        polls++;
        const supported = supportedOperations(body);
        const actions = supportedMetadataActions(body, supported);
        if (body.protocolVersion === 2) { client.protocolVersion = 2; client.noteAccess = body.noteAccess === true; client.supportedOperations = supported; client.metadataActions = actions; }
        return send(200, { brokerMetadataActions, job: job ? { deliveryId: job.deliveryId, operation: job.operation, input: job.input } : null });
      }
      if (req.url === '/__local_mcp/disconnect') {
        finish(fail('Browser disconnected. If delivery had started, outcome is unknown; retry the same request_id.'));
        client = null;
        return send(200, { connected: false });
      }
      if (req.url === '/__local_mcp/ack') {
        if (!job || job.deliveryId !== body.deliveryId) return send(409, fail('Delivery expired.'));
        const result = body.result;
        if (job.operation !== 'create_note') {
          const parsed = accessResults[job.operation].safeParse(result);
          const error = accessError.safeParse(result);
          if (!parsed.success && !error.success) return send(400, fail('Invalid operation receipt.'));
          if (parsed.success && ['get_note', 'update_note', 'append_note', 'replace_note_text'].includes(job.operation) && parsed.data.id !== job.input.note_id) return send(400, fail('Wrong note receipt.'));
          if (parsed.success && job.operation === 'apply_custom_metadata_changes' && parsed.data.plan_id !== job.input.plan_id) return send(400, fail('Wrong plan receipt.'));
          finish(parsed.success ? parsed.data : error.data);
          return send(200, { acknowledged: true });
        }
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
    middleware, ensureConnection,
    status: () => ({ connected: Boolean(fresh()), busy: Boolean(job), origin, browserOrigin: fresh() ? client.origin : null,
      automatic: auto?.state ?? 'off', protocolVersion: 2, brokerCapabilities, brokerMetadataActions,
      metadataActions: fresh() && client.protocolVersion === 2 && client.noteAccess ? client.metadataActions : [],
      capabilities: fresh() ? client.supportedOperations.filter(name => name === 'create_note' || client.protocolVersion === 2 && client.noteAccess) : [] }),
    execute: (operation, input) => {
      const error = (code, message) => Promise.resolve({ error: { code, message } });
      if (!Object.hasOwn(accessSchemas, operation) || !accessSchemas[operation].safeParse(input).success) return error('INVALID_ARGUMENT', 'Invalid note request.');
      if (!fresh()) return error('NOT_CONNECTED', 'Open MKB and reconnect.');
      if (client.protocolVersion !== 2) return error('UPGRADE_REQUIRED', 'Update the MKB PWA.');
      if (!client.supportedOperations.includes(operation)) return error('UPGRADE_REQUIRED', 'Update the MKB PWA to use this operation.');
      if (!client.noteAccess) return error('ACCESS_DISABLED', 'Enable reading and updating notes under Local MCP → Note access.');
      if (operation === 'preview_custom_metadata_changes' && input.changes.some(c => !client.metadataActions.includes(c.action))) return error('UPGRADE_REQUIRED', 'Update the MKB PWA to use this metadata action.');
      if (job) return error('BUSY', 'Another operation is in progress.');
      return new Promise(resolve => {
        job = { operation, input, resolve, deliveryId: randomUUID(),
          timer: setTimeout(() => finish({ error: { code: 'OUTCOME_UNKNOWN', message: 'Receipt timed out. Retry exactly the same input and request_id for an update.' } }), timeoutMs) };
      });
    },
    create: async (input) => {
      if (auto && auto.state!=='off') {
        const error=await ensureConnection();
        if (error || !auto.accept(client?.origin,client?.key)) return fail(error || 'AUTO_PROFILE_MISMATCH');
      }
      if (!fresh()) return Promise.resolve(fail('No connected browser. Open the local app and connect first.'));
      if (!client.supportedOperations.includes('create_note')) return Promise.resolve(fail('Update the MKB PWA to create notes.'));
      if (job) return Promise.resolve(fail('Another save is in progress. Retry later with the same request_id.'));
      return new Promise((resolve) => {
        job = {
          operation: 'create_note',
          input, resolve, deliveryId: randomUUID(),
          timer: setTimeout(() => finish(fail('Save receipt timed out. Outcome is unknown; retry the same request_id in the same browser.')), timeoutMs),
        };
      });
    },
    close: () => { finish(fail('MCP server stopped. Save outcome may be unknown; retry the same request_id.')); client = null; },
  };
}
