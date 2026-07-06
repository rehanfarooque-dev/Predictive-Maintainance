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
            asOf={data.as_of}
          />
        </GlassCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-5">
          <SectionTitle
            title="Risk score — cumulative hazard H(t)"
            subtitle={
              data.at_end_of_life
                ? `H = ${data.risk_score.toFixed(2)} · this part has lived ${data.risk_score.toFixed(1)}× its expected lifespan`
                : `H = ${data.risk_score.toFixed(2)} · ${Math.round(data.risk_score * 100)}% through its expected life`
            }
            info="H(t) = Weibull cumulative hazard. Each time H crosses 1.0 the part has lived one full 'characteristic life' (the age by which 63% of comparable parts fail). H = 2.0 means the part has survived twice that long; H = 10.2 means ten full lifetimes. The 12h classifier is a separate model — a low failure-chance score means sensors look fine today, NOT that the part is young."
          />

          {data.at_end_of_life ? (
            /* ── H ≥ 1.0: life-cycle view ─────────────────────────────── */
            <div className="space-y-4">
              {/* headline */}
              <div className="flex items-end justify-between">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black tabular-nums text-rose-600 dark:text-rose-400">
                      ×{data.risk_score.toFixed(1)}
                    </span>
                    <span className="text-sm font-medium text-rose-500 dark:text-rose-400">
                      life cycles past failure
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    H = {data.risk_score.toFixed(2)} · threshold = 1.0 · ratio = {data.risk_score.toFixed(1)}×
                  </div>
                </div>
                <span className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                  Past end of life
                </span>
              </div>

              {/* segmented lifecycle bar — each block = 1 complete lifecycle (H=1.0) */}
              {(() => {
                const total = data.risk_score;
                const fullCycles = Math.min(Math.floor(total), 12);
                const remainder = total - Math.floor(total);
                const showMore = Math.floor(total) > 12;
                return (
                  <div>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: fullCycles }, (_, i) => (
                        <div
                          key={i}
                          title={`Life cycle ${i + 1} (H = ${i + 1}.0)`}
                          className="h-4 min-w-0 flex-1 rounded-sm bg-rose-500"
                        />
                      ))}
                      {!showMore && remainder > 0 && (
                        <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-slate-200 dark:bg-white/10">
                          <div className="h-full bg-rose-400" style={{ width: `${remainder * 100}%` }} />
                        </div>
                      )}
                      {showMore && (
                        <span className="ml-1 text-[10px] font-semibold text-rose-500">
                          +{(Math.floor(total) - 12)} more
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                      <span>0 · installed</span>
                      <span className="text-rose-500">each block = one full characteristic life (H = 1.0)</span>
                    </div>
                  </div>
                );
              })()}

              {/* context row */}
              <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                <span className="font-semibold">{prettyComp(data.current_comp)}</span> has run{" "}
                <span className="font-semibold">{Math.round(data.elapsed_days)} days</span> without replacement.
                Statistically it should have been replaced about{" "}
                <span className="font-semibold">{Math.floor(data.risk_score)} time{Math.floor(data.risk_score) !== 1 ? "s" : ""}</span> by now.
                {data.classifier_risk < 0.1 && (
                  <span className="mt-1 block text-rose-600/80 dark:text-rose-400/80">
                    The 12h classifier shows {fmtPct(data.classifier_risk)} failure risk because sensors are normal today — this is a wear-out warning, not an acute fault.
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* ── H < 1.0: normal progress bar ──────────────────────────── */
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-4xl font-bold text-slate-900 dark:text-white">
                    {data.risk_score.toFixed(2)}
                    <span className="text-lg font-medium text-slate-400"> / 1.00</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    cumulative hazard · 1.00 = one full characteristic life
                  </div>
                </div>
                <span className="rounded-full border border-slate-300/60 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                  {Math.round(data.risk_score * 100)}% to failure
                </span>
              </div>
              <div>
                <div className="relative h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${data.risk_score * 100}%`, background: riskScoreColor(data.risk_score * 100) }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>0 · new part</span>
                  <span>1.0 · characteristic life (63% failure probability)</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                Oldest part <span className="font-medium">{prettyComp(data.current_comp)}</span> has run{" "}
                {Math.round(data.elapsed_days)} days · 12h failure chance{" "}
                <span className="font-medium">{fmtPct(data.classifier_risk)}</span> ·{" "}
                {data.violation_count} of 4 sensors out of band.
              </div>
            </div>
          )}
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
