import { CONFIG_LIMITS, type Algorithm, type DefenseConfig, type KeyBy } from "../types";
import { Card } from "./ui/Card";
import { RadioCards, type RadioCardOption } from "./ui/RadioCards";
import { SegmentedControl, type SegmentOption } from "./ui/SegmentedControl";
import { Slider } from "./ui/Slider";

const ALGORITHM_OPTIONS: RadioCardOption<Algorithm>[] = [
  { value: "fixed", title: "Fixed window", description: "Cheap and simple. Bursts can double up at window edges." },
  { value: "sliding", title: "Sliding log", description: "Exact per window. Memory grows with requests." },
  { value: "token", title: "Token bucket", description: "Allows short bursts, then a steady refill rate." },
];

const KEY_BY_OPTIONS: SegmentOption<KeyBy>[] = [
  { value: "ip", label: "Key by IP" },
  { value: "user", label: "Key by user" },
];

interface ConfigPanelProps {
  config: DefenseConfig;
  onChange: (patch: Partial<DefenseConfig>) => void;
  disabled?: boolean;
}

/** Basic version (task 08). Styled in task 10. The reducer clamps every value to CONFIG_LIMITS. */
export function ConfigPanel({ config, onChange, disabled }: ConfigPanelProps) {
  return (
    <Card label="Configure your defense">
      <fieldset disabled={disabled} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 16 }}>
        <RadioCards label="Rate limiting algorithm" options={ALGORITHM_OPTIONS} value={config.algorithm} onChange={(algorithm) => onChange({ algorithm })} disabled={disabled} />
        <Slider
          label="Maximum requests"
          value={config.maxRequests}
          min={CONFIG_LIMITS.maxRequests.min}
          max={CONFIG_LIMITS.maxRequests.max}
          onChange={(maxRequests) => onChange({ maxRequests })}
          disabled={disabled}
        />
        <Slider
          label="Time window"
          value={config.windowMs}
          min={CONFIG_LIMITS.windowMs.min}
          max={CONFIG_LIMITS.windowMs.max}
          step={1000}
          format={(v) => `${v / 1000}s`}
          onChange={(windowMs) => onChange({ windowMs })}
          disabled={disabled}
        />
        <SegmentedControl label="Key by" options={KEY_BY_OPTIONS} value={config.keyBy} onChange={(keyBy) => onChange({ keyBy })} disabled={disabled} />
        <p className="muted" style={{ margin: 0 }}>
          Configuration: {config.maxRequests} requests per {config.windowMs / 1000} seconds.
        </p>
      </fieldset>
    </Card>
  );
}
