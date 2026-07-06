# Sentinel — Predictive Maintenance: Complete Technical Guide

How everything in this application works — every calculation, every file, every number — written
so you can explain it to your senior from first principles.

---

## Table of Contents

1. [What the app does (the two questions)](#1-what-the-app-does)
2. [The raw dataset (5 CSV files)](#2-the-raw-dataset)
3. [End-to-end pipeline & file map](#3-end-to-end-pipeline)
4. [Feature engineering — how raw signals become model inputs](#4-feature-engineering)
5. [Labels — what the model learns to predict](#5-labels)
6. [Data leakage — the #1 mistake we avoid](#6-data-leakage)
7. [Train/test split (chronological)](#7-traintest-split)
8. [Class imbalance (99:1)](#8-class-imbalance)
9. [The XGBoost classifier](#9-xgboost-classifier)
10. [Hyperparameter tuning with Optuna](#10-hyperparameter-tuning)
11. [SHAP — why did the model say that?](#11-shap-explainability)
12. [Feature selection — pruning 76 → 20 features](#12-feature-selection)
13. [Evaluation metrics: Precision, Recall, AUC-PR, AUC-ROC](#13-evaluation-metrics)
14. [The alert threshold (sensitivity control)](#14-alert-threshold)
15. [Risk Score — Weibull Cumulative Hazard H(t)](#15-risk-score)
16. [Survival Analysis & RUL — the full deep-dive](#16-survival-analysis--rul)
17. [How the time-travel "as-of" control works](#17-as-of-time-travel)
18. [Generated artifacts (files on disk)](#18-generated-artifacts)
19. [Backend — FastAPI (`api/`)](#19-backend-fastapi)
20. [Frontend — Next.js (`frontend/`)](#20-frontend-nextjs)
21. [Every chart: type, X-axis, Y-axis, what it shows](#21-every-chart-explained)
22. [Urgency statuses — what each means](#22-urgency-statuses)
23. [What happens when you click a machine (drill-down)](#23-drill-down-walk-through)
24. [Complete worked example — Machine 6, Oct 5 14:00](#24-worked-example)
25. [Glossary](#25-glossary)

---

## 1. What the app does

**Predictive maintenance (PdM)** = predict a machine failure *before* it happens.

The app answers **two independent questions** for every machine at any chosen point in time:

| Question | Model | Output | View |
|---|---|---|---|
| Will this machine fail in the **next 12 hours**? | XGBoost classifier | Failure probability 0–100% | Machine Health |
| **When** should we service it? How many days left? | Weibull survival (AFT) | RUL in days + service date | Service Planner |

These two models are deliberately separate: the classifier catches **acute** faults (sensor
spikes that look like imminent failure); the survival model tracks **slow wear-out** (a part
ageing past its characteristic life). You need both because a machine can look "healthy" on
sensors but have a very old part about to give out.

---

## 2. The raw dataset

**Source:** Microsoft Azure Predictive Maintenance dataset (simulated, but realistic).  
**Location:** `data/raw/` — loaded in `src/pdm/data_loader.py`

| File | Key columns | One row = | Rows |
|---|---|---|---|
| `PdM_telemetry.csv` | datetime, machineID, **volt, rotate, pressure, vibration** | one machine × one hour | 876,100 |
| `PdM_errors.csv` | datetime, machineID, **errorID** (error1–5) | a non-fatal warning event | 3,919 |
| `PdM_maint.csv` | datetime, machineID, **comp** (comp1–4) | a component replacement | 3,286 |
| `PdM_failures.csv` | datetime, machineID, **failure** (comp1–4) | an actual breakdown — the label | 761 |
| `PdM_machines.csv` | machineID, **model** (model1–4), **age** | static machine info | 100 |

**Key data facts:**
- 100 machines × 8,761 hours = 876,100 rows of telemetry
- Failures are stamped at daily resolution (~06:00) — the model uses a 24h horizon to align
- Each failure is logged with a same-timestamp replacement (important for survival — see §16.2)
- `failures.csv` is the **answer key** — never used as a feature, only to create labels

---

## 3. End-to-end pipeline

```
data/raw/ (5 CSVs)
      │
      ▼  src/pdm/data_loader.py  →  build_base_dataframe()
      │     joins telemetry + errors + maint + failures + machines on machineID+datetime
      │
      ▼  src/pdm/features.py  →  build_feature_matrix()
      │     ~76 derived features per machine-hour (rolling stats, error counts, comp age)
      │
      ├──► src/pdm/labels.py  →  build_labels()
      │       1 = failure within next 12h, else 0
      │
      ▼  train.py  (run once)
      │     chronological 80/20 split
      │     Optuna 50 trials → best XGBoost hyperparams
      │     2-pass feature selection (gain + SHAP) → top 20 features
      │     trains final XGBoost on full training set
      │     outputs/models/model.joblib
      │     outputs/reports/ (AUC scores, plots, threshold table)
      │
      ▼  scripts/score_dataset.py  (run once)
      │     runs model over every machine-hour
      │     outputs/scored.parquet  (machineID, datetime, risk probability, sensors, label)
      │     outputs/features_selected.parquet  (the 20 features, for SHAP drill-down)
      │
      ▼  scripts/build_rul.py  (run once)
      │     fits normal sensor bands per machine model
      │     fits Weibull AFT survival model on component lives
      │     fits Kaplan-Meier baseline
      │     writes per-machine RUL snapshot
      │     outputs/models/bands.json
      │     outputs/models/survival.joblib
      │     outputs/rul.parquet
      │
      ▼  api/main.py  (running server, port 8077)
      │     loads all artifacts once at startup (ArtifactStore — api/store.py)
      │     re-computes risk + RUL for any chosen as-of timestamp on demand
      │
      ▼  frontend/ (Next.js, port 3000)
            React/TypeScript dashboard — calls /api/* and renders the charts
```

---

## 4. Feature engineering

**File:** `src/pdm/features.py` → `build_feature_matrix()`

Raw sensor readings are not enough — a single voltage reading tells you nothing. What matters is
**trends** (rising temp over 24h) and **context** (how long since the last replacement). So we
compute ~76 derived features:

### Rolling sensor statistics
For each of the 4 sensors (`volt, rotate, pressure, vibration`) × 3 time windows (`3h, 12h, 24h`) × 4 stats (`mean, std, min, max`) = **48 features**

```
volt_mean_24h   = average voltage in the last 24 hourly readings
volt_std_24h    = standard deviation of voltage in the last 24h (high = unstable)
volt_min_24h    = minimum voltage in last 24h
volt_max_24h    = maximum voltage in last 24h
... same for rotate, pressure, vibration
```

`rolling(24)` on hourly data = last 24 data points = last 24 hours. It's a **backward-looking
sliding window** — no future data.

### Rolling error counts
Each of 5 error types × 3 windows = **15 features**

```
error1_count_24h = number of error1 events in the last 24h
error4_count_24h = number of error4 events in the last 24h (the most predictive one)
```

### Component age (maintenance recency)
For each of 4 components = **4 features**

```
hours_since_comp1 = hours since comp1 was last replaced
hours_since_comp2 = hours since comp2 was last replaced
hours_since_comp3 = hours since comp3 was last replaced
hours_since_comp4 = hours since comp4 was last replaced
```

Computed via `pd.merge_asof` — for every telemetry row, look back and find the most recent
replacement of that component. If no replacement exists in the data, fill with `8760` (= 1 year,
a sentinel for "never replaced in the dataset"). **This is the most important feature family.**

### Machine metadata
`model_model1/2/3/4` (one-hot) + `age` = **5 features**

One-hot encoding: "model3" → `model_model3 = 1`, all others = 0. This lets the numeric model
treat machine type as a categorical.

**After feature selection (§12):** ~76 → **20 features** survive. The survivors are almost
entirely `hours_since_comp*` and `error*_count_24h` — component age is the dominant predictor.

---

## 5. Labels

**File:** `src/pdm/labels.py` → `build_labels()`

```python
# label = 1 if ANY failure occurs in the next horizon_hours for this machine
label[machine_id, t] = 1  if failures exist in (t, t + 12h]  else 0
```

- **Horizon = 12 hours** (set in `config.yaml → labeling.horizon_hours`)
- **~1% of rows are 1** — failures are rare (761 failures / 876,100 rows = 0.087%)
- Labels are **forward-looking** (look ahead), features are **backward-looking** (look back) —
  this is the fundamental separation that prevents leakage (§6)

---

## 6. Data leakage

**The #1 way PdM models give fake high scores.**

Leakage = letting the model see information it wouldn't have at prediction time.

Three guards in this codebase:
1. **Features look only backward** (`rolling()` with closed='left', `merge_asof` direction='backward')
2. **`failures.csv` is never used as a feature** — only to build labels and survival events
3. **Train/test split is chronological** — test period is the future, never shuffled

---

## 7. Train/test split

**File:** `src/pdm/scoring.py` → `chronological_test_split()`

```
All data (876,100 rows) sorted by time:
│────────────── 80% training ──────────────│── 20% test ──│
Jan 2015                             Oct 2015         Jan 2016
```

`test_size_pct = 0.20` in `config.yaml`. **Never shuffle** time-series data — that creates
look-ahead leakage.

**Cross-validation during tuning:** `sklearn.model_selection.TimeSeriesSplit` — each fold's
validation set is always after its training set (expanding window). 5 folds.

---

## 8. Class imbalance

~99.9 healthy rows : 1 failure row.

**Fix:** XGBoost `scale_pos_weight = n_negatives / n_positives ≈ 1150`

This makes each positive (failure) row count ~1150× during training, forcing the model to
learn the rare failure pattern rather than always predicting "healthy."

Without this, the model would achieve ~99.9% accuracy by always saying "healthy" — which is
useless for maintenance.

---

## 9. XGBoost classifier

**File:** `src/pdm/model.py` → `train_model()`, `load_model()`  
**Artifact:** `outputs/models/model.joblib`

**How it works — bottom up:**

**Decision tree** = a flowchart of yes/no splits, e.g.:
```
Is hours_since_comp1 > 300?
  YES → Is error4_count_24h > 2?
          YES → FAIL (probability 0.87)
          NO  → HEALTHY (probability 0.12)
  NO  → HEALTHY (probability 0.04)
```
One tree is weak (overfits or underfits).

**Gradient boosting** = build trees *sequentially*, each tree trained on the **residuals**
(errors) of all previous trees. Tree N corrects where trees 1..N-1 were wrong. The gradient
is the direction to push predictions to reduce the loss function.

**XGBoost** = a fast, regularized gradient boosting implementation:
- L1/L2 regularization prevents overfitting
- `predict_proba` outputs a calibrated-ish 0–1 probability
- Handles `scale_pos_weight` natively for imbalance

**Input:** 20 features (after selection)  
**Output:** probability of failure within the next 12h (0–1 float)

---

## 10. Hyperparameter tuning

**File:** `src/pdm/model.py` → `tune_with_optuna()`

Hyperparameters = settings chosen before training (not learned from data):
`n_estimators, max_depth, learning_rate, subsample, colsample_bytree, min_child_weight, gamma`

**Optuna** runs **50 trials** of Bayesian/TPE optimization:
- Builds a probabilistic model of which hyperparameter regions produce good AUC-PR
- Samples from promising regions first (not brute-force grid search)
- Each trial = train on folds → evaluate → report score → Optuna updates its model

Best params saved to `outputs/reports/best_params.json`.

---

## 11. SHAP explainability

**File:** `api/store.py` → `explain()`  
**Library:** `shap.TreeExplainer`

**What SHAP answers:** *"For this one machine at this moment, how much did each feature push the
failure probability up or down?"*

**The math (simplified):** Shapley values from cooperative game theory. Each feature's
contribution = its average marginal effect across all possible orderings of features. The key
property:

```
base_value + SHAP(feature_1) + SHAP(feature_2) + ... + SHAP(feature_20) = model output
```

Every SHAP value is a signed number:
- **Positive (red bar)** → this feature pushed failure risk UP
- **Negative (green bar)** → this feature pushed failure risk DOWN

**Example for Machine 6:**
```
base_value = 0.01 (average failure rate)
+ hours_since_comp1: +0.31  ← part age is the main concern
+ error4_count_24h:  +0.08  ← recent errors adding risk
+ volt_mean_24h:     -0.03  ← voltage looks normal, reducing risk
= 0.37 → 37% failure probability
```

**Where used:**
1. `scripts/score_dataset.py` — SHAP values per row for feature selection
2. Machine Health drill-down — "What's driving this" chart (live, per machine, per moment)

---

## 12. Feature selection

**File:** `src/pdm/model.py` → `pass1_gain_selection()`, `pass2_shap_feature_selection()`

**Pass 1 — Gain importance:**
Train a quick XGBoost on all ~76 features. Each feature's "gain" = total improvement it brings
to all tree splits using that feature. Drop features with gain ≈ 0 (they never help any split).
~76 → ~40 features.

**Pass 2 — SHAP importance:**
Train on pass-1 survivors. Compute SHAP values for the test set. Rank by `mean(|SHAP value|)`
= how much each feature moves predictions on average. Keep top 20.

Result saved to `outputs/reports/selected_features.json`.

The top survivors are almost always: `hours_since_comp1`, `hours_since_comp2`,
`error4_count_24h`, `error3_count_24h`, `volt_mean_24h`, `rotate_mean_24h`, `age` — component
age dominates.

---

## 13. Evaluation metrics

**File:** `src/pdm/evaluate.py`  
**Shown on:** Accuracy page (`frontend/src/app/metrics/page.tsx`)

### Confusion matrix (at a threshold)
```
                Predicted FAIL   Predicted HEALTHY
Actual FAIL         TP                 FN
Actual HEALTHY      FP                 TN
```

- **Precision** = TP / (TP + FP) = "of machines we flagged, how many really failed"
  → shown as "Right alerts X/100"
- **Recall** = TP / (TP + FN) = "of real failures, how many we caught"
  → shown as "Failures caught X/100"
- **F1** = 2 × (Precision × Recall) / (Precision + Recall) — harmonic mean

### Why AUC-PR, not AUC-ROC?
- With 99.9% negatives, AUC-ROC looks near-perfect even for a bad model (millions of true
  negatives inflate it)
- AUC-PR focuses on the rare positive class — honest for imbalanced problems
- **This project achieves AUC-PR ≈ 0.91–0.99** (depending on training run)

### Threshold sweep
`src/pdm/evaluate.py` → `compute_threshold_table()` scans threshold 0→1 in 0.05 steps,
computing precision/recall/F1 at each point. The live chart on the Accuracy page shows this
curve, with the currently selected threshold highlighted.

---

## 14. Alert threshold

**File:** `frontend/src/components/layout/ControlBar.tsx` (UI)  
**Backend:** passed as `?threshold=0.5` to every API call

Default = 0.50. Any machine whose `classifier_risk >= threshold` is flagged as "at risk" (shown
in red on the worklist).

| Threshold | Effect |
|---|---|
| High (0.8) | Only very likely failures → fewer false alarms, might miss borderline cases |
| Default (0.5) | Balanced — precision ≈ recall |
| Low (0.2) | Catch almost all failures → more false alarms |

The **"Balanced / Strict / Sensitive"** dropdown in the UI sets preset values; the slider gives
fine control. Visible on every page — affects the whole dashboard simultaneously.

---

## 15. Risk Score

**Files:**  
- `src/pdm/risk.py` → `compute_risk_score()`, `sensor_violations()`, `compute_normal_bands()`
- `src/pdm/survival.py` → `cumulative_hazard()`
- `api/store.py` → called in `machine_detail()` and `fleet()`

### What the risk score IS

```
risk_score = H(t)   ← Weibull cumulative hazard at the part's current age
```

It is a **raw number**, not scaled 0–100. Key values:

| H(t) value | Meaning |
|---|---|
| 0.0 | Brand new part, no accumulated failure damage |
| 0.5 | ~39% cumulative failure probability so far |
| **1.0** | **Characteristic life — 63.2% of comparable parts have failed by now = failure threshold** |
| 1.5 | Well past characteristic life, in the failure tail |
| 9.0 | Very old part (e.g. running since start of dataset without replacement) |

### The math: what is H(t)?

The Weibull survival function is:

```
S(t | X) = exp( -(t / λ(X))^ρ )
```

The cumulative hazard is:

```
H(t | X) = -ln( S(t | X) ) = ( t / λ(X) )^ρ
```

Where:
- `t` = elapsed days since the current part was last replaced (`hours_since_comp_X / 24`)
- `λ(X)` = **covariate-adjusted characteristic life** = `exp( X @ β_λ + b_λ )`
  — this is the scale parameter; it tells you when 63.2% of machines with *these exact conditions*
  will have failed
- `ρ` = shape parameter (> 1 for wear-out — hazard increases with age) = `exp(b_ρ)`
- `X` = the machine's current covariate row (sensor averages, error counts, machine type, component type)
- `β_λ, b_λ, b_ρ` = **learned by lifelines `WeibullAFTFitter`** during training

**H(t) is read directly from the fitted model — no hardcoded formula:**
```python
# src/pdm/survival.py  line 225
ch = aft.predict_cumulative_hazard(X, times=[t])
return float(np.asarray(ch)[0, 0])
```

### Why the same H=1 point for every machine type?

`λ(X)` is different per machine (it's covariate-adjusted). A machine with high error counts or
worn sensor values has a *smaller* `λ` — it hits H=1 sooner. A healthy machine has a *larger*
`λ` — it takes longer to reach H=1. The threshold (H=1) is universal; the speed of approach
varies per machine.

### Sensor bands (for context, not in the score)

```python
# src/pdm/risk.py  compute_normal_bands()
lower = healthy_training_rows[sensor].quantile(0.01)   # 1st percentile
upper = healthy_training_rows[sensor].quantile(0.99)   # 99th percentile
```

Done per machine *model type* (model1/2/3/4 have different nominal operating ranges).
Used to show "how far out of band" each sensor is in the drill-down — this does NOT change
the risk score, it's purely visual context.

### Risk score in the timeseries chart

For the "Risk score over time" chart, each historical hour gets its own H(t) computed with
**that row's historical covariates** (not today's):

```python
# api/store.py  machine_detail()  line ~340
# Build per-row covariate matrix from historical feature snapshots
# Then: ch_df = aft.predict_cumulative_hazard(cov_df_all, times=uniq_times)
# Output shape: (n_unique_times × n_rows)
# For each row i: H(el_arr[i] | X_i) picked via interpolation from column i
```

This gives the true **sawtooth**: H climbs from 0 after each replacement, reflecting the
machine's actual historical condition at each hour, then drops back to ~0 when the part is
replaced.

---

## 16. Survival analysis & RUL

**Files:**  
- `src/pdm/survival.py` — all survival math  
- `scripts/build_rul.py` — fits the models (run once)  
- `api/store.py` → `machine_detail()` — computes RUL on demand for any as-of time

### 16.1 Core concepts

**Survival function S(t):** probability a part is still running after `t` days. Starts at 1,
decreases to 0.

**Hazard h(t):** instantaneous failure rate at time `t` given survival so far. For wear-out
parts, hazard *increases* with age.

**Cumulative hazard H(t):** accumulated hazard from 0 to t. H(t) = -ln(S(t)). This is the
risk score.

**Censoring:** a component life that ends without a failure (replaced early, or data ended).
We know "it lasted *at least* this long" but not the true lifetime. Survival analysis correctly
uses these censored observations.

### 16.2 Building component lives — `build_renewal_lives()`

**File:** `src/pdm/survival.py` line 41

The data quirk: every failure has a same-timestamp replacement, so naive "time since
maintenance" = 0. Instead we build a **renewal process**:

```
For each (machineID, component) pair:
  For each replacement event (start time):
    next_event = whichever comes first:
      - next failure of that component  → end, event=1 (observed failure)
      - next replacement of that comp   → end, event=0 (censored, replaced before failure)
      - end of dataset                  → end, event=0 (censored, still running)
    duration = end_time - start_time
    drop if duration <= 0
```

Result: a DataFrame of component lives with `duration_days` and `event_observed` (1 or 0).
Example row: `{machineID:5, comp:'comp2', duration_days:47.3, event_observed:1}` = comp2 ran
47.3 days then failed.

### 16.3 Fitting the Weibull AFT — `fit_weibull_aft()`

**File:** `src/pdm/survival.py` line 117  
**Library:** `lifelines.WeibullAFTFitter`

The AFT (Accelerated Failure Time) model puts covariates on the *scale* parameter:

```
log(λ_i) = β_age × age_i + β_volt × volt_mean_24h_i + β_error4 × error4_count_24h_i
           + β_comp2 × comp2_i + β_model3 × model3_i + ... + b_intercept
```

So a machine with higher error counts gets a *smaller* λ → reaches characteristic life sooner.
Bad conditions **accelerate** failure — that's the "accelerated" in AFT.

```python
aft = WeibullAFTFitter(penalizer=0.05)
aft.fit(survival_df, duration_col="duration_days", event_col="event_observed")
# saved to outputs/models/survival.joblib
```

Covariates used: `age, volt_mean_24h, rotate_mean_24h, pressure_mean_24h, vibration_mean_24h,
error1..5_count_24h, model_model1..4, comp_comp1..4`

### 16.4 Kaplan-Meier baseline — `fit_kaplan_meier()`

**File:** `src/pdm/survival.py` line 137

No covariates — just a raw empirical survival curve per component type. This is the **grey
dashed line** in the survival chart: "how long does a typical comp2 last?"

```python
KaplanMeierFitter().fit(duration_days, event_observed)
```

### 16.5 RUL prediction — `predict_rul()`

**File:** `src/pdm/survival.py` line 185

Given a machine has already survived `elapsed_days`, what's the probability it survives
*t more days*?

**Conditional survival curve:**
```
P(survive t more | survived elapsed) = S(elapsed + t) / S(elapsed)
```

`S(t)` comes from `aft.predict_survival_function(X, times=[...])`.

```python
# Compute S at a fine grid of times
times = np.arange(0, elapsed + 365, 0.5)   # 0 to 1 year ahead, every 30 min
sf = aft.predict_survival_function(X, times=times).iloc[:, 0]
# Conditional: scale so S(elapsed) = 1
cond = sf(elapsed + t) / sf(elapsed)
```

**RUL = median residual life** = the t where `cond(t) = 0.5` (50% chance of surviving t more
days). This is where the purple curve crosses 0.5 on the survival chart.

**Confidence interval** (IQR, not 5th-95th):
- `rul_ci_low` = t where `cond(t) = 0.75` (25% of comparable lives have ended = early edge)
- `rul_ci_high` = t where `cond(t) = 0.25` (75% of comparable lives have ended = late edge)

### 16.6 Service date & urgency — `rul_to_service_date()`

**File:** `src/pdm/survival.py` line 256

Two independent failure signals:
1. **Slow wear-out** → `rul_ci_low_days` (survival lower bound)
2. **Acute fault** → classifier probability converted to implied time-to-failure

```python
effective_low = min(rul_ci_low_days, classifier_implied_days(classifier_prob))
days_until_service = max(0, effective_low - 3)  # 3-day maintenance lead time
```

`classifier_implied_days` treats the 12h classifier as a constant-hazard process:
```
implied_days = horizon_days × ln(2) / (-ln(1 - prob))
```

Urgency buckets:
```
days_until_service = 0          → "overdue"  (service now)
days_until_service < 7          → "urgent"
days_until_service < 30         → "soon"
days_until_service >= 30        → "planned"
```

---

## 17. As-of time travel

**Files:**  
- `frontend/src/components/layout/ControlBar.tsx` — the date picker + hour slider  
- `frontend/src/lib/store.ts` → `useControls()` — Zustand global state  
- `api/store.py` → `resolve_as_of()` — snaps to nearest available timestamp

### How it works

1. User picks a date + moves the hour slider → ControlBar sets `asOf = "2015-10-05T14:00:00"`
2. This is stored in Zustand (`useControls().asOf`)
3. Every React Query hook (`useMachine`, `useFleet`) includes `asOf` in its query key → any
   change to `asOf` triggers a refetch for the entire dashboard
4. API calls go to `/machines/6?as_of=2015-10-05T14:00:00`
5. Backend `resolve_as_of()` finds the last available scored timestamp ≤ that time:

```python
# api/store.py  resolve_as_of()
idx = int(np.searchsorted(self.timestamps, target, side="right")) - 1
# side='right'-1 = last index where timestamps[idx] <= target
return pd.Timestamp(self.timestamps[idx])
```

6. `machine_detail()` filters scored data: `mdf = scored[machineID==id & datetime <= ts]`
7. The last row of `mdf` (the as-of point) is pinned into the downsampled timeseries so the
   chart always ends exactly at the selected timestamp

### The timeseries window selector

The chart itself has 24h / 3d / 7d / 30d / All buttons (internal chart state). These filter
the already-as-of-trimmed data further, zooming in on recent history.

**File:** `frontend/src/components/charts.tsx` → `RiskOverTimeChart`

```typescript
// Slice visible window: keep only points within windowHours before the last point
const anchor = new Date(data[data.length - 1].datetime).getTime();
const cutoff = anchor - windowHours * 3_600_000;
const visible = data.filter(p => new Date(p.datetime).getTime() >= cutoff);
```

The x-axis tick format adapts automatically to the visible span:
```typescript
spanHours <= 48  → "14:00"         (just time)
spanHours <= 336 → "5 Sept 14:00"  (date + time)
otherwise        → "5 Sept"        (date only)
```

---

## 18. Generated artifacts

| Artifact | Built by | Contents | Used by |
|---|---|---|---|
| `outputs/models/model.joblib` | `train.py` | Fitted XGBoost (20 features) | api/store.py startup |
| `outputs/reports/summary.json` | `train.py` | AUC-PR, AUC-ROC, best params | Accuracy page |
| `outputs/reports/threshold_table.csv` | `train.py` | Precision/recall/F1 vs threshold | Accuracy threshold sweep chart |
| `outputs/reports/per_component_metrics.csv` | `train.py` | Recall per component | Accuracy page |
| `outputs/reports/*.png` | `train.py` | ROC, PR, SHAP summary plots | Accuracy page images |
| `outputs/scored.parquet` | `score_dataset.py` | Per machine-hour: risk prob, sensors, label | Timeseries + fleet snapshot |
| `outputs/features_selected.parquet` | `score_dataset.py` | 20 model features per row | SHAP drill-down |
| `outputs/models/bands.json` | `build_rul.py` | Per-model normal sensor bands | Sensor violation chart |
| `outputs/models/survival.joblib` | `build_rul.py` | Weibull AFT + KM + covariate_cols | H(t), RUL, survival curve |
| `outputs/rul.parquet` | `build_rul.py` | Per-machine static RUL snapshot | Fleet list (API re-computes live) |

---

## 19. Backend (FastAPI)

**Files:** `api/main.py`, `api/store.py`, `api/routers/*.py`, `api/deps.py`  
**Port:** 8077  
**Run:** `python -m uvicorn api.main:app --port 8077`

### Startup (ArtifactStore)
`api/store.py` → `ArtifactStore.load()` — runs once when the server starts:
1. Loads all artifacts into memory (model, scored parquet, survival bundle, bands)
2. Builds `feat_by_machine` and `scored_by_machine` dicts for fast O(1) lookup
3. Creates a single cached `shap.TreeExplainer` instance

### Key endpoints

| Endpoint | Handler | What it returns |
|---|---|---|
| `GET /api/health` | `health.py` | Ready flag + missing artifacts list |
| `GET /api/fleet?as_of&threshold` | `fleet.py` → `store.fleet()` | All 100 machines: risk, RUL, urgency |
| `GET /api/machines/{id}?as_of&threshold` | `machines.py` → `store.machine_detail()` | Full drill-down: timeseries, survival curve, SHAP, RUL |
| `GET /api/fleet/monitor?as_of` | `fleet.py` → `store.fleet_monitor()` | Live sensor snapshot table |
| `GET /api/results/threshold-sweep` | `results.py` → `store.threshold_sweep()` | Precision/recall/F1 vs threshold |

### machine_detail() — the most complex function

`api/store.py` line 261 — called every time you open a machine drill-down:

1. Resolve `as_of` → `ts`
2. Filter scored data to `datetime <= ts` → `mdf`
3. Get the current feature row at `ts` → `feat_row`
4. Find oldest component (`max hours_since`) → `current_comp`, `elapsed_days`
5. Build covariate vector `X` → `_covariates(feat_row, current_comp)`
6. Call `predict_rul(aft, X, elapsed_days)` → RUL + CI
7. Call `cumulative_hazard(aft, X, elapsed_days)` → H(t) → risk score
8. Call `rul_to_service_date(...)` → recommended date + urgency
9. Downsample timeseries to ~1000 points (stride = len/1000), pin last row
10. For each timeseries row: build per-row X from historical features → compute H(t)
11. Run SHAP on the current feature row
12. Return everything as JSON

---

## 20. Frontend (Next.js)

**Location:** `frontend/src/`  
**Port:** 3000  
**Run:** `cd frontend && npm run dev`

### Key files

| File | Purpose |
|---|---|
| `src/app/layout.tsx` | Root layout, metadata ("Sentinel — Predictive Maintenance") |
| `src/components/layout/Sidebar.tsx` | Navigation + Sentinel logo (inline SVG) |
| `src/components/layout/ControlBar.tsx` | Date picker + hour slider + threshold control |
| `src/lib/store.ts` | Zustand: `asOf`, `threshold`, sidebar collapse, theme |
| `src/lib/queries.ts` | TanStack Query hooks (all API calls) |
| `src/lib/api.ts` | Typed fetch wrapper, builds query strings |
| `src/lib/types.ts` | TypeScript interfaces matching the API response shapes |
| `src/lib/format.ts` | `riskScoreColor()`, `rulLabel()`, `URGENCY_META`, formatters |
| `src/components/charts.tsx` | All Recharts chart components |
| `src/components/Worklist.tsx` | Maintenance worklist table |

### Pages

| Route | File | What it shows |
|---|---|---|
| `/` | `src/app/page.tsx` | Overview: urgency donut + top 10 worklist |
| `/classification` | `src/app/classification/page.tsx` | All machines: failure chance table |
| `/classification/[id]` | `src/app/classification/[id]/page.tsx` | Machine drill-down: risk chart + SHAP |
| `/risk/[id]` | `src/app/risk/[id]/page.tsx` | Service planner: RUL gauge + survival curve |
| `/metrics` | `src/app/metrics/page.tsx` | AUC scores, threshold sweep, per-component |
| `/inference` | `src/app/inference/page.tsx` | Lookup or upload custom data |

### Data flow in the frontend

```
User changes date → setAsOf("2015-10-05T14:00:00")  [store.ts]
  → React Query key changes: ["machine", 6, "2015-10-05T14:00:00", 0.5]
  → api.machine(6, "2015-10-05T14:00:00", 0.5)  [api.ts]
  → GET /api/machines/6?as_of=2015-10-05T14:00:00&threshold=0.5
  → data returned → all charts re-render with new data
```

---

## 21. Every chart explained

### Risk score over time
**File:** `frontend/src/components/charts.tsx` → `RiskOverTimeChart`  
**Type:** Area chart  
**X-axis:** datetime (filtered to ≤ as_of, with time window selector)  
**Y-axis:** H(t) cumulative hazard (raw, 0 to max+padding)  
**Red dashed line at y=1.0:** failure threshold  
**Window buttons (24h/3d/7d/30d/All):** zoom into a sub-window of the history  
**Sawtooth pattern:** H climbs from 0 after each component replacement, drops back when replaced

### Survival curve
**File:** `frontend/src/components/charts.tsx` → `SurvivalCurveChart`  
**Type:** Area + Line (ComposedChart)  
**X-axis:** days ahead from now (0 → 180)  
**Y-axis:** survival probability (0–100%)  
**Purple area:** this machine's conditional survival P(survive +T days | survived so far)  
**Grey dashed line:** Kaplan-Meier baseline for this component type  
**Shaded purple band:** IQR range (25th–75th percentile of residual life)  
**Red vertical line:** RUL = where the purple curve crosses 50%  

### RUL gauge
**File:** `frontend/src/components/charts.tsx` → `RulGauge`  
**Type:** Radial bar  
**Value:** RUL days (capped at 1yr+ if machine is healthy with no end in sight)  
**Color:** green (long life) → amber → red (imminent failure)

### What's driving this (SHAP)
**File:** `frontend/src/components/charts.tsx` → `ShapBarChart`  
**Type:** Horizontal bar  
**X-axis:** SHAP value (negative = reduces risk, positive = increases risk)  
**Y-axis:** top 12 features  
**Red bars:** features pushing failure risk UP  
**Green bars:** features pulling failure risk DOWN

### Sensor readings over time
**File:** `frontend/src/components/charts.tsx` → `SensorTraceChart`  
**Type:** Line  
**X-axis:** datetime  
**Y-axis:** sensor value (volt / rotate / pressure / vibration)  
**Green shaded band:** normal operating range for this machine's model type

### Sensor violation magnitude
**File:** `frontend/src/components/charts.tsx` → `SensorViolationChart`  
**Type:** Horizontal bar  
**X-axis:** normalized exceedance (distance outside band / band width)  
**Y-axis:** sensor name  
**Green = in band, Red = out of band**

### Threshold sweep
**File:** `frontend/src/components/charts.tsx` → `ThresholdSweepChart`  
**Type:** Multi-line  
**X-axis:** threshold (0→1)  
**Y-axis:** metric % (0→100)  
**Green:** Failures caught (recall)  
**Blue:** Right alerts (precision)  
**Amber dashed:** Balance (F1)

---

## 22. Urgency statuses

**File:** `src/pdm/survival.py` → `rul_to_service_date()` (computed)  
**File:** `frontend/src/lib/format.ts` → `URGENCY_META` (display)

| Status | Condition | Color | Meaning |
|---|---|---|---|
| **Overdue** | days_until_service ≤ 0 | Red | Service window has passed — act now. Either the classifier flagged it (≥ threshold) OR the survival lower bound minus lead time has already elapsed. |
| **Urgent** | 0 < days_until_service < 7 | Orange | Service needed within 7 days. The conservative survival bound puts end-of-safe-run very soon. |
| **Soon** | 7 ≤ days_until_service < 30 | Amber | Plan service this month. Part is past the "safe" zone but not critical yet. |
| **Planned** | days_until_service ≥ 30 | Green | Part has >30 days of safe life left. Schedule on the next maintenance cycle. No rush. |

**"Planned" specifically means:** the survival model estimates this part still has at least 30+
days before it's likely to fail — it's on the regular maintenance schedule, not on the urgent
list.

**How the urgency is computed:**
```python
effective_low = min(
    rul_ci_low_days,                          # survival lower bound (pessimistic wear-out)
    classifier_implied_days(classifier_prob)  # acute fault implied time
)
days_until_service = max(0, effective_low - 3)  # minus 3-day lead time
```

Both failure modes (wear-out AND acute fault) feed in — whichever says "sooner" wins.

---

## 23. Drill-down walk-through

When you click a machine or go to `/classification/6`:

1. **Page loads** → `useMachine(6)` fires → GET `/api/machines/6?as_of=...&threshold=0.5`
2. **Backend** runs `machine_detail(6, as_of, 0.5)`:
   - Filters scored data to ≤ as_of
   - Finds oldest part (max hours_since) → e.g. comp2, 47.3 days
   - Builds covariate vector X with current sensor averages + error counts + model type
   - `cumulative_hazard(aft, X, 47.3)` → H = 0.73 → risk_score = 0.73
   - `predict_rul(aft, X, 47.3)` → RUL = 28 days, CI [3, 89]
   - `rul_to_service_date(...)` → urgency = "soon", service in 21 days
   - Downsamples timeseries (stride = len(mdf)//1000), pins last row at as_of
   - Per-row H(t) with per-row covariates → the chart data
   - `survival_curve_points(aft, X, 47.3)` → 90 points, 0→180 days ahead
   - `explain(feature_row)` → top 12 SHAP values
3. **Frontend** renders:
   - Header badge: "Soon" / "Healthy"
   - Risk score card: 0.73 / 1.00, bar at 73%, "73% to failure"
   - Risk chart: area chart of H(t) over time with window selector
   - Survival curve: purple area + grey baseline + RUL line
   - SHAP bars: which features drove the 0.73 score
   - 4 sensor gauges: each reading vs its normal band

---

## 24. Worked example — Machine 6, Oct 5 14:00

**You select:** 5 Oct 2015, 14:00 in the ControlBar.

**`resolve_as_of("2015-10-05T14:00:00")`** → finds last scored timestamp ≤ Oct 5 14:00 →
returns `"2015-10-05T14:00:00"` (exact match, data is hourly).

**Feature row at Oct 5 14:00 (example values):**
```
hours_since_comp1 = 120h  (5 days since last replacement)
hours_since_comp2 = 1152h (48 days — this is the oldest part)
hours_since_comp3 = 48h   (2 days)
hours_since_comp4 = 312h  (13 days)
volt_mean_24h = 169.4
rotate_mean_24h = 451.2
error4_count_24h = 0
model_model3 = 1
```

**current_comp = comp2** (highest hours_since = 1152h)  
**elapsed_days = 1152 / 24 = 48.0 days**

**Covariate vector X** (21 values, one per fitted covariate column):
`[age=7, volt_mean_24h=169.4, rotate_mean_24h=451.2, ..., comp_comp2=1, model_model3=1, ...]`

**`cumulative_hazard(aft, X, 48.0)`**:
```
aft.predict_cumulative_hazard(X, times=[48.0])
→ H = 0.31
```
risk_score = **0.31** (part is at 31% of its characteristic life — still safe)

**`predict_rul(aft, X, 48.0)`**:
```
Conditional survival curve S(48 + t) / S(48) computed for t = 0..365
50th percentile crossing → rul_days = 94
25th percentile (rul_ci_low) = 31 days
75th percentile (rul_ci_high) = 183+ days
```

**`rul_to_service_date(as_of, rul_days=94, rul_ci_low=31)`**:
```
effective_low = min(31, classifier_implied(prob=0.04)) = 31
days_until = max(0, 31 - 3) = 28
urgency = "soon"
recommended_date = Oct 5 + 28 days = Nov 2, 2015
```

**What you see on screen:**
- Risk score: **0.31 / 1.00** with amber bar
- Badge: **Soon**
- Service card: "Service in ~28 days · by 2 Nov 2015"
- Survival curve: purple line crosses 50% at day 94 (RUL line)
- Risk chart (7d window): small steady climb in H(t) over the last week

---

## 25. Glossary

| Term | Meaning |
|---|---|
| **AFT** | Accelerated Failure Time — survival regression where covariates stretch or shrink lifetime |
| **as_of** | The point in time the dashboard is "looking at" — drives all calculations |
| **AUC-PR** | Area under the Precision-Recall curve — headline metric for imbalanced data |
| **AUC-ROC** | Area under the ROC curve — general classifier performance, less honest for rare events |
| **Censoring** | A component life that ended without an observed failure (right-censored) |
| **Characteristic life λ** | The age at which 63.2% of comparable parts have failed (where H=1) |
| **Class imbalance** | 99:1 ratio of healthy to failure rows — requires `scale_pos_weight` |
| **Covariate** | An input variable in the survival model (sensor averages, error counts, etc.) |
| **Cumulative hazard H(t)** | Accumulated failure "damage" from 0 to t; H=1 = characteristic life = failure threshold |
| **F1** | Harmonic mean of precision and recall |
| **Gradient boosting** | Sequential tree building; each tree corrects prior errors |
| **H(t)** | Cumulative hazard — the risk score in this app |
| **Hazard** | Instantaneous failure rate given survival so far |
| **IQR** | Interquartile range — 25th to 75th percentile (the "typical range" for RUL) |
| **Kaplan-Meier** | Non-parametric survival curve — the grey "typical machine" baseline |
| **Label** | 1 = failure within 12h, 0 = healthy — what the classifier learns |
| **Optuna / TPE** | Bayesian hyperparameter optimization |
| **PdM** | Predictive maintenance |
| **Precision** | Of machines flagged as at-risk, how many really failed |
| **Recall** | Of real failures, how many we caught |
| **Renewal process** | Modelling each component as a series of lives starting at each replacement |
| **RUL** | Remaining Useful Life — days until the survival curve crosses 50% (median residual life) |
| **S(t)** | Survival function — probability still running after t days |
| **scale_pos_weight** | XGBoost parameter to handle class imbalance (~1150 here) |
| **SHAP** | Shapley Additive exPlanations — per-feature contribution to a single prediction |
| **Threshold** | Probability cutoff to flag a machine as "at risk" |
| **TimeSeriesSplit** | Cross-validation that respects time order — no look-ahead leakage |
| **Weibull AFT** | Weibull distribution fitted with AFT regression — the survival model |
| **XGBoost** | Extreme Gradient Boosting — the failure classifier |
