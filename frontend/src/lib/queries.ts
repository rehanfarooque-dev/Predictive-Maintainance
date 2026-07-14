// React Query hooks. Keyed on as-of + threshold so the whole dashboard reacts to the controls.
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { useControls } from "./store";

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30000 });
}

export function useTimestamps() {
  return useQuery({ queryKey: ["timestamps"], queryFn: api.timestamps, staleTime: Infinity });
}

export function useFleet(sortBy = "urgency") {
  const { asOf, threshold } = useControls();
  return useQuery({
    queryKey: ["fleet", asOf, threshold, sortBy],
    queryFn: () => api.fleet(asOf, threshold, sortBy),
    placeholderData: (prev) => prev,
  });
}

export function useFleetMonitor() {
  const { asOf } = useControls();
  return useQuery({
    queryKey: ["monitor", asOf],
    queryFn: () => api.monitor(asOf),
    placeholderData: (prev) => prev,
  });
}

export function useMachine(id: number) {
  const { asOf, threshold } = useControls();
  return useQuery({
    queryKey: ["machine", id, asOf, threshold],
    queryFn: () => api.machine(id, asOf, threshold),
    enabled: Number.isFinite(id),
    placeholderData: (prev) => prev,
  });
}

export function useMetricsSummary() {
  return useQuery({ queryKey: ["metrics-summary"], queryFn: api.metricsSummary });
}

export function useThresholdSweep(threshold: number) {
  return useQuery({
    queryKey: ["threshold-sweep", threshold],
    queryFn: () => api.thresholdSweep(threshold),
    placeholderData: (prev) => prev,
  });
}

/** Full model-performance report. Keyed on the alert threshold so it auto-updates. */
export function useEvaluation() {
  const { threshold } = useControls();
  return useQuery({
    queryKey: ["evaluation", threshold],
    queryFn: () => api.evaluation(threshold),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

export function useComponents() {
  return useQuery({ queryKey: ["components"], queryFn: () => api.components() });
}

export function useModelReports() {
  const { asOf, threshold } = useControls();
  return useQuery({
    queryKey: ["model-reports", asOf, threshold],
    queryFn: () => api.modelReports(asOf, threshold),
    placeholderData: (prev) => prev,
  });
}

export function useFeatures() {
  return useQuery({ queryKey: ["features"], queryFn: api.features });
}
