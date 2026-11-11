import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description: string;
  icon?: ReactNode;
}

interface RadioCardsProps<T extends string> {
  label: string;
  options: RadioCardOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Selectable cards with radiogroup semantics (arrow keys move the selection). Used for the algorithm picker. */
export function RadioCards<T extends string>({ label, options, value, onChange, disabled }: RadioCardsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="radio-cards" role="radiogroup" aria-label={label}>
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="radio-card"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.icon && <span className="radio-card__icon">{opt.icon}</span>}
            <span className="radio-card__title">{opt.title}</span>
            <span className="radio-card__desc">{opt.description}</span>
            {checked && <span className="radio-card__badge">Selected</span>}
          </button>
        );
      })}
    </div>
  );
}
