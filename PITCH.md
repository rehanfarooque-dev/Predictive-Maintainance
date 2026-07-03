# PredictMaint — Technical Pitch & Demo (for engineering reviewers)

A predictive-maintenance platform: an ML pipeline (classification + survival analysis) served
by a FastAPI backend behind a Next.js monitoring console. This doc is the **technical**
walkthrough — architecture, methodology, validation, trade-offs, and a demo script.

---

## 1. Problem framing (the ML formulation)

- **Business problem:** move from reactive/preventive to **predictive** maintenance.
- **Two ML problems, one system:**
  1. **Binary classification** — `P(failure within H=12h | machine state at time t)`.
  2. **Survival / time-to-event** — Remaining Useful Life (RUL) per machine.
- **Dataset:** Microsoft Azure PdM (simulated). 100 machines, hourly telemetry for 2015 →
  **876,100 rows**, 761 component failures (comp1–4), error logs, maintenance logs, metadata.
- **Severe class imbalance:** positive rate ≈ **1%** (failures are rare). → metric & loss
  choices matter (see §6, §3).

---

## 2. System architecture

```
            ┌──────────────── offline (3 scripts) ────────────────┐
 raw CSVs ─►│ train.py → model.joblib + reports                   │
            │ score_dataset.py → scored.parquet, features_*.parquet│
            │ build_rul.py → bands.json, survival.joblib, rul.parquet
            └──────────────────────┬───────────────────────────────┘
                                   ▼  (loaded ONCE at startup)
  Next.js 16 (App Router, TS)  ──/api/* rewrite──►  FastAPI (uvicorn)  ── reuses src/pdm/*
   TanStack Query · Zustand · Recharts · Tailwind        ArtifactStore (in-memory)
```

- **Separation of concerns:** heavy compute is **precomputed offline**; the API loads
  artifacts once into an in-memory `ArtifactStore` and serves typed JSON. The frontend holds
  no business logic — it renders API responses.
- **Shared core:** the API imports the same `src/pdm/*` modules used in training — no logic
  duplicated between train and serve.

---

## 3. ML methodology — classification

**Feature engineering** (`src/pdm/features.py`) — all **strictly backward-looking**:
- Rolling sensor stats: {mean, std, min, max} of volt/rotate/pressure/vibration over
  {3,12,24}h (48).
- Rolling error counts: error1–5 over {3,12,24}h (15).
- Maintenance recency: `hours_since_comp1..4` via `merge_asof` (4).
- Metadata: model one-hot + age (5). → ~76 candidates.

**Labeling** (`src/pdm/labels.py`): `y=1` iff a failure occurs in `(t, t+12h]` for that
machine. Forward-looking label, backward-looking features.

**Leakage prevention (explicit, by design):**
- Features never read the future; labels never read the past.
- `PdM_failures.csv` is used **only** to build labels/survival events — never as a feature.
- **Chronological** train/test split (first 80% → train); CV uses **TimeSeriesSplit**
  (expanding window) so validation folds always post-date training folds.

**Model:** `XGBClassifier` (gradient-boosted trees). Imbalance handled with
`scale_pos_weight = N_neg/N_pos ≈ 100`. Objective metric `aucpr`.

**Two-pass feature selection** (`src/pdm/model.py`):
1. Gain importance → drop ~0-gain features.
2. **SHAP** (TreeExplainer) mean|value| → keep **top 20** (`selected_features.json`). The
   surviving set is dominated by `hours_since_comp*`, 24h error counts, and 24h sensor means;
   all 3h windows are dropped.

**HPO:** **Optuna** (TPE / Bayesian) over n_estimators, max_depth, learning_rate, subsample,
colsample; 50 trials (5 in the bundled "smoke" model), each scored by 5-fold TimeSeriesSplit
CV on **AUC-PR**.

---

## 4. ML methodology — risk score (`src/pdm/risk.py`)

A 0–100 operator-facing score blending the validated model with model-free anomaly detection:
- **Normal bands** per machine **model type** = p1–p99 of *healthy* training readings per
  sensor (robust to tails; per-model because operating points differ).
- **Violation severity** (0–100) = `100·(0.5·frac_violating + 0.5·(1−e^(−Σ norm_exceedance/scale)))`
  (count + saturating magnitude).
- **Blend:** `score = 100·(0.6·P_clf + 0.4·severity/100)` — validated signal dominant,
  interpretable anomaly term as corroboration. Components returned separately for the UI.

---

## 5. ML methodology — survival / RUL (`src/pdm/survival.py`)

