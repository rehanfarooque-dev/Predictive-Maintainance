"use client";

import { useMemo, useState } from "react";
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


const RISK_WINDOWS = [
  { label: "24h",  hours: 24 },
  { label: "3d",   hours: 72 },
  { label: "7d",   hours: 168 },
  { label: "30d",  hours: 720 },
  { label: "All",  hours: null },
] as const;

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtTs(ms: number, spanHours: number): string {
  const d = new Date(ms);
  if (spanHours <= 48)
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (spanHours <= 336)
    return (
      d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    );
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
  const [windowHours, setWindowHours] = useState<number | null>(168);

  // Convert ISO strings → numeric ms once so everything downstream is numeric.
  // Recharts XAxis with type="number" + scale="time" gives proper proportional spacing.
  const allPoints = useMemo(
    () => data.map((p) => ({ ...p, ts: new Date(p.datetime).getTime() })),
    [data],
  );

  const asOfMs = useMemo(() => (asOf ? new Date(asOf).getTime() : null), [asOf]);

  // Window anchors to the selected as_of point so "7d" = last 7 days before selection.
  const anchorMs = asOfMs ?? (allPoints.length > 0 ? allPoints[allPoints.length - 1].ts : 0);

  const visible = useMemo(() => {
    if (!windowHours || allPoints.length === 0) return allPoints;
    const cutoff = anchorMs - windowHours * 3_600_000;
    return allPoints.filter((p) => p.ts >= cutoff);
  }, [allPoints, windowHours, anchorMs]);

  const spanHours = useMemo(() => {
    if (visible.length < 2) return windowHours ?? 8760;
    return (visible[visible.length - 1].ts - visible[0].ts) / 3_600_000;
  }, [visible, windowHours]);

  const domainMin = visible.length > 0 ? visible[0].ts : 0;
  const domainMax = visible.length > 0 ? visible[visible.length - 1].ts : 1;

  const asOfLabel = asOfMs ? fmtTs(asOfMs, 0) : ""; // always date+time for the marker label

  return (
    <div>
      {/* ── window selector ── */}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">Window</span>
        {RISK_WINDOWS.map((w) => (
          <button
            key={w.label}
            onClick={() => setWindowHours(w.hours)}
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              windowHours === w.hours
                ? "bg-indigo-500 text-white"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-400 dark:hover:bg-white/20"
            }`}
          >
            {w.label}
          </button>
        ))}
        {asOfMs && (
          <span className="ml-auto text-[10px] font-medium text-indigo-500 dark:text-indigo-400">
            ▌ selected: {fmtTsLong(asOfMs)}
          </span>
        )}
      </div>

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

          {/* Shade everything after the selected timestamp (future data) */}
          {asOfMs && domainMax > asOfMs && (
            <ReferenceArea
              x1={asOfMs}
              x2={domainMax}
              fill="#818cf8"
              fillOpacity={0.07}
            />
          )}

          {/* Failure threshold line */}
          <ReferenceLine
            y={1.0}
            stroke="#f43f5e"
            strokeDasharray="5 4"
            label={{ value: "failure (1.0)", position: "insideTopRight", fontSize: 10, fill: "#f43f5e" }}
          />

          {/* "You are here" vertical line */}
          {asOfMs && (
            <ReferenceLine
              x={asOfMs}
              stroke="#6366f1"
              strokeWidth={2}
              strokeDasharray="4 3"
              label={{
                value: `◀ ${asOfLabel}`,
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
}: {
  curve: SurvivalPoint[];
  baseline?: SurvivalPoint[];
  rulDays: number;
  ciLow: number;
  ciHigh: number;
  asOf?: string;
}) {
  const ct = useChartTheme();

  // Convert a days_ahead offset to an actual calendar date string
  const daysToDate = (days: number): string => {
    if (!asOf) return `+${Math.round(days)}d`;
    const d = new Date(asOf);
    d.setTime(d.getTime() + days * 86_400_000);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

  // Label on the RUL reference line: actual date when possible
  const rulLineLabel =
    rulDays > 0
      ? asOf
        ? `Replace by ${daysToDate(rulDays)}`
        : `RUL ≈ ${Math.round(rulDays)} days`
      : "";

  return (
    <ResponsiveContainer width="100%" height={290}>
      <ComposedChart data={merged} margin={{ top: 30, right: 22, bottom: 28, left: -6 }}>
        <defs>
          <linearGradient id="survGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
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
          formatter={(v, n) => [
            `${(Number(v) * 100).toFixed(0)}%`,
            n === "model" ? "this machine" : "typical machine",
          ]}
          labelFormatter={(d) =>
            asOf
              ? `${daysToDate(Number(d))} · +${Math.round(Number(d))} days`
              : `day +${d}`
          }
        />
        {/* likely-range (confidence) band */}
        <ReferenceArea
          x1={ciLow}
          x2={ciHigh}
          fill="#8b5cf6"
          fillOpacity={0.1}
          label={{ value: "typical range", position: "insideTopLeft", fontSize: 9, fill: "#94a3b8" }}
        />
        {/* 50% guide line */}
        <ReferenceLine
          y={0.5}
          stroke={ct.axisLine}
          strokeDasharray="3 3"
          label={{ value: "50% — median life", position: "insideBottomRight", fontSize: 9, fill: "#94a3b8" }}
        />
        {/* curves */}
        <Area type="monotone" dataKey="model" name="this machine" stroke="#8b5cf6" fill="url(#survGrad)" strokeWidth={2.4} />
        {baseline && (
          <Line type="monotone" dataKey="baseline" name="typical machine" stroke="#94a3b8" strokeDasharray="5 4" dot={false} strokeWidth={1.4} />
        )}
        {/* RUL / replace-by marker */}
        {rulDays > 0 && (
          <ReferenceLine
            x={rulDays}
            stroke="#f43f5e"
            strokeWidth={1.8}
            label={{ value: rulLineLabel, position: "top", fontSize: 11, fontWeight: 700, fill: "#f43f5e" }}
          />
        )}
        {rulDays > 0 && (
          <ReferenceDot x={rulDays} y={0.5} r={4.5} fill="#f43f5e" stroke="#ffffff" strokeWidth={1.5} ifOverflow="extendDomain" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RulGauge({ rulDays, capped, maxDays = 180 }: { rulDays: number; capped: boolean; maxDays?: number }) {
  const pct = capped ? 100 : Math.min(100, (rulDays / maxDays) * 100);
  const color = riskScoreColor(100 - pct);
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
        <span className="text-3xl font-bold text-slate-900 dark:text-white">{capped ? "1yr+" : Math.round(rulDays)}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">days left</span>
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
