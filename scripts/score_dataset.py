"""Precompute failure-risk scores for the whole dataset for the Streamlit app.

Run AFTER train.py has produced a model. Builds the feature matrix once, scores every
(machine, hour) with the trained model, and writes compact artifacts the web app reads:

  outputs/scored.parquet            display frame (machineID, datetime, risk, label,
                                    sensors, model)
  outputs/features_selected.parquet model-input columns, for SHAP-on-demand
  outputs/scored_meta.json          horizon, model mtime, row count (staleness check)

Usage:
    python scripts/score_dataset.py --config config.yaml
"""
import argparse
import json
import sys
from pathlib import Path

# Make the project root importable when run as a script (python scripts/score_dataset.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.pdm.config import load_config
from src.pdm.data_loader import load_raw_data
from src.pdm.model import load_model
from src.pdm.scoring import build_scored_frame


def main(config_path: str) -> None:
    cfg = load_config(config_path)
    models_dir = Path(cfg.outputs.models_dir)
    reports_dir = Path(cfg.outputs.reports_dir)
    out_dir = models_dir.parent  # outputs/

    model_path = models_dir / "model.joblib"
    selected_path = reports_dir / "selected_features.json"
    if not model_path.exists() or not selected_path.exists():
        sys.exit(
            "Missing trained model or selected_features.json.\n"
            f"  Expected: {model_path}\n            {selected_path}\n"
            "Run the training pipeline first:  python train.py --config config.yaml"
        )

    print("Loading model and data...")
    model = load_model(str(model_path))
    selected_features = json.loads(selected_path.read_text())
    raw = load_raw_data(cfg.data["raw_dir"])

    print(f"Scoring dataset (horizon={cfg.labeling.horizon_hours}h)...")
    scored_df, features_selected_df = build_scored_frame(
        raw,
        model,
        selected_features,
        cfg.labeling.horizon_hours,
        cfg.features.window_hours,
    )

    scored_path = out_dir / "scored.parquet"
    features_path = out_dir / "features_selected.parquet"
    scored_df.to_parquet(scored_path, index=False)
    features_selected_df.to_parquet(features_path, index=False)

    meta = {
        "horizon_hours": cfg.labeling.horizon_hours,
        "n_rows": int(len(scored_df)),
        "n_machines": int(scored_df["machineID"].nunique()),
        "model_mtime": model_path.stat().st_mtime,
        "positive_rate": round(float(scored_df["label"].mean()), 5),
    }
    (out_dir / "scored_meta.json").write_text(json.dumps(meta, indent=2))

    print(f"  {len(scored_df):,} rows scored across {meta['n_machines']} machines")
    print(f"  Wrote {scored_path} ({scored_path.stat().st_size / 1e6:.1f} MB)")
    print(f"  Wrote {features_path} ({features_path.stat().st_size / 1e6:.1f} MB)")
    print("Done. Launch the app with:  streamlit run streamlit_app.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Precompute risk scores for the Streamlit app")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    args = parser.parse_args()
    main(args.config)
