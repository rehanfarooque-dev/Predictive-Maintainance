"""Operations dashboard: fleet-wide failure risk at a chosen moment, with drill-down."""
import pandas as pd
import streamlit as st

from app import explain, plots, scoring_ui

scoring_ui.require_ready()

st.title("📊 Operations Dashboard")

scored = scoring_ui.get_scored()
cfg = scoring_ui.get_config()
horizon = cfg.labeling.horizon_hours
threshold = scoring_ui.get_threshold()
timestamps = scoring_ui.get_timestamps()

# --- As-of timestamp selector ---
as_of = st.select_slider(
    "As-of timestamp (move through the year)",
    options=timestamps,
    value=timestamps[-1],
    format_func=lambda t: pd.Timestamp(t).strftime("%Y-%m-%d %H:%M"),
)
st.caption(
    f"Risk = probability of a failure within the next **{horizon} h**. "
    f"A machine is *at risk* when its risk ≥ the threshold ({threshold:.2f}, set in the sidebar)."
)

snapshot = scored[scored["datetime"] == as_of].copy()
snapshot["at_risk"] = snapshot["risk"] >= threshold
snapshot = snapshot.sort_values("risk", ascending=False)

# --- KPIs ---
c1, c2, c3, c4 = st.columns(4)
c1.metric("Machines monitored", f"{snapshot['machineID'].nunique():,}")
c2.metric("⚠️ Machines at risk", int(snapshot["at_risk"].sum()))
c3.metric("Mean fleet risk", f"{snapshot['risk'].mean():.1%}")
c4.metric("Max risk", f"{snapshot['risk'].max():.1%}")

# --- Fleet ranking ---
left, right = st.columns([3, 2])
with left:
    st.subheader("Fleet ranked by failure risk")
    st.dataframe(
        snapshot[["machineID", "model", "risk", "at_risk", "volt", "rotate", "pressure", "vibration"]]
        .rename(columns={"at_risk": "at risk"}),
        hide_index=True,
        use_container_width=True,
        column_config={"risk": st.column_config.ProgressColumn(
            "risk", min_value=0.0, max_value=1.0, format="%.3f")},
    )
with right:
    st.subheader("Top 15 by risk")
    top = snapshot.head(15).set_index("machineID")["risk"]
    st.bar_chart(top)

# --- Alerts ---
alerts = snapshot[snapshot["at_risk"]]
st.subheader(f"🔔 Active alerts ({len(alerts)})")
if alerts.empty:
    st.success("No machines above the threshold at this timestamp.")
else:
    st.dataframe(
        alerts[["machineID", "model", "risk"]],
        hide_index=True, use_container_width=True,
    )

st.divider()

# --- Single-machine drill-down ---
st.subheader("Machine drill-down")
default_machine = int(snapshot.iloc[0]["machineID"]) if not snapshot.empty else 1
machine_ids = sorted(scored["machineID"].unique())
machine_id = st.selectbox(
    "Machine", machine_ids, index=machine_ids.index(default_machine),
)

machine_df = scored[scored["machineID"] == machine_id].sort_values("datetime")
cur = machine_df[machine_df["datetime"] == as_of]
cur_risk = float(cur["risk"].iloc[0]) if not cur.empty else float("nan")
st.metric(f"Machine {machine_id} risk @ {pd.Timestamp(as_of):%Y-%m-%d %H:%M}", f"{cur_risk:.1%}")

st.markdown("**Predicted risk over time** (red = actual failure window, dotted = as-of)")
st.pyplot(plots.risk_over_time(machine_df, threshold, as_of), use_container_width=True)

st.markdown("**Sensor traces**")
sensor = st.selectbox("Sensor", ["volt", "rotate", "pressure", "vibration"])
st.pyplot(plots.sensor_trace(machine_df, sensor), use_container_width=True)

# --- Why flagged (SHAP for the selected moment) ---
st.markdown(f"**Why is machine {machine_id} scored this way at the as-of moment?**")
features = scoring_ui.get_features_selected()
selected = scoring_ui.get_selected_features()
row = features[(features["machineID"] == machine_id) & (features["datetime"] == as_of)]
if row.empty:
    st.info("No feature row for this machine at the selected timestamp.")
else:
    x_row = row[selected]
    contributions = explain.explain_row(scoring_ui.get_model(), x_row)
    st.bar_chart(contributions, horizontal=True)
    st.caption(
        "SHAP contributions for this single prediction. Positive values push risk up, "
        "negative values pull it down."
    )
