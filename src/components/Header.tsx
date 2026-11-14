import type { ServerState } from "../state";
import { Icon } from "./ui/Icon";
import { ProgressBar } from "./ui/ProgressBar";
import { StatusPill } from "./ui/StatusPill";

interface HeaderProps {
  /** Position in this game's sequence (1-based) and the number of rounds: "01 / 05", or "01 / 02" in demo mode. */
  round: number;
  total: number;
  score: number;
  server: ServerState;
}

/** Tooltip for the degraded pill: what a Redis outage means for each endpoint. */
function degradedTitle(server: ServerState): string {
  const resource = server.failureMode === "closed" ? "API requests are refused (503)" : "API requests are served without rate limiting";
  return `Redis is down: ${resource}; logins and deploys are refused until it recovers.`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Header({ round, total, score, server }: HeaderProps) {
  return (
    <header className="stack" style={{ gap: 16 }}>
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div className="brand">
          <span className="brand__icon">
            <Icon name="shield" size={18} />
          </span>
          <div className="stack" style={{ gap: 0 }}>
            <h1 className="brand__title">Rate Limit Royale</h1>
            <span className="label">API Defense Arena</span>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          {server.nodeId && server.nodeId !== "single" && server.store && (
            <span className="pill" title={`Behind a load balancer; this health check was answered by ${server.nodeId}.`}>
              Cluster · {server.store}
            </span>
          )}
          <StatusPill status={server.status} title={server.status === "degraded" ? degradedTitle(server) : undefined} />
        </div>
      </div>

      <hr className="divider" />

      <div className="scoreline">
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">Current round</span>
          <span className="scoreline__value num">
            {pad(round)} / {pad(total)}
          </span>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
          <span className="label">Total score</span>
          <span className="scoreline__value scoreline__value--xp num">{score.toLocaleString("en-US")} XP</span>
        </div>
      </div>
      <ProgressBar value={round / total} tone="accepted" label={`Round ${round} of ${total}`} />
    </header>
  );
}
