import { useMemo } from "react";
import { previewEvents } from "../runRound";
import type { DefenseConfig, Scenario } from "../types";
import { Button } from "./ui/Button";
import { StatTile } from "./ui/StatTile";
import { Tag } from "./ui/Tag";

interface BriefingCardProps {
  scenario: Scenario;
  config: DefenseConfig;
  /** Shown only in the briefing phase. */
  onContinue?: () => void;
}

/** Real counts from the round's script for this config (not hard-coded). */
function useBriefingStats(scenario: Scenario, config: DefenseConfig) {
  return useMemo(() => {
    const events = previewEvents(scenario, config);
    const used = new Set(events.map((e) => e.clientId));
    const ips = new Set(scenario.clients.filter((c) => used.has(c.id)).map((c) => c.ip));
    const durationMs = events.length > 0 ? events[events.length - 1]!.at : 0;
    return { requests: events.length, clientIps: ips.size, durationS: Math.ceil(durationMs / 1000) };
  }, [scenario, config]);
}

export function BriefingCard({ scenario, config, onContinue }: BriefingCardProps) {
  const stats = useBriefingStats(scenario, config);
  const showHint = scenario.hint !== undefined && config.windowMs > 10_000;

  return (
    <article className="briefing" aria-labelledby="briefing-title">
      <div className="row spread">
        <Tag tone="blocked">Incoming attack</Tag>
        <span className="label">Wave {String(scenario.id).padStart(2, "0")}</span>
      </div>
      <h2 id="briefing-title" className="briefing__title">
        {scenario.name}
      </h2>
      <p className="briefing__desc">{scenario.description}</p>
      <div className="stat-grid">
        <StatTile label="Requests" value={stats.requests.toLocaleString("en-US")} />
        <StatTile label={stats.clientIps === 1 ? "Client IP" : "Client IPs"} value={stats.clientIps} />
        <StatTile label="Duration" value={`${stats.durationS}s`} />
      </div>
      {showHint && <p className="briefing__hint">{scenario.hint}</p>}
      {onContinue && (
        <Button variant="primary" fullWidth onClick={onContinue}>
          Continue to defense setup
        </Button>
      )}
    </article>
  );
}
