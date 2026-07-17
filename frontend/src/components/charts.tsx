"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  ComponentRow,
  SensorBreakdown,
  ShapContribution,
  SurvivalPoint,
  ThresholdRow,
  TimeseriesPoint,
} from "@/lib/types";
import { riskScoreColor, prettyFeature, prettySensor, fmtDateTime } from "@/lib/format";
import { useTheme } from "@/lib/store";

// Theme-aware chart chrome (grid, axes, tooltip). Series colors stay constant —
// the vibrant mid-tones read well on both light and dark backgrounds.
function useChartTheme() {
  const dark = useTheme((s) => s.theme) === "dark";
  return {
    grid: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)",
    axisLine: dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.15)",
    tick: { fontSize: 11, fill: "#64748b" } as const,
    tt: {
      contentStyle: {
        background: dark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.98)",
        border: dark ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(15,23,42,0.12)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        fontSize: 12,
        color: dark ? "#e2e8f0" : "#1e293b",
      },
      labelStyle: { color: dark ? "#94a3b8" : "#64748b", marginBottom: 4 },
      itemStyle: { color: dark ? "#e2e8f0" : "#1e293b" },
    },
  };
}


// ─── helpers ────────────────────────────────────────────────────────────────

// Axis tick label — always includes the year ("full date"). Adds time only for short spans.
function fmtTs(ms: number, spanHours: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (spanHours <= 72)
    return (
      d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    );
  return date;
}

function fmtTsLong(ms: number): string {
  const d = new Date(ms);
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  );
}

// ─── RiskOverTimeChart ───────────────────────────────────────────────────────

