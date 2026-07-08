"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useMachine } from "@/lib/queries";
import { rulLabel, fmtPct, prettyModel, prettyComp, prettySensor, riskScoreColor } from "@/lib/format";
import { GlassCard, PageHeader, SectionTitle, ModelStrip, LoadingBlock, ErrorBlock, cn } from "@/components/ui";
import { RulGauge, SurvivalCurveChart, SensorViolationChart, MaintenanceProjectionChart } from "@/components/charts";
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

  // Hybrid recurrence model (PRIMARY): clock resets at the last classifier-predicted failure.
  const surH = data.surrogate_hazard ?? 0;
  const surCycle = data.surrogate_cycle_days ?? 53;
  const surShape = data.surrogate_shape ?? 1.33;
  const surSince = data.surrogate_days_since_alarm ?? null;
  const surUntil = data.surrogate_days_until_due ?? surCycle;
  const surDue = data.surrogate_due ?? false;
  const surInAlarm = data.surrogate_in_alarm ?? false;
  const surPct = Math.min(surH, 1);

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

      <ModelStrip tone="indigo" label="Risk-Score · Hybrid recurrence">
        Clock resets at the last predicted failure · due when H(t) reaches 1.0 · {Math.round((data.surrogate_recall ?? 0) * 100)}% of real failures had a preceding alarm
      </ModelStrip>

      {/* ── Decision hero: recurrence recommendation + H(t) meter ── */}
      <GlassCard className="overflow-hidden p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span
              className="h-14 w-1.5 rounded-full"
              style={{
                background: surDue ? "#f43f5e" : surUntil < 14 ? "#fb923c" : "#10b981",
                boxShadow: `0 0 18px ${surDue ? "#f43f5e66" : "#10b98155"}`,
              }}
            />
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {surInAlarm ? "Service now — failure predicted" : surDue ? "Service due now" : `Next service in ~${Math.round(surUntil)} days`}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {surInAlarm
                  ? `classifier flags failure within 12h (${fmtPct(data.classifier_risk)}) — act now`
                  : surSince == null
                    ? "no predicted-failure alarm on record yet"
                    : `last predicted failure ${Math.round(surSince)} days ago · recurrence cycle ${Math.round(surCycle)} days`}
              </div>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-semibold",
              surDue
                ? "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : surUntil < 14
                  ? "border-orange-500/30 bg-orange-500/15 text-orange-700 dark:text-orange-300"
                  : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
            )}
          >
            {surDue ? "Due" : surUntil < 14 ? "Soon" : "Healthy"}
          </span>
        </div>

        {/* Recurrence H(t) meter */}
        <div className="mt-6">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Recurrence risk H(t)</span>
            <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {surH.toFixed(2)}<span className="text-sm font-medium text-slate-400"> / 1.00</span>
            </span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div className="h-full rounded-full transition-all" style={{ width: `${surPct * 100}%`, background: riskScoreColor(surPct * 100) }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>0 · just serviced</span>
            <span>{Math.round(surPct * 100)}% to next</span>
            <span>1.0 · service</span>
          </div>
        </div>
      </GlassCard>

      {/* ── Projection: recurrence H(t) climbing from the last predicted failure ── */}
      <GlassCard className="p-5">
        <SectionTitle
          title="Projected recurrence risk"
          subtitle={`From the last predicted failure, H(t) climbs and crosses 1.0 on the next predicted service date (${Math.round(surCycle)}-day recurrence cycle).`}
          info="Hybrid model. The clock starts at the machine's last classifier-predicted failure; H(t) = (days since that alarm / recurrence cycle)^shape is projected forward. Crossing 1.0 = the next predicted service date. Validated: most real failures were preceded by an alarm."
        />
        <MaintenanceProjectionChart asOf={data.as_of} elapsedDays={surSince ?? 0} cycleDays={surCycle} shape={surShape} />
      </GlassCard>

      {/* ── Survival forecast (supporting statistical view) ── */}
      <div>
        <SectionTitle title="Survival forecast" subtitle="Supporting statistical view — chance of running over the coming days." />
        <div className="grid gap-6 lg:grid-cols-3">
          <GlassCard className="flex flex-col justify-center p-5">
            <RulGauge rulDays={data.rul_days} capped={data.is_capped} />
            <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
              est. {rulLabel(data.rul_days, data.is_capped)} · typical {Math.round(data.rul_ci_low_days)}–{Math.round(data.rul_ci_high_days)} days
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
