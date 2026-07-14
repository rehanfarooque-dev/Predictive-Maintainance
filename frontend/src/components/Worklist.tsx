"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { FleetItem, Urgency } from "@/lib/types";
import { URGENCY_META, riskScoreColor, prettyModel, prettyComp, clsHazard, fmtProb, recurrenceUrgency } from "@/lib/format";
import { GlassCard, cn } from "@/components/ui";
import { TableToolbar, FilterSelect, SortHeader, useTableSort } from "@/components/table";

const URGENCIES: Urgency[] = ["overdue", "urgent", "soon", "planned"];

function getVal(it: FleetItem, k: string): number | string {
  switch (k) {
    case "id":      return it.machineID;
    case "urgency": return URGENCY_META[recurrenceUrgency(it)].rank;
    case "chance":  return it.classifier_risk;
    case "risk":    return clsHazard(it.classifier_risk);
    default:        return 0;
  }
}

interface WorklistProps {
  items: FleetItem[];
  filterable?: boolean;
  /** Controlled urgency from parent (stat cards). "all" = no urgency filter. */
  urgencyFilter?: Urgency | "all";
  onUrgencyChange?: (u: Urgency | "all") => void;
  /** Accepted for compatibility; the worklist is now classifier-driven. */
  asOf?: string;
}

