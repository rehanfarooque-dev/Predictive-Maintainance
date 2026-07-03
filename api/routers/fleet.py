from typing import Optional

from fastapi import APIRouter, Depends, Query

from api.deps import require_ready
from api.store import ArtifactStore

router = APIRouter(tags=["fleet"])


@router.get("/fleet")
def fleet(
    as_of: Optional[str] = None,
    threshold: float = 0.5,
    sort_by: str = Query("urgency", pattern="^(urgency|classifier_risk|risk_score|rul_days|days_until_service)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    model: Optional[str] = None,
    limit: Optional[int] = None,
    store: ArtifactStore = Depends(require_ready),
):
    """Fleet snapshot at `as_of`: classification risk + risk score + RUL + urgency per machine."""
    return store.fleet(as_of, threshold, sort_by, order, model, limit)


@router.get("/fleet/timestamps")
def timestamps(store: ArtifactStore = Depends(require_ready)):
    return store.list_timestamps()


@router.get("/fleet/monitor")
def fleet_monitor(
    as_of: Optional[str] = None,
    store: ArtifactStore = Depends(require_ready),
):
    """Per-machine live snapshot at a point in time (sensors, 24h vibration, errors, overdue part, risk)."""
    return store.fleet_monitor(as_of)
