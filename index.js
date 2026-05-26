// tornasol-sdk-node - official Node SDK for tornasol.
// Plain CJS, zero deps, uses the built-in `fetch` from Node 18+.
//
// Quick start:
//
//   const { TornasolClient, runAgent } = require('@kemeny/tornasol');
//   const client = new TornasolClient({ apiKey: process.env.TORNASOL_API_KEY });
//   const sc = await runAgent(async (obs) => ({ direction: 'right' }), { client });
//
// `chooseAction` returns whatever action shape the engine expects (the
// `{ direction }` above is just an example).
//
// See https://github.com/KemenyStudio/tornasol-sdk-node for usage and issues.

'use strict';

const crypto = require('node:crypto');
const pathPosix = require('node:path/posix');

const DEFAULT_BASE_URL = 'https://tornasol-api.kemenylabs.com';

// Canonical hash of an agent file set. Stable, order-independent, language-
// agnostic:
//   1. Normalize each path (forward slashes, posix Clean, no abs, no "..").
//   2. Reject duplicate paths.
//   3. Sort by normalized path.
//   4. Per file:  per_i = sha256(path || 0x00 || content)
//   5. Final:     hash  = sha256(per_1 || per_2 || ...)
function hashAgentFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('tornasol: hashAgentFiles requires at least one file');
  }
  const seen = new Set();
  const norm = files.map((f) => {
    const p = normalizePath(f.path);
    if (seen.has(p)) throw new Error(`tornasol: duplicate path ${JSON.stringify(p)}`);
    seen.add(p);
    return { path: p, content: toBuffer(f.content) };
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const h = crypto.createHash('sha256');
  for (const f of norm) {
    const per = crypto.createHash('sha256');
    per.update(Buffer.from(f.path, 'utf8'));
    per.update(Buffer.from([0]));
    per.update(f.content);
    h.update(per.digest());
  }
  return { hash: h.digest('hex'), files: norm };
}

function normalizePath(p) {
  if (typeof p !== 'string' || p === '') throw new Error('tornasol: empty agent file path');
  const cleaned = pathPosix.normalize(p.replace(/\\/g, '/'));
  if (cleaned.startsWith('/')) throw new Error(`tornasol: absolute agent file path ${JSON.stringify(p)}`);
  if (cleaned === '.' || cleaned === '..' || cleaned.startsWith('../')) {
    throw new Error(`tornasol: agent file path escapes root ${JSON.stringify(p)}`);
  }
  return cleaned;
}

function toBuffer(content) {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  return Buffer.from(String(content), 'utf8');
}

/**
 * Typed error raised on non-2xx HTTP responses.
 */
class TornasolError extends Error {
  constructor(statusCode, message) {
    super(`tornasol: HTTP ${statusCode}: ${message}`);
    this.statusCode = statusCode;
    this.serverMessage = message;
  }
}

class TornasolClient {
  /**
   * @param {object} opts
   * @param {string} [opts.baseURL]   default https://tornasol-api.kemenylabs.com
   * @param {string} [opts.apiKey]    default process.env.TORNASOL_API_KEY
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {string} [opts.userAgent] X-Client header (default "sdk-node")
   */
  constructor(opts = {}) {
    this.baseURL = opts.baseURL || process.env.TORNASOL_BASE_URL || DEFAULT_BASE_URL;
    this.apiKey = opts.apiKey || process.env.TORNASOL_API_KEY;
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.userAgent = opts.userAgent || 'sdk-node';
    if (!this.fetchImpl) {
      throw new Error('tornasol: global fetch not found (Node >=18 required, or pass fetchImpl)');
    }
    if (!this.apiKey) {
      throw new Error('tornasol: missing apiKey (pass {apiKey} or set TORNASOL_API_KEY)');
    }
  }

  async _request(method, path, body) {
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-Client': this.userAgent,
    };
    const res = await this.fetchImpl(this.baseURL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { /* leave null */ }
    }
    if (!res.ok) {
      const msg = (data && data.error) || text || `HTTP ${res.status}`;
      throw new TornasolError(res.status, msg);
    }
    return data;
  }

  /**
   * Start a new run. If agentFiles is provided, their canonical hash is
   * computed locally and sent so the run can be correlated with a later
   * submission. The file bytes themselves are not uploaded here.
   * @param {object} [opts]
   * @param {*} [opts.config]                       engine-specific config
   * @param {Array<{path:string,content:Buffer|Uint8Array|string}>} [opts.agentFiles]
   * @returns {Promise<{run_id:string,engine:string,agent_hash?:string,observation:object}>}
   */
  async startRun(opts = {}) {
    const body = {};
    if (opts.config !== undefined) body.config = opts.config;
    if (Array.isArray(opts.agentFiles) && opts.agentFiles.length > 0) {
      body.agent_hash = hashAgentFiles(opts.agentFiles).hash;
    }
    return this._request('POST', '/api/v1/run', body);
  }

  /**
   * Apply one action. Pass null/undefined to give up the current level/run.
   * @returns {Promise<{observation:object,result:object,done:boolean,scorecard?:object}>}
   */
  async action(runId, actionPayload) {
    return this._request('POST', `/api/v1/run/${runId}/action`, { action: actionPayload ?? null });
  }

  /** Fetch the final scorecard. 409 if the run is still in progress. */
  async scorecard(runId) {
    return this._request('GET', `/api/v1/run/${runId}/scorecard`);
  }

  /**
   * Submit an agent as the final answer. The canonical hash is computed
   * locally; the same hash arises from the same files at startRun, which
   * is how runs and submissions are correlated.
   * @param {object} opts
   * @param {Array<{path:string,content:Buffer|Uint8Array|string}>} opts.files
   * @param {string} [opts.runId]
   * @param {string} [opts.notes]
   */
  async submit(opts) {
    const { hash, files } = hashAgentFiles(opts.files);
    const body = {
      agent_hash: hash,
      files: encodeAgentFiles(files),
    };
    if (opts.runId) body.run_id = opts.runId;
    if (opts.notes) body.notes = opts.notes;
    return this._request('POST', '/api/v1/submission', body);
  }
}

/**
 * runAgent drives the loop. ChooseAction receives an observation and
 * returns the action payload (anything JSON-serializable; null/undefined
 * to give up).
 *
 * @param {(obs:object) => any | Promise<any>} chooseAction
 * @param {object} [opts]
 * @param {TornasolClient} [opts.client]
 * @param {*} [opts.config]
 * @param {Array<{path:string,content:any}>} [opts.agentFiles]
 * @param {(obs:object,result:object,done:boolean) => void} [opts.onTurn]
 * @returns {Promise<object>} the final scorecard
 */
async function runAgent(chooseAction, opts = {}) {
  const client = opts.client || new TornasolClient(opts);
  const run = await client.startRun({
    config: opts.config,
    agentFiles: opts.agentFiles,
  });
  let obs = run.observation;
  while (true) {
    const maybe = chooseAction(obs);
    const action = (maybe && typeof maybe.then === 'function') ? await maybe : maybe;
    const r = await client.action(run.run_id, action);
    if (typeof opts.onTurn === 'function') opts.onTurn(r.observation, r.result, !!r.done);
    if (r.done) return r.scorecard;
    obs = r.observation;
  }
}

function encodeAgentFiles(files) {
  return files.map((f) => ({
    path: f.path,
    content_b64: toBuffer(f.content).toString('base64'),
  }));
}

module.exports = { TornasolClient, TornasolError, runAgent, hashAgentFiles };
