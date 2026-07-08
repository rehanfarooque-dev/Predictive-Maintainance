"use client";

import Link from "next/link";

import type { FleetItem } from "@/lib/types";
import { URGENCY_META, fmtProb, prettyModel, prettyComp, pdmUrgency, pdmTimeLeft, pdmServiceDate, riskScoreColor } from "@/lib/format";
import { GlassCard, cn } from "@/components/ui";

/**
 * Cross-model priority worklist.
 *
 * Pipeline: the 12-hour CLASSIFIER decides WHICH machines are flagged (acute risk),
 * then the Risk-Score PdM model runs on each of those to answer WHEN to service it.
 * Classifier = the trigger; PdM cycle = the maintenance plan.
 */
export function PriorityWorklist({ items, asOf }: { items: FleetItem[]; asOf?: string }) {
  const flagged = [...items]
    .filter((i) => i.at_risk)
    .sort((a, b) => b.classifier_risk - a.classifier_risk);

  if (flagged.length === 0) {
    return (
      <GlassCard className="flex items-center gap-3 p-6 text-sm text-emerald-600 dark:text-emerald-300">
        <span className="text-lg">✅</span>
        No machines flagged by the 12-hour classifier right now — nothing needs immediate attention.
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      {flagged.map((it) => {
        const urg = pdmUrgency(it);
        const u = URGENCY_META[urg];
        const h = it.pdm_hazard ?? it.risk_score;
        return (
          <Link
            key={it.machineID}
            href={`/risk/${it.machineID}`}
            className="glass glass-hover block overflow-hidden rounded-2xl"
          >
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              {/* Machine identity */}
              <div className="flex items-center gap-3 sm:w-52 sm:shrink-0">
                <span className="h-11 w-1.5 shrink-0 rounded-full bg-rose-500" style={{ boxShadow: "0 0 10px rgba(244,63,94,0.5)" }} />
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">Machine {it.machineID}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{prettyModel(it.model)} · {prettyComp(it.current_comp)}</div>
                </div>
              </div>

              {/* Step 1 — classifier trigger */}
              <div className="flex-1 rounded-xl border border-sky-200/70 bg-sky-50/50 px-4 py-2.5 dark:border-sky-500/20 dark:bg-sky-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">① Classifier · 12h</span>
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300">flagged</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">{fmtProb(it.classifier_risk)}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">chance of failure</span>
                </div>
              </div>

              {/* Arrow */}
              <div className="hidden shrink-0 text-slate-300 dark:text-white/20 sm:block">→</div>

              {/* Step 2 — PdM maintenance plan */}
              <div className="flex-1 rounded-xl border border-indigo-200/70 bg-indigo-50/50 px-4 py-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">② Risk-Score PdM · plan</span>
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", u.badge)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", u.dot, urg === "overdue" && "animate-pulse")} />
                    {u.label}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{pdmTimeLeft(it)}</span>
                    <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">· by {pdmServiceDate(asOf, it.pdm_days_until_due ?? 0)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(h, 1) * 100}%`, background: riskScoreColor(Math.min(h, 1) * 100) }} />
                    </div>
                    <span className="w-8 text-right text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300">H {h.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
