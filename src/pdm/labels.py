import pandas as pd


def make_labels(
    telemetry_df: pd.DataFrame,
    failures_df: pd.DataFrame,
    horizon_hours: int = 12,
) -> pd.Series:
    """
    Returns a binary Series aligned with telemetry_df.
    label[i] = 1 if a failure occurs within the next horizon_hours for that machine.
    """
    labels = pd.Series(0, index=telemetry_df.index, name="label", dtype=int)
    horizon = pd.Timedelta(hours=horizon_hours)

    for machine_id, machine_failures in failures_df.groupby("machineID"):
        machine_mask = telemetry_df["machineID"] == machine_id

        for failure_time in machine_failures["datetime"]:
            window_start = failure_time - horizon
            in_window = machine_mask & (
                (telemetry_df["datetime"] >= window_start)
                & (telemetry_df["datetime"] < failure_time)
            )
            labels.loc[in_window] = 1

    return labels
