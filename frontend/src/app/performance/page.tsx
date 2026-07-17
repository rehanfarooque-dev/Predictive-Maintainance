"use client";

import { useState } from "react";

import { useEvaluation } from "@/lib/queries";
import { useControls } from "@/lib/store";
import { api } from "@/lib/api";
import { fmtPct } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, ModelStrip, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { ThresholdSweepChart } from "@/components/charts";
import type { ModelEvaluation } from "@/lib/types";

/* ── One metric, with a ring gauge + plain-English meaning ───────────────── */
function MetricCard({
  label, value, blurb, formula, tone, good,
}: {
  label: string; value: number; blurb: string; formula: string;
  tone: string; good: (v: number) => boolean;
}) {
  const pct = Math.max(0, Math.min(1, value));
  const R = 26, C = 2 * Math.PI * R;
  return (
    <GlassCard className="p-5">
      <div className="flex items-start gap-4">
        <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
          <circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-200 dark:text-white/10" />
          <circle
            cx="32" cy="32" r={R} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90 32 32)"
          />
          <text x="32" y="36" textAnchor="middle" className="fill-slate-900 dark:fill-white" fontSize="13" fontWeight="700">
            {Math.round(pct * 100)}
          </text>
        </svg>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
              good(value)
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
            )}>
              {good(value) ? "strong" : "watch"}
            </span>
          </div>
          <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value.toFixed(3)}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{blurb}</p>
          <code className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">{formula}</code>
        </div>
      </div>
    </GlassCard>
  );
}

/* ── Confusion matrix ────────────────────────────────────────────────────── */
function ConfusionMatrix({ c }: { c: ModelEvaluation["confusion"] }) {
  const cells = [
    { k: "TN", v: c.tn, label: "True negative", desc: "healthy, called healthy", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
    { k: "FP", v: c.fp, label: "False positive", desc: "healthy, false alarm", cls: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
    { k: "FN", v: c.fn, label: "False negative", desc: "failure MISSED", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
    { k: "TP", v: c.tp, label: "True positive", desc: "failure caught", cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {cells.map((x) => (
          <div key={x.k} className={cn("rounded-xl p-4", x.cls)}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{x.k} · {x.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{x.v.toLocaleString()}</div>
            <div className="text-[11px] opacity-80">{x.desc}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Rows = truth, columns = prediction. The number that matters most is{" "}
        <span className="font-semibold text-rose-600 dark:text-rose-400">FN ({c.fn})</span> — failures the model missed.
      </p>
    </div>
  );
}

export default function PerformancePage() {
  const { threshold } = useControls();
  const { data, isLoading, isFetching, isError, error } = useEvaluation();
  const [plot, setPlot] = useState("shap_summary");

  if (isLoading) return <LoadingBlock label="Evaluating model…" />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const PLOT_LABEL: Record<string, string> = {
    shap_summary: "SHAP feature importance",
    optuna_history: "Optuna tuning history",
  };
  // PR / ROC curves are intentionally excluded from this view.
  const HIDDEN_PLOTS = new Set(["pr_curve", "roc_curve"]);
  const visiblePlots = data.plots.filter((p) => !HIDDEN_PLOTS.has(p));
  const activePlot = visiblePlots.includes(plot) ? plot : visiblePlots[0] ?? "";

  return (
    <div className={cn("space-y-6 transition-opacity", isFetching && "opacity-70")}>
      <PageHeader
        title="Model Performance & Evaluation"
        subtitle={`XGBoost · ${data.model.horizon_hours}h horizon · ${data.model.n_features} features · alert ${data.threshold.toFixed(2)}`}
      />

      <ModelStrip tone="sky" label="Held-out evaluation">
        Recomputed live on the chronological test split ({data.n_test_rows.toLocaleString()} rows ·{" "}
        {data.n_positives.toLocaleString()} real failures · {fmtPct(data.positive_rate, 2)} positive rate) — updates on every retrain.
      </ModelStrip>

      {/* ── Headline metrics ── */}
      <div>
        <SectionTitle title="Headline metrics" subtitle="Threshold-dependent metrics follow the ALERTS slider; AUC values are threshold-free." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Recall (Sensitivity)" value={data.recall} tone="#10b981" good={(v) => v >= 0.9}
            blurb="Of all real failures, how many the model caught. The most important metric here — a miss means an unplanned breakdown."
            formula="TP / (TP + FN)"
          />
          <MetricCard
            label="Precision" value={data.precision} tone="#0ea5e9" good={(v) => v >= 0.6}
            blurb="Of the machines flagged, how many really failed. Low precision = wasted inspections (false alarms)."
            formula="TP / (TP + FP)"
          />
          <MetricCard
            label="F1-Score" value={data.f1} tone="#f59e0b" good={(v) => v >= 0.7}
            blurb="Harmonic mean of precision and recall — a single balanced score when you care about both."
            formula="2·P·R / (P + R)"
          />
          <MetricCard
            label="AUC-PR" value={data.auc_pr} tone="#6366f1" good={(v) => v >= 0.8}
            blurb="Area under the precision–recall curve. The honest headline metric for rare events like failures (~0.09% of hours)."
            formula="threshold-free · rare-event skill"
          />
          <MetricCard
            label="AUC-ROC" value={data.auc_roc} tone="#8b5cf6" good={(v) => v >= 0.9}
            blurb="Ranking quality across all thresholds. Looks flattering on imbalanced data, so read it alongside AUC-PR."
            formula="threshold-free · ranking skill"
          />
          <MetricCard
            label="Accuracy" value={data.accuracy} tone="#94a3b8" good={(v) => v >= 0.95}
            blurb="Share of all predictions that were right. MISLEADING here — always predicting 'healthy' would already score ~99.9%."
            formula="(TP + TN) / all"
          />
        </div>
      </div>

      {/* ── Confusion matrix + threshold trade-off ── */}
      <div className="grid gap-6 lg:grid-cols-5">
        <GlassCard className="p-5 lg:col-span-2">
          <SectionTitle
            title="Confusion matrix"
            subtitle={`At the current alert threshold (${data.threshold.toFixed(2)}).`}
            info="Counts on the held-out test set. TP = failures caught, FN = failures missed, FP = false alarms, TN = correctly-quiet hours."
          />
          <ConfusionMatrix c={data.confusion} />
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-3">
          <SectionTitle
            title="Threshold trade-off"
            subtitle="Move the ALERTS slider to trade false alarms against missed failures — this chart shows the whole curve."
            info="Lower threshold → higher recall (catch more) but lower precision (more false alarms). The dashed line is your current setting."
          />
          <ThresholdSweepChart data={data.threshold_table} current={threshold} />
        </GlassCard>
      </div>

      {/* ── Diagnostic plots (PR / ROC curves intentionally excluded) ── */}
      {visiblePlots.length > 0 && (
        <GlassCard className="p-5">
          <SectionTitle
            title="Diagnostics"
            subtitle="Generated at training time."
            right={
              visiblePlots.length > 1 ? (
                <div className="flex flex-wrap gap-1">
                  {visiblePlots.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPlot(p)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        activePlot === p
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-400 dark:hover:bg-white/20",
                      )}
                    >
                      {PLOT_LABEL[p] ?? p}
                    </button>
                  ))}
                </div>
              ) : null
            }
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={api.plotUrl(activePlot)}
            alt={PLOT_LABEL[activePlot] ?? activePlot}
            className="mx-auto max-h-[440px] w-auto max-w-full rounded-lg bg-white p-2"
          />
        </GlassCard>
      )}
    </div>
  );
}
