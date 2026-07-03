import type { Urgency } from "./types";

// Vibrant, dark-theme-friendly status semantics. `color` is used for charts/heatmap,
// `badge` for pill chips, `dot` for status dots, `glow` for soft shadows.
export const URGENCY_META: Record<
  Urgency,
  { label: string; badge: string; dot: string; color: string; glow: string; rank: number }
> = {
  overdue: {
    label: "Service now",
    badge: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300",
    dot: "bg-rose-500 dark:bg-rose-400",
    color: "#f43f5e",
    glow: "rgba(244,63,94,0.45)",
    rank: 0,
  },
  urgent: {
    label: "Urgent",
    badge: "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300",
    dot: "bg-orange-500 dark:bg-orange-400",
    color: "#fb923c",
    glow: "rgba(251,146,60,0.4)",
    rank: 1,
  },
  soon: {
    label: "Soon",
    badge: "bg-amber-400/20 text-amber-700 border-amber-400/40 dark:text-amber-300",
    dot: "bg-amber-500 dark:bg-amber-400",
    color: "#fbbf24",
    glow: "rgba(251,191,36,0.35)",
    rank: 2,
  },
  planned: {
    label: "Planned",
    badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    color: "#34d399",
    glow: "rgba(52,211,153,0.3)",
    rank: 3,
  },
};

export function rulLabel(days: number, capped = false): string {
  if (capped || days >= 364) return "1 year+";
  if (days < 1) return "<1 day";
  return `~${Math.round(days)} days`;
}

export function fmtPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function riskScoreColor(score: number): string {
  if (score >= 50) return "#f43f5e";
  if (score >= 25) return "#fb923c";
  if (score >= 10) return "#fbbf24";
  return "#34d399";
}

export function statusFromRisk(atRisk: boolean): { label: string; badge: string } {
  return atRisk
    ? { label: "At risk", badge: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300" }
    : { label: "Healthy", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" };
}

// --- Plain-English labels (no technical jargon for non-technical users) ---

const SENSOR_LABEL: Record<string, string> = {
  volt: "Voltage",
  rotate: "Rotation",
  pressure: "Pressure",
  vibration: "Vibration",
};

const STAT_LABEL: Record<string, string> = {
  mean: "Avg",
  std: "Variation in",
  min: "Lowest",
  max: "Highest",
};

export function prettySensor(name: string): string {
  return SENSOR_LABEL[name] ?? name;
}

export function prettyModel(name: string): string {
  const m = /^model(\d+)$/.exec(name);
  return m ? `Type ${m[1]}` : name;
}

export function prettyComp(name: string): string {
  const m = /^comp(\d+)$/.exec(name);
  return m ? `Part ${m[1]}` : name;
}

/** Convert any raw model feature name into plain English. */
export function prettyFeature(name: string): string {
  let m = /^model_model(\d+)$/.exec(name);
  if (m) return `Machine type ${m[1]}`;

  m = /^hours_since_comp(\d+)$/.exec(name);
  if (m) return `Time since Part ${m[1]} service`;

  m = /^error(\d+)_count_(\d+)h$/.exec(name);
  if (m) return `Error ${m[1]} count (last ${m[2]}h)`;

  m = /^(volt|rotate|pressure|vibration)_(mean|std|min|max)_(\d+)h$/.exec(name);
  if (m) return `${STAT_LABEL[m[2]]} ${SENSOR_LABEL[m[1]].toLowerCase()} (last ${m[3]}h)`;

  if (name === "age") return "Machine age";
  if (SENSOR_LABEL[name]) return SENSOR_LABEL[name];
  return name;
}
