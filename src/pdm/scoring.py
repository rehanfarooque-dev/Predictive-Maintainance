"""Score the full dataset with a trained model and reproduce train.py's split.

This module is the bridge between the training pipeline and the Streamlit app. It
recomputes the exact same feature matrix train.py builds, aligns it to the columns the
saved model expects (``selected_features.json``), and produces per-row failure-risk
scores. The app reads the materialized output instead of recomputing features on every
interaction.

Everything here is pure (no I/O, no Streamlit) so it can be unit-tested with the
fixtures in ``tests/conftest.py``.
"""
from typing import List, Tuple

import numpy as np
import pandas as pd

from src.pdm.data_loader import build_base_dataframe
from src.pdm.features import build_feature_matrix
from src.pdm.labels import make_labels

# Raw sensor columns kept in the scored frame so the dashboard can draw traces
# without touching the 80 MB telemetry CSV.
SENSOR_COLS = ["volt", "rotate", "pressure", "vibration"]


def align_to_model_features(feature_df: pd.DataFrame, selected_features: List[str]) -> pd.DataFrame:
    """Return ``feature_df`` reduced to exactly ``selected_features``, in that order.

    The saved XGBoost model was fit on these columns in this order, so prediction
    requires an exact match. Missing one-hot ``model_*`` columns (e.g. when scoring a
    single machine whose model type differs) are filled with ``False``; a missing
    non-categorical feature is a real error and raises.
    """
    missing = [c for c in selected_features if c not in feature_df.columns]
    if missing:
        non_onehot = [c for c in missing if not c.startswith("model_")]
        if non_onehot:
            raise ValueError(
                "Feature matrix is missing required (non one-hot) features: "
                f"{non_onehot}. The model and data are out of sync."
            )
        feature_df = feature_df.copy()
        for col in missing:
            feature_df[col] = False  # absent one-hot model category
    return feature_df[selected_features]


def build_scored_frame(
    raw: dict,
    model,
    selected_features: List[str],
    horizon_hours: int,
    window_hours: List[int],
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Build per-(machine, hour) risk scores for the whole dataset.

    Returns ``(scored_df, features_selected_df)``:
      * ``scored_df`` — compact display frame: machineID, datetime, risk, label,
        the four raw sensors, and the machine's model type.
      * ``features_selected_df`` — machineID, datetime + the model-input columns, so
        SHAP explanations need no feature recompute in the app.

    The row order, sort, and label logic mirror ``train.py`` exactly so the
    chronological test split lines up with the reported metrics.
    """
    base_df = build_base_dataframe(raw)
    feature_df = build_feature_matrix(base_df, raw["errors"], raw["maint"], window_hours)
    feature_df = feature_df.sort_values("datetime").reset_index(drop=True)
    feature_df["label"] = make_labels(feature_df, raw["failures"], horizon_hours).values

    X = align_to_model_features(feature_df, selected_features)
    risk = model.predict_proba(X)[:, 1]

    model_by_machine = raw["machines"].set_index("machineID")["model"]
    scored_df = pd.DataFrame({
        "machineID": feature_df["machineID"].astype("int16"),
        "datetime": feature_df["datetime"],
        "risk": np.asarray(risk, dtype="float32"),
        "label": feature_df["label"].astype("int8"),
    })
    for col in SENSOR_COLS:
        scored_df[col] = feature_df[col].astype("float32")
    scored_df["model"] = scored_df["machineID"].map(model_by_machine).astype("category")

    features_selected_df = pd.concat(
        [feature_df[["machineID", "datetime"]].reset_index(drop=True), X.reset_index(drop=True)],
        axis=1,
    )
    return scored_df, features_selected_df


def chronological_test_split(
    scored_df: pd.DataFrame, test_size_pct: float
) -> Tuple[np.ndarray, np.ndarray]:
    """Reproduce train.py's held-out test set from the scored frame.

    Sorts by datetime and takes the final ``test_size_pct`` of rows, exactly as
    ``train.py`` does. Returns ``(y_true, y_prob)`` for that slice so the app's live
    threshold sweep matches the metrics in ``summary.json``.
    """
    df = scored_df.sort_values("datetime").reset_index(drop=True)
    split_idx = int(len(df) * (1 - test_size_pct))
    test = df.iloc[split_idx:]
    return test["label"].to_numpy(), test["risk"].to_numpy()
