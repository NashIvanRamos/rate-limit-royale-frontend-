import type { Algorithm, DefenseConfig } from "../types";
import { Card } from "./ui/Card";
import { MetricRow } from "./ui/MetricRow";
import { Tag } from "./ui/Tag";

const ALGORITHM_NAMES: Record<Algorithm, string> = {
  fixed: "Fixed Window",
  sliding: "Sliding Window",
  token: "Token Bucket",
};

/** Basic version (task 08). Styled in task 10. */
export function DefensePreview({ config }: { config: DefenseConfig }) {
  const refillS = config.windowMs / config.maxRequests / 1000;
  return (
    <Card label="Defense configuration" aside={<Tag tone="preview">Preview</Tag>} accent="preview">
      <div className="metric-list">
        <MetricRow label="Algorithm" value={ALGORITHM_NAMES[config.algorithm]} />
        <MetricRow label="Max requests" value={config.maxRequests} />
        <MetricRow label="Window" value={`${config.windowMs / 1000}s`} />
        <MetricRow label="Keying" value={config.keyBy === "ip" ? "Per IP" : "Per user"} />
        {config.algorithm === "token" && <MetricRow label="Refill" value={`1 token / ${refillS.toFixed(1)}s`} />}
      </div>
    </Card>
  );
}
