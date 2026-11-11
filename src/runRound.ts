// Runs one full round in the required order (brief §3): deploy → setup → build → fire → drain.
// The debug panel and the real UI both use this, so there is one code path for a round.

import {
  CLIENT_ERRORS,
  deploy,
  expiredToken,
  login,
  passwordFor,
  stats,
  type ApiResult,
  type DefenseSnapshot,
  type StatsResponse,
} from "./api";
import { runScenario, type FiringProgress } from "./scheduler";
import { algNoneToken, forgedToken, garbageToken } from "./tokens";
import type { ClientSpec, DefenseConfig, RequestRecord, Scenario, ScenarioEvent, ValidationIssue } from "./types";

// ─── Stages ──────────────────────────────────────────────────────────────────

export type Stage = "deploying" | "logging-in" | "waiting-boundary" | "firing" | "draining";

export type StageEvent =
  | { stage: "deploying" }
  /** Setup logins and expired-token fetches. Reported again after each one completes. */
  | { stage: "logging-in"; done: number; total: number }
  /** The first attacker request is still far off (round 2 aiming at a window boundary). */
  | { stage: "waiting-boundary"; /** Date.now() time at which the first attacker request fires. */ firesAt: number }
  | { stage: "firing" }
  /** Every request has been sent. Waiting for the last responses. */
  | { stage: "draining" };

/** If the first attacker request is further away than this, report "waiting-boundary" first. */
export const WAIT_STAGE_THRESHOLD_MS = 1_500;
/** Concurrent setup requests. Keeps round 5's 50 logins from spiking latency. */
export const SETUP_CONCURRENCY = 6;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** POST /api/defense rejected the config (400). Nothing was fired. */
export class DeployError extends Error {
  readonly status: number;
  readonly details: ValidationIssue[];
  constructor(status: number, details: ValidationIssue[], message?: string) {
    super(message ?? `Deploy rejected (${status})${details.length ? `: ${details.map((d) => `${d.field} ${d.message}`).join("; ")}` : ""}`);
    this.name = "DeployError";
    this.status = status;
    this.details = details;
  }
}

/** The backend is unreachable. */
export class OfflineError extends Error {
  constructor(message = "Backend offline") {
    super(message);
    this.name = "OfflineError";
  }
}

/** A setup request failed, so the round would run with missing tokens. Nothing was fired. */
export class SetupError extends Error {
  readonly clientId: string;
  readonly username: string;
  readonly status: number;
  /** "/api/login" or "/api/demo/expired-token". A 404 on the demo endpoint means DEMO_MODE is off. */
  readonly endpoint: string;
  readonly reason?: string;
  constructor(client: ClientSpec, endpoint: string, status: number, reason?: string) {
    const username = client.auth.username ?? client.id;
    super(`Login for ${username} failed: ${status}${reason ? ` ${reason}` : ""}`);
    this.name = "SetupError";
    this.clientId = client.id;
    this.username = username;
    this.status = status;
    this.endpoint = endpoint;
    this.reason = reason;
  }
}

