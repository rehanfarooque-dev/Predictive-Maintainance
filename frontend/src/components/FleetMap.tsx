"use client";

import Link from "next/link";

import type { FleetItem } from "@/lib/types";
import { URGENCY_META, rulLabel, fmtPct } from "@/lib/format";
import { cn } from "@/components/ui";

// A 100-machine status heatmap — each tile is a machine, colored by urgency.
// Tiles with at_risk=true pulse to show the classifier sees imminent failure.
export function FleetMap({ items }: { items: FleetItem[] }) {
  const sorted = [...items].sort((a, b) => a.machineID - b.machineID);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((it) => {
          const u = URGENCY_META[it.urgency];
          return (
            <Link
              key={it.machineID}
              href={`/risk/${it.machineID}`}
              title={`Machine ${it.machineID} · ${u.label} · service in ${it.days_until_service}d · failure chance ${fmtPct(it.classifier_risk)} · RUL ${rulLabel(it.rul_days, it.is_capped)}`}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-md text-[10px] font-bold text-slate-950/80 transition-all hover:z-10 hover:scale-125",
                it.at_risk && "animate-pulse ring-2 ring-rose-500 ring-offset-1",
              )}
              style={{ background: u.color, boxShadow: `0 0 0 1px rgba(0,0,0,0.2) inset` }}
            >
              {it.machineID}
            </Link>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
        {(["overdue", "urgent", "soon", "planned"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: URGENCY_META[k].color }} />
            {URGENCY_META[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-sm bg-rose-500 ring-1 ring-rose-400" />
          Pulsing = classifier sees imminent failure (&gt;50% in 12h)
        </span>
      </div>
    </div>
  );
}
