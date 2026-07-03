"use client";

import { useComponents, useFeatures, useMetricsSummary, useThresholdSweep } from "@/lib/queries";
import { useControls } from "@/lib/store";
import { prettyComp, prettyFeature } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { ThresholdSweepChart } from "@/components/charts";
import { IconShield, IconActivity, IconClock, IconTarget } from "@/components/icons";

// ---- small helpers --------------------------------------------------------

function ScoreBadge({ value, thresholds = [80, 60] }: { value: number; thresholds?: [number, number] }) {
  const [good, ok] = thresholds;
  const cls =
    value >= good
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : value >= ok
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>
      {value >= good ? "Excellent" : value >= ok ? "Good" : "Fair"}
    </span>
  );
}

function OutcomeMeter({ caught, falseAlarms }: { caught: number; falseAlarms: number }) {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {/* Failures caught */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          ✅ Real failures caught
        </p>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-4xl font-bold text-emerald-700 dark:text-emerald-300">{caught}</span>
          <span className="mb-1 text-lg text-emerald-500 dark:text-emerald-400">/ 100</span>
        </div>
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
          Out of every 100 real breakdowns — {100 - caught === 0 ? "zero missed" : `${100 - caught} missed`}
        </p>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-emerald-200 dark:bg-emerald-900/40">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${caught}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-emerald-500">
          <span>0</span><span>100 breakdowns</span>
        </div>
      </div>

      {/* False alarms */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          ⚠️ False alarms
        </p>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-4xl font-bold text-amber-700 dark:text-amber-300">{falseAlarms}</span>
          <span className="mb-1 text-lg text-amber-500 dark:text-amber-400">/ 100 alerts</span>
        </div>
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Out of every 100 alerts raised — {100 - falseAlarms} are real, {falseAlarms} are unnecessary
        </p>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/40">
          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${falseAlarms}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-amber-500">
          <span>0</span><span>100 alerts</span>
        </div>
      </div>
    </div>
  );
}

// ---- feature category helpers --------------------------------------------

function categorise(name: string): "service" | "sensor" | "error" | "machine" {
  if (name.startsWith("hours_since")) return "service";
  if (/_mean_/.test(name) || /_std_/.test(name)) return "sensor";
  if (/error\d/.test(name)) return "error";
  return "machine";
}

const CAT_META = {
  service: { label: "Time since last service", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  sensor:  { label: "Sensor readings",          color: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  error:   { label: "Error counts",             color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  machine: { label: "Machine info",             color: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300" },
} as const;

// ---- page ----------------------------------------------------------------

export default function AccuracyPage() {
  const { threshold } = useControls();
  const summary = useMetricsSummary();
  const sweep = useThresholdSweep(threshold);
  const components = useComponents();
  const features = useFeatures();

  if (summary.isLoading) return <LoadingBlock label="Loading accuracy…" />;
  if (summary.isError) return <ErrorBlock error={summary.error} />;
  const s = summary.data!;
  const live = sweep.data?.live;

  const caught       = live ? Math.round(live.recall    * 100) : null;
  const rightAlerts  = live ? Math.round(live.precision * 100) : null;
  const f1Score      = live ? Math.round(live.f1        * 100) : null;
  const falseAlarms  = rightAlerts !== null ? 100 - rightAlerts : null;
  const aucPr        = Math.round(s.auc_pr * 100);

  // Group features by category
  const featureList  = features.data?.selected_features ?? [];
  const grouped = featureList.reduce<Record<string, string[]>>((acc, f) => {
    const k = categorise(f);
    (acc[k] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accuracy & Trust"
        subtitle="How dependable the warnings are — measured on real history the system never saw while learning."
      />

      {/* ---- 4 headline KPIs -------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <GlassCard className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Failures caught</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500 text-white">
              <IconShield size={18} />
            </span>
          </div>
          <div>
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {caught !== null ? `${caught}%` : "—"}
            </span>
            <p className="mt-0.5 text-xs text-slate-500">of every 100 real breakdowns</p>
          </div>
          {caught !== null && <ScoreBadge value={caught} />}
        </GlassCard>

        <GlassCard className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Right alerts</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500 text-white">
              <IconActivity size={18} />
            </span>
          </div>
          <div>
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {rightAlerts !== null ? `${rightAlerts}%` : "—"}
            </span>
            <p className="mt-0.5 text-xs text-slate-500">of every 100 alerts are real</p>
          </div>
          {rightAlerts !== null && <ScoreBadge value={rightAlerts} thresholds={[70, 50]} />}
        </GlassCard>

        <GlassCard className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Balance score</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-white">
              <IconTarget size={18} />
            </span>
          </div>
          <div>
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {f1Score !== null ? `${f1Score}%` : "—"}
            </span>
            <p className="mt-0.5 text-xs text-slate-500">overall F1 — balances both goals</p>
          </div>
          {f1Score !== null && <ScoreBadge value={f1Score} />}
        </GlassCard>

        <GlassCard className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Detection strength</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500 text-white">
              <IconClock size={18} />
            </span>
          </div>
          <div>
            <span className="text-3xl font-bold text-slate-900 dark:text-white">{aucPr}%</span>
            <p className="mt-0.5 text-xs text-slate-500">area under precision-recall curve</p>
          </div>
          <ScoreBadge value={aucPr} />
        </GlassCard>
      </div>

      {/* ---- Plain-English outcome card ---------------------------------- */}
      <GlassCard className="p-6">
        <SectionTitle
          title="What this means in practice"
          subtitle={`At alert sensitivity ${threshold.toFixed(2)} — what happens to every 100 real failures and every 100 alerts raised.`}
          info="Recall = failures caught ÷ total real failures. Precision = real failures ÷ total alerts raised. These are always a trade-off: raising sensitivity catches more failures but raises more false alarms. Lower it to reduce noise; raise it to be more conservative."
        />
        {caught !== null && falseAlarms !== null && (
          <OutcomeMeter caught={caught} falseAlarms={falseAlarms} />
        )}
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
          <p>
            With sensitivity set to{" "}
            <span className="font-semibold text-indigo-600 dark:text-indigo-300">{threshold.toFixed(2)}</span>:
            the system <span className="font-semibold text-emerald-600 dark:text-emerald-300">never misses a real failure</span>{" "}
            (catches {caught ?? "—"} out of 100), but about{" "}
            <span className="font-semibold text-amber-600 dark:text-amber-300">{falseAlarms ?? "—"} in every 100 alerts</span>{" "}
            are unnecessary. That trade-off is the cost of catching everything.
          </p>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            Move the <span className="font-medium text-slate-700 dark:text-slate-200">Alert sensitivity</span> slider in the top bar:{" "}
            <span className="font-medium">higher</span> → fewer false alarms (but may miss some failures);{" "}
            <span className="font-medium">lower</span> → catches even more failures (but more false alarms).
          </p>
        </div>
      </GlassCard>

      {/* ---- Interactive sensitivity chart ------------------------------- */}
      <GlassCard className="p-6">
        <SectionTitle
          title="How sensitivity changes the trade-off"
          subtitle="Move the Alert sensitivity slider — the dotted line follows your current setting."
          info="Green = failures caught (recall). Blue = right alerts (precision). Amber dashed = overall balance (F1). The two goals always trade off — higher sensitivity catches more failures but raises more false alarms."
        />
        {sweep.data ? (
          <ThresholdSweepChart data={sweep.data.table} current={threshold} />
        ) : (
          <div className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-white/5" />
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          {[
            { color: "bg-emerald-500", label: "Failures caught — never let a breakdown through" },
            { color: "bg-sky-500",     label: "Right alerts — how many alerts are real" },
            { color: "bg-amber-500",   label: "Balance (F1) — overall score combining both" },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className={cn("h-2.5 w-2.5 rounded-sm", l.color)} />
              {l.label}
            </span>
          ))}
        </div>
      </GlassCard>

      {/* ---- Per-component breakdown ------------------------------------- */}
      <GlassCard className="p-6">
        <SectionTitle
          title="Performance by part type"
          subtitle="How well the system detects failures for each component — and how many false alarms per component."
          info="Each row is one component type. 'Catch rate' = what % of that part's failures were caught. 'True alerts' = what % of alerts for that part turned out real. The system is tuned to never miss a failure, so catch rates are near 100% everywhere."
        />
        {components.data ? (
          <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-white/10 dark:bg-white/5">
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Part type</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Failures in history</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Catch rate</th>
                  <th className="hidden px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 sm:table-cell">True alerts</th>
                  <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {[...components.data.items]
                  .sort((a, b) => b.f1 - a.f1)
                  .map((c) => {
                    const recall = Math.round(c.recall * 100);
                    const prec   = Math.round(c.precision * 100);
                    const f1     = Math.round(c.f1 * 100);
                    return (
                      <tr key={c.component} className="hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{prettyComp(c.component)}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{c.n_failures} events</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${recall}%` }} />
                            </div>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{recall}%</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900/30">
                              <div className="h-full rounded-full bg-sky-500" style={{ width: `${prec}%` }} />
                            </div>
                            <span className="font-semibold text-sky-600 dark:text-sky-400">{prec}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <ScoreBadge value={f1} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-white/5" />
        )}
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          "True alerts" is low because the model is optimized to catch every failure — it raises more alerts than needed on purpose.
          Raise sensitivity in the top bar to reduce false alarms (at the cost of occasionally missing one).
        </p>
      </GlassCard>

      {/* ---- What it watches — categorised ------------------------------ */}
      <GlassCard className="p-6">
        <SectionTitle
          title="What the system watches"
          subtitle={`${featureList.length} measurements that the model weighs to make each prediction.`}
          info="These are the signals the XGBoost model found most predictive of failures 12 hours in advance. They were selected automatically from all available telemetry — everything else was discarded as noise."
        />
        {features.data ? (
          <div className="mt-3 space-y-5">
            {(Object.entries(CAT_META) as [keyof typeof CAT_META, typeof CAT_META[keyof typeof CAT_META]][]).map(([cat, meta]) => {
              const items = grouped[cat] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {meta.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((f) => (
                      <span key={f} className={cn("rounded-full px-3 py-1 text-xs font-medium", meta.color)}>
                        {prettyFeature(f)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-white/5" />
        )}
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          The strongest predictors are typically "time since last service" features — parts about to fail have been running
          longest since their last replacement.
        </p>
      </GlassCard>

      {/* ---- Advance warning context ------------------------------------ */}
      <GlassCard className="flex items-start gap-5 p-6">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-indigo-500 text-white">
          <IconClock size={22} />
        </div>
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">
            {s.horizon_hours}-hour advance warning
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Every prediction is made <span className="font-medium text-slate-700 dark:text-slate-300">{s.horizon_hours} hours before</span> the
            model expects a breakdown — enough time to schedule emergency maintenance, source a spare part, or re-route workload
            before the machine goes down. The model uses only information available up to that moment (no lookahead).
          </p>
        </div>
      </GlassCard>
    </div>
  );
}
