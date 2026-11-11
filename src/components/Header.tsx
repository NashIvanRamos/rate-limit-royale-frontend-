import { ROUND_COUNT } from "../scenarios";
import { Icon } from "./ui/Icon";
import { ProgressBar } from "./ui/ProgressBar";
import { StatusPill } from "./ui/StatusPill";

interface HeaderProps {
  round: number;
  score: number;
  serverOnline: boolean | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Header({ round, score, serverOnline }: HeaderProps) {
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
        <StatusPill status={serverOnline === null ? "checking" : serverOnline ? "online" : "offline"} />
      </div>

      <hr className="divider" />

      <div className="scoreline">
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">Current round</span>
          <span className="scoreline__value num">
            {pad(round)} / {pad(ROUND_COUNT)}
          </span>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
          <span className="label">Total score</span>
          <span className="scoreline__value scoreline__value--xp num">{score.toLocaleString("en-US")} XP</span>
        </div>
      </div>
      <ProgressBar value={round / ROUND_COUNT} tone="accepted" label={`Round ${round} of ${ROUND_COUNT}`} />
    </header>
  );
}
