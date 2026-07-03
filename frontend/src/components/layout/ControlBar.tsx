"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

import { useControls, useTheme, useSidebar } from "@/lib/store";
import { useTimestamps } from "@/lib/queries";
import { IconSun, IconMoon, IconChevronsRight } from "@/components/icons";
import { cn } from "@/components/ui";
import { ThresholdControl } from "@/components/layout/ThresholdControl";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_ABBR = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// ── helpers ──────────────────────────────────────────────────────────────────

function parseDate(iso: string): Date {
  // Avoid timezone shift by parsing at noon
  return new Date(`${iso}T12:00:00`);
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// ── CalendarPicker ────────────────────────────────────────────────────────────

function CalendarPicker({
  value,
  min,
  max,
  onChange,
}: {
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? parseDate(value) : null;
  const minDate  = min  ? parseDate(min)   : null;
  const maxDate  = max  ? parseDate(max)   : null;

  // Start calendar view at the selected (or max) date
  const initial = selected ?? maxDate ?? new Date();
  const [viewYear,  setViewYear]  = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth()); // 0-indexed

  // Sync view when value changes from outside (e.g. "Latest" button)
  useEffect(() => {
    const d = value ? parseDate(value) : maxDate;
    if (d) { setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Calendar grid ──────────────────────────────────────────────────────────

  // 0=Sun → shift to Monday-first (0=Mon)
  const firstDow  = new Date(viewYear, viewMonth, 1).getDay();
  const startPad  = (firstDow + 6) % 7;
  const daysTotal = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysTotal }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // ── Navigation guards ──────────────────────────────────────────────────────

  const prevMonthDate = new Date(viewYear, viewMonth - 1, 1);
  const nextMonthDate = new Date(viewYear, viewMonth + 1, 1);
  const canPrev = !minDate || prevMonthDate >= new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const canNext = !maxDate || nextMonthDate <= new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

  function prevMonth() {
    if (!canPrev) return;
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (!canNext) return;
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  // ── Day state helpers ──────────────────────────────────────────────────────

  function dayDate(d: number) { return new Date(viewYear, viewMonth, d); }

  function isDisabled(d: number) {
    const dt = dayDate(d);
    if (minDate) { const mn = new Date(minDate); mn.setHours(0,0,0,0); if (dt < mn) return true; }
    if (maxDate) { const mx = new Date(maxDate); mx.setHours(23,59,59,999); if (dt > mx) return true; }
    return false;
  }

  function isSelected(d: number) {
    return selected ? sameDay(dayDate(d), selected) : false;
  }

  function selectDay(d: number) {
    if (isDisabled(d)) return;
    onChange(isoOf(viewYear, viewMonth, d));
    setOpen(false);
  }

  // ── Trigger label ──────────────────────────────────────────────────────────

  const displayLabel = selected
    ? selected.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Pick date";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
          open
            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10",
        )}
      >
        <Calendar size={13} className="shrink-0 text-slate-400 dark:text-slate-500" strokeWidth={1.75} />
        <span className="font-medium tabular-nums">{displayLabel}</span>
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[280px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/40">

          {/* Month navigation header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
            <button
              onClick={prevMonth}
              disabled={!canPrev}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-lg transition-colors",
                canPrev
                  ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
                  : "cursor-not-allowed text-slate-200 dark:text-white/20",
              )}
            >
              <ChevronLeft size={15} strokeWidth={2} />
            </button>

            <span className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>

            <button
              onClick={nextMonth}
              disabled={!canNext}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-lg transition-colors",
                canNext
                  ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
                  : "cursor-not-allowed text-slate-200 dark:text-white/20",
              )}
            >
              <ChevronRight size={15} strokeWidth={2} />
            </button>
          </div>

          {/* Day-of-week header */}
          <div className="grid grid-cols-7 px-3 pt-3 pb-1">
            {DAY_ABBR.map((abbr) => (
              <div key={abbr} className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {abbr}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-4 pt-1">
            {cells.map((day, i) => (
              <div key={i} className="flex items-center justify-center py-[1px]">
                {day !== null && (
                  <button
                    onClick={() => selectDay(day)}
                    disabled={isDisabled(day)}
                    className={cn(
                      "h-8 w-8 rounded-xl text-[13px] font-medium transition-all duration-100",
                      isSelected(day)
                        ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/30"
                        : isDisabled(day)
                        ? "cursor-not-allowed text-slate-200 dark:text-white/15"
                        : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-200 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300",
                    )}
                  >
                    {day}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ControlBar ────────────────────────────────────────────────────────────────

export function ControlBar() {
  const { asOf, setAsOf } = useControls();
  const { theme, toggleTheme } = useTheme();
  const { collapsed, toggle: toggleSidebar } = useSidebar();
  const { data: ts } = useTimestamps();

  const minDate    = ts?.min?.slice(0, 10);
  const maxDate    = ts?.max?.slice(0, 10);
  const latestHour = ts?.max?.slice(11, 13) ?? "06";
  const curDate    = asOf ? asOf.slice(0, 10) : maxDate ?? "";
  const curHour    = asOf ? asOf.slice(11, 13) : latestHour;

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white/70 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/50">

      {/* Sidebar expand button — only visible when sidebar is collapsed */}
      {collapsed && (
        <button
          onClick={toggleSidebar}
          title="Expand sidebar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
        >
          <IconChevronsRight size={14} />
        </button>
      )}

      {/* ── Date + Hour controls ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
          title="Travel through fleet history. The backend snaps to the nearest hourly reading."
        >
          Point in time
        </label>

        {/* Pill: Latest button + calendar */}
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-white/10 dark:bg-white/5">
          <button
            onClick={() => setAsOf(undefined)}
            title="Jump to the most recent reading"
            className={cn(
              "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
              asOf
                ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100"
                : "bg-indigo-500 text-white shadow-sm",
            )}
          >
            Latest
          </button>

          <span className="h-4 w-px bg-slate-200 dark:bg-white/10" />

          <CalendarPicker
            value={curDate}
            min={minDate}
            max={maxDate}
            onChange={(v) => setAsOf(`${v}T${curHour}:00:00`)}
          />
        </div>

        {/* Hour slider */}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={23}
            step={1}
            value={Number(curHour)}
            title="Hour of day"
            onChange={(e) =>
              (curDate || maxDate) &&
              setAsOf(`${curDate || maxDate}T${String(Number(e.target.value)).padStart(2, "0")}:00:00`)
            }
            className="w-28 accent-indigo-500"
          />
          <span className="w-14 rounded-md bg-slate-100 px-1.5 py-0.5 text-center text-sm font-semibold text-indigo-600 dark:bg-white/5 dark:text-indigo-300">
            {curHour}:00
          </span>
        </div>
      </div>

      <ThresholdControl />

      {/* ── Right controls ──────────────────────────────────── */}
      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
          {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
      </div>
    </header>
  );
}
