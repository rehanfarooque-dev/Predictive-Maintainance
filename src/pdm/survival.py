"""Renewal-based survival analysis for Remaining Useful Life (View 2, part 2).

Models each component's lifetime as a renewal process: a "life" starts at a replacement
and ends either at the next failure (event observed) or the next replacement / end of data
(right-censored). A Weibull AFT model then predicts a covariate-conditioned lifetime, from
which we derive RUL (median residual life), a confidence band, a survival curve, and a
recommended service date.

Handles the dataset quirk that a failure is logged with a same-timestamp replacement: we
match each life-start to the next failure strictly AFTER it and drop non-positive durations,
so the failure/repair coincidence never creates a spurious zero-length life.

`lifelines` is imported lazily so importing this module is cheap and test-skippable.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# Covariates pulled from the engineered feature matrix at each life's start time.
COVARIATE_FEATURE_COLS = [
    "age",
    "volt_mean_24h", "rotate_mean_24h", "pressure_mean_24h", "vibration_mean_24h",
    "error1_count_24h", "error2_count_24h", "error3_count_24h",
    "error4_count_24h", "error5_count_24h",
]
RUL_CAP_DAYS = 365.0


@dataclass
class RULResult:
    rul_days: float
    rul_ci_low_days: float
    rul_ci_high_days: float
    is_capped: bool


def build_renewal_lives(
    maint_df: pd.DataFrame, failures_df: pd.DataFrame, study_end
) -> pd.DataFrame:
    """Construct per-(machine, component) lifetimes with censoring.

    Each replacement starts a life; it ends at the next same-component failure (event=1)
    or the next replacement / study_end (censored=0). Durations <= 0 are dropped.
    """
    study_end = pd.Timestamp(study_end)
    fails_all = failures_df.rename(columns={"failure": "comp"})

    rows: List[dict] = []
    for (machine_id, comp), starts_g in maint_df.groupby(["machineID", "comp"]):
        starts = np.sort(starts_g["datetime"].unique())
        fmask = (fails_all["machineID"] == machine_id) & (fails_all["comp"] == comp)
        fails = np.sort(fails_all.loc[fmask, "datetime"].unique())

        for s64 in starts:
            s = pd.Timestamp(s64)
            future_fails = fails[fails > s64]
            future_starts = starts[starts > s64]
            next_fail = pd.Timestamp(future_fails[0]) if len(future_fails) else None
            next_start = pd.Timestamp(future_starts[0]) if len(future_starts) else None

            if next_fail is not None and (next_start is None or next_fail <= next_start):
                end, event = next_fail, 1
            elif next_start is not None:
                end, event = min(next_start, study_end), 0
            else:
                end, event = study_end, 0

            duration_hours = (end - s).total_seconds() / 3600.0
            if duration_hours <= 0:
                continue
            rows.append({
                "machineID": machine_id,
                "comp": comp,
                "start": s,
                "end": end,
                "duration_hours": duration_hours,
                "duration_days": duration_hours / 24.0,
                "event_observed": int(event),
            })

    return pd.DataFrame(rows)


def attach_life_covariates(
    lives_df: pd.DataFrame, feature_df: pd.DataFrame
) -> Tuple[pd.DataFrame, List[str]]:
    """Join causally-prior covariates (as of each life's start) and add a comp one-hot.

    Returns (survival_df, covariate_cols). Missing covariates (lives starting before
    telemetry begins) are filled with the column median so lifelines sees no NaNs.
    """
    model_cols = [c for c in feature_df.columns if c.startswith("model_")]
    feat_cols = [c for c in COVARIATE_FEATURE_COLS if c in feature_df.columns] + model_cols
    right = feature_df[["machineID", "datetime"] + feat_cols].sort_values("datetime")
    left = lives_df.sort_values("start").reset_index(drop=True)

    merged = pd.merge_asof(
        left, right, left_on="start", right_on="datetime",
        by="machineID", direction="backward",
    )

    comp_dummies = pd.get_dummies(merged["comp"], prefix="comp")
    out = pd.concat([merged, comp_dummies], axis=1)

    covariate_cols = feat_cols + list(comp_dummies.columns)
    for col in covariate_cols:
        out[col] = out[col].astype(float)
        if out[col].isna().any():
            out[col] = out[col].fillna(out[col].median())
    return out, covariate_cols


def fit_weibull_aft(
    survival_df: pd.DataFrame,
    covariate_cols: List[str],
    duration_col: str = "duration_days",
    event_col: str = "event_observed",
    penalizer: float = 0.05,
):
    """Fit a Weibull AFT model. Returns (fitted_model, used_covariate_cols).

    Zero-variance covariates are dropped (they break the fit and carry no information).
    """
    from lifelines import WeibullAFTFitter

    used = [c for c in covariate_cols if survival_df[c].std(ddof=0) > 1e-9]
    df = survival_df[used + [duration_col, event_col]].copy()
    aft = WeibullAFTFitter(penalizer=penalizer)
    aft.fit(df, duration_col=duration_col, event_col=event_col)
    return aft, used


def fit_kaplan_meier(
    survival_df: pd.DataFrame,
    by: Optional[str] = None,
    duration_col: str = "duration_days",
    event_col: str = "event_observed",
) -> Dict[str, object]:
    """Covariate-free baseline survival curves (overall, or one per `by` value)."""
    from lifelines import KaplanMeierFitter

    result: Dict[str, object] = {}
    if by is None:
        result["all"] = KaplanMeierFitter().fit(
            survival_df[duration_col], survival_df[event_col]
        )
    else:
        for value, g in survival_df.groupby(by):
            result[str(value)] = KaplanMeierFitter().fit(
                g[duration_col], g[event_col]
            )
    return result


def align_covariates(values: dict, covariate_cols: List[str]) -> pd.DataFrame:
    """Build a 1-row covariate frame in the model's column order (missing → 0)."""
    return pd.DataFrame([{c: float(values.get(c, 0.0)) for c in covariate_cols}])


def _conditional_survival(
    aft, X: pd.DataFrame, elapsed_days: float, max_days: float, step: float = 0.5
) -> Tuple[np.ndarray, np.ndarray]:
    """Conditional survival S(elapsed + t | survived elapsed) on a fine grid of t (days)."""
    times = np.arange(0.0, elapsed_days + max_days + step, step)
    sf = aft.predict_survival_function(X, times=times)
    s = sf.iloc[:, 0].to_numpy()
    s_elapsed = max(float(np.interp(elapsed_days, times, s)), 1e-9)
    ahead = np.arange(0.0, max_days + step, step)
    cond = np.clip(np.interp(elapsed_days + ahead, times, s) / s_elapsed, 0.0, 1.0)
    return ahead, cond


def _invert(ahead: np.ndarray, cond: np.ndarray, level: float) -> Tuple[float, bool]:
    """Smallest days-ahead where conditional survival drops to `level`; capped flag."""
    below = cond <= level
    if not below.any():
        return float(ahead[-1]), True  # never crosses within horizon → capped
    return float(ahead[int(np.argmax(below))]), False


def predict_rul(
    aft, X: pd.DataFrame, elapsed_days: float, ci: float = 0.50,
    rul_cap_days: float = RUL_CAP_DAYS,
) -> RULResult:
    """Median residual life + a "typical range" from the conditional survival curve.

    With the default ci=0.50 the band is the INTERQUARTILE range, which is what a planner
    actually wants to see: rul_low = the day by which 25% of comparable lives have ended
    (early end of the typical range), rul_med = 50% (the headline estimate), rul_high = 75%
    (late end). A wider ci stretches the band toward the rare best/worst-case tails (e.g.
    ci=0.90 gives the 5th-95th percentile, which is so wide it's not decision-useful).
    Ordering rul_low <= median <= rul_high is guaranteed since survival is decreasing.
    """
    ahead, cond = _conditional_survival(aft, X, float(elapsed_days), rul_cap_days)
    lo_level = 1.0 - (1.0 - ci) / 2.0   # ci=0.50 -> 0.75 (25% have failed by rul_low)
    hi_level = (1.0 - ci) / 2.0         # ci=0.50 -> 0.25 (75% have failed by rul_high)
    rul_low, _ = _invert(ahead, cond, lo_level)
    rul_med, capped_med = _invert(ahead, cond, 0.5)
    rul_high, _ = _invert(ahead, cond, hi_level)
    return RULResult(
        rul_days=round(rul_med, 1),
        rul_ci_low_days=round(rul_low, 1),
        rul_ci_high_days=round(rul_high, 1),
        is_capped=capped_med,
    )


def cumulative_hazard(aft, X: pd.DataFrame, elapsed_days: float) -> float:
    """Covariate-adjusted Weibull cumulative hazard H(t) at the part's current age.

    H(t) = -ln S(t) is accumulated failure "damage": H = 0 at install, H = 1 at the
    characteristic life (where cumulative failure probability reaches 1 - e^-1 = 63.2%),
    and it keeps climbing past 1 as the part ages further. A part with H >= 1 is treated
    as end-of-life. Because the fitted Weibull scale is shifted by the machine's covariates
    (sensor levels, error counts, age), a unit in worse condition accumulates hazard faster
    and crosses 1 sooner. Read straight from the fitted lifelines model — no extrapolation.
    """
    t = max(float(elapsed_days), 0.0)
    if t <= 0.0:
        return 0.0
    ch = aft.predict_cumulative_hazard(X, times=[t])
    return max(float(np.asarray(ch)[0, 0]), 0.0)


def survival_curve_points(
    aft, X: pd.DataFrame, elapsed_days: float,
    horizon_days: float = 180.0, step_days: float = 2.0,
) -> List[dict]:
    """Conditional survival curve for the drill-down chart: [{days_ahead, survival_prob}]."""
    ahead, cond = _conditional_survival(aft, X, float(elapsed_days), horizon_days, step_days)
    return [
        {"days_ahead": float(t), "survival_prob": round(float(p), 4)}
        for t, p in zip(ahead, cond)
    ]


def classifier_implied_days(prob: float, horizon_days: float = 0.5) -> float:
    """Turn the 12h failure-probability into an implied time-to-failure (days).

    The classifier answers "P(fail within the horizon)". Treating failure as a constant-
    hazard process over that short window, the implied median time-to-failure is
    `horizon * ln2 / -ln(1 - p)`: p≈1 → ~half a horizon away, p small → far away, p=0 → never.
    This lets an acute fault the classifier sees (but the slow wear-out model misses) pull the
    service date forward. Returns +inf when prob is 0.
    """
    p = min(max(float(prob), 0.0), 0.999)
    if p <= 0.0:
        return float("inf")
    return horizon_days * float(np.log(2.0)) / float(-np.log(1.0 - p))


def rul_to_service_date(
    as_of, rul_days: float, rul_ci_low_days: float,
    classifier_prob: float = 0.0, threshold: float = 1.0,
    horizon_days: float = 0.5, lead_time_days: float = 3.0,
) -> dict:
    """Translate BOTH failure signals into a service date + plain-language urgency.

    Two independent things can end a machine's run:
      • slow wear-out — captured by the survival model (`rul_ci_low_days`, the day by which
        ~1 in 4 comparable machines have already failed);
      • an acute fault — captured by the 12h classifier (`classifier_prob`).
    We act on whichever is sooner: the effective "early failure" day is the minimum of the
    survival lower bound and the classifier-implied time-to-failure, minus a maintenance lead
    time. If the classifier actively flags the machine (`prob >= threshold`) it is due now, so
    the urgency map and the "fails within 12h" headline can never disagree. `rul_days` (the
    median wear-out life) is kept for the time-left display.
    """
    as_of = pd.Timestamp(as_of)
    effective_low = min(float(rul_ci_low_days), classifier_implied_days(classifier_prob, horizon_days))
    days_until = max(0.0, effective_low - lead_time_days)
    if float(classifier_prob) >= float(threshold):
        days_until = 0.0  # model says it fails within the horizon → service now
    service_date = as_of + pd.Timedelta(days=days_until)

    if days_until <= 0:
        urgency = "overdue"
    elif days_until < 7:
        urgency = "urgent"
    elif days_until < 30:
        urgency = "soon"
    else:
        urgency = "planned"

    return {
        "recommended_service_date": service_date,
        "days_until_service": round(days_until, 1),
        "urgency": urgency,
    }
