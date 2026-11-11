import { scenarioFor } from "../scenarios";
import type { DefenseConfig, RoundResult } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

interface FinalSummaryProps {
  history: RoundResult[];
  score: number;
  onRestart: () => void;
}

const shortConfig = (c: DefenseConfig) => `${c.algorithm} · ${c.maxRequests}/${c.windowMs / 1000}s · ${c.keyBy}`;

/** Basic version (task 08). Styled in task 11. */
export function FinalSummary({ history, score, onRestart }: FinalSummaryProps) {
  return (
    <Card label="Final summary" aside={<span className="num tone-xp">{score.toLocaleString()} XP</span>}>
      <div style={{ overflowX: "auto" }}>
        <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr className="label" style={{ textAlign: "left" }}>
              <th>#</th>
              <th>Round</th>
              <th>Config</th>
              <th>200/429/401</th>
              <th>Legit blocks</th>
              <th>XP</th>
              <th>Cleared</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.round}>
                <td>{r.round}</td>
                <td>{scenarioFor(r.round).name}</td>
                <td>{shortConfig(r.config)}</td>
                <td>
                  {r.tally.accepted}/{r.tally.blocked}/{r.tally.rejectedAuth}
                </td>
                <td>{r.tally.legitBlocks}</td>
                <td className="tone-xp">{r.xp}</td>
                <td className={r.cleared ? "tone-accepted" : "tone-blocked"}>{r.cleared ? "✓" : "✗"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="primary" fullWidth onClick={onRestart}>
        Play again
      </Button>
    </Card>
  );
}
