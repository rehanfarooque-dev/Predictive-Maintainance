# tests/test_app_artifacts.py
import json
import os

import pandas as pd

from app import artifacts


def test_check_artifacts_all_missing(tmp_path):
    status = artifacts.check_artifacts(
        model_path=tmp_path / "model.joblib",
        reports_dir=tmp_path / "reports",
        scored_path=tmp_path / "scored.parquet",
        features_path=tmp_path / "features.parquet",
    )
    assert not status.model_exists
    assert not status.scored_exists
    assert not status.features_exists
    assert not status.ready
    assert set(status.missing_reports) == set(artifacts.REQUIRED_REPORTS)


def test_check_artifacts_ready_and_stale(tmp_path):
    reports = tmp_path / "reports"
    reports.mkdir()
    for f in artifacts.REQUIRED_REPORTS:
        (reports / f).write_text("{}")
    scored = tmp_path / "scored.parquet"
    features = tmp_path / "features.parquet"
    pd.DataFrame({"a": [1]}).to_parquet(scored)
    pd.DataFrame({"a": [1]}).to_parquet(features)
    model = tmp_path / "model.joblib"
    model.write_text("x")

    # Force the model to look newer than the scored frame.
    scored_mtime = model.stat().st_mtime - 100
    os.utime(scored, (scored_mtime, scored_mtime))

    status = artifacts.check_artifacts(model, reports, scored, features)
    assert status.ready
    assert status.reports_exist
    assert status.stale


def test_load_reports_roundtrip(tmp_path):
    reports = tmp_path / "reports"
    reports.mkdir()
    (reports / "summary.json").write_text(json.dumps({"auc_pr": 0.9, "horizon_hours": 12}))
    (reports / "best_params.json").write_text(json.dumps({"max_depth": 3}))
    (reports / "selected_features.json").write_text(json.dumps(["a", "b"]))
    pd.DataFrame({"threshold": [0.5], "precision": [1.0], "recall": [1.0], "f1": [1.0]}).to_csv(
        reports / "threshold_table.csv", index=False
    )
    pd.DataFrame(
        {"component": ["comp1"], "precision": [1.0], "recall": [1.0], "f1": [1.0], "n_failures": [1]}
    ).to_csv(reports / "component_metrics.csv", index=False)

    out = artifacts.load_reports(reports)
    assert out["summary"]["auc_pr"] == 0.9
    assert out["best_params"]["max_depth"] == 3
    assert out["selected_features"] == ["a", "b"]
    assert isinstance(out["threshold_table"], pd.DataFrame)
    assert isinstance(out["component_metrics"], pd.DataFrame)
    assert out["plots"] == {}  # no PNGs in tmp reports dir
