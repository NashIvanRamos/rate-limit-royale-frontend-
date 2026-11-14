// Demo mode (open the app with ?demo=1): a short 2-round game for the video, and every round sets itself up, so the
// presenter only clicks Continue, Deploy and Retry while explaining. Each Retry applies the round's next preset; past
// the end, the last one stays. Presets are just applied: every setting stays editable. Normal play keeps all 5 rounds.

import { ALGORITHM_NAMES, formatWindow, KEY_BY_NAMES, LIMITER_STORE_NAMES } from "./labels";
import type { DefenseConfig, RoundId } from "./types";

const fixed = (windowMs: number, keyBy: DefenseConfig["keyBy"], limiterStore: DefenseConfig["limiterStore"] = "redis"): DefenseConfig => ({
  algorithm: "fixed",
  maxRequests: 10,
  windowMs,
  keyBy,
  limiterStore,
});

export const DEMO_PRESETS: Readonly<Record<RoundId, readonly DefenseConfig[]>> = {
  // Round 1: any algorithm contains a steady flood.
  1: [fixed(10_000, "ip")],
  // Round 2: fixed window lets ~2x through at the boundary; sliding doesn't; token allows a little refill.
  2: [fixed(3_000, "ip"), { ...fixed(3_000, "ip"), algorithm: "sliding" }, { ...fixed(3_000, "ip"), algorithm: "token" }],
  // Round 3: token bucket (burst, then refill) vs sliding (strict per window).
  3: [
    { ...fixed(1_000, "ip"), algorithm: "token" },
    { ...fixed(1_000, "ip"), algorithm: "sliding" },
  ],
  // Round 4: the defense barely matters; auth runs before the limiter.
  4: [fixed(10_000, "ip")],
  // Round 5: key by user leaks 50 budgets; key by IP holds; then the cluster story (per node vs shared).
  5: [fixed(10_000, "user"), fixed(10_000, "ip"), fixed(10_000, "ip", "memory"), fixed(10_000, "ip")],
};

/**
 * The demo's rounds, in order: Edge Exploit (the algorithm trade-offs) and the Account-Rotation Boss Wave (keying,
 * then the cluster). They keep the game's own round numbers and briefings.
 */
export const DEMO_ROUNDS: readonly RoundId[] = [2, 5];
const ALL_ROUNDS: readonly RoundId[] = [1, 2, 3, 4, 5];

/** The rounds this game plays, in order. */
export const roundSequence = (demo: boolean): readonly RoundId[] => (demo ? DEMO_ROUNDS : ALL_ROUNDS);

/** "Round 1 of 2" in demo mode: where `round` sits in the sequence (1-based) and how many rounds there are. */
export function roundPosition(round: RoundId, demo: boolean): { index: number; total: number } {
  const seq = roundSequence(demo);
  return { index: Math.max(0, seq.indexOf(round)) + 1, total: seq.length };
}

/** The URL flag that turns presets on: http://localhost:5174/?demo=1 */
export function isDemoUrl(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
}

/** Preset for a round's attempt (0 = first deploy, 1 = first retry, …). Past the end of the list, the last one. */
export function demoPreset(round: RoundId, attempt: number): DefenseConfig {
  const list = DEMO_PRESETS[round];
  return { ...list[Math.min(attempt, list.length - 1)]! };
}

/** "Sliding Window · 10 per 3s · Key by IP · Shared (Redis)". The store is only named where it can apply. */
export function presetLabel(c: DefenseConfig, withStore: boolean): string {
  const parts = [ALGORITHM_NAMES[c.algorithm], `${c.maxRequests} per ${formatWindow(c.windowMs)}`, KEY_BY_NAMES[c.keyBy]];
  if (withStore && c.limiterStore) parts.push(LIMITER_STORE_NAMES[c.limiterStore]);
  return parts.join(" · ");
}

/** What the next Retry changes, e.g. "Retry with Sliding Window" or "Retry with Per node". */
export function retryLabel(round: RoundId, attempt: number, withStore: boolean): string {
  const list = DEMO_PRESETS[round];
  if (attempt + 1 >= list.length) return "Retry with the same defense";
  const now = demoPreset(round, attempt);
  const next = demoPreset(round, attempt + 1);
  const changes: string[] = [];
  if (next.algorithm !== now.algorithm) changes.push(ALGORITHM_NAMES[next.algorithm]);
  if (next.maxRequests !== now.maxRequests || next.windowMs !== now.windowMs) changes.push(`${next.maxRequests} per ${formatWindow(next.windowMs)}`);
  if (next.keyBy !== now.keyBy) changes.push(KEY_BY_NAMES[next.keyBy]);
  if (withStore && next.limiterStore !== now.limiterStore && next.limiterStore) changes.push(LIMITER_STORE_NAMES[next.limiterStore]);
  return changes.length ? `Retry with ${changes.join(" · ")}` : "Retry with the same defense";
}
