// Fires a scenario's timed events fire-and-forget and records every response (brief §5).
// All timers are scheduled up front, so no request ever waits for another one to finish.

import { apiRequest, CLIENT_ERRORS, type ResourceResponse } from "./api";
import { isError } from "./scoring";
import type { ClientSpec, FeedItem, RequestRecord, ScenarioEvent, StatusCounts } from "./types";

/** Running counts for the live firing view (task 13). Only statuses the game cares about. */
export interface LiveCounts {
  s200: number;
  s429: number;
  s401: number;
  /** Status 0 (backend unreachable) or 5xx (e.g. limiter_unavailable). */
  errors: number;
}

export type { FeedItem } from "./types";

/** How many recent responses the live feed keeps. */
export const FEED_SIZE = 14;

export interface FiringProgress {
  /** Requests that got a response (or a network error). */
  done: number;
  total: number;
  counts: LiveCounts;
  /** Per client id, for the round 5 "50 keys vs 1 key" view. Fresh objects on every report. */
  byClient: Record<string, StatusCounts>;
  /** The latest responses, newest first (at most FEED_SIZE). */
  recent: FeedItem[];
}

export interface RunScenarioOptions {
  /** Need not be sorted. `at` is the offset in ms from the moment runScenario is called. */
  events: ScenarioEvent[];
  clients: Record<string, ClientSpec>;
  /** Bearer token per client id. Undefined means no Authorization header. */
  tokens: Record<string, string | undefined>;
  /** Throttled to at most once per `progressIntervalMs`, plus once at the end. */
  onProgress?: (progress: FiringProgress) => void;
  /** Called once, when the last event's timer has fired (the round is now only draining). */
  onAllFired?: () => void;
  signal?: AbortSignal;
  progressIntervalMs?: number;
}

const DEFAULT_PROGRESS_INTERVAL_MS = 100;

/**
 * Resolves with one record per request that got an answer, once all of them have settled.
 * Network errors are recorded with status 0. On abort, pending timers are cleared, in-flight fetches
 * are cancelled, aborted requests record nothing, and the promise resolves with what was recorded.
 */
export function runScenario({
  events,
  clients,
  tokens,
  onProgress,
  onAllFired,
  signal,
  progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
}: RunScenarioOptions): Promise<RequestRecord[]> {
  for (const ev of events) {
    if (!clients[ev.clientId]) {
      return Promise.reject(new Error(`runScenario: event references unknown client "${ev.clientId}"`));
    }
  }

  const records: RequestRecord[] = [];
  const counts: LiveCounts = { s200: 0, s429: 0, s401: 0, errors: 0 };
  const byClient = new Map<string, StatusCounts>();
  const recent: FeedItem[] = [];
  let seq = 0;
  const total = events.length;

  const emit = () =>
    onProgress?.({
      done: records.length,
      total,
      counts: { ...counts },
      byClient: Object.fromEntries([...byClient].map(([id, c]) => [id, { ...c }])),
      recent: recent.slice(),
    });

  if (signal?.aborted || total === 0) {
    if (total === 0) onAllFired?.();
    emit();
    return Promise.resolve(records);
  }

  return new Promise((resolve) => {
    const start = performance.now();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let outstanding = total;
    let fired = 0;
    let finished = false;
    let lastEmit = -Infinity;
    let trailing: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (trailing !== undefined) clearTimeout(trailing);
      signal?.removeEventListener("abort", onAbort);
      emit();
      resolve(records);
    };

    const settleOne = () => {
      outstanding -= 1;
      if (outstanding === 0) finish();
    };

    const throttledEmit = () => {
      if (finished) return;
      const now = performance.now();
      const wait = lastEmit + progressIntervalMs - now;
      if (wait <= 0) {
        lastEmit = now;
        emit();
      } else if (trailing === undefined) {
        trailing = setTimeout(() => {
          trailing = undefined;
          lastEmit = performance.now();
          if (!finished) emit();
        }, wait);
      }
    };

    function onAbort() {
      // Unfired events will never run: count them as settled. In-flight fetches are cancelled by the
      // same signal and settle on their own (recording nothing).
      for (const timer of timers) {
        clearTimeout(timer);
        settleOne();
      }
      timers.clear();
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    const fire = async (ev: ScenarioEvent) => {
      fired += 1;
      if (fired === total) onAllFired?.();

      const client = clients[ev.clientId]!;
      const isLogin = ev.path === "/api/login";
      const sentAt = performance.now() - start;
      try {
        const result = await apiRequest<Partial<ResourceResponse>>(ev.path, {
          method: isLogin ? "POST" : "GET",
          body: isLogin ? ev.body : undefined,
          // Login events never carry a token: they are credential attempts.
          token: isLogin ? undefined : tokens[client.id],
          ip: client.ip,
          signal,
        });
        if (!result.ok && result.error.error === CLIENT_ERRORS.aborted) return;

        const record: RequestRecord = {
          ...ev,
          legit: client.legit,
          status: result.status,
          latencyMs: performance.now() - start - sentAt,
          sentAt,
        };
        const nodeId = result.headers.get("X-Node-Id");
        if (nodeId) record.nodeId = nodeId;
        const nodePort = Number(result.headers.get("X-Node-Port"));
        if (Number.isInteger(nodePort) && nodePort > 0) record.nodePort = nodePort;
        // Served while the limiter's store was down (fail open): not rate limited.
        if (result.headers.get("X-RateLimit-Degraded") === "true") record.degraded = true;
        if (result.ok) {
          if (typeof result.data.servedAt === "number") record.servedAt = result.data.servedAt;
        } else {
          record.reason = result.error.reason ?? result.error.error;
        }
        records.push(record);
        recent.unshift({ seq: seq++, clientId: ev.clientId, status: record.status, reason: record.reason, nodeId: record.nodeId, nodePort: record.nodePort });
        if (recent.length > FEED_SIZE) recent.length = FEED_SIZE;

        let perClient = byClient.get(ev.clientId);
        if (!perClient) byClient.set(ev.clientId, (perClient = { s200: 0, s429: 0, s401: 0 }));
        if (record.status === 200) {
          counts.s200 += 1;
          perClient.s200 += 1;
        } else if (record.status === 429) {
          counts.s429 += 1;
          perClient.s429 += 1;
        } else if (record.status === 401) {
          counts.s401 += 1;
          perClient.s401 += 1;
        } else if (isError(record.status)) counts.errors += 1;
        throttledEmit();
      } finally {
        settleOne();
      }
    };

    for (const ev of events) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void fire(ev);
      }, Math.max(0, ev.at));
      timers.add(timer);
    }
  });
}
