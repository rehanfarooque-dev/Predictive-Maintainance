# tests/conftest.py
import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

BASE = datetime(2015, 1, 1)


@pytest.fixture
def telemetry_df():
    """Hourly telemetry for 2 machines over 10 days (240 rows each)."""
    rng = np.random.default_rng(42)
    records = []
    for machine_id in [1, 2]:
        for h in range(240):
            records.append({
                "machineID": machine_id,
                "datetime": BASE + timedelta(hours=h),
                "volt": 170 + rng.standard_normal() * 5,
                "rotate": 450 + rng.standard_normal() * 10,
                "pressure": 100 + rng.standard_normal() * 3,
                "vibration": 40 + rng.standard_normal() * 2,
            })
    return pd.DataFrame(records)


@pytest.fixture
def machines_df():
    return pd.DataFrame({
        "machineID": [1, 2],
        "model": ["model3", "model4"],
        "age": [5, 3],
    })


@pytest.fixture
def errors_df():
    return pd.DataFrame({
        "machineID": [1, 1, 2],
        "datetime": [
            BASE + timedelta(hours=50),
            BASE + timedelta(hours=100),
            BASE + timedelta(hours=70),
        ],
        "errorID": ["error1", "error2", "error1"],
    })


@pytest.fixture
def maint_df():
    return pd.DataFrame({
        "machineID": [1, 2, 1],
        "datetime": [
            BASE + timedelta(hours=24),
            BASE + timedelta(hours=48),
            BASE + timedelta(hours=120),
        ],
        "comp": ["comp1", "comp2", "comp1"],
    })


@pytest.fixture
def failures_df():
    return pd.DataFrame({
        "machineID": [1, 2],
        "datetime": [
            BASE + timedelta(hours=72),
            BASE + timedelta(hours=144),
        ],
        "failure": ["comp2", "comp1"],
    })


@pytest.fixture
def raw_data(telemetry_df, machines_df, errors_df, maint_df, failures_df):
    return {
        "telemetry": telemetry_df,
        "machines": machines_df,
        "errors": errors_df,
        "maint": maint_df,
        "failures": failures_df,
    }
