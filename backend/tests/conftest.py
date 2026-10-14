from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from app.hub import Hub
from app.link import LinkTracker
from app.store import Store
from app.supervisor import Supervisor
from tests.helpers import FakeClock, IdleSource


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    ticks = iter(f"2026-01-01T00:00:{n // 1000:02d}.{n % 1000:03d}Z" for n in range(60_000))
    db = Store(tmp_path / "test.db", clock=lambda: next(ticks))
    yield db
    db.close()


@pytest.fixture
def make_supervisor(store: Store, clock: FakeClock) -> Callable[..., Supervisor]:
    def build(source: IdleSource | None = None, **kwargs: float) -> Supervisor:
        return Supervisor(
            store, Hub(), LinkTracker(clock), source or IdleSource(), monotonic=clock, **kwargs
        )

    return build


@pytest.fixture
def supervisor(make_supervisor: Callable[..., Supervisor]) -> Supervisor:
    return make_supervisor()