export function Worklist({ items, filterable = false, urgencyFilter = "all", onUrgencyChange }: WorklistProps) {
  const router = useRouter();
  const [search,  setSearch]  = useState("");
  const [machine, setMachine] = useState("all");
  const [model,   setModel]   = useState("all");
  const { sortKey, dir, toggle, sortRows } = useTableSort("urgency", "asc");

  // Reset machine + model when the external urgency filter changes
  useEffect(() => {
    setMachine("all");
    setModel("all");
  }, [urgencyFilter]);

  // ── Bidirectional filter sync ───────────────────────────────────────────
  // Base rows after urgency filter (shared starting point)
  const urgencyFiltered = useMemo(
    () => urgencyFilter === "all" ? items : items.filter((i) => recurrenceUrgency(i) === urgencyFilter),
    [items, urgencyFilter],
  );

  // Available models: base filtered by current machine selection
  const availableModels = useMemo(() => {
    let r = urgencyFiltered;
    if (machine !== "all") r = r.filter((i) => i.machineID === Number(machine));
    return Array.from(new Set(r.map((i) => i.model))).sort();
  }, [urgencyFiltered, machine]);

  // Available machines: base filtered by current model selection
  const availableMachines = useMemo(() => {
    let r = urgencyFiltered;
    if (model !== "all") r = r.filter((i) => i.model === model);
    return r.map((i) => i.machineID).sort((a, b) => a - b);
  }, [urgencyFiltered, model]);

  // Reset machine if it disappears from available list
  useEffect(() => {
    if (machine !== "all" && !availableMachines.includes(Number(machine))) setMachine("all");
  }, [availableMachines, machine]);

  // Reset model if it disappears from available list
  useEffect(() => {
    if (model !== "all" && !availableModels.includes(model)) setModel("all");
  }, [availableModels, model]);

  // ── Final view ──────────────────────────────────────────────────────────
  const view = useMemo(() => {
    if (!filterable) return items;
    let r = urgencyFiltered;
    const q = search.trim();
    if (q)                r = r.filter((i) => String(i.machineID).includes(q));
    if (machine !== "all") r = r.filter((i) => i.machineID === Number(machine));
    if (model   !== "all") r = r.filter((i) => i.model === model);
    return sortRows(r, getVal);
  }, [items, filterable, urgencyFiltered, search, machine, model, sortKey, dir, sortRows]);

  return (
    <div>
      {filterable && (
        <TableToolbar search={search} onSearch={setSearch} count={view.length}>
          {/* Machine picker — auto-narrows to models that machine has */}
          <FilterSelect
            value={machine}
            onChange={(v) => { setMachine(v); if (v !== "all") setModel("all"); }}
            options={[
              { value: "all", label: "All machines" },
              ...availableMachines.map((id) => ({ value: String(id), label: `Machine ${id}` })),
            ]}
          />
          {/* Urgency dropdown — stays in sync with the stat cards */}
          <FilterSelect
            value={urgencyFilter}
            onChange={(v) => onUrgencyChange?.(v as Urgency | "all")}
            options={[
              { value: "all",     label: "All urgency" },
              ...URGENCIES.map((u) => ({ value: u, label: URGENCY_META[u].label })),
            ]}
          />
          {/* Model picker — only shows models available for the selected machine */}
          <FilterSelect
            value={model}
            onChange={(v) => { setModel(v); if (v !== "all") setMachine("all"); }}
            options={[
              { value: "all", label: "All models" },
              ...availableModels.map((m) => ({ value: m, label: prettyModel(m) })),
            ]}
          />
        </TableToolbar>
      )}

      <GlassCard className="overflow-hidden">
          <table className="w-full text-sm">
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "22%" }} />
              <col />
            </colgroup>
            <thead className="sticky top-0 bg-white/95 backdrop-blur dark:bg-slate-950/95">
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10">
                <SortHeader label="Machine"        sortKey="id"      active={sortKey === "id"}      dir={dir} onSort={toggle} className="whitespace-nowrap px-4 py-3" />
                <SortHeader label="Recommendation" sortKey="urgency" active={sortKey === "urgency"} dir={dir} onSort={toggle} className="whitespace-nowrap px-4 py-3" title="Service now if the 12h classifier flags failure; else by failure chance." />
                <SortHeader label="12h failure chance" sortKey="chance" active={sortKey === "chance"} dir={dir} onSort={toggle} className="whitespace-nowrap px-4 py-3" title="Same value as the Classification page — probability of failure in the next 12 hours." />
                <SortHeader label="Risk score H(t)" sortKey="risk"   active={sortKey === "risk"}    dir={dir} onSort={toggle} className="whitespace-nowrap px-4 py-3" title="Cumulative hazard from the failure chance: H = −ln(1−p). H ≥ 1 ⇔ ~63% ⇔ service." />
              </tr>
            </thead>
            <tbody>
              {view.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                    No machines match these filters.
                  </td>
                </tr>
              )}
              {view.map((it) => {
                const urg = recurrenceUrgency(it);
                const u = URGENCY_META[urg];
                const h = clsHazard(it.classifier_risk);
                return (
                  <tr
                    key={it.machineID}
                    onClick={() => router.push(`/risk/${it.machineID}`)}
                    className="group cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.04]"
                  >
                    {/* Machine — shows arrow on row hover */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-9 w-1 shrink-0 rounded-full"
                          style={{ background: u.color, boxShadow: `0 0 8px ${u.glow}` }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              Machine {it.machineID}
                            </span>
                            <span className="translate-x-0 text-indigo-400 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-indigo-400">
                              →
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 dark:text-slate-500">
                            {prettyModel(it.model)} · {prettyComp(it.current_comp)}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Urgency badge */}
                    <td className="px-4 py-3.5">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                        u.badge,
                      )}>
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          u.dot,
                          urg === "overdue" && "animate-pulse",
                        )} />
                        {u.label}
                      </span>
                    </td>

                    {/* 12h failure chance — identical to the Classification page */}
                    <td className="px-4 py-3.5">
                      <span className={cn(
                        "font-semibold tabular-nums",
                        it.at_risk ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300",
                      )}>
                        {fmtProb(it.classifier_risk)}
                      </span>
                    </td>

                    {/* Risk score H(t) = −ln(1−p) — bar toward 1.0 + number */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(h, 1) * 100}%`,
                              background: riskScoreColor(Math.min(h, 1) * 100),
                            }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300">
                          {h.toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </GlassCard>
    </div>
  );
}
