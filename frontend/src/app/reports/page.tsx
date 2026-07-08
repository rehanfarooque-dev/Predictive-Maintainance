"use client";

import { useModelReports } from "@/lib/queries";
import { fmtPct, prettyComp } from "@/lib/format";
import { GlassCard, PageHeader, StatCard, LoadingBlock, ErrorBlock } from "@/components/ui";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "sky" | "indigo" | "rose" | "emerald" | "amber" }) {
  return <StatCard label={label} value={value} sub={sub} tone={tone} />;
}

export default function ReportsPage() {
  const { data, isLoading, isError, error } = useModelReports();

  if (isLoading) return <LoadingBlock label="Building model reports…" />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const c = data.classification;
  const p = data.pdm;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Reports"
        subtitle={`Two models working together across ${data.n_machines} machines — plain-language summary of what each one does and how it's performing.`}
      />

      {/* How the two models fit together */}
      <GlassCard className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-500/20 dark:bg-sky-500/10">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-500 text-xs font-bold text-white">1</span>
              <span className="text-sm font-bold text-sky-900 dark:text-sky-200">Classification — will it fail soon?</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Watches live sensor readings and flags a machine if it looks likely to fail in the next few hours. Catches sudden, acute problems.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500 text-xs font-bold text-white">2</span>
              <span className="text-sm font-bold text-indigo-900 dark:text-indigo-200">Risk-Score PdM — when to service?</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Tracks how long each part has run against its typical lifespan and tells you when it&apos;s due for planned maintenance. Catches slow wear-out.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* ─────────────── REPORT 1: CLASSIFICATION ─────────────── */}
      <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 dark:border-sky-500/20 dark:bg-sky-500/10">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-sm font-bold text-white">1</span>
        <div>
          <div className="text-sm font-bold text-sky-900 dark:text-sky-200">Classification Report — 12-Hour Failure Forecast</div>
          <div className="text-xs text-sky-700/80 dark:text-sky-300/70">{c.purpose}</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Failures caught" value={fmtPct(c.recall)} sub="of real failures the model catches (recall)" tone="emerald" />
        <Stat label="Alerts that are right" value={fmtPct(c.precision)} sub="of flagged machines that truly fail (precision)" tone="sky" />
        <Stat label="Overall skill (AUC-PR)" value={c.auc_pr.toFixed(2)} sub="1.00 = perfect · this model is strong" tone="indigo" />
        <Stat label="Flagged right now" value={`${c.n_flagged_now} / ${data.n_machines}`} sub={`${c.pct_flagged_now}% of the fleet at risk`} tone={c.n_flagged_now > 0 ? "rose" : "emerald"} />
      </div>

      <GlassCard className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">How to read this</h3>
        <p className="mb-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          The model is a <span className="font-medium">{c.model}</span> using <span className="font-medium">{c.n_features} engineered features</span> (rolling sensor
          averages, error counts, part age). It answers a yes/no question: <span className="font-medium">will this machine fail within {c.horizon_hours} hours?</span>{" "}
          It catches <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtPct(c.recall)}</span> of real failures; when it raises an alert, that
          alert is correct <span className="font-medium text-sky-600 dark:text-sky-400">{fmtPct(c.precision)}</span> of the time (at the current alert threshold of {c.threshold}).
        </p>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Per-component performance</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-white/10">
                <th className="py-2 pr-4 font-medium">Component</th>
                <th className="py-2 pr-4 font-medium">Failures caught</th>
                <th className="py-2 pr-4 font-medium">Alerts correct</th>
                <th className="py-2 pr-4 font-medium">Real failures seen</th>
              </tr>
            </thead>
            <tbody>
              {c.per_component.map((row) => (
                <tr key={row.component} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                  <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-200">{prettyComp(row.component)}</td>
                  <td className="py-2 pr-4 text-emerald-600 dark:text-emerald-400">{fmtPct(row.recall)}</td>
                  <td className="py-2 pr-4 text-sky-600 dark:text-sky-400">{fmtPct(row.precision)}</td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{row.n_failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* ─────────────── REPORT 2: RISK-SCORE PdM ─────────────── */}
      <div className="mt-2 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 dark:border-indigo-500/20 dark:bg-indigo-500/10">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">2</span>
        <div>
          <div className="text-sm font-bold text-indigo-900 dark:text-indigo-200">Risk-Score PdM Report — Maintenance Cycle</div>
          <div className="text-xs text-indigo-700/80 dark:text-indigo-300/70">{p.purpose}</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Due now" value={`${p.n_due_now} / ${data.n_machines}`} sub={`${p.pct_due_now}% of the fleet past its cycle`} tone={p.n_due_now > 0 ? "rose" : "emerald"} />
        <Stat label="Due soon (< 21 days)" value={String(p.n_soon)} sub="approaching the maintenance cycle" tone="amber" />
        <Stat label="Healthy" value={String(data.n_machines - p.n_due_now - p.n_soon)} sub="well within the maintenance cycle" tone="emerald" />
      </div>

      <GlassCard className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">How to read this</h3>
        <p className="mb-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          A <span className="font-medium">{p.model}</span> learned each component&apos;s typical lifespan from the real gaps between past failures. For a machine,
          we track the <span className="font-medium">cumulative hazard H(t)</span> — how far its oldest part is through that lifespan. {p.rule} H resets to 0 each
          time a part is replaced, so a serviced machine starts fresh.
        </p>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Maintenance cycle per component</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-white/10">
                <th className="py-2 pr-4 font-medium">Component</th>
                <th className="py-2 pr-4 font-medium">Maintenance cycle</th>
                <th className="py-2 pr-4 font-medium">Wear pattern (shape)</th>
                <th className="py-2 pr-4 font-medium">Past failures used</th>
              </tr>
            </thead>
            <tbody>
              {p.cycles.map((row) => (
                <tr key={row.component} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                  <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-200">{prettyComp(row.component)}</td>
                  <td className="py-2 pr-4">
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">every ~{Math.round(row.cycle_days)} days</span>
                  </td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">
                    {row.shape.toFixed(1)}{" "}
                    <span className="text-xs text-slate-400">
                      ({row.shape > 1 ? "wears out with age" : "random failures"})
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{row.n_lives}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
          <span className="font-medium">Decision rule:</span> when a part reaches its cycle length (H = 1.0), it has hit its typical lifespan and should be
          scheduled for maintenance — before it fails. This is a planned schedule, not a last-minute alarm.
        </div>
      </GlassCard>
    </div>
  );
}
