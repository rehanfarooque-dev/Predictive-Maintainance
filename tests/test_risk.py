# tests/test_risk.py
import numpy as np
import pandas as pd

from src.pdm.risk import (
    compute_normal_bands,
    compute_risk_score,
    sensor_violations,
)

SENSORS = ["volt", "rotate", "pressure", "vibration"]


def _train_df(n=400):
    rng = np.random.default_rng(0)
    return pd.DataFrame({
        "model": ["model3"] * n,
        "volt": 170 + rng.standard_normal(n) * 5,
        "rotate": 450 + rng.standard_normal(n) * 10,
        "pressure": 100 + rng.standard_normal(n) * 3,
        "vibration": 40 + rng.standard_normal(n) * 2,
        "label": 0,
    })


def _reading(bands, n_violations=0, magnitude=0.0):
    vals = {s: b.p50 for s, b in bands.items()}
    for s in SENSORS[:n_violations]:
        vals[s] = bands[s].upper + magnitude * bands[s].width
    return vals


def test_bands_are_ordered():
    bands = compute_normal_bands(_train_df())["model3"]
    for s in SENSORS:
        assert bands[s].lower < bands[s].p50 < bands[s].upper


def test_no_violation_at_median():
    bands = compute_normal_bands(_train_df())["model3"]
    v = sensor_violations(_reading(bands, n_violations=0), bands)
    assert v["in_band"].all()
    res = compute_risk_score(hazard=0.0, violations=v)
    assert res.violation_count == 0
    assert res.violation_severity == 0.0


def test_severity_monotonic_in_violation_count():
    # violation_severity is context-only now, but should still rise with #violations
    bands = compute_normal_bands(_train_df())["model3"]
    sevs = []
    for k in range(0, 5):
        v = sensor_violations(_reading(bands, n_violations=k, magnitude=2.0), bands)
        sevs.append(compute_risk_score(hazard=0.0, violations=v).violation_severity)
    assert all(b > a for a, b in zip(sevs, sevs[1:]))  # strictly increasing


def test_severity_monotonic_in_magnitude():
    bands = compute_normal_bands(_train_df())["model3"]
    small = compute_risk_score(
        0.0, sensor_violations(_reading(bands, 1, magnitude=1.0), bands)
    ).violation_severity
    large = compute_risk_score(
        0.0, sensor_violations(_reading(bands, 1, magnitude=5.0), bands)
    ).violation_severity
    assert large > small


def test_score_is_the_raw_cumulative_hazard():
    # risk score IS the raw cumulative hazard H (no scaling), failure threshold at 1.0
    assert compute_risk_score(0.0).risk_score == 0.0
    assert compute_risk_score(0.5).risk_score == 0.5
    assert compute_risk_score(1.0).risk_score == 1.0
    assert compute_risk_score(1.6).risk_score == 1.6  # not clamped — raw value


def test_hazard_crossing_one_is_end_of_life():
    below = compute_risk_score(0.85)
    at = compute_risk_score(1.0)
    beyond = compute_risk_score(1.6)
    assert not below.at_end_of_life
    assert at.at_end_of_life and beyond.at_end_of_life
    assert below.risk_score < at.risk_score < beyond.risk_score  # monotonic in hazard
