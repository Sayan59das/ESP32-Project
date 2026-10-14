"""The bridge's core: feeds source bytes through the parser into the store and the hub.

One `Supervisor` owns the source loop, the viewer count that turns the Nano's preview
frames on and off, and the periodic tick. All of it runs on the event loop thread.
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable

from .classes import BACKGROUND, expected_firmware_bin, stored_bin
from .frames import KIND_PREVIEW, FramePacket, VerdictSlot, to_jpeg
from .hub import EventMsg, Hub, LinkMsg, ResetMsg
from .link import LinkTracker
from .models import State
from .protocol import (
    DebugLine,
    EventLine,
    FrameError,
    HeartbeatLine,
    HelloLine,
    Rejected,
    StreamItem,
    StreamParser,
)
from .sources.base import Source
from .store import Store

logger = logging.getLogger(__name__)

_BACKOFF_CAP_S = 10.0
_PREVIEW_RETRY_S = 2.0


class Supervisor:
    def __init__(
        self,
        store: Store,
        hub: Hub,
        link: LinkTracker,
        source: Source,
        *,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        tick_s: float = 0.25,
        link_min_interval_s: float = 1.0,
    ) -> None:
        self.store = store
        self.hub = hub
        self.link = link
        self.source = source
        self._monotonic = monotonic
        self._sleep = sleep
        self._tick_s = tick_s
        self._link_min_interval_s = link_min_interval_s
        self._parser = StreamParser(monotonic)
        self._verdict = VerdictSlot()
        self._viewers = 0
        self._preview_sent = False
        self._preview_retry_at = 0.0
        self._wake = asyncio.Event()
        # A real run and a simulated run never share an id.
        store.ensure_run(source.name)

    # -- state ------------------------------------------------------------------

    def get_state(self) -> State:
        run = self.store.current_run()
        return State(
            run=run,
            counts=self.store.counts(run.id),
            by_item=self.store.by_item(run.id),
            last_event=self.store.last_event(run.id),
            link=self.link.snapshot(),
        )

    def start_new_run(self) -> State:
        self.store.start_new_run(self.source.name)
        self.link.reset_run()
        self._verdict.clear()
        self.hub.publish(ResetMsg())
        return self.get_state()

    # -- preview viewers --------------------------------------------------------

    def viewer_connected(self) -> None:
        self._viewers += 1
        self._wake.set()

    def viewer_disconnected(self) -> None:
        self._viewers = max(0, self._viewers - 1)
        self._wake.set()

    @property
    def viewers(self) -> int:
        return self._viewers

    # -- ingest -----------------------------------------------------------------

    def ingest_bytes(self, data: bytes) -> None:
        self._handle_all(self._parser.feed(data))

    def _handle_all(self, items: list[StreamItem]) -> None:
        for item in items:
            try:
                self._handle(item)
            except Exception:
                logger.exception("failed to handle %s", type(item).__name__)

    def _handle(self, item: StreamItem) -> None:
        link = self.link
        match item:
            case EventLine():
                self._handle_event(item)
            case HelloLine(firmware_version=version):
                link.line_received()
                if link.hello():
                    logger.warning("Nano reset: HELLO %s while already running", version)
            case HeartbeatLine():
                link.line_received()
                link.heartbeat()
            case DebugLine(text=text):
                link.line_received()
                logger.debug("nano: %s", text)
            case Rejected(reason=reason):
                link.line_received()
                link.dropped_line()
                logger.debug("dropped line: %s", reason)
            case FramePacket():
                self._handle_frame(item)
            case FrameError(reason=reason):
                link.frame_error()
                logger.warning("dropped frame: %s", reason)

    def _handle_event(self, item: EventLine) -> None:
        self.link.line_received()
        self.link.event_seen()
        # The verdict frame precedes its EVT. Claim it now even if the event is ignored,
        # so it can never attach to a later event.
        frame = self._verdict.take(self._monotonic())
        if item.label == BACKGROUND:
            self.link.ignored_background()
            return
        bin_name = stored_bin(item.label)
        if bin_name is None:
            return
        if item.firmware_bin != expected_firmware_bin(item.label):
            self.link.bin_mismatch()
            logger.warning(
                "bin mismatch for %s: firmware said %s, table says %s",
                item.label,
                item.firmware_bin,
                bin_name,
            )
        event = self.store.add_event(
            self.store.current_run().id,
            item.label,
            item.confidence,
            bin_name,
            item.latency_ms,
            frame,
        )
        self.hub.publish(EventMsg(event))

    def _handle_frame(self, packet: FramePacket) -> None:
        preview = packet.kind == KIND_PREVIEW
        self.link.frame_received(preview=preview)
        if preview:
            # Encoding is skipped when nobody is watching.
            if self._viewers > 0:
                self.hub.frames.publish(to_jpeg(packet.pixels, packet.width, packet.height))
        else:
            self._verdict.offer(packet, self._monotonic())

    # -- loops ------------------------------------------------------------------

    async def run(self) -> None:
        """Run until cancelled. Source errors and bad input never end this."""
        async with asyncio.TaskGroup() as group:
            group.create_task(self._consume())
            group.create_task(self._tick())

    async def _consume(self) -> None:
        attempt = 0
        while True:
            self._parser = StreamParser(self._monotonic)
            self._verdict.clear()
            try:
                async for chunk in self.source.chunks(self.link):
                    attempt = 0
                    self.ingest_bytes(chunk)
                logger.warning("source %s ended", self.source.name)
            except Exception as exc:
                logger.error("source %s failed: %s", self.source.name, exc, exc_info=True)
            self.link.closed()
            delay = min(_BACKOFF_CAP_S, float(2**attempt))
            attempt += 1
            await self._sleep(delay)

    async def _tick(self) -> None:
        published_version = -1
        published_at = float("-inf")
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), self._tick_s)
            self._wake.clear()
            try:
                self._handle_all(self._parser.check_stall())
                await self._reconcile_preview()
                now = self._monotonic()
                if (
                    self.link.version != published_version
                    and now - published_at >= self._link_min_interval_s
                ):
                    published_version = self.link.version
                    published_at = now
                    self.hub.publish(LinkMsg(self.link.snapshot()))
            except Exception:
                logger.exception("supervisor tick failed")

    async def _reconcile_preview(self) -> None:
        """Make the Nano's preview state match the viewer count: P1 for the first viewer,
        P0 when the last one leaves, and P1 again after the port comes back."""
        if not self.link.source_open:
            if self._preview_sent:
                self._preview_sent = False
                self.link.set_preview_active(False)
            return
        want = self._viewers > 0
        if want == self._preview_sent or self._monotonic() < self._preview_retry_at:
            return
        try:
            await self.source.write(b"P1\n" if want else b"P0\n")
        except Exception:
            logger.exception("could not send preview command; will retry")
            self._preview_retry_at = self._monotonic() + _PREVIEW_RETRY_S
            return
        self._preview_sent = want
        self.link.set_preview_active(want)
