// Game state and reducer (brief §3, §7). Transitions not listed for the current phase are ignored,
// which also guards against double clicks.
//
//   briefing ──CONTINUE──▶ configuring ──DEPLOY_START──▶ firing ──ROUND_COMPLETE──▶ results ──NEXT_ROUND──▶ briefing
//                              ▲                            │                          │      (after round 5 → summary)
//                              ├──────ROUND_FAILED──────────┘                          │
//                              └──────RETRY_ROUND (replaces this round's result)───────┘
//                                                                                    summary ──RESTART──▶ briefing

import type { LimiterStore } from "./api";
import type { StageEvent, Stage } from "./runRound";
import type { FeedItem, FiringProgress, LiveCounts } from "./scheduler";
import { ROUND_COUNT } from "./scenarios";
import { CONFIG_LIMITS, type DefenseConfig, type RoundId, type RoundResult, type StatusCounts, type ValidationIssue } from "./types";

export type Phase = "briefing" | "configuring" | "firing" | "results" | "summary";

export interface FiringState {
  stage: Stage | null;
  /** Setup logins (logging-in stage). */
  setupDone: number;
  setupTotal: number;
  /** Scenario responses received / requests in the script. */
  done: number;
  total: number;
  counts: LiveCounts;
  /** Live per-client counts (round 5's keys panel). */
  byClient: Record<string, StatusCounts>;
  /** Latest responses for the live feed, newest first. */
  recent: FeedItem[];
  /** waiting-boundary only: Date.now() time the first attacker request fires. */
  firesAt?: number;
}

export type AppErrorKind = "offline" | "degraded" | "invalid_config" | "setup" | "unknown";

/** checking until the first health answer; degraded = Redis store down (deploys would 503). */
export type ServerHealth = "checking" | "online" | "degraded" | "offline";

export interface ServerState {
  status: ServerHealth;
  /** "single", or "node-1".."node-3" behind the cluster's load balancer. */
  nodeId?: string;
  store?: LimiterStore;
  failureMode?: "open" | "closed";
  /** Limiter stores the backend can run a round on. Both = show the per-round toggle. */
  limiterStores?: LimiterStore[];
}

export interface AppError {
  kind: AppErrorKind;
  message: string;
  /** invalid_config only: the server's 400 details[]. */
  details?: ValidationIssue[];
}

export interface State {
  round: RoundId;
  /** Total XP. */
  score: number;
  phase: Phase;
  /** Persists between rounds: the player tweaks it rather than starting over. */
  config: DefenseConfig;
  firing: FiringState;
  results: RoundResult | null;
  history: RoundResult[];
  server: ServerState;
  error: AppError | null;
}

export type Action =
  | { type: "CONTINUE" }
  | { type: "SET_CONFIG"; config: Partial<DefenseConfig> }
  | { type: "DEPLOY_START" }
  | { type: "FIRING_STAGE"; event: StageEvent }
  | { type: "FIRING_PROGRESS"; progress: FiringProgress }
  | { type: "ROUND_COMPLETE"; result: RoundResult }
  /** error null = the player aborted: back to configuring with no message. */
  | { type: "ROUND_FAILED"; error: AppError | null }
  | { type: "NEXT_ROUND" }
  /** Replay the current round: its XP and history entry are removed, so only the last attempt counts. */
  | { type: "RETRY_ROUND" }
  | { type: "RESTART" }
  | { type: "SERVER_STATUS"; server: ServerState }
  | { type: "DISMISS_ERROR" };

/**
 * The per-round "shared limiter state" toggle only makes sense behind a load balancer, on a backend that can run a
 * round on either store (Redis-backed, tasks2/09). On one node both stores behave the same.
 */
export function canToggleLimiterStore(server: ServerState): boolean {
  const stores = server.limiterStores ?? [];
  return server.nodeId !== undefined && server.nodeId !== "single" && stores.includes("memory") && stores.includes("redis");
}

