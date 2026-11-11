import type { FiringState } from "../state";
import type { DefenseConfig, Scenario } from "../types";
import { KeysPanel } from "./KeysPanel";

interface LiveFiringProps {
  firing: FiringState;
  scenario: Scenario;
  config: DefenseConfig;
}

/** Running 200 / 429 / 401 counts while a round fires (from the throttled progress reports). */
export function LiveFiring({ firing, scenario, config }: LiveFiringProps) {
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
      {scenario.id === 5 && <KeysPanel scenario={scenario} config={config} byClient={firing.byClient} />}
    </div>
  );
}
