# @kemeny/tornasol

Official Node SDK for [tornasol](https://tornasol.kemenylabs.com/) - the turn-based assessment platform.

```bash
npm install @kemeny/tornasol
```

Node 18+ required (uses the built-in `fetch`). Zero runtime dependencies.

## Quick start

```js
const { runAgent } = require('@kemeny/tornasol');

runAgent(
  (observation) => ({ direction: 'right' }),
  { apiKey: process.env.TORNASOL_API_KEY },
).then((scorecard) => {
  console.log(scorecard.score, scorecard.turns);
});
```

## CLI

```bash
# Run an agent file (must export chooseAction)
TORNASOL_API_KEY=k_... npx tornasol-run-agent --agent ./agent.js

# Submit as final answer
TORNASOL_API_KEY=k_... npx tornasol-submit-agent --agent ./agent.js --notes "v3"
```

## Programmatic API

```js
const { TornasolClient } = require('@kemeny/tornasol');

const client = new TornasolClient({
  baseURL: 'https://tornasol-api.kemenylabs.com',
  apiKey:  process.env.TORNASOL_API_KEY,
});

// Optional: bind a canonical hash of your code to this run; a later
// submission with the same files will link back via matching_runs.
const fs = require('fs');
const run = await client.startRun({
  agentFiles: [{ path: 'agent.js', content: fs.readFileSync('./agent.js') }],
});

// Loop turns
let obs = run.observation;
while (true) {
  const action = decideAction(obs);          // your logic
  const r = await client.action(run.run_id, action);
  if (r.done) { console.log(r.scorecard); break; }
  obs = r.observation;
}
```

## Hash-based verification

The SDK computes a canonical `agent_hash` of your file set (`hashAgentFiles`) and sends it on `startRun` and `submit`. The server stores it and, on submit, returns the runs whose hash matches:

```js
const sub = await client.submit({
  files: [{ path: 'agent.js', content: fs.readFileSync('./agent.js') }],
});
console.log(sub.matching_runs); // ["run-abc", ...] - runs that used this exact code
```

The hash is order-independent and stable across runs: same files → same hash. The server never receives the source on `startRun`, only the hash; the bytes are uploaded once on `submit`.

## Tests

```bash
npm test
```

## License

MIT
