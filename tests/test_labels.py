# tests/test_labels.py
import pytest
import pandas as pd
from datetime import datetime, timedelta
from src.pdm.labels import make_labels

BASE = datetime(2015, 1, 1)


def test_make_labels_marks_window_before_failure(telemetry_df, failures_df):
    labels = make_labels(telemetry_df, failures_df, horizon_hours=12)
    # Machine 1 failure at BASE+72h. Window: [BASE+60h, BASE+72h)
    machine1 = telemetry_df["machineID"] == 1
    failure_time = BASE + timedelta(hours=72)
    window_start = failure_time - timedelta(hours=12)
    in_window = (
        machine1
        & (telemetry_df["datetime"] >= window_start)
        & (telemetry_df["datetime"] < failure_time)
    )
    assert labels[in_window].all() == True
    assert labels[in_window].sum() == 12


def test_make_labels_zeros_outside_window(telemetry_df, failures_df):
    labels = make_labels(telemetry_df, failures_df, horizon_hours=12)
    machine1 = telemetry_df["machineID"] == 1
    failure_time = BASE + timedelta(hours=72)
    window_start = failure_time - timedelta(hours=12)
    outside = machine1 & ~(
        (telemetry_df["datetime"] >= window_start)
        & (telemetry_df["datetime"] < failure_time)
    )
    assert labels[outside & machine1].sum() == 0


def test_make_labels_configurable_horizon(telemetry_df, failures_df):
    labels_12 = make_labels(telemetry_df, failures_df, horizon_hours=12)
    labels_24 = make_labels(telemetry_df, failures_df, horizon_hours=24)
    assert labels_24.sum() > labels_12.sum()


def test_make_labels_length_matches_telemetry(telemetry_df, failures_df):
    labels = make_labels(telemetry_df, failures_df, horizon_hours=12)
    assert len(labels) == len(telemetry_df)
