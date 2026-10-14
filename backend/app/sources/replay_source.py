"""Replays a recorded serial capture (.rec) at its recorded timing, looped.

A .rec file is a sequence of records, each a 4-byte little-endian millisecond offset from
the start of the recording, a 2-byte little-endian length, then that many raw serial
bytes. `scripts/record.py` writes them. Chunk boundaries are whatever the port returned,
which is the point: the parser sees the same splits it saw live.
"""

import asyncio
import logging
import struct
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path

from ..models import SourceName
from .base import SourceError, SourceObserver

logger = logging.getLogger(__name__)

_RECORD_HEAD = struct.Struct("<IH")


def encode_record(offset_ms: int, data: bytes) -> bytes:
    return _RECORD_HEAD.pack(offset_ms, len(data)) + data


def read_recording(path: Path) -> list[tuple[int, bytes]]:
    """Parse a .rec file. A truncated final record is dropped with a warning."""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise SourceError(f"Cannot read the replay file {path}: {exc.strerror or exc}") from exc
    records: list[tuple[int, bytes]] = []
    pos = 0
    while pos + _RECORD_HEAD.size <= len(raw):
        offset_ms, length = _RECORD_HEAD.unpack_from(raw, pos)
        start = pos + _RECORD_HEAD.size
        if start + length > len(raw):
            break
        records.append((offset_ms, raw[start : start + length]))
        pos = start + length
    if pos != len(raw):
        logger.warning("%s ends with a truncated record; ignoring %d bytes", path, len(raw) - pos)
    return records


class ReplaySource:
    name: SourceName = "replay"

    def __init__(
        self,
        path: Path,
        *,
        time_scale: float = 1.0,
        loop_gap_s: float = 1.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._path = path
        self._time_scale = time_scale
        self._loop_gap_s = loop_gap_s
        self._sleep = sleep

    async def write(self, data: bytes) -> None:
        # A recording cannot obey P1/P0; any preview frames in it just replay as recorded.
        logger.debug("replay source ignoring command %r", data)

    async def chunks(self, observer: SourceObserver) -> AsyncIterator[bytes]:
        records = read_recording(self._path)
        if not records:
            raise SourceError(
                f"{self._path} holds no recorded data. Record a session with scripts/record.py."
            )
        observer.opened(None)
        try:
            first_pass = True
            while True:
                if not first_pass:
                    observer.stream_restarted()
                previous_ms = 0
                for offset_ms, data in records:
                    await self._sleep(max(0, offset_ms - previous_ms) / 1000 / self._time_scale)
                    previous_ms = max(previous_ms, offset_ms)
                    yield data
                await self._sleep(self._loop_gap_s / self._time_scale)
                first_pass = False
        finally:
            observer.closed()
