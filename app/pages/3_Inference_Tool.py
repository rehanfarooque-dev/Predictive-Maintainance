"""Inference tool: get a failure prediction for a machine, by lookup or from an upload."""
import numpy as np
import pandas as pd
import streamlit as st

from app import explain, scoring_ui
from src.pdm.data_loader import build_base_dataframe
from src.pdm.features import build_feature_matrix
from src.pdm.scoring import SENSOR_COLS, align_to_model_features

scoring_ui.require_ready()

st.title("🔮 Inference Tool")

threshold = scoring_ui.get_threshold()
model = scoring_ui.get_model()
selected = scoring_ui.get_selected_features()


def show_prediction(risk: float):
    predicted = risk >= threshold
    c1, c2 = st.columns(2)
    c1.metric("Failure probability", f"{risk:.1%}")
    c2.metric("Prediction", "⚠️ WILL FAIL" if predicted else "✅ healthy",
              help=f"risk {'≥' if predicted else '<'} threshold {threshold:.2f}")


mode = st.radio(
    "Input mode",
    ["Pick a machine & time", "Upload telemetry CSV"],
    horizontal=True,
)

# --- Mode A: lookup from the precomputed scores (instant) ---
if mode == "Pick a machine & time":
    scored = scoring_ui.get_scored()
    features = scoring_ui.get_features_selected()
    machine_ids = sorted(scored["machineID"].unique())
    timestamps = scoring_ui.get_timestamps()

    col1, col2 = st.columns(2)
    machine_id = col1.selectbox("Machine", machine_ids)
    ts = col2.select_slider(
        "Timestamp", options=timestamps, value=timestamps[-1],
        format_func=lambda t: pd.Timestamp(t).strftime("%Y-%m-%d %H:%M"),
    )

    row = scored[(scored["machineID"] == machine_id) & (scored["datetime"] == ts)]
    if row.empty:
        st.warning("No reading for that machine at that timestamp.")
    else:
        show_prediction(float(row["risk"].iloc[0]))
        frow = features[(features["machineID"] == machine_id) & (features["datetime"] == ts)]
        if not frow.empty:
            st.markdown("**Why this prediction (SHAP)**")
            st.bar_chart(explain.explain_row(model, frow[selected]), horizontal=True)

# --- Mode B: build features live from an uploaded CSV ---
else:
    st.markdown(
        "Upload an hourly telemetry CSV with columns: "
        "`datetime, machineID, volt, rotate, pressure, vibration`. "
        "Rows must be contiguous hourly with at least 24 leading rows per machine "
        "(rolling features are row-based)."
    )
    uploaded = st.file_uploader("Telemetry CSV", type="csv")
    if uploaded is not None:
        cfg = scoring_ui.get_config()
        raw = scoring_ui.get_raw_data()
        telemetry = pd.read_csv(uploaded, parse_dates=["datetime"])

        required = {"datetime", "machineID", *SENSOR_COLS}
        missing_cols = required - set(telemetry.columns)
        if missing_cols:
            st.error(f"CSV is missing columns: {sorted(missing_cols)}")
            st.stop()

        mids = telemetry["machineID"].unique()
        known = set(raw["machines"]["machineID"])
        if not set(mids).issubset(known):
            st.warning(
                "Some machineIDs are not in the project's machine list; their model type "
                "and maintenance history will be unknown (features default to sentinel/zero)."
            )

        # Validate hourly contiguity and length per machine.
        for mid in mids:
            tm = telemetry[telemetry["machineID"] == mid].sort_values("datetime")
            if len(tm) < max(cfg.features.window_hours):
                st.warning(f"Machine {mid}: only {len(tm)} rows — features may be unreliable.")
            gaps = tm["datetime"].diff().dropna() != pd.Timedelta(hours=1)
            if gaps.any():
                st.warning(f"Machine {mid}: telemetry has non-hourly gaps — features may be wrong.")

        sub_raw = {
            "telemetry": telemetry,
            "machines": raw["machines"][raw["machines"]["machineID"].isin(mids)],
            "errors": raw["errors"][raw["errors"]["machineID"].isin(mids)],
            "maint": raw["maint"][raw["maint"]["machineID"].isin(mids)],
            "failures": raw["failures"][raw["failures"]["machineID"].isin(mids)],
        }
        base = build_base_dataframe(sub_raw)
        feats = build_feature_matrix(base, sub_raw["errors"], sub_raw["maint"], cfg.features.window_hours)
        feats = feats.sort_values("datetime").reset_index(drop=True)
        X = align_to_model_features(feats, selected)
        risk = model.predict_proba(X)[:, 1]

        result = feats[["machineID", "datetime"]].copy()
        result["risk"] = risk
        result["prediction"] = np.where(risk >= threshold, "WILL FAIL", "healthy")
        st.subheader("Predictions")
        st.dataframe(result, hide_index=True, use_container_width=True)

        st.markdown("**Explain a row (SHAP)**")
        idx = st.number_input(
            "Row index", min_value=0, max_value=len(result) - 1, value=len(result) - 1, step=1,
        )
        show_prediction(float(risk[idx]))
        st.bar_chart(explain.explain_row(model, X.iloc[[idx]]), horizontal=True)
