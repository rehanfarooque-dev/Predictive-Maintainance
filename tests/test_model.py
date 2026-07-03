# tests/test_model.py
import os
import tempfile

import numpy as np
import pandas as pd
import pytest

from src.pdm.model import (
    load_model,
    pass1_feature_selection,
    pass2_shap_feature_selection,
    save_model,
    train_final_model,
    tune_with_optuna,
)

SEARCH_SPACE = {
    "n_estimators": [50, 100],
    "max_depth": [2, 4],
    "learning_rate": [0.05, 0.2],
    "subsample": [0.7, 1.0],
    "colsample_bytree": [0.7, 1.0],
}

BASIC_PARAMS = {
    "n_estimators": 50,
    "max_depth": 3,
    "learning_rate": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
}


@pytest.fixture
def synthetic_X_y():
    rng = np.random.default_rng(0)
    n = 500
    X = pd.DataFrame({
        "feat_a": rng.standard_normal(n),
        "feat_b": rng.standard_normal(n),
        "feat_c": rng.standard_normal(n),
        "noise_1": np.zeros(n),
        "noise_2": np.zeros(n),
    })
    y = pd.Series((X["feat_a"] + X["feat_b"] > 0).astype(int))
    return X, y


# --- Task 6: Pass 1 feature selection ---

def test_pass1_removes_zero_importance_features(synthetic_X_y):
    X, y = synthetic_X_y
    selected = pass1_feature_selection(X, y)
    assert "noise_1" not in selected
    assert "noise_2" not in selected


def test_pass1_keeps_informative_features(synthetic_X_y):
    X, y = synthetic_X_y
    selected = pass1_feature_selection(X, y)
    assert "feat_a" in selected
    assert "feat_b" in selected


def test_pass1_returns_list_of_strings(synthetic_X_y):
    X, y = synthetic_X_y
    selected = pass1_feature_selection(X, y)
    assert isinstance(selected, list)
    assert all(isinstance(s, str) for s in selected)


# --- Task 7: Optuna + TimeSeriesCV ---

def test_tune_with_optuna_returns_best_params(synthetic_X_y):
    X, y = synthetic_X_y
    best_params, study = tune_with_optuna(X, y, SEARCH_SPACE, n_trials=3, n_cv_folds=2)
    assert "n_estimators" in best_params
    assert "max_depth" in best_params
    assert "learning_rate" in best_params


def test_tune_with_optuna_best_value_is_float(synthetic_X_y):
    X, y = synthetic_X_y
    _, study = tune_with_optuna(X, y, SEARCH_SPACE, n_trials=3, n_cv_folds=2)
    assert isinstance(study.best_value, float)
    assert 0.0 <= study.best_value <= 1.0


def test_tune_with_optuna_respects_search_space(synthetic_X_y):
    X, y = synthetic_X_y
    best_params, _ = tune_with_optuna(X, y, SEARCH_SPACE, n_trials=5, n_cv_folds=2)
    assert SEARCH_SPACE["max_depth"][0] <= best_params["max_depth"] <= SEARCH_SPACE["max_depth"][1]


# --- Task 8: Pass 2 SHAP, final fit, serialize ---

def test_pass2_returns_top_n_features(synthetic_X_y):
    X, y = synthetic_X_y
    model = train_final_model(X, y, BASIC_PARAMS)
    selected = pass2_shap_feature_selection(model, X, top_n=2)
    assert len(selected) == 2


def test_pass2_returns_feature_names_from_X(synthetic_X_y):
    X, y = synthetic_X_y
    model = train_final_model(X, y, BASIC_PARAMS)
    selected = pass2_shap_feature_selection(model, X, top_n=3)
    assert all(s in X.columns for s in selected)


def test_train_final_model_returns_fitted_xgb(synthetic_X_y):
    X, y = synthetic_X_y
    model = train_final_model(X, y, BASIC_PARAMS)
    probs = model.predict_proba(X)[:, 1]
    assert len(probs) == len(y)
    assert all(0.0 <= p <= 1.0 for p in probs)


def test_save_and_load_model_round_trips(synthetic_X_y):
    X, y = synthetic_X_y
    model = train_final_model(X, y, BASIC_PARAMS)
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "model.joblib")
        save_model(model, path)
        loaded = load_model(path)
    original_probs = model.predict_proba(X)[:, 1]
    loaded_probs = loaded.predict_proba(X)[:, 1]
    np.testing.assert_array_almost_equal(original_probs, loaded_probs)
