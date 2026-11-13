import { shortConfig } from "../labels";
import { scenarioFor } from "../scenarios";
import type { RoundResult } from "../types";
import { Button } from "./ui/Button";

interface FinalSummaryProps {
  history: RoundResult[];
  score: number;
  onRestart: () => void;
}

export function FinalSummary({ history, score, onRestart }: FinalSummaryProps) {
  const cleared = history.filter((r) => r.cleared).length;
  const stores = [...new Set(history.flatMap((r) => (r.cluster ? [r.cluster.store === "redis" ? "shared" : "per-node"] : [])))];
  return (
    <section className="stack" style={{ gap: 20 }} aria-labelledby="summary-title">
      <div className="row spread" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="summary-title" className="section__title">
            Final summary
          </h2>
          <p className="section__sub">
            {cleared} of {history.length} rounds cleared{stores.length ? ` on a cluster (${stores.join(" and ")} limiter state)` : ""}.
          </p>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
          <span className="label">Total score</span>
          <span className="scoreline__value scoreline__value--xp num">{score.toLocaleString("en-US")} XP</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="summary-table">
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col" className="summary-table__config">Config</th>
              <th scope="col" className="num-col">200 / 429 / 401</th>
              <th scope="col" className="num-col" title="Legitimate requests blocked">Legit</th>
              <th scope="col" className="num-col">XP</th>
              <th scope="col" className="num-col">
                <span className="visually-hidden">Result</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.round}>
                <td className="summary-table__name">
                  <span className="num muted">{String(r.round).padStart(2, "0")}</span> {scenarioFor(r.round).name}
                </td>
                <td className="num summary-table__config">{shortConfig(r.config)}</td>
                <td className="num num-col">
                  <span className="tone-accepted">{r.tally.accepted}</span> / <span className="tone-blocked">{r.tally.blocked}</span> /{" "}
                  <span className="tone-auth">{r.tally.rejectedAuth}</span>
                </td>
                <td className={`num num-col ${r.tally.legitBlocks > 0 ? "tone-blocked" : ""}`}>{r.tally.legitBlocks}</td>
                <td className="num num-col tone-xp">{r.xp}</td>
                <td className={`num-col ${r.cleared ? "tone-accepted" : "tone-blocked"}`} aria-label={r.cleared ? "Cleared" : "Breached"}>
                  {r.cleared ? "✓" : "✗"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button variant="primary" fullWidth onClick={onRestart}>
        Play again
      </Button>
    </section>
  );
}
