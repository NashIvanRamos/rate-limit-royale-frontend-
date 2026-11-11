import type { Tone } from "./tone";

export interface DistributionSegment {
  label: string;
  value: number;
  tone: Exclude<Tone, "neutral">;
}

interface DistributionBarProps {
  segments: DistributionSegment[];
  label: string;
}

/** Stacked horizontal bar, for example the 200 / 429 / 401 split of a round. Grows in on mount. */
export function DistributionBar({ segments, label }: DistributionBarProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const summary = segments.map((s) => `${s.label} ${s.value} (${pct(s.value)}%)`).join(", ");

  return (
    <div className="dist">
      <div className="dist__bar" role="img" aria-label={`${label}: ${summary}`}>
        {segments.map((s) => (
          <div
            key={s.label}
            className={`dist__segment chip-${s.tone}`}
            style={{ flexGrow: Math.max(0, s.value) }}
          />
        ))}
      </div>
      <div className="dist__legend" aria-hidden="true">
        {segments.map((s) => (
          <span key={s.label} className="row">
            <span className={`metric-row__chip chip-${s.tone}`} />
            {s.label} <span className="num">{pct(s.value)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
