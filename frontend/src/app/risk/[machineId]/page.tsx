"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useMachine } from "@/lib/queries";
import { rulLabel, fmtProb, prettyModel, prettyComp, prettySensor, riskScoreColor, clsHazard, clsUrgency, URGENCY_META } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, ModelStrip, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
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

  // Risk score derived from the 12h classifier so it matches the Classification page exactly.
  const clsH = clsHazard(data.classifier_risk);     // H = −ln(1−p)
  const urg = clsUrgency(data);                     // overdue / urgent / soon / planned
  const due = data.at_risk;                         // service now (same flag as Classification)
  const uMeta = URGENCY_META[urg];

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

      <ModelStrip tone="indigo" label="Risk-Score">
        Cumulative hazard from the 12h failure chance: H = −ln(1−p) · same signal as Classification · H ≥ 1 ⇔ service
      </ModelStrip>

      {/* ── Decision hero: classifier-consistent risk score + status ── */}
      <GlassCard className="overflow-hidden p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="h-14 w-1.5 rounded-full" style={{ background: uMeta.color, boxShadow: `0 0 18px ${uMeta.glow}` }} />
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {due ? "Service now — failure predicted"
                  : urg === "urgent" ? "Watch closely"
                  : urg === "soon" ? "Elevated — monitor"
                  : "Healthy — no service needed"}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {due
                  ? `12h classifier flags failure (${fmtProb(data.classifier_risk)}) — act now`
                  : `12h failure chance ${fmtProb(data.classifier_risk)} · sensors ${data.violation_count} of 4 out of band`}
              </div>
            </div>
          </div>
          <span className={cn("rounded-full border px-3 py-1 text-sm font-semibold", uMeta.badge)}>{uMeta.label}</span>
        </div>

        {/* Two aligned readings — identical to the Classification page by construction */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">12-hour failure chance</span>
              <Link href={`/classification/${id}`} className="text-[11px] text-indigo-500 hover:underline dark:text-indigo-300">Classification →</Link>
            </div>
            <div className={cn("mt-1 text-3xl font-bold tabular-nums", due ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white")}>
              {fmtProb(data.classifier_risk)}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${Math.min(data.classifier_risk, 1) * 100}%`, background: due ? "#f43f5e" : "#34d399" }} />
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{due ? "flagged — above alert" : "sensors normal right now"}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk score H(t)</span>
              <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                {clsH.toFixed(2)}<span className="text-sm font-medium text-slate-400"> / 1.00</span>
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(clsH, 1) * 100}%`, background: riskScoreColor(Math.min(clsH, 1) * 100) }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>0 · healthy</span>
              <span>1.0 · service (≈63%)</span>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* ── Survival forecast (supporting statistical view) ── */}
      <div>
        <SectionTitle title="Survival forecast" subtitle="Supporting statistical view — chance of running over the coming days." />
        <div className="grid gap-6 lg:grid-cols-3">
          <GlassCard className="flex flex-col justify-center p-5">
            <RulGauge rulDays={data.rul_days} capped={data.is_capped} dueNow={due} />
            <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              {due ? (
                <>service now — classifier flags failure<br /><span className="text-xs">statistical est. was ~{Math.round(data.rul_days)} days</span></>
              ) : (
                <>est. {rulLabel(data.rul_days, data.is_capped)} · typical {Math.round(data.rul_ci_low_days)}–{Math.round(data.rul_ci_high_days)} days</>
              )}
            </p>
          </GlassCard>
          <GlassCard className="p-5 lg:col-span-2">
            <SurvivalCurveChart
              curve={data.survival_curve}
              baseline={data.km_baseline}
              rulDays={data.rul_days}
              ciLow={data.rul_ci_low_days}
              ciHigh={data.rul_ci_high_days}
              asOf={data.as_of}
              dueNow={due}
            />
          </GlassCard>
        </div>
      </div>

      {/* ── Sensors ── */}
      <div>
        <SectionTitle title="Sensors vs normal range" subtitle="Current readings against each sensor's healthy band." />
        <GlassCard className="p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.sensor_breakdown.map((s) => (
              <SensorGauge key={s.sensor} s={s} />
            ))}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
            <SensorViolationChart data={data.sensor_breakdown} />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
