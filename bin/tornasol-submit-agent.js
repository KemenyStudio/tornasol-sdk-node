#!/usr/bin/env node
// tornasol-submit-agent: package and submit an agent as the candidate's
// final answer.
//
//   tornasol-submit-agent --agent ./agent.js [--root ./] [--notes "..."]

'use strict';

const fs = require('fs');
const path = require('path');
const { TornasolClient } = require('..');

const argv = process.argv.slice(2);
function flag(name, def) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; }
function has(name) { return argv.indexOf(name) >= 0; }

if (has('--help') || has('-h')) {
  console.log(`Usage: tornasol-submit-agent --agent <path> [options]

Options:
  --agent <path>      main agent file (required; always included)
  --root <dir>        directory to include (default: directory of --agent)
  --notes "..."       optional note for the evaluator (max 2000 chars)
  --run-id <id>       associate with a specific run
  --base-url <url>    server URL
  --dry-run           list files but don't submit

Env:
  TORNASOL_API_KEY    your API key
`);
  process.exit(0);
}

const agentPath = flag('--agent');
if (!agentPath) { console.error('Missing --agent'); process.exit(1); }
const agentAbs = path.resolve(agentPath);
if (!fs.existsSync(agentAbs)) { console.error(`Not found: ${agentAbs}`); process.exit(1); }

const root = path.resolve(flag('--root', path.dirname(agentAbs)));
const notes = flag('--notes', '');
const runId = flag('--run-id', process.env.TORNASOL_RUN_ID || '');
const baseURL = flag('--base-url');
const dryRun = has('--dry-run');

const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.idea', '.vscode', 'dist', 'build', '.next', '.turbo']);
const EXCLUDE_EXT  = new Set(['.zip', '.tgz', '.tar', '.gz', '.bz2', '.rar', '.7z', '.log']);
const MAX_FILE = 1024 * 1024;       // 1 MB
const MAX_TOTAL = 5 * 1024 * 1024;  // 5 MB

function* walk(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.env' || e.name === '.env.local') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      yield* walk(full, base);
    } else if (e.isFile()) {
      yield { abs: full, rel: rel.split(path.sep).join('/') };
    }
  }
}

console.log(`\n=== tornasol - submit agent ===`);
console.log(`agent: ${agentAbs}`);
console.log(`root:  ${root}\n`);

const files = [];
let total = 0;
let included = false;
for (const { abs, rel } of walk(root, root)) {
  const ext = path.extname(rel).toLowerCase();
  if (EXCLUDE_EXT.has(ext)) { console.log(`  · skip ${rel} (excluded ext)`); continue; }
  const size = fs.statSync(abs).size;
  if (size > MAX_FILE) { console.log(`  · skip ${rel} (${size} > ${MAX_FILE})`); continue; }
  if (total + size > MAX_TOTAL) { console.log(`  · skip ${rel} (total cap)`); continue; }
  total += size;
  files.push({ abs, rel });
  if (abs === agentAbs) included = true;
  console.log(`  + ${rel} (${size} B)`);
}
if (!included) {
  files.push({ abs: agentAbs, rel: path.basename(agentAbs) });
  total += fs.statSync(agentAbs).size;
  console.log(`  + ${path.basename(agentAbs)} (forced - outside --root)`);
}

console.log(`\ntotal: ${files.length} file(s), ${total} bytes`);
if (dryRun) { console.log('(dry-run: not sending)'); process.exit(0); }

(async () => {
  const client = new TornasolClient({ baseURL });
  try {
    const resp = await client.submit({
      files: files.map(f => ({ path: f.rel, content: fs.readFileSync(f.abs) })),
      runId: runId || undefined,
      notes,
    });
    console.log(`\n✓ submitted`);
    console.log(`  id:            ${resp.id}`);
    console.log(`  agent_hash:    ${resp.agent_hash}`);
    console.log(`  reused_hash:   ${resp.reused_hash}`);
    console.log(`  matching_runs: ${resp.matching_runs.length ? resp.matching_runs.join(', ') : '(none)'}\n`);
  } catch (e) {
    console.error(`\n✗ failed: ${e.message}`);
    process.exit(1);
  }
})();
