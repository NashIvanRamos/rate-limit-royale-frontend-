import { ROUND_COUNT } from "../scenarios";
import { ProgressBar } from "./ui/ProgressBar";
import { StatusPill } from "./ui/StatusPill";

interface HeaderProps {
  round: number;
  score: number;
  serverOnline: boolean | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Basic version (task 08). Styled in task 09. */
export function Header({ round, score, serverOnline }: HeaderProps) {
  return (
    <header className="card">
      <div className="row spread">
        <div className="stack" style={{ gap: 2 }}>
          <h1 style={{ fontSize: 16 }}>Rate Limit Royale</h1>
          <span className="label">API Defense Arena</span>
        </div>
        <StatusPill status={serverOnline === null ? "checking" : serverOnline ? "online" : "offline"} />
      </div>
      <div className="row spread">
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">Current round</span>
          <span className="num" style={{ fontSize: 18 }}>
            {pad(round)} / {pad(ROUND_COUNT)}
          </span>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
          <span className="label">Total score</span>
          <span className="num tone-xp" style={{ fontSize: 18 }}>
            {score.toLocaleString()} XP
          </span>
        </div>
      </div>
      <ProgressBar value={round / ROUND_COUNT} tone="accepted" label="Round progress" />
    </header>
  );
}
