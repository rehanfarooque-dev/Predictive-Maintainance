"use client";

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

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RiskOverTimeChart({ data }: { data: TimeseriesPoint[] }) {
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="rsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.65} />
            <stop offset="55%" stopColor="#fb923c" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="datetime" tickFormatter={shortDate} tick={ct.tick} minTickGap={48} stroke={ct.axisLine} />
        <YAxis
          domain={[0, (max: number) => Math.max(1.2, Math.ceil(max * 10) / 10)]}
          tick={ct.tick}
          stroke={ct.axisLine}
          tickFormatter={(v) => Number(v).toFixed(1)}
        />
        <Tooltip
          {...ct.tt}
          labelFormatter={(l) => fmtDateTime(String(l))}
          formatter={(v, name) => {
            if (name === "risk_score") return [Number(v).toFixed(2), "Risk score (hazard)"];
            return [v, name];
          }}
        />
        <ReferenceLine
          y={1.0}
          stroke="#f43f5e"
          strokeDasharray="4 4"
          label={{ value: "failure (1.0)", position: "insideTopRight", fontSize: 10, fill: "#f43f5e" }}
        />
        <Area type="monotone" dataKey="risk_score" stroke="#fb923c" strokeWidth={2} fill="url(#rsGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
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
        <XAxis dataKey="datetime" tickFormatter={shortDate} tick={ct.tick} minTickGap={48} stroke={ct.axisLine} />
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
}: {
  curve: SurvivalPoint[];
  baseline?: SurvivalPoint[];
  rulDays: number;
  ciLow: number;
  ciHigh: number;
}) {
  const ct = useChartTheme();
  const merged = curve.map((p) => {
    const b = baseline?.find((q) => Math.abs(q.days_ahead - p.days_ahead) < 1.5);
    return { days_ahead: p.days_ahead, model: p.survival_prob, baseline: b?.survival_prob };
  });
  return (
    <ResponsiveContainer width="100%" height={270}>
      <ComposedChart data={merged} margin={{ top: 30, right: 22, bottom: 6, left: -6 }}>
        <defs>
          <linearGradient id="survGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis
          dataKey="days_ahead"
          tick={ct.tick}
          stroke={ct.axisLine}
          label={{ value: "days ahead", position: "insideBottom", offset: -2, fontSize: 11, fill: "#64748b" }}
        />
        <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={ct.tick} stroke={ct.axisLine} />
        <Tooltip
          {...ct.tt}
          formatter={(v, n) => [`${(Number(v) * 100).toFixed(0)}%`, n === "model" ? "this machine" : "typical machine"]}
          labelFormatter={(d) => `day +${d}`}
        />
        {/* likely-range (confidence) band on the time axis */}
        <ReferenceArea x1={ciLow} x2={ciHigh} fill="#8b5cf6" fillOpacity={0.1}
          label={{ value: "likely range", position: "insideTopLeft", fontSize: 9, fill: "#94a3b8" }} />
        {/* median (50%) guide */}
        <ReferenceLine y={0.5} stroke={ct.axisLine} strokeDasharray="3 3"
          label={{ value: "50% — median life", position: "insideBottomRight", fontSize: 9, fill: "#94a3b8" }} />
        {/* curves */}
        <Area type="monotone" dataKey="model" name="this machine" stroke="#8b5cf6" fill="url(#survGrad)" strokeWidth={2.4} />
        {baseline && <Line type="monotone" dataKey="baseline" name="typical machine" stroke="#94a3b8" strokeDasharray="5 4" dot={false} strokeWidth={1.4} />}
        {/* RUL marker — clearly labeled, with a dot at the 50% crossing */}
        {rulDays > 0 && (
          <ReferenceLine
            x={rulDays}
            stroke="#f43f5e"
            strokeWidth={1.8}
            label={{ value: `RUL ≈ ${Math.round(rulDays)} days`, position: "top", fontSize: 11, fontWeight: 700, fill: "#f43f5e" }}
          />
        )}
        {rulDays > 0 && <ReferenceDot x={rulDays} y={0.5} r={4.5} fill="#f43f5e" stroke="#ffffff" strokeWidth={1.5} ifOverflow="extendDomain" />}
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
