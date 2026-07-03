"use client";

import { useEffect, useRef, useState } from "react";

import { useControls } from "@/lib/store";
import { useThresholdSweep } from "@/lib/queries";
import { cn } from "@/components/ui";

const PRESETS = [
  { label: "Sensitive", value: 0.3, hint: "Catch more — accept some false alarms" },
  { label: "Balanced", value: 0.5, hint: "A sensible middle ground" },
  { label: "Strict", value: 0.75, hint: "Only the surest alerts" },
];

function level(t: number): string {
  if (t < 0.4) return "Sensitive";
  if (t <= 0.65) return "Balanced";
  return "Strict";
}

export function ThresholdControl() {
  const { threshold, setThreshold } = useControls();
  const sweep = useThresholdSweep(threshold);
  const live = sweep.data?.live;
  const caught = live ? Math.round(live.recall * 100) : null;
  const right = live ? Math.round(live.precision * 100) : null;

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Alerts</span>
        <span className="font-semibold text-indigo-600 dark:text-indigo-300">{level(threshold)}</span>
        <span className="text-xs text-slate-400">{threshold.toFixed(2)}</span>
        <span className="text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/40">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Alert sensitivity</div>
          <p className="mb-3 mt-0.5 text-xs text-slate-500">How sure the system must be before it raises an alert.</p>

          <div className="mb-3 grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setThreshold(p.value)}
                title={p.hint}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                  level(threshold) === p.label
                    ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>Catch more</span>
            <span className="font-semibold text-slate-500">{threshold.toFixed(2)}</span>
            <span>Fewer false alarms</span>
          </div>

          <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-white/5">
            <div className="mb-0.5 font-medium text-slate-500">At this setting, on past data:</div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Failures caught</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-300">{caught ?? "—"} / 100</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Alerts that are real</span>
              <span className="font-semibold text-sky-600 dark:text-sky-300">{right ?? "—"} / 100</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
