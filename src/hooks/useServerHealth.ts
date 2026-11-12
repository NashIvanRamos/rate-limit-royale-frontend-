import { useEffect } from "react";
import { health } from "../api";
import type { ServerState } from "../state";

export const HEALTH_POLL_MS = 5_000;

/**
 * Polls GET /api/health every `intervalMs` (and once immediately) and reports online / degraded / offline,
 * plus the node id and store the backend reports. `onStatus` must be stable (a reducer dispatch is).
 * Safe under StrictMode: cleanup stops the timer and cancels the in-flight check.
 */
export function useServerHealth(onStatus: (server: ServerState) => void, intervalMs = HEALTH_POLL_MS): void {
  useEffect(() => {
    let controller: AbortController | null = null;

    const check = async () => {
      controller?.abort();
      const ac = new AbortController();
      controller = ac;
      const res = await health(ac.signal);
      if (ac.signal.aborted) return;
      if (!res.ok) {
        onStatus({ status: "offline" });
        return;
      }
      const { status, nodeId, store, failureMode } = res.data;
      onStatus({ status: status === "healthy" ? "online" : status === "degraded" ? "degraded" : "offline", nodeId, store, failureMode });
    };

    void check();
    const timer = setInterval(() => void check(), intervalMs);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, [onStatus, intervalMs]);
}
