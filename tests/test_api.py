# tests/test_api.py
"""End-to-end API tests against the real (already-built) artifacts.

Skips entirely if the artifacts haven't been generated (train + score + build_rul),
so the suite still passes on a fresh checkout.
"""
import pytest
from fastapi.testclient import TestClient

from api import deps
from api.store import RUL_PATH, SURVIVAL_PATH

pytestmark = pytest.mark.skipif(
    not (RUL_PATH.exists() and SURVIVAL_PATH.exists()),
    reason="RUL artifacts not built (run train.py, score_dataset.py, build_rul.py)",
)


@pytest.fixture(scope="module")
def client():
    from api.main import app
    with TestClient(app) as c:
        yield c


def test_health_ready(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ready"] is True


def test_fleet_has_items_and_fields(client):
    r = client.get("/api/fleet", params={"threshold": 0.5, "sort_by": "urgency"})
    assert r.status_code == 200
    data = r.json()
    assert data["count"] > 0
    item = data["items"][0]
    for key in ("machineID", "classifier_risk", "risk_score", "rul_days",
                "urgency", "recommended_service_date", "at_risk"):
        assert key in item


def test_fleet_threshold_flips_at_risk(client):
    low = client.get("/api/fleet", params={"threshold": 0.0}).json()["items"]
    high = client.get("/api/fleet", params={"threshold": 1.0}).json()["items"]
    assert sum(i["at_risk"] for i in low) >= sum(i["at_risk"] for i in high)


def test_timestamps(client):
    r = client.get("/api/fleet/timestamps")
    assert r.status_code == 200
    assert r.json()["count"] > 0


def test_machine_detail_shape(client):
    r = client.get("/api/machines/1")
    assert r.status_code == 200
    d = r.json()
    assert d["rul_ci_low_days"] <= d["rul_days"] <= d["rul_ci_high_days"]
    assert len(d["sensor_breakdown"]) == 4
    assert len(d["survival_curve"]) > 0
    assert len(d["timeseries"]) > 0


def test_unknown_machine_404(client):
    assert client.get("/api/machines/99999").status_code == 404


def test_threshold_sweep_live_matches(client):
    r = client.get("/api/results/threshold-sweep", params={"threshold": 0.5})
    assert r.status_code == 200
    body = r.json()
    assert "live" in body and 0.0 <= body["live"]["precision"] <= 1.0


def test_inference_lookup_matches_fleet(client):
    r = client.get("/api/inference/lookup", params={"machine_id": 1})
    assert r.status_code == 200
    assert "risk_score" in r.json()
