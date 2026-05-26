#!/usr/bin/env node
// tornasol-run-agent: run an agent file against the tornasol server.
//
//   tornasol-run-agent --agent ./agent.js [--config '{}']
//
// The agent file must export `chooseAction(observation)` (sync or async).
// Optionally `module.exports = chooseAction`.

'use strict';

const fs = require('fs');
const path = require('path');
const { runAgent, TornasolClient } = require('..');

const argv = process.argv.slice(2);
function flag(name, def) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; }
function has(name) { return argv.indexOf(name) >= 0; }

if (has('--help') || has('-h')) {
  console.log(`Usage: tornasol-run-agent --agent <path> [options]

Options:
  --agent <path>      JS file exporting chooseAction (required)
  --config <json>     engine-specific config, JSON string
  --base-url <url>    server URL (default $TORNASOL_BASE_URL or production)
  --output <path>     save final scorecard JSON

Env:
  TORNASOL_API_KEY    your API key (required)
  TORNASOL_BASE_URL   alternative to --base-url
`);
  process.exit(0);
}

const agentPath = flag('--agent');
if (!agentPath) {
  console.error('Missing --agent. Try --help.');
  process.exit(1);
}

const abs = path.resolve(agentPath);
const mod = require(abs);
const chooseAction =
  (mod && typeof mod.chooseAction === 'function') ? mod.chooseAction :
  (typeof mod === 'function') ? mod : null;
if (!chooseAction) {
  console.error(`${agentPath}: must export chooseAction(observation) or default a function.`);
  process.exit(1);
}

let config;
const cfgRaw = flag('--config');
if (cfgRaw) {
  try { config = JSON.parse(cfgRaw); }
  catch (e) { console.error('--config: invalid JSON:', e.message); process.exit(1); }
}

const baseURL = flag('--base-url');
const outputPath = flag('--output');

// Capture the agent source so a later submission matches by hash.
let agentFiles;
try {
  agentFiles = [{ path: path.basename(abs), content: fs.readFileSync(abs) }];
} catch (e) { /* ignore - running without code capture is fine */ }

(async () => {
  const client = new TornasolClient({ baseURL });
  console.log(`\n=== tornasol - running ${path.basename(abs)} ===\n`);
  try {
    const scorecard = await runAgent(chooseAction, {
      client, config, agentFiles,
      onTurn: (obs, r, done) => {
        const tag = done ? '✓ done' : `  turn ${obs.turn}`;
        const effect = r.effect ? ` (${r.effect})` : '';
        console.log(`${tag}${effect}  status=${obs.status}`);
      },
    });
    console.log(`\n=== scorecard ===`);
    console.log(`  status:  ${scorecard.status}`);
    console.log(`  score:   ${scorecard.score}`);
    console.log(`  turns:   ${scorecard.turns}`);
    console.log(`  elapsed: ${scorecard.elapsed_ms} ms\n`);
    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(scorecard, null, 2));
      console.log(`Saved to ${outputPath}`);
    }
  } catch (e) {
    console.error(`\nFatal: ${e.message}`);
    process.exit(1);
  }
})();
