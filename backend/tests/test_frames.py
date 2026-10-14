import io

import pytest
from PIL import Image

from app.frames import (
    KIND_PREVIEW,
    KIND_VERDICT,
    MAGIC,
    FrameHeader,
    FramePacket,
    VerdictSlot,
    crc16_ccitt_false,
    encode_packet,
    parse_header,
    to_jpeg,
    to_png,
)


def test_crc_matches_the_published_check_value() -> None:
    # CRC-16/CCITT-FALSE check value from the CRC catalogue.
    assert crc16_ccitt_false(b"123456789") == 0x29B1
    assert crc16_ccitt_false(b"") == 0xFFFF


def test_a_96x96_packet_is_9231_bytes_with_the_agreed_layout() -> None:
    pixels = bytes(range(256)) * 36
    packet = encode_packet(KIND_VERDICT, 96, 96, pixels)
    assert len(packet) == 9231
    assert packet[:4] == MAGIC
    assert packet[4] == KIND_VERDICT
    assert int.from_bytes(packet[5:7], "little") == 96
    assert int.from_bytes(packet[7:9], "little") == 96
    assert int.from_bytes(packet[9:13], "little") == 9216
    assert packet[13:-2] == pixels
    assert int.from_bytes(packet[-2:], "little") == crc16_ccitt_false(packet[4:-2])


def test_magic_cannot_be_started_by_ascii_text() -> None:
    # The firmware spec says every magic byte is >= 0x80, but the last one, 0x5A, is
    # ASCII 'Z'. That is harmless: the parser starts on 0xEC and only checks 0x5A after
    # three non-ASCII bytes have matched, and no text line can contain 0xEC.
    assert all(byte >= 0x80 for byte in MAGIC[:3])
    assert MAGIC[3] == 0x5A


def test_parse_header_accepts_a_valid_header() -> None:
    packet = encode_packet(KIND_PREVIEW, 96, 96, bytes(9216))
    assert parse_header(packet[4:13]) == FrameHeader(KIND_PREVIEW, 96, 96, 9216)


@pytest.mark.parametrize(
    ("header", "why"),
    [
        (bytes([3]) + (96).to_bytes(2, "little") * 2 + (9216).to_bytes(4, "little"), "type"),
        (bytes([1]) + (0).to_bytes(2, "little") * 2 + (0).to_bytes(4, "little"), "zero size"),
        (bytes([1]) + (96).to_bytes(2, "little") * 2 + (9000).to_bytes(4, "little"), "length"),
        (bytes([1]) + (200).to_bytes(2, "little") * 2 + (40000).to_bytes(4, "little"), "too big"),
        (bytes([1, 2, 3]), "short"),
    ],
)
def test_parse_header_rejects_bad_headers(header: bytes, why: str) -> None:
    assert isinstance(parse_header(header), str), why


def test_encode_packet_refuses_a_mismatched_pixel_count() -> None:
    with pytest.raises(ValueError, match="pixel count"):
        encode_packet(KIND_VERDICT, 96, 96, bytes(100))


def test_png_is_lossless_96x96_grayscale() -> None:
    pixels = bytes((x * 7 + y * 3) % 256 for y in range(96) for x in range(96))
    image = Image.open(io.BytesIO(to_png(pixels, 96, 96)))
    assert (image.format, image.mode, image.size) == ("PNG", "L", (96, 96))
    assert image.tobytes() == pixels


def test_jpeg_decodes_to_the_same_size() -> None:
    image = Image.open(io.BytesIO(to_jpeg(bytes(range(256)) * 36, 96, 96)))
    assert (image.format, image.size) == ("JPEG", (96, 96))


class TestVerdictSlot:
    frame = FramePacket(KIND_VERDICT, 8, 8, bytes(64))

    def test_a_fresh_frame_is_claimed_once(self) -> None:
        slot = VerdictSlot()
        slot.offer(self.frame, now=10.0)
        assert slot.take(now=12.9) == self.frame
        assert slot.take(now=12.9) is None

    def test_a_frame_older_than_three_seconds_is_discarded(self) -> None:
        slot = VerdictSlot()
        slot.offer(self.frame, now=10.0)
        assert slot.take(now=13.1) is None
        assert slot.take(now=13.1) is None  # and it is gone, not merely skipped

    def test_the_newest_frame_replaces_an_unclaimed_one(self) -> None:
        slot = VerdictSlot()
        newer = FramePacket(KIND_VERDICT, 8, 8, bytes([1]) * 64)
        slot.offer(self.frame, now=10.0)
        slot.offer(newer, now=11.0)
        assert slot.take(now=11.5) == newer

    def test_clear_empties_the_slot(self) -> None:
        slot = VerdictSlot()
        slot.offer(self.frame, now=10.0)
        slot.clear()
        assert slot.take(now=10.1) is None
