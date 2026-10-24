"""Simulated Nano: synthetic events and synthetic 96x96 grayscale frames.

Nothing here is real data. The supervisor flags the run as `sim`, and the console shows a
banner and a tag on the image. The frames are noisy gradients with a class-specific dark
shape so they are plainly not camera output.
"""

import asyncio
import logging
import math
import random
from collections.abc import AsyncIterator, Awaitable, Callable

from ..classes import ITEMS, UNCERTAIN, expected_firmware_bin
from ..frames import KIND_PREVIEW, KIND_VERDICT, encode_packet
from ..models import SourceName
from .base import SourceObserver

logger = logging.getLogger(__name__)

FRAME_SIZE = 96
_WEIGHTS = {"recyclable": 0.55, "trash": 0.45}
_UNCERTAIN_CHANCE = 1 / 15
_PREVIEW_INTERVAL_S = 0.2  # 5 frames per second
_HEARTBEAT_INTERVAL_S = 5.0
_PREVIEW_BACKLOG_LIMIT = 8


def _is_dark(label: str | None, x: float, y: float) -> bool:
    """Whether pixel (x, y) falls inside the dark silhouette for `label`."""
    if label == "recyclable":  # a can: a tall rounded body with a neck
        return (34 <= x <= 62 and 30 <= y <= 76) or (42 <= x <= 54 and 18 <= y <= 30)
    if label == "trash":  # a phone case: a slab with a camera cut-out
        in_body = 28 <= x <= 68 and 16 <= y <= 80
        in_camera_cutout = 34 <= x <= 46 and 22 <= y <= 32
        return in_body and not in_camera_cutout
    return False


def synthetic_frame(label: str | None, rng: random.Random, shift: int = 0) -> bytes:
    """A 96x96 noisy gradient with `label`'s dark shape, moved sideways by `shift` pixels."""
    noise = rng.randbytes(FRAME_SIZE * FRAME_SIZE)
    pixels = bytearray(FRAME_SIZE * FRAME_SIZE)
    for y in range(FRAME_SIZE):
        row = y * FRAME_SIZE
        for x in range(FRAME_SIZE):
            value = 120 + (x * 60) // FRAME_SIZE + (noise[row + x] % 17) - 8
            if _is_dark(label, x - shift, y):
                value -= 90
            pixels[row + x] = max(0, min(255, value))
    return bytes(pixels)


class SimSource:
    name: SourceName = "sim"

    def __init__(
        self,
        *,
        seed: int | None = None,
        time_scale: float = 1.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._rng = random.Random(seed)
        self._time_scale = time_scale
        self._sleep = sleep
        self._preview_on = asyncio.Event()
        self.commands: list[bytes] = []

    async def write(self, data: bytes) -> None:
        for command in data.split(b"\n"):
            command = command.strip()
            if not command:
                continue
            self.commands.append(command)
            logger.info("sim source received command %s", command.decode("ascii", "replace"))
            if command == b"P1":
                self._preview_on.set()
            elif command == b"P0":
                self._preview_on.clear()

    async def chunks(self, observer: SourceObserver) -> AsyncIterator[bytes]:
        observer.opened(None)
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        started = asyncio.get_running_loop().time()
        queue.put_nowait(b"HELLO,sim\n")
        tasks = [
            asyncio.create_task(self._events(queue)),
            asyncio.create_task(self._heartbeats(queue, started)),
            asyncio.create_task(self._previews(queue, started)),
        ]
        try:
            while True:
                yield await queue.get()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            observer.closed()

    async def _wait(self, seconds: float) -> None:
        await self._sleep(seconds / self._time_scale)

    async def _events(self, queue: asyncio.Queue[bytes]) -> None:
        labels = [item.label for item in ITEMS]
        weights = [_WEIGHTS[label] for label in labels]
        while True:
            await self._wait(self._rng.uniform(3.0, 9.0))
            if self._rng.random() < _UNCERTAIN_CHANCE:
                label = UNCERTAIN
                confidence = self._rng.uniform(0.30, 0.69)
            else:
                label = self._rng.choices(labels, weights)[0]
                confidence = self._rng.uniform(0.70, 0.99)
            latency = max(50, round(self._rng.gauss(410, 35)))
            shown = None if label == UNCERTAIN else label
            frame = synthetic_frame(shown, self._rng)
            # Verdict frame first, EVT right behind it, with nothing between them.
            queue.put_nowait(encode_packet(KIND_VERDICT, FRAME_SIZE, FRAME_SIZE, frame))
            line = f"EVT,{label},{confidence:.2f},{expected_firmware_bin(label)},{latency}\n"
            queue.put_nowait(line.encode("ascii"))

    async def _heartbeats(self, queue: asyncio.Queue[bytes], started: float) -> None:
        loop = asyncio.get_running_loop()
        while True:
            await self._wait(_HEARTBEAT_INTERVAL_S)
            uptime_ms = int((loop.time() - started) * self._time_scale * 1000)
            queue.put_nowait(f"HB,{uptime_ms}\n".encode("ascii"))

    async def _previews(self, queue: asyncio.Queue[bytes], started: float) -> None:
        loop = asyncio.get_running_loop()
        cycle = [item.label for item in ITEMS]
        while True:
            await self._preview_on.wait()
            elapsed = (loop.time() - started) * self._time_scale
            label = cycle[int(elapsed / 4) % len(cycle)]
            shift = round(12 * math.sin(elapsed * 1.2))
            if queue.qsize() < _PREVIEW_BACKLOG_LIMIT:
                frame = synthetic_frame(label, self._rng, shift)
                queue.put_nowait(encode_packet(KIND_PREVIEW, FRAME_SIZE, FRAME_SIZE, frame))
            await self._wait(_PREVIEW_INTERVAL_S)
