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
  disabled?: boolean;
}

/** Labelled range input. Always emits an integer clamped to [min, max]. */
export function Slider({ label, value, min, max, step = 1, onChange, format = String, disabled }: SliderProps) {
  const id = useId();
  return (
    <div className="slider">
      <div className="row spread">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <span className="slider__value num">{format(value)}</span>
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
    </div>
  );
}
