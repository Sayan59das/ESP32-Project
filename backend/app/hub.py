"""In-process pub/sub: events and link changes for SSE, the latest preview frame for MJPEG.

Everything here runs on the event loop thread; nothing is thread-safe by design.
"""

import asyncio
import contextlib
from collections.abc import Iterator
from dataclasses import dataclass

from .models import Event, Link


@dataclass(frozen=True, slots=True)
class EventMsg:
    event: Event


@dataclass(frozen=True, slots=True)
class LinkMsg:
    link: Link


@dataclass(frozen=True, slots=True)
class ResetMsg:
    """A new run began; subscribers should resend the full state."""


HubMessage = EventMsg | LinkMsg | ResetMsg


class SubscriberOverflow(Exception):
    """The subscriber fell too far behind and was dropped; it should reconnect and resync."""


class Subscription:
    def __init__(self, max_queue: int) -> None:
        self._queue: asyncio.Queue[HubMessage] = asyncio.Queue(maxsize=max_queue)
        self._overflowed = False

    def offer(self, message: HubMessage) -> bool:
        try:
            self._queue.put_nowait(message)
        except asyncio.QueueFull:
            self._overflowed = True
            return False
        return True

    async def get(self, quiet_for_s: float) -> HubMessage | None:
        """Next message, or None after `quiet_for_s` seconds without one."""
        if self._overflowed:
            raise SubscriberOverflow
        try:
            return await asyncio.wait_for(self._queue.get(), quiet_for_s)
        except TimeoutError:
            return None


class LatestFrame:
    """Holds only the newest preview JPEG. A slow viewer skips frames; nothing queues."""

    def __init__(self) -> None:
        self.seq = 0
        self.jpeg: bytes | None = None
        self._waiters: list[asyncio.Future[None]] = []

    def publish(self, jpeg: bytes) -> None:
        self.seq += 1
        self.jpeg = jpeg
        waiters, self._waiters = self._waiters, []
        for waiter in waiters:
            if not waiter.done():
                waiter.set_result(None)

    async def wait_newer(self, seq: int, wait_s: float) -> tuple[int, bytes] | None:
        """The newest frame if it is newer than `seq`, waiting up to `wait_s` seconds."""
        if self.seq <= seq or self.jpeg is None:
            waiter: asyncio.Future[None] = asyncio.get_running_loop().create_future()
            self._waiters.append(waiter)
            try:
                await asyncio.wait_for(waiter, wait_s)
            except TimeoutError:
                return None
            finally:
                with contextlib.suppress(ValueError):
                    self._waiters.remove(waiter)
        if self.jpeg is None:
            return None
        return self.seq, self.jpeg


class Hub:
    def __init__(self, max_queue: int = 256) -> None:
        self._max_queue = max_queue
        self._subscribers: set[Subscription] = set()
        self.frames = LatestFrame()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, message: HubMessage) -> None:
        for subscriber in list(self._subscribers):
            if not subscriber.offer(message):
                self._subscribers.discard(subscriber)

    @contextlib.contextmanager
    def subscribe(self) -> Iterator[Subscription]:
        subscription = Subscription(self._max_queue)
        self._subscribers.add(subscription)
        try:
            yield subscription
        finally:
            self._subscribers.discard(subscription)
