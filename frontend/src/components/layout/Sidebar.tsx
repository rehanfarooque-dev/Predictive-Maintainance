"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSidebar, useTheme } from "@/lib/store";
import { useHealth } from "@/lib/queries";
import { cn } from "@/components/ui";
import {
  IconActivity,
  IconTrendingDown,
  IconChevronsLeft,
  IconChevronsRight,
  IconMoon,
  IconSun,
} from "@/components/icons";

type NavItem = {
  href: string;
  label: string;
  sub: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  exact?: boolean;
};

type NavGroup = {
  heading?: string;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/classification", label: "Classification", sub: "12-hour failure forecast",  icon: IconActivity },
      { href: "/risk",           label: "Risk Score",     sub: "Maintenance cycle (PdM)",   icon: IconTrendingDown },
    ],
  },
];

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? `${item.label} — ${item.sub}` : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl transition-all duration-200",
        collapsed ? "justify-center p-[11px]" : "px-3 py-[9px]",
        active
          ? "bg-indigo-500/[0.11] text-indigo-700 dark:bg-indigo-400/[0.14] dark:text-indigo-200"
          : "text-slate-500 hover:bg-slate-100/90 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100",
      )}
    >
      {/* Left accent pill on active */}
      {active && !collapsed && (
        <span className="absolute inset-y-[7px] left-0 w-[3px] rounded-r-full bg-indigo-500 dark:bg-indigo-400" />
      )}

      {/* Icon */}
      <Icon
        size={16}
        className={cn(
          "shrink-0 transition-colors duration-200",
          active
            ? "text-indigo-500 dark:text-indigo-400"
            : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300",
        )}
      />

      {/* Label — hidden instantly when collapsed, fades in when expanding */}
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-[13px] font-[450] tracking-[0.005em] transition-[opacity,max-width] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[200px] opacity-100",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const { data: health } = useHealth();

  const apiReady = health?.ready ?? false;
  const nMachines = health?.n_machines ?? 0;

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200/80 bg-white/[0.85] backdrop-blur-2xl transition-[width] duration-300 ease-in-out dark:border-white/[0.07] dark:bg-slate-950/70",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      {/* ── Brand ─────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-slate-200/60 dark:border-white/[0.06]",
          collapsed ? "flex-col gap-3 px-[10px] py-4" : "justify-between px-4 py-[15px]",
        )}
      >
        {/* Logo + name row */}
        <div className={cn("flex items-center gap-3", collapsed && "flex-col gap-0")}>
          <div
            className="shrink-0"
            style={{ filter: "drop-shadow(0 4px 12px rgba(124,92,246,0.42))" }}
          >
            <svg viewBox="0 0 32 32" className="h-9 w-9" aria-label="Sentinel logo" role="img">
              <defs>
                <linearGradient id="sentinelGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="55%" stopColor="#7c5cf6" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              {/* shield — "guarding reliability" */}
              <path
                d="M16 3l11 3.5V14c0 7-5 11.6-11 14-6-2.4-11-7-11-14V6.5L16 3z"
                fill="url(#sentinelGrad)"
              />
              {/* glossy top highlight */}
              <path d="M16 3l11 3.5v1.9L16 5 5 8.4V6.5L16 3z" fill="#ffffff" fillOpacity="0.20" />
              {/* live pulse / heartbeat */}
              <path
                d="M8 16h3l1.6-4 2.6 8.2L18.5 14H24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <span
            className={cn(
              "overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-200",
              collapsed ? "max-w-0 opacity-0" : "max-w-[200px] opacity-100",
            )}
          >
            <span className="block text-[15px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
              Sentinel
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-indigo-500/80 dark:text-indigo-300/70">
              Predictive maintenance
            </span>
          </span>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "grid place-items-center rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.07] dark:hover:text-slate-300",
            collapsed ? "mt-1 h-8 w-8" : "h-7 w-7",
          )}
        >
          {collapsed
            ? <IconChevronsRight size={14} />
            : <IconChevronsLeft  size={14} />
          }
        </button>
      </div>

      {/* ── Navigation ────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-5">
          {GROUPS.map((group, gi) => (
            <div key={gi} className="flex flex-col gap-0.5">
              {/* Section heading */}
              {group.heading && (
                <div
                  className={cn(
                    "mb-1 overflow-hidden transition-[opacity,max-height] duration-200",
                    collapsed ? "max-h-0 opacity-0" : "max-h-6 opacity-100",
                  )}
                >
                  <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400/80 dark:text-slate-500/80">
                    {group.heading}
                  </span>
                </div>
              )}
              {/* Divider when collapsed */}
              {group.heading && collapsed && (
                <div className="mx-2 mb-1 h-px bg-slate-100 dark:bg-white/[0.05]" />
              )}

              {group.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </div>
      </nav>

      {/* ── Bottom ────────────────────────────────────────────── */}
      <div
        className={cn(
          "shrink-0 border-t border-slate-200/60 dark:border-white/[0.06]",
          collapsed ? "flex flex-col items-center gap-2.5 px-2 py-3" : "space-y-1 px-2 py-3",
        )}
      >
        {/* API status card (expanded) / dot (collapsed) */}
        {collapsed ? (
          <div
            title={apiReady ? `${nMachines} machines live` : "API not ready"}
            className="flex h-9 w-9 items-center justify-center"
          >
            <span
              className={cn("h-2.5 w-2.5 rounded-full", apiReady ? "bg-emerald-400" : "bg-amber-400")}
              style={{ boxShadow: apiReady ? "0 0 7px #34d399" : "0 0 7px #fbbf24" }}
            />
          </div>
        ) : (
          <div className="mx-1 flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", apiReady ? "bg-emerald-400" : "bg-amber-400")}
              style={{ boxShadow: apiReady ? "0 0 6px #34d399" : "0 0 6px #fbbf24" }}
            />
            <span className="text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">
              {apiReady ? (
                <>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{nMachines}</span>{" "}
                  machines live
                </>
              ) : (
                "API not ready"
              )}
            </span>
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className={cn(
            "flex items-center gap-3 rounded-xl text-[13px] font-[450] text-slate-500 transition-all hover:bg-slate-100/90 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-slate-200",
            collapsed ? "h-9 w-9 justify-center" : "w-full px-3 py-2.5",
          )}
        >
          {theme === "dark"
            ? <IconSun  size={16} className="shrink-0" />
            : <IconMoon size={16} className="shrink-0" />
          }
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-200",
              collapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100",
            )}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </span>
        </button>
      </div>
    </aside>
  );
}
