from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from api.deps import require_ready
from api.store import ArtifactStore

router = APIRouter(prefix="/results", tags=["results"])

PLOT_NAMES = {"pr_curve", "roc_curve", "shap_summary", "optuna_history"}


@router.get("/summary")
def summary(store: ArtifactStore = Depends(require_ready)):
    return store.results_summary()


@router.get("/threshold-sweep")
def threshold_sweep(threshold: Optional[float] = None, store: ArtifactStore = Depends(require_ready)):
    return store.threshold_sweep(threshold)


@router.get("/components")
def components(threshold: float = 0.5, store: ArtifactStore = Depends(require_ready)):
    return store.components(threshold)


@router.get("/features")
def features(store: ArtifactStore = Depends(require_ready)):
    return store.features()


@router.get("/model-reports")
def model_reports(as_of: Optional[str] = None, threshold: float = 0.5,
                  store: ArtifactStore = Depends(require_ready)):
    """Plain-language report for both models: the 12h classifier and the PdM cycle."""
    return store.model_reports(as_of, threshold)


@router.get("/plots/{name}")
def plot(name: str, store: ArtifactStore = Depends(require_ready)):
    if name not in PLOT_NAMES:
        raise HTTPException(status_code=404, detail="Unknown plot")
    path = store.plot_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Plot not generated")
    return FileResponse(str(path), media_type="image/png")
