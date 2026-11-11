// The five rounds (brief §4). Each is a function of the deployed config: round 2 aims at the real window
// boundary, and attackers "know" the limit, as a real attacker would from RateLimit-Limit.
//
// Identity rules: legit clients are alice, bob and carol only. Attackers only ever use pool accounts.
// Attackers in rounds 1–3 and 5 are authenticated, because /api/resource runs auth before the limiter,
// so an unauthenticated flood would be 100% 401s and never exercise the defense. Unauthenticated and
// forged traffic is round 4's job.

import { ATTACKER_IPS, LEGIT_IPS, poolUser, POOL_SIZE, type LegitUser } from "./clients";
import type { ClientSpec, DefenseConfig, Scenario, ScenarioEvent } from "./types";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Legit traffic rate: one request per client every ~1.5s for the whole round. */
export const LEGIT_EVERY_MS = 1_500;
/** Phase offset between legit clients (alice 0ms, bob 500ms, carol 1000ms), so they don't land together. */
const LEGIT_PHASE_STEP_MS = 500;

function legitClient(user: LegitUser, type: "login" | "expired" = "login"): ClientSpec {
  return { id: user, ip: LEGIT_IPS[user], legit: true, auth: { type, username: user } };
}

/**
 * Each client sends one /api/resource request every `everyMs` from its phase offset until `durationMs`
 * (exclusive). Client i starts at i × 500ms.
 */
export function legitTraffic(clientIds: string[], durationMs: number, everyMs = LEGIT_EVERY_MS): ScenarioEvent[] {
  const events: ScenarioEvent[] = [];
  clientIds.forEach((clientId, i) => {
    for (let at = i * LEGIT_PHASE_STEP_MS; at < durationMs; at += everyMs) {
      events.push({ at, clientId, path: "/api/resource" });
    }
  });
  return events;
}

/** `count` /api/resource requests from one client, one every `everyMs`, starting at `startMs`. */
function steadyStream(clientId: string, count: number, everyMs: number, startMs = 0): ScenarioEvent[] {
  return Array.from({ length: count }, (_, i) => ({ at: startMs + i * everyMs, clientId, path: "/api/resource" as const }));
}

/** Small deterministic PRNG (mulberry32), so the same round always produces the same script. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATTACKER_ID = "attacker";
const mainAttacker = (label = "Attacker"): ClientSpec => ({
  id: ATTACKER_ID,
  ip: ATTACKER_IPS.main,
  legit: false,
  auth: { type: "login", username: poolUser(1) },
  label,
});

// ─── Round 1: Steady Flood ───────────────────────────────────────────────────

const R1_DURATION_MS = 10_000;
const R1_EVERY_MS = 50;

const round1: Scenario = {
  id: 1,
  name: "Steady Flood",
  description: "One client hammers /api/resource at a constant high rate: 20 requests a second for 10 seconds.",
  lesson: "Any algorithm contains a steady flood.",
  durationMs: R1_DURATION_MS,
  clients: [legitClient("alice"), legitClient("bob"), mainAttacker()],
  build: () => [
    ...steadyStream(ATTACKER_ID, R1_DURATION_MS / R1_EVERY_MS, R1_EVERY_MS),
    ...legitTraffic(["alice", "bob"], R1_DURATION_MS),
  ],
};

// ─── Round 2: Edge Exploit ───────────────────────────────────────────────────

/** Bursts land 400ms before and 100ms after the boundary. The first boundary used is ≥ 500ms after start. */
const R2_BEFORE_MS = 400;
const R2_AFTER_MS = 100;
const R2_MIN_LEAD_MS = 500;
const R2_TAIL_MS = 2_000;

/** The fixed-window boundary round 2 aims at, plus the burst offsets (ms from start). */
export function edgeExploitTiming(config: DefenseConfig, windowEpochMs: number, startAt: number) {
  const k = Math.ceil((startAt + R2_MIN_LEAD_MS - windowEpochMs) / config.windowMs);
  const boundary = windowEpochMs + k * config.windowMs; // server time (same machine as the browser)
  const before = boundary - R2_BEFORE_MS - startAt;
  const after = boundary + R2_AFTER_MS - startAt;
  return { boundary, before, after, durationMs: after + R2_TAIL_MS };
}

const round2: Scenario = {
  id: 2,
  name: "Edge Exploit",
  description: "The attacker reads your limit, then fires a full quota just before a window boundary and another just after.",
  lesson: "Fixed window lets ~2× through across the boundary. Sliding and token don't.",
  hint: "Tip: a short window makes the boundary arrive sooner.",
  durationMs: 10_000 + R2_AFTER_MS + R2_TAIL_MS,
  clients: [legitClient("alice"), legitClient("bob"), mainAttacker()],
  build: ({ config, windowEpochMs, startAt }) => {
    const { before, after, durationMs } = edgeExploitTiming(config, windowEpochMs, startAt);
    const burst = (at: number) => Array.from({ length: config.maxRequests }, () => ({ at, clientId: ATTACKER_ID, path: "/api/resource" as const }));
    return [...burst(before), ...burst(after), ...legitTraffic(["alice", "bob"], durationMs)];
  },
};

// ─── Round 3: Burst Attack ───────────────────────────────────────────────────

const R3_REQUESTS = 100;
const R3_EVERY_MS = 50;
const R3_START_MS = 500;
const R3_DURATION_MS = R3_START_MS + R3_REQUESTS * R3_EVERY_MS + 500;

