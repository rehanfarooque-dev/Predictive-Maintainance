"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useMachine } from "@/lib/queries";
import { fmtPct, statusFromRisk, prettyModel, prettyComp, rulLabel, prettyFeature } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { RiskOverTimeChart, SurvivalCurveChart, ShapBarChart } from "@/components/charts";
import type { ShapContribution } from "@/lib/types";

export default function ClassificationDetail() {
  const params = useParams<{ machineId: string }>();
  const id = Number(params.machineId);
  const { data, isLoading, isError, error } = useMachine(id);

  if (isLoading) return <LoadingBlock label={`Loading machine ${id}…`} />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const status = statusFromRisk(data.at_risk);

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

      <GlassCard className="p-5">
        <SectionTitle
          title="Risk score over time"
          subtitle="Weibull cumulative hazard, hour by hour. The red dashed line at 1.0 is the failure threshold."
          info="The risk score is the fitted Weibull model's cumulative hazard H(t) at the part's age. It climbs from 0 as the part ages and drops back toward 0 each time the part is replaced (the sawtooth). Reaching 1.0 = the characteristic life (63% cumulative failure probability) = failure. Read straight from the survival model — no hand-tuned blend."
        />
        <RiskOverTimeChart data={data.timeseries} asOf={data.as_of} />
      </GlassCard>

      <GlassCard className="p-5">
        <SectionTitle
          title="Survival analysis — chance of staying healthy"
          subtitle="How likely this machine keeps running over the coming days. Shaded = the typical (middle-50%) range; grey dashed = a typical machine of this kind."
          info="Survival curve from the Weibull model, given how long the oldest part has already run. Purple = this machine's chance of still running N days from now; where it crosses 50% ≈ the estimated time left. The red line marks the RUL."
        />
        <SurvivalCurveChart
          curve={data.survival_curve}
          baseline={data.km_baseline}
          rulDays={data.rul_days}
          ciLow={data.rul_ci_low_days}
          ciHigh={data.rul_ci_high_days}
          asOf={data.as_of}
        />
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Oldest part <span className="font-medium text-slate-700 dark:text-slate-200">{prettyComp(data.current_comp)}</span> has run{" "}
          {Math.round(data.elapsed_days)} days · estimated time left{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">{rulLabel(data.rul_days, data.is_capped)}</span>{" "}
          (typical range {Math.round(data.rul_ci_low_days)}–{Math.round(data.rul_ci_high_days)} days).
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionTitle
          title="What's driving this prediction"
          subtitle="Why the model thinks this machine is healthy or at risk — in plain terms."
          info="Each bar shows how much one measurement pushed the model's prediction toward failure (red, rightward) or away from it (green, leftward). The longer the bar, the bigger the influence. These are SHAP values: they add up to the total failure probability, so you can see exactly which signals matter most right now."
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
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        {/* Full bar chart — all features, smallest to largest */}
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">Full breakdown — all signals</p>
        <ShapBarChart data={data.top_features} />
      </GlassCard>
    </div>
  );
}
