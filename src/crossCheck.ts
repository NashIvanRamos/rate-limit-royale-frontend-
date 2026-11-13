// Task 14: reconcile the browser's tally with the server's own counts (GET /api/stats), to show the
// numbers are real. Both are reset by the same deploy, so /api/resource counts must match exactly.

import type { StatsResponse } from "./api";
import type { CrossCheck, DefenseConfig, Scenario, StatusCounts, Tally } from "./types";

const same = (a: StatusCounts, b: StatusCounts) => a.s200 === b.s200 && a.s429 === b.s429 && a.s401 === b.s401;

/** `nodes`: how many cluster nodes' stats were summed into `server` (1 = a single /api/stats). */
export function crossCheck(t: Tally, server: StatsResponse, scenario: Scenario, config: DefenseConfig, nodes = 1): CrossCheck {
  const resourceClient = t.byPath["/api/resource"];
  const resourceServer: StatusCounts = { s200: server.resource.s200, s429: server.resource.s429, s401: server.resource.s401 };

  // The server counts setup logins too (all 200). The expired-token fetch is a separate endpoint it doesn't count.
  const setupLogins = scenario.clients.filter((c) => c.auth.type === "login").length;
  const loginClient = t.byPath["/api/login"];
  const loginServer: StatusCounts = { s200: server.login.s200 - setupLogins, s429: server.login.s429, s401: server.login.s401 };
  const sentLogins = loginClient.s200 + loginClient.s429 + loginClient.s401 > 0;

  // Legit clients whose requests reached the limiter (200 or 429) each hold one key: their IP or their user.
  const legitKeys = new Set(
    scenario.clients
      .filter((c) => c.legit && ((t.byClient[c.id]?.s200 ?? 0) + (t.byClient[c.id]?.s429 ?? 0) > 0))
      .map((c) => (config.keyBy === "user" ? c.auth.username ?? c.id : c.ip)),
  ).size;

  // A per-node round on a Redis-backed cluster: counts are cluster-wide, but trackedKeys is the answering node's own.
  const keysNode =
    server.limiterStore === "memory" && server.store === "redis" && server.nodeId && server.nodeId !== "single" ? server.nodeId : undefined;

  return {
    keysNode,
    resource: { client: { ...resourceClient }, server: resourceServer, match: same(resourceClient, resourceServer) },
    login: sentLogins ? { client: { ...loginClient }, server: loginServer, match: same(loginClient, loginServer) } : undefined,
    trackedKeys: server.trackedKeys,
    nodes,
    legitKeys,
  };
}
