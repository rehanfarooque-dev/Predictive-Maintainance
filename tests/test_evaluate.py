# tests/test_evaluate.py
import pytest
import numpy as np
import pandas as pd
import tempfile
import os
from src.pdm.evaluate import (
    compute_threshold_table,
    plot_precision_recall_curve,
    plot_roc_curve,
    plot_shap_summary,
    compute_per_component_metrics,
)
from src.pdm.model import train_final_model

BASIC_PARAMS = {"n_estimators": 50, "max_depth": 3, "learning_rate": 0.1,
                "subsample": 0.8, "colsample_bytree": 0.8}


@pytest.fixture
def eval_data():
    rng = np.random.default_rng(1)
    n = 300
    y_true = pd.Series((rng.random(n) > 0.85).astype(int))
    y_prob = rng.random(n)
    return y_true, y_prob


def test_threshold_table_has_correct_columns(eval_data):
    y_true, y_prob = eval_data
    thresholds = np.arange(0.1, 0.9, 0.1)
    table = compute_threshold_table(y_true, y_prob, thresholds)
    assert set(table.columns) == {"threshold", "precision", "recall", "f1"}


def test_threshold_table_row_count(eval_data):
    y_true, y_prob = eval_data
    thresholds = np.arange(0.1, 0.9, 0.1)
    table = compute_threshold_table(y_true, y_prob, thresholds)
    assert len(table) == len(thresholds)


def test_plot_pr_curve_saves_file(eval_data):
    y_true, y_prob = eval_data
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "pr.png")
        auc_pr = plot_precision_recall_curve(y_true, y_prob, path)
        assert os.path.exists(path)
        assert 0.0 <= auc_pr <= 1.0


def test_plot_roc_curve_saves_file(eval_data):
    y_true, y_prob = eval_data
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "roc.png")
        auc_roc = plot_roc_curve(y_true, y_prob, path)
        assert os.path.exists(path)
        assert 0.0 <= auc_roc <= 1.0


def test_plot_shap_summary_saves_file():
    rng = np.random.default_rng(2)
    n = 200
    X = pd.DataFrame(rng.standard_normal((n, 5)), columns=[f"f{i}" for i in range(5)])
    y = pd.Series((X["f0"] + X["f1"] > 0).astype(int))
    model = train_final_model(X, y, BASIC_PARAMS)
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "shap.png")
        plot_shap_summary(model, X, path)
        assert os.path.exists(path)


def test_per_component_metrics_has_correct_columns(failures_df):
    from datetime import datetime, timedelta
    BASE = datetime(2015, 1, 1)
    n = 240
    y_true = pd.Series(np.zeros(n, dtype=int))
    y_prob = np.zeros(n)
    timestamps = pd.Series([BASE + timedelta(hours=h) for h in range(n)])
    machine_ids = pd.Series([1] * n)
    result = compute_per_component_metrics(
        y_true, y_prob, failures_df, timestamps, machine_ids, horizon_hours=12
    )
    assert set(result.columns) == {"component", "precision", "recall", "f1", "n_failures"}
