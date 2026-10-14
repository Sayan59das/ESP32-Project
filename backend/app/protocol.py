"""Byte-level parser for the Nano's USB serial stream: text lines and binary frames.

`parse_line` is the pure text-line grammar. `StreamParser` is the state machine that
splits a raw byte stream into lines and frame packets.

Guarantees, because corrupt serial data is routine:
  * `feed` and `check_stall` never raise and never block.
  * Memory is bounded: a text line buffers at most MAX_LINE_BYTES + 2 bytes, a frame
    at most one maximum-size packet.
  * After any damage the parser resyncs. A frame that fails (bad header, bad CRC, or a
    stall) is re-scanned silently for lines and frames hidden inside the bytes it
    swallowed, so a truncated packet does not eat the good data behind it.
"""

import enum
import re
import time
from collections.abc import Callable
from dataclasses import dataclass

from .classes import ALL_LABELS
from .frames import (
    CRC_LEN,
    HEADER_LEN,
    MAGIC,
    FrameHeader,
    FramePacket,
    crc16_ccitt_false,
    parse_header,
)

MAX_LINE_BYTES = 64
STALL_SECONDS = 0.5
# Room for CR LF around a maximum-length line before we stop buffering it.
_LINE_BUFFER_CAP = MAX_LINE_BYTES + 2


@dataclass(frozen=True, slots=True)
class EventLine:
    label: str
    confidence: float
    firmware_bin: str
    latency_ms: int


@dataclass(frozen=True, slots=True)
class HelloLine:
    firmware_version: str


@dataclass(frozen=True, slots=True)
class HeartbeatLine:
    uptime_ms: int


@dataclass(frozen=True, slots=True)
class DebugLine:
    text: str


@dataclass(frozen=True, slots=True)
class Rejected:
    reason: str


@dataclass(frozen=True, slots=True)
class FrameError:
    reason: str


ParsedLine = EventLine | HelloLine | HeartbeatLine | DebugLine | Rejected
StreamItem = ParsedLine | FramePacket | FrameError

_LABELS = "|".join(re.escape(label) for label in ALL_LABELS).encode()
_EVT = re.compile(
    rb"EVT,(" + _LABELS + rb"),(0\.[0-9]{2}|1\.00),(RECYCLABLE|TRASH|NONE),(0|[1-9][0-9]{0,5})"
)
_HELLO = re.compile(rb"HELLO,([A-Za-z0-9][A-Za-z0-9._+-]{0,31})")
_HB = re.compile(rb"HB,(0|[1-9][0-9]{0,9})")
_PRINTABLE = re.compile(rb"[\x20-\x7e]*")


def parse_line(raw: bytes | str) -> ParsedLine:
    """Parse one text line (terminator optional). Anything off-contract is Rejected."""
    if isinstance(raw, str):
        try:
            raw = raw.encode("ascii")
        except UnicodeEncodeError:
            return Rejected("non-ascii text")
    raw = raw.strip()
    if not raw:
        return Rejected("empty line")
    if not raw.isascii():
        return Rejected("non-ascii bytes")
    if len(raw) > MAX_LINE_BYTES:
        return Rejected("line over 64 bytes")

    if raw.startswith(b"EVT,"):
        match = _EVT.fullmatch(raw)
        if match is None:
            return Rejected("malformed EVT line")
        label, confidence, firmware_bin, latency = match.groups()
        return EventLine(label.decode(), float(confidence), firmware_bin.decode(), int(latency))
    if raw.startswith(b"HELLO,"):
        match = _HELLO.fullmatch(raw)
        if match is None:
            return Rejected("malformed HELLO line")
        return HelloLine(match.group(1).decode())
    if raw.startswith(b"HB,"):
        match = _HB.fullmatch(raw)
        if match is None:
            return Rejected("malformed HB line")
        return HeartbeatLine(int(match.group(1)))
    if raw.startswith(b"DBG,"):
        text = raw[4:]
        if _PRINTABLE.fullmatch(text) is None:
            return Rejected("non-printable DBG text")
        return DebugLine(text.decode())
    return Rejected("unrecognised line")


_TAGS = (b"EVT,", b"HELLO,", b"HB,", b"DBG,")
_TAG_START = re.compile(rb"EVT,|HELLO,|HB,|DBG,")


def _recover_tail_line(window: bytes) -> ParsedLine | None:
    """A valid line at the very end of a junk run, e.g. a HELLO printed straight after a
    truncated frame with no newline between them. The rightmost valid one wins."""
    found: ParsedLine | None = None
    for match in _TAG_START.finditer(window):
        parsed = parse_line(window[match.start() :])
        if not isinstance(parsed, Rejected):
            found = parsed
    return found


class _Mode(enum.Enum):
    TEXT = enum.auto()
    MAGIC = enum.auto()
    FRAME = enum.auto()


# Newline ends a text line; 0xEC is the first magic byte and can never be ASCII.
_SPECIAL = re.compile(rb"[\n\xec]")