/** The caller aborted the round. No result should be recorded. */
export class RoundAbortedError extends Error {
  constructor() {
    super("Round aborted");
    this.name = "RoundAbortedError";
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export interface RunRoundOptions {
  scenario: Scenario;
  config: DefenseConfig;
  onStage?: (event: StageEvent) => void;
  onProgress?: (progress: FiringProgress) => void;
  signal?: AbortSignal;
}

export interface RoundRun {
  records: RequestRecord[];
  /** Sorted by `at`. */
  events: ScenarioEvent[];
  deployed: DefenseSnapshot;
  /** Date.now() taken immediately before build(). */
  startAt: number;
  /** Scripted length: the last event's `at` (0 when there are no events). */
  durationMs: number;
  /** The server's own tally after drain, for the cross-check. Undefined if unavailable. */
  serverStats?: StatsResponse;
}

const clientMap = (clients: ClientSpec[]) => Object.fromEntries(clients.map((c) => [c.id, c]));

/** Programming errors in a scenario. Checked before deploying, so a bad scenario changes nothing. */
function validateClients(clients: ClientSpec[]): void {
  const seen = new Set<string>();
  for (const c of clients) {
    if (seen.has(c.id)) throw new Error(`Scenario has duplicate client id "${c.id}"`);
    seen.add(c.id);
    const needsUser = c.auth.type === "login" || c.auth.type === "expired" || c.auth.type === "forged" || c.auth.type === "algNone";
    if (needsUser && !c.auth.username) throw new Error(`Client "${c.id}" (${c.auth.type}) needs auth.username`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RoundAbortedError();
}

/** Maps a failed setup or deploy response to the right error type. */
function isNetwork<T>(res: ApiResult<T>): boolean {
  return !res.ok && res.status === 0 && res.error.error === CLIENT_ERRORS.network;
}
function isAborted<T>(res: ApiResult<T>): boolean {
  return !res.ok && res.status === 0 && res.error.error === CLIENT_ERRORS.aborted;
}

/** Builds every client's token. Server calls run with limited concurrency and stop at the first failure. */
async function setupTokens(
  clients: ClientSpec[],
  onStage: RunRoundOptions["onStage"],
  signal?: AbortSignal,
): Promise<Record<string, string | undefined>> {
  const tokens: Record<string, string | undefined> = {};
  const remote: ClientSpec[] = [];

  for (const c of clients) {
    const username = c.auth.username!;
    switch (c.auth.type) {
      case "login":
      case "expired":
        remote.push(c);
        break;
      case "forged":
        tokens[c.id] = forgedToken(username);
        break;
      case "algNone":
        tokens[c.id] = algNoneToken(username);
        break;
      case "garbage":
        tokens[c.id] = garbageToken();
        break;
      case "none":
        tokens[c.id] = undefined;
        break;
    }
  }

  const total = remote.length;
  let done = 0;
  onStage?.({ stage: "logging-in", done, total });
  if (total === 0) return tokens;

  // Stops the other workers' in-flight requests on the first failure, and follows the caller's abort.
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  let next = 0;
  let failure: Error | undefined;

  const worker = async () => {
    while (!failure && !stop.signal.aborted && next < total) {
      const c = remote[next++]!;
      const username = c.auth.username!;
      const isExpired = c.auth.type === "expired";
      const endpoint = isExpired ? "/api/demo/expired-token" : "/api/login";
      const res = isExpired
        ? await expiredToken(username, passwordFor(username), c.ip, stop.signal)
        : await login(username, passwordFor(username), c.ip, stop.signal);

      if (res.ok) {
        tokens[c.id] = res.data.token;
        done += 1;
        onStage?.({ stage: "logging-in", done, total });
      } else if (!isAborted(res) && !failure) {
        failure = isNetwork(res) ? new OfflineError() : new SetupError(c, endpoint, res.status, res.error.reason ?? res.error.error);
        stop.abort();
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(SETUP_CONCURRENCY, total) }, worker));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  throwIfAborted(signal);
  if (failure) throw failure;
  return tokens;
}

function sortEvents(events: ScenarioEvent[]): ScenarioEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/**
 * Deploy → setup (not tallied) → build → fire → drain.
 * Throws DeployError, OfflineError, SetupError or RoundAbortedError. Nothing is fired unless deploy and
 * setup both succeed. Start it from a click handler only, never from an effect (StrictMode runs effects twice).
 */
export async function runRound({ scenario, config, onStage, onProgress, signal }: RunRoundOptions): Promise<RoundRun> {
  validateClients(scenario.clients);
  throwIfAborted(signal);

  // 1. Deploy. Always before setup: it clears the previous round's login lockouts.
  onStage?.({ stage: "deploying" });
  const dep = await deploy(config, signal);
  if (!dep.ok) {
    if (isAborted(dep)) throw new RoundAbortedError();
    if (isNetwork(dep)) throw new OfflineError();
    throw new DeployError(dep.status, dep.error.details ?? [], dep.status === 400 ? undefined : `Deploy failed (${dep.status} ${dep.error.error})`);
  }
  const deployed = dep.data;

  // 2. Setup.
  const tokens = await setupTokens(scenario.clients, onStage, signal);
  throwIfAborted(signal);

  // 3. Build, immediately before firing, so wall-clock offsets (round 2's boundary) still line up.
  const startAt = Date.now();
  const events = sortEvents(scenario.build({ config: deployed.config, windowEpochMs: deployed.windowEpochMs, startAt }));
  const clients = clientMap(scenario.clients);
  const durationMs = events.length > 0 ? events[events.length - 1]!.at : 0;

  // 4. Waiting for the boundary? Legit traffic still runs during the wait.
  const firstAttackAt = events.find((e) => clients[e.clientId] && !clients[e.clientId]!.legit)?.at;
  let firingTimer: ReturnType<typeof setTimeout> | undefined;
  let drained = false;
  if (firstAttackAt !== undefined && firstAttackAt > WAIT_STAGE_THRESHOLD_MS) {
    onStage?.({ stage: "waiting-boundary", firesAt: startAt + firstAttackAt });
    firingTimer = setTimeout(() => {
      if (!drained) onStage?.({ stage: "firing" });
    }, firstAttackAt);
  } else {
    onStage?.({ stage: "firing" });
  }

  // 5. Fire, then drain.
  let records: RequestRecord[];
  try {
    records = await runScenario({
      events,
      clients,
      tokens,
      onProgress,
      signal,
      onAllFired: () => {
        drained = true;
        if (firingTimer !== undefined) clearTimeout(firingTimer);
        onStage?.({ stage: "draining" });
      },
    });
  } finally {
    if (firingTimer !== undefined) clearTimeout(firingTimer);
  }
  throwIfAborted(signal);

  // 6. Server cross-check (optional). Every response has finished by now, so the server's counts are
  // complete. A failure here must never fail the round.
  const statsRes = await stats(signal);
  throwIfAborted(signal);
  const serverStats = statsRes.ok ? statsRes.data : undefined;

  return { records, events, deployed, startAt, durationMs, serverStats };
}

/**
 * Events for the briefing tiles (request count, client IPs, duration) before anything is deployed.
 * Uses a fake ctx (windowEpochMs = startAt = now), so round 2's numbers are an estimate.
 */
export function previewEvents(scenario: Scenario, config: DefenseConfig): ScenarioEvent[] {
  const now = Date.now();
  return sortEvents(scenario.build({ config, windowEpochMs: now, startAt: now }));
}
