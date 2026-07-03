"""Dependency injection: a single ArtifactStore for the app's lifetime."""
from fastapi import Depends, HTTPException

from api.store import ArtifactStore

_store: ArtifactStore | None = None


def init_store() -> ArtifactStore:
    """Build the store once at startup (called from the FastAPI lifespan)."""
    global _store
    _store = ArtifactStore().load()
    return _store


def set_store(store: ArtifactStore) -> None:
    """Override the singleton (used by tests)."""
    global _store
    _store = store


def get_store() -> ArtifactStore:
    if _store is None:
        raise HTTPException(status_code=503, detail="Store not initialized")
    return _store


def require_ready(store: ArtifactStore = Depends(get_store)) -> ArtifactStore:
    """Guard data endpoints: 503 with the setup checklist when artifacts aren't built."""
    if not store.ready:
        raise HTTPException(status_code=503, detail={"ready": False, "missing": store.status()["missing"]})
    return store
