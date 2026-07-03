"""Streamlit-cached accessors for the app's data and model.

Thin wrappers around the pure loaders in ``app/artifacts.py`` plus the existing
``src.pdm`` code. Heavy objects (model, raw CSVs) use ``@st.cache_resource``;
file-derived DataFrames use ``@st.cache_data``.
"""
import streamlit as st

from app import artifacts
from src.pdm.config import load_config
from src.pdm.data_loader import load_raw_data
from src.pdm.model import load_model


@st.cache_resource
def get_config():
    return load_config(str(artifacts.CONFIG_PATH))


@st.cache_resource
def get_model():
    return load_model(str(artifacts.MODEL_PATH))


@st.cache_resource
def get_raw_data():
    """Raw CSV dict — only needed by the inference upload path. Loaded once."""
    cfg = get_config()
    raw_dir = artifacts.ROOT / cfg.data["raw_dir"]
    return load_raw_data(str(raw_dir))


@st.cache_data
def get_scored():
    return artifacts.load_scored()


@st.cache_data
def get_features_selected():
    return artifacts.load_features_selected()


@st.cache_data
def get_reports():
    return artifacts.load_reports()


@st.cache_data
def get_selected_features():
    return artifacts.load_selected_features()


@st.cache_data
def get_meta():
    return artifacts.load_meta()


@st.cache_data
def get_timestamps():
    """Sorted unique timestamps in the scored frame (for the as-of selector)."""
    scored = get_scored()
    return sorted(scored["datetime"].unique())


def require_ready():
    """Stop the page with setup instructions if artifacts are missing; warn if stale."""
    status = artifacts.check_artifacts()
    if not status.ready:
        st.error("This page needs generated artifacts that aren't ready yet.")
        missing = []
        if not status.model_exists:
            missing.append("trained model (`outputs/models/model.joblib`)")
        if status.missing_reports:
            missing.append("evaluation reports (`outputs/reports/`)")
        if not status.scored_exists or not status.features_exists:
            missing.append("scored dataset (`outputs/scored.parquet`)")
        st.write("**Missing:** " + ", ".join(missing))
        st.write("Run these from the project root:")
        st.code(
            "\n".join(cmd for _, cmd in artifacts.SETUP_STEPS),
            language="bash",
        )
        st.stop()
    if status.stale:
        st.warning(
            "The model was retrained after the scored dataset was generated. "
            "Re-run `python scripts/score_dataset.py --config config.yaml` to refresh.",
            icon="⚠️",
        )
    return status


def get_threshold() -> float:
    """The app-wide decision threshold set in the sidebar (defaults to 0.5)."""
    return float(st.session_state.get("threshold", 0.5))
