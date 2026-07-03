import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd

from src.pdm.config import load_config
from src.pdm.data_loader import build_base_dataframe, load_raw_data
from src.pdm.evaluate import (
    compute_per_component_metrics,
    compute_threshold_table,
    plot_optuna_history,
    plot_precision_recall_curve,
    plot_roc_curve,
    plot_shap_summary,
)
from src.pdm.features import build_feature_matrix
from src.pdm.labels import make_labels
from src.pdm.model import (
    pass1_feature_selection,
    pass2_shap_feature_selection,
    save_model,
    train_final_model,
    tune_with_optuna,
)

NON_FEATURE_COLS = ["machineID", "datetime", "label"]


def main(config_path: str) -> None:
    cfg = load_config(config_path)
    reports_dir = Path(cfg.outputs.reports_dir)
    models_dir = Path(cfg.outputs.models_dir)
    reports_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)

    print("Loading data...")
    raw = load_raw_data(cfg.data["raw_dir"])
    base_df = build_base_dataframe(raw)

    print("Engineering features...")
    feature_df = build_feature_matrix(
        base_df, raw["errors"], raw["maint"], cfg.features.window_hours
    )

    print(f"Generating labels (horizon={cfg.labeling.horizon_hours}h)...")
    feature_df = feature_df.sort_values("datetime").reset_index(drop=True)
    feature_df["label"] = make_labels(
        feature_df, raw["failures"], cfg.labeling.horizon_hours
    ).values

    # Time-based split
    split_idx = int(len(feature_df) * (1 - cfg.evaluation.test_size_pct))
    train_df = feature_df.iloc[:split_idx].copy()
    test_df = feature_df.iloc[split_idx:].copy()

    X_train = train_df.drop(columns=NON_FEATURE_COLS, errors="ignore")
    y_train = train_df["label"]
    X_test = test_df.drop(columns=NON_FEATURE_COLS, errors="ignore")
    y_test = test_df["label"]

    print(f"Training set: {len(X_train)} rows | Test set: {len(X_test)} rows")
    print(f"Label prevalence — train: {y_train.mean():.3%} | test: {y_test.mean():.3%}")

    print("\nPass 1: gain-importance feature selection...")
    selected_p1 = pass1_feature_selection(X_train, y_train)
    X_train, X_test = X_train[selected_p1], X_test[selected_p1]
    print(f"  {len(selected_p1)} features retained")

    print(f"\nOptuna tuning ({cfg.model.tuning.n_trials} trials, {cfg.model.n_cv_folds}-fold CV)...")
    best_params, study = tune_with_optuna(
        X_train, y_train,
        cfg.model.tuning.search_space,
        cfg.model.tuning.n_trials,
        cfg.model.n_cv_folds,
    )
    print(f"  Best CV AUC-PR: {study.best_value:.4f}")
    print(f"  Best params: {best_params}")
    (reports_dir / "best_params.json").write_text(json.dumps(best_params, indent=2))
    plot_optuna_history(study, str(reports_dir / "optuna_history.png"))

    print("\nPass 2: SHAP-based feature selection...")
    interim_model = train_final_model(X_train, y_train, best_params)
    selected_p2 = pass2_shap_feature_selection(
        interim_model, X_train, cfg.features.top_n_features
    )
    X_train, X_test = X_train[selected_p2], X_test[selected_p2]
    print(f"  {len(selected_p2)} features retained")
    (reports_dir / "selected_features.json").write_text(json.dumps(selected_p2, indent=2))

    print("\nTraining final model on selected features...")
    model = train_final_model(X_train, y_train, best_params)
    save_model(model, str(models_dir / "model.joblib"))

    print("\nEvaluating on held-out test set...")
    y_prob = model.predict_proba(X_test)[:, 1]

    auc_pr = plot_precision_recall_curve(y_test, y_prob, str(reports_dir / "pr_curve.png"))
    auc_roc = plot_roc_curve(y_test, y_prob, str(reports_dir / "roc_curve.png"))
    print(f"  AUC-PR : {auc_pr:.4f}")
    print(f"  AUC-ROC: {auc_roc:.4f}")

    thresholds = np.arange(
        cfg.evaluation.threshold_range[0],
        cfg.evaluation.threshold_range[1],
        cfg.evaluation.threshold_step,
    )
    threshold_table = compute_threshold_table(y_test, y_prob, thresholds)
    threshold_table.to_csv(reports_dir / "threshold_table.csv", index=False)

    plot_shap_summary(model, X_test, str(reports_dir / "shap_summary.png"))

    component_metrics = compute_per_component_metrics(
        y_test,
        y_prob,
        raw["failures"],
        test_df["datetime"].reset_index(drop=True),
        test_df["machineID"].reset_index(drop=True),
        cfg.labeling.horizon_hours,
    )
    component_metrics.to_csv(reports_dir / "component_metrics.csv", index=False)

    summary = {
        "horizon_hours": cfg.labeling.horizon_hours,
        "n_features_final": len(selected_p2),
        "auc_pr": round(auc_pr, 4),
        "auc_roc": round(auc_roc, 4),
        "best_params": best_params,
    }
    (reports_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    print(f"\nAll outputs saved to {reports_dir}")
    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Predictive maintenance training pipeline")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    args = parser.parse_args()
    main(args.config)
