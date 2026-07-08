"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useFleet } from "@/lib/queries";
import { useControls } from "@/lib/store";
import { fmtPct, fmtDateTime, statusFromRisk, prettyModel } from "@/lib/format";
import { GlassCard, StatCard, PageHeader, SectionTitle, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { IconCpu, IconAlert, IconActivity } from "@/components/icons";
import { RiskHistogram } from "@/components/charts";
import { TableToolbar, FilterSelect, SortHeader, useTableSort } from "@/components/table";
import type { FleetItem } from "@/lib/types";

function getVal(it: FleetItem, k: string): number {
  switch (k) {
    case "id": return it.machineID;
    case "risk": return it.classifier_risk;
    case "status": return it.at_risk ? 1 : 0;
    default: return 0;
  }
}

export default function MachineHealthPage() {
  const { threshold } = useControls();
  const { data, isLoading, isError, error } = useFleet("classifier_risk");
  const [search, setSearch] = useState("");
  const [machine, setMachine] = useState("all");
  const [model, setModel] = useState("all");
  const [status, setStatus] = useState("all");
  const { sortKey, dir, toggle, sortRows } = useTableSort("risk", "desc");

  const items = useMemo(() => data?.items ?? [], [data]);
  const models = useMemo(() => Array.from(new Set(items.map((i) => i.model))).sort(), [items]);
  const availableMachines = useMemo(() => {
    let r = items;
    if (model !== "all") r = r.filter((i) => i.model === model);
    if (status === "risk") r = r.filter((i) => i.at_risk);
    else if (status === "healthy") r = r.filter((i) => !i.at_risk);
    return r.map((i) => i.machineID).sort((a, b) => a - b);
  }, [items, model, status]);

  useEffect(() => {
    if (machine !== "all" && !availableMachines.includes(Number(machine))) setMachine("all");
  }, [availableMachines, machine]);

  const flagged = items.filter((i) => i.at_risk);
  const watch = items.filter((i) => !i.at_risk && i.classifier_risk >= 0.1);
  const healthy = items.length - flagged.length - watch.length;
  const topMachine = items.reduce<FleetItem | null>((m, i) => (!m || i.classifier_risk > m.classifier_risk ? i : m), null);

  const view = useMemo(() => {
    let r = items;
    const q = search.trim();
    if (q) r = r.filter((i) => String(i.machineID).includes(q));
    if (machine !== "all") r = r.filter((i) => i.machineID === Number(machine));
    if (model !== "all") r = r.filter((i) => i.model === model);
    if (status === "risk") r = r.filter((i) => i.at_risk);
    else if (status === "healthy") r = r.filter((i) => !i.at_risk);
    return sortRows(r, getVal);
  }, [items, search, machine, model, status, sortKey, dir, sortRows]);

  if (isLoading) return <LoadingBlock label="Loading machine health…" />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classification"
        subtitle={`12-hour failure probability per machine · as of ${fmtDateTime(data.as_of)} · alert ${threshold.toFixed(2)}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<IconCpu size={20} />} tone="indigo" label="Machines watched" value={items.length} />
        <StatCard icon={<IconAlert size={20} />} tone="rose" label="Flagged right now" value={flagged.length} sub={`alert sensitivity ${threshold.toFixed(2)}`} />
        <StatCard
          icon={<IconActivity size={20} />}
          tone="amber"
          label="Highest failure chance"
          value={fmtPct(topMachine?.classifier_risk ?? 0)}
          sub={topMachine ? `Machine ${topMachine.machineID}` : undefined}
        />
      </div>

      <GlassCard className="p-5">
        <SectionTitle
          title="Fleet health mix"
          info="Healthy = under 10% failure chance · Watch = 10% to the alert level · At risk = above it."
        />
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          <div style={{ width: `${(healthy / items.length) * 100}%`, background: "#34d399" }} />
          <div style={{ width: `${(watch.length / items.length) * 100}%`, background: "#fbbf24" }} />
          <div style={{ width: `${(flagged.length / items.length) * 100}%`, background: "#f43f5e" }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          {[
            { label: "Healthy", n: healthy, color: "#34d399", hint: "under 10% chance" },
            { label: "Watch", n: watch.length, color: "#fbbf24", hint: "10% to threshold" },
            { label: "At risk", n: flagged.length, color: "#f43f5e", hint: "above alert level" },
          ].map((b) => (
            <div key={b.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                <span className="text-slate-600 dark:text-slate-300">{b.label}</span>
                <span className="ml-auto text-lg font-bold text-slate-900 dark:text-white">{b.n}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{b.hint}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionTitle
          title="Failure-chance distribution"
          subtitle="How many machines fall in each 12-hour failure-chance band right now."
          info="Most machines sit near 0% (healthy). The spread shifts toward higher bands near real failure clusters — change the date to watch it move."
        />
        <RiskHistogram values={items.map((i) => i.classifier_risk)} />
      </GlassCard>

      <div>
        <SectionTitle title="All machines" />
        <TableToolbar search={search} onSearch={setSearch} count={view.length}>
          <FilterSelect
            value={machine}
            onChange={setMachine}
            options={[{ value: "all", label: "All machines" }, ...availableMachines.map((id) => ({ value: String(id), label: `Machine ${id}` }))]}
          />
          <FilterSelect
            value={model}
            onChange={setModel}
            options={[{ value: "all", label: "All types" }, ...models.map((m) => ({ value: m, label: prettyModel(m) }))]}
          />
          <FilterSelect
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "risk", label: "At risk" },
              { value: "healthy", label: "Healthy" },
            ]}
          />
        </TableToolbar>

        <GlassCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-white/[0.03]">
              <tr className="border-b border-slate-200 dark:border-white/10">
                <SortHeader label="Machine" sortKey="id" active={sortKey === "id"} dir={dir} onSort={toggle} />
                <SortHeader label="Failure chance (12h)" sortKey="risk" active={sortKey === "risk"} dir={dir} onSort={toggle} />
                <SortHeader label="Status" sortKey="status" active={sortKey === "status"} dir={dir} onSort={toggle} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {view.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No machines match these filters.</td>
                </tr>
              )}
              {view.map((it) => {
                const st = statusFromRisk(it.at_risk);
                return (
                  <tr key={it.machineID} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.04]">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">Machine {it.machineID}</span>
                      <span className="ml-2 text-xs text-slate-500">{prettyModel(it.model)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                          <div className="h-full rounded-full" style={{ width: `${it.classifier_risk * 100}%`, background: "linear-gradient(90deg,#fbbf24,#f43f5e)" }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{fmtPct(it.classifier_risk)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", st.badge)}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/classification/${it.machineID}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200">
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </GlassCard>
      </div>
    </div>
  );
}