- **Renewal-process life construction:** because each failure is logged with a same-timestamp
  replacement, naive "time since maintenance" collapses to 0. We define a **life** per
  (machine, component) = replacement → next same-component failure (**event=1**) or next
  replacement / study_end (**right-censored=0**); strict `>` matching + drop ≤0 durations.
- **Model:** **Weibull AFT** (`lifelines.WeibullAFTFitter`) — Weibull captures wear-out
  (increasing hazard, shape k>1); AFT lets covariates (age, 24h sensor means, error counts,
  comp one-hot) accelerate/decelerate the lifetime. Plus a **Kaplan-Meier** baseline per
  component for comparison.
- **RUL** = **conditional median residual life**: from `S(elapsed+t)/S(elapsed)`, the t where
  conditional survival hits 0.5; CI = 5th/95th percentiles; capped at 365d (no Inf/NaN).
- **Service date** = `min(½·RUL, CI_low) − lead_time(3d)` → urgency bucket.

**Subtlety we surface in the UI:** risk score ≠ urgency. A worn part can be "Service now"
(low RUL) with risk score 0 (no imminent anomaly). Two different, complementary signals.

---

## 6. Validation & metrics (`src/pdm/evaluate.py`)

- **Held-out set:** strict chronological **last 20%** of the timeline (never seen in training
  or CV).
- **Primary metric: AUC-PR** (average precision) — the honest metric at 1% positives; AUC-ROC
  is optimistic when negatives dominate.
- **Bundled smoke model:** AUC-PR ≈ **0.914**, AUC-ROC ≈ **0.9996**; recall ≈ **0.99** at
  threshold 0.5. Full 50-trial run reproduces ≈ **0.99** AUC-PR.
