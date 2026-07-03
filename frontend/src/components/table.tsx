"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/components/ui";

export type SortDir = "asc" | "desc";

/** Sort state + a stable sorter that pulls a comparable value per row via `get`. */
export function useTableSort(defaultKey: string, defaultDir: SortDir = "asc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);

  const toggle = (k: string) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir("asc");
    }
  };

  function sortRows<T>(rows: T[], get: (row: T, key: string) => number | string): T[] {
    const sorted = [...rows].sort((a, b) => {
      const av = get(a, sortKey);
      const bv = get(b, sortKey);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    return dir === "asc" ? sorted : sorted.reverse();
  }

  return { sortKey, dir, toggle, sortRows };
}

/** Search box + filter slot + result count, used above any table. */
export function TableToolbar({
  search,
  onSearch,
  count,
  children,
  placeholder = "Search machine #…",
}: {
  search: string;
  onSearch: (v: string) => void;
  count: number;
  children?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={placeholder}
        className="w-44 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
      />
      {children}
      <span className="ml-auto text-xs font-medium text-slate-500">{count} shown</span>
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A clickable, sortable table header cell. */
export function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  className,
  title,
}: {
  label: string;
  sortKey: string;
  active: boolean;
  dir: SortDir;
  onSort: (k: string) => void;
  className?: string;
  title?: string;
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={title}
      className={cn("cursor-pointer select-none px-4 py-3 transition-colors hover:text-slate-700 dark:hover:text-slate-200", className)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {title && (
          <span className="text-[9px] text-slate-300 dark:text-white/20" aria-hidden>ⓘ</span>
        )}
        <span className={cn("text-[9px]", active ? "text-indigo-500 dark:text-indigo-300" : "text-slate-300 dark:text-white/25")}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}
