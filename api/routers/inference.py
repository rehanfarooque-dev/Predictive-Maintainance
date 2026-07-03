import io
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.deps import require_ready
from api.store import ArtifactStore

router = APIRouter(prefix="/inference", tags=["inference"])


@router.get("/lookup")
def lookup(
    machine_id: int,
    as_of: Optional[str] = None,
    threshold: float = 0.5,
    store: ArtifactStore = Depends(require_ready),
):
    result = store.inference_lookup(machine_id, as_of, threshold)
    if result is None:
        raise HTTPException(status_code=404, detail="No reading for that machine/time")
    return result


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    threshold: float = Form(0.5),
    store: ArtifactStore = Depends(require_ready),
):
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}")
    return store.inference_upload(df, threshold)
