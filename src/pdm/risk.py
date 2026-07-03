"""Cumulative-hazard risk score (View 2, part 1).

The risk score is the fitted Weibull model's **cumulative hazard** H(t) at the part's
current age, expressed as a 0-100 percentage of the failure threshold. H accumulates
failure "damage": H = 0 at install, H = 1 at the characteristic life (63.2% cumulative
failure probability) -> that is the FAILURE point (risk score 100). Since H is
covariate-adjusted, a machine in worse condition accumulates hazard faster.

This module also derives per-`model` normal sensor bands (used for the drill-down sensor
breakdown, not for the score). Pure module (no I/O); the cumulative hazard itself is read
from the fitted lifelines model in `src.pdm.survival`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Mapping, Optional

import pandas as pd

from src.pdm.scoring import SENSOR_COLS


@dataclass(frozen=True)
class SensorBand:
    sensor: str
    lower: float
    upper: float
    p50: float
    mean: float
    std: float

    @property
    def width(self) -> float:
        # Guard against zero-width bands (constant sensor) so normalization is safe.
        return max(self.upper - self.lower, 1e-9)


FAILURE_HAZARD = 1.0  # cumulative hazard at which a part is considered failed (characteristic life)


@dataclass
class RiskScoreResult:
    risk_score: float            # = raw Weibull cumulative hazard H(t); >= 1.0 => end of life
    at_end_of_life: bool         # risk_score >= FAILURE_HAZARD (1.0)
    violation_count: int         # sensors outside their band right now (context only)
    violation_severity: float    # 0-100 sensor-anomaly severity (context only, not in score)
    top_sensors: List[dict]      # [{sensor, value, exceedance}] worst-first


def compute_normal_bands(
    train_df: pd.DataFrame,
    sensors: List[str] = SENSOR_COLS,
    lower_pct: float = 1.0,
    upper_pct: float = 99.0,
    healthy_only: bool = True,
) -> Dict[str, Dict[str, SensorBand]]:
    """Per-`model` normal operating bands from the (healthy) training slice.

    The four machine models have different nominal operating points, and a single machine
    has too few healthy hours for stable tails, so bands are pooled per model. Percentile
    bands (p1/p99) are robust to the dataset's heavy tails.
    """
    df = train_df
    if healthy_only and "label" in df.columns:
        df = df[df["label"] == 0]

    bands: Dict[str, Dict[str, SensorBand]] = {}
    for model, g in df.groupby("model", observed=True):
        bands[str(model)] = {
            s: SensorBand(
                sensor=s,
                lower=float(g[s].quantile(lower_pct / 100.0)),
                upper=float(g[s].quantile(upper_pct / 100.0)),
                p50=float(g[s].median()),
                mean=float(g[s].mean()),
                std=float(g[s].std(ddof=0)),
            )
            for s in sensors
        }
    return bands


def sensor_violations(
    values: Mapping[str, float], bands: Dict[str, SensorBand]
) -> pd.DataFrame:
    """Per-sensor violation table for one reading against its model's bands.

    `exceedance` = absolute distance outside [lower, upper] (0 if in band);
    `normalized_exceedance` = exceedance / band width (comparable across sensors).
    """
    rows = []
    for sensor, band in bands.items():
        value = float(values[sensor])
        exceedance = max(0.0, value - band.upper) + max(0.0, band.lower - value)
        rows.append({
            "sensor": sensor,
            "value": value,
            "lower": band.lower,
            "upper": band.upper,
            "p50": band.p50,
            "in_band": exceedance == 0.0,
            "exceedance": exceedance,
            "normalized_exceedance": exceedance / band.width,
        })
    return pd.DataFrame(rows)


def compute_risk_score(
    hazard: float,
    violations: Optional[pd.DataFrame] = None,
    failure_hazard: float = FAILURE_HAZARD,
    count_weight: float = 0.5,
    magnitude_weight: float = 0.5,
    magnitude_scale: float = 1.0,
) -> RiskScoreResult:
    """Risk score = the raw Weibull cumulative hazard `H(t)`.

        risk_score = H(t)

    H = 0 for a fresh part and climbs with age/condition. H = failure_hazard (default 1.0,
    the characteristic life = 63.2% cumulative failure probability) is the FAILURE point;
    at or beyond it `at_end_of_life` is True. Because H is covariate-adjusted (from
    `survival.cumulative_hazard`), a machine in worse condition accumulates hazard faster
    and crosses 1.0 sooner — no hand-tuned blend of signals needed.

    `violations` (optional) is summarised for the drill-down sensor breakdown only; it does
    NOT change the score. The imminent-failure classifier is reported separately (View 1).
    """
    h = max(float(hazard), 0.0)
    risk_score = h  # raw cumulative hazard; 1.0 is the failure threshold

    if violations is not None and len(violations):
        violating = violations[~violations["in_band"]]
        violation_count = int(len(violating))
        n_sensors = max(len(violations), 1)
        frac_violating = violation_count / n_sensors
        total_norm_exceed = float(violating["normalized_exceedance"].sum())
        squashed_magnitude = 1.0 - math.exp(-total_norm_exceed / magnitude_scale)
        violation_severity = 100.0 * (
            count_weight * frac_violating + magnitude_weight * squashed_magnitude
        )
        top = (
            violating.sort_values("exceedance", ascending=False)
            [["sensor", "value", "exceedance"]]
            .head(3)
            .to_dict("records")
        )
    else:
        violation_count, violation_severity, top = 0, 0.0, []

    return RiskScoreResult(
        risk_score=round(risk_score, 3),
        at_end_of_life=bool(h >= failure_hazard),
        violation_count=violation_count,
        violation_severity=round(violation_severity, 2),
        top_sensors=top,
    )


# --- JSON (de)serialization for persisting bands to disk ---

def bands_to_dict(bands: Dict[str, Dict[str, SensorBand]]) -> dict:
    return {
        model: {s: vars(band) for s, band in model_bands.items()}
        for model, model_bands in bands.items()
    }


def bands_from_dict(data: dict) -> Dict[str, Dict[str, SensorBand]]:
    return {
        model: {s: SensorBand(**band) for s, band in model_bands.items()}
        for model, model_bands in data.items()
    }
