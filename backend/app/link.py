"""Link health: what the bridge knows about the port and the Nano behind it.

Open port != live Nano. The Nano proves it is alive with HB lines (and HELLO on boot),
so heartbeat age is tracked separately from "a line arrived".
"""

import time
from collections import deque
from collections.abc import Callable

from .models import Link

_FPS_WINDOW_S = 2.0


class LinkTracker:
    """Mutated from the event loop only. Implements `SourceObserver` for the sources."""

    def __init__(self, monotonic: Callable[[], float] = time.monotonic) -> None:
        self._now = monotonic
        self._version = 0
        self._open = False
        self._port: str | None = None
        self._last_line_at: float | None = None
        self._last_heartbeat_at: float | None = None
        self._nano_seen = False
        self._nano_resets = 0
        self._dropped_lines = 0
        self._ignored_background = 0
        self._bin_mismatch = 0
        self._frames_received = 0
        self._frame_crc_errors = 0
        self._preview_active = False
        self._preview_times: deque[float] = deque()

    @property
    def version(self) -> int:
        """Bumps on every change, so a publisher can tell when a snapshot is worth sending."""
        return self._version

    @property
    def source_open(self) -> bool:
        return self._open

    # -- SourceObserver ---------------------------------------------------------

    def opened(self, port: str | None) -> None:
        self._open = True
        self._port = port
        self._version += 1

    def closed(self) -> None:
        self._open = False
        self._port = None
        self._version += 1

    def port_busy(self, port: str) -> None:
        """The port exists but could not be opened. `port` set while not open means busy;
        `port` None while not open means no device was found."""
        self._open = False
        self._port = port
        self._version += 1

    def stream_restarted(self) -> None:
        """A replayed recording looped back to its start; its HELLO is not a Nano reset."""
        self._nano_seen = False
        self._version += 1

    # -- ingest -----------------------------------------------------------------

    def line_received(self) -> None:
        self._last_line_at = self._now()
        self._version += 1

    def heartbeat(self) -> None:
        self._nano_seen = True
        self._last_heartbeat_at = self._now()
        self._version += 1

    def hello(self) -> bool:
        """Record a HELLO. True when it is a Nano reset: we had already heard from the Nano.

        HELLO also counts as a heartbeat; it is the Nano announcing itself.
        """
        is_reset = self._nano_seen
        if is_reset:
            self._nano_resets += 1
        self.heartbeat()
        return is_reset

    def event_seen(self) -> None:
        self._nano_seen = True
        self._version += 1

    def dropped_line(self) -> None:
        self._dropped_lines += 1
        self._version += 1

    def ignored_background(self) -> None:
        self._ignored_background += 1
        self._version += 1

    def bin_mismatch(self) -> None:
        self._bin_mismatch += 1
        self._version += 1

    def frame_received(self, *, preview: bool) -> None:
        self._frames_received += 1
        self._nano_seen = True
        if preview:
            self._preview_times.append(self._now())
        self._version += 1

    def frame_error(self) -> None:
        self._frame_crc_errors += 1
        self._version += 1

    def set_preview_active(self, active: bool) -> None:
        if active != self._preview_active:
            self._preview_active = active
            self._version += 1

    def reset_run(self) -> None:
        """Per-run counters restart with a new run. Link-lifetime counters do not."""
        self._nano_resets = 0
        self._version += 1

    # -- output -----------------------------------------------------------------

    def snapshot(self) -> Link:
        now = self._now()
        while self._preview_times and now - self._preview_times[0] > _FPS_WINDOW_S:
            self._preview_times.popleft()
        fps = round(len(self._preview_times) / _FPS_WINDOW_S, 1) if self._preview_times else None
        return Link(
            source_open=self._open,
            port=self._port,
            last_line_age_s=self._age(self._last_line_at, now),
            last_heartbeat_age_s=self._age(self._last_heartbeat_at, now),
            nano_resets_seen=self._nano_resets,
            dropped_lines=self._dropped_lines,
            ignored_background=self._ignored_background,
            bin_mismatch=self._bin_mismatch,
            frames_received=self._frames_received,
            frame_crc_errors=self._frame_crc_errors,
            preview_active=self._preview_active,
            preview_fps=fps,
        )

    @staticmethod
    def _age(stamp: float | None, now: float) -> float | None:
        return None if stamp is None else round(max(0.0, now - stamp), 1)
