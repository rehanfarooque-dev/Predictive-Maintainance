"""Hybrid PdM: Weibull recurrence model on CLASSIFIER surrogate events.

Instead of fitting the Weibull to actual failures, this fits it to *surrogate events* —
the timestamps at which the 12h classifier first flags a machine (a "pre-failure state").
It estimates the RECURRENCE of imminent-failure alarms, giving a continuous risk score
between alarms.

Design decisions that make it defensible (see reliability-engineering review):

  • Debounced events. A raw threshold is autocorrelated (a flagged hour is flagged for many
    hours). An event fires only on the FIRST positive after the classifier has been quiet
    (below threshold) for `cooldown_hours` — so one physical episode = one event.
  • Censoring. Each machine's time from its last event to the study end is a right-censored
    observation (the alarm has not recurred yet), fed to the Weibull fit — not dropped.
  • Validation. `validate_surrogate` measures whether surrogate events actually precede real
    failures (precision/recall + lead time), so the recurrence signal is checked against
    ground truth rather than trusted blindly.

This AUGMENTS the failure-gap model (src/pdm/maintenance.py); it does not replace it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class SurrogateWeibull:
    shape: float          # rho
    scale: float          # lambda = typical days between classifier alarm states
    n_events: int         # number of surrogate events used
    n_censored: int       # machines still "quiet" at study end (censored tails)
    threshold: float      # classifier threshold that defined an event
    cooldown_hours: int   # quiet period required before a new event can fire

    def hazard(self, days_since_last_event: float) -> float:
        """H(t) = (t / scale) ** shape — recurrence risk since the last alarm state."""
        t = max(float(days_since_last_event), 0.0)
        if t <= 0.0 or self.scale <= 0.0:
            return 0.0
        return float((t / self.scale) ** self.shape)


def build_surrogate_events(
    scored: pd.DataFrame,
    threshold: float = 0.5,
    cooldown_hours: int = 24,
    risk_col: str = "risk",
) -> Dict[int, List[pd.Timestamp]]:
    """Per-machine debounced surrogate-event timestamps.

    An event = the first hour the classifier probability crosses `threshold` after having
    stayed below it for at least `cooldown_hours` consecutive hours (debounce), so a single
    multi-hour alarm episode yields exactly one event.
    """
    df = scored[["machineID", "datetime", risk_col]].copy()
    df["datetime"] = pd.to_datetime(df["datetime"])
    events: Dict[int, List[pd.Timestamp]] = {}
    for mid, g in df.sort_values("datetime").groupby("machineID"):
        ev: List[pd.Timestamp] = []
        below = cooldown_hours  # start "ready" so the first alarm counts
        for dt, r in zip(g["datetime"], g[risk_col]):
            if r >= threshold:
                if below >= cooldown_hours:
                    ev.append(pd.Timestamp(dt))
                below = 0
            else:
                below += 1
        events[int(mid)] = ev
    return events


def fit_surrogate_weibull(
    scored: pd.DataFrame,
    study_end,
    threshold: float = 0.5,
    cooldown_hours: int = 24,
) -> SurrogateWeibull:
    """Fit a 2-parameter Weibull to inter-alarm gaps, with right-censored tails.

    durations = gaps between consecutive surrogate events (event_observed = 1) PLUS, per
    machine, the time from its last event to `study_end` (event_observed = 0, censored).
    """
    from lifelines import WeibullFitter

    events = build_surrogate_events(scored, threshold, cooldown_hours)
    study_end = pd.Timestamp(study_end)

    durations: List[float] = []
    observed: List[int] = []
    n_events = 0
    n_censored = 0
    for _mid, ev in events.items():
        if not ev:
            continue
        for i in range(len(ev) - 1):
            d = (ev[i + 1] - ev[i]) / np.timedelta64(1, "D")
            if d > 0:
                durations.append(float(d))
                observed.append(1)
                n_events += 1
        # censored tail from the last event to the end of the study
        tail = (study_end - ev[-1]) / np.timedelta64(1, "D")
        if tail > 0:
            durations.append(float(tail))
            observed.append(0)
            n_censored += 1

    dur = np.asarray(durations, dtype=float)
    obs = np.asarray(observed, dtype=int)
    if len(dur) < 2 or obs.sum() < 2:
        # Not enough recurrences to fit — fall back to a neutral cycle.
        mean = float(dur[obs == 1].mean()) if (obs == 1).any() else 30.0
        return SurrogateWeibull(1.0, max(mean, 1.0), int(obs.sum()), n_censored, threshold, cooldown_hours)

    wf = WeibullFitter().fit(dur, obs)
    return SurrogateWeibull(
        shape=float(wf.rho_),
        scale=float(wf.lambda_),
        n_events=int(obs.sum()),
        n_censored=n_censored,
        threshold=threshold,
        cooldown_hours=cooldown_hours,
    )


def days_since_last_event(events: List[pd.Timestamp], as_of) -> float:
    """Days from the most recent surrogate event at/​before `as_of` (inf if none yet)."""
    as_of = pd.Timestamp(as_of)
    prior = [e for e in events if e <= as_of]
    if not prior:
        return float("inf")
    return float((as_of - prior[-1]) / np.timedelta64(1, "D"))


def validate_surrogate(
    scored: pd.DataFrame,
    failures: pd.DataFrame,
    threshold: float = 0.5,
    cooldown_hours: int = 24,
    window_days: float = 30.0,
) -> dict:
    """Check surrogate events against ground-truth failures.

    precision = fraction of surrogate events followed by a real failure within `window_days`.
    recall    = fraction of real failures preceded by a surrogate event within `window_days`.
    median_lead_hours = typical lead time from a surrogate event to the failure it precedes.
    """
    events = build_surrogate_events(scored, threshold, cooldown_hours)
    f = failures.copy()
    f["datetime"] = pd.to_datetime(f["datetime"])
    fail_by_machine = {int(m): list(pd.to_datetime(g["datetime"]))
                       for m, g in f.groupby("machineID")}

    win = np.timedelta64(int(window_days * 24), "h")
    n_ev = 0
    ev_hit = 0
    leads: List[float] = []
    for mid, ev in events.items():
        fails = fail_by_machine.get(mid, [])
        for e in ev:
            n_ev += 1
            nxt = [ (pd.Timestamp(fl) - e) for fl in fails if pd.Timestamp(fl) >= e and (pd.Timestamp(fl) - e) <= win ]
            if nxt:
                ev_hit += 1
                leads.append(min(nxt) / np.timedelta64(1, "h"))

    n_fail = 0
    fail_hit = 0
    for mid, fails in fail_by_machine.items():
        ev = events.get(mid, [])
        for fl in fails:
            n_fail += 1
            prior = [ (pd.Timestamp(fl) - e) for e in ev if e <= pd.Timestamp(fl) and (pd.Timestamp(fl) - e) <= win ]
            if prior:
                fail_hit += 1

    return {
        "threshold": threshold,
        "cooldown_hours": cooldown_hours,
        "window_days": window_days,
        "n_surrogate_events": n_ev,
        "n_failures": n_fail,
        "precision": round(ev_hit / n_ev, 3) if n_ev else 0.0,
        "recall": round(fail_hit / n_fail, 3) if n_fail else 0.0,
        "median_lead_hours": round(float(np.median(leads)), 1) if leads else None,
    }


# --- (de)serialization ---

def surrogate_to_dict(s: SurrogateWeibull) -> dict:
    return {"shape": s.shape, "scale": s.scale, "n_events": s.n_events,
            "n_censored": s.n_censored, "threshold": s.threshold, "cooldown_hours": s.cooldown_hours}


def surrogate_from_dict(d: dict) -> SurrogateWeibull:
    return SurrogateWeibull(
        shape=float(d["shape"]), scale=float(d["scale"]), n_events=int(d.get("n_events", 0)),
        n_censored=int(d.get("n_censored", 0)), threshold=float(d.get("threshold", 0.5)),
        cooldown_hours=int(d.get("cooldown_hours", 24)),
    )
