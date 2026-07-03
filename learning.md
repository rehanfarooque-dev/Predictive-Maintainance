# Predictive Maintenance — Complete Learning Guide

A from-scratch, concept-by-concept explanation of this whole project: the data, the maths,
the models, the dashboard, and **every term** (SHAP, Weibull, AUC-PR, censoring, …) with
**what it is · why we use it · how it works · where it lives in the code**.

## Contents
1. The problem & the big idea
2. The dataset (the 5 CSVs) & data types
3. The end-to-end pipeline (architecture)
4. Feature engineering & derived features
5. Labels & the 12-hour horizon
6. Data leakage (and how we avoid it)
7. Train/test split & cross-validation (TimeSeriesSplit)
8. Class imbalance
9. The model: Decision Trees → Gradient Boosting → **XGBoost**
10. Hyperparameter tuning: **Optuna** (Bayesian / TPE)
11. **SHAP** — explainability (deep dive)
12. Feature selection (2 passes)
13. Evaluation: precision, recall, F1, **ROC/AUC-ROC**, **PR/AUC-PR**, confusion matrix
14. The **threshold** (alert sensitivity)
15. The **risk score** (bands + violations) with worked example
16. **Survival analysis & RUL** — censoring, hazard, **Weibull**, **AFT**, Kaplan-Meier (deep dive)
17. Generated artifacts
18. Backend (FastAPI)
19. Frontend (Next.js dashboard) & every chart's axes
20. Caveats
21. Glossary

---

## 1. The problem & the big idea

**Predictive maintenance (PdM)** = predict a machine failure *before* it happens so you can
service it just in time.

Three maintenance strategies:
- **Reactive** — fix it after it breaks (cheapest to plan, most expensive in downtime).
- **Preventive** — service on a fixed calendar (wastes parts that were still fine).
- **Predictive** — watch the machine, predict trouble, act just before failure. ← this project.

This system answers two questions for every machine, at any chosen moment:
1. **Will it fail soon?** → a probability of failure within the next 12 hours (*classification*).
2. **When should we service it?** → days of life left + a recommended date (*survival / RUL*).

---

## 2. The dataset (the 5 CSVs) & data types — `data/raw/`

Real CSV files (the Microsoft Azure PdM dataset — *simulated* data, real files). 100 machines,
one year (2015) of hourly readings = 876,100 telemetry rows. Everything joins on
**machineID** + **datetime**.

| File | Columns | One row = | Data type | Rows |
|---|---|---|---|---|
| `PdM_telemetry.csv` | datetime, machineID, **volt, rotate, pressure, vibration** | one machine-hour of sensor readings | continuous numeric time series | 876,100 |
| `PdM_errors.csv` | datetime, machineID, **errorID** (error1–5) | a non-fatal warning event | categorical events | 3,919 |
| `PdM_maint.csv` | datetime, machineID, **comp** (comp1–4) | a component replacement | categorical events | 3,286 |
| `PdM_failures.csv` | datetime, machineID, **failure** (comp1–4) | an actual breakdown — **the target** | categorical events | 761 |
| `PdM_machines.csv` | machineID, **model** (model1–4), **age** | static machine info | categorical + integer | 100 |

**Data interpretation**
- telemetry = the continuous "heartbeat."
- errors / maint / failures = sparse, timestamped events.
- machines = fixed metadata.
- **failures is the answer key** — used only to make labels & survival events, never as input.

**The data quirk (important later):** failures are stamped at daily resolution (~06:00), and
each failure is logged with a *same-timestamp* component replacement.

---

## 3. The end-to-end pipeline (architecture)

```
5 CSVs ─► load+join ─► features (~76, backward-looking) ─► keep top 20
                                  │
   failures.csv ─► labels (fail within 12h?)              │
                                  │                        │
                       chronological 80/20 split           │
        ┌─────────────────────────┼────────────────────────────────────┐
        ▼                         ▼                                      ▼
  XGBoost classifier      sensor bands + risk score            Weibull survival (RUL)
        │                         │                                      │
        └──────────► FastAPI backend (loads once) ──► Next.js dashboard ◄┘
```

Three scripts build the artifacts: `train.py` (model + reports), `scripts/score_dataset.py`
(per-hour scores), `scripts/build_rul.py` (bands + survival). The backend serves them; the
frontend displays them.

---

## 4. Feature engineering & derived features — `src/pdm/features.py`

**What:** turn raw signals into predictive inputs. **Why backward-looking:** features may use
only *past* data, so the model can't "see the future" (no leakage). **How:** pandas
`groupby().rolling()` and `merge_asof`.

