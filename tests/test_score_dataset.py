# tests/test_score_dataset.py
import pandas as pd
import pytest

from src.pdm.data_loader import build_base_dataframe
from src.pdm.features import build_feature_matrix
from src.pdm.labels import make_labels
from src.pdm.model import train_final_model
from src.pdm.scoring import (
    align_to_model_features,
    build_scored_frame,
    chronological_test_split,
)

WINDOW = [3, 12]
HORIZON = 12
PARAMS = {"n_estimators": 20, "max_depth": 3, "learning_rate": 0.1,
          "subsample": 1.0, "colsample_bytree": 1.0}

EXPECTED_SCORED_COLS = {
    "machineID", "datetime", "risk", "label",
    "volt", "rotate", "pressure", "vibration", "model",
}


@pytest.fixture
def trained(raw_data):
    """A toy model trained on the fixture data, plus the feature names it expects."""
    base = build_base_dataframe(raw_data)
    feats = build_feature_matrix(base, raw_data["errors"], raw_data["maint"], WINDOW)
    feats = feats.sort_values("datetime").reset_index(drop=True)
    y = make_labels(feats, raw_data["failures"], HORIZON)
    selected = [c for c in feats.columns if c not in ("machineID", "datetime")][:10]
    model = train_final_model(feats[selected], y, PARAMS)
    return model, selected


def test_build_scored_frame_schema(raw_data, trained):
    model, selected = trained
    scored, features_selected = build_scored_frame(raw_data, model, selected, HORIZON, WINDOW)

    assert set(scored.columns) == EXPECTED_SCORED_COLS
    assert len(scored) == len(raw_data["telemetry"])
    assert scored["risk"].between(0.0, 1.0).all()
    assert scored["risk"].notna().all()
    assert pd.api.types.is_datetime64_any_dtype(scored["datetime"])
    assert scored["datetime"].dt.tz is None  # naive timestamps


def test_features_selected_column_order(raw_data, trained):
    model, selected = trained
    _, features_selected = build_scored_frame(raw_data, model, selected, HORIZON, WINDOW)
    assert list(features_selected.columns) == ["machineID", "datetime"] + selected


def test_align_preserves_selected_order(raw_data, trained):
    _, selected = trained
    base = build_base_dataframe(raw_data)
    feats = build_feature_matrix(base, raw_data["errors"], raw_data["maint"], WINDOW)
    X = align_to_model_features(feats, selected)
    assert list(X.columns) == selected  # exact order the model was trained on


def test_align_fills_missing_onehot_with_false(raw_data, trained):
    _, selected = trained
    base = build_base_dataframe(raw_data)
    feats = build_feature_matrix(base, raw_data["errors"], raw_data["maint"], WINDOW)
    X = align_to_model_features(feats, selected + ["model_does_not_exist"])
    assert (X["model_does_not_exist"] == False).all()  # noqa: E712


def test_align_raises_on_missing_real_feature(raw_data):
    base = build_base_dataframe(raw_data)
    feats = build_feature_matrix(base, raw_data["errors"], raw_data["maint"], WINDOW)
    with pytest.raises(ValueError):
        align_to_model_features(feats, ["not_a_real_feature"])


def test_chronological_split_matches_train_logic(raw_data, trained):
    model, selected = trained
    scored, _ = build_scored_frame(raw_data, model, selected, HORIZON, WINDOW)
    y_true, y_prob = chronological_test_split(scored, 0.2)
    expected_n = len(scored) - int(len(scored) * 0.8)
    assert len(y_true) == expected_n
    assert len(y_prob) == expected_n
