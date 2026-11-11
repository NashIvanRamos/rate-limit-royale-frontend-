import { ALGORITHM_NAMES, ALGORITHM_TRADEOFFS, formatWindow, KEY_BY_HELP, KEY_BY_NAMES } from "../labels";
import { ALGORITHMS, CONFIG_LIMITS, KEY_BY, type Algorithm, type DefenseConfig, type KeyBy } from "../types";
import { Icon, type IconName } from "./ui/Icon";
import { RadioCards, type RadioCardOption } from "./ui/RadioCards";
import { SegmentedControl, type SegmentOption } from "./ui/SegmentedControl";
import { Slider } from "./ui/Slider";

const ALGORITHM_ICONS: Record<Algorithm, IconName> = { fixed: "clock", sliding: "window", token: "bolt" };

const ALGORITHM_OPTIONS: RadioCardOption<Algorithm>[] = ALGORITHMS.map((a) => ({
  value: a,
  title: ALGORITHM_NAMES[a],
  description: ALGORITHM_TRADEOFFS[a],
  icon: <Icon name={ALGORITHM_ICONS[a]} />,
}));

const KEY_BY_OPTIONS: SegmentOption<KeyBy>[] = KEY_BY.map((k) => ({ value: k, label: KEY_BY_NAMES[k] }));

interface ConfigPanelProps {
  config: DefenseConfig;
  onChange: (patch: Partial<DefenseConfig>) => void;
  /** Locks every control (mid-round, or showing what was deployed). */
  disabled?: boolean;
}

/** The reducer clamps every value to CONFIG_LIMITS, so no invalid config can be built here. */
export function ConfigPanel({ config, onChange, disabled }: ConfigPanelProps) {
  const { maxRequests: maxR, windowMs: win } = CONFIG_LIMITS;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 className="section__title">Configure your defense</h2>
        <p className="section__sub">Choose an algorithm and configure your API protection.</p>
      </div>

      {/* One switch locks everything mid-round. */}
      <fieldset className="config" disabled={disabled} aria-disabled={disabled || undefined}>
        <legend className="visually-hidden">Defense configuration</legend>

        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Rate limiting algorithm</span>
          <RadioCards label="Rate limiting algorithm" options={ALGORITHM_OPTIONS} value={config.algorithm} onChange={(algorithm) => onChange({ algorithm })} disabled={disabled} />
          <span className="config__note">Selected: {ALGORITHM_NAMES[config.algorithm]}</span>
        </div>

        <hr className="divider" />

        <Slider
          label="Maximum requests"
          value={config.maxRequests}
          min={maxR.min}
          max={maxR.max}
          minLabel={`${maxR.min} requests`}
          maxLabel={`${maxR.max} requests`}
          valueClassName="tone-accepted"
          onChange={(maxRequests) => onChange({ maxRequests })}
          disabled={disabled}
        />
        <Slider
          label="Time window"
          value={config.windowMs}
          min={win.min}
          max={win.max}
          step={1000}
          format={formatWindow}
          minLabel={formatWindow(win.min)}
          maxLabel={formatWindow(win.max)}
          onChange={(windowMs) => onChange({ windowMs })}
          disabled={disabled}
        />
        <span className="config__note">
          Configuration: {config.maxRequests} requests per {config.windowMs / 1000} seconds.
        </span>

        <hr className="divider" />

        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Rate limit key</span>
          <SegmentedControl label="Rate limit key" options={KEY_BY_OPTIONS} value={config.keyBy} onChange={(keyBy) => onChange({ keyBy })} disabled={disabled} />
          <span className="config__note">{KEY_BY_HELP[config.keyBy]}</span>
        </div>
      </fieldset>
    </div>
  );
}
