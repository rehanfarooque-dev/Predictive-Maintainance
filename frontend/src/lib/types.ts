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

export interface FleetItem {
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

export interface MachineDetail {
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
