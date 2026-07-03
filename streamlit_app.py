"""Predictive Maintenance — Streamlit app entry point.

Run from the project root:

    streamlit run streamlit_app.py

Defines navigation across the Home checklist and the three feature pages, and the
app-wide decision-threshold slider in the sidebar.
"""
import sys
from pathlib import Path

# Ensure the project root is importable (app.*, src.pdm.*) regardless of cwd.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import streamlit as st

from app import artifacts

st.set_page_config(page_title="Predictive Maintenance", page_icon="🔧", layout="wide")


def home():
    st.title("🔧 Predictive Maintenance")
    st.markdown(
        "Predicts machine failures **before they happen** from sensor telemetry, error "
        "logs, and maintenance history. Use the pages in the sidebar to monitor the "
        "fleet, explore model quality, and run predictions."
    )

    status = artifacts.check_artifacts()
    st.subheader("Setup status")

    def row(label, ok, hint=""):
        icon = "✅" if ok else "❌"
        st.markdown(f"{icon} **{label}**" + (f" — {hint}" if hint and not ok else ""))

    row("Trained model", status.model_exists, "run `python train.py --config config.yaml`")
    row(
        "Evaluation reports",
        status.reports_exist,
        f"missing: {', '.join(status.missing_reports)}" if status.missing_reports else "",
    )
    row(
        "Scored dataset",
        status.scored_exists and status.features_exists,
        "run `python scripts/score_dataset.py --config config.yaml`",
    )

    if status.ready and status.stale:
        st.warning(
            "Model is newer than the scored dataset — re-run scoring to refresh.", icon="⚠️"
        )

    if status.ready:
        st.success("All artifacts ready. Open a page from the sidebar.")
    else:
        st.info("Complete the steps below (in order) from the project root, then reload.")

    st.subheader("Setup commands")
    for i, (label, cmd) in enumerate(artifacts.SETUP_STEPS, 1):
        st.markdown(f"**{i}. {label}**")
        st.code(cmd, language="bash")
    st.caption(
        "Training runs 50 Optuna trials with 5-fold CV and takes several minutes — "
        "best run in a terminal."
    )


# Sidebar: app-wide decision threshold, shared by every page via session_state.
st.sidebar.header("Settings")
st.sidebar.slider(
    "Decision threshold",
    min_value=0.05,
    max_value=0.95,
    value=st.session_state.get("threshold", 0.5),
    step=0.05,
    key="threshold",
    help="Probability cutoff for flagging a machine as 'will fail'.",
)

pages = [
    st.Page(home, title="Home", icon="🏠", default=True),
    st.Page("app/pages/1_Operations_Dashboard.py", title="Operations Dashboard", icon="📊"),
    st.Page("app/pages/2_Results_Explorer.py", title="Results Explorer", icon="📈"),
    st.Page("app/pages/3_Inference_Tool.py", title="Inference Tool", icon="🔮"),
]
st.navigation(pages).run()
