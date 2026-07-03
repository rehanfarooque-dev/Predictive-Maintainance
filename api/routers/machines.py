from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.deps import require_ready
from api.store import ArtifactStore

router = APIRouter(tags=["machines"])


@router.get("/machines")
def machines(model: Optional[str] = None, store: ArtifactStore = Depends(require_ready)):
    items = store.machines_meta
    if model:
        items = [m for m in items if m["model"] == model]
    return {"items": items}


@router.get("/machines/{machine_id}")
def machine_detail(
    machine_id: int,
    as_of: Optional[str] = None,
    threshold: float = 0.5,
    store: ArtifactStore = Depends(require_ready),
):
    detail = store.machine_detail(machine_id, as_of, threshold)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    return detail
