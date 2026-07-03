import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import optuna
import pandas as pd
import shap
import xgboost as xgb
from sklearn.metrics import average_precision_score
from sklearn.model_selection import TimeSeriesSplit

optuna.logging.set_verbosity(optuna.logging.WARNING)


def pass1_feature_selection(
    X: pd.DataFrame,
    y: pd.Series,
    near_zero_threshold: float = 1e-5,
) -> List[str]:
    """Train a quick XGBoost with defaults; return features with nonzero gain importance."""
    scale_pos_weight = (y == 0).sum() / max((y == 1).sum(), 1)
    model = xgb.XGBClassifier(
        n_estimators=100,
        random_state=42,
        scale_pos_weight=scale_pos_weight,
        eval_metric="aucpr",
        verbosity=0,
    )
    model.fit(X, y)
    importance = pd.Series(model.get_booster().get_score(importance_type="gain"))
    return importance[importance > near_zero_threshold].index.tolist()


def _cv_auc_pr(
    params: Dict[str, Any],
    X: pd.DataFrame,
    y: pd.Series,
    n_splits: int,
) -> float:
    """Mean AUC-PR across TimeSeriesSplit folds."""
    tscv = TimeSeriesSplit(n_splits=n_splits)
    scale_pos_weight = (y == 0).sum() / max((y == 1).sum(), 1)
    scores = []
    for train_idx, val_idx in tscv.split(X):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]
        m = xgb.XGBClassifier(
            **params,
            scale_pos_weight=scale_pos_weight,
            random_state=42,
            eval_metric="aucpr",
            verbosity=0,
        )
        m.fit(X_tr, y_tr)
        probs = m.predict_proba(X_val)[:, 1]
        scores.append(average_precision_score(y_val, probs))
    return float(np.mean(scores))


def tune_with_optuna(
    X: pd.DataFrame,
    y: pd.Series,
    search_space: Dict[str, Any],
    n_trials: int,
    n_cv_folds: int,
) -> Tuple[Dict[str, Any], optuna.Study]:
    """Bayesian optimization over search_space. Returns (best_params, study)."""

    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int(
                "n_estimators", *search_space["n_estimators"]
            ),
            "max_depth": trial.suggest_int("max_depth", *search_space["max_depth"]),
            "learning_rate": trial.suggest_float(
                "learning_rate", *search_space["learning_rate"], log=True
            ),
            "subsample": trial.suggest_float("subsample", *search_space["subsample"]),
            "colsample_bytree": trial.suggest_float(
                "colsample_bytree", *search_space["colsample_bytree"]
            ),
        }
        return _cv_auc_pr(params, X, y, n_cv_folds)

    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=n_trials)
    return study.best_params, study


def pass2_shap_feature_selection(
    model: xgb.XGBClassifier,
    X: pd.DataFrame,
    top_n: int,
) -> List[str]:
    """Return top_n features ranked by mean absolute SHAP value."""
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)
    mean_abs = pd.Series(
        np.abs(shap_values).mean(axis=0), index=X.columns
    ).sort_values(ascending=False)
    return mean_abs.head(top_n).index.tolist()


def train_final_model(
    X: pd.DataFrame,
    y: pd.Series,
    best_params: Dict[str, Any],
) -> xgb.XGBClassifier:
    scale_pos_weight = (y == 0).sum() / max((y == 1).sum(), 1)
    model = xgb.XGBClassifier(
        **best_params,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
        eval_metric="aucpr",
        verbosity=0,
    )
    model.fit(X, y)
    return model


def save_model(model: xgb.XGBClassifier, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)


def load_model(path: str) -> xgb.XGBClassifier:
    return joblib.load(path)
