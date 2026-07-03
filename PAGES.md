# PredictMaint — Page-by-Page Overview

## How the data flows

```
Raw sensor CSV  →  train.py  →  model.joblib
                →  scripts/score_dataset.py  →  scored.parquet
                →  scripts/build_rul.py      →  rul.parquet + bands.json + survival.joblib
                →  uvicorn api/main.py       →  REST API (:8077)
                →  Next.js frontend (:3000)  →  all pages below
```

---

## 1. Live Status `/`

**What it shows:** High-level fleet summary — how many machines are healthy, at-risk, or need service right now.

**How it calculates:**
- Reads `rul.parquet` (pre-scored at build time)
- Groups machines by `urgency` field: `overdue / urgent / soon / planned`
- Shows a maintenance worklist sorted by urgency (soonest service first)

---

## 2. Machine Health `/classification`

**What it shows:** Table of all 100 machines with their 12-hour failure probability from the XGBoost classifier.

**How it calculates:**
- Model: `XGBoostClassifier` trained on rolling 24h sensor features (mean voltage, rotation, pressure, vibration + error counts + part age)
- Label: `1` if a failure occurs within the next 12 hours, `0` otherwise
- Output: `classifier_risk` = probability 0–1; compared against the threshold slider (default 0.50) to flag as "at risk" or "healthy"
- Threshold slider (ALERTS control in the header) lets you trade precision vs recall live

**Drill-down `/classification/[id]`:**
- Sensor time-series with normal band shading
- Risk-over-time chart showing how classifier probability evolved
- SHAP top features — which sensors/errors drove the prediction

---

## 3. Fleet Monitor `/inference`

**What it shows:** Live table of all machines with current sensor readings benchmarked against their model's normal range. Clickable KPI cards filter the table.

**How it calculates:**
- **Normal bands** (`bands.json`): For each machine model (Type 1–4), the p1–p99 range of each sensor is computed from *healthy-only, training-slice rows* — so "normal" reflects what that model type looks like when healthy
- **Sensor dots** (green/amber/red): Each reading is compared to its model's band:
  - Green = within band
  - Amber = 0–20% outside band
  - Red = >20% outside band
- **KPI cards**: "At risk now" counts machines where `classifier_risk ≥ threshold`; "Machines with errors" counts machines with any error code in the last 24h; "Out of band" counts machines with ≥1 sensor outside normal range

---

## 4. Service Planner `/risk`

**What it shows:** Every machine ranked by how urgently it needs maintenance, with a recommended service date.

**How it calculates urgency:**

| Label | Condition |
|---|---|
| **Service now** (overdue) | Classifier probability ≥ threshold OR `days_until_service ≤ 0` |
| **Urgent** | Service needed in < 7 days |
| **Soon** | Service needed in < 30 days |
| **Planned** | Healthy, service scheduled far out |

**How the service date is calculated (`survival.py → rul_to_service_date`):**
1. **Weibull AFT model** predicts the conditional median remaining life (`rul_days`) given current sensor readings and part age
2. The **lower bound** (`rul_ci_low_days` = 25th-percentile life) is used — not the median — so you book in before even the early-failing comparable machines fail
3. `days_until_service = max(0, rul_ci_low_days − 3)` (3-day maintenance lead time)
4. If the classifier flags the machine as failing within 12h, `days_until_service` is forced to 0 → "Service now"

**Drill-down `/risk/[id]`:**
- Estimated time left gauge (median RUL)
- Typical range (interquartile: 25th–75th percentile life)
- Survival curve: probability the machine is still running N days from now
- Risk score composition (see below)
- Per-sensor deviation bars

---

## 5. Risk Score (used across pages)

**Formula (0–100):**
```
risk_score = 50% × classifier_risk_scaled
           + 20% × sensor_violation_severity
           + 30% × part_wear
```

| Component | Meaning |
|---|---|
| **Classifier risk (50%)** | XGBoost 12h failure probability, scaled 0–100 |
| **Sensor violation severity (20%)** | How far out-of-band sensors are, averaged across all 4 sensors |
| **Part wear (30%)** | `elapsed_days ÷ expected_part_life` — how much of the oldest part's expected life is already used up |

Part wear ensures machines with very old parts carry some risk even when all sensors look fine.

---

## 6. Accuracy `/metrics`

**What it shows:** How well the XGBoost classifier performs — did it catch real failures without crying wolf too much?

**How it calculates:**
- Runs on the held-out **chronological test split** (last 20% of time — no data leakage)
- Threshold sweep: for each threshold 0.0–1.0, computes Precision, Recall, F1
- Per-component breakdown: separate F1 for each part type (comp1–comp4)
- Feature importance: which engineered features matter most

---

## 7. Survival Model (RUL engine, used by Service Planner)

**What it is:** A Weibull Accelerated Failure Time (AFT) model from the `lifelines` library.

**How it's trained:**
1. Each part replacement starts a "life"; it ends at the next same-part failure (event=1) or next replacement / end of data (censored=0)
2. Covariates attached at life-start: sensor 24h means, error counts, part age, machine model one-hot
3. Weibull AFT fits a covariate-conditioned lifetime distribution

**How RUL is read off:**
- `rul_days` = day where 50% of comparable machines have already failed (median)
- `rul_ci_low_days` = day where 25% have failed (early end of "typical range") → drives the service date
- `rul_ci_high_days` = day where 75% have failed (late end of "typical range")
- Healthy machines with no failure signal are capped at 365 days (`is_capped = true`)

---

## Data range

The dataset covers **January 2015 – January 2016** (100 machines, hourly readings). The Point-in-Time control in the header lets you travel through this history; the backend snaps to the nearest hourly reading.