**Derived feature groups (~76 total):**

| Group | What / how | Count |
|---|---|---|
| Rolling sensor stats | each sensor × {mean, std, min, max} over {3h, 12h, 24h} windows, e.g. `volt_mean_24h` (avg voltage in the last 24 readings) | 48 |
| Rolling error counts | each error1–5 counted over {3h,12h,24h}, e.g. `error1_count_24h` | 15 |
| Maintenance recency | `hours_since_comp1..4` = time since each part was replaced (8760 sentinel if never) — via `merge_asof` (most recent replacement ≤ now) | 4 |
| Machine metadata | one-hot `model_model1..4` + `age` | 5 |

- **Rolling window** = a sliding look-back. `rolling(24)` over hourly data = last 24 hours.
  Mean shows the trend, std shows instability, min/max show extremes.
- **One-hot encoding** = turn a category ("model3") into yes/no columns (`model_model3 = 1`)
  so a numeric model can use it.

**Important features** (which ones matter — see SHAP §11): component age
(`hours_since_comp*`) dominates, then 24h error counts, then 24h sensor means. Short 3h
windows get dropped in selection (too noisy).

---

## 5. Labels & the 12-hour horizon — `src/pdm/labels.py`

**What:** the answer the model learns. A machine-hour is labeled **1 if a failure happens
within the next `horizon_hours` (= 12)**, else **0**. **Forward-looking** (looks ahead).

**Why 12h:** it's the actionable warning window — enough lead time to schedule a crew.

Only ~1% of rows are 1 (failures are rare) → an **imbalanced** problem (§8).

---

## 6. Data leakage (and how we avoid it)

**What it is:** when information that wouldn't be available at prediction time sneaks into
training, making the model look great in testing but fail in reality.

**Why it matters:** it's the #1 way PdM models give fake high scores.

**How we avoid it (3 guards):**
1. Features look **only backward**; labels look **only forward**.
2. The failures file is used **only** for labels — never as a feature.
3. The train/test split is **chronological** — never train on the future to predict the past.

---

## 7. Train/test split & cross-validation — `train.py`, `src/pdm/model.py`

- **Chronological 80/20 split:** first 80% of the timeline trains, the last 20% tests. Real
  deployment predicts the future from the past, so testing must too.
- **Cross-validation (CV):** during tuning, split the training data into folds, train on some,
  validate on the rest, average the score — a more reliable estimate than one split.
- **TimeSeriesSplit:** a CV that respects time — each fold's validation set comes *after* its
  training set (expanding window). Prevents leakage inside CV too.

---

## 8. Class imbalance

**What:** ~99 healthy rows for every 1 "about to fail" row (1:100). A naive model could call
everything "healthy" and be 99% accurate but useless.

**How we handle it:** XGBoost's `scale_pos_weight = (#negatives / #positives) ≈ 100`, which
makes each rare positive count ~100× during training, so the model pays attention to failures.

---

## 9. The model: Decision Trees → Gradient Boosting → XGBoost — `src/pdm/model.py`

