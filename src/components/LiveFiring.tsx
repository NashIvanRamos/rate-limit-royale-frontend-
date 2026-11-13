import type { FiringState } from "../state";
import type { DefenseConfig, Scenario } from "../types";
import { KeysPanel } from "./KeysPanel";
import { ResponseFeed } from "./ResponseFeed";

interface LiveFiringProps {
  firing: FiringState;
  scenario: Scenario;
  config: DefenseConfig;
  /** The round keeps state per node (memory cluster, or the toggle set to Per node): budgets multiply by nodes. */
  perNode?: boolean;
}

/** Running 200 / 429 / 401 counts while a round fires (from the throttled progress reports). */
export function LiveFiring({ firing, scenario, config, perNode }: LiveFiringProps) {
  // Nodes that have answered attacker requests so far (from the live feed).
  const attackers = new Set(scenario.clients.filter((c) => !c.legit).map((c) => c.id));
  const attackerNodes = new Set(firing.recent.filter((r) => attackers.has(r.clientId) && r.nodeId).map((r) => r.nodeId));
  const budgetNodes = perNode ? Math.max(1, attackerNodes.size) : 1;
  const { counts } = firing;
  return (
    <div className="stack live" style={{ gap: 16 }} aria-live="off">
      <div className="result-grid result-grid--3">
        <div className="result-tile">
          <span className="label">Accepted (200)</span>
          <span className="result-tile__value num tone-accepted">{counts.s200}</span>
        </div>
        <div className="result-tile">
          <span className="label">Blocked (429)</span>
          <span className="result-tile__value num tone-blocked">{counts.s429}</span>
        </div>
        <div className="result-tile">
          <span className="label">Rejected auth (401)</span>
          <span className="result-tile__value num tone-auth">{counts.s401}</span>
        </div>
      </div>
      <ResponseFeed recent={firing.recent} clients={scenario.clients} />
      {scenario.id === 5 && <KeysPanel scenario={scenario} config={config} byClient={firing.byClient} budgetNodes={budgetNodes} />}
    </div>
  );
}
