import asyncio
from collections.abc import AsyncIterator

from app.frames import KIND_PREVIEW, KIND_VERDICT, encode_packet
from app.models import SourceName
from app.sources.base import SourceObserver


class FakeClock:
    """Stand-in for time.monotonic that only moves when a test says so."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class IdleSource:
    """A source that opens, sends nothing, and records what the host writes to it."""

    def __init__(self, name: SourceName = "sim") -> None:
        self.name: SourceName = name
        self.writes: list[bytes] = []
        self.opens = 0

    async def chunks(self, observer: SourceObserver) -> AsyncIterator[bytes]:
        observer.opened(None)
        self.opens += 1
        try:
            await asyncio.Event().wait()
            yield b""
        finally:
            observer.closed()

    async def write(self, data: bytes) -> None:
        self.writes.append(data)


def tiny_frame(kind: int = KIND_VERDICT, fill: int = 7, size: int = 8) -> bytes:
    return encode_packet(kind, size, size, bytes([fill]) * (size * size))


def preview_packet(fill: int = 9) -> bytes:
    return tiny_frame(KIND_PREVIEW, fill)


def evt(label: str, bin_name: str, confidence: str = "0.90", latency: int = 400) -> bytes:
    return f"EVT,{label},{confidence},{bin_name},{latency}\n".encode("ascii")
