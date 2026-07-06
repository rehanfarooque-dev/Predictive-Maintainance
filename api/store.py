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
            current_comp, _elapsed, rul, sched, hazard = self._machine_rul(frow, ts, prob, threshold)
            viol = sensor_violations({s: float(r[s]) for s in SENSOR_COLS}, self.bands[model_name])
            rs = compute_risk_score(hazard, viol)
            items.append({
                "machineID": mid, "model": model_name,
                "classifier_risk": round(prob, 4), "at_risk": bool(prob >= threshold),
                "risk_score": rs.risk_score,
                "at_end_of_life": rs.at_end_of_life, "violation_count": rs.violation_count,
                "current_comp": current_comp,
                "rul_days": rul.rul_days,
                "rul_ci_low_days": rul.rul_ci_low_days,
                "rul_ci_high_days": rul.rul_ci_high_days,
                "is_capped": rul.is_capped,
                "recommended_service_date": _ts(sched["recommended_service_date"]),
                "days_until_service": sched["days_until_service"],
                "urgency": sched["urgency"],
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
        mdf = self.scored[
            (self.scored["machineID"] == machine_id) & (self.scored["datetime"] <= ts)
        ].sort_values("datetime")
        meta = next((m for m in self.machines_meta if int(m["machineID"]) == machine_id), {})

        cur = mdf[mdf["datetime"] == ts]
        cur = cur.iloc[0] if len(cur) else mdf.iloc[-1]
        prob = float(cur["risk"])
        model_name = str(cur["model"])

        feat_row = self._feat_row(machine_id, ts)
        hours_since = {c: float(feat_row.get(f"hours_since_{c}", 8760.0)) for c in COMP_COLS}
        current_comp = max(hours_since, key=hours_since.get)
        elapsed_days = hours_since[current_comp] / 24.0
        X = self._covariates(feat_row, current_comp)
        rul = predict_rul(self.aft, X, elapsed_days)
        hazard = cumulative_hazard(self.aft, X, elapsed_days)
        horizon_days = float(self.cfg.labeling.horizon_hours) / 24.0
        sched = rul_to_service_date(
            ts, rul.rul_days, rul.rul_ci_low_days,
            classifier_prob=prob, threshold=threshold, horizon_days=horizon_days,
        )

        viol = sensor_violations({s: float(cur[s]) for s in SENSOR_COLS}, self.bands[model_name])
        rs = compute_risk_score(hazard, viol)

        # Downsample to ~1000 points, but always include the last row (the as-of point)
        # so the chart always ends exactly at the selected timestamp.
        stride = max(1, len(mdf) // 1000)
        sampled = mdf.iloc[::stride]
        last_row = mdf.iloc[[-1]]
        if sampled.iloc[-1]["datetime"] != last_row.iloc[0]["datetime"]:
            sampled = pd.concat([sampled, last_row])
        sub = sampled.reset_index(drop=True)

        # --- risk_score per timeseries row: H(t | X_row) ---
        # Each row gets its own covariate snapshot (sensor levels, error counts, model, comp)
        # at that point in time, so the hazard reflects the machine's actual historical state
        # rather than projecting today's covariates backward. This gives the true sawtooth:
        # H climbs from 0 after each replacement and reflects real operating conditions.
        fm_m = self.feat_by_machine[machine_id]
        hcols = [f"hours_since_{c}" for c in COMP_COLS]
        all_cov_cols = [c for c in COVARIATE_FEATURE_COLS + self.model_cols if c in fm_m.columns]

        sub_dt = sub[["datetime"]].copy()
        sub_dt["datetime"] = sub_dt["datetime"].astype("datetime64[ns]")
        merge_right = fm_m[["datetime"] + hcols + all_cov_cols].sort_values("datetime").copy()
        merge_right["datetime"] = merge_right["datetime"].astype("datetime64[ns]")
        feat_ts = pd.merge_asof(
            sub_dt, merge_right, on="datetime", direction="backward",
        ).reset_index(drop=True)

        # Elapsed days = age of the oldest (highest hours_since) component at each row
        el_arr = feat_ts[hcols].fillna(8760.0).max(axis=1).values / 24.0
        max_comp_idx = feat_ts[hcols].fillna(8760.0).values.argmax(axis=1)

        # Build per-row covariate matrix aligned to the fitted model's covariate column order
        n_rows = len(feat_ts)
        cov_data: dict = {}
        for col in COVARIATE_FEATURE_COLS:
            v = feat_ts[col].to_numpy(dtype=float) if col in feat_ts.columns else np.zeros(n_rows)
            nan_m = np.isnan(v)
            if nan_m.any():
                v = np.where(nan_m, float(np.nanmedian(v)) if not nan_m.all() else 0.0, v)
            cov_data[col] = v
        for mc in self.model_cols:
            v = feat_ts[mc].to_numpy(dtype=float) if mc in feat_ts.columns else np.zeros(n_rows)
            cov_data[mc] = np.nan_to_num(v, nan=0.0)
        for c in COMP_COLS:
            cov_data[f"comp_{c}"] = np.zeros(n_rows)
        for i, ci in enumerate(max_comp_idx):
            cov_data[f"comp_{COMP_COLS[ci]}"][i] = 1.0

        cov_df_all = pd.DataFrame(cov_data)
        for c in self.covariate_cols:
            if c not in cov_df_all.columns:
                cov_df_all[c] = 0.0
        cov_df_all = cov_df_all[self.covariate_cols]

        # Vectorised H(t): one predict_cumulative_hazard call over all unique times,
        # for ALL rows at once (output shape: n_times × n_rows). Then pick H(el_arr[i])
        # from column i via linear interpolation — no Python loop, no hardcoded formula.
        uniq_times = np.clip(np.unique(np.round(el_arr, 3)), 0.001, None)
        ch_df = self.aft.predict_cumulative_hazard(cov_df_all, times=uniq_times)
        time_idx = ch_df.index.to_numpy(dtype=float)
        ch_arr = ch_df.to_numpy(dtype=float)  # (n_times, n_rows)
        ts_rs = np.where(
            el_arr <= 0.0,
            0.0,
            np.array([np.interp(el_arr[i], time_idx, ch_arr[:, i]) for i in range(n_rows)]),
        )
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
            "risk_score": rs.risk_score, "violation_count": rs.violation_count,
            "violation_severity": rs.violation_severity,
            "at_end_of_life": rs.at_end_of_life,
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
