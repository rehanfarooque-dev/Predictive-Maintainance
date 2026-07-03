"""Results explorer: an interactive view of the trained model's quality (notebook 04)."""
import numpy as np
import pandas as pd
import streamlit as st

from app import scoring_ui
from src.pdm.evaluate import compute_threshold_table
from src.pdm.scoring import chronological_test_split

scoring_ui.require_ready()

st.title("📈 Results Explorer")

reports = scoring_ui.get_reports()
summary = reports["summary"]
plots = reports.get("plots", {})

# --- Headline metrics ---
c1, c2, c3, c4 = st.columns(4)
c1.metric("AUC-PR", f"{summary['auc_pr']:.4f}")
c2.metric("AUC-ROC", f"{summary['auc_roc']:.4f}")
c3.metric("Final features", summary["n_features_final"])
c4.metric("Horizon", f"{summary['horizon_hours']} h")
st.caption(
    "Scores are on the held-out final 20% of the timeline. This is a synthetic dataset "
    "tuned to be learnable, so expect lower numbers on real-world data."
)

st.divider()

# --- PR / ROC curves (pre-rendered by train.py) ---
st.subheader("Precision-Recall & ROC curves")
col_pr, col_roc = st.columns(2)
if "pr_curve.png" in plots:
    col_pr.image(plots["pr_curve.png"], caption="Precision-Recall")
if "roc_curve.png" in plots:
    col_roc.image(plots["roc_curve.png"], caption="ROC")

# --- Interactive threshold sweep ---
st.subheader("Threshold trade-off")
cfg = scoring_ui.get_config()
scored = scoring_ui.get_scored()
y_true, y_prob = chronological_test_split(scored, cfg.evaluation.test_size_pct)

t = st.slider(
    "Decision threshold",
    0.05, 0.95, scoring_ui.get_threshold(), 0.05,
    help="Recomputes precision / recall / F1 live on the held-out test set.",
)
live = compute_threshold_table(pd.Series(y_true), y_prob, np.array([t])).iloc[0]
m1, m2, m3 = st.columns(3)
m1.metric("Precision", f"{live['precision']:.3f}")
m2.metric("Recall", f"{live['recall']:.3f}")
m3.metric("F1", f"{live['f1']:.3f}")

threshold_table = reports["threshold_table"]
st.line_chart(threshold_table.set_index("threshold")[["precision", "recall", "f1"]])
st.caption("Full sweep from `threshold_table.csv`. Higher threshold → fewer false alarms, more misses.")

st.divider()

# --- Per-component metrics ---
st.subheader("Per-component performance")
component_metrics = reports["component_metrics"]
cc1, cc2 = st.columns([2, 3])
cc1.dataframe(component_metrics, hide_index=True, use_container_width=True)
cc2.bar_chart(
    component_metrics.set_index("component")[["precision", "recall", "f1"]]
)
st.caption(
    "This is a single 'any-failure' model, so a correct alert for one component counts as a "
    "false positive in the others' rows — **per-component recall is the meaningful number**."
)

st.divider()

# --- SHAP summary, selected features, best params, Optuna ---
st.subheader("Feature importance & tuning")
if "shap_summary.png" in plots:
    st.image(plots["shap_summary.png"], caption="Global SHAP summary")

fc1, fc2 = st.columns(2)
with fc1:
    st.markdown("**Selected features (SHAP-ranked)**")
    st.dataframe(
        pd.DataFrame({"feature": reports["selected_features"]}),
        hide_index=True, use_container_width=True,
    )
with fc2:
    st.markdown("**Best hyperparameters (Optuna)**")
    st.dataframe(
        pd.DataFrame(reports["best_params"].items(), columns=["param", "value"]),
        hide_index=True, use_container_width=True,
    )
    if "optuna_history.png" in plots:
        st.image(plots["optuna_history.png"], caption="Optuna optimization history")
