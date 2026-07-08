# Classification Pipeline — "Will this machine fail within 12 hours?"

Rendered image: [`docs/classification_flow.png`](classification_flow.png). Editable Mermaid below
(renders on GitHub, VS Code preview, and [mermaid.live](https://mermaid.live)).

![Classification flow](classification_flow.png)

---

## Process flow (Mermaid)

```mermaid
flowchart LR
  subgraph IN["Raw inputs"]
    direction TB
    T["telemetry"]; E["errors"]; M["maintenance"]; MC["machines"]
  end

  FE["Feature engineering<br/>rolling sensor stats · error counts · part age<br/>(~76 features)"]
  FAIL["failures.csv"]:::label
  LBL["Label<br/>fails within 12h? (1/0)"]:::label

  subgraph TRAIN["Model training · XGBoost (scale_pos_weight in every fit)"]
    direction TB
    S1["1 · chronological 80/20 split (no shuffle)"]
    S2["2 · Pass 1 — gain-importance selection"]
    S3["3 · Optuna tuning (50 trials, 5-fold TimeSeriesSplit CV)"]
    S4["4 · Pass 2 — SHAP selection → top 20"]
    S5["5 · fit final gradient-boosted trees"]
    S1 --> S2 --> S3 --> S4 --> S5
  end

  P["Output<br/>P(fail in next 12h) · 0–1"]:::out
  FLAG["Flag at-risk<br/>P ≥ alert threshold"]:::flag
  SHAP["Explain (SHAP)<br/>which sensors drove it"]:::shap
  EVAL["Evaluate<br/>precision · recall · AUC-PR 0.91"]:::eval

  T --> FE; E --> FE; M --> FE; MC --> FE
  FE --> TRAIN
  FAIL --> LBL --> TRAIN
  TRAIN --> P
  P --> FLAG
  P --> SHAP
  P --> EVAL

  classDef label fill:#ffe4e6,stroke:#f43f5e,color:#0f172a;
  classDef out fill:#e0f2fe,stroke:#0284c7,color:#0f172a;
  classDef flag fill:#fef3c7,stroke:#f59e0b,color:#0f172a;
  classDef shap fill:#ede9fe,stroke:#8b5cf6,color:#0f172a;
  classDef eval fill:#d1fae5,stroke:#10b981,color:#0f172a;
```

---

## The decision logic at serving time (Mermaid)

```mermaid
flowchart TD
  X["Machine at chosen as-of hour"] --> V["Build 20-feature vector<br/>(rolling stats, error counts, part age)"]
  V --> XGB["XGBoost → raw score"]
  XGB --> SIG["sigmoid → P(fail in 12h)"]
  SIG --> Q{"P ≥ alert threshold?"}
  Q -- yes --> FLAG["At risk → show on Classification page"]:::hot
  Q -- no --> OK["Healthy (expected — failures are rare)"]:::cool
  FLAG --> WHY["SHAP: top features pushing risk up / down"]

  classDef hot fill:#ffe4e6,stroke:#f43f5e,color:#0f172a;
  classDef cool fill:#d1fae5,stroke:#10b981,color:#0f172a;
```

---

## Notes

- **No leakage:** every feature looks *backward* (rolling windows, time-since-replacement); the
  label looks *forward* 12 hours. `failures.csv` builds the label only — it is never a model input.
- **Imbalance:** ~0.09% of hours are failures, so a "predict healthy always" model would score
  99.9% accuracy yet be useless. The honest headline metric is **AUC-PR** (0.91), with
  **recall** (failures caught) and **precision** (alerts that are right) reported at the chosen threshold.
- **Why the probability jumps:** XGBoost outputs a raw score passed through a sigmoid — near the
  decision boundary a small change in evidence swings the probability sharply (0 → ~100%), which is
  the desired behaviour for a failure alarm (quiet, then decisive).
- **Files:** `src/pdm/features.py`, `labels.py`, `model.py` (Optuna + selection), `evaluate.py`.

### Render / export
- GitHub & VS Code render ```` ```mermaid ```` automatically.
- Paste a block into <https://mermaid.live> to export SVG/PNG.
- CLI: `npm i -g @mermaid-js/mermaid-cli` → `mmdc -i CLASSIFICATION.md -o out.png`.
