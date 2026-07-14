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

/**
 * Maintenance urgency from the Risk-Score PdM cycle ONLY (never the 12h classifier).
 * Driven purely by cumulative hazard H(t): due when H ≥ 1, else by days-to-cycle.
 * This keeps the Service Planner internally consistent — H, time-left and urgency
 * always tell the same story.
 */
export function pdmUrgency(it: { pdm_due?: boolean; pdm_days_until_due?: number }): Urgency {
  const days = it.pdm_days_until_due ?? 999;
  if (it.pdm_due || days <= 0) return "overdue";
  if (days < 7) return "urgent";
  if (days < 30) return "soon";
  return "planned";
}

/** Plain "time until maintenance" label for the PdM cycle. */
export function pdmTimeLeft(it: { pdm_due?: boolean; pdm_days_until_due?: number }): string {
  const days = it.pdm_days_until_due ?? 0;
  if (it.pdm_due || days <= 0) return "Due now";
  if (days < 1) return "<1 day";
  return `~${Math.round(days)} days`;
}

/** Projected maintenance-due date from the PdM cycle: as_of + days-to-cycle. */
export function pdmServiceDate(asOf: string | undefined, daysUntil: number): string {
  const base = asOf ? new Date(asOf) : new Date();
  base.setTime(base.getTime() + Math.max(0, daysUntil) * 86_400_000);
  return fmtDate(base.toISOString());
}

/**
 * Risk score = cumulative hazard implied by the 12h classifier probability:
 *   H = −ln(1 − p)
 * This makes the Risk Score page consistent with the Classification page by construction:
 * H ≥ 1 exactly when p ≥ 1 − e⁻¹ ≈ 0.63 (≈ the default alert). So a machine that reads
 * "healthy 23%" in Classification reads H ≈ 0.27 (healthy) here — never a contradiction.
 */
export function clsHazard(p: number): number {
  const q = Math.min(Math.max(p, 0), 0.999);
  return -Math.log(1 - q);
}

/** Urgency straight from the classifier — mirrors Classification's healthy/watch/at-risk bands. */
export function clsUrgency(it: { at_risk?: boolean; classifier_risk?: number }): Urgency {
  const p = it.classifier_risk ?? 0;
  if (it.at_risk) return "overdue";   // flagged → Service now (same as Classification)
  if (p >= 0.30) return "urgent";
  if (p >= 0.10) return "soon";
  return "planned";
}

/** Kept as aliases so existing call sites stay consistent — both now classifier-driven. */
export const recurrenceUrgency = clsUrgency;
export function recurrenceTimeLeft(it: { at_risk?: boolean; classifier_risk?: number }): string {
  const u = clsUrgency(it);
  return u === "overdue" ? "Service now" : u === "urgent" ? "Watch" : u === "soon" ? "Elevated" : "Healthy";
}

export function fmtPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

// Adaptive probability formatter — never collapses a real, tiny probability to "0.0%".
export function fmtProb(x: number): string {
  const pct = x * 100;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  if (pct > 0) return "<0.01%";
  return "0%";
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