class StreamParser:
    """Incremental splitter. Call `feed` with each chunk read from the port."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._mode = _Mode.TEXT
        self._line = bytearray()
        self._overflow = False
        self._tainted = False  # the buffered line began inside a failed frame
        self._hold = bytearray()  # leading magic bytes seen so far
        self._frame = bytearray()  # bytes after the magic
        self._header: FrameHeader | None = None
        self._last_rx = clock()

    def feed(self, data: bytes) -> list[StreamItem]:
        out: list[StreamItem] = []
        now = self._clock()
        self._expire_stall(now, out)
        self._last_rx = now
        if data:
            self._scan(bytes(data), 0, out)
        return out

    def check_stall(self) -> list[StreamItem]:
        """Drop a half-received frame that has been silent too long."""
        out: list[StreamItem] = []
        self._expire_stall(self._clock(), out)
        return out

    # -- scanning ---------------------------------------------------------------

    def _scan(self, data: bytes, quiet_end: int, out: list[StreamItem]) -> None:
        """Consume `data`. Bytes before `quiet_end` were already accounted for as part of
        a failed frame, so failures found inside them are not reported twice."""
        pos = 0
        while pos < len(data):
            if self._mode is _Mode.TEXT:
                in_quiet = pos < quiet_end
                limit = quiet_end if in_quiet else len(data)
                match = _SPECIAL.search(data, pos, limit)
                if match is None:
                    self._extend_line(data[pos:limit])
                    pos = limit
                    if in_quiet and (self._line or self._overflow):
                        # Junk from a failed frame; a real line may follow it directly.
                        self._tainted = True
                    continue
                idx = match.start()
                self._extend_line(data[pos:idx])
                if data[idx] == 0x0A:
                    self._finish_line(out, quiet=idx < quiet_end)
                else:
                    self._hold = bytearray(b"\xec")
                    self._mode = _Mode.MAGIC
                pos = idx + 1
            elif self._mode is _Mode.MAGIC:
                byte = data[pos]
                if byte == MAGIC[len(self._hold)]:
                    self._hold.append(byte)
                    pos += 1
                    if len(self._hold) == len(MAGIC):
                        self._begin_frame(out, quiet=pos - 1 < quiet_end)
                else:
                    # Not a magic after all: the held bytes are garbage text. The
                    # current byte is looked at again in TEXT mode (it may be 0xEC).
                    self._extend_line(bytes(self._hold))
                    self._hold = bytearray()
                    self._mode = _Mode.TEXT
            else:
                take = self._frame_bytes_needed()
                chunk = data[pos : pos + take]
                self._frame += chunk
                pos += len(chunk)
                outcome = self._advance_frame()
                if outcome is None:
                    continue
                if isinstance(outcome, FramePacket):
                    out.append(outcome)
                    self._reset_frame()
                    continue
                if pos - 1 >= quiet_end:
                    out.append(FrameError(outcome))
                leftover = bytes(self._frame)
                self._reset_frame()
                # Re-scan what the failed frame swallowed, then carry on. Each failure
                # drops at least the four magic bytes, so this always terminates.
                data = leftover + data[pos:]
                quiet_end = len(leftover) + max(0, quiet_end - pos)
                pos = 0

    def _expire_stall(self, now: float, out: list[StreamItem]) -> None:
        if self._mode is not _Mode.FRAME or now - self._last_rx <= STALL_SECONDS:
            return
        out.append(FrameError("stalled mid-packet"))
        # Everything buffered is just as old. Partial frames hiding inside the stalled
        # one are dropped too, reported once, so nothing stale swallows what comes next.
        while self._mode is _Mode.FRAME:
            leftover = bytes(self._frame)
            self._reset_frame()
            self._scan(leftover, len(leftover), out)

    # -- text -------------------------------------------------------------------

    def _extend_line(self, chunk: bytes) -> None:
        if not chunk:
            return
        self._line += chunk
        if len(self._line) > _LINE_BUFFER_CAP:
            # Too long to be a line. Remember only the newest bytes: if a real line
            # follows the junk directly, it is at the tail.
            self._overflow = True
            del self._line[:-_LINE_BUFFER_CAP]

    def _finish_line(self, out: list[StreamItem], *, quiet: bool) -> None:
        line = bytes(self._line)
        overflow = self._overflow
        quiet = quiet or self._tainted
        self._line.clear()
        self._overflow = False
        self._tainted = False
        if overflow:
            if not quiet:
                out.append(Rejected("line over 64 bytes"))
            recovered = _recover_tail_line(line)
            if recovered is not None:
                out.append(recovered)
            return
        if not line.strip():
            return
        parsed = parse_line(line)
        if not isinstance(parsed, Rejected):
            out.append(parsed)
            return
        if not quiet:
            out.append(parsed)
        # A few junk bytes (the end of a damaged frame) may sit in front of a good line.
        recovered = _recover_tail_line(line)
        if recovered is not None:
            out.append(recovered)

    # -- frames -----------------------------------------------------------------

    def _begin_frame(self, out: list[StreamItem], *, quiet: bool) -> None:
        if (self._overflow or self._line.strip()) and not (quiet or self._tainted):
            out.append(Rejected("line interrupted by a frame"))
        self._line.clear()
        self._overflow = False
        self._tainted = False
        self._hold = bytearray()
        self._frame = bytearray()
        self._header = None
        self._mode = _Mode.FRAME

    def _reset_frame(self) -> None:
        self._frame = bytearray()
        self._header = None
        self._hold = bytearray()
        self._mode = _Mode.TEXT

    def _frame_bytes_needed(self) -> int:
        if self._header is None:
            return HEADER_LEN - len(self._frame)
        return HEADER_LEN + self._header.length + CRC_LEN - len(self._frame)

    def _advance_frame(self) -> FramePacket | str | None:
        """FramePacket when complete and valid, a reason string on failure, None to wait."""
        if self._header is None:
            if len(self._frame) < HEADER_LEN:
                return None
            parsed = parse_header(bytes(self._frame[:HEADER_LEN]))
            if isinstance(parsed, str):
                return parsed
            self._header = parsed
        header = self._header
        body_end = HEADER_LEN + header.length
        if len(self._frame) < body_end + CRC_LEN:
            return None
        expected = int.from_bytes(self._frame[body_end : body_end + CRC_LEN], "little")
        if crc16_ccitt_false(bytes(self._frame[:body_end])) != expected:
            return "CRC mismatch"
        return FramePacket(
            header.kind, header.width, header.height, bytes(self._frame[HEADER_LEN:body_end])
        )
