# Sentinel — Process & Architecture

Block-level representation of the predictive-maintenance system. A rendered image is at
[`docs/pipeline.png`](pipeline.png); the Mermaid sources below are editable and render on GitHub,
in VS Code (Markdown preview), and at [mermaid.live](https://mermaid.live).

![Pipeline](pipeline.png)

---

## 1 · End-to-end pipeline

```mermaid
flowchart LR
  %% ---- raw ----
  subgraph RAW["Raw data · 5 CSVs"]
    T["telemetry<br/>876k hourly rows"]
    E["errors"]
    M["maintenance"]
    MC["machines"]
    F["failures<br/>(label only)"]
  end

  %% ---- features ----
  FE["Feature engineering<br/>rolling stats · error counts · part age<br/>~76 → top 20"]

  %% ---- models ----
  subgraph MODELS["Models"]
    direction TB
    C["① Classifier · XGBoost<br/>P(fail within 12h)"]
    W["② Risk · part-wear cycle<br/>Weibull on censored lives → H(t)"]
    S["③ Risk · surrogate recurrence<br/>Weibull on classifier alarms → H(t)"]
  end

  DEC{"Decision<br/>flag if P ≥ threshold<br/>service if H ≥ 1"}
  UI["Dashboard<br/>Classification · Risk Score"]

  T --> FE
  E --> FE
  M --> FE
  MC --> FE
  FE --> C
  FE --> W
  FE --> S
  F -. labels / fit only .-> C
  F -. renewal lives .-> W
  C -. surrogate events .-> S
  C --> DEC
  W --> DEC
  S --> DEC
  DEC --> UI

  classDef raw fill:#e2e8f0,stroke:#94a3b8,color:#0f172a;
  classDef feat fill:#e0e7ff,stroke:#6366f1,color:#0f172a;
  classDef cls fill:#e0f2fe,stroke:#0ea5e9,color:#0f172a;
  classDef wear fill:#d1fae5,stroke:#10b981,color:#0f172a;
  classDef rec fill:#ede9fe,stroke:#8b5cf6,color:#0f172a;
  classDef dec fill:#fef3c7,stroke:#f59e0b,color:#0f172a;
  classDef ui fill:#ffe4e6,stroke:#f43f5e,color:#0f172a;
  class T,E,M,MC,F raw;
  class FE feat;
  class C cls;
  class W wear;
  class S rec;
  class DEC dec;
  class UI ui;
```

---

## 2 · Two-model decision flow (what happens at a chosen "as-of" hour)

```mermaid
flowchart TD
  X["Pick a point in time (as-of hour)"] --> FEAT["Build feature vector for each machine"]

  FEAT --> CLS["Classifier → P(fail in 12h)"]
  FEAT --> RISK["Risk score H(t)<br/>(part-wear cycle + recurrence since last predicted failure)"]

  CLS --> Q1{"P ≥ alert threshold?"}
  RISK --> Q2{"H(t) ≥ 1.0?"}

  Q1 -- yes --> ACUTE["Acute alarm → Service now"]
  Q1 -- no --> OKC["Not flagged"]
  Q2 -- yes --> DUE["Cycle reached → Service due"]
  Q2 -- no --> PLAN["Time-to-service = days until H = 1"]

  ACUTE --> OUT["Maintenance recommendation<br/>(soonest signal wins)"]
  DUE --> OUT
  PLAN --> OUT
  OKC --> OUT

  classDef q fill:#fef3c7,stroke:#f59e0b,color:#0f172a;
  classDef act fill:#ffe4e6,stroke:#f43f5e,color:#0f172a;
  classDef ok fill:#d1fae5,stroke:#10b981,color:#0f172a;
  class Q1,Q2 q;
  class ACUTE,DUE,OUT act;
  class OKC,PLAN ok;
```

---

## 3 · Offline build vs online serving

```mermaid
flowchart LR
  subgraph OFFLINE["Offline · run once → outputs/"]
    direction TB
    A1["train.py<br/>XGBoost + Optuna + SHAP"] --> A2["scripts/score_dataset.py<br/>score every machine-hour"]
    A2 --> A3["scripts/build_rul.py<br/>Weibull cycles + surrogate + validation"]
  end

  OFFLINE --> ART[("outputs/<br/>model.joblib · scored.parquet<br/>survival.joblib · rul.parquet")]

  subgraph ONLINE["Online · per request"]
    direction TB
    B1["FastAPI (api/)<br/>load artifacts once"] --> B2["re-score chosen as-of hour"]
    B2 --> B3["Next.js dashboard<br/>Classification · Risk Score"]
  end

  ART --> B1

  classDef off fill:#f1f5f9,stroke:#94a3b8,color:#0f172a;
  classDef on fill:#fef2f2,stroke:#fecaca,color:#0f172a;
  classDef art fill:#e0e7ff,stroke:#6366f1,color:#0f172a;
  class A1,A2,A3 off;
  class B1,B2,B3 on;
  class ART art;
```

---

## 4 · Data model (how the tables join)

```mermaid
erDiagram
  MACHINES ||--o{ TELEMETRY : "machineID"
  MACHINES ||--o{ ERRORS : "machineID"
  MACHINES ||--o{ MAINTENANCE : "machineID"
  MACHINES ||--o{ FAILURES : "machineID"

  MACHINES {
    int machineID PK
    string model "Type 1-4"
    int age "years"
  }
  TELEMETRY {
    datetime datetime
    int machineID FK
    float volt
    float rotate
    float pressure
    float vibration
  }
  ERRORS {
    datetime datetime
    int machineID FK
    string errorID "error1-5"
  }
  MAINTENANCE {
    datetime datetime
    int machineID FK
    string comp "comp1-4"
  }
  FAILURES {
    datetime datetime
    int machineID FK
    string failure "comp1-4 (LABEL)"
  }
```

---

### How to render / export

- **GitHub / VS Code:** the ```` ```mermaid ```` blocks render automatically (VS Code needs the
  built-in Markdown preview, or the "Markdown Preview Mermaid Support" extension).
- **Live editor / PNG-SVG export:** paste a block into <https://mermaid.live> and export.
- **CLI export:** `npm i -g @mermaid-js/mermaid-cli` then `mmdc -i ARCHITECTURE.md -o out.png`.
- **Ready-made image:** [`docs/pipeline.png`](pipeline.png) (also at `outputs/reports/pipeline.png`).
