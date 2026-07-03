# tests/test_survival.py
from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from src.pdm.data_loader import build_base_dataframe
from src.pdm.features import build_feature_matrix
from src.pdm.survival import (
    align_covariates,
    attach_life_covariates,
    build_renewal_lives,
    cumulative_hazard,
    fit_weibull_aft,
    predict_rul,
    rul_to_service_date,
)

BASE = pd.Timestamp("2015-01-01")


def _day(d):
    return BASE + timedelta(days=d)


@pytest.fixture
def quirk_maint_failures():
    """Reproduces the failure/replacement co-timestamp quirk.

    m1/comp1: replaced day0, fails day10 (+replace), fails day25 (+replace) -> 3 lives.
    m1/comp2: replaced day0, preventively replaced day30, never fails -> 2 censored lives.
    """
    maint = pd.DataFrame({
        "machineID": [1, 1, 1, 1, 1],
        "datetime": [_day(0), _day(10), _day(25), _day(0), _day(30)],
        "comp": ["comp1", "comp1", "comp1", "comp2", "comp2"],
    })
    failures = pd.DataFrame({
        "machineID": [1, 1],
        "datetime": [_day(10), _day(25)],
        "failure": ["comp1", "comp1"],
    })
    return maint, failures, _day(40)


def test_renewal_lives_all_positive_duration(quirk_maint_failures):
    maint, failures, study_end = quirk_maint_failures
    lives = build_renewal_lives(maint, failures, study_end)
    assert (lives["duration_hours"] > 0).all()  # no spurious zero-length life


def test_renewal_lives_events_and_censoring(quirk_maint_failures):
    maint, failures, study_end = quirk_maint_failures
    lives = build_renewal_lives(maint, failures, study_end)

    c1 = lives[lives["comp"] == "comp1"].sort_values("start").reset_index(drop=True)
    assert len(c1) == 3
    # life starting day0 ends at the day10 failure (event observed), ~10 days
    assert c1.loc[0, "event_observed"] == 1
    assert c1.loc[0, "duration_days"] == pytest.approx(10.0, abs=0.01)
    assert c1.loc[1, "event_observed"] == 1  # day10 -> day25 failure
    assert c1.loc[2, "event_observed"] == 0  # day25 -> study_end, censored

    c2 = lives[lives["comp"] == "comp2"]
    assert len(c2) == 2
    assert (c2["event_observed"] == 0).all()  # never failed -> all censored


def test_attach_life_covariates_no_nan(raw_data):
    base = build_base_dataframe(raw_data)
    feats = build_feature_matrix(base, raw_data["errors"], raw_data["maint"], [3, 12, 24])
    lives = build_renewal_lives(
        raw_data["maint"], raw_data["failures"], raw_data["telemetry"]["datetime"].max()
    )
    surv, cov_cols = attach_life_covariates(lives, feats)
    assert len(cov_cols) > 0
    assert surv[cov_cols].isna().sum().sum() == 0
    assert any(c.startswith("comp_") for c in cov_cols)


@pytest.fixture
def synthetic_survival():
    rng = np.random.default_rng(0)
    n = 400
    x = rng.uniform(0, 1, n)
    base = 10 + 30 * x  # larger x -> longer life
    duration = rng.weibull(1.5, n) * base + 0.1
    event = (rng.uniform(size=n) < 0.85).astype(int)
    return pd.DataFrame({"x": x, "duration_days": duration, "event_observed": event})


def test_weibull_fit_and_rul_ordering(synthetic_survival):
    pytest.importorskip("lifelines")
    aft, used = fit_weibull_aft(synthetic_survival, ["x"])
    assert "x" in used

    X = align_covariates({"x": 0.5}, used)
    r = predict_rul(aft, X, elapsed_days=1.0, ci=0.90)
    assert 0.0 <= r.rul_ci_low_days <= r.rul_days <= r.rul_ci_high_days
    assert np.isfinite(r.rul_days)


def test_rul_capping(synthetic_survival):
    pytest.importorskip("lifelines")
    aft, used = fit_weibull_aft(synthetic_survival, ["x"])
    X = align_covariates({"x": 1.0}, used)  # long-life config
    r = predict_rul(aft, X, elapsed_days=0.0, ci=0.90, rul_cap_days=3.0)
    assert r.is_capped
    assert r.rul_days <= 3.0


def test_cumulative_hazard_monotonic_and_median(synthetic_survival):
    pytest.importorskip("lifelines")
    aft, used = fit_weibull_aft(synthetic_survival, ["x"])
    X = align_covariates({"x": 0.5}, used)

    # H accumulates: 0 at install, strictly increasing with age
    assert cumulative_hazard(aft, X, 0.0) == 0.0
    h_young = cumulative_hazard(aft, X, 5.0)
    h_old = cumulative_hazard(aft, X, 40.0)
    assert 0.0 < h_young < h_old

    # At the median life, S=0.5 so H = -ln(0.5) = ln(2) ≈ 0.693
    median = predict_rul(aft, X, elapsed_days=0.0).rul_days
    assert cumulative_hazard(aft, X, median) == pytest.approx(0.693, abs=0.08)


def test_rul_to_service_date_urgency():
    soon = rul_to_service_date(BASE, rul_days=8.0, rul_ci_low_days=6.0)
    later = rul_to_service_date(BASE, rul_days=200.0, rul_ci_low_days=150.0)
    assert soon["recommended_service_date"] <= later["recommended_service_date"]
    assert later["urgency"] == "planned"
    assert soon["days_until_service"] >= 0