const round3: Scenario = {
  id: 3,
  name: "Burst Attack",
  description: "A single client sends 100 requests within 5 seconds. Protect your API without blocking legitimate traffic.",
  lesson: "Token bucket: an initial burst, then the refill rate. Sliding: strict per window.",
  durationMs: R3_DURATION_MS,
  clients: [legitClient("alice"), legitClient("bob"), mainAttacker()],
  build: () => [
    ...steadyStream(ATTACKER_ID, R3_REQUESTS, R3_EVERY_MS, R3_START_MS),
    ...legitTraffic(["alice", "bob"], R3_DURATION_MS),
  ],
};

// ─── Round 4: Credential Stuffing + Forged Tokens ────────────────────────────

const R4_DURATION_MS = 6_000;
const R4_STUFF_EVERY_MS = 100;
const R4_FORGE_EVERY_MS = 200; // 5 per second per forger

const round4: Scenario = {
  id: 4,
  name: "Credential Stuffing + Forged Tokens",
  description: "Stolen passwords hammer /api/login while forged, alg:none and garbage tokens probe /api/resource. Carol's session has expired.",
  lesson: "Login has its own limit (5 failures, then 429). Bad tokens get 401 and never touch your limiter. Carol's expired token isn't your fault.",
  durationMs: R4_DURATION_MS,
  clients: [
    legitClient("alice"),
    legitClient("bob"),
    // Carol's expired token is fetched in setup with correct credentials, so it adds no login failures.
    legitClient("carol", "expired"),
    { id: "stuffer", ip: ATTACKER_IPS.main, legit: false, auth: { type: "none" }, label: "Credential stuffer" },
    { id: "forger", ip: ATTACKER_IPS.forged, legit: false, auth: { type: "forged", username: poolUser(2) }, label: "Token forger" },
    { id: "nonealg", ip: ATTACKER_IPS.algNone, legit: false, auth: { type: "algNone", username: poolUser(3) }, label: "alg:none forger" },
    { id: "garbler", ip: ATTACKER_IPS.garbage, legit: false, auth: { type: "garbage" }, label: "Garbage tokens" },
  ],
  build: () => {
    const events: ScenarioEvent[] = [];
    for (let i = 0; i < R4_DURATION_MS / R4_STUFF_EVERY_MS; i++) {
      const username = poolUser((i % POOL_SIZE) + 1);
      events.push({ at: i * R4_STUFF_EVERY_MS, clientId: "stuffer", path: "/api/login", body: { username, password: `wrong-${i}` } });
    }
    const forgerCount = R4_DURATION_MS / R4_FORGE_EVERY_MS;
    // Offset each forger slightly so they don't all fire in the same instant.
    events.push(...steadyStream("forger", forgerCount, R4_FORGE_EVERY_MS, 0));
    events.push(...steadyStream("nonealg", forgerCount, R4_FORGE_EVERY_MS, 60));
    events.push(...steadyStream("garbler", forgerCount, R4_FORGE_EVERY_MS, 120));
    events.push(...legitTraffic(["alice", "bob", "carol"], R4_DURATION_MS));
    return events;
  },
};

// ─── Round 5: Account-Rotation Boss Wave ─────────────────────────────────────

const R5_DURATION_MS = 10_000;
const R5_PER_ACCOUNT = 6;
const R5_SEED = 5;

const poolClientId = (n: number) => `pool-${String(n).padStart(2, "0")}`;

const round5: Scenario = {
  id: 5,
  name: "Account-Rotation Boss Wave",
  description: "50 stolen accounts log in from one IP and rotate requests: ~300 in 10 seconds, each account staying under your limit.",
  lesson: "Key by user: 50 budgets, so ~50× gets through. Key by IP: one budget, contained.",
  durationMs: R5_DURATION_MS,
  clients: [
    legitClient("alice"),
    legitClient("bob"),
    legitClient("carol"),
    // Only failed logins are limited, so all 50 valid logins from one IP succeed in setup.
    ...Array.from({ length: POOL_SIZE }, (_, i): ClientSpec => ({
      id: poolClientId(i + 1),
      ip: ATTACKER_IPS.main,
      legit: false,
      auth: { type: "login", username: poolUser(i + 1) },
      label: `Rotating account ${poolUser(i + 1)}`,
    })),
  ],
  build: () => {
    // Evenly interleaved slots (one request every ~33ms overall), plus a little seeded jitter.
    const random = seededRandom(R5_SEED);
    const slotMs = R5_DURATION_MS / R5_PER_ACCOUNT; // ~1667ms between one account's requests
    const offsetMs = slotMs / POOL_SIZE; // ~33ms between accounts
    const events: ScenarioEvent[] = [];
    for (let n = 1; n <= POOL_SIZE; n++) {
      for (let j = 0; j < R5_PER_ACCOUNT; j++) {
        const at = Math.round(j * slotMs + (n - 1) * offsetMs + random() * offsetMs * 0.8);
        events.push({ at, clientId: poolClientId(n), path: "/api/resource" });
      }
    }
    events.push(...legitTraffic(["alice", "bob", "carol"], R5_DURATION_MS));
    return events;
  },
};

/** Distinct limiter keys the round 5 attacker gets: one per account under user keying, one IP otherwise. */
export function attackerKeyCount(config: DefenseConfig): number {
  return config.keyBy === "user" ? POOL_SIZE : 1;
}

export const SCENARIOS: readonly Scenario[] = [round1, round2, round3, round4, round5];
export const ROUND_COUNT = SCENARIOS.length;

export function scenarioFor(round: number): Scenario {
  const s = SCENARIOS[round - 1];
  if (!s) throw new RangeError(`No scenario for round ${round}`);
  return s;
}
