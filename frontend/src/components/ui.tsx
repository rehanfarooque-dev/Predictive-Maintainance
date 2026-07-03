import type { ReactNode } from "react";

export function cn(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "indigo" | "rose" | "amber" | "emerald" | "sky" | "violet";

export const TONES: Record<Tone, [string, string]> = {
  indigo: ["#6366f1", "#8b5cf6"],
  rose: ["#fb7185", "#f43f5e"],
  amber: ["#fbbf24", "#f97316"],
  emerald: ["#34d399", "#10b981"],
  sky: ["#38bdf8", "#0ea5e9"],
  violet: ["#a78bfa", "#7c3aed"],
};

export function GlassCard({
  children,
  className,
  hover,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div className={cn("glass rounded-2xl shadow-lg shadow-slate-900/5 dark:shadow-black/30", hover && "glass-hover", className)}>
      {children}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <span className="grid h-4 w-4 cursor-help place-items-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-400 dark:border-white/25 dark:text-slate-500">
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-50 w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
        {text}
      </span>
    </span>
  );
}

export function SectionTitle({
  title,
  subtitle,
  right,
  info,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  info?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-slate-900 dark:text-slate-100">
          {title}
          {info && <InfoTip text={info} />}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "indigo",
  onClick,
  active = false,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
}) {
  const [c1, c2] = TONES[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "animate-in glass relative w-full overflow-hidden rounded-2xl p-5 text-left shadow-lg shadow-slate-900/5 transition-all duration-150 dark:shadow-black/30",
        onClick && "cursor-pointer hover:scale-[1.02] hover:shadow-xl active:scale-[0.99]",
        active && "ring-2 ring-offset-1",
      )}
    >
      {/* Active ring overlay */}
      {active && (
        <span className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `inset 0 0 0 2px ${c1}` }} />
      )}
      {icon && (
        <div
          className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl text-white shadow-lg"
          style={{ background: `linear-gradient(135deg, ${c1}, ${c2})`, boxShadow: `0 8px 24px ${c1}40` }}
        >
          {icon}
        </div>
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
      {onClick && (
        <p className={cn("mt-1 text-[11px] font-medium transition-opacity", active ? "text-slate-500 dark:text-slate-400 opacity-100" : "opacity-0 group-hover:opacity-60")}>
          {active ? "Filtered · click to clear" : "Click to filter →"}
        </p>
      )}
      {sub && !onClick && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: `linear-gradient(90deg, ${c1}, ${c2})`, opacity: active ? 1 : 0.7 }} />
    </Tag>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, from, to }: { value: number; from: string; to: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: `linear-gradient(90deg, ${from}, ${to})` }}
      />
    </div>
  );
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500 dark:border-white/20 dark:border-t-indigo-400" />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-10 text-slate-500 dark:text-slate-400">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBlock({ error }: { error: unknown }) {
  const e = error as { status?: number; body?: { detail?: { missing?: string[] } } };
  const missing = e?.body?.detail?.missing;
  if (e?.status === 503 && missing) {
    return (
      <GlassCard className="border-amber-500/30 p-6">
        <h3 className="font-semibold text-amber-700 dark:text-amber-300">Backend not ready</h3>
        <p className="mt-1 text-sm text-amber-700/80 dark:text-amber-200/80">Generate these artifacts, then refresh:</p>
        <ul className="mt-2 list-inside list-disc text-sm text-amber-700/80 dark:text-amber-200/80">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </GlassCard>
    );
  }
  return (
    <GlassCard className="border-rose-500/30 p-6 text-sm text-rose-600 dark:text-rose-200">
      Could not load data. Make sure the API is running (uvicorn api.main:app --port 8077).
    </GlassCard>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
