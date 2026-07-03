# Predictive Maintenance PoC

Predicts machine failures before they happen from sensor telemetry, error logs, and
maintenance history. Built on the
[Microsoft Azure Predictive Maintenance dataset](https://www.kaggle.com/datasets/arnabbiswas1/microsoft-azure-predictive-maintenance)
(100 machines, one year of hourly telemetry, 761 component failures).

Given the last 24 hours of a machine's behavior, the model flags machines that will
fail within the next `horizon_hours` (configurable, default 12), so maintenance can be
scheduled before the breakdown.

## Setup

### 1. Create and activate a virtual environment

Requires Python 3.10+.

```bash
cd predictive-poc
python3 -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Data

The dataset ships with the repo in `data/raw/` — no download needed. Five CSVs:

| File | Contents |
|---|---|
| `PdM_telemetry.csv` | Hourly volt / rotate / pressure / vibration readings per machine |
| `PdM_errors.csv` | Non-breaking error code events (error1–5) |
| `PdM_maint.csv` | Component replacement records (comp1–4) |
| `PdM_failures.csv` | Component failure events — the prediction target |
| `PdM_machines.csv` | Machine model type and age |

## Running

### Full training pipeline

```bash
python train.py --config config.yaml
```

This runs end to end: feature engineering → labeling → chronological train/test split →
pass-1 feature selection → Optuna hyperparameter tuning → pass-2 SHAP feature
selection → final training → evaluation. Takes several minutes (50 Optuna trials with
5-fold CV dominate the runtime).

Outputs:

- `outputs/models/model.joblib` — trained XGBoost classifier
- `outputs/reports/` — metrics and plots:
  `summary.json`, `best_params.json`, `selected_features.json`,
  `pr_curve.png`, `roc_curve.png`, `shap_summary.png`, `optuna_history.png`,
  `threshold_table.csv`, `component_metrics.csv`

### Notebooks

```bash
jupyter notebook notebooks/
```

| Notebook | What it covers |
|---|---|
| `01_eda.ipynb` | Raw telemetry, failure distribution, label prevalence |
| `02_feature_engineering.ipynb` | Rolling features visualized against failure windows |
| `03_model_training.ipynb` | Chronological CV folds, Optuna tuning, feature selection |
| `04_evaluation.ipynb` | PR/threshold trade-off curves, per-component metrics |

Notebooks 01–03 recompute from raw data; notebook 04 reads the artifacts produced by
`train.py`, so run the pipeline first.

### Web app (Next.js + FastAPI)

A two-layer web app: a **FastAPI** backend that serves the trained model + survival/RUL
engine, and a **Next.js** dashboard for a business user. It has two views over the fleet —
**classification** (will-fail / healthy) and **risk score → RUL** (remaining useful life
via Weibull survival analysis), surfaced as a maintenance *notifier* ("service machine 42
in ~6 days").

Run from the project root, in order:

```bash
pip install -r requirements.txt
python train.py --config config.yaml                   # model + reports
python scripts/score_dataset.py --config config.yaml   # per-machine-hour risk scores
python scripts/build_rul.py --config config.yaml        # sensor bands + Weibull survival + rul.parquet
python -m uvicorn api.main:app --port 8077              # backend API  (http://localhost:8077/api)
# in a second terminal:
cd frontend && npm install && npm run dev               # dashboard    (http://localhost:3000)
```

The backend loads all artifacts once at startup and never recomputes features per request.
The frontend proxies `/api/*` to the backend (set `API_PROXY_TARGET` if not on port 8077).

| View | What it does |
|---|---|
| Overview | Maintenance worklist ranked by urgency + fleet KPIs — the at-a-glance notifier |
| Classification | Fleet ranked by failure probability; per-machine sensor traces, risk-over-time, SHAP |
| Risk & RUL | Per-machine survival curve + confidence band, Weibull RUL gauge, recommended service date, per-sensor violation breakdown, risk-score composition |
| Model performance | AUC metrics, PR/ROC/SHAP plots, live threshold slider, per-component metrics |
| Inference | Pick a machine + time, or upload telemetry CSV → prediction + risk score + RUL + SHAP |

> The earlier Streamlit app (`streamlit_app.py`, `app/pages/`) is **superseded** by this
> Next.js + FastAPI app and kept only for reference; its loaders in `app/artifacts.py` are
> still reused by the backend.

### Tests

```bash
pytest
```

## How it works

```
PdM_telemetry.csv ─┐
PdM_machines.csv  ─┤  build_base_dataframe
PdM_errors.csv    ─┼─ build_feature_matrix ──► features (rolling stats, error counts,
PdM_maint.csv     ─┘                            maintenance recency, machine metadata)
PdM_failures.csv  ──── make_labels ──────────► label = failure within next horizon_hours
```

1. **Features** (`src/pdm/features.py`) — all strictly backward-looking:
   - Rolling mean/std/min/max of the four sensors (volt, rotate, pressure, vibration)
     over 3h / 12h / 24h windows.
   - Rolling counts of each non-breaking error code (error1–5) per window.
   - `hours_since_compX`: time since each component was last replaced
     (8760h sentinel if no record).
   - One-hot machine model type.
2. **Labels** (`src/pdm/labels.py`) — a row is positive if that machine has a failure
   in the next `horizon_hours`. Labels look only forward; features look only backward;
   failures never enter the feature matrix (no target leakage).
3. **Split** — strict chronological 80/20; no future data ever trains the past.
   Cross-validation uses `TimeSeriesSplit` for the same reason.
4. **Model** (`src/pdm/model.py`) — XGBoost with class-imbalance weighting, tuned by
   Optuna (50 trials, optimizing AUC-PR) and pruned by two-pass feature selection:
   gain-importance filter, then SHAP top-20.
5. **Evaluation** (`src/pdm/evaluate.py`) — PR/ROC curves, threshold sweep table,
   per-component metrics, SHAP summary plot.

## Results (12h horizon, held-out final 20% of the timeline)

| Metric | Value |
|---|---|
| AUC-PR | 0.994 |
| AUC-ROC | 0.9999 |
| Precision @ 0.5 threshold | ~91% |
| Recall @ 0.5 threshold | ~99% |

The decision threshold trades precision against recall — see
`outputs/reports/threshold_table.csv` for the full sweep.

> This is a synthetic dataset simulated to be learnable; published benchmarks on it are
> also in the 0.99+ range. Expect lower numbers on real-world data.

The most important features (per SHAP): component age (`hours_since_comp1..4`),
error-code counts over the last 24h, and 12–24h rolling sensor means. All 3h-window
features were dropped by feature selection.

## Configuration (`config.yaml`)

| Key | Default | Meaning |
|---|---|---|
| `labeling.horizon_hours` | 12 | How far ahead to predict |
| `features.window_hours` | [3, 12, 24] | Rolling-window sizes for sensor/error features |
| `features.top_n_features` | 20 | Features kept after SHAP selection |
| `model.tuning.n_trials` | 50 | Optuna trials |
| `evaluation.test_size_pct` | 0.20 | Chronological holdout fraction |

## Data caveats

- **Failure timestamps have daily resolution.** ~98% of failures (and all maintenance
  records) are stamped at 06:00, so with a 12h horizon, positive labels only occur in
  the overnight window before the morning failure record. Setting
  `labeling.horizon_hours: 24` aligns the prediction window with the data's true daily
  resolution.
- **Per-component precision in `component_metrics.csv` is low by construction.** This
  is a single binary "any failure" model; a correct alert for a comp2 failure counts as
  a false positive in the comp1/3/4 rows of that table. Per-component recall (~98–99%)
  is the meaningful number there.
- **Rolling windows are row-based** (`rolling(12)` = 12 rows). That equals 12 hours
  here because the telemetry is perfectly hourly with zero gaps; data with gaps or
  irregular sampling would need time-based windows (`rolling("12h")`).

## Project structure

```
config.yaml                 # all knobs in one place
train.py                    # end-to-end training pipeline entry point
scripts/
  download_data.py          # (optional) re-fetch dataset from Kaggle
  score_dataset.py          # precompute per-machine-hour risk scores
  build_rul.py              # fit sensor bands + Weibull survival, write rul.parquet
src/pdm/
  data_loader.py            # load CSVs, build base frame
  features.py               # feature engineering
  labels.py                 # forward-looking label construction
  model.py                  # selection, Optuna tuning, training
  evaluate.py               # metrics, plots, threshold/component tables
  scoring.py                # score full dataset + reproduce train/test split
  risk.py                   # sensor-violation risk score (0-100)
  survival.py               # renewal-based Weibull RUL (time-to-event)
api/                        # FastAPI backend (loads artifacts once, serves JSON)
  main.py · store.py · deps.py · config.py · routers/
frontend/                   # Next.js + TypeScript dashboard (the UI)
  src/app/                  # routes: overview, classification, risk, metrics, inference
  src/components/ · src/lib/
app/                        # legacy Streamlit app (superseded; loaders reused by api/)
notebooks/01-04*.ipynb      # EDA -> features -> training -> evaluation
tests/                      # pytest suite (incl. test_risk, test_survival, test_api)
outputs/                    # model + reports + scored/rul artifacts (generated)
```