export function RiskOverTimeChart({ data, asOf }: { data: TimeseriesPoint[]; asOf?: string }) {
  const ct = useChartTheme();

  // Convert ISO strings → numeric ms once so everything downstream is numeric.
  // Recharts XAxis with type="number" + scale="time" gives proper proportional spacing.
  const allPoints = useMemo(
    () => data.map((p) => ({ ...p, ts: new Date(p.datetime).getTime() })),
    [data],
  );

  const asOfMs = useMemo(() => (asOf ? new Date(asOf).getTime() : null), [asOf]);

  // Show ONLY from the selected date onward (the future) — we're standing on `as_of`
  // and want to see what happens after it, not the history before it.
  const visible = useMemo(() => {
    if (!asOfMs || allPoints.length === 0) return allPoints;
    const fromNow = allPoints.filter((p) => p.ts >= asOfMs);
    return fromNow.length > 1 ? fromNow : allPoints;
  }, [allPoints, asOfMs]);

  const spanHours = useMemo(() => {
    if (visible.length < 2) return 8760;
    return (visible[visible.length - 1].ts - visible[0].ts) / 3_600_000;
  }, [visible]);

  const domainMin = visible.length > 0 ? visible[0].ts : 0;
  const domainMax = visible.length > 0 ? visible[visible.length - 1].ts : 1;

  const asOfLabel = asOfMs ? fmtTsLong(asOfMs) : "";

  return (
    <div>
      {asOfMs && (
        <div className="mb-2 text-[11px] font-medium text-indigo-500 dark:text-indigo-400">
          From {asOfLabel} onward → {fmtTsLong(domainMax)}
        </div>
      )}

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={visible} margin={{ top: 18, right: 16, bottom: 4, left: -8 }}>
          <defs>
            <linearGradient id="rsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#f43f5e" stopOpacity={0.6} />
              <stop offset="60%"  stopColor="#fb923c" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={ct.grid} vertical={false} />

          {/* Numeric time axis — proportional spacing, no categorical distortion */}
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[domainMin, domainMax]}
            tickFormatter={(v) => fmtTs(Number(v), spanHours)}
            tick={ct.tick}
            minTickGap={64}
            stroke={ct.axisLine}
          />

          <YAxis
            domain={[0, (max: number) => Math.max(1.2, Math.ceil(max * 10) / 10 + 0.1)]}
            tick={ct.tick}
            stroke={ct.axisLine}
            tickFormatter={(v) => Number(v).toFixed(1)}
          />

          <Tooltip
            {...ct.tt}
            labelFormatter={(v) => fmtTsLong(Number(v))}
            formatter={(v, name) =>
              name === "risk_score"
                ? [Number(v).toFixed(3), "H(t) cumulative hazard"]
                : [v, name]
            }
          />

          {/* Failure threshold line */}
          <ReferenceLine
            y={1.0}
            stroke="#f43f5e"
            strokeDasharray="5 4"
            label={{ value: "maintenance (H = 1.0)", position: "insideTopRight", fontSize: 10, fill: "#f43f5e" }}
          />

          {/* Start marker at the selected date (left edge of the future window) */}
          {asOfMs && (
            <ReferenceLine
              x={asOfMs}
              stroke="#6366f1"
              strokeWidth={2}
              label={{
                value: `${asOfLabel} ▶`,
                position: "insideTopLeft",
                fontSize: 10,
                fontWeight: 700,
                fill: "#6366f1",
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey="risk_score"
            stroke="#fb923c"
            strokeWidth={2.2}
            fill="url(#rsGrad)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── MaintenanceProjectionChart ─────────────────────────────────────────────
// Forecasts degradation from the selected date. It does NOT use actual replacements
// and does NOT reset — with no maintenance assumed, H(t) = (age/cycle)^shape grows
// MONOTONICALLY as the part keeps ageing. The point where it crosses 1.0 is the
// predicted maintenance-due date; the curve continues rising past it to show that,
// left unserviced, the part degrades further.
export function MaintenanceProjectionChart({
  asOf,
  elapsedDays,
  cycleDays,
  shape,
  dueNow = false,
  dueNowLabel = "REPLACE NOW",
}: {
  asOf?: string;
  elapsedDays: number;
  cycleDays: number;
  shape: number;
  dueNow?: boolean;      // classifier predicts imminent failure → replace on the selected day
  dueNowLabel?: string;
}) {
  const ct = useChartTheme();

  const PAD_DAYS = 15;  // left padding so the "you are here" marker isn't on the y-axis

  const { pts, startMs, dueMs, maxH } = useMemo(() => {
    const DAY = 86_400_000;
    const start = asOf ? new Date(asOf).getTime() : 0;
    const cycle = cycleDays > 0 ? cycleDays : 1;
    const s = shape > 0 ? shape : 1;
    // When the classifier flags failure now, the machine is AT the maintenance threshold:
    // pin its effective age to the full cycle so H = 1.0 exactly on the selected day.
    const effElapsed = dueNow ? cycle : elapsedDays;

    // Project until H ≈ 2.2 (well past the maintenance line) so the crossing is clear.
    const targetMaxH = 2.2;
    const ageAtMax = cycle * Math.pow(targetMaxH, 1 / s);
    const totalDays = Math.max(ageAtMax - effElapsed, cycle * 0.75);

    const step = Math.max(totalDays / 120, 0.5);
    const pts: { ts: number; h: number }[] = [];
    let maxH = 0;
    // Start PAD_DAYS *before* the selected date (age clamped ≥ 0) for left breathing room.
    for (let t = -PAD_DAYS; t <= totalDays + 1e-6; t += step) {
      const age = Math.max(effElapsed + t, 0); // monotonic — no reset
      const h = Math.pow(age / cycle, s);
      if (t >= 0) maxH = Math.max(maxH, h);
      pts.push({ ts: start + t * DAY, h });
    }

    // Maintenance-due date = where H crosses 1.0 (age == cycle) → the selected day when due now.
    const dueDays = cycle - effElapsed;
    const dueMs = start + Math.max(dueDays, 0) * DAY;

    return { pts, startMs: start, dueMs, maxH };
  }, [asOf, elapsedDays, cycleDays, shape, dueNow]);

  const domainMin = pts.length ? pts[0].ts : startMs;
  const domainMax = pts.length ? pts[pts.length - 1].ts : startMs + 1;
  const overdue = elapsedDays >= cycleDays;
  const yTop = Math.max(1.2, Math.ceil(maxH * 10) / 10);

  return (
    <div>
      <div className="mb-2 text-[11px] font-medium text-indigo-500 dark:text-indigo-400">
        Forecast from {fmtTsLong(startMs)} ·{" "}
        {dueNow ? (
          <span className="font-semibold text-rose-500">replace now — classifier predicts failure within 12h</span>
        ) : overdue ? (
          <span className="font-semibold text-rose-500">maintenance already due (overdue)</span>
        ) : (
          <>maintenance due at H = 1.0 → <span className="font-semibold">{fmtTsLong(dueMs)}</span></>
        )}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={pts} margin={{ top: 18, right: 16, bottom: 4, left: -8 }}>
          <defs>
            <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.55} />
              <stop offset="60%" stopColor="#fb923c" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[domainMin, domainMax]}
            tickFormatter={(v) => fmtTs(Number(v), 8760)}
            tick={ct.tick}
            minTickGap={64}
            stroke={ct.axisLine}
          />
          <YAxis
            domain={[0, yTop]}
            tickFormatter={(v) => Number(v).toFixed(1)}
            tick={ct.tick}
            stroke={ct.axisLine}
          />
          <Tooltip
            {...ct.tt}
            labelFormatter={(v) => fmtTsLong(Number(v))}
            formatter={(v) => [Number(v).toFixed(2), "projected H(t)"]}
          />
          {/* Maintenance threshold */}
          <ReferenceLine
            y={1.0}
            stroke="#f43f5e"
            strokeDasharray="5 4"
            label={{ value: "maintenance (H = 1.0)", position: "insideTopRight", fontSize: 10, fill: "#f43f5e" }}
          />
          {/* Maintenance-due date — where the rising curve crosses 1.0 (hidden if due now) */}
          {!overdue && !dueNow && (
            <ReferenceLine
              x={dueMs}
              stroke="#f43f5e"
              strokeWidth={1.6}
              strokeDasharray="3 3"
              label={{ value: `▲ due ${fmtTs(dueMs, 8760)}`, position: "top", fontSize: 10, fontWeight: 700, fill: "#f43f5e" }}
            />
          )}
          {/* Classifier predicts failure NOW → solid "replace now" marker on the selected day */}
          {dueNow && (
            <ReferenceLine
              x={startMs}
              stroke="#dc2626"
              strokeWidth={2.4}
              label={{ value: `▲ ${dueNowLabel} · ${fmtTs(startMs, 8760)}`, position: "top", fontSize: 10.5, fontWeight: 800, fill: "#dc2626" }}
            />
          )}
          <Area type="monotone" dataKey="h" stroke="#fb923c" strokeWidth={2.2} fill="url(#projGrad)" dot={false} isAnimationActive={false} />
          {dueNow && <ReferenceDot x={startMs} y={1.0} r={5.5} fill="#dc2626" stroke="#ffffff" strokeWidth={1.5} ifOverflow="extendDomain" />}
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        {dueNow ? (
          <>Risk is at the maintenance threshold (<span className="font-medium text-rose-500 dark:text-rose-400">H = 1.0</span>) now — the classifier predicts failure within 12h, so replace today. The curve keeps climbing to show continued degradation if left unserviced.</>
        ) : overdue ? (
          <>This part is already past its {Math.round(cycleDays)}-day cycle — H keeps rising the longer it runs unserviced.</>
        ) : (
          <>H rises as the part ages and crosses 1.0 on <span className="font-medium text-rose-500 dark:text-rose-400">{fmtTsLong(dueMs)}</span> — its predicted maintenance date. It keeps climbing beyond to show continued degradation if left unserviced.</>
        )}
      </div>
    </div>
  );
}

// A ReferenceLine label that hugs the line instead of centering on it, so an edge marker
// never spills left over the y-axis "100%" tick. Flips to the left side near the right edge.
function EdgeMarkerLabel({
  viewBox, value, color, weight = 700, align = "left", dyTop = -7,
}: {
  viewBox?: { x?: number; y?: number };
  value: string; color: string; weight?: number; align?: "left" | "right"; dyTop?: number;
}) {
  const vx = viewBox?.x ?? 0;
  const vy = viewBox?.y ?? 0;
  const right = align === "right";
  return (
    <text
      x={vx + (right ? -7 : 7)}
      y={vy + dyTop}
      textAnchor={right ? "end" : "start"}
      fontSize={11}
      fontWeight={weight}
      fill={color}
    >
      {value}
    </text>
  );
}

// ─── ClassifierRiskChart ────────────────────────────────────────────────────
// The 12-hour failure PROBABILITY over time (the XGBoost classifier output), as %.
// Flat near 0 when healthy, spiking toward 100% when sensor patterns look dangerous —
// this demonstrates the classifier is live and reacting, even if it reads ~0 right now.
export function ClassifierRiskChart({
  data,
  threshold,
  asOf,
}: {
  data: { datetime: string; risk: number; label?: number }[];
  threshold: number;
  asOf?: string;
}) {
  const ct = useChartTheme();
  const asOfMs = asOf ? new Date(asOf).getTime() : null;

  // Start exactly at the selected date — show only that date onward, nothing before it.
  const vis = useMemo(() => {
    if (!asOfMs) return data;
    const f = data.filter((p) => new Date(p.datetime).getTime() >= asOfMs);
    return f.length > 1 ? f : data;
  }, [data, asOfMs]);

  const pts = useMemo(
    () => vis.map((p) => ({ ts: new Date(p.datetime).getTime(), risk: p.risk * 100 })),
    [vis],
  );

  // Actual failure windows (runs of label === 1) within the visible range + peak-risk point.
  const { failWindows, events } = useMemo(() => {
    const failWindows: { x1: number; x2: number }[] = [];
    const events: { ts: number; risk: number; caught: boolean }[] = [];
    let win: { x1: number; x2: number } | null = null;
    let peak: { ts: number; risk: number } | null = null;
    const close = () => {
      if (win) failWindows.push(win);
      if (peak) events.push({ ...peak, caught: peak.risk >= threshold * 100 });
      win = null;
      peak = null;
    };
    for (const p of vis) {
      const ms = new Date(p.datetime).getTime();
      const r = p.risk * 100;
      if (p.label === 1) {
        if (!win) { win = { x1: ms, x2: ms }; peak = { ts: ms, risk: r }; }
        else { win.x2 = ms; if (!peak || r > peak.risk) peak = { ts: ms, risk: r }; }
      } else if (win) {
        close();
      }
    }
    close();
    return { failWindows, events };
  }, [vis, threshold]);

  const caughtCount = events.filter((e) => e.caught).length;
  const spanHours = pts.length > 1 ? (pts[pts.length - 1].ts - pts[0].ts) / 3_600_000 : 8760;
  const domainMin = pts.length ? pts[0].ts : 0;
  const domainMax = pts.length ? pts[pts.length - 1].ts : 1;

  return (
    <div>
      {asOfMs && (
        <div className="mb-2 text-[11px] font-medium text-indigo-500 dark:text-indigo-400">
          From {fmtTsLong(asOfMs)} onward · {events.length
            ? <>{caughtCount}/{events.length} failures caught in view</>
            : "no failures in this window"}
        </div>
      )}
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={pts} margin={{ top: 14, right: 16, bottom: 4, left: -6 }}>
          <defs>
            <linearGradient id="clsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={0.7} />
              <stop offset="45%" stopColor="#f43f5e" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[domainMin, domainMax]}
            tickFormatter={(v) => fmtTs(Number(v), spanHours)}
            tick={ct.tick}
            minTickGap={64}
            stroke={ct.axisLine}
          />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={ct.tick} stroke={ct.axisLine} />
          <Tooltip
            {...ct.tt}
            labelFormatter={(v) => fmtTsLong(Number(v))}
            formatter={(v) => {
              const p = Number(v);
              const state = p >= threshold * 100 ? "  · ALERT" : "";
              return [`${p.toFixed(1)}%${state}`, "failure chance (12h)"];
            }}
          />
          {/* Faint band marking each actual failure window */}
          {failWindows.map((w, i) => (
            <ReferenceArea key={i} x1={w.x1} x2={w.x2} fill="#10b981" fillOpacity={0.18} ifOverflow="extendDomain" />
          ))}
          {/* A vertical guide at each real failure so events are visible even when thin */}
          {events.map((e, i) => (
            <ReferenceLine key={`l${i}`} x={e.ts} stroke="#10b981" strokeOpacity={0.5} strokeWidth={1} />
          ))}
          <ReferenceLine
            y={threshold * 100}
            stroke="#6366f1"
            strokeDasharray="5 4"
            label={{ value: `alert (${Math.round(threshold * 100)}%)`, position: "insideTopRight", fontSize: 10, fill: "#6366f1" }}
          />
          {/* "You are here" — the selected date, at the left edge (label hugs the line) */}
          {asOfMs && (
            <ReferenceLine x={asOfMs} stroke="#6366f1" strokeWidth={1.8} strokeDasharray="4 3"
              label={<EdgeMarkerLabel value={`▼ ${fmtTs(asOfMs, 8760)}`} color="#6366f1" weight={700} dyTop={11} />} />
          )}
          <Area type="monotone" dataKey="risk" stroke="#f43f5e" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="url(#clsGrad)" dot={false} activeDot={{ r: 3.5, fill: "#f43f5e", stroke: "#ffffff", strokeWidth: 1.5 }} isAnimationActive={false} />
          {/* Peak-of-spike markers: green ring = model caught it, amber = missed (soft halo behind) */}
          {events.map((e, i) => (
            <ReferenceDot
              key={`h${i}`}
              x={e.ts}
              y={e.risk}
              r={9}
              fill={e.caught ? "#10b981" : "#f59e0b"}
              fillOpacity={0.16}
              stroke="none"
              ifOverflow="extendDomain"
            />
          ))}
          {events.map((e, i) => (
            <ReferenceDot
              key={`d${i}`}
              x={e.ts}
              y={e.risk}
              r={4.5}
              fill={e.caught ? "#10b981" : "#f59e0b"}
              stroke="#ffffff"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm" style={{ background: "#f43f5e" }} /> model&apos;s failure chance</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#10b981" }} /> failure the model caught</span>
        {caughtCount < events.length && (
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#f59e0b" }} /> failure it missed</span>
        )}
        <span>· {caughtCount}/{events.length} caught</span>
      </div>
    </div>
  );
}

export function SensorTraceChart({
  data,
  sensor,
  band,
}: {
  data: TimeseriesPoint[];
  sensor: keyof TimeseriesPoint;
  band?: { lower: number; upper: number };
}) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="datetime" tickFormatter={(iso) => fmtTs(new Date(iso).getTime(), 720)} tick={ct.tick} minTickGap={48} stroke={ct.axisLine} />
        <YAxis tick={ct.tick} domain={["auto", "auto"]} stroke={ct.axisLine} />
        <Tooltip {...ct.tt} labelFormatter={(l) => fmtDateTime(String(l))} />
        {band && <ReferenceArea y1={band.lower} y2={band.upper} fill="#34d399" fillOpacity={0.1} />}
        {band && <ReferenceLine y={band.upper} stroke="#34d399" strokeDasharray="3 3" strokeOpacity={0.5} />}
        {band && <ReferenceLine y={band.lower} stroke="#34d399" strokeDasharray="3 3" strokeOpacity={0.5} />}
        <Line type="monotone" dataKey={sensor as string} stroke="#0ea5e9" dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SurvivalCurveChart({
  curve,
  baseline,
  rulDays,
  ciLow,
  ciHigh,
  asOf,
  dueNow = false,
}: {
  curve: SurvivalPoint[];
  baseline?: SurvivalPoint[];
  rulDays: number;
  ciLow: number;
  ciHigh: number;
  asOf?: string;
  dueNow?: boolean;   // classifier flags failure now → replace marker sits at day 0
}) {
  const ct = useChartTheme();

  // Convert a days_ahead offset to an actual calendar date string
  const daysToDate = (days: number): string => {
    if (!asOf) return `+${Math.round(days)}d`;
    const d = new Date(asOf);
    d.setTime(d.getTime() + days * 86_400_000);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  const merged = curve.map((p) => {
    const b = baseline?.find((q) => Math.abs(q.days_ahead - p.days_ahead) < 1.5);
    return { days_ahead: p.days_ahead, model: p.survival_prob, baseline: b?.survival_prob };
  });

  // Domain + clean evenly-spaced ticks so the axis is proportional and uncrowded.
  const maxDays = merged.length > 0 ? merged[merged.length - 1].days_ahead : 180;
  const ticks = useMemo(() => {
    // Aim for ~6 ticks at "nice" day intervals (30/45/60...).
    const targetCount = 6;
    const rawStep = maxDays / targetCount;
    const niceSteps = [7, 14, 15, 30, 45, 60, 90];
    const step = niceSteps.find((s) => s >= rawStep) ?? 90;
    const out: number[] = [];
    for (let d = 0; d <= maxDays + 0.5; d += step) out.push(Math.round(d));
    return out;
  }, [maxDays]);

  // Where the "replace" marker sits: at day 0 (now) if the classifier flags failure, else RUL.
  const markerDays = dueNow ? 0 : rulDays;
  const rulLineLabel = dueNow
    ? "Replace now"
    : rulDays > 0
      ? asOf
        ? `Replace by ${daysToDate(rulDays)}`
        : `RUL ≈ ${Math.round(rulDays)} days`
      : "";

  return (
    <ResponsiveContainer width="100%" height={290}>
      <ComposedChart data={merged} margin={{ top: 34, right: 22, bottom: 28, left: -6 }}>
        <defs>
          <linearGradient id="survGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.55} />
            <stop offset="55%" stopColor="#8b5cf6" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="survStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis
          dataKey="days_ahead"
          type="number"
          scale="linear"
          domain={[0, maxDays]}
          ticks={ticks}
          interval={0}
          tick={ct.tick}
          stroke={ct.axisLine}
          tickFormatter={(v) => daysToDate(Number(v))}
          tickMargin={8}
          label={
            asOf
              ? { value: "projected date →", position: "insideBottomRight", offset: -4, fontSize: 10, fill: "#94a3b8" }
              : { value: "days ahead", position: "insideBottom", offset: -2, fontSize: 11, fill: "#64748b" }
          }
        />
        <YAxis
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
          tick={ct.tick}
          stroke={ct.axisLine}
        />
        <Tooltip
          {...ct.tt}
          formatter={(v, _n, item) => [
            `${(Number(v) * 100).toFixed(0)}%`,
            item?.dataKey === "baseline" ? "typical machine" : "this machine",
          ]}
          labelFormatter={(d) =>
            asOf
              ? `${daysToDate(Number(d))} · +${Math.round(Number(d))} days`
              : `day +${d}`
          }
        />
        {/* likely-range (confidence) band — label at the bottom, clear of the Replace marker up top */}
        <ReferenceArea
          x1={ciLow}
          x2={ciHigh}
          fill="#8b5cf6"
          fillOpacity={0.09}
          label={{ value: "typical range", position: "insideBottom", fontSize: 9, fontWeight: 600, fill: "#a78bfa" }}
        />
        {/* 50% guide line */}
        <ReferenceLine
          y={0.5}
          stroke={ct.axisLine}
          strokeDasharray="3 3"
          label={{ value: "50% — median life", position: "insideBottomRight", fontSize: 9, fill: "#94a3b8" }}
        />
        {/* curves */}
        <Area
          type="monotone"
          dataKey="model"
          name="this machine"
          stroke="url(#survStroke)"
          fill="url(#survGrad)"
          strokeWidth={2.6}
          strokeLinecap="round"
          activeDot={{ r: 4, fill: "#8b5cf6", stroke: "#ffffff", strokeWidth: 1.5 }}
        />
        {baseline && (
          <Line type="monotone" dataKey="baseline" name="typical machine" stroke="#94a3b8" strokeDasharray="5 4" dot={false} strokeWidth={1.4} strokeLinecap="round" />
        )}
        {/* Replace marker — at "now" (day 0) when the classifier flags failure, else at RUL */}
        {(dueNow || rulDays > 0) && (
          <ReferenceLine
            x={markerDays}
            stroke={dueNow ? "#dc2626" : "#f43f5e"}
            strokeWidth={dueNow ? 2.4 : 1.8}
            label={
              <EdgeMarkerLabel
                value={rulLineLabel}
                color={dueNow ? "#dc2626" : "#f43f5e"}
                weight={dueNow ? 800 : 700}
                align={markerDays > maxDays * 0.62 ? "right" : "left"}
                dyTop={-9}
              />
            }
          />
        )}
        {/* soft halo behind the marker dot for a subtle glow */}
        {(dueNow || rulDays > 0) && (
          <ReferenceDot x={markerDays} y={dueNow ? 1.0 : 0.5} r={dueNow ? 11 : 9} fill={dueNow ? "#dc2626" : "#f43f5e"} fillOpacity={0.16} stroke="none" ifOverflow="extendDomain" />
        )}
        {(dueNow || rulDays > 0) && (
          <ReferenceDot x={markerDays} y={dueNow ? 1.0 : 0.5} r={dueNow ? 5.5 : 4.5} fill={dueNow ? "#dc2626" : "#f43f5e"} stroke="#ffffff" strokeWidth={1.5} ifOverflow="extendDomain" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RulGauge({ rulDays, capped, maxDays = 180, dueNow = false }: { rulDays: number; capped: boolean; maxDays?: number; dueNow?: boolean }) {
  // When the classifier flags failure now, the gauge is full red "service now" — it overrides
  // the statistical days-left estimate.
  const pct = dueNow ? 100 : capped ? 100 : Math.min(100, (rulDays / maxDays) * 100);
  const color = dueNow ? "#dc2626" : riskScoreColor(100 - pct);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={160}>
        <RadialBarChart innerRadius="66%" outerRadius="100%" data={[{ value: pct }]} startAngle={210} endAngle={-30}>
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity={0.7} />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: "rgba(100,116,139,0.18)" }} dataKey="value" cornerRadius={12} fill="url(#gaugeGrad)" />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-4">
        {dueNow ? (
          <>
            <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">Now</span>
            <span className="text-xs text-rose-500 dark:text-rose-400">service due</span>
          </>
        ) : (
          <>
            <span className="text-3xl font-bold text-slate-900 dark:text-white">{capped ? "1yr+" : Math.round(rulDays)}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">days left</span>
          </>
        )}
      </div>
    </div>
  );
}

export function ShapBarChart({ data }: { data: ShapContribution[] }) {
  const ct = useChartTheme();
  const rows = [...data].reverse();
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.shap_value)), 0.01);
  const domainPad = maxAbs * 1.15;

  const axisTickFmt = (v: number) => {
    if (Math.abs(v) < 0.001) return "← Safer  |  Riskier →";
    return "";
  };

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 28)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 16, left: 8 }}>
        <CartesianGrid stroke={ct.grid} horizontal={false} />
        <XAxis
          type="number"
          domain={[-domainPad, domainPad]}
          tick={ct.tick}
          stroke={ct.axisLine}
          tickFormatter={(v) => (Math.abs(v) < 0.001 ? "" : Number(v).toFixed(1))}
          label={{ value: "← Less risk of failure   |   More risk of failure →", position: "insideBottom", offset: -10, fontSize: 10, fill: "#64748b" }}
        />
        <YAxis
          type="category"
          dataKey="feature"
          tickFormatter={prettyFeature}
          tick={{ fontSize: 10, fill: "#64748b" }}
          width={175}
          stroke={ct.axisLine}
        />
        <Tooltip
          {...ct.tt}
          labelFormatter={(l) => prettyFeature(String(l))}
          formatter={(v) => {
            const n = Number(v);
            const impact = Math.abs(n) / maxAbs >= 0.6 ? "Strong" : Math.abs(n) / maxAbs >= 0.3 ? "Moderate" : "Minor";
            const dir = n >= 0 ? "Increases failure risk" : "Reduces failure risk";
            return [`${dir} · ${impact} impact`, "Effect"];
          }}
        />
        <ReferenceLine x={0} stroke={ct.axisLine} strokeWidth={1.5} />
        <Bar dataKey="shap_value" radius={[0, 3, 3, 0]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.shap_value >= 0 ? "#f43f5e" : "#10b981"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SensorViolationChart({ data }: { data: SensorBreakdown[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={ct.grid} horizontal={false} />
        <XAxis type="number" tick={ct.tick} stroke={ct.axisLine} />
        <YAxis type="category" dataKey="sensor" tickFormatter={prettySensor} tick={{ fontSize: 11, fill: "#64748b" }} width={88} stroke={ct.axisLine} />
        <Tooltip {...ct.tt} labelFormatter={(l) => prettySensor(String(l))} formatter={(v) => Number(v).toFixed(3)} />
        <Bar dataKey="normalized_exceedance" radius={3} name="exceedance">
          {data.map((r, i) => (
            <Cell key={i} fill={r.in_band ? "#10b981" : "#f43f5e"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ThresholdSweepChart({ data, current }: { data: ThresholdRow[]; current: number }) {
  const ct = useChartTheme();
  const pct = data.map((r) => ({
    threshold: r.threshold,
    "Failures caught": Math.round(r.recall * 100),
    "Right alerts": Math.round(r.precision * 100),
    "Balance (F1)": Math.round(r.f1 * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={270}>
      <LineChart data={pct} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis
          dataKey="threshold"
          tick={ct.tick}
          stroke={ct.axisLine}
          label={{ value: "Alert sensitivity", position: "insideBottom", offset: -2, fontSize: 10, fill: "#64748b" }}
        />
        <YAxis
          domain={[0, 100]}
          tick={ct.tick}
          stroke={ct.axisLine}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          {...ct.tt}
          formatter={(v, name) => [`${v} out of 100`, String(name)]}
          labelFormatter={(l) => `Sensitivity: ${Number(l).toFixed(2)}`}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => <span style={{ color: "#64748b" }}>{value}</span>}
        />
        <ReferenceLine
          x={current}
          stroke="#6366f1"
          strokeDasharray="4 4"
          label={{ value: `current (${current.toFixed(2)})`, position: "insideTopLeft", fontSize: 9, fill: "#6366f1" }}
        />
        <Line type="monotone" dataKey="Failures caught" stroke="#10b981" dot={false} strokeWidth={2.5} />
        <Line type="monotone" dataKey="Right alerts" stroke="#0ea5e9" dot={false} strokeWidth={2.5} />
        <Line type="monotone" dataKey="Balance (F1)" stroke="#f59e0b" dot={false} strokeWidth={2} strokeDasharray="5 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ComponentBarChart({ data }: { data: ComponentRow[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="component" tick={ct.tick} stroke={ct.axisLine} />
        <YAxis domain={[0, 1]} tick={ct.tick} stroke={ct.axisLine} />
        <Tooltip {...ct.tt} formatter={(v) => Number(v).toFixed(3)} />
        <Bar dataKey="precision" fill="#0ea5e9" radius={3} />
        <Bar dataKey="recall" fill="#10b981" radius={3} />
        <Bar dataKey="f1" fill="#f59e0b" radius={3} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function UrgencyDonut({ counts }: { counts: { name: string; value: number; color: string }[] }) {
  const ct = useChartTheme();
  const total = counts.reduce((s, c) => s + c.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={210}>
        <PieChart>
          <Pie data={counts} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} stroke="none">
            {counts.map((c, i) => (
              <Cell key={i} fill={c.color} />
            ))}
          </Pie>
          <Tooltip {...ct.tt} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-slate-900 dark:text-white">{total}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">machines</span>
      </div>
    </div>
  );
}

export function RiskHistogram({ values }: { values: number[] }) {
  const ct = useChartTheme();
  const bins = Array.from({ length: 10 }, (_, i) => ({ bucket: `${i * 10}`, count: 0 }));
  values.forEach((v) => {
    const i = Math.min(9, Math.max(0, Math.floor(v * 10)));
    bins[i].count += 1;
  });
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={bins} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="bucket" tick={ct.tick} stroke={ct.axisLine} unit="%" />
        <YAxis tick={ct.tick} stroke={ct.axisLine} allowDecimals={false} />
        <Tooltip {...ct.tt} labelFormatter={(l) => `risk ${l}–${Number(l) + 10}%`} formatter={(v) => [String(v), "machines"]} />
        <Bar dataKey="count" fill="url(#histGrad)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
