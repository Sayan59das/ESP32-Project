"""App factory. `uvicorn app.main:create_app --factory`."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .hub import Hub
from .link import LinkTracker
from .routes import router
from .sources.base import Source
from .sources.replay_source import ReplaySource
from .sources.serial_source import SerialSource
from .sources.sim_source import SimSource
from .store import Store
from .supervisor import Supervisor

logger = logging.getLogger(__name__)


def build_source(settings: Settings) -> Source:
    if settings.source == "sim":
        return SimSource()
    if settings.source == "replay":
        return ReplaySource(settings.replay_file)
    return SerialSource(settings.serial_port, settings.baud)


def create_app(settings: Settings | None = None, source: Source | None = None) -> FastAPI:
    """`source` is for tests; normally it is built from `settings`."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        store = Store(settings.db_path)
        supervisor = Supervisor(store, Hub(), LinkTracker(), source or build_source(settings))
        app.state.supervisor = supervisor
        task = asyncio.create_task(supervisor.run(), name="supervisor")
        logger.info("EcoSort bridge started, source=%s", supervisor.source.name)
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            store.close()

    app = FastAPI(title="EcoSort Edge bridge", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_origin],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Last-Event-ID"],
    )
    app.include_router(router)
    return app
