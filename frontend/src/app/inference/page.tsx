"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useFleetMonitor } from "@/lib/queries";
import { useControls } from "@/lib/store";
import { prettyModel, prettyComp, fmtDateTime, fmtPct, riskScoreColor } from "@/lib/format";
import { GlassCard, PageHeader, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { TableToolbar, FilterSelect, SortHeader, useTableSort } from "@/components/table";
import type { MonitorItem } from "@/lib/types";

// ── Band status helpers ────────────────────────────────────────────────────

type BandMap = Record<string, { lower: number; upper: number; p50: number }>;

function bandStatus(value: number, band?: { lower: number; upper: number }): "ok" | "warn" | "crit" {
  if (!band) return "ok";
  if (value >= band.lower && value <= band.upper) return "ok";
  const w = band.upper - band.lower;
  const e = value > band.upper ? value - band.upper : band.lower - value;
  return e / Math.max(w, 1) > 0.15 ? "crit" : "warn";
}

const DOT: Record<string, string> = {
  ok:   "bg-emerald-400",
  warn: "bg-amber-400",
  crit: "bg-rose-500",
};
const TXT: Record<string, string> = {
  ok:   "text-slate-700 dark:text-slate-200",
  warn: "text-amber-600 dark:text-amber-300 font-semibold",
  crit: "text-rose-600 dark:text-rose-400 font-bold",
};

function SensorCell({ value, band }: { value: number; band?: { lower: number; upper: number; p50: number } }) {
  const st = bandStatus(value, band);
  return (
    <td
      className="px-3 py-0 text-right tabular-nums whitespace-nowrap"
      title={band ? `Normal: ${band.lower}–${band.upper} · Typical: ${band.p50}` : undefined}
    >
      <span className={cn("inline-flex items-center justify-end gap-1.5 text-sm", TXT[st])}>
        {value}
        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[st])} />
      </span>
    </td>
  );
}

// ── Sort key ──────────────────────────────────────────────────────────────

function getVal(m: MonitorItem, k: string): number | string {
  switch (k) {
    case "id":        return m.machineID;
    case "type":      return m.model;
    case "age":       return m.age;
    case "volt":      return m.volt;
    case "rotate":    return m.rotate;
    case "pressure":  return m.pressure;
    case "vibration": return m.vibration;
    case "errors":    return m.errors_24h;
    case "overdue":   return m.overdue_days;
    case "risk":      return m.risk;
    default:          return 0;
  }
}

// ── Quick filter type ─────────────────────────────────────────────────────
type QuickFilter = "risk" | "errors" | "out_of_band" | null;

// ── Summary KPI cards (clickable) ─────────────────────────────────────────

const SENSORS_LIST = ["volt", "rotate", "pressure", "vibration"] as const;

