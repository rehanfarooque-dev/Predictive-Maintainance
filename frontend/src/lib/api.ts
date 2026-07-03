// Typed fetch wrapper around the FastAPI backend (proxied at /api in dev).
import type {
  ComponentRow,
  FleetResponse,
  Health,
  InferenceResult,
  MachineDetail,
  MetricsSummary,
  MonitorResponse,
  ThresholdSweep,
  TimestampsResponse,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>("/health"),
  timestamps: () => get<TimestampsResponse>("/fleet/timestamps"),
  fleet: (asOf: string | undefined, threshold: number, sortBy = "urgency") =>
    get<FleetResponse>(`/fleet${qs({ as_of: asOf, threshold, sort_by: sortBy })}`),
  monitor: (asOf: string | undefined) => get<MonitorResponse>(`/fleet/monitor${qs({ as_of: asOf })}`),
  machine: (id: number, asOf: string | undefined, threshold: number) =>
    get<MachineDetail>(`/machines/${id}${qs({ as_of: asOf, threshold })}`),
  metricsSummary: () => get<MetricsSummary>("/results/summary"),
  thresholdSweep: (threshold?: number) =>
    get<ThresholdSweep>(`/results/threshold-sweep${qs({ threshold })}`),
  components: (threshold = 0.5) =>
    get<{ items: ComponentRow[] }>(`/results/components${qs({ threshold })}`),
  features: () => get<{ selected_features: string[]; best_params: Record<string, number> }>("/results/features"),
  inferenceLookup: (machineId: number, asOf: string | undefined, threshold: number) =>
    get<InferenceResult>(`/inference/lookup${qs({ machine_id: machineId, as_of: asOf, threshold })}`),
  plotUrl: (name: string) => `${BASE}/results/plots/${name}`,
};
