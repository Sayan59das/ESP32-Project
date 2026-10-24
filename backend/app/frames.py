"""Frame packets from the Nano: layout, CRC, encoding, and the pending-verdict slot.

Packet (little-endian):
    0   4  magic 0xEC 0xA5 0xF0 0x5A
    4   1  type: 1 preview, 2 verdict
    5   2  width
    7   2  height
    9   4  payload length, must equal width * height, at most 32768
    13  N  8-bit grayscale, row-major
    13+N 2 CRC-16/CCITT-FALSE over bytes 4 .. 13+N-1

`HEADER_LEN` counts the nine bytes after the magic, which is what the stream parser
collects before it can validate the length.
"""

import io
from dataclasses import dataclass

from PIL import Image

MAGIC = b"\xec\xa5\xf0\x5a"
KIND_PREVIEW = 1
KIND_VERDICT = 2
HEADER_LEN = 9
CRC_LEN = 2
MAX_PAYLOAD = 32768
VERDICT_TTL_S = 3.0
JPEG_QUALITY = 92


def _build_crc_table() -> tuple[int, ...]:
    table = []
    for byte in range(256):
        crc = byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
        table.append(crc)
    return tuple(table)


_CRC_TABLE = _build_crc_table()


def crc16_ccitt_false(data: bytes) -> int:
    """CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor."""
    crc = 0xFFFF
    for byte in data:
        crc = ((crc << 8) & 0xFFFF) ^ _CRC_TABLE[(crc >> 8) ^ byte]
    return crc


@dataclass(frozen=True, slots=True)
class FrameHeader:
    kind: int
    width: int
    height: int
    length: int


@dataclass(frozen=True, slots=True)
class FramePacket:
    kind: int
    width: int
    height: int
    pixels: bytes


def parse_header(raw: bytes) -> FrameHeader | str:
    """Validate the nine header bytes that follow the magic. Returns a reason on failure."""
    if len(raw) != HEADER_LEN:
        return "short header"
    kind = raw[0]
    width = int.from_bytes(raw[1:3], "little")
    height = int.from_bytes(raw[3:5], "little")
    length = int.from_bytes(raw[5:9], "little")
    if kind not in (KIND_PREVIEW, KIND_VERDICT):
        return "unknown frame type"
    if width == 0 or height == 0:
        return "zero frame dimension"
    if length > MAX_PAYLOAD:
        return "payload too large"
    if length != width * height:
        return "payload length does not match dimensions"
    return FrameHeader(kind, width, height, length)


def encode_packet(kind: int, width: int, height: int, pixels: bytes) -> bytes:
    """Build a wire packet. Used by the simulator, the fake Nano and the tests."""
    if len(pixels) != width * height or len(pixels) > MAX_PAYLOAD:
        raise ValueError("pixel count must equal width * height and fit in 32768 bytes")
    body = (
        bytes([kind])
        + width.to_bytes(2, "little")
        + height.to_bytes(2, "little")
        + len(pixels).to_bytes(4, "little")
        + pixels
    )
    return MAGIC + body + crc16_ccitt_false(body).to_bytes(2, "little")


def to_png(pixels: bytes, width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.frombytes("L", (width, height), pixels).save(out, format="PNG")
    return out.getvalue()


def to_jpeg(pixels: bytes, width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.frombytes("L", (width, height), pixels).save(out, format="JPEG", quality=JPEG_QUALITY)
    return out.getvalue()


class VerdictSlot:
    """Holds the verdict frame that arrived just before an EVT line.

    The Nano sends the frame first, then the EVT. The next EVT claims the frame if it
    arrives within three seconds; a frame nobody claims in time is discarded.
    """

    def __init__(self, ttl_s: float = VERDICT_TTL_S) -> None:
        self._ttl_s = ttl_s
        self._frame: FramePacket | None = None
        self._offered_at = 0.0

    def offer(self, frame: FramePacket, now: float) -> None:
        self._frame = frame
        self._offered_at = now

    def take(self, now: float) -> FramePacket | None:
        """Claim the pending frame, if it is still fresh. Always empties the slot."""
        frame, self._frame = self._frame, None
        if frame is None or now - self._offered_at > self._ttl_s:
            return None
        return frame

    def clear(self) -> None:
        self._frame = None
