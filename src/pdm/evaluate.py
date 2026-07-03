from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)


def compute_threshold_table(
    y_true: pd.Series, y_prob: np.ndarray, thresholds: np.ndarray
) -> pd.DataFrame:
    rows = []
    for t in thresholds:
        y_pred = (y_prob >= t).astype(int)
        rows.append({
            "threshold": round(float(t), 4),
            "precision": precision_score(y_true, y_pred, zero_division=0),
            "recall": recall_score(y_true, y_pred, zero_division=0),
            "f1": f1_score(y_true, y_pred, zero_division=0),
        })
    return pd.DataFrame(rows)


def plot_precision_recall_curve(
    y_true: pd.Series, y_prob: np.ndarray, output_path: str
) -> float:
    precision, recall, _ = precision_recall_curve(y_true, y_prob)
    auc_pr = average_precision_score(y_true, y_prob)
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(recall, precision, lw=2, label=f"AUC-PR = {auc_pr:.3f}")
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title("Precision-Recall Curve")
    ax.legend()
    ax.grid(True, alpha=0.3)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return auc_pr


def plot_roc_curve(
    y_true: pd.Series, y_prob: np.ndarray, output_path: str
) -> float:
    fpr, tpr, _ = roc_curve(y_true, y_prob)
    auc_roc = roc_auc_score(y_true, y_prob)
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(fpr, tpr, lw=2, label=f"AUC-ROC = {auc_roc:.3f}")
    ax.plot([0, 1], [0, 1], "k--", lw=1)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC Curve")
    ax.legend()
    ax.grid(True, alpha=0.3)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return auc_roc


def plot_shap_summary(
    model: xgb.XGBClassifier, X: pd.DataFrame, output_path: str
) -> None:
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)
    shap.summary_plot(shap_values, X, show=False)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close("all")


def plot_optuna_history(study, output_path: str) -> None:
    trials_df = study.trials_dataframe()
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(trials_df.index, trials_df["value"], "o-", alpha=0.6, markersize=4)
    ax.axhline(study.best_value, color="red", linestyle="--", label=f"Best: {study.best_value:.4f}")
    ax.set_xlabel("Trial")
    ax.set_ylabel("AUC-PR")
    ax.set_title("Optuna Optimization History")
    ax.legend()
    ax.grid(True, alpha=0.3)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def compute_per_component_metrics(
    y_true: pd.Series,
    y_prob: np.ndarray,
    failures_df: pd.DataFrame,
    test_timestamps: pd.Series,
    machine_ids: pd.Series,
    horizon_hours: int,
    threshold: float = 0.5,
) -> pd.DataFrame:
    horizon = pd.Timedelta(hours=horizon_hours)
    y_pred = (y_prob >= threshold).astype(int)
    rows = []
    for comp in failures_df["failure"].unique():
        comp_failures = failures_df[failures_df["failure"] == comp]
        comp_labels = pd.Series(0, index=y_true.index)
        for _, row in comp_failures.iterrows():
            in_window = (
                (machine_ids.values == row["machineID"])
                & (test_timestamps.values >= row["datetime"] - horizon)
                & (test_timestamps.values < row["datetime"])
            )
            comp_labels.iloc[np.where(in_window)[0]] = 1
        if comp_labels.sum() == 0:
            continue
        rows.append({
            "component": comp,
            "precision": precision_score(comp_labels, y_pred, zero_division=0),
            "recall": recall_score(comp_labels, y_pred, zero_division=0),
            "f1": f1_score(comp_labels, y_pred, zero_division=0),
            "n_failures": int(comp_labels.sum()),
        })
    return pd.DataFrame(rows)
