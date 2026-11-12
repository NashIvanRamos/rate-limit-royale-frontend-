// tally(): request records → the round's tally (brief §5).
// score(): tally → XP, containment and cleared (brief §6). Coefficients live in SCORING.

import type { ApiPath, DefenseConfig, RequestRecord, Scenario, ScenarioEvent, StatusCounts, Tally } from "./types";

const emptyCounts = (): StatusCounts => ({ s200: 0, s429: 0, s401: 0 });

/** Network failure (status 0) or any server error. Never accepted, never blocked. */
export const isError = (status: number) => status === 0 || status >= 500;

function bump(counts: StatusCounts, status: number): void {
  if (status === 200) counts.s200 += 1;
  else if (status === 429) counts.s429 += 1;
  else if (status === 401) counts.s401 += 1;
}

/**
 * Definitions are exact (brief §5):
 *   accepted = 200, blocked = 429, rejectedAuth = 401, errors = status 0 (network) or any 5xx (e.g. a 503
 *   limiter_unavailable from a fail-closed Redis outage): an error is never accepted or blocked
 *   legitBlocks  = legit && 429   ← the only thing that costs XP. A 401 is NEVER a legit block.
 *   legitExpired = legit && 401   ← reported, costs nothing
 *   attackTotal = !legit, attackStopped = !legit && (429 || 401), attackPassed = !legit && 200
 * Only scenario events are passed in: setup requests (deploy, logins, expired-token) are never tallied.
 */
export function tally(records: RequestRecord[]): Tally {
  const t: Tally = {
    accepted: 0,
    blocked: 0,
    rejectedAuth: 0,
    errors: 0,
    total: records.length,
    avgLatencyMs: 0,
    legitBlocks: 0,
    legitExpired: 0,
    attackTotal: 0,
    attackStopped: 0,
    attackPassed: 0,
    degraded: 0,
    byReason: {},
    byClient: {},
    byNode: {},
    attackByNode: {},
    attackPassedByNode: {},
    byPath: { "/api/resource": emptyCounts(), "/api/login": emptyCounts() } satisfies Record<ApiPath, StatusCounts>,
  };

  let latencySum = 0;
  let latencyCount = 0;

  for (const r of records) {
    const { status, legit } = r;

    if (status === 200) t.accepted += 1;
    else if (status === 429) t.blocked += 1;
    else if (status === 401) t.rejectedAuth += 1;
    else if (isError(status)) t.errors += 1;
    if (r.degraded) t.degraded += 1;
    if (r.nodeId) {
      t.byNode[r.nodeId] = (t.byNode[r.nodeId] ?? 0) + 1;
      if (!legit) t.attackByNode[r.nodeId] = (t.attackByNode[r.nodeId] ?? 0) + 1;
      if (!legit && status === 200) t.attackPassedByNode[r.nodeId] = (t.attackPassedByNode[r.nodeId] ?? 0) + 1;
    }

    if (legit) {
      if (status === 429) t.legitBlocks += 1;
      else if (status === 401) t.legitExpired += 1;
    } else {
      t.attackTotal += 1;
      if (status === 200) t.attackPassed += 1;
      else if (status === 429 || status === 401) t.attackStopped += 1;
    }

    if (status !== 200 && r.reason) t.byReason[r.reason] = (t.byReason[r.reason] ?? 0) + 1;

    bump((t.byClient[r.clientId] ??= emptyCounts()), status);
    bump(t.byPath[r.path], status);

    if (!isError(status)) {
      latencySum += r.latencyMs;
      latencyCount += 1;
    }
  }

  t.avgLatencyMs = latencyCount > 0 ? latencySum / latencyCount : 0;
  return t;
}

// ─── Score ───────────────────────────────────────────────────────────────────

export const SCORING = Object.freeze({
  /** XP for a perfect round. */
  maxXp: 500,
  /** Attack traffic up to allowance × tolerance counts as fully contained. */
  tolerance: 1.15,
  /** Each legit block costs this share of the round's XP (capped at 100%). */
  legitPenaltyPerBlock: 0.1,
  /** Minimum containment to clear the round (and zero legit blocks). */
  clearContainment: 0.8,
});

/** Timing of the actual run, so the fixed-window allowance can use the real window alignment. */
export interface ScoreTiming {
  /** Date.now() when firing started (event `at` offsets are relative to it). */
  startAt: number;
  windowEpochMs: number;
}

export interface Score {
  xp: number;
  cleared: boolean;
  /** 0..1. 1 = attack held to (about) what the configured limit should allow. */
  containment: number;
  /** Attacker 200s a correct limiter with this config should allow, summed over attacker IPs. */
  allowance: number;
}

/**
 * Per attacker IP, what a correct limiter of this algorithm lets through over an attack spanning
 * [firstAt, lastAt] (ms from start):
 *   fixed   → maxRequests × windows actually touched (aligned to windowEpochMs when timing is known)
 *   sliding → maxRequests × (floor(span / window) + 1)
 *   token   → capacity + refill over the span = maxRequests × (1 + span / window)
 * Round 2 override: every algorithm gets ONE quota. The two bursts are ~500ms apart, so the attacker
 * deserves one quota. Counting the second fixed window would let fixed window "clear" round 2, which is
 * exactly the flaw the round teaches.
 */
function perIpAllowance(config: DefenseConfig, firstAt: number, lastAt: number, roundId: number, timing?: ScoreTiming): number {
  const { maxRequests, windowMs, algorithm } = config;
  if (roundId === 2) return maxRequests;
  const span = Math.max(0, lastAt - firstAt);
  switch (algorithm) {
    case "fixed": {
      if (!timing) return maxRequests * (Math.floor(span / windowMs) + 1);
      const index = (at: number) => Math.floor((timing.startAt + at - timing.windowEpochMs) / windowMs);
      return maxRequests * (index(lastAt) - index(firstAt) + 1);
    }
    case "sliding":
      return maxRequests * (Math.floor(span / windowMs) + 1);
    case "token":
      return Math.floor(maxRequests * (1 + span / windowMs));
  }
}

/**
 * XP for a round (brief §6). Only authenticated attackers (auth type "login") hitting /api/resource can
 * ever pass, so only their IPs earn an allowance: forged, alg:none, garbage and login-stuffing traffic
 * always gets 401 or 429, so it adds nothing (round 4's allowance is 0 and its attackPassed is 0).
 */
export function score(t: Tally, config: DefenseConfig, events: ScenarioEvent[], scenario: Scenario, timing?: ScoreTiming): Score {
  const clients = new Map(scenario.clients.map((c) => [c.id, c]));
  const attackAts: number[] = [];
  const attackerIps = new Set<string>();
  for (const e of events) {
    const c = clients.get(e.clientId);
    if (c && !c.legit && c.auth.type === "login" && e.path === "/api/resource") {
      attackAts.push(e.at);
      attackerIps.add(c.ip);
    }
  }

  let allowance = 0;
  if (attackAts.length > 0) {
    const firstAt = Math.min(...attackAts);
    const lastAt = Math.max(...attackAts);
    allowance = perIpAllowance(config, firstAt, lastAt, scenario.id, timing) * attackerIps.size;
  }

  const cap = allowance * SCORING.tolerance;
  const containment = t.attackPassed <= cap ? 1 : cap / Math.max(1, t.attackPassed);
  const legitPenalty = Math.min(1, t.legitBlocks * SCORING.legitPenaltyPerBlock);
  const xp = Math.round(SCORING.maxXp * containment * (1 - legitPenalty));
  const cleared = t.legitBlocks === 0 && containment >= SCORING.clearContainment;
  return { xp, cleared, containment, allowance };
}
