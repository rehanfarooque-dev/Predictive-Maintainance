"use client";

import Link from "next/link";

import { useFleet } from "@/lib/queries";
import { useControls } from "@/lib/store";
import { URGENCY_META, fmtPct, fmtDate, prettyModel } from "@/lib/format";
import { GlassCard, StatCard, SectionTitle, PageHeader, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { UrgencyDonut, RiskHistogram } from "@/components/charts";
import { FleetMap } from "@/components/FleetMap";
import { Worklist } from "@/components/Worklist";
import { IconCpu, IconAlert, IconHeart } from "@/components/icons";

export default function OverviewPage() {
  const { asOf, threshold } = useControls();
  const { data, isLoading, isFetching, isError, error } = useFleet("urgency");

  if (isLoading) return <LoadingBlock label="Loading fleet…" />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const items = data.items;
  const failingSoon = items
    .filter((i) => i.at_risk)
    .sort((a, b) => b.classifier_risk - a.classifier_risk);
  const healthyPct = (100 * (items.length - failingSoon.length)) / Math.max(items.length, 1);
  const whenLabel = asOf ? fmtDate(asOf) : "right now";

  const counts = (["overdue", "urgent", "soon", "planned"] as const).map((k) => ({
    name: URGENCY_META[k].label,
    value: items.filter((i) => i.urgency === k).length,
    color: URGENCY_META[k].color,
  }));
  const riskValues = items.map((i) => i.classifier_risk);
  const clear = failingSoon.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Fleet Status"
        subtitle="Pick a point in time above — the board shows which machines are about to fail."
      />

      {/* HERO — the core message */}
      <GlassCard className="relative overflow-hidden p-6">
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: clear ? "#34d399" : "#f43f5e", boxShadow: `0 0 24px ${clear ? "rgba(52,211,153,0.5)" : "rgba(244,63,94,0.5)"}` }}
        />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">As of {whenLabel}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          {clear ? (
            <>No machines are expected to fail in the next <span className="text-emerald-500">12 hours</span>.</>
          ) : (
            <>
              <span className="text-rose-500">{failingSoon.length}</span> machine{failingSoon.length > 1 ? "s" : ""}{" "}
              likely to fail within the next <span className="text-rose-500">12 hours</span>
            </>
          )}
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Based on each machine&apos;s recent behaviour, at the current alert sensitivity ({threshold.toFixed(2)}). Adjust it in the top bar.
        </p>
      </GlassCard>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<IconCpu size={20} />} tone="indigo" label="Machines watched" value={items.length} />
        <StatCard icon={<IconAlert size={20} />} tone="rose" label="Failing within 12h" value={failingSoon.length} />
        <StatCard icon={<IconHeart size={20} />} tone="emerald" label="Fleet healthy" value={`${healthyPct.toFixed(0)}%`} />
      </div>

      {/* Expected to fail within 12h — the actionable list */}
      <div>
        <SectionTitle
          title="Expected to fail within 12 hours"
          subtitle="From the selected point in time, most likely first. Click a machine for the full picture."
        />
        {clear ? (
          <GlassCard className="flex items-center gap-3 p-6 text-sm text-emerald-600 dark:text-emerald-300">
            <span className="text-lg">✅</span> All clear — no machines are above the alert level right now.
          </GlassCard>
        ) : (
          <GlassCard className="divide-y divide-slate-100 overflow-hidden dark:divide-white/5">
            {failingSoon.map((it) => (
              <Link
                key={it.machineID}
                href={`/risk/${it.machineID}`}
                className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-3">
                  <span className="h-9 w-1 rounded-full bg-rose-500" style={{ boxShadow: "0 0 10px rgba(244,63,94,0.5)" }} />
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">Machine {it.machineID}</div>
                    <div className="text-xs text-slate-500">{prettyModel(it.model)} · service by {fmtDate(it.recommended_service_date)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-rose-500">{fmtPct(it.classifier_risk)}</div>
                    <div className="text-[11px] text-slate-500">chance of failure</div>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", URGENCY_META[it.urgency].badge)}>
                    Fails within 12h
                  </span>
                </div>
              </Link>
            ))}
          </GlassCard>
        )}
      </div>

      {/* Supporting visuals */}
      <div className="grid gap-6 lg:grid-cols-5">
        <GlassCard className={cn("p-5 lg:col-span-2 transition-opacity duration-300", isFetching && "opacity-60")}>
          <SectionTitle
            title="How the fleet splits"
            subtitle="Machines grouped by how soon they need attention."
            info="What each colour means: Service now (overdue) = the survival model says maintenance is overdue or the classifier sees imminent failure. Urgent = service within 7 days. Soon = service in 7–30 days (machine is healthy, just aging). Planned = service in >30 days — machine is fully healthy right now, next maintenance can be planned far in advance. Most machines are Planned or Soon at any given time because failures are rare events."
          />
          <UrgencyDonut counts={counts} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {counts.map((c) => (
              <div key={c.name} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 dark:bg-white/5">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} /> {c.name}
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">{c.value}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className={cn("p-5 lg:col-span-3 transition-opacity duration-300", isFetching && "opacity-60")}>
          <SectionTitle
            title="Fleet risk spread"
            subtitle="Where machines stand on the failure-chance scale (most are low)."
            info="How many machines fall in each 12h-failure-chance band right now. Most sit near 0% — that's normal, failures are rare. Change the date above to see the distribution shift near historical failure clusters."
          />
          <RiskHistogram values={riskValues} />
        </GlassCard>
      </div>

      <GlassCard className={cn("p-5 transition-opacity duration-300", isFetching && "opacity-60")}>
        <SectionTitle
          title="Fleet status map"
          subtitle="Every machine, colored by how soon it needs service. Click a tile to drill in."
          info="Colors show the maintenance urgency from the survival model: Service now (overdue, need maintenance immediately) · Urgent (< 7 days) · Soon (< 30 days — machine is healthy but schedule service) · Planned (> 30 days — fully healthy, next service far out). Change the DATE above to see how the fleet evolves over time. Hour-to-hour changes are subtle; week-to-week changes are dramatic."
          right={isFetching ? <span className="text-xs text-slate-400 animate-pulse">Updating…</span> : null}
        />
        <FleetMap items={items} />
      </GlassCard>

      <div>
        <SectionTitle
          title="Upcoming maintenance schedule"
          subtitle="The 12 most urgent — see every machine in the Service Planner."
          right={
            <Link href="/risk" className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200">
              View all {items.length} →
            </Link>
          }
        />
        <Worklist items={items.slice(0, 12)} />
      </div>
    </div>
  );
}
