"""Risk-score PdM: Weibull maintenance cycle per component (View 2, decision engine).

This is the maintenance DECISION model, deliberately separate from the RUL *forecast*:

  Step 1  Build every component LIFE: each replacement starts a life that ends at the next
          failure (observed, event=1) or the next replacement / end of study (censored,
          event=0).
  Step 2  Fit a 2-parameter Weibull PER COMPONENT to those lives WITH CENSORING. Censoring
          is essential — parts that ran a long time without failing (preventive replacement
          or still running) must count, or the characteristic life is biased far too short.
  Step 3  Cumulative hazard  H(t) = (t / lambda) ** rho.

Decision rule:  H(t) = 1  exactly when  t = lambda  (the characteristic life). So
"H crosses 1" means the part has reached its typical lifetime and should go for
maintenance. Because `t` = age since the last replacement, H automatically resets to 0
every time maintenance happens (the sawtooth).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd

COMP_COLS = ["comp1", "comp2", "comp3", "comp4"]
FAILURE_HAZARD = 1.0  # H at which the part has reached its characteristic life -> maintain


@dataclass(frozen=True)
class CompWeibull:
    comp: str
    shape: float        # rho  (> 1 => wear-out, hazard rises with age)
    scale: float        # lambda = characteristic life in DAYS (H = 1 at t = scale)
    n_lives: int        # number of component lives the fit was based on (incl. censored)

    def hazard(self, elapsed_days: float) -> float:
        """Cumulative hazard H(t) = (t / lambda) ** rho at the part's current age."""
        t = max(float(elapsed_days), 0.0)
        if t <= 0.0:
            return 0.0
        return float((t / self.scale) ** self.shape)


def fit_component_weibull(lives: pd.DataFrame) -> Dict[str, CompWeibull]:
    """Fit a 2-parameter Weibull per component on renewal lives WITH CENSORING.

    `lives` is the renewal-life table from `survival.build_renewal_lives`: one row per
    component life with `comp`, `duration_days`, and `event_observed` (1 = ended in a
    failure, 0 = censored: replaced preventively or still running at study end).

    Censoring is the whole point. Fitting only on failure-to-failure gaps discards every
    long-running part and biases the characteristic life far too short (e.g. comp3 → 97d
    instead of ~214d), which floods the fleet with false "overdue" flags. lifelines'
    `WeibullFitter` uses the censored observations correctly via the event flag.
    """
    from lifelines import WeibullFitter

    out: Dict[str, CompWeibull] = {}
    for comp in COMP_COLS:
        L = lives[lives["comp"] == comp]
        dur = L["duration_days"].to_numpy(dtype=float)
        evt = L["event_observed"].to_numpy(dtype=int)
        mask = dur > 0
        dur, evt = dur[mask], evt[mask]
        if len(dur) < 2 or int(evt.sum()) < 1:
            # Not enough observed failures to fit — neutral fallback.
            scale = float(dur.mean()) if len(dur) else 120.0
            out[comp] = CompWeibull(comp=comp, shape=1.0, scale=max(scale, 1.0), n_lives=len(dur))
            continue
        wf = WeibullFitter().fit(dur, evt)  # event flag carries the censoring
        out[comp] = CompWeibull(
            comp=comp,
            shape=float(wf.rho_),
            scale=float(wf.lambda_),
            n_lives=int(len(dur)),
        )
    return out


@dataclass
class MaintenanceDecision:
    comp: str
    elapsed_days: float          # age of the part since last replacement
    cycle_days: float            # lambda = characteristic life (H = 1 here)
    shape: float                 # rho
    hazard: float                # H(t) = risk score
    due: bool                    # H >= 1  => go for maintenance now
    days_until_due: float        # cycle_days - elapsed_days, floored at 0
    pct_of_life: float           # elapsed / cycle, 0..(>1)


def maintenance_decision(cw: CompWeibull, elapsed_days: float) -> MaintenanceDecision:
    """Turn the fitted Weibull + current part age into a maintenance decision.

    The decision is the H = 1 crossing (t = lambda), NOT a forecast: replace the part
    when its age reaches the component's characteristic life.
    """
    t = max(float(elapsed_days), 0.0)
    h = cw.hazard(t)
    return MaintenanceDecision(
        comp=cw.comp,
        elapsed_days=round(t, 1),
        cycle_days=round(cw.scale, 1),
        shape=round(cw.shape, 3),
        hazard=round(h, 3),
        due=bool(h >= FAILURE_HAZARD),
        days_until_due=round(max(0.0, cw.scale - t), 1),
        pct_of_life=round(t / cw.scale, 3) if cw.scale > 0 else 0.0,
    )


# --- (de)serialization for persisting the fitted params to disk ---

def comp_weibull_to_dict(params: Dict[str, CompWeibull]) -> dict:
    return {c: {"shape": cw.shape, "scale": cw.scale, "n_lives": cw.n_lives}
            for c, cw in params.items()}


def comp_weibull_from_dict(data: dict) -> Dict[str, CompWeibull]:
    return {c: CompWeibull(comp=c, shape=float(v["shape"]), scale=float(v["scale"]),
                           n_lives=int(v.get("n_lives", 0)))
            for c, v in data.items()}