Built bottom-up:
- **Decision tree:** a flowchart of yes/no splits on feature thresholds (e.g. "is
  `error4_count_24h` > 3?") ending in leaves that give a prediction. Simple, weak alone.
- **Ensemble:** combine many weak models into one strong one.
- **Gradient boosting:** build trees **sequentially**; each new tree is trained on the
  **errors (residuals)** of the trees so far, nudging the prediction in the direction that
  reduces the loss (that direction is the *gradient* — hence "gradient" boosting).
- **XGBoost (Extreme Gradient Boosting):** a fast, regularized implementation of gradient
  boosting. **Why here:** best-in-class for tabular data, captures non-linear feature
  interactions, handles imbalance via `scale_pos_weight`, outputs a calibrated-ish probability.

**Output:** `predict_proba` → a number 0–1 = chance of failure within 12h.

---

## 10. Hyperparameter tuning: Optuna (Bayesian / TPE) — `src/pdm/model.py`

**What hyperparameters are:** settings you choose *before* training (number of trees, tree
depth, learning rate, sampling fractions) — not learned from data.

**What Optuna is:** an optimization framework that searches for the best hyperparameters.
**How:** it runs trials; by default it uses **TPE (Tree-structured Parzen Estimator)**, a form
of **Bayesian optimization** — it models which settings tend to score well and samples
promising ones next, instead of brute-force grid search.

**Where:** `tune_with_optuna` runs 50 trials, each scored by TimeSeriesSplit CV, optimizing
**AUC-PR** (§13). The winning settings are saved to `best_params.json`.

---

## 11. SHAP — explainability (deep dive)

**What SHAP is:** **SH**apley **A**dditive ex**P**lanations. It answers: *"for this one
prediction, how much did each feature push the score up or down?"*

**The idea (game theory):** a **Shapley value** (from cooperative game theory, Lloyd Shapley)
fairly splits a "payout" among players based on their marginal contribution across all
possible orderings. Here the "players" are the features and the "payout" is the prediction.
SHAP adapts this so that **base value + Σ(feature SHAP values) = the model's output** for that
row — every feature gets a signed credit that exactly adds up.

**Why we use it:** (a) to **explain** a single prediction in plain terms ("flagged because
'Time since Part 1 service' is high"); (b) to **rank features** for selection (the ones with
the largest average impact).

**How it's computed here:** `shap.TreeExplainer` — an exact, fast SHAP algorithm specialized
for tree models like XGBoost. For one machine's feature row it returns a SHAP value per
feature; positive = pushes failure risk **up** (red bars), negative = pulls it **down** (blue).

**Where:**
- `pass2_shap_feature_selection` (rank features by mean |SHAP| → keep top 20).
- The **"What's driving this"** chart on Machine Health drill-down (per-machine, per-moment).

**Reading the chart:** X-axis = SHAP value (contribution), Y-axis = features. A long red bar on
"Time since Part 1 service" means that machine's part-1 age is strongly increasing its risk.

---

## 12. Feature selection (2 passes) — `src/pdm/model.py`

Prunes ~76 features → 20:
1. **Pass 1 — gain importance:** train a quick XGBoost, drop features whose total "gain"
   (improvement they bring to tree splits) is ~zero.
2. **Pass 2 — SHAP:** rank survivors by mean |SHAP value| and keep the **top 20** (saved to
   `selected_features.json`).

**Why:** fewer, stronger features = faster, less overfitting, easier to explain.

---

## 13. Evaluation: precision, recall, F1, ROC/AUC-ROC, PR/AUC-PR — `src/pdm/evaluate.py`

First, the **confusion matrix** at a chosen threshold (predicted vs actual):
- **TP** true positive (predicted fail, did fail), **FP** false positive (predicted fail,
  didn't), **FN** false negative (missed a real failure), **TN** true negative.

From it:
- **Precision** = TP / (TP+FP) = *of machines we flagged, how many really failed* (avoids false
  alarms).
- **Recall** (= True Positive Rate, **TPR**) = TP / (TP+FN) = *of real failures, how many we
  caught* (avoids misses).
- **F1** = harmonic mean of precision & recall (one balanced number).
- **False Positive Rate (FPR)** = FP / (FP+TN).

**Curves** (sweep the threshold from 1→0 and plot):
- **ROC curve:** X = FPR, Y = TPR. **AUC-ROC** = area under it (0.5 random → 1 perfect) =
  probability the model ranks a random failing machine above a random healthy one.
- **PR curve:** X = Recall, Y = Precision. **AUC-PR** = area under it.

**Why AUC-PR is our headline:** with ~1% positives, AUC-ROC looks near-perfect even for a
mediocre model (tons of true negatives). AUC-PR focuses on the rare positive class, so it's the
honest metric — and what tuning optimizes. (This project: AUC-PR ≈ 0.914, AUC-ROC ≈ 0.9996 on
the held-out test; the smoke model — full run ≈ 0.99 PR.)

On the **Accuracy** page these are shown in plain words: recall → "failures caught X/100",
precision → "alerts that are real Y/100".

---

## 14. The threshold (alert sensitivity)

**What:** the model outputs a probability; the **threshold** is the cutoff to call a machine
"at risk." Default 0.5.

**Why adjustable:** it trades precision vs recall:
- **Higher** (Strict) → fewer false alarms, but you miss a few failures.
- **Lower** (Sensitive) → catch more failures, but more false alarms.

**How chosen:** by cost — a catastrophic missed failure → lower it; expensive false alarms →
raise it. In the UI it's the **"Alert sensitivity"** control, which shows the live trade-off
("catches ~99/100 · ~74/100 alerts real") as you move it.

---

## 15. The risk score (0–100) — with worked example — `src/pdm/risk.py`

**What:** one business-readable number per machine, blending the validated model probability
with how abnormal the sensors are *right now*.

**How:**
1. **Normal bands:** for each machine **model type**, take the 1st–99th percentile of
   *healthy-period* readings → `[lower, upper]` per sensor. (Percentile = the value below which
   that % of data falls; p99 of voltage = "only 1% of healthy readings exceed this.")
2. **Violations:** measure how far the current reading sits outside its band, normalized by the
   band width → count + magnitude → **violation severity (0–100)**.
3. **Blend:** `risk_score = 100 × (0.6 × classifier_prob + 0.4 × violation_severity/100)`.

**Worked example — Machine 50:**
- classifier probability = 0.617
- 1 of 4 sensors out of band (volt 211.6 vs band 135–208) → severity ≈ 15/100
- `risk_score = 100 × (0.6 × 0.617 + 0.4 × 0.15) = 100 × (0.370 + 0.060) =` **`43 / 100`**

**Why blend:** the model probability is the validated signal; the sensor-violation part is
model-free, interpretable corroboration. 60/40 keeps the validated part dominant.

---

## 16. Survival analysis & RUL — deep dive — `src/pdm/survival.py`

**RUL = Remaining Useful Life** = estimated time until a machine fails.

### 16.1 Survival (time-to-event) concepts
- **Event** = the thing whose timing we model (here: a component failure).
- **Survival function S(t)** = probability the machine is still running after time *t*.
  Starts at 1, decreases toward 0.
- **Hazard** = the instantaneous risk of failing right now given it has survived so far. For
  wear-out, hazard **increases** with age.
- **Censoring** = a "life" that ends *without* an observed failure (e.g., the part was replaced
  early, or the data ended). We don't know its true lifetime — only that it lasted *at least*
  that long. Survival analysis is the branch of stats built to use censored data correctly.

### 16.2 Renewal lives (handling the data quirk)
Because each failure is logged with a same-time replacement, naive "time since maintenance"
collapses to 0. So we build a **renewal process** per (machine, component): a **life** starts
at a replacement and ends at the **next failure** (event observed = 1) or the next replacement
/ end-of-data (**censored** = 0); 0-length lives are dropped. (`build_renewal_lives`.)

### 16.3 The Weibull distribution — what & why
- **What:** a flexible probability distribution for lifetimes, defined by two parameters —
  **shape (k)** and **scale (λ)**. The shape controls the hazard: k>1 = hazard rises with age
  (wear-out), k=1 = constant (random failures), k<1 = early-life failures.
- **Why here:** it's the classic, well-understood reliability model for parts that **wear
  out** (hazard increases over time) — exactly machine components. It gives a full lifetime
  distribution, so we can read off median life, percentiles, and a survival curve.
- **How fitted:** via the `lifelines` library on the renewal lives.

### 16.4 AFT — Accelerated Failure Time
- **What:** a regression form of the survival model. Covariates (age, sensor means, error
  counts, which component) **stretch or shrink** the lifetime — bad conditions "accelerate"
  failure. So RUL is conditioned on *this* machine's current state, not a fleet average.
- **Where:** `fit_weibull_aft` → `WeibullAFTFitter`.

### 16.5 Kaplan-Meier — the baseline
- **What:** a non-parametric (no assumed distribution) estimate of the survival curve, computed
  directly from observed event/censor times.
- **Why:** a covariate-free **baseline** to compare each machine's Weibull curve against
  (the grey dashed line in the chart). `fit_kaplan_meier`.

### 16.6 From model to RUL (what you see)
- **RUL** = **conditional median residual life**: given the part has already run *N* days, the
  additional time until its survival probability drops to 0.5. Computed from the conditional
  survival curve `S(elapsed + t) / S(elapsed)` (`predict_rul`, `survival_curve_points`).
- **Confidence interval** = 5th–95th percentile of residual life ("likely range 3–108 days").
- **Recommended service date** = conservative: `min(½·RUL, lower-CI) − 3-day lead time` →
  bucketed into urgency (Service now / Urgent / Soon / Planned) (`rul_to_service_date`).

**Example (Machine 57):** best estimate ~30 days, likely range 3–108 days; the survival curve
crosses 0.5 at ~30 days ahead (the red "RUL" line); urgency = "Service now" because the
conservative date already passed.

---

## 17. Generated artifacts

| Artifact | Built by | Contents |
|---|---|---|
| `outputs/models/model.joblib` | train.py | the XGBoost classifier |
| `outputs/reports/summary.json` + csvs/pngs | train.py | AUC scores, threshold sweep, per-component metrics, plots |
| `outputs/scored.parquet` | score_dataset.py | per machine-hour: risk, label, sensors, model |
| `outputs/features_selected.parquet` | score_dataset.py | the 20 model-input features per row (for SHAP) |
| `outputs/models/bands.json` | build_rul.py | per-model normal sensor bands |
| `outputs/models/survival.joblib` | build_rul.py | Weibull AFT + Kaplan-Meier + covariate columns |
| `outputs/rul.parquet` | build_rul.py | per-machine RUL snapshot (the API now recomputes per time) |

---

## 18. Backend (FastAPI) — `api/`

**What:** a Python web server that loads every artifact **once** at startup and answers the
frontend over `/api/*`.

**Key endpoints:** `/health`, `/fleet` (per-machine risk + risk score + RUL, **recomputed at
the chosen time**), `/fleet/monitor` (live snapshot table), `/machines/{id}` (drill-down:
timeseries, survival curve, SHAP), `/results/*` (metrics, threshold sweep). It reuses the same
`src/pdm` code — no logic duplicated.

---

## 19. Frontend (Next.js dashboard) & every chart's axes — `frontend/`

**What:** a React/TypeScript app (Next.js) that renders the screens; holds no data, just calls
the API. Charts use **Recharts**.

**Two global controls** drive every page: **Point in time** (date + hour — recomputes the whole
board for that moment) and **Alert sensitivity** (the threshold). Plus a light/dark toggle.

**Pages:** Live Status (the 12h notifier), Machine Health (will-it-fail + drill-down), Service
Planner (when-to-service + drill-down), Accuracy (trust, plain terms), Fleet Monitor (live
all-machine table). Every table has search + machine/type/status filters + click-to-sort.

**Every chart — type · X · Y:**
| Chart | Type | X | Y |
|---|---|---|---|
| Fleet risk spread | bar/histogram | failure-chance bucket | # machines |
| Urgency mix | donut | — (slice = count) | — |
| Fleet status map | heatmap grid | machine tiles | color = urgency |
| Failure chance over time | area/line | time (year) | failure probability 0–1 |
| Sensor readings | line | time | sensor value (green band = normal) |
| What's driving this | horizontal bar | SHAP value | features |
| Remaining useful life | radial gauge | — | days left |
| Survival curve | area + line | days ahead (0–180) | survival probability 0–1 |
| Sensor violation magnitude | horizontal bar | distance outside band | sensors |
| Failures caught by part | progress bars | % caught | per part |
| Vibration · last 24h | sparkline | last 24 hours | vibration value |

---

## 20. Caveats
- **Synthetic dataset** → ~0.9–1.0 scores are expected; real plant data is harder.
- **Daily failure resolution** → with a 12h horizon, positive labels cluster in overnight
  windows (`horizon_hours: 24` aligns to the data's true resolution).
- **Per-component precision is low by construction** (single any-failure model) — recall is the
  meaningful per-component number.
- **Current on-disk model is a fast 5-trial run** (~0.91 PR); the full 50-trial `train.py`
  reproduces ~0.99.

---

## 21. Glossary
- **PdM** — predictive maintenance.
- **Feature** — an input the model learns from; **derived feature** — one computed from raw data (e.g. a rolling average).
- **Label / target** — the 0/1 answer (fails within 12h?).
- **Horizon** — how far ahead we predict (12h).
- **Class imbalance** — far more negatives than positives.
- **XGBoost** — gradient-boosted decision-tree model (the classifier).
- **Gradient boosting** — building trees sequentially, each fixing prior errors.
- **Optuna / TPE / Bayesian optimization** — smart hyperparameter search.
- **Cross-validation / TimeSeriesSplit** — reliable, leakage-free scoring during tuning.
- **SHAP / Shapley value** — fair per-feature credit for a single prediction.
- **Precision / Recall / F1** — alert accuracy / failures caught / their balance.
- **ROC / AUC-ROC**, **PR / AUC-PR** — curves & areas summarizing performance; AUC-PR is honest for rare events.
- **Threshold** — probability cutoff for an alert.
- **Risk score** — 0–100 blend of model probability + sensor-band violations.
- **Survival function S(t)** — chance still running after time t.
- **Hazard** — instantaneous failure risk given survival so far.
- **Censoring** — a life that ended without an observed failure.
- **Weibull distribution** — two-parameter lifetime model for wear-out.
- **AFT (Accelerated Failure Time)** — survival regression; covariates speed/slow failure.
- **Kaplan-Meier** — non-parametric baseline survival curve.
- **RUL** — Remaining Useful Life (days until likely failure).
