// Tests use Node's built-in test runner; no external deps.
//   node --test test/

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { TornasolClient, runAgent, TornasolError, hashAgentFiles } = require('..');

function startFakeServer({ captureRunHash } = {}) {
  let turn = 0;
  const runId = 'run-abc';
  const engine = 'fake-engine';
  let runHash = '';
  const srv = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      if (req.headers['x-api-key'] !== 'test-key') return send(401, { error: 'unauthorized' });
      const parsed = body ? JSON.parse(body) : {};

      if (req.method === 'POST' && req.url === '/api/v1/run') {
        runHash = parsed.agent_hash || '';
        if (captureRunHash) captureRunHash(runHash);
        return send(200, {
          run_id: runId, engine, agent_hash: runHash,
          observation: { run_id: runId, engine, turn: 0, status: 'in_progress', payload: null },
        });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/v1/run/') && req.url.endsWith('/action')) {
        turn++;
        const done = turn >= 2;
        return send(200, {
          observation: { run_id: runId, engine, turn, status: done ? 'won' : 'in_progress', payload: null },
          result: { effect: 'moved' },
          done,
          scorecard: done ? {
            run_id: runId, engine, status: 'won',
            score: 1.0, turns: turn, elapsed_ms: 1, ended_at: '2026-05-19T00:00:00Z',
          } : undefined,
        });
      }
      if (req.method === 'POST' && req.url === '/api/v1/submission') {
        const matchingRuns = parsed.agent_hash === runHash && runHash ? [runId] : [];
        return send(200, {
          id: 'sub-1', agent_hash: parsed.agent_hash,
          blob_ref: `agent-artifacts/tenant/${parsed.agent_hash}.zip`,
          files: parsed.files.length, bytes_in: 10, reused_hash: false,
          matching_runs: matchingRuns,
        });
      }
      send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => srv.listen(0, () => resolve({ srv, port: srv.address().port })));
}

test('runAgent drives the loop and returns the scorecard', async () => {
  const { srv, port } = await startFakeServer();
  try {
    let calls = 0;
    const sc = await runAgent(
      (obs) => { calls++; return { direction: 'right' }; },
      { baseURL: `http://localhost:${port}`, apiKey: 'test-key' },
    );
    assert.equal(sc.score, 1.0);
    assert.equal(sc.status, 'won');
    assert.equal(calls, 2);
  } finally {
    srv.close();
  }
});

test('hashAgentFiles is order-independent and stable', () => {
  const a = hashAgentFiles([
    { path: 'a.js', content: 'one' },
    { path: 'b.js', content: 'two' },
  ]).hash;
  const b = hashAgentFiles([
    { path: 'b.js', content: 'two' },
    { path: 'a.js', content: 'one' },
  ]).hash;
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('startRun sends agent_hash (not files) when agentFiles is provided', async () => {
  let seenHash;
  const { srv, port } = await startFakeServer({ captureRunHash: (h) => { seenHash = h; } });
  try {
    const client = new TornasolClient({ baseURL: `http://localhost:${port}`, apiKey: 'test-key' });
    const files = [{ path: 'agent.js', content: 'module.exports = {};' }];
    await client.startRun({ agentFiles: files });
    assert.equal(seenHash, hashAgentFiles(files).hash);
  } finally {
    srv.close();
  }
});

test('submit hashes locally and matching_runs links back to startRun', async () => {
  const { srv, port } = await startFakeServer();
  try {
    const client = new TornasolClient({ baseURL: `http://localhost:${port}`, apiKey: 'test-key' });
    const files = [{ path: 'agent.js', content: 'x' }];
    const run = await client.startRun({ agentFiles: files });
    const r = await client.submit({ files });
    assert.equal(r.agent_hash, run.agent_hash);
    assert.deepEqual(r.matching_runs, ['run-abc']);
  } finally {
    srv.close();
  }
});

test('unauthorized raises TornasolError with statusCode', async () => {
  const { srv, port } = await startFakeServer();
  try {
    const client = new TornasolClient({ baseURL: `http://localhost:${port}`, apiKey: 'wrong-key' });
    await assert.rejects(
      () => client.startRun(),
      (err) => err instanceof TornasolError && err.statusCode === 401,
    );
  } finally {
    srv.close();
  }
});
