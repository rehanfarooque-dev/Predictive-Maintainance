from typing import List
import numpy as np
import pandas as pd

TELEMETRY_COLS = ["volt", "rotate", "pressure", "vibration"]
COMP_COLS = ["comp1", "comp2", "comp3", "comp4"]


def add_telemetry_rolling_features(df: pd.DataFrame, window_hours: List[int]) -> pd.DataFrame:
    df = df.copy().sort_values(["machineID", "datetime"])
    for window in window_hours:
        for col in TELEMETRY_COLS:
            grouped = df.groupby("machineID")[col]
            df[f"{col}_mean_{window}h"] = grouped.transform(
                lambda x, w=window: x.rolling(w, min_periods=1).mean()
            )
            df[f"{col}_std_{window}h"] = grouped.transform(
                lambda x, w=window: x.rolling(w, min_periods=1).std().fillna(0)
            )
            df[f"{col}_min_{window}h"] = grouped.transform(
                lambda x, w=window: x.rolling(w, min_periods=1).min()
            )
            df[f"{col}_max_{window}h"] = grouped.transform(
                lambda x, w=window: x.rolling(w, min_periods=1).max()
            )
    return df


def add_error_rolling_features(
    df: pd.DataFrame, errors_df: pd.DataFrame, window_hours: List[int]
) -> pd.DataFrame:
    df = df.copy().sort_values(["machineID", "datetime"])

    # One-hot encode errorID then aggregate to hourly counts per machine
    ohe = pd.get_dummies(
        errors_df[["machineID", "datetime", "errorID"]], columns=["errorID"]
    )
    error_indicator_cols = [c for c in ohe.columns if c.startswith("errorID_")]
    hourly = (
        ohe.groupby(["machineID", "datetime"])[error_indicator_cols].sum().reset_index()
    )
    hourly.columns = ["machineID", "datetime"] + [
        c.replace("errorID_", "") for c in error_indicator_cols
    ]

    actual_error_cols = [c for c in hourly.columns if c not in ["machineID", "datetime"]]
    df = df.merge(hourly, on=["machineID", "datetime"], how="left")
    for col in actual_error_cols:
        df[col] = df[col].fillna(0)

    for window in window_hours:
        for col in actual_error_cols:
            df[f"{col}_count_{window}h"] = df.groupby("machineID")[col].transform(
                lambda x, w=window: x.rolling(w, min_periods=1).sum()
            )

    df = df.drop(columns=actual_error_cols, errors="ignore")
    return df


def add_maintenance_recency_features(
    df: pd.DataFrame, maint_df: pd.DataFrame
) -> pd.DataFrame:
    df = df.copy().sort_values(["machineID", "datetime"])
    for comp in COMP_COLS:
        comp_events = (
            maint_df[maint_df["comp"] == comp][["machineID", "datetime"]]
            .sort_values(["machineID", "datetime"])
            .rename(columns={"datetime": f"last_{comp}"})
        )
        # merge_asof requires both DataFrames sorted by the 'on' key (datetime)
        df_sorted = df[["machineID", "datetime"]].sort_values("datetime")
        comp_events_sorted = comp_events.sort_values(f"last_{comp}")
        merged = pd.merge_asof(
            df_sorted,
            comp_events_sorted,
            left_on="datetime",
            right_on=f"last_{comp}",
            by="machineID",
            direction="backward",
        )
        # Re-align merged result to df index order
        merged = merged.set_index(df_sorted.index)
        hours_since = (
            df["datetime"] - merged[f"last_{comp}"]
        ).dt.total_seconds() / 3600
        df[f"hours_since_{comp}"] = hours_since.fillna(8760)  # 1 year if no record
    return df


def add_machine_metadata_features(df: pd.DataFrame) -> pd.DataFrame:
    return pd.get_dummies(df, columns=["model"], prefix="model", drop_first=False)


def build_feature_matrix(
    base_df: pd.DataFrame,
    errors_df: pd.DataFrame,
    maint_df: pd.DataFrame,
    window_hours: List[int],
) -> pd.DataFrame:
    df = add_telemetry_rolling_features(base_df, window_hours)
    df = add_error_rolling_features(df, errors_df, window_hours)
    df = add_maintenance_recency_features(df, maint_df)
    df = add_machine_metadata_features(df)
    return df
