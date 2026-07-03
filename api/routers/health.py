from fastapi import APIRouter, Depends

from api.deps import get_store
from api.store import ArtifactStore

router = APIRouter(tags=["health"])


@router.get("/health")
def health(store: ArtifactStore = Depends(get_store)):
    """Readiness + which setup steps are still missing (works even when not ready)."""
    return store.status()
