import { ALGORITHM_NAMES, formatWindow, KEY_BY_NAMES, refillLabel } from "../labels";
import type { DefenseConfig } from "../types";
import { Tag } from "./ui/Tag";

/** What will be deployed, mirrored live from the config. */
export function DefensePreview({ config }: { config: DefenseConfig }) {
  const rows: Array<[string, string]> = [
    ["Algorithm", ALGORITHM_NAMES[config.algorithm]],
    ["Max requests", String(config.maxRequests)],
    ["Window", formatWindow(config.windowMs)],
    ["Keying", KEY_BY_NAMES[config.keyBy]],
  ];
  if (config.algorithm === "token") rows.push(["Refill rate", refillLabel(config)]);

  return (
    <section className="preview" aria-label="Defense configuration preview">
      <div className="row spread">
        <h3 className="preview__title">Defense configuration</h3>
        <Tag tone="preview">Preview</Tag>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
