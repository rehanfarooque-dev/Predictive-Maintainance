# tests/test_features.py
import pytest
import pandas as pd
from src.pdm.data_loader import build_base_dataframe
from src.pdm.features import (
    add_telemetry_rolling_features,
    add_error_rolling_features,
    add_maintenance_recency_features,
    add_machine_metadata_features,
    build_feature_matrix,
)


def test_telemetry_rolling_features_adds_correct_columns(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_telemetry_rolling_features(base_df, window_hours=[3, 12])
    assert "volt_mean_3h" in df.columns
    assert "rotate_std_12h" in df.columns
    assert "vibration_min_3h" in df.columns
    assert "pressure_max_12h" in df.columns


def test_telemetry_rolling_features_no_nan(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_telemetry_rolling_features(base_df, window_hours=[3])
    rolling_cols = [c for c in df.columns if "_mean_" in c or "_std_" in c]
    assert df[rolling_cols].isna().sum().sum() == 0


def test_error_rolling_features_adds_count_columns(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_error_rolling_features(base_df, raw_data["errors"], window_hours=[3])
    assert "error1_count_3h" in df.columns


def test_error_rolling_features_nonzero_at_error_time(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_error_rolling_features(base_df, raw_data["errors"], window_hours=[3])
    from datetime import datetime, timedelta
    BASE = datetime(2015, 1, 1)
    # Machine 1 had error1 at BASE+50h; the 3h window after should show count >= 1
    machine1_after_error = (df["machineID"] == 1) & (df["datetime"] == BASE + timedelta(hours=52))
    assert df.loc[machine1_after_error, "error1_count_3h"].values[0] >= 1


def test_maintenance_recency_adds_hours_since_columns(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_maintenance_recency_features(base_df, raw_data["maint"])
    assert "hours_since_comp1" in df.columns
    assert "hours_since_comp2" in df.columns


def test_maintenance_recency_increases_over_time(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_maintenance_recency_features(base_df, raw_data["maint"])
    machine1 = df[df["machineID"] == 1].sort_values("datetime")
    # After comp1 replacement at BASE+24h, hours_since_comp1 should increase each row
    after_maint = machine1[machine1["datetime"] > (machine1["datetime"].iloc[0] + pd.Timedelta(hours=24))]
    diffs = after_maint["hours_since_comp1"].diff().dropna()
    assert (diffs.head(10) >= 0).all()


def test_machine_metadata_one_hot_encodes_model(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = add_machine_metadata_features(base_df)
    assert any(c.startswith("model_") for c in df.columns)
    assert "model" not in df.columns


def test_build_feature_matrix_returns_no_nan_in_rolling_cols(raw_data):
    base_df = build_base_dataframe(raw_data)
    df = build_feature_matrix(base_df, raw_data["errors"], raw_data["maint"], window_hours=[3])
    rolling_cols = [c for c in df.columns if "_mean_" in c or "_count_" in c]
    assert df[rolling_cols].isna().sum().sum() == 0
