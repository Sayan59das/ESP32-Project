"""What the supervisor needs from a byte source."""

from collections.abc import AsyncIterator
from typing import Protocol

from ..models import SourceName


class SourceError(Exception):
    """A source cannot run, with a message fit to show the operator."""


class SourceObserver(Protocol):
    """How a source reports its connection state. `LinkTracker` implements this."""

    def opened(self, port: str | None) -> None: ...

    def closed(self) -> None: ...

    def port_busy(self, port: str) -> None:
        """The port exists but could not be opened (another program holds it)."""

    def stream_restarted(self) -> None:
        """A recording looped back to its start, so a HELLO there is not a Nano reset."""


class Source(Protocol):
    name: SourceName

    def chunks(self, observer: SourceObserver) -> AsyncIterator[bytes]:
        """Raw bytes as they arrive, in arbitrary splits. May run forever; may raise.

        The source reports open/close through `observer`. Reconnecting after a
        disconnect is the source's own job; the supervisor restarts it after an error.
        """
        ...

    async def write(self, data: bytes) -> None:
        """Send host-to-Nano command bytes (P1 / P0)."""
        ...
