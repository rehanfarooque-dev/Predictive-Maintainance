"""SHAP-on-demand for single predictions.

The expensive global SHAP summary is precomputed by train.py (shap_summary.png). Here we
only ever explain one or a few rows interactively, using a cached TreeExplainer, which is
sub-second for an XGBoost model.
"""
import numpy as np
import pandas as pd
import shap
import streamlit as st


@st.cache_resource
def get_explainer(_model):
    """Cached TreeExplainer. The leading underscore tells Streamlit not to hash the model."""
    return shap.TreeExplainer(_model)


def explain_row(model, x_row: pd.DataFrame, top_k: int = 12) -> pd.DataFrame:
    """Return the top-k features by absolute SHAP contribution for a single row.

    ``x_row`` must be a 1-row DataFrame whose columns match the model's training
    features, in order. Returns a DataFrame indexed by feature name with a signed
    ``shap_value`` column, ordered for a horizontal bar chart (largest at top).
    """
    explainer = get_explainer(model)
    shap_values = explainer.shap_values(x_row.astype(float))
    values = np.asarray(shap_values)
    if values.ndim == 2:
        values = values[0]
    contributions = pd.Series(values, index=x_row.columns)
    top = contributions.reindex(
        contributions.abs().sort_values(ascending=False).index
    ).head(top_k)
    # Reverse so the most important feature renders at the top of a horizontal bar.
    return top.iloc[::-1].to_frame("shap_value")
