# tests/test_data_loader.py
import pytest
from src.pdm.data_loader import build_base_dataframe


def test_build_base_dataframe_has_all_telemetry_rows(raw_data):
    base_df = build_base_dataframe(raw_data)
    # 2 machines × 240 hours each
    assert len(base_df) == 480


def test_build_base_dataframe_joins_machine_metadata(raw_data):
    base_df = build_base_dataframe(raw_data)
    assert "model" in base_df.columns
    assert "age" in base_df.columns


def test_build_base_dataframe_has_correct_machine_ages(raw_data):
    base_df = build_base_dataframe(raw_data)
    assert base_df[base_df["machineID"] == 1]["age"].iloc[0] == 5
    assert base_df[base_df["machineID"] == 2]["age"].iloc[0] == 3


def test_build_base_dataframe_sorted_by_machine_and_time(raw_data):
    base_df = build_base_dataframe(raw_data)
    for machine_id in [1, 2]:
        machine_times = base_df[base_df["machineID"] == machine_id]["datetime"]
        assert machine_times.is_monotonic_increasing
