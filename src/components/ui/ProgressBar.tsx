import { cx, type Tone } from "./tone";

interface ProgressBarProps {
  /** 0..1, clamped. */
  value: number;
  tone?: Tone;
  label: string;
}

export function ProgressBar({ value, tone = "neutral", label }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
  return (
    <div
      className={cx("progress", `progress--${tone}`)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
