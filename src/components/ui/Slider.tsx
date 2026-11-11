import { useId } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Live label next to the title, for example `(v) => \`${v / 1000}s\``. */
  format?: (value: number) => string;
  /** Captions under the track's two ends, e.g. "5 requests" / "100 requests". */
  minLabel?: string;
  maxLabel?: string;
  /** Extra class for the live value (e.g. a tone). */
  valueClassName?: string;
  disabled?: boolean;
}

/** Labelled range input. Always emits an integer clamped to [min, max]. */
export function Slider({ label, value, min, max, step = 1, onChange, format = String, minLabel, maxLabel, valueClassName, disabled }: SliderProps) {
  const id = useId();
  return (
    <div className="slider">
      <div className="row spread">
        <label className="slider__title" htmlFor={id}>
          {label}
        </label>
        <span className={`slider__value num ${valueClassName ?? ""}`}>{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value)))))}
      />
      {(minLabel || maxLabel) && (
        <div className="row spread slider__range" aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