function SummaryBar({
  items, modelBands, threshold, active, onFilter,
}: {
  items: MonitorItem[];
  modelBands: Record<string, BandMap>;
  threshold: number;
  active: QuickFilter;
  onFilter: (f: QuickFilter) => void;
}) {
  const atRisk  = items.filter((m) => m.risk >= threshold).length;
  const withErr = items.filter((m) => m.errors_24h > 0).length;
  const outBand = items.filter((m) => {
    const b = modelBands[m.model] ?? {};
    return SENSORS_LIST.some((s) => bandStatus(m[s], b[s]) !== "ok");
  }).length;

  const cards = [
    {
      id: "risk" as QuickFilter,
      value: atRisk,
      label: "At risk right now",
      sub: "Failure chance exceeds alert threshold",
      valueColor: atRisk > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
      ring: "ring-rose-500 dark:ring-rose-400",
      activeBg: "bg-rose-50 dark:bg-rose-950/30",
      hoverBg: "hover:bg-rose-50/60 dark:hover:bg-rose-950/20",
      dot: atRisk > 0 ? "bg-rose-500" : "bg-emerald-400",
    },
    {
      id: "errors" as QuickFilter,
      value: withErr,
      label: "Machines with errors",
      sub: "Error codes logged in last 24h",
      valueColor: withErr > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500",
      ring: "ring-amber-500 dark:ring-amber-400",
      activeBg: "bg-amber-50 dark:bg-amber-950/30",
      hoverBg: "hover:bg-amber-50/60 dark:hover:bg-amber-950/20",
      dot: withErr > 0 ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600",
    },
    {
      id: "out_of_band" as QuickFilter,
      value: outBand,
      label: "Sensors out of range",
      sub: "Reading outside normal operating band",
      valueColor: outBand > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500",
      ring: "ring-orange-500 dark:ring-orange-400",
      activeBg: "bg-orange-50 dark:bg-orange-950/30",
      hoverBg: "hover:bg-orange-50/60 dark:hover:bg-orange-950/20",
      dot: outBand > 0 ? "bg-orange-500" : "bg-slate-300 dark:bg-slate-600",
    },
    {
      id: null as QuickFilter,
      value: items.length,
      label: "Machines monitored",
      sub: "Total machines in fleet",
      valueColor: "text-indigo-600 dark:text-indigo-400",
      ring: "",
      activeBg: "",
      hoverBg: "",
      dot: "bg-indigo-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => {
        const isActive   = active === c.id && c.id !== null;
        const isClickable = c.id !== null;
        return (
          <button
            key={c.label}
            type="button"
            disabled={!isClickable}
            onClick={() => isClickable && onFilter(isActive ? null : c.id)}
            className={cn(
              "group relative flex flex-col gap-1.5 rounded-xl border px-5 py-4 text-left transition-all duration-150",
              isActive
                ? cn("border-transparent shadow-md ring-2", c.ring, c.activeBg)
                : "border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/40",
              isClickable && !isActive && cn("cursor-pointer", c.hoverBg),
              !isClickable && "cursor-default",
            )}
          >
            {/* Active badge */}
            {isActive && (
              <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm dark:bg-slate-800/80 dark:text-slate-300">
                Filtered ×
              </span>
            )}

            {/* Value row */}
            <div className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full", c.dot,
                c.id === "risk" && c.value > 0 && "animate-pulse"
              )} />
              <span className={cn("text-3xl font-bold tabular-nums leading-none", c.valueColor)}>
                {c.value}
              </span>
            </div>

            {/* Labels */}
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 leading-tight">
              {c.label}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
              {c.sub}
            </span>

            {/* Click hint */}
            {isClickable && !isActive && (
              <span className="mt-0.5 text-[10px] font-medium text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600">
                Click to filter table →
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function FleetMonitorPage() {
  const { threshold } = useControls();
  const { data, isLoading, isError, error } = useFleetMonitor();

  const [search,      setSearch]      = useState("");
  const [machine,     setMachine]     = useState("all");
  const [model,       setModel]       = useState("all");
  const [status,      setStatus]      = useState("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);

  const { sortKey, dir, toggle, sortRows } = useTableSort("risk", "desc");

  // Applying a quick filter clears the status dropdown so they don't conflict
  function handleQuickFilter(f: QuickFilter) {
    setQuickFilter(f);
    if (f !== null) setStatus("all");
  }

  const items      = useMemo(() => data?.items ?? [], [data]);
  const modelBands = useMemo(() => data?.model_bands ?? {}, [data]);

  // Helper: apply quick-filter predicate to a list
  function applyQuick(r: MonitorItem[]): MonitorItem[] {
    if (quickFilter === "risk")       return r.filter((i) => i.risk >= threshold);
    if (quickFilter === "errors")     return r.filter((i) => i.errors_24h > 0);
    if (quickFilter === "out_of_band") return r.filter((i) => {
      const b = modelBands[i.model] ?? {};
      return SENSORS_LIST.some((s) => bandStatus(i[s], b[s]) !== "ok");
    });
    return r;
  }

  // Bidirectional filter: picking a machine narrows the type list; picking a type narrows machines
  const availableModels = useMemo(() => {
    let r = items;
    if (machine !== "all") r = r.filter((i) => i.machineID === Number(machine));
    if (status === "risk")         r = r.filter((i) => i.risk >= threshold);
    else if (status === "healthy") r = r.filter((i) => i.risk < threshold);
    r = applyQuick(r);
    return Array.from(new Set(r.map((i) => i.model))).sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, machine, status, threshold, quickFilter, modelBands]);

  const availableMachines = useMemo(() => {
    let r = items;
    if (model !== "all") r = r.filter((i) => i.model === model);
    if (status === "risk")         r = r.filter((i) => i.risk >= threshold);
    else if (status === "healthy") r = r.filter((i) => i.risk < threshold);
    r = applyQuick(r);
    return r.map((i) => i.machineID).sort((a, b) => a - b);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, model, status, threshold, quickFilter, modelBands]);

  useEffect(() => {
    if (machine !== "all" && !availableMachines.includes(Number(machine))) setMachine("all");
  }, [availableMachines, machine]);

  useEffect(() => {
    if (model !== "all" && !availableModels.includes(model)) setModel("all");
  }, [availableModels, model]);

  const view = useMemo(() => {
    let r = items;
    const q = search.trim();
    if (q)                 r = r.filter((i) => String(i.machineID).includes(q));
    if (machine !== "all") r = r.filter((i) => i.machineID === Number(machine));
    if (model   !== "all") r = r.filter((i) => i.model === model);
    if (status  === "risk")         r = r.filter((i) => i.risk >= threshold);
    else if (status === "healthy")  r = r.filter((i) => i.risk < threshold);
    r = applyQuick(r);
    return sortRows(r, getVal);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, machine, model, status, threshold, quickFilter, sortKey, dir, sortRows, modelBands]);

  if (isLoading) return <LoadingBlock label="Loading fleet snapshot…" />;
  if (isError)   return <ErrorBlock error={error} />;
  if (!data)     return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fleet Monitor"
        subtitle={`Live sensor readings for all ${data.count} machines as of ${fmtDateTime(data.as_of)}. Hover any column header to understand what it measures. Hover the 24h chart to read exact values.`}
      />

      <SummaryBar
        items={items}
        modelBands={modelBands}
        threshold={threshold}
        active={quickFilter}
        onFilter={handleQuickFilter}
      />

      {/* Active quick-filter banner */}
      {quickFilter && (
        <div className={cn(
          "flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium",
          quickFilter === "risk"
            ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-300"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300",
        )}>
          <span>
            Showing{" "}
            <strong>{view.length}</strong>{" "}
            {quickFilter === "risk"
              ? "machine(s) at risk — failure chance exceeds alert threshold"
              : quickFilter === "errors"
              ? "machine(s) with error codes logged in the last 24h"
              : "machine(s) with sensors reading outside their normal operating band"}
          </span>
          <button
            type="button"
            onClick={() => setQuickFilter(null)}
            className="ml-4 rounded-lg px-3 py-1 text-xs font-semibold ring-1 ring-current hover:bg-white/60 dark:hover:bg-black/20"
          >
            Clear filter ×
          </button>
        </div>
      )}

      {/* Filters */}
      <TableToolbar search={search} onSearch={setSearch} count={view.length}>
        <FilterSelect
          value={machine}
          onChange={(v) => { setMachine(v); if (v !== "all") setModel("all"); }}
          options={[
            { value: "all", label: "All machines" },
            ...availableMachines.map((id) => ({ value: String(id), label: `Machine ${id}` })),
          ]}
        />
        <FilterSelect
          value={model}
          onChange={(v) => { setModel(v); if (v !== "all") setMachine("all"); }}
          options={[
            { value: "all", label: "All models" },
            ...availableModels.map((m) => ({ value: m, label: prettyModel(m) })),
          ]}
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: "all",     label: "All statuses" },
            { value: "risk",    label: "At risk" },
            { value: "healthy", label: "Healthy" },
          ]}
        />
      </TableToolbar>

      <GlassCard className="overflow-hidden">
        {/* Horizontal + vertical scroll container */}
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: 1080 }}>

            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 96  }} />
              <col style={{ width: 60  }} />
              <col style={{ width: 90  }} />
              <col style={{ width: 90  }} />
              <col style={{ width: 90  }} />
              <col style={{ width: 96  }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 88  }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 100 }} />
            </colgroup>

            <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur dark:bg-slate-950/95">
              <tr className="border-b border-slate-200 dark:border-white/10">
                <SortHeader
                  label="Machine" sortKey="id" active={sortKey === "id"} dir={dir} onSort={toggle}
                  title="Machine ID — click to open the full risk & health detail page for this machine."
                  className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Model" sortKey="type" active={sortKey === "type"} dir={dir} onSort={toggle}
                  title="Machine model (Type 1–4). Each model is a different hardware configuration with its own normal operating ranges for all sensors. The coloured dots use per-model normal ranges, so Type 1 and Type 4 are compared to their own baselines — not a single fleet-wide average."
                  className="whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Age" sortKey="age" active={sortKey === "age"} dir={dir} onSort={toggle}
                  title="How many years this machine has been in service. Older machines tend to have more wear and shorter remaining useful life."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Voltage" sortKey="volt" active={sortKey === "volt"} dir={dir} onSort={toggle}
                  title="Current voltage reading (V). The dot shows whether this reading is within the normal band for this machine's model: green = normal, amber = slightly outside, red = significantly outside. Hover the value to see the exact normal range."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Rotation" sortKey="rotate" active={sortKey === "rotate"} dir={dir} onSort={toggle}
                  title="Current rotational speed (RPM). Abnormal rotation is one of the strongest early indicators of mechanical wear. Dot colour = same normal-band logic as Voltage."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Pressure" sortKey="pressure" active={sortKey === "pressure"} dir={dir} onSort={toggle}
                  title="Current pressure reading. Out-of-range pressure often indicates a seal, pump, or fluid-system issue. Dot colour = same normal-band logic."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Vibration" sortKey="vibration" active={sortKey === "vibration"} dir={dir} onSort={toggle}
                  title="Current vibration level. The ▲/▼ arrow shows whether vibration is rising or falling vs the 24h average — a rising trend on an already-high reading is a strong warning sign. Dot colour = same normal-band logic."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <th
                  title="Vibration readings for the last 24 hours, one point per hour. The green shaded band is the normal operating range for this machine's model. Hover anywhere on the chart to read the exact value and time."
                  className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 cursor-default"
                >
                  <span className="inline-flex items-center gap-1">
                    Vibration · 24h
                    <span className="text-[9px] text-slate-300 dark:text-white/20">ⓘ</span>
                  </span>
                </th>
                <SortHeader
                  label="Errors 24h" sortKey="errors" active={sortKey === "errors"} dir={dir} onSort={toggle}
                  title="Number of error codes logged by this machine in the last 24 hours. Even a single error is a yellow flag — multiple errors on the same machine in one day strongly correlates with upcoming failure."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Part overdue" sortKey="overdue" active={sortKey === "overdue"} dir={dir} onSort={toggle}
                  title="Which part (Part 1–4) has been running the longest since its last replacement, and how many days it has been running. This is NOT the same as 'days until failure' — it is the elapsed time since the last service. The model uses this to estimate wear."
                  className="whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
                <SortHeader
                  label="Fails in 12h" sortKey="risk" active={sortKey === "risk"} dir={dir} onSort={toggle}
                  title="Probability (%) that this machine will fail within the next 12 hours, as predicted by the XGBoost classifier. Above 50% triggers an alert (red). This is the primary signal — all other columns explain WHY it is high or low."
                  className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                />
              </tr>
            </thead>

            <tbody>
              {view.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-sm text-slate-400">
                    No machines match these filters.
                  </td>
                </tr>
              )}
              {view.map((m) => {
                const atRisk    = m.risk >= threshold;
                const riskColor = riskScoreColor(m.risk * 100);
                const bands     = modelBands[m.model] ?? {};
                const vibAvg    = m.vibration_24h.length
                  ? m.vibration_24h.reduce((a, b) => a + b, 0) / m.vibration_24h.length
                  : m.vibration;
                const vibRising   = m.vibration > vibAvg;
                const vibStatus   = bandStatus(m.vibration, bands["vibration"]);
                const overdueHot  = m.overdue_days > 180;
                const overdueMed  = m.overdue_days > 90;

                return (
                  <tr
                    key={m.machineID}
                    className={cn(
                      "border-b border-slate-100 transition-colors dark:border-white/5",
                      "hover:bg-slate-50/80 dark:hover:bg-white/[0.035]",
                      atRisk && "bg-rose-50/50 dark:bg-rose-500/[0.05]",
                    )}
                  >
                    {/* Machine — link */}
                    <td className="px-4 py-0 whitespace-nowrap">
                      <div className="flex items-center gap-2 py-2">
                        {atRisk && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500 animate-pulse" />
                        )}
                        <Link
                          href={`/risk/${m.machineID}`}
                          className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
                        >
                          Machine {m.machineID}
                        </Link>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-3 py-0 whitespace-nowrap">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        {prettyModel(m.model)}
                      </span>
                    </td>

                    {/* Age */}
                    <td className="px-3 py-0 text-right whitespace-nowrap text-sm text-slate-400 dark:text-slate-500 tabular-nums">
                      {m.age}y
                    </td>

                    {/* Sensor readings with benchmark dots */}
                    <SensorCell value={m.volt}     band={bands["volt"]}     />
                    <SensorCell value={m.rotate}   band={bands["rotate"]}   />
                    <SensorCell value={m.pressure} band={bands["pressure"]} />

                    {/* Vibration (current reading + trend) */}
                    <td
                      className="px-3 py-0 text-right whitespace-nowrap"
                      title={bands["vibration"] ? `Normal: ${bands["vibration"].lower}–${bands["vibration"].upper} · Typical: ${bands["vibration"].p50}` : undefined}
                    >
                      <span className={cn("inline-flex items-center justify-end gap-1.5 text-sm", TXT[vibStatus])}>
                        {m.vibration}
                        <span
                          className={cn("text-[10px]", vibRising ? "text-amber-500" : "text-slate-300 dark:text-slate-600")}
                          title={`24h avg: ${vibAvg.toFixed(1)}`}
                        >
                          {vibRising ? "▲" : "▼"}
                        </span>
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[vibStatus])} />
                      </span>
                    </td>

                    {/* Sparkline — tooltip renders inside the SVG's top zone */}
                    <td className="px-3 py-1 whitespace-nowrap">
                      <Sparkline
                        values={m.vibration_24h}
                        color={atRisk ? "#f43f5e" : "#0ea5e9"}
                        band={bands["vibration"]}
                        width={155}
                      />
                    </td>

                    {/* Errors */}
                    <td className="px-3 py-0 text-right whitespace-nowrap tabular-nums">
                      {m.errors_24h > 0 ? (
                        <span className="inline-flex items-center justify-end gap-1 font-semibold text-amber-600 dark:text-amber-400">
                          <span className="text-xs">⚠</span>
                          {m.errors_24h}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300 dark:text-slate-600">0</span>
                      )}
                    </td>

                    {/* Most overdue part */}
                    <td className="px-3 py-0 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          overdueHot
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                            : overdueMed
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-400",
                        )}>
                          {prettyComp(m.overdue_comp)}
                        </span>
                        <span className={cn(
                          "text-xs tabular-nums",
                          overdueHot ? "font-semibold text-rose-600 dark:text-rose-400"
                            : overdueMed ? "text-amber-600 dark:text-amber-400"
                            : "text-slate-400 dark:text-slate-500",
                        )}>
                          {m.overdue_days}d
                        </span>
                      </div>
                    </td>

                    {/* Failure chance */}
                    <td className="px-3 py-0 text-right whitespace-nowrap">
                      <span
                        className="inline-flex items-center justify-end gap-1.5 text-sm font-semibold tabular-nums"
                        style={{ color: riskColor }}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: riskColor }} />
                        {fmtPct(m.risk, 0)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="border-t border-slate-100 px-5 py-3 dark:border-white/5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="font-medium text-slate-500 dark:text-slate-300">Sensor dots:</span>
            {[
              { cls: "bg-emerald-400", label: "Within normal range" },
              { cls: "bg-amber-400",   label: "Slightly out of range" },
              { cls: "bg-rose-500",    label: "Significantly out of range" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", l.cls)} />
                {l.label}
              </span>
            ))}
            <span className="text-slate-200 dark:text-white/15">·</span>
            <span>Hover any sensor value to see its normal range · Hover the 24h chart to read exact values</span>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
