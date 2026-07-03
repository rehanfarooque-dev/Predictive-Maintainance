"""Locate, validate, and load the generated artifacts the Streamlit app depends on.

Pure module (no Streamlit import) so it can be unit-tested directly. Paths are resolved
relative to the repo root, so the app works regardless of the current working directory.
Streamlit caching lives in ``app/scoring_ui.py``, which wraps these loaders.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

CONFIG_PATH = ROOT / "config.yaml"
OUTPUTS_DIR = ROOT / "outputs"
MODELS_DIR = OUTPUTS_DIR / "models"
REPORTS_DIR = OUTPUTS_DIR / "reports"

MODEL_PATH = MODELS_DIR / "model.joblib"
SCORED_PATH = OUTPUTS_DIR / "scored.parquet"
FEATURES_PATH = OUTPUTS_DIR / "features_selected.parquet"
META_PATH = OUTPUTS_DIR / "scored_meta.json"
SELECTED_FEATURES_PATH = REPORTS_DIR / "selected_features.json"

# Core data reports the app needs (PNGs are optional; pages guard them individually).
REQUIRED_REPORTS = [
    "summary.json",
    "best_params.json",
    "selected_features.json",
    "threshold_table.csv",
    "component_metrics.csv",
]
PLOT_REPORTS = ["pr_curve.png", "roc_curve.png", "shap_summary.png", "optuna_history.png"]


@dataclass
class ArtifactStatus:
    model_exists: bool
    missing_reports: List[str] = field(default_factory=list)
    scored_exists: bool = False
    features_exists: bool = False
    stale: bool = False  # model retrained after the scored frame was generated

    @property
    def reports_exist(self) -> bool:
        return not self.missing_reports

    @property
    def ready(self) -> bool:
        """True when every artifact required to run the app is present."""
        return (
            self.model_exists
            and self.reports_exist
            and self.scored_exists
            and self.features_exists
        )


def check_artifacts(
    model_path: Path = MODEL_PATH,
    reports_dir: Path = REPORTS_DIR,
    scored_path: Path = SCORED_PATH,
    features_path: Path = FEATURES_PATH,
) -> ArtifactStatus:
    """Report which artifacts exist and whether the scored frame is stale."""
    model_path = Path(model_path)
    reports_dir = Path(reports_dir)
    scored_path = Path(scored_path)
    features_path = Path(features_path)

    missing_reports = [f for f in REQUIRED_REPORTS if not (reports_dir / f).exists()]
    model_exists = model_path.exists()
    scored_exists = scored_path.exists()
    features_exists = features_path.exists()

    stale = False
    if model_exists and scored_exists:
        stale = model_path.stat().st_mtime > scored_path.stat().st_mtime

    return ArtifactStatus(
        model_exists=model_exists,
        missing_reports=missing_reports,
        scored_exists=scored_exists,
        features_exists=features_exists,
        stale=stale,
    )


# --- Pure loaders (wrapped with Streamlit caching in scoring_ui.py) ---

def load_scored(path: Path = SCORED_PATH) -> pd.DataFrame:
    return pd.read_parquet(path)


def load_features_selected(path: Path = FEATURES_PATH) -> pd.DataFrame:
    return pd.read_parquet(path)


def load_selected_features(path: Path = SELECTED_FEATURES_PATH) -> List[str]:
    return json.loads(Path(path).read_text())


def load_meta(path: Path = META_PATH) -> dict:
    p = Path(path)
    return json.loads(p.read_text()) if p.exists() else {}


def load_reports(reports_dir: Path = REPORTS_DIR) -> Dict[str, object]:
    """Load the JSON/CSV reports into a dict. PNG paths are returned for st.image."""
    reports_dir = Path(reports_dir)
    out: Dict[str, object] = {
        "summary": json.loads((reports_dir / "summary.json").read_text()),
        "best_params": json.loads((reports_dir / "best_params.json").read_text()),
        "selected_features": json.loads((reports_dir / "selected_features.json").read_text()),
        "threshold_table": pd.read_csv(reports_dir / "threshold_table.csv"),
        "component_metrics": pd.read_csv(reports_dir / "component_metrics.csv"),
    }
    out["plots"] = {
        name: str(reports_dir / name)
        for name in PLOT_REPORTS
        if (reports_dir / name).exists()
    }
    return out


SETUP_STEPS = [
    ("Install dependencies", "pip install -r requirements.txt"),
    ("Train the model", "python train.py --config config.yaml"),
    ("Score the dataset", "python scripts/score_dataset.py --config config.yaml"),
    ("Launch the app", "streamlit run streamlit_app.py"),
]
