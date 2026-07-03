"""Matplotlib figure builders used by the dashboard.

Native Streamlit charts cover most needs, but failure-window shading and overlaid
threshold/as-of rules need matplotlib. Pure functions returning figures — no Streamlit
import — so pages just call ``st.pyplot(fig)``.

Failure windows are shaded directly from the ``label`` column (label == 1 marks the
horizon window before an actual failure), so no raw telemetry needs to be reloaded.
"""
from typing import Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


def _shade_failure_windows(ax, machine_df: pd.DataFrame, ymin: float, ymax: float):
    mask = machine_df["label"].to_numpy() == 1
    if mask.any():
        ax.fill_between(
            machine_df["datetime"], ymin, ymax, where=mask,
            color="red", alpha=0.2, step="mid", label="failure window",
        )


def sensor_trace(machine_df: pd.DataFrame, sensor: str):
    """Plot one sensor over time with the failure windows shaded red."""
    fig, ax = plt.subplots(figsize=(11, 2.6))
    series = machine_df[sensor]
    ax.plot(machine_df["datetime"], series, lw=0.7, color="steelblue")
    _shade_failure_windows(ax, machine_df, float(series.min()), float(series.max()))
    ax.set_ylabel(sensor)
    ax.set_xlabel("")
    if (machine_df["label"] == 1).any():
        ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    return fig


def risk_over_time(
    machine_df: pd.DataFrame,
    threshold: float,
    as_of: Optional[pd.Timestamp] = None,
):
    """Plot predicted failure risk over time with failure windows, threshold and as-of."""
    fig, ax = plt.subplots(figsize=(11, 2.8))
    ax.plot(machine_df["datetime"], machine_df["risk"], lw=0.8, color="darkorange")
    _shade_failure_windows(ax, machine_df, -0.02, 1.02)
    ax.axhline(threshold, color="red", linestyle="--", lw=1.0,
               label=f"threshold = {threshold:.2f}")
    if as_of is not None:
        ax.axvline(pd.Timestamp(as_of), color="black", linestyle=":", lw=1.2, label="as-of")
    ax.set_ylim(-0.02, 1.02)
    ax.set_ylabel("failure risk")
    ax.set_xlabel("")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    return fig
