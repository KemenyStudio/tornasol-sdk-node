/**
 * Type declarations for @kemeny/tornasol.
 * The implementation is plain JS; these typings exist so TS users get
 * autocomplete without us paying a build step.
 */

export type RunStatus =
  | 'in_progress'
  | 'won'
  | 'lost'
  | 'errored'
  | 'gave_up'
  | 'expired';

export interface RenderSpec {
  primitive: 'grid' | 'text' | 'form' | 'choices' | 'image' | 'composite';
  data: unknown;
}

export interface TurnResult {
  effect?: string;
  error?: string;
}

export interface Observation {
  run_id: string;
  engine: string;
  turn: number;
  status: RunStatus;
  payload: unknown;
  render?: RenderSpec;
  last_action?: unknown;
  last_result?: TurnResult;
}

export interface Scorecard {
  run_id: string;
  engine: string;
  status: RunStatus;
  score: number;
  turns: number;
  elapsed_ms: number;
  details?: unknown;
  ended_at: string;
}

export interface StartRunResponse {
  run_id: string;
  engine: string;
  agent_hash?: string;
  observation: Observation;
}

export interface ActionResponse {
  observation: Observation;
  result: TurnResult;
  done: boolean;
  scorecard?: Scorecard;
}

export interface SubmitResponse {
  id: string;
  agent_hash: string;
  blob_ref: string;
  files: number;
  bytes_in: number;
  reused_hash: boolean;
  matching_runs: string[];
  notes?: string;
}

export interface AgentFile {
  path: string;
  content: Buffer | Uint8Array | string;
}

export interface ClientOptions {
  baseURL?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class TornasolError extends Error {
  statusCode: number;
  serverMessage: string;
}

export class TornasolClient {
  baseURL: string;
  apiKey: string;
  userAgent: string;

  constructor(opts?: ClientOptions);

  startRun(opts?: {
    config?: unknown;
    agentFiles?: AgentFile[];
  }): Promise<StartRunResponse>;

  action(runId: string, actionPayload: unknown): Promise<ActionResponse>;

  scorecard(runId: string): Promise<Scorecard>;

  submit(opts: {
    files: AgentFile[];
    runId?: string;
    notes?: string;
  }): Promise<SubmitResponse>;
}

export type ChooseAction = (obs: Observation) => unknown | Promise<unknown>;

export interface RunAgentOptions extends ClientOptions {
  client?: TornasolClient;
  config?: unknown;
  agentFiles?: AgentFile[];
  onTurn?: (obs: Observation, result: TurnResult, done: boolean) => void;
}

export function runAgent(
  chooseAction: ChooseAction,
  opts: RunAgentOptions
): Promise<Scorecard>;

/** Canonical sha256 hash of a set of agent files. Order-independent and
 *  stable: the same set of (path, content) always yields the same hash. */
export function hashAgentFiles(files: AgentFile[]): {
  hash: string;
  files: { path: string; content: Buffer }[];
};
