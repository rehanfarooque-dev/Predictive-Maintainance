from pathlib import Path
import pandas as pd


def load_raw_data(raw_dir: str) -> dict:
    p = Path(raw_dir)
    return {
        "telemetry": pd.read_csv(p / "PdM_telemetry.csv", parse_dates=["datetime"]),
        "machines": pd.read_csv(p / "PdM_machines.csv"),
        "errors": pd.read_csv(p / "PdM_errors.csv", parse_dates=["datetime"]),
        "maint": pd.read_csv(p / "PdM_maint.csv", parse_dates=["datetime"]),
        "failures": pd.read_csv(p / "PdM_failures.csv", parse_dates=["datetime"]),
    }


def build_base_dataframe(data: dict) -> pd.DataFrame:
    df = (
        data["telemetry"]
        .sort_values(["machineID", "datetime"])
        .reset_index(drop=True)
        .copy()
    )
    df = df.merge(data["machines"], on="machineID", how="left")
    return df
