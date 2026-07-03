"use client";

import { useState } from "react";

import { useFleet } from "@/lib/queries";
import { URGENCY_META } from "@/lib/format";
import { StatCard, PageHeader, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
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
  const overdue = items.filter((i) => i.urgency === "overdue").length;
  const urgent  = items.filter((i) => i.urgency === "urgent").length;
  const soon    = items.filter((i) => i.urgency === "soon").length;
  const planned = items.filter((i) => i.urgency === "planned").length;

  function toggle(u: Urgency) {
    setUrgencyFilter((prev) => (prev === u ? "all" : u));
  }

  const filteredCount = urgencyFilter === "all"
    ? items.length
    : items.filter((i) => i.urgency === urgencyFilter).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Planner"
        subtitle="When each machine should be serviced before it breaks down — soonest first. Click a card to filter by urgency level."
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
            {urgencyFilter === "overdue" && "failure risk is high right now, service immediately"}
            {urgencyFilter === "urgent"  && "service needed within the next 7 days"}
            {urgencyFilter === "soon"    && "service needed within the next 30 days"}
            {urgencyFilter === "planned" && "healthy machines, service scheduled in advance"}
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

      {/* Worklist — receives urgency filter from the cards above */}
      <Worklist items={items} filterable urgencyFilter={urgencyFilter} onUrgencyChange={setUrgencyFilter} />
    </div>
  );
}
