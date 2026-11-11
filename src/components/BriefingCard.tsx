import { useMemo } from "react";
import { previewEvents } from "../runRound";
import type { DefenseConfig, Scenario } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
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

/** Basic version (task 08). Styled in task 10. */
export function BriefingCard({ scenario, config, onContinue }: BriefingCardProps) {
  const stats = useBriefingStats(scenario, config);
  const showHint = scenario.hint !== undefined && config.windowMs > 10_000;

  return (
    <Card label={<Tag tone="blocked">Incoming attack</Tag>} aside={<span className="label">Wave {String(scenario.id).padStart(2, "0")}</span>}>
      <h2>{scenario.name}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {scenario.description}
      </p>
      <div className="stat-grid">
        <StatTile label="Requests" value={stats.requests} />
        <StatTile label={stats.clientIps === 1 ? "Client IP" : "Client IPs"} value={stats.clientIps} />
        <StatTile label="Duration" value={stats.durationS} unit="s" />
      </div>
      {showHint && <p className="tone-preview" style={{ margin: 0 }}>{scenario.hint}</p>}
      {onContinue && (
        <Button variant="primary" fullWidth onClick={onContinue}>
          Continue
        </Button>
      )}
    </Card>
  );
}
