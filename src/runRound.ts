// Runs one full round in the required order (brief §3): deploy → setup → build → fire → drain.
// The debug panel and the real UI both use this, so there is one code path for a round.

import {
  API_NODE_COUNT,
  CLIENT_ERRORS,
  deploy,
  expiredToken,
  login,
  passwordFor,
  stats,
  type ApiResult,
  type DefenseSnapshot,
  type LimiterStore,
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

/**
 * The backend's shared store (Redis) is down: deploys and logins answer 503 store_unavailable until it
 * recovers. Nothing was fired.
 */
export class StoreUnavailableError extends Error {
  constructor(message = "Backend store unavailable") {
    super(message);
    this.name = "StoreUnavailableError";
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
  /** What the health check reported. On a memory-mode cluster with known nodes, deploy and stats fan out. */
  server?: { nodeId?: string; store?: LimiterStore };
}

/**
 * A memory-mode cluster keeps state per node, and a deploy through the load balancer reaches only one node.
 * With the node addresses known (API_NODES), deploy to every node and add up their stats, like the backend's
 * own `npm run experiment`. In Redis mode one deploy and one /api/stats already cover the whole cluster.
 */
export function controlFanOut(server?: RunRoundOptions["server"]): number {
  const memoryCluster = server?.store === "memory" && server.nodeId !== undefined && server.nodeId !== "single";
  return memoryCluster ? API_NODE_COUNT : 0;
}

/** Adds up per-node stats (memory-mode cluster: each node only counts its own traffic). */
function sumStats(all: StatsResponse[]): StatsResponse {
  const sum = (pick: (s: StatsResponse) => number) => all.reduce((n, s) => n + pick(s), 0);
  const byReason: Record<string, number> = {};
  for (const s of all) for (const [k, v] of Object.entries(s.resource.byReason)) byReason[k] = (byReason[k] ?? 0) + v;
  return {
    nodeId: `sum of ${all.length} nodes`,
    store: all[0]?.store,
    since: Math.min(...all.map((s) => s.since)),
    resource: {
      total: sum((s) => s.resource.total),
      s200: sum((s) => s.resource.s200),
      s401: sum((s) => s.resource.s401),
      s429: sum((s) => s.resource.s429),
      other: sum((s) => s.resource.other),
      byReason,
    },
    login: {
      total: sum((s) => s.login.total),
      s200: sum((s) => s.login.s200),
      s400: sum((s) => s.login.s400),
      s401: sum((s) => s.login.s401),
      s429: sum((s) => s.login.s429),
      other: sum((s) => s.login.other),
    },
    trackedKeys: sum((s) => s.trackedKeys),
  };
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
  /** Cluster nodes the deploy and stats fanned out to (0 = one deploy, one /api/stats). */
  fanOut: number;
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
/** 503 from a distributed backend whose Redis store is down. */
function isStoreDown<T>(res: ApiResult<T>): boolean {
  return !res.ok && res.status === 503;
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
        failure = isNetwork(res)
          ? new OfflineError()
          : isStoreDown(res)
            ? new StoreUnavailableError(`Login for ${username} refused: 503 ${res.error.error}`)
            : new SetupError(c, endpoint, res.status, res.error.reason ?? res.error.error);
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
export async function runRound({ scenario, config, onStage, onProgress, signal, server }: RunRoundOptions): Promise<RoundRun> {
  validateClients(scenario.clients);
  throwIfAborted(signal);

  // 1. Deploy. Always before setup: it clears the previous round's login lockouts.
  onStage?.({ stage: "deploying" });
  const fanOut = controlFanOut(server);
  const nodes = Array.from({ length: fanOut }, (_, i) => i + 1);
  // Fan-out: every node must accept the deploy. Report the first failure. The first node's snapshot (window
  // epoch) is used for timing; the nodes deploy within a few ms of each other.
  const deploys = fanOut > 0 ? await Promise.all(nodes.map((n) => deploy(config, signal, n))) : [await deploy(config, signal)];
  const dep = deploys.find((d) => !d.ok) ?? deploys[0]!;
  if (!dep.ok) {
    if (isAborted(dep)) throw new RoundAbortedError();
    if (isNetwork(dep)) throw new OfflineError();
    if (isStoreDown(dep)) throw new StoreUnavailableError(`Deploy refused: 503 ${dep.error.error}`);
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
  const statsRes = fanOut > 0 ? await Promise.all(nodes.map((n) => stats(signal, n))) : [await stats(signal)];
  throwIfAborted(signal);
  const okStats = statsRes.flatMap((r) => (r.ok ? [r.data] : []));
  // Every node must answer, or a summed tally would be short.
  const serverStats = okStats.length !== statsRes.length ? undefined : fanOut > 0 ? sumStats(okStats) : okStats[0];

  return { records, events, deployed, startAt, durationMs, serverStats, fanOut };
}

/**
 * Events for the briefing tiles (request count, client IPs, duration) before anything is deployed.
 * Uses a fake ctx (windowEpochMs = startAt = now), so round 2's numbers are an estimate.
 */
export function previewEvents(scenario: Scenario, config: DefenseConfig): ScenarioEvent[] {
  const now = Date.now();
  return sortEvents(scenario.build({ config, windowEpochMs: now, startAt: now }));
}
