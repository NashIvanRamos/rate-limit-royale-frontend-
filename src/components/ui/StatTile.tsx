import type { ReactNode } from "react";

interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
}

/** One briefing stat (requests, client IPs, duration). Wrap several in `.stat-grid`. */
export function StatTile({ label, value, unit }: StatTileProps) {
  return (
    <div className="stat-tile">
      <span className="label">{label}</span>
      <span>
        <span className="stat-tile__value num">{value}</span>
        {unit && <span className="stat-tile__unit">{unit}</span>}
      </span>
    </div>
  );
}
