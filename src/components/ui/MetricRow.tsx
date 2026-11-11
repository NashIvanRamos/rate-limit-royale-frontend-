import type { ReactNode } from "react";
import { cx, type Tone } from "./tone";

interface MetricRowProps {
  label: string;
  value: ReactNode;
  /** Colour chip and value colour. Omit for neutral metrics (latency, …). */
  tone?: Exclude<Tone, "neutral">;
  note?: ReactNode;
}

/** One results row: chip + label, optional note, number on the right. Wrap rows in `.metric-list`. */
export function MetricRow({ label, value, tone, note }: MetricRowProps) {
  return (
    <div className="metric-row">
      <div className="stack" style={{ gap: 2 }}>
        <span className="metric-row__label">
          {tone && <span className={`metric-row__chip chip-${tone}`} aria-hidden="true" />}
          {label}
        </span>
        {note && <span className="metric-row__note">{note}</span>}
      </div>
      <span className={cx("metric-row__value num", tone && `tone-${tone}`)}>{value}</span>
    </div>
  );
}
