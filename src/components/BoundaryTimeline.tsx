import type { BoundaryTimeline as Timeline } from "../types";

const WIDTH = 600;
const HEIGHT = 84;
const PAD_X = 12;
const DOT_R = 3.5;
const BASELINE = HEIGHT - 14;

/**
 * Round 2's story in one strip: every attacker request as a dot at the time it reached the server,
 * relative to the window boundary the bursts aimed at. Under fixed window both bursts pass, because
 * they land in different windows.
 */
export function BoundaryTimeline({ timeline }: { timeline: Timeline }) {
  const { points } = timeline;
  if (points.length === 0) return null;

  const ts = points.map((p) => p.t);
  const lo = Math.min(-200, ...ts) - 100;
  const hi = Math.max(200, ...ts) + 100;
  const x = (t: number) => PAD_X + ((t - lo) / (hi - lo)) * (WIDTH - 2 * PAD_X);

  // Stack dots that land on the same pixel column so every request stays visible.
  const stacks = new Map<number, number>();
  const dots = [...points]
    .sort((a, b) => a.t - b.t)
    .map((p) => {
      const col = Math.round(x(p.t) / (DOT_R * 2.2));
      const level = stacks.get(col) ?? 0;
      stacks.set(col, level + 1);
      return { cx: col * DOT_R * 2.2, cy: BASELINE - DOT_R - level * DOT_R * 2.2, status: p.status };
    });

  const passed = points.filter((p) => p.status === 200).length;
  const before = points.filter((p) => p.t < 0 && p.status === 200).length;

  return (
    <figure className="timeline" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={`Attacker requests around the window boundary: ${passed} passed, ${before} of them before the boundary.`}>
        <line x1={PAD_X} x2={WIDTH - PAD_X} y1={BASELINE} y2={BASELINE} className="timeline__axis" />
        <line x1={x(0)} x2={x(0)} y1={4} y2={BASELINE + 6} className="timeline__boundary" />
        <text x={x(0) + 6} y={14} className="timeline__label">
          window boundary
        </text>
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={DOT_R} className={d.status === 200 ? "timeline__dot--ok" : d.status === 429 ? "timeline__dot--blocked" : "timeline__dot--other"} />
        ))}
      </svg>
      <figcaption className="config__note">
        Each dot is one attacker request: <span className="tone-accepted">passed</span> or <span className="tone-blocked">blocked</span>, placed by when it
        reached the server.
      </figcaption>
    </figure>
  );
}
