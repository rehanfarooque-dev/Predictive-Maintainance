# Risk-Score Flow — "How urgent is this machine?"

Rendered image: [`docs/risk_score_flow.png`](risk_score_flow.png). Editable Mermaid below
(renders on GitHub, VS Code preview, and [mermaid.live](https://mermaid.live)).

![Risk-score flow](risk_score_flow.png)

The Risk Score is the **cumulative hazard implied by the 12-hour classifier probability**:

```
H = −ln(1 − p)          p = P(failure within 12h)
```

This is deliberate: **H = 1.0 exactly when p = 1 − e⁻¹ ≈ 0.63**, which is ~the default alert
threshold. So the Risk Score and the Classification page **can never contradict each other** —
a machine reading "23.4% · Healthy" in Classification reads "H = 0.27 · Healthy" here.

---

## Process flow (Mermaid)

```mermaid
flowchart LR
  subgraph SRC["Source (shared with Classification)"]
    direction TB
    FE["Feature engineering<br/>rolling stats · error counts · part age"]
    XGB["XGBoost classifier"]
  end

  P["p = P(fail within 12h)<br/>0 – 1"]:::in

  subgraph RS["Risk Score"]
    direction TB
    H["Risk score<br/><b>H = −ln(1 − p)</b><br/>(probability → cumulative hazard)"]
    T["Service line: H = 1.0<br/>⇔ p ≈ 0.63 ≈ alert threshold"]
    H --> T
  end

  Q{"p ≥ alert threshold?<br/>(at_risk)"}
  NOW["Service now<br/>overdue"]:::now
  URG["Watch closely<br/>p ≥ 0.30"]:::urg
  SOON["Elevated — monitor<br/>p ≥ 0.10"]:::soon
  PLAN["Healthy<br/>p &lt; 0.10"]:::plan

  UI["Risk Score page<br/>hero · worklist · fleet map · donut · KPIs"]:::ui
  SURV["Survival forecast (supporting)<br/>Weibull AFT → RUL"]:::sup

  FE --> XGB --> P
  P --> RS
  RS --> Q
  Q -- yes --> NOW
  Q -- no --> URG
  Q -- no --> SOON
  Q -- no --> PLAN
  NOW --> UI
  URG --> UI
  SOON --> UI
  PLAN --> UI
  SURV -.-> UI

  classDef in fill:#e0f2fe,stroke:#0284c7,color:#0f172a;
  classDef now fill:#fee2e2,stroke:#dc2626,color:#0f172a;
  classDef urg fill:#ffedd5,stroke:#f97316,color:#0f172a;
  classDef soon fill:#fef3c7,stroke:#f59e0b,color:#0f172a;
  classDef plan fill:#d1fae5,stroke:#10b981,color:#0f172a;
  classDef ui fill:#ede9fe,stroke:#7c3aed,color:#0f172a;
  classDef sup fill:#f1f5f9,stroke:#94a3b8,color:#0f172a;
```

---

## Decision logic at serving time (Mermaid)

```mermaid
flowchart TD
  X["Machine at chosen as-of hour"] --> P["p = classifier P(fail in 12h)"]
  P --> H["H = −ln(1 − p)"]
  H --> Q{"p ≥ alert threshold?"}
  Q -- yes --> NOW["Service now — failure predicted<br/>(H ≥ 1)"]:::hot
  Q -- no --> B{"how high is p?"}
  B -- "p ≥ 0.30" --> URG["Watch closely"]:::warm
  B -- "0.10 ≤ p < 0.30" --> SOON["Elevated — monitor"]:::mild
  B -- "p < 0.10" --> OK["Healthy — no service needed"]:::cool

  classDef hot fill:#fee2e2,stroke:#dc2626,color:#0f172a;
  classDef warm fill:#ffedd5,stroke:#f97316,color:#0f172a;
  classDef mild fill:#fef3c7,stroke:#f59e0b,color:#0f172a;
  classDef cool fill:#d1fae5,stroke:#10b981,color:#0f172a;
```

---

## Mapping table (why it can't contradict)

| Classifier `p` | Risk score `H = −ln(1−p)` | Status |
|---|---|---|
| 1.7% | 0.02 | Healthy |
| 23.4% | 0.27 | Healthy |
| 50% | 0.69 | Elevated |
| **63%** | **0.99 ≈ 1.0** | **service line** |
| 91% | 2.41 | Service now |

---

## Also fitted (backend, supporting / not the headline)

```mermaid
flowchart LR
  L["renewal lives<br/>(replacement → failure / censored)"] --> AFT["Survival forecast<br/>Weibull AFT + covariates → RUL<br/>(shown on the Risk detail page)"]:::sky
  L --> PW["Part-wear cycle<br/>Weibull per component (censored)<br/>comp1 176d · comp2 151d · comp3 214d · comp4 181d"]:::grey
  SC["classifier alarm history"] --> REC["Surrogate recurrence Weibull<br/>λ = 53d, ρ = 1.33<br/>(validated: 100% recall / 95% precision)"]:::grey
  classDef sky fill:#e0f2fe,stroke:#0ea5e9,color:#0f172a;
  classDef grey fill:#f1f5f9,stroke:#94a3b8,color:#0f172a;
```

> The **part-wear cycle** and **surrogate recurrence** Weibulls are still fitted by
> `scripts/build_rul.py` and served in the API, but they **no longer drive the headline Risk
> Score** — they were producing readings that contradicted Classification (e.g. "healthy 23%"
> vs "overdue 4.52"). Only the **survival forecast (AFT → RUL)** is still surfaced, as a
> clearly-labelled supporting view.

---

## Files
- `frontend/src/lib/format.ts` — `clsHazard(p)` (the risk score), `clsUrgency(item)` (the bands)
- `frontend/src/app/risk/page.tsx` — KPIs, donut, fleet map, worklist
- `frontend/src/app/risk/[machineId]/page.tsx` — detail hero + survival forecast
- `src/pdm/survival.py` — AFT / RUL (supporting)
- `src/pdm/maintenance.py`, `src/pdm/surrogate.py` — fitted, not driving the headline

### Render / export
- GitHub & VS Code render ```` ```mermaid ```` automatically.
- Paste a block into <https://mermaid.live> to export SVG/PNG.
- CLI: `npm i -g @mermaid-js/mermaid-cli` → `mmdc -i RISK_SCORE.md -o out.png`.
