"""ArtifactStore: load every model/artifact ONCE and serve the per-request logic.

Reuses the `src/pdm` pipeline (no recompute of the feature matrix per request) and the
`app/artifacts.py` loaders. Built once at FastAPI startup; routers call its methods.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

import joblib
import numpy as np
import pandas as pd
import shap

from app import artifacts
from src.pdm.config import load_config
from src.pdm.data_loader import build_base_dataframe, load_raw_data
from src.pdm.features import build_feature_matrix
from src.pdm.model import load_model
from src.pdm.risk import bands_from_dict, compute_risk_score, sensor_violations
from src.pdm.scoring import SENSOR_COLS, align_to_model_features, chronological_test_split
from src.pdm.survival import (
    COVARIATE_FEATURE_COLS,
    align_covariates,
    cumulative_hazard,
    predict_rul,
    rul_to_service_date,
    survival_curve_points,
)
from src.pdm.maintenance import comp_weibull_from_dict, maintenance_decision
from src.pdm.surrogate import surrogate_from_dict, build_surrogate_events, days_since_last_event
from src.pdm.evaluate import compute_threshold_table, compute_per_component_metrics

COMP_COLS = ["comp1", "comp2", "comp3", "comp4"]
URGENCY_RANK = {"overdue": 0, "urgent": 1, "soon": 2, "planned": 3}

BANDS_PATH = artifacts.MODELS_DIR / "bands.json"
SURVIVAL_PATH = artifacts.MODELS_DIR / "survival.joblib"
RUL_PATH = artifacts.OUTPUTS_DIR / "rul.parquet"
RUL_META_PATH = artifacts.OUTPUTS_DIR / "rul_meta.json"


def _ts(value) -> str:
    return pd.Timestamp(value).isoformat()


class ArtifactStore:
    def __init__(self) -> None:
        self.ready = False
        self.cfg = load_config(str(artifacts.CONFIG_PATH))

    # ---- startup ----
    def load(self) -> "ArtifactStore":
        required = [artifacts.MODEL_PATH, artifacts.SCORED_PATH, BANDS_PATH, SURVIVAL_PATH, RUL_PATH]
        if not all(Path(p).exists() for p in required):
            self.ready = False
            return self

        self.model = load_model(str(artifacts.MODEL_PATH))
        self.selected_features = artifacts.load_selected_features()
        self.scored = artifacts.load_scored()
        self.features_selected = artifacts.load_features_selected()
        self.bands = bands_from_dict(json.loads(BANDS_PATH.read_text()))
        bundle = joblib.load(SURVIVAL_PATH)
        self.aft = bundle["aft"]
        self.km = bundle["km"]
        self.covariate_cols = bundle["covariate_cols"]
        # Risk-score PdM: per-component Weibull (shape, scale) from true failure gaps.
        self.comp_weibull = comp_weibull_from_dict(bundle.get("comp_weibull", {}))
        # Hybrid: surrogate-event Weibull (classifier alarm recurrence) + its validation.
        self.surrogate = (
            surrogate_from_dict(bundle["surrogate_weibull"])
            if bundle.get("surrogate_weibull") else None
        )
        self.surrogate_validation = bundle.get("surrogate_validation", {})
        self.rul_df = pd.read_parquet(RUL_PATH)
        self.rul_meta = json.loads(RUL_META_PATH.read_text()) if RUL_META_PATH.exists() else {}
        self.reports = artifacts.load_reports() if not artifacts.check_artifacts().missing_reports else {}

        # Full feature matrix (subset of columns) for survival covariates at any as-of.
        self.raw = load_raw_data(self.cfg.data["raw_dir"])
        feat = build_feature_matrix(
            build_base_dataframe(self.raw), self.raw["errors"], self.raw["maint"],
            self.cfg.features.window_hours,
        )
        self.model_cols = [c for c in feat.columns if c.startswith("model_")]
        keep = ["machineID", "datetime"] + SENSOR_COLS + COVARIATE_FEATURE_COLS \
            + self.model_cols + [f"hours_since_{c}" for c in COMP_COLS]
        keep = [c for c in dict.fromkeys(keep) if c in feat.columns]
        self.feat = feat[keep].sort_values("datetime").reset_index(drop=True)

        self.explainer = shap.TreeExplainer(self.model)
        self.timestamps = np.sort(self.scored["datetime"].unique())
        self.machines_meta = json.loads(
            self.raw["machines"][["machineID", "model", "age"]]
            .sort_values("machineID").to_json(orient="records")
        )
        self._rul_by_machine = self.rul_df.set_index("machineID")
        self.machine_ids = sorted(int(m) for m in self.scored["machineID"].unique())
        self.age_by_machine = {int(m["machineID"]): int(m["age"]) for m in self.machines_meta}
        self.scored_by_machine = {int(mid): g.sort_values("datetime") for mid, g in self.scored.groupby("machineID")}
        self.feat_by_machine = {int(mid): g for mid, g in self.feat.groupby("machineID")}
        # Precompute debounced surrogate events per machine (at the model's fitted threshold).
        self.surrogate_events = (
            build_surrogate_events(self.scored, self.surrogate.threshold, self.surrogate.cooldown_hours)
            if self.surrogate else {}
        )
        self.ready = True
        return self

    # ---- helpers ----
    def status(self) -> dict:
        st = artifacts.check_artifacts()
        missing = []
        if not st.model_exists:
            missing.append("model.joblib (run train.py)")
        if st.missing_reports:
            missing.append("reports (run train.py)")
        if not st.scored_exists:
            missing.append("scored.parquet (run score_dataset.py)")
        if not Path(RUL_PATH).exists() or not Path(SURVIVAL_PATH).exists():
            missing.append("rul.parquet / survival.joblib (run build_rul.py)")
        return {
            "status": "ok",
            "ready": self.ready,
            "missing": missing,
            "stale": st.stale,
            "horizon_hours": self.cfg.labeling.horizon_hours,
            "n_machines": int(self.scored["machineID"].nunique()) if self.ready else 0,
            "study_end": self.rul_meta.get("study_end"),
        }

    def resolve_as_of(self, as_of: Optional[str]) -> pd.Timestamp:
        if as_of is None:
            return pd.Timestamp(self.timestamps[-1])
        target = np.datetime64(pd.Timestamp(as_of))
        # side='right' - 1 gives the last available timestamp <= target (true "as-of" semantics).
        # side='left' (old) would snap forward to >= target, potentially jumping hours ahead.
        idx = int(np.searchsorted(self.timestamps, target, side="right")) - 1
        idx = min(max(idx, 0), len(self.timestamps) - 1)
        return pd.Timestamp(self.timestamps[idx])

    def list_timestamps(self) -> dict:
        ts = [pd.Timestamp(t) for t in self.timestamps]
        return {"timestamps": [t.isoformat() for t in ts],
                "min": ts[0].isoformat(), "max": ts[-1].isoformat(), "count": len(ts)}

    def fleet_monitor(self, as_of) -> dict:
        """Per-machine live snapshot at `as_of`: sensors, 24h vibration waveform,
        recent errors, most-overdue part, and 12h failure chance — for every machine."""
        ts = self.resolve_as_of(as_of)
        snap = self.scored[self.scored["datetime"] == ts].set_index("machineID")
        items = []
        for mid in self.machine_ids:
            if mid not in snap.index:
                continue
            srow = snap.loc[mid]
            sm = self.scored_by_machine[mid]
            recent = sm[sm["datetime"] <= ts].tail(24)
            vib24 = [round(float(v), 1) for v in recent["vibration"].to_numpy()]

            fm = self.feat_by_machine[mid]
            fsub = fm[fm["datetime"] <= ts]
            frow = (fsub if len(fsub) else fm).iloc[-1]
            errors_24h = int(sum(float(frow.get(f"error{i}_count_24h", 0.0)) for i in range(1, 6)))
            hours_since = {c: float(frow.get(f"hours_since_{c}", 8760.0)) for c in COMP_COLS}
            overdue_comp = max(hours_since, key=hours_since.get)

            items.append({
                "machineID": int(mid),
                "model": str(srow["model"]),
                "age": int(self.age_by_machine.get(mid, 0)),
                "volt": round(float(srow["volt"]), 1),
                "rotate": round(float(srow["rotate"]), 1),
                "pressure": round(float(srow["pressure"]), 1),
                "vibration": round(float(srow["vibration"]), 1),
                "vibration_24h": vib24,
                "errors_24h": errors_24h,
                "overdue_comp": overdue_comp,
                "overdue_days": int(round(hours_since[overdue_comp] / 24.0)),
                "risk": round(float(srow["risk"]), 4),
            })
        # Per-model sensor bands so the frontend can highlight out-of-range readings
        model_bands: dict = {}
        for model_name, bands in self.bands.items():
            model_bands[model_name] = {
                s: {"lower": round(b.lower, 2), "upper": round(b.upper, 2), "p50": round(b.p50, 2)}
                for s, b in bands.items()
            }
        return {"as_of": ts.isoformat(), "count": len(items), "items": items, "model_bands": model_bands}

    def _feat_row(self, machine_id: int, as_of: pd.Timestamp) -> pd.Series:
        g = self.feat[self.feat["machineID"] == machine_id]
        sub = g[g["datetime"] <= as_of]
        return (sub if len(sub) else g).iloc[-1]

    def _covariates(self, feat_row: pd.Series, current_comp: str) -> pd.DataFrame:
        cov = {c: float(feat_row.get(c, 0.0)) for c in COVARIATE_FEATURE_COLS}
        for mc in self.model_cols:
            cov[mc] = float(feat_row.get(mc, 0.0))
        cov[f"comp_{current_comp}"] = 1.0
        return align_covariates(cov, self.covariate_cols)

    def _machine_rul(self, feat_row: pd.Series, ts, classifier_prob: float = 0.0,
                     threshold: float = 1.0):
        """Remaining-useful-life + recommended service, computed AS OF `ts`
        (uses the machine's condition at that moment, so it changes over time).

        The service date fuses the slow wear-out (survival model) with the acute 12h
        failure signal (`classifier_prob`/`threshold`), so a machine the classifier flags
        is surfaced as "service now" even when its wear-out life is long."""
        hours_since = {c: float(feat_row.get(f"hours_since_{c}", 8760.0)) for c in COMP_COLS}
        current_comp = max(hours_since, key=hours_since.get)
        elapsed_days = hours_since[current_comp] / 24.0
        X = self._covariates(feat_row, current_comp)
        rul = predict_rul(self.aft, X, elapsed_days)
        hazard = cumulative_hazard(self.aft, X, elapsed_days)
        horizon_days = float(self.cfg.labeling.horizon_hours) / 24.0
        sched = rul_to_service_date(
            ts, rul.rul_days, rul.rul_ci_low_days,
            classifier_prob=classifier_prob, threshold=threshold, horizon_days=horizon_days,
        )
        return current_comp, elapsed_days, rul, sched, hazard

    def _surrogate(self, machine_id: int, ts: pd.Timestamp,
                   prob: float = 0.0, threshold: float = 0.5) -> dict:
        """Recurrence-risk decision.

        Clock resets at the last classifier-predicted failure before `ts`;
        H(t) = (days since that alarm / recurrence cycle)^shape estimates when the NEXT
        pre-failure state is due. BUT if the machine is in a predicted-failure state RIGHT
        NOW (classifier prob >= threshold), it needs service now regardless of recurrence —
        being in an alarm IS the trigger. So: due = in_alarm OR H >= 1."""
        if self.surrogate is None:
            return {}
        in_alarm = float(prob) >= float(threshold)
        since = days_since_last_event(self.surrogate_events.get(machine_id, []), ts)
        finite = bool(np.isfinite(since))
        h = round(self.surrogate.hazard(since), 3) if finite else 0.0
        if in_alarm:
            # Currently in a predicted-failure state → maximal risk, service now.
            h_disp, days_until, due = max(h, 1.0), 0.0, True
        else:
            h_disp = h
            days_until = round(max(0.0, self.surrogate.scale - since), 1) if finite else round(self.surrogate.scale, 1)
            due = bool(h >= 1.0)
        return {
            "surrogate_hazard": round(h_disp, 3),
            "surrogate_cycle_days": round(self.surrogate.scale, 1),
            "surrogate_shape": round(self.surrogate.shape, 3),
            "surrogate_days_since_alarm": round(since, 1) if finite else None,
            "surrogate_days_until_due": days_until,
            "surrogate_due": due,
            "surrogate_in_alarm": in_alarm,
            "surrogate_precision": self.surrogate_validation.get("precision"),
            "surrogate_recall": self.surrogate_validation.get("recall"),
        }

    def explain(self, x_row: pd.DataFrame, top_k: int = 12) -> List[dict]:
        sv = np.asarray(self.explainer.shap_values(x_row.astype(float)))
        if sv.ndim == 2:
            sv = sv[0]
        s = pd.Series(sv, index=x_row.columns)
        order = s.abs().sort_values(ascending=False).index[:top_k]
        return [{"feature": f, "value": round(float(x_row.iloc[0][f]), 4),
                 "shap_value": round(float(s[f]), 4)} for f in order]

    # ---- endpoints ----
    def fleet(self, as_of, threshold, sort_by="urgency", order="asc",
              model: Optional[str] = None, limit: Optional[int] = None) -> dict:
        ts = self.resolve_as_of(as_of)
        snap = self.scored[self.scored["datetime"] == ts]
        items = []
        for _, r in snap.iterrows():
            mid = int(r["machineID"])
            prob = float(r["risk"])
            model_name = str(r["model"])
            fm = self.feat_by_machine[mid]
            fsub = fm[fm["datetime"] <= ts]
            frow = (fsub if len(fsub) else fm).iloc[-1]
            current_comp, elapsed_days, rul, sched, _hazard = self._machine_rul(frow, ts, prob, threshold)
            # Risk-score PdM: failure-gap Weibull maintenance decision for the oldest comp.
            md = maintenance_decision(self.comp_weibull[current_comp], elapsed_days)
            viol = sensor_violations({s: float(r[s]) for s in SENSOR_COLS}, self.bands[model_name])
            _rs = compute_risk_score(md.hazard, viol)
            items.append({
                "machineID": mid, "model": model_name,
                "classifier_risk": round(prob, 4), "at_risk": bool(prob >= threshold),
                "risk_score": md.hazard,
                "at_end_of_life": md.due, "violation_count": _rs.violation_count,
                "current_comp": current_comp,
                "rul_days": rul.rul_days,
                "rul_ci_low_days": rul.rul_ci_low_days,
                "rul_ci_high_days": rul.rul_ci_high_days,
                "is_capped": rul.is_capped,
                "recommended_service_date": _ts(sched["recommended_service_date"]),
                "days_until_service": sched["days_until_service"],
                "urgency": sched["urgency"],
                "pdm_hazard": md.hazard, "pdm_cycle_days": md.cycle_days,
                "pdm_shape": md.shape, "pdm_due": md.due,
                "pdm_days_until_due": md.days_until_due, "pdm_pct_of_life": md.pct_of_life,
                **self._surrogate(mid, ts, prob, threshold),
            })
        if model:
            items = [i for i in items if i["model"] == model]

        reverse = order == "desc"
        if sort_by == "urgency":
            items.sort(key=lambda i: (URGENCY_RANK.get(i["urgency"], 9), i["days_until_service"]))
        else:
            items.sort(key=lambda i: i.get(sort_by, 0), reverse=reverse)
        if limit:
            items = items[:limit]
        return {"as_of": ts.isoformat(), "threshold": threshold, "count": len(items), "items": items}

    def machine_detail(self, machine_id: int, as_of, threshold) -> Optional[dict]:
        if machine_id not in self._rul_by_machine.index:
            return None
        ts = self.resolve_as_of(as_of)
        # Full history for this machine (past AND future relative to as_of) so the
        # "risk over time" chart can show the entire timeline; the as_of marker line on
        # the frontend indicates the selected point. The current-state decision below is
        # still computed strictly at `ts`.
        mdf = self.scored[self.scored["machineID"] == machine_id].sort_values("datetime")
        meta = next((m for m in self.machines_meta if int(m["machineID"]) == machine_id), {})

        cur = mdf[mdf["datetime"] == ts]
        cur = cur.iloc[0] if len(cur) else mdf[mdf["datetime"] <= ts].iloc[-1]
        prob = float(cur["risk"])
        model_name = str(cur["model"])

        feat_row = self._feat_row(machine_id, ts)
        hours_since = {c: float(feat_row.get(f"hours_since_{c}", 8760.0)) for c in COMP_COLS}
        current_comp = max(hours_since, key=hours_since.get)
        elapsed_days = hours_since[current_comp] / 24.0
        X = self._covariates(feat_row, current_comp)
        rul = predict_rul(self.aft, X, elapsed_days)
        horizon_days = float(self.cfg.labeling.horizon_hours) / 24.0
        sched = rul_to_service_date(
            ts, rul.rul_days, rul.rul_ci_low_days,
            classifier_prob=prob, threshold=threshold, horizon_days=horizon_days,
        )

        # --- Risk-score PdM decision (the maintenance-cycle model) ---
        # H(t) = (age / characteristic-life)^shape from the component's failure-gap Weibull.
        # H >= 1 (age >= characteristic life) => the part has reached its typical lifetime
        # and should go for maintenance. Age resets on replacement, so H resets to 0.
        md = maintenance_decision(self.comp_weibull[current_comp], elapsed_days)
        hazard = md.hazard

        # Hybrid recurrence risk: the maintenance clock resets at the last classifier-
        # predicted failure (surrogate event) before as_of.
        sur = self._surrogate(machine_id, ts, prob, threshold)

        viol = sensor_violations({s: float(cur[s]) for s in SENSOR_COLS}, self.bands[model_name])
        rs = compute_risk_score(hazard, viol)

        # Downsample to ~1000 points, but always pin the as-of row and the last row so the
        # selected timestamp and the end of the timeline are exactly represented.
        stride = max(1, len(mdf) // 1000)
        sampled = mdf.iloc[::stride]
        pins = pd.concat([mdf[mdf["datetime"] == ts], mdf.iloc[[-1]]])
        sampled = pd.concat([sampled, pins])
        sub = (
            sampled.drop_duplicates(subset="datetime")
            .sort_values("datetime")
            .reset_index(drop=True)
        )

        # --- Risk-score PdM per timeseries row: H(t) = (age / lambda_comp) ** rho_comp ---
        # For each historical row we take the OLDEST component's age at that moment and its
        # component-specific failure-gap Weibull (shape, scale). This gives the true sawtooth:
        # H climbs from 0 as a part ages and drops back to 0 the moment it is replaced
        # (age -> 0), so maintenance automatically resets the risk score.
        fm_m = self.feat_by_machine[machine_id]
        hcols = [f"hours_since_{c}" for c in COMP_COLS]

        sub_dt = sub[["datetime"]].copy()
        sub_dt["datetime"] = sub_dt["datetime"].astype("datetime64[ns]")
        merge_right = fm_m[["datetime"] + hcols].sort_values("datetime").copy()
        merge_right["datetime"] = merge_right["datetime"].astype("datetime64[ns]")
        feat_ts = pd.merge_asof(
            sub_dt, merge_right, on="datetime", direction="backward",
        ).reset_index(drop=True)

        # Elapsed days + which component is oldest at each row
        el_arr = feat_ts[hcols].fillna(8760.0).max(axis=1).values / 24.0
        max_comp_idx = feat_ts[hcols].fillna(8760.0).values.argmax(axis=1)

        # Per-row shape/scale from the oldest component's fitted failure-gap Weibull
        shape_arr = np.array([self.comp_weibull[COMP_COLS[ci]].shape for ci in max_comp_idx])
        scale_arr = np.array([self.comp_weibull[COMP_COLS[ci]].scale for ci in max_comp_idx])
        ts_rs = np.where(el_arr <= 0.0, 0.0, (el_arr / scale_arr) ** shape_arr)
        ts_rs = np.round(np.clip(ts_rs, 0.0, None), 3)

        timeseries = [
            {
                "datetime": _ts(row["datetime"]), "risk": round(float(row["risk"]), 4),
                "risk_score": float(ts_rs[i]),
                "label": int(row["label"]),
                "volt": round(float(row["volt"]), 2), "rotate": round(float(row["rotate"]), 2),
                "pressure": round(float(row["pressure"]), 2), "vibration": round(float(row["vibration"]), 2),
            }
            for i, (_, row) in enumerate(sub.iterrows())
        ]

        bands = {s: {"lower": round(b.lower, 2), "upper": round(b.upper, 2), "p50": round(b.p50, 2)}
                 for s, b in self.bands[model_name].items()}

        fsel = self.features_selected
        frow = fsel[(fsel["machineID"] == machine_id) & (fsel["datetime"] == ts)]
        if not len(frow):
            frow = fsel[fsel["machineID"] == machine_id].tail(1)
        top_features = self.explain(frow[self.selected_features]) if len(frow) else []

        return {
            "machineID": machine_id, "model": model_name, "age": int(meta.get("age", 0)),
            "as_of": ts.isoformat(),
            "classifier_risk": round(prob, 4), "at_risk": bool(prob >= threshold),
            "risk_score": md.hazard, "violation_count": rs.violation_count,
            "violation_severity": rs.violation_severity,
            "at_end_of_life": md.due,
            # --- Risk-score PdM (maintenance cycle from true failure gaps) ---
            "pdm_hazard": md.hazard, "pdm_cycle_days": md.cycle_days,
            "pdm_shape": md.shape, "pdm_due": md.due,
            "pdm_days_until_due": md.days_until_due, "pdm_pct_of_life": md.pct_of_life,
            **sur,
            "current_comp": current_comp, "elapsed_days": round(elapsed_days, 1),
            "rul_days": rul.rul_days, "rul_ci_low_days": rul.rul_ci_low_days,
            "rul_ci_high_days": rul.rul_ci_high_days, "is_capped": rul.is_capped,
            "recommended_service_date": _ts(sched["recommended_service_date"]),
            "days_until_service": sched["days_until_service"], "urgency": sched["urgency"],
            "sensor_bands": bands,
            "sensor_breakdown": json.loads(viol.round(3).to_json(orient="records")),
            "timeseries": timeseries,
            "survival_curve": survival_curve_points(self.aft, X, elapsed_days),
            "km_baseline": self._km_points(current_comp),
            "top_features": top_features,
        }

    def _km_points(self, comp: str, horizon: float = 180.0, n: int = 60) -> List[dict]:
        kmf = self.km.get(str(comp)) or next(iter(self.km.values()))
        sf = kmf.survival_function_
        days = sf.index.to_numpy()
        probs = sf.iloc[:, 0].to_numpy()
        grid = np.linspace(0, horizon, n)
        interp = np.interp(grid, days, probs, left=1.0, right=float(probs[-1]))
        return [{"days_ahead": round(float(d), 1), "survival_prob": round(float(p), 4)}
                for d, p in zip(grid, interp)]

    # ---- results / metrics ----
    def results_summary(self) -> dict:
        s = self.reports.get("summary", {})
        return {"auc_pr": s.get("auc_pr"), "auc_roc": s.get("auc_roc"),
                "n_features_final": s.get("n_features_final"),
                "horizon_hours": s.get("horizon_hours"), "best_params": s.get("best_params", {})}

    def threshold_sweep(self, threshold: Optional[float] = None) -> dict:
        table = self.reports.get("threshold_table")
        out = {"table": json.loads(table.to_json(orient="records")) if table is not None else []}
        if threshold is not None:
            y_true, y_prob = chronological_test_split(self.scored, self.cfg.evaluation.test_size_pct)
            row = compute_threshold_table(pd.Series(y_true), y_prob, np.array([threshold])).iloc[0]
            out["live"] = {"threshold": float(threshold), "precision": round(float(row["precision"]), 4),
                           "recall": round(float(row["recall"]), 4), "f1": round(float(row["f1"]), 4)}
        return out

    def components(self, threshold: float = 0.5) -> dict:
        cm = self.reports.get("component_metrics")
        return {"items": json.loads(cm.to_json(orient="records")) if cm is not None else []}

    def features(self) -> dict:
        return {"selected_features": self.selected_features,
                "best_params": self.reports.get("best_params", {})}

    def evaluation(self, threshold: float = 0.5) -> dict:
        """Full model-performance report, recomputed live from scored.parquet.

        Everything is derived from the SAME chronological held-out test split used in
        training, so the numbers stay correct after any retrain (no stale constants).
        Threshold-dependent metrics (accuracy/precision/recall/F1, confusion matrix)
        follow the caller's threshold; AUC-PR / AUC-ROC are threshold-free.
        """
        from sklearn.metrics import (
            accuracy_score, average_precision_score, confusion_matrix,
            f1_score, precision_score, recall_score, roc_auc_score,
        )

        y_true, y_prob = chronological_test_split(self.scored, self.cfg.evaluation.test_size_pct)
        y_pred = (y_prob >= float(threshold)).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()

        summary = self.results_summary()
        sweep = self.threshold_sweep(threshold)
        n_pos = int(np.asarray(y_true).sum())
        n_test = int(len(y_true))

        return {
            "threshold": float(threshold),
            "n_test_rows": n_test,
            "n_positives": n_pos,
            "positive_rate": round(n_pos / max(n_test, 1), 5),
            # --- headline metrics ---
            "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
            "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
            "auc_pr": round(float(average_precision_score(y_true, y_prob)), 4),
            "auc_roc": round(float(roc_auc_score(y_true, y_prob)), 4),
            # --- confusion matrix ---
            "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            # --- supporting views ---
            "threshold_table": sweep.get("table", []),
            "per_component": self.components(threshold).get("items", []),
            "model": {
                "algorithm": "XGBoost (gradient-boosted trees)",
                "horizon_hours": summary.get("horizon_hours"),
                "n_features": summary.get("n_features_final"),
                "selected_features": self.selected_features,
                "best_params": summary.get("best_params", {}),
                "test_size_pct": float(self.cfg.evaluation.test_size_pct),
            },
            "plots": [n for n in ("pr_curve", "roc_curve", "shap_summary", "optuna_history")
                      if self.plot_path(n) is not None],
            "built_at": self.rul_meta.get("built_at"),
        }

    def model_reports(self, as_of, threshold: float = 0.5) -> dict:
        """Plain-language summary of BOTH models for the reports page."""
        summary = self.results_summary()
        live = self.threshold_sweep(threshold).get("live", {})
        comp_metrics = self.components(threshold).get("items", [])

        # Fleet snapshot at as_of: how many machines each model is flagging right now.
        fleet = self.fleet(as_of, threshold).get("items", [])
        n = len(fleet) or 1
        n_flagged = sum(1 for m in fleet if m["at_risk"])
        n_due = sum(1 for m in fleet if m.get("pdm_due"))
        n_soon = sum(1 for m in fleet if not m.get("pdm_due") and m.get("pdm_days_until_due", 999) < 21)

        # Failure counts per component (true failures) to size the maintenance cycles.
        fail_counts = self.raw["failures"]["failure"].value_counts().to_dict()

        cycles = []
        for c in COMP_COLS:
            cw = self.comp_weibull.get(c)
            if cw is None:
                continue
            cycles.append({
                "component": c,
                "cycle_days": round(cw.scale, 1),
                "shape": round(cw.shape, 3),
                "n_failures": int(fail_counts.get(c, 0)),
                "n_lives": cw.n_lives,
            })

        return {
            "as_of": self.resolve_as_of(as_of).isoformat(),
            "n_machines": len(fleet),
            "classification": {
                "purpose": "Predicts whether a machine will fail within the next "
                           f"{summary.get('horizon_hours', 12)} hours, from live sensor patterns.",
                "model": "XGBoost gradient-boosted trees",
                "horizon_hours": summary.get("horizon_hours"),
                "n_features": summary.get("n_features_final"),
                "auc_pr": summary.get("auc_pr"),
                "auc_roc": summary.get("auc_roc"),
                "precision": live.get("precision"),
                "recall": live.get("recall"),
                "f1": live.get("f1"),
                "threshold": threshold,
                "n_flagged_now": n_flagged,
                "pct_flagged_now": round(100.0 * n_flagged / n, 1),
                "per_component": comp_metrics,
            },
            "pdm": {
                "purpose": "Tells you when each machine is due for maintenance, based on how long "
                           "its oldest part has run versus that part's typical lifespan.",
                "model": "Weibull reliability model fitted on real failure-to-failure gaps",
                "rule": "Maintenance is due when cumulative hazard H(t) reaches 1.0 "
                        "(the part has reached its characteristic life).",
                "cycles": cycles,
                "n_due_now": n_due,
                "n_soon": n_soon,
                "pct_due_now": round(100.0 * n_due / n, 1),
            },
        }

    def plot_path(self, name: str) -> Optional[Path]:
        return self.reports.get("plots", {}).get(f"{name}.png")

    # ---- inference ----
    def inference_lookup(self, machine_id: int, as_of, threshold) -> Optional[dict]:
        ts = self.resolve_as_of(as_of)
        row = self.scored[(self.scored["machineID"] == machine_id) & (self.scored["datetime"] == ts)]
        if not len(row):
            return None
        detail = self.machine_detail(machine_id, as_of, threshold)
        return {
            "machineID": machine_id, "datetime": ts.isoformat(),
            "classifier_risk": detail["classifier_risk"],
            "prediction": "WILL FAIL" if detail["at_risk"] else "healthy",
            "risk_score": detail["risk_score"], "rul_days": detail["rul_days"],
            "recommended_service_date": detail["recommended_service_date"],
            "urgency": detail["urgency"], "contributions": detail["top_features"],
        }

    def inference_upload(self, telemetry: pd.DataFrame, threshold: float) -> dict:
        warnings = []
        required = {"datetime", "machineID", *SENSOR_COLS}
        missing = required - set(telemetry.columns)
        if missing:
            return {"n_rows": 0, "predictions": [], "warnings": [f"Missing columns: {sorted(missing)}"]}
        telemetry["datetime"] = pd.to_datetime(telemetry["datetime"])
        mids = telemetry["machineID"].unique()
        if not set(mids).issubset(set(self.raw["machines"]["machineID"])):
            warnings.append("Some machineIDs unknown; model/maintenance features default to sentinels.")
        sub = {
            "telemetry": telemetry,
            "machines": self.raw["machines"][self.raw["machines"]["machineID"].isin(mids)],
            "errors": self.raw["errors"][self.raw["errors"]["machineID"].isin(mids)],
            "maint": self.raw["maint"][self.raw["maint"]["machineID"].isin(mids)],
            "failures": self.raw["failures"][self.raw["failures"]["machineID"].isin(mids)],
        }
        feats = build_feature_matrix(
            build_base_dataframe(sub), sub["errors"], sub["maint"], self.cfg.features.window_hours
        ).sort_values("datetime").reset_index(drop=True)
        X = align_to_model_features(feats, self.selected_features)
        risk = self.model.predict_proba(X)[:, 1]
        preds = [{"machineID": int(m), "datetime": _ts(d), "risk": round(float(p), 4),
                  "prediction": "WILL FAIL" if p >= threshold else "healthy"}
                 for m, d, p in zip(feats["machineID"], feats["datetime"], risk)]
        return {"n_rows": len(preds), "predictions": preds, "warnings": warnings}
