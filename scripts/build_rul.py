"""Fit the risk-band + survival models and precompute per-machine RUL for the app.

Run AFTER train.py + score_dataset.py. Produces:
  outputs/models/bands.json        per-model normal sensor bands (risk score)
  outputs/models/survival.joblib   Weibull AFT + Kaplan-Meier + covariate columns
  outputs/rul.parquet              current risk score + RUL + service date per machine
  outputs/rul_meta.json            staleness / provenance metadata

Usage:
    python scripts/build_rul.py --config config.yaml
"""
import argparse
import json
import sys
from pathlib import Path

import joblib
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pdm.config import load_config
from src.pdm.data_loader import build_base_dataframe, load_raw_data
from src.pdm.features import build_feature_matrix
from src.pdm.model import load_model
from src.pdm.risk import (
    bands_to_dict,
    compute_normal_bands,
    compute_risk_score,
    sensor_violations,
)
from src.pdm.scoring import SENSOR_COLS, chronological_test_split  # noqa: F401
from src.pdm.survival import (
    COVARIATE_FEATURE_COLS,
    align_covariates,
    attach_life_covariates,
    build_renewal_lives,
    cumulative_hazard,
    fit_kaplan_meier,
    fit_weibull_aft,
    predict_rul,
    rul_to_service_date,
)

COMP_COLS = ["comp1", "comp2", "comp3", "comp4"]


def main(config_path: str) -> None:
    cfg = load_config(config_path)
    models_dir = Path(cfg.outputs.models_dir)
    reports_dir = Path(cfg.outputs.reports_dir)
    out_dir = models_dir.parent

    model_path = models_dir / "model.joblib"
    scored_path = out_dir / "scored.parquet"
    if not model_path.exists() or not scored_path.exists():
        sys.exit(
            "Missing model.joblib or scored.parquet.\n"
            "Run:  python train.py --config config.yaml\n"
            "      python scripts/score_dataset.py --config config.yaml"
        )

    print("Loading model, data and scores...")
    model = load_model(str(model_path))
    raw = load_raw_data(cfg.data["raw_dir"])
    scored = pd.read_parquet(scored_path)
    study_end = raw["telemetry"]["datetime"].max()

    # --- 1. Normal operating bands (from healthy training slice) ---
    print("Fitting normal sensor bands...")
    split_idx = int(len(scored.sort_values("datetime")) * (1 - cfg.evaluation.test_size_pct))
    train_scored = scored.sort_values("datetime").iloc[:split_idx]
    bands = compute_normal_bands(train_scored)
    (models_dir / "bands.json").write_text(json.dumps(bands_to_dict(bands), indent=2))

    # --- 2. Survival model (renewal-based Weibull AFT) ---
    print("Building survival dataset and fitting Weibull AFT...")
    base_df = build_base_dataframe(raw)
    feature_df = build_feature_matrix(
        base_df, raw["errors"], raw["maint"], cfg.features.window_hours
    )
    lives = build_renewal_lives(raw["maint"], raw["failures"], study_end)
    survival_df, covariate_cols = attach_life_covariates(lives, feature_df)
    aft, used_cols = fit_weibull_aft(survival_df, covariate_cols)
    km = fit_kaplan_meier(survival_df, by="comp")
    joblib.dump(
        {"aft": aft, "km": km, "covariate_cols": used_cols, "study_end": study_end},
        models_dir / "survival.joblib",
    )
    n_events = int(survival_df["event_observed"].sum())
    print(f"  {len(survival_df)} lives | {n_events} failures | "
          f"AFT concordance={aft.concordance_index_:.3f}")

    # --- 3. Per-machine current state -> rul.parquet ---
    print("Scoring current RUL per machine...")
    latest_scored = scored.sort_values("datetime").groupby("machineID").tail(1)
    latest_feat = (
        feature_df.sort_values("datetime").groupby("machineID").tail(1)
        .set_index("machineID")
    )
    model_cols = [c for c in feature_df.columns if c.startswith("model_")]

    rows = []
    for _, srow in latest_scored.iterrows():
        mid = int(srow["machineID"])
        as_of = srow["datetime"]
        prob = float(srow["risk"])
        model_name = str(srow["model"])
        frow = latest_feat.loc[mid]

        # Oldest component since replacement = closest to wear-out
        hours_since = {c: float(frow.get(f"hours_since_{c}", 8760.0)) for c in COMP_COLS}
        current_comp = max(hours_since, key=hours_since.get)
        elapsed_days = hours_since[current_comp] / 24.0

        # Covariates for the AFT model
        cov_values = {c: float(frow.get(c, 0.0)) for c in COVARIATE_FEATURE_COLS}
        for mc in model_cols:
            cov_values[mc] = float(frow.get(mc, 0.0))
        cov_values[f"comp_{current_comp}"] = 1.0
        X = align_covariates(cov_values, used_cols)

        rul = predict_rul(aft, X, elapsed_days)
        hazard = cumulative_hazard(aft, X, elapsed_days)
        sched = rul_to_service_date(as_of, rul.rul_days, rul.rul_ci_low_days)

        # Risk score = Weibull cumulative hazard at the part's current age (100 = failure)
        values = {s: float(srow[s]) for s in SENSOR_COLS}
        viol = sensor_violations(values, bands[model_name])
        risk = compute_risk_score(hazard, viol)

        rows.append({
            "machineID": mid,
            "model": model_name,
            "as_of": as_of,
            "classifier_risk": round(prob, 4),
            "risk_score": risk.risk_score,
            "at_end_of_life": risk.at_end_of_life,
            "violation_count": risk.violation_count,
            "violation_severity": risk.violation_severity,
            "current_comp": current_comp,
            "elapsed_days": round(elapsed_days, 1),
            "rul_days": rul.rul_days,
            "rul_ci_low_days": rul.rul_ci_low_days,
            "rul_ci_high_days": rul.rul_ci_high_days,
            "is_capped": rul.is_capped,
            "recommended_service_date": sched["recommended_service_date"],
            "days_until_service": sched["days_until_service"],
            "urgency": sched["urgency"],
            "top_violating_sensors": json.dumps(risk.top_sensors),
        })

    rul_df = pd.DataFrame(rows)
    rul_df.to_parquet(out_dir / "rul.parquet", index=False)

    meta = {
        "built_at": pd.Timestamp.now().isoformat(),
        "study_end": str(study_end),
        "n_machines": int(rul_df["machineID"].nunique()),
        "n_lives": int(len(survival_df)),
        "n_events": n_events,
        "aft_concordance": round(float(aft.concordance_index_), 4),
        "model_mtime": model_path.stat().st_mtime,
        "scored_mtime": scored_path.stat().st_mtime,
    }
    (out_dir / "rul_meta.json").write_text(json.dumps(meta, indent=2))

    urgent = int((rul_df["urgency"].isin(["overdue", "urgent"])).sum())
    print(f"  Wrote outputs/rul.parquet ({len(rul_df)} machines, {urgent} urgent/overdue)")
    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Precompute risk scores + RUL for the app")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    args = parser.parse_args()
    main(args.config)