export const INITIAL_CONFIG: DefenseConfig = { algorithm: "fixed", maxRequests: 10, windowMs: 10_000, keyBy: "ip" };

const emptyFiring = (): FiringState => ({
  stage: null,
  setupDone: 0,
  setupTotal: 0,
  done: 0,
  total: 0,
  counts: { s200: 0, s429: 0, s401: 0, errors: 0 },
  byClient: {},
  recent: [],
});

export const initialState: State = {
  round: 1,
  score: 0,
  phase: "briefing",
  config: INITIAL_CONFIG,
  firing: emptyFiring(),
  results: null,
  history: [],
  server: { status: "checking" },
  error: null,
};

const clampInt = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(v)));

/** Keeps every value inside the backend's accepted ranges, so the UI can't build an invalid config. */
export function clampConfig(config: DefenseConfig): DefenseConfig {
  return {
    algorithm: config.algorithm,
    keyBy: config.keyBy,
    ...(config.limiterStore ? { limiterStore: config.limiterStore } : {}),
    maxRequests: clampInt(config.maxRequests, CONFIG_LIMITS.maxRequests),
    // The UI works in whole seconds; the backend takes ms.
    windowMs: clampInt(config.windowMs / 1000, { min: CONFIG_LIMITS.windowMs.min / 1000, max: CONFIG_LIMITS.windowMs.max / 1000 }) * 1000,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CONTINUE":
      return state.phase === "briefing" ? { ...state, phase: "configuring" } : state;

    case "SET_CONFIG":
      if (state.phase !== "briefing" && state.phase !== "configuring") return state;
      return { ...state, config: clampConfig({ ...state.config, ...action.config }) };

    case "DEPLOY_START":
      if (state.phase !== "configuring" || state.server.status !== "online") return state;
      return { ...state, phase: "firing", firing: emptyFiring(), error: null, results: null };

    case "FIRING_STAGE": {
      if (state.phase !== "firing") return state;
      const e = action.event;
      const firing: FiringState = { ...state.firing, stage: e.stage, firesAt: undefined };
      if (e.stage === "logging-in") {
        firing.setupDone = e.done;
        firing.setupTotal = e.total;
      } else if (e.stage === "waiting-boundary") {
        firing.firesAt = e.firesAt;
      }
      return { ...state, firing };
    }

    case "FIRING_PROGRESS": {
      if (state.phase !== "firing") return state;
      const { done, total, counts, byClient, recent } = action.progress;
      return { ...state, firing: { ...state.firing, done, total, counts, byClient, recent } };
    }

    case "ROUND_COMPLETE":
      if (state.phase !== "firing") return state;
      return {
        ...state,
        phase: "results",
        score: state.score + action.result.xp,
        results: action.result,
        history: [...state.history, action.result],
      };

    case "ROUND_FAILED":
      if (state.phase !== "firing") return state;
      return { ...state, phase: "configuring", firing: emptyFiring(), error: action.error };

    case "NEXT_ROUND":
      if (state.phase !== "results") return state;
      if (state.round >= ROUND_COUNT) return { ...state, phase: "summary" };
      return { ...state, phase: "briefing", round: (state.round + 1) as RoundId, results: null, error: null };

    case "RETRY_ROUND":
      if (state.phase !== "results" || !state.results) return state;
      return {
        ...state,
        phase: "configuring",
        score: state.score - state.results.xp,
        history: state.history.slice(0, -1),
        results: null,
        firing: emptyFiring(),
      };

    case "RESTART":
      if (state.phase !== "summary") return state;
      return { ...initialState, config: state.config, server: state.server };

    case "SERVER_STATUS": {
      const a = action.server;
      const b = state.server;
      const same =
        a.status === b.status &&
        a.nodeId === b.nodeId &&
        a.store === b.store &&
        a.failureMode === b.failureMode &&
        (a.limiterStores ?? []).join() === (b.limiterStores ?? []).join();
      return same ? state : { ...state, server: a };
    }

    case "DISMISS_ERROR":
      return state.error ? { ...state, error: null } : state;
  }
}
