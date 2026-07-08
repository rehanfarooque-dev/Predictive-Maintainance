"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useMachine } from "@/lib/queries";
import { useControls } from "@/lib/store";
import { fmtPct, fmtProb, statusFromRisk, prettyModel, prettyFeature, fmtDateTime } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, ModelStrip, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { ClassifierRiskChart } from "@/components/charts";
import type { ShapContribution } from "@/lib/types";

export default function ClassificationDetail() {
  const params = useParams<{ machineId: string }>();
  const id = Number(params.machineId);
  const { data, isLoading, isError, error } = useMachine(id);
  const { threshold } = useControls();

  if (isLoading) return <LoadingBlock label={`Loading machine ${id}…`} />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const status = statusFromRisk(data.at_risk);

  // Peak classifier risk across the loaded history — proves the model reacts.
  const peak = (data.timeseries ?? []).reduce(
    (best, p) => (p.risk > best.risk ? p : best),
    { risk: -1, datetime: "" },
  );
  const hasPeak = peak.risk > 0.5;

  // Validation: count actual failure windows (label===1 runs) and how many the model
  // flagged (risk crossed the alert threshold inside the window) — from the selected date
  // onward, matching the chart's as-of view.
  const ts = (data.timeseries ?? []).filter((p) => p.datetime >= data.as_of);
  let nWindows = 0;
  let nCaught = 0;
  let inRun = false;
  let runCaught = false;
  for (const p of ts) {
    if (p.label === 1) {
      if (!inRun) { inRun = true; runCaught = false; nWindows++; }
      if (p.risk >= threshold) runCaught = true;
    } else if (inRun) {
      if (runCaught) nCaught++;
      inRun = false;
    }
  }
  if (inRun && runCaught) nCaught++;

  // SHAP interpretation helpers
  const features = data.top_features;
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap_value)), 0.01);
  const riskFactors = features.filter((f) => f.shap_value > 0).slice(0, 5);
  const safetyFactors = features.filter((f) => f.shap_value < 0).slice(0, 5);
  const impactLabel = (v: number) => {
    const pct = Math.abs(v) / maxAbs;
    if (pct >= 0.6) return "Strong";
    if (pct >= 0.3) return "Moderate";
    return "Minor";
  };
  const topRisk = riskFactors[0];
  const topSafety = safetyFactors[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Machine ${data.machineID}`}
        subtitle={`${prettyModel(data.model)} · age ${data.age} · failure chance ${fmtPct(data.classifier_risk)}`}
        right={
          <div className="flex items-center gap-3">
            <span className={cn("inline-flex rounded-full border px-3 py-1 text-sm font-medium", status.badge)}>{status.label}</span>
            <Link href={`/risk/${id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-indigo-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-indigo-300 dark:hover:bg-white/10">
              See risk &amp; RUL →
            </Link>
          </div>
        }
      />

      <ModelStrip tone="sky" label="12h Classifier">
        XGBoost on engineered sensor features · predicts failure within 12 hours
      </ModelStrip>

      {/* Headline 12h failure probability */}
      <GlassCard className="p-6">
        <div className="flex items-end justify-between">
          <div>
            <div className={cn("text-5xl font-black tabular-nums", data.at_risk ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white")}>
              {fmtProb(data.classifier_risk)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">chance of failure in the next 12 hours</div>
          </div>
          <span className={cn("rounded-full border px-3 py-1 text-sm font-medium", status.badge)}>{status.label}</span>
        </div>
        <div className="mt-4">
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(data.classifier_risk, 1) * 100}%`, background: data.at_risk ? "#f43f5e" : "#34d399" }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span>0% · healthy</span>
            <span>100% · imminent failure</span>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
          {data.at_risk ? (
            <>The model is flagging this machine — sensor patterns match an imminent-failure signature.</>
          ) : (
            <>
              A low score is the healthy, expected reading — failures are rare, so most of the time the model sees no danger.
              {hasPeak && (
                <> This machine&apos;s risk did spike to{" "}
                  <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtPct(peak.risk)}</span> on{" "}
                  <span className="font-medium">{fmtDateTime(peak.datetime)}</span> — the model reacts when sensors turn dangerous (see below).
                </>
              )}
            </>
          )}
        </div>
      </GlassCard>

      {/* 12h failure probability over time — proves the classifier is live and reacts */}
      <GlassCard className="p-5">
        <SectionTitle
          title="Failure probability over time"
          subtitle="The classifier's 12-hour failure chance, hour by hour. Flat near 0 when healthy, spiking toward 100% when a failure approaches."
          info="This is the same XGBoost model evaluated across the machine's history. The spikes show it actively detecting dangerous sensor patterns; the flat stretches are genuinely healthy periods. Green bands are the actual failure windows (ground truth). The dashed line is the current alert threshold."
          right={
            nWindows > 0 ? (
              <span className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                nCaught === nWindows
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
              )}>
                Caught {nCaught} of {nWindows} failures
              </span>
            ) : (
              <span className="rounded-full border border-slate-300/60 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                No failures in this period
              </span>
            )
          }
        />
        <ClassifierRiskChart data={data.timeseries} threshold={threshold} asOf={data.as_of} />
      </GlassCard>

      <GlassCard className="p-5">
        <SectionTitle
          title="What's driving this prediction"
          info="SHAP values — how much each measurement pushes the prediction toward failure (red) or away from it (green)."
        />

        {/* Plain-English summary sentence */}
        <p className="mb-4 rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-300">
          {topRisk && topSafety ? (
            <>
              The model is mainly concerned about{" "}
              <span className="font-semibold text-rose-600 dark:text-rose-400">{prettyFeature(topRisk.feature)}</span>
              , which is the strongest signal pushing failure risk up. At the same time,{" "}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{prettyFeature(topSafety.feature)}</span>
              {" "}is the biggest factor keeping this machine safe.
            </>
          ) : topRisk ? (
            <>
              The strongest signal driving risk up is{" "}
              <span className="font-semibold text-rose-600 dark:text-rose-400">{prettyFeature(topRisk.feature)}</span>.
              No single measurement is significantly reducing risk.
            </>
          ) : topSafety ? (
            <>
              This machine looks healthy.{" "}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{prettyFeature(topSafety.feature)}</span>
              {" "}is the main reason the model rates it as low-risk.
            </>
          ) : (
            "No strong signals in either direction — the model sees this machine as average."
          )}
        </p>

        {/* Two-column factor breakdown */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Risk factors */}
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3 dark:border-rose-900/30 dark:bg-rose-950/20">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              ↑ Pushing toward failure
            </p>
            {riskFactors.length === 0 ? (
              <p className="text-xs text-slate-400">No significant risk signals right now.</p>
            ) : (
              riskFactors.map((f: ShapContribution) => (
                <div key={f.feature} className="mb-2.5 last:mb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
                      {prettyFeature(f.feature)}
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      impactLabel(f.shap_value) === "Strong"
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                        : impactLabel(f.shap_value) === "Moderate"
                        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                        : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400",
                    )}>
                      {impactLabel(f.shap_value)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-900/30">
                    <div
                      className="h-full rounded-full bg-rose-400"
                      style={{ width: `${(f.shap_value / maxAbs) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Safety factors */}
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 dark:border-emerald-900/30 dark:bg-emerald-950/20">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              ↓ Keeping it safe
            </p>
            {safetyFactors.length === 0 ? (
              <p className="text-xs text-slate-400">No significant safety factors right now.</p>
            ) : (
              safetyFactors.map((f: ShapContribution) => (
                <div key={f.feature} className="mb-2.5 last:mb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
                      {prettyFeature(f.feature)}
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      impactLabel(f.shap_value) === "Strong"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : impactLabel(f.shap_value) === "Moderate"
                        ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                        : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400",
                    )}>
                      {impactLabel(f.shap_value)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{ width: `${(Math.abs(f.shap_value) / maxAbs) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
