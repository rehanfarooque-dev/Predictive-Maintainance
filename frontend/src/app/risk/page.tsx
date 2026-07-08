"use client";

import { useState } from "react";

import { useFleet } from "@/lib/queries";
import { URGENCY_META, recurrenceUrgency, fmtDate } from "@/lib/format";
import { StatCard, PageHeader, SectionTitle, GlassCard, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { UrgencyDonut } from "@/components/charts";
import { FleetMap } from "@/components/FleetMap";
import { Worklist } from "@/components/Worklist";
import { IconAlert, IconClock, IconWrench, IconShield } from "@/components/icons";
import type { Urgency } from "@/lib/types";

export default function RiskPage() {
  const { data, isLoading, isError, error } = useFleet("urgency");
  const [urgencyFilter, setUrgencyFilter] = useState<Urgency | "all">("all");

  if (isLoading) return <LoadingBlock label="Loading service plan…" />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const items   = data.items;
  const overdue = items.filter((i) => recurrenceUrgency(i) === "overdue").length;
  const urgent  = items.filter((i) => recurrenceUrgency(i) === "urgent").length;
  const soon    = items.filter((i) => recurrenceUrgency(i) === "soon").length;
  const planned = items.filter((i) => recurrenceUrgency(i) === "planned").length;

  function toggle(u: Urgency) {
    setUrgencyFilter((prev) => (prev === u ? "all" : u));
  }

  const filteredCount = urgencyFilter === "all"
    ? items.length
    : items.filter((i) => recurrenceUrgency(i) === urgencyFilter).length;

  const donutCounts = (["overdue", "urgent", "soon", "planned"] as const).map((k) => ({
    name: URGENCY_META[k].label,
    value: items.filter((i) => recurrenceUrgency(i) === k).length,
    color: URGENCY_META[k].color,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Risk Score"
        subtitle={`Hybrid recurrence risk — the clock resets at each machine's last predicted failure and climbs until the next is due. · as of ${fmtDate(data.as_of)}`}
      />

      {/* Urgency KPI cards — all clickable filters */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<IconWrench size={20} />}
          tone="rose"
          label="Service now"
          value={overdue}
          onClick={() => toggle("overdue")}
          active={urgencyFilter === "overdue"}
        />
        <StatCard
          icon={<IconAlert size={20} />}
          tone="amber"
          label="Urgent (< 1 week)"
          value={urgent}
          onClick={() => toggle("urgent")}
          active={urgencyFilter === "urgent"}
        />
        <StatCard
          icon={<IconClock size={20} />}
          tone="sky"
          label="Soon (< 1 month)"
          value={soon}
          onClick={() => toggle("soon")}
          active={urgencyFilter === "soon"}
        />
        <StatCard
          icon={<IconShield size={20} />}
          tone="emerald"
          label="Planned"
          value={planned}
          onClick={() => toggle("planned")}
          active={urgencyFilter === "planned"}
        />
      </div>

      {/* Active urgency banner */}
      {urgencyFilter !== "all" && (
        <div className={cn(
          "flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium",
          urgencyFilter === "overdue"
            ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-300"
            : urgencyFilter === "urgent"
            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300"
            : urgencyFilter === "soon"
            ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300"
            : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300",
        )}>
          <span>
            Showing <strong>{filteredCount}</strong>{" "}
            <strong>{URGENCY_META[urgencyFilter].label.toLowerCase()}</strong> machine{filteredCount !== 1 ? "s" : ""} —{" "}
            {urgencyFilter === "overdue" && "recurrence risk has reached 1.0 — service now"}
            {urgencyFilter === "urgent"  && "recurrence risk reaches 1.0 within 7 days"}
            {urgencyFilter === "soon"    && "recurrence risk reaches 1.0 within 30 days"}
            {urgencyFilter === "planned" && "well before the next predicted failure state"}
          </span>
          <button
            type="button"
            onClick={() => setUrgencyFilter("all")}
            className="ml-4 rounded-lg px-3 py-1 text-xs font-semibold ring-1 ring-current hover:bg-white/60 dark:hover:bg-black/20"
          >
            Show all ×
          </button>
        </div>
      )}

      {/* Dashboard visuals — maintenance urgency split + fleet map */}
      <div className="grid gap-5 lg:grid-cols-5">
        <GlassCard className="p-5 lg:col-span-2">
          <SectionTitle title="Maintenance urgency" subtitle="Fleet split by how soon the recurrence risk reaches 1.0." />
          <UrgencyDonut counts={donutCounts} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {donutCounts.map((c) => (
              <div key={c.name} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 dark:bg-white/5">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} /> {c.name}
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">{c.value}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-3">
          <SectionTitle title="Fleet map" subtitle="Every machine by maintenance urgency — click a tile to open its plan." />
          <FleetMap items={items} />
        </GlassCard>
      </div>

      {/* Worklist — receives urgency filter from the cards above */}
      <SectionTitle title="Maintenance worklist" subtitle="Soonest to service first — sort or filter any column." />
      <Worklist items={items} filterable urgencyFilter={urgencyFilter} onUrgencyChange={setUrgencyFilter} asOf={data.as_of} />
    </div>
  );
}
