"""FastAPI app for the predictive-maintenance dashboard.

Run from the project root:
    uvicorn api.main:app --reload --port 8000
"""
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import deps
from api.config import settings
from api.routers import fleet, health, inference, machines, results


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.init_store()  # load all artifacts once
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Predictive Maintenance API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    for router in (health.router, fleet.router, machines.router, results.router, inference.router):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
