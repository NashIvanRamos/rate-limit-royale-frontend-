// THROWAWAY: visual check of the shared UI primitives. Uses sample values, never real results.
// Removed in task 15 together with the rest of src/debug/.
import { useState } from "react";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CountUp } from "../components/ui/CountUp";
import { DistributionBar } from "../components/ui/DistributionBar";
import { MetricRow } from "../components/ui/MetricRow";
import { ProgressBar } from "../components/ui/ProgressBar";
import { RadioCards } from "../components/ui/RadioCards";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Slider } from "../components/ui/Slider";
import { StatTile } from "../components/ui/StatTile";
import { StatusPill, type ServerStatus } from "../components/ui/StatusPill";
import { Tag } from "../components/ui/Tag";

type Algo = "fixed" | "sliding" | "token";
type KeyBy = "ip" | "user";

export function ComponentGallery() {
  const [algo, setAlgo] = useState<Algo>("fixed");
  const [keyBy, setKeyBy] = useState<KeyBy>("ip");
  const [max, setMax] = useState(10);
  const [windowMs, setWindowMs] = useState(10_000);
  const [status, setStatus] = useState<ServerStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(182);

  return (
    <main className="app">
      <p className="label">Component gallery (sample values)</p>

      <Card label="Status pill" aside={<StatusPill status={status} />}>
        <div className="row">
          {(["checking", "online", "offline"] as const).map((s) => (
            <Button key={s} onClick={() => setStatus(s)}>
              {s}
            </Button>
          ))}
        </div>
        <div className="row spread">
          <span className="label">Round</span>
          <span className="num">03 / 05</span>
          <span className="num tone-xp">1,240 XP</span>
        </div>
        <ProgressBar value={3 / 5} tone="xp" label="Round progress" />
      </Card>

      <Card label="Briefing" aside={<Tag tone="blocked">Incoming attack</Tag>}>
        <h2>Wave 02 · Edge Exploit</h2>
        <p className="muted" style={{ margin: 0 }}>Bursts aimed at the fixed-window boundary.</p>
        <div className="stat-grid">
          <StatTile label="Requests" value={46} />
          <StatTile label="Client IPs" value={3} />
          <StatTile label="Duration" value={5.4} unit="s" />
        </div>
      </Card>

      <Card label="Defense config">
        <RadioCards<Algo>
          label="Algorithm"
          value={algo}
          onChange={setAlgo}
          disabled={busy}
          options={[
            { value: "fixed", title: "Fixed window", description: "Cheap and simple. Bursts can double up at window edges." },
            { value: "sliding", title: "Sliding log", description: "Exact per window. Memory grows with requests." },
            { value: "token", title: "Token bucket", description: "Allows short bursts, then a steady refill rate." },
          ]}
        />
        <SegmentedControl<KeyBy>
          label="Key by"
          value={keyBy}
          onChange={setKeyBy}
          disabled={busy}
          options={[
            { value: "ip", label: "Key by IP" },
            { value: "user", label: "Key by user" },
          ]}
        />
        <Slider label="Max requests" value={max} min={5} max={100} onChange={setMax} disabled={busy} />
        <Slider
          label="Window"
          value={windowMs}
          min={1000}
          max={60000}
          step={1000}
          onChange={setWindowMs}
          format={(v) => `${v / 1000}s`}
          disabled={busy}
        />
      </Card>

      <Card label="Preview" accent="preview">
        <div className="row spread">
          <span>{algo}</span>
          <span className="num">
            {max} req / {windowMs / 1000}s
          </span>
          <span>{keyBy === "ip" ? "Key by IP" : "Key by user"}</span>
        </div>
      </Card>

      <Button variant="primary" fullWidth loading={busy} onClick={() => setBusy((b) => !b)}>
        {busy ? "Firing 140 / 300" : "Deploy Defense & Launch Attack"}
      </Button>
      {busy && <ProgressBar value={140 / 300} tone="accepted" label="Firing progress" />}

      <Card label="Results">
        <div className="metric-list">
          <MetricRow label="Accepted (200)" tone="accepted" value={<CountUp value={sample} />} />
          <MetricRow label="Blocked (429)" tone="blocked" value={<CountUp value={118} />} />
          <MetricRow label="Rejected auth (401)" tone="auth" value={<CountUp value={24} />} />
          <MetricRow label="Avg latency" value={<CountUp value={7} format={(n) => `${n} ms`} />} />
          <MetricRow label="Legit blocks" value={0} note="expired-token legit: 4 (not penalised)" />
        </div>
        <DistributionBar
          label="Response distribution"
          segments={[
            { label: "200", value: sample, tone: "accepted" },
            { label: "429", value: 118, tone: "blocked" },
            { label: "401", value: 24, tone: "auth" },
          ]}
        />
        <Button onClick={() => setSample((s) => (s === 182 ? 40 : 182))}>Change sample value</Button>
      </Card>

      <Banner tone="accepted" title="Cleared" aside={<span className="num tone-xp">+500 XP</span>}>
        Sliding window holds the line across the boundary.
      </Banner>
      <Banner tone="blocked" title="Breached" aside={<span className="num tone-xp">+12 XP</span>}>
        50 accounts, 50 budgets. Key by user let the rotation through.
      </Banner>
      <Banner tone="blocked" title="Backend offline" onDismiss={() => {}}>
        Start it with <code>DEMO_MODE=true npm run dev</code> on :3000.
      </Banner>
    </main>
  );
}
