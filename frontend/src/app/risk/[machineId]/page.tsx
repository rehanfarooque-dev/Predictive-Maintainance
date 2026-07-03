"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useMachine } from "@/lib/queries";
import { URGENCY_META, rulLabel, fmtDate, fmtPct, prettyModel, prettyComp, prettySensor, riskScoreColor } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { RulGauge, SurvivalCurveChart, SensorViolationChart } from "@/components/charts";
import type { SensorBreakdown } from "@/lib/types";

function SensorGauge({ s }: { s: SensorBreakdown }) {
  const lo = Math.min(s.lower, s.value);
  const hi = Math.max(s.upper, s.value);
  const pad = (hi - lo) * 0.12 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{prettySensor(s.sensor)}</span>
        <span className={cn("text-sm font-semibold", s.in_band ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
          {s.value.toFixed(1)}
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-slate-200 dark:bg-white/10">
        <div
          className="absolute h-2 rounded-full bg-emerald-500/40"
          style={{ left: pos(s.lower), width: `calc(${pos(s.upper)} - ${pos(s.lower)})` }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-slate-900"
          style={{ left: pos(s.value), background: s.in_band ? "#10b981" : "#f43f5e" }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500">
        <span>{s.lower.toFixed(0)}</span>
        <span>normal band</span>
        <span>{s.upper.toFixed(0)}</span>
      </div>
    </div>
  );
}

export default function RiskDetail() {
  const params = useParams<{ machineId: string }>();
  const id = Number(params.machineId);
  const { data, isLoading, isError, error } = useMachine(id);

  if (isLoading) return <LoadingBlock label={`Loading machine ${id}…`} />;
  if (isError) return <ErrorBlock error={error} />;
  if (!data) return null;

  const u = URGENCY_META[data.urgency];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Machine ${data.machineID} — Service Plan`}
        subtitle={`${prettyModel(data.model)} · oldest part ${prettyComp(data.current_comp)} (in service ${Math.round(data.elapsed_days)} days)`}
        right={
          <Link href={`/classification/${id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-indigo-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-indigo-300 dark:hover:bg-white/10">
            See classification →
          </Link>
        }
      />

      <GlassCard className="flex items-center justify-between overflow-hidden p-5">
        <div className="flex items-center gap-4">
          <span className="h-12 w-1.5 rounded-full" style={{ background: u.color, boxShadow: `0 0 16px ${u.glow}` }} />
          <div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {data.urgency === "overdue" ? "Service now" : `Service in ${rulLabel(data.days_until_service)}`}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Recommended by {fmtDate(data.recommended_service_date)}</div>
          </div>
        </div>
        <span className={cn("rounded-full border px-3 py-1 text-sm font-medium", u.badge)}>{u.label}</span>
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <GlassCard className="p-5">
          <SectionTitle
            title="Estimated time left"
            info="Best estimate = the day by which half of comparable machines (same type, same part age) would have failed, from the Weibull survival model. The typical range is the middle 50% (between 1-in-4 failing early and 3-in-4 still running) — not the rare best/worst cases."
          />
          <RulGauge rulDays={data.rul_days} capped={data.is_capped} />
          <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
            best estimate {rulLabel(data.rul_days, data.is_capped)}
            <br />
            typical range {Math.round(data.rul_ci_low_days)}–{Math.round(data.rul_ci_high_days)} days
          </p>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <SectionTitle
            title="Chance of staying healthy over time"
            subtitle="How likely the machine keeps running over the coming days. Shaded = the typical (middle-50%) range; grey dashed = a typical machine of this kind."
            info="Survival curve. Purple = this machine's chance of still running N days from now; grey dashed = a typical machine of its type (baseline). Where purple crosses 50% ≈ the estimated time left; the shaded band marks the 25th-75th percentile range."
          />
          <SurvivalCurveChart
            curve={data.survival_curve}
            baseline={data.km_baseline}
            rulDays={data.rul_days}
            ciLow={data.rul_ci_low_days}
            ciHigh={data.rul_ci_high_days}
          />
        </GlassCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-5">
          <SectionTitle
            title="Risk score — cumulative hazard"
            subtitle="The raw Weibull cumulative hazard H(t). Failure threshold = 1.0."
            info="The risk score is the Weibull model's cumulative hazard H(t) at the part's current age — the raw value, not scaled. H accumulates failure 'damage': 0 when new, and 1.0 at the characteristic life (63% cumulative failure probability) = failure. It keeps climbing past 1.0. It's covariate-adjusted, so a machine in worse condition (higher sensor levels, more errors) climbs faster and crosses 1.0 sooner. The 12h failure chance and sensor anomalies are separate signals, shown below."
          />
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-4xl font-bold text-slate-900 dark:text-white">
                  {data.risk_score.toFixed(2)}
                  <span className="text-lg font-medium text-slate-400"> / 1.00</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  cumulative hazard · 1.00 = failure
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold",
                  data.at_end_of_life
                    ? "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    : "border-slate-300/60 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
                )}
              >
                {data.at_end_of_life ? "Past end of life" : `${Math.round(data.risk_score * 100)}% to failure`}
              </span>
            </div>

            {/* Hazard bar toward the failure line (H = 1.0) */}
            <div>
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(data.risk_score, 1) * 100}%`, background: riskScoreColor(Math.min(data.risk_score, 1) * 100) }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                <span>0 · new part</span>
                <span>1.0 · failure (63% chance)</span>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
              Oldest part <span className="font-medium">{prettyComp(data.current_comp)}</span> has run{" "}
              {Math.round(data.elapsed_days)} days · 12h failure chance{" "}
              <span className="font-medium">{fmtPct(data.classifier_risk)}</span> ·{" "}
              {data.violation_count} of 4 sensors out of band.
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionTitle title="How far each sensor is out of range" subtitle="Longer red bar = further outside the normal range (green = normal)." />
          <SensorViolationChart data={data.sensor_breakdown} />
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <SectionTitle title="Current sensor readings vs normal band" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.sensor_breakdown.map((s) => (
            <SensorGauge key={s.sensor} s={s} />
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
