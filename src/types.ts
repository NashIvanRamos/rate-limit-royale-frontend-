// Shared data shapes. They mirror the backend contract (brief §1) and the backend's scenario types,
// so the browser and any server-side replay agree on the same shapes.

// ─── Defense config ──────────────────────────────────────────────────────────

export type Algorithm = "fixed" | "sliding" | "token";
export type KeyBy = "ip" | "user";

/** Where a round's rate-limit counters and login lockouts live: per node ("memory") or shared ("redis"). */
export type LimiterStore = "memory" | "redis";

export interface DefenseConfig {
  algorithm: Algorithm;
  maxRequests: number;
  windowMs: number;
  keyBy: KeyBy;
  /**
   * Per-round limiter store (backend tasks2/09). Only sent when the backend advertises both stores; older backends
   * reject unknown fields. The deploy response always echoes the effective value.
   */
  limiterStore?: LimiterStore;
}

export const ALGORITHMS: readonly Algorithm[] = ["fixed", "sliding", "token"];
export const KEY_BY: readonly KeyBy[] = ["ip", "user"];

/** Same ranges the backend validates (POST /api/defense). The UI clamps to these, so it can't build an invalid config. */
export const CONFIG_LIMITS = Object.freeze({
  maxRequests: Object.freeze({ min: 5, max: 100 }),
  windowMs: Object.freeze({ min: 1_000, max: 60_000 }),
});

/** One entry of a 400 `invalid_config` response's `details[]`. */
export interface ValidationIssue {
  field: string;
  message: string;
}

// ─── Clients and scenario events ─────────────────────────────────────────────

export type AuthType = "none" | "login" | "forged" | "algNone" | "expired" | "garbage";

export interface ClientSpec {
  id: string;
  /** Simulated client IP, sent as X-Forwarded-For. */
  ip: string;
  legit: boolean;
  /** `username` is required for login/expired, and used as `sub` for forged/algNone. */
  auth: { type: AuthType; username?: string };
  /** "Attacker", "Token forger", …, shown in results. */
  label?: string;
}

export type ApiPath = "/api/resource" | "/api/login";

export interface LoginBody {
  username: string;
  password: string;
}

export interface ScenarioEvent {
  /** Planned offset in ms from the start of firing. */
  at: number;
  clientId: string;
  path: ApiPath;
  /** Only for POST /api/login events. */
  body?: LoginBody;
}

export interface ScenarioCtx {
  config: DefenseConfig;
  /** From the deploy response. Fixed-window boundaries are at windowEpochMs + k × windowMs. */
  windowEpochMs: number;
  /** Date.now() taken immediately before build(). */
  startAt: number;
}

export type RoundId = 1 | 2 | 3 | 4 | 5;

export interface Scenario {
  id: RoundId;
  name: string;
  description: string;
  lesson: string;
  hint?: string;
  clients: ClientSpec[];
  /** Briefing default only. The real duration comes from build(). */
  durationMs: number;
  build: (ctx: ScenarioCtx) => ScenarioEvent[];
}

// ─── Results ─────────────────────────────────────────────────────────────────

export interface RequestRecord extends ScenarioEvent {
  legit: boolean;
  /** HTTP status, or 0 for a network error. */
  status: number;
  /** body.reason ?? body.error (e.g. "invalid_signature", "rate_limited", "invalid_credentials"). */
  reason?: string;
  latencyMs: number;
  /** Server time from a 200 /api/resource body. */
  servedAt?: number;
  /** Actual ms from the start of firing when the request left (timers drift, so this isn't `at`). */
  sentAt: number;
  /** X-Node-Id of the backend node that answered ("single" on one node). */
  nodeId?: string;
  /** X-Node-Port: the port of the node that answered (where NGINX routed it). Backend tasks2/10+. */
  nodePort?: number;
  /** Served with `X-RateLimit-Degraded: true`: the limiter's store was down and the request was not rate limited. */
  degraded?: true;
}

export interface StatusCounts {
  s200: number;
  s429: number;
  s401: number;
}

export interface Tally {
  accepted: number;
  blocked: number;
  rejectedAuth: number;
  errors: number;
  total: number;
  avgLatencyMs: number;
  /** Legit 429s: the only thing that costs XP. */
  legitBlocks: number;
  /** Legit 401s (expired token): reported, never penalised. */
  legitExpired: number;
  attackTotal: number;
  attackStopped: number;
  attackPassed: number;
  /** Requests served without rate limiting because the store was down (fail open). Still counted as accepted. */
  degraded: number;
  /** Non-200 outcomes by reason: 401 reasons, "rate_limited", "invalid_credentials", "network", … */
  byReason: Record<string, number>;
  byClient: Record<string, StatusCounts>;
  /** Per endpoint, so login 429s (credential stuffing) stay distinct from resource 429s. */
  byPath: Record<ApiPath, StatusCounts>;
  /** Answered requests per backend node (X-Node-Id). One key ("single") on a single node. */
  byNode: Record<string, number>;
  /** The port each node reported (X-Node-Port), when the backend sends it. */
  nodePorts: Record<string, number>;
  /** Attacker requests per backend node: the scaling story (spread by round robin, pinned by sticky routing). */
  attackByNode: Record<string, number>;
  /** Attacker requests that passed (200), per backend node. */
  attackPassedByNode: Record<string, number>;
}

/** One response in the live feed (newest first). */
export interface FeedItem {
  /** Order of arrival, unique within a round (React key). */
  seq: number;
  clientId: string;
  status: number;
  reason?: string;
  nodeId?: string;
  nodePort?: number;
}

/** Round 2: attacker requests around the window boundary the bursts aimed at. */
export interface BoundaryTimeline {
  /** One per attacker request: ms relative to the boundary (negative = before) and its status. */
  points: Array<{ t: number; status: number }>;
}

/** Client tally vs the server's own counts (GET /api/stats). */
export interface CrossCheck {
  resource: { client: StatusCounts; server: StatusCounts; match: boolean };
  /** Only when the round sent /api/login events (round 4). Server counts exclude setup logins. */
  login?: { client: StatusCounts; server: StatusCounts; match: boolean };
  /** Limiter keys the server holds, and how many of them belong to legit clients. */
  trackedKeys: number;
  /** Stats summed over this many cluster nodes (memory-mode cluster). 1 = a single /api/stats. */
  nodes: number;
  /**
   * Set when `trackedKeys` is one node's own count: a per-node ("memory") round on a Redis-backed cluster, where
   * request counts are cluster-wide but there's no shared key set.
   */
  keysNode?: string;
  legitKeys: number;
}

export interface RoundResult {
  round: RoundId;
  config: DefenseConfig;
  tally: Tally;
  xp: number;
  cleared: boolean;
  containment: number;
  allowance: number;
  durationMs: number;
  timeline?: BoundaryTimeline;
  crossCheck?: CrossCheck;
  /** Why there's no cross-check, e.g. a memory-mode cluster where one node's stats are only its own slice. */
  crossCheckNote?: string;
  /** The round's last responses (newest first), kept for the results screen. */
  feed?: FeedItem[];
  /** Set when the round ran behind a load balancer (X-Node-Id other than "single"). `store` = the round's limiter store. */
  cluster?: { store: LimiterStore };
}
