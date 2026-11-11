// Display names and formatters shared by the briefing, config, preview, results and summary.

import type { Algorithm, DefenseConfig, KeyBy } from "./types";

export const ALGORITHM_NAMES: Readonly<Record<Algorithm, string>> = {
  fixed: "Fixed Window",
  sliding: "Sliding Window",
  token: "Token Bucket",
};

export const ALGORITHM_TRADEOFFS: Readonly<Record<Algorithm, string>> = {
  fixed: "Cheap and simple. Bursts can double up at window edges.",
  sliding: "Exact per window. Memory grows with requests.",
  token: "Allows short bursts, then a steady refill rate.",
};

export const KEY_BY_NAMES: Readonly<Record<KeyBy, string>> = {
  ip: "Key by IP",
  user: "Key by user",
};

export const KEY_BY_HELP: Readonly<Record<KeyBy, string>> = {
  ip: "Every client IP shares one budget, whichever account it uses.",
  user: "Every logged-in account gets its own budget.",
};

/** 10000 → "10s". */
export const formatWindow = (windowMs: number) => `${windowMs / 1000}s`;

/** "sliding · 10/3s · ip" */
export const shortConfig = (c: DefenseConfig) => `${c.algorithm} · ${c.maxRequests}/${formatWindow(c.windowMs)} · ${c.keyBy}`;

/** Token bucket refill interval, e.g. "1 token / 1.0s". */
export const refillLabel = (c: DefenseConfig) => `1 token / ${(c.windowMs / c.maxRequests / 1000).toFixed(1)}s`;