- **Per-component:** recall ≈ 0.99 (the meaningful number; precision deflated by design since
  it's a single any-failure model).
- **Operating point:** threshold is a deploy-time decision exposing the precision/recall
  trade-off; the UI shows the live trade-off (`/results/threshold-sweep`).

---

## 7. Backend (`api/`)

- **FastAPI + uvicorn.** `ArtifactStore` loads model, scored parquet, selected-feature parquet,
  bands, survival bundle, reports, a cached `shap.TreeExplainer`, and per-machine slices **once**
  at lifespan startup. Nothing is recomputed per request except the per-as-of inference below.
- **Endpoints:**
  - `GET /health` — readiness + missing-artifact list.
  - `GET /fleet?as_of&threshold&sort_by` — per-machine classification + risk score + **RUL
    recomputed at the chosen timestamp**.
  - `GET /fleet/monitor?as_of` — live snapshot (sensors, 24h vibration window, errors, overdue
    part, risk) for all machines.
  - `GET /machines/{id}?as_of` — drill-down: downsampled timeseries, sensor bands, SHAP
    (single-row), conditional survival curve + KM baseline, RUL + CI.
  - `GET /results/*` — summary, threshold-sweep (live recompute), per-component, plots.
- **Time-accuracy:** `/fleet` recomputes RUL/urgency per `as_of` (100 Weibull evaluations
  ≈ 0.8s), so the dashboard is genuinely a "stand at any point in time" tool, not a frozen
  snapshot. Cached client-side per (as_of, threshold).
- **Reuse:** `scoring.align_to_model_features` / `chronological_test_split`,
  `evaluate.compute_threshold_table`, `risk.*`, `survival.*` — identical code path as offline.

---

## 8. Frontend (`frontend/`)

- **Next.js 16 (App Router) + TypeScript + Tailwind v4.** **TanStack Query** (caching, keyed on
  as_of+threshold, `placeholderData` for flicker-free transitions), **Zustand** (global
  controls + theme), **Recharts** (+ a hand-rolled SVG sparkline). Same-origin `/api/*` rewrite
  → no CORS.
- **Global controls:** Point-in-time (date + hour) and Alert-sensitivity (presets + slider +
  **live precision/recall readout**); persisted light/dark with a no-flash inline script.
- **Pages:** Live Status (12h notifier), Machine Health (classification + drill-down), Service
  Planner (RUL + drill-down), Accuracy (plain trust metrics), Fleet Monitor (live all-machine
  table with sparklines, at-risk row tint, trend arrows, search/type/status filters + sortable
  columns).
- **UX system:** non-technical labels throughout (`prettyFeature` maps `volt_mean_24h` →
  "Avg voltage (last 24h)"), ⓘ info tooltips on every chart, hover tooltips on all graphs,
  graceful loading / not-ready / empty states.

---

## 9. Engineering practices

- **Tests:** `pytest` suite (64) covers config, data_loader, features, labels, model,
  evaluate, scoring, **risk** (band ordering, monotonicity), **survival** (positive durations,
  censoring correctness, RUL CI ordering, capping), and **API** (TestClient over real
  artifacts). Survival tests include a fixture reproducing the failure/replacement
  co-timestamp quirk.
- **Reproducibility:** fixed seeds; deterministic chronological split; config-driven
  (`config.yaml`); artifacts are content-addressable parquet/joblib with a `*_meta.json`
  staleness check (model mtime vs scored mtime → `/health.stale`).
- **Type safety:** TS end-to-end on the client; pydantic-validated query params on the API.

---

## 10. Performance & scaling notes

- Offline: feature matrix build ~seconds; 50-trial Optuna × 5-fold CV dominates train time.
- Serving: artifacts in RAM; `/fleet/monitor` and `/fleet` are O(100) per request; SHAP only
  on 1–few rows interactively; timeseries downsampled to ~1k points for transport.
- Scaling path: the per-as_of RUL recompute is the hot path → memoize/cron-materialize RUL on a
  grid of timestamps, or push to a job queue; swap parquet for a columnar store (DuckDB) and the
  in-memory store for Redis if the fleet grows.

---

## 11. Design decisions & trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| Single "any-failure" classifier | simpler, more positives to learn from | per-component precision deflated (recall still high) |
| AUC-PR as the objective | honest at 1% positives | AUC-ROC looks better in slides |
| Renewal-based Weibull AFT | handles the co-timestamp quirk + gives full distribution | parametric assumption (validated vs KM baseline) |
| Precompute + load-once | fast, consistent serving | artifacts must be regenerated on data/model change |
| Recompute RUL per as_of | true time-travel, not a frozen snapshot | ~0.8s/request (mitigated by client cache) |
| 0.6/0.4 risk-score blend | keep validated signal dominant | weights are a tunable heuristic |

---

## 12. Demo script (≈6 min, technical audience)

1. **Architecture (30s):** "3 offline scripts produce artifacts; FastAPI loads them once;
   Next.js renders. Same `src/pdm` code trains and serves — no drift."
2. **Live Status (45s):** set Point-in-time; "the headline + 12h list come from `/fleet`,
   classification risk at this hour. Move the hour — it refetches and recomputes."
3. **Time-travel proof (30s):** change the date Dec→Jun; "RUL/urgency recompute per timestamp
   — I'll show the same in the API." (`curl /api/fleet?as_of=...`).
4. **Machine Health drill-down (60s):** failure-chance-over-time (spikes = pre-failure 12h
   windows); sensor trace vs p1–p99 band; **SHAP** "what's driving this" — note the additive
   attribution and the dominant `hours_since_comp*`.
5. **Service Planner (60s):** Weibull RUL gauge + **conditional survival curve** vs KM
   baseline; explain censoring and renewal lives; recommended service date math.
6. **Accuracy (45s):** "held-out last-20% chronological split; AUC-PR; threshold sweep is the
   live precision/recall trade-off." Move Alert sensitivity → watch caught/real update.
7. **Fleet Monitor (45s):** all-100 table, 24h sparklines, trend arrows, filters/sort; "one
   `/fleet/monitor` snapshot at the chosen hour."
8. **Engineering (30s):** `pytest` (64 tests incl. leakage/censoring), reproducibility,
   staleness check, scaling path.

---

## 13. How to run

```bash
pip install -r requirements.txt
python train.py --config config.yaml                    # model + reports
python scripts/score_dataset.py --config config.yaml    # scored.parquet
python scripts/build_rul.py --config config.yaml         # bands + survival + rul
python -m uvicorn api.main:app --port 8077 --reload      # backend
cd frontend && npm install && npm run dev                # frontend :3000
pytest                                                   # 64 tests
```

---

## 14. Limitations & productionization roadmap

- **Data is synthetic** → scores are optimistic; validate on real plant telemetry.
- **Daily failure resolution** → 12h labels cluster overnight; `horizon_hours: 24` aligns to
  the data's true resolution.
- **Row-based rolling windows** assume gap-free hourly data; production needs time-based
  windows for irregular sampling.
- **Roadmap:** streaming ingestion (Kafka) + online feature store; model registry + scheduled
  retrain with drift monitoring; per-component survival models; alerting/work-order
  integration; auth + multi-tenant fleets; materialized RUL cache.

---

## 15. Tech stack

**ML/data:** Python, pandas, numpy, scikit-learn, **XGBoost**, **Optuna**, **SHAP**,
**lifelines** (Weibull AFT / Kaplan-Meier), joblib, pyarrow.
**Backend:** FastAPI, uvicorn, pydantic.
**Frontend:** Next.js 16, React 19, TypeScript, Tailwind v4, TanStack Query, Zustand, Recharts.
**Quality:** pytest (64), TimeSeriesSplit CV, chronological holdout, staleness checks.
