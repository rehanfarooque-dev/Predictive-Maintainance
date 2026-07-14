// TypeScript mirror of the FastAPI response shapes.

export type Urgency = "overdue" | "urgent" | "soon" | "planned";

export interface Health {
  status: string;
  ready: boolean;
  missing: string[];
  stale: boolean;
  horizon_hours: number;
  n_machines: number;
  study_end: string | null;
}

// Risk-score PdM (maintenance cycle from true failure gaps). Present on FleetItem + MachineDetail.
export interface PdmFields {
  pdm_hazard: number;        // H(t) = (age / cycle)^shape — the risk score
  pdm_cycle_days: number;    // characteristic life lambda (H = 1 here)
  pdm_shape: number;         // Weibull shape rho
  pdm_due: boolean;          // H >= 1 => maintenance due now
  pdm_days_until_due: number;
  pdm_pct_of_life: number;   // age / cycle (0..>1)
}

// Hybrid recurrence risk — Weibull fitted on classifier surrogate events (MachineDetail only).
export interface SurrogateFields {
  surrogate_hazard?: number;         // H(t) since the last classifier alarm
  surrogate_cycle_days?: number;     // typical days between alarm states
  surrogate_shape?: number;
  surrogate_days_since_alarm?: number | null;
  surrogate_days_until_due?: number; // days until H reaches 1.0
  surrogate_due?: boolean;
  surrogate_in_alarm?: boolean;      // classifier is flagging failure right now
  surrogate_precision?: number;      // validation: alarms followed by a real failure
  surrogate_recall?: number;         // validation: failures preceded by an alarm
}

export interface FleetItem extends PdmFields, SurrogateFields {
  machineID: number;
  model: string;
  classifier_risk: number;
  at_risk: boolean;
  risk_score: number;
  at_end_of_life: boolean;
  violation_count: number;
  current_comp: string;
  rul_days: number;
  rul_ci_low_days: number;
  rul_ci_high_days: number;
  is_capped: boolean;
  recommended_service_date: string;
  days_until_service: number;
  urgency: Urgency;
}

export interface FleetResponse {
  as_of: string;
  threshold: number;
  count: number;
  items: FleetItem[];
}

export interface TimestampsResponse {
  timestamps: string[];
  min: string;
  max: string;
  count: number;
}

export interface SensorBreakdown {
  sensor: string;
  value: number;
  lower: number;
  upper: number;
  p50: number;
  in_band: boolean;
  exceedance: number;
  normalized_exceedance: number;
}

export interface SurvivalPoint {
  days_ahead: number;
  survival_prob: number;
}

export interface ShapContribution {
  feature: string;
  value: number;
  shap_value: number;
}

export interface TimeseriesPoint {
  datetime: string;
  risk: number;
  risk_score: number;
  label: number;
  volt: number;
  rotate: number;
  pressure: number;
  vibration: number;
}

export interface MachineDetail extends PdmFields, SurrogateFields {
  machineID: number;
  model: string;
  age: number;
  as_of: string;
  classifier_risk: number;
  at_risk: boolean;
  risk_score: number;
  at_end_of_life: boolean;
  violation_count: number;
  violation_severity: number;
  current_comp: string;
  elapsed_days: number;
  rul_days: number;
  rul_ci_low_days: number;
  rul_ci_high_days: number;
  is_capped: boolean;
  recommended_service_date: string;
  days_until_service: number;
  urgency: Urgency;
  sensor_bands: Record<string, { lower: number; upper: number; p50: number }>;
  sensor_breakdown: SensorBreakdown[];
  timeseries: TimeseriesPoint[];
  survival_curve: SurvivalPoint[];
  km_baseline: SurvivalPoint[];
  top_features: ShapContribution[];
}

export interface MetricsSummary {
  auc_pr: number;
  auc_roc: number;
  n_features_final: number;
  horizon_hours: number;
  best_params: Record<string, number>;
}

export interface ThresholdRow {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ThresholdSweep {
  table: ThresholdRow[];
  live?: ThresholdRow;
}

export interface ComponentRow {
  component: string;
  precision: number;
  recall: number;
  f1: number;
  n_failures: number;
}

export interface MonitorItem {
  machineID: number;
  model: string;
  age: number;
  volt: number;
  rotate: number;
  pressure: number;
  vibration: number;
  vibration_24h: number[];
  errors_24h: number;
  overdue_comp: string;
  overdue_days: number;
  risk: number;
}

// Full model-performance report — recomputed live at the current alert threshold.
export interface ModelEvaluation {
  threshold: number;
  n_test_rows: number;
  n_positives: number;
  positive_rate: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  auc_pr: number;
  auc_roc: number;
  confusion: { tn: number; fp: number; fn: number; tp: number };
  threshold_table: ThresholdRow[];
  per_component: ComponentRow[];
  model: {
    algorithm: string;
    horizon_hours: number;
    n_features: number;
    selected_features: string[];
    best_params: Record<string, number>;
    test_size_pct: number;
  };
  plots: string[];
  built_at: string | null;
}

export interface ModelReports {
  as_of: string;
  n_machines: number;
  classification: {
    purpose: string;
    model: string;
    horizon_hours: number;
    n_features: number;
    auc_pr: number;
    auc_roc: number;
    precision: number;
    recall: number;
    f1: number;
    threshold: number;
    n_flagged_now: number;
    pct_flagged_now: number;
    per_component: ComponentRow[];
  };
  pdm: {
    purpose: string;
    model: string;
    rule: string;
    cycles: { component: string; cycle_days: number; shape: number; n_failures: number; n_lives: number }[];
    n_due_now: number;
    n_soon: number;
    pct_due_now: number;
  };
}

export interface MonitorResponse {
  as_of: string;
  count: number;
  items: MonitorItem[];
  model_bands: Record<string, Record<string, { lower: number; upper: number; p50: number }>>;
}

export interface InferenceResult {
  machineID: number;
  datetime: string;
  classifier_risk: number;
  prediction: string;
  risk_score: number;
  rul_days: number;
  recommended_service_date: string;
  urgency: Urgency;
  contributions: ShapContribution[];
}
