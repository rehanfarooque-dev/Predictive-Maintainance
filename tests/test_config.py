# tests/test_config.py
import pytest
import tempfile
import os
import yaml
from src.pdm.config import load_config, Config

SAMPLE_CONFIG = {
    "data": {"raw_dir": "data/raw/"},
    "labeling": {"horizon_hours": 24},
    "features": {"window_hours": [3, 12], "top_n_features": 15},
    "model": {
        "n_cv_folds": 3,
        "tuning": {
            "n_trials": 10,
            "optimize_metric": "auc_pr",
            "search_space": {
                "n_estimators": [100, 300],
                "max_depth": [3, 6],
                "learning_rate": [0.01, 0.1],
                "subsample": [0.7, 1.0],
                "colsample_bytree": [0.7, 1.0],
            },
        },
    },
    "evaluation": {"test_size_pct": 0.2, "threshold_range": [0.1, 0.9], "threshold_step": 0.05},
    "outputs": {"models_dir": "outputs/models/", "reports_dir": "outputs/reports/"},
}


def test_load_config_returns_correct_horizon():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.dump(SAMPLE_CONFIG, f)
        path = f.name
    try:
        cfg = load_config(path)
        assert cfg.labeling.horizon_hours == 24
    finally:
        os.unlink(path)


def test_load_config_returns_correct_window_hours():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.dump(SAMPLE_CONFIG, f)
        path = f.name
    try:
        cfg = load_config(path)
        assert cfg.features.window_hours == [3, 12]
    finally:
        os.unlink(path)


def test_load_config_returns_correct_cv_folds():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.dump(SAMPLE_CONFIG, f)
        path = f.name
    try:
        cfg = load_config(path)
        assert cfg.model.n_cv_folds == 3
    finally:
        os.unlink(path)


def test_load_config_returns_search_space():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.dump(SAMPLE_CONFIG, f)
        path = f.name
    try:
        cfg = load_config(path)
        assert cfg.model.tuning.search_space["n_estimators"] == [100, 300]
    finally:
        os.unlink(path)
