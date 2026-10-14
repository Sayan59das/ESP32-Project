import random
import time
from typing import get_args

import pytest

from app.frames import KIND_PREVIEW, KIND_VERDICT, MAGIC, FramePacket, encode_packet
from app.protocol import (
    DebugLine,
    EventLine,
    FrameError,
    HeartbeatLine,
    HelloLine,
    Rejected,
    StreamItem,
    StreamParser,
)
from tests.helpers import FakeClock

EVT_CAN = b"EVT,can,0.94,RECYCLABLE,412\n"
CAN_EVENT = EventLine("can", 0.94, "RECYCLABLE", 412)


def packet(kind: int = KIND_VERDICT, fill: int = 5, size: int = 96) -> bytes:
    return encode_packet(kind, size, size, bytes([fill]) * (size * size))


def frame(kind: int = KIND_VERDICT, fill: int = 5, size: int = 96) -> FramePacket:
    return FramePacket(kind, size, size, bytes([fill]) * (size * size))


def feed_all(parser: StreamParser, data: bytes, chunk: int | None = None) -> list[StreamItem]:
    items: list[StreamItem] = []
    if chunk is None:
        return parser.feed(data)
    for i in range(0, len(data), chunk):
        items += parser.feed(data[i : i + chunk])
    return items


@pytest.fixture
def parser(clock: FakeClock) -> StreamParser:
    return StreamParser(clock)


class TestText:
    def test_lines_in_one_read(self, parser: StreamParser) -> None:
        data = b"HELLO,1.0\nHB,5000\n" + EVT_CAN + b"DBG,hi\n"
        assert parser.feed(data) == [
            HelloLine("1.0"),
            HeartbeatLine(5000),
            CAN_EVENT,
            DebugLine("hi"),
        ]

    def test_crlf_endings(self, parser: StreamParser) -> None:
        assert parser.feed(b"HB,1\r\nHB,2\r\n") == [HeartbeatLine(1), HeartbeatLine(2)]

    @pytest.mark.parametrize("chunk", [1, 2, 3, 7])
    def test_lines_split_at_any_point(self, parser: StreamParser, chunk: int) -> None:
        assert feed_all(parser, b"HB,12\n" + EVT_CAN, chunk) == [HeartbeatLine(12), CAN_EVENT]

    def test_blank_lines_are_ignored_silently(self, parser: StreamParser) -> None:
        assert parser.feed(b"\n\r\n  \nHB,1\n") == [HeartbeatLine(1)]

    def test_bad_lines_are_rejected_and_the_next_one_still_parses(
        self, parser: StreamParser
    ) -> None:
        items = parser.feed(b"nonsense\nEVT,can,9.99,TRASH,1\n" + EVT_CAN)
        assert [type(item) for item in items] == [Rejected, Rejected, EventLine]

    def test_oversize_line_is_dropped_once_and_resyncs_at_the_newline(
        self, parser: StreamParser
    ) -> None:
        items = feed_all(parser, b"x" * 5000 + b"\n" + EVT_CAN, chunk=100)
        assert items == [Rejected("line over 64 bytes"), CAN_EVENT]

    def test_oversize_line_with_no_newline_then_a_frame(self, parser: StreamParser) -> None:
        items = parser.feed(b"y" * 500 + packet())
        assert items == [Rejected("line interrupted by a frame"), frame()]

    def test_garbage_bytes_then_a_valid_line(self, parser: StreamParser) -> None:
        items = parser.feed(b"\x00\xff\xfe\x80\x81garbage\n" + EVT_CAN)
        assert isinstance(items[0], Rejected)
        assert items[-1] == CAN_EVENT


class TestFrames:
    def test_a_verdict_frame_then_its_event(self, parser: StreamParser) -> None:
        assert parser.feed(packet() + EVT_CAN) == [frame(), CAN_EVENT]

    def test_a_preview_frame(self, parser: StreamParser) -> None:
        assert parser.feed(packet(KIND_PREVIEW, fill=200)) == [frame(KIND_PREVIEW, fill=200)]

    @pytest.mark.parametrize("chunk", [1, 2, 5, 13, 100, 4096])
    def test_frame_split_at_any_point(self, parser: StreamParser, chunk: int) -> None:
        assert feed_all(parser, packet() + EVT_CAN, chunk) == [frame(), CAN_EVENT]

    @pytest.mark.parametrize("split", [1, 2, 3])
    def test_magic_split_across_two_reads(self, parser: StreamParser, split: int) -> None:
        data = packet()
        assert parser.feed(data[:split]) == []
        assert parser.feed(data[split:]) == [frame()]

    def test_magic_split_right_after_a_text_line(self, parser: StreamParser) -> None:
        data = b"HB,7\n" + packet()
        cut = len(b"HB,7\n") + 2
        assert parser.feed(data[:cut]) == [HeartbeatLine(7)]
        assert parser.feed(data[cut:]) == [frame()]

    def test_text_and_frames_interleaved(self, parser: StreamParser) -> None:
        data = (
            b"HELLO,1\n"
            + packet(KIND_PREVIEW, 1)
            + b"HB,5\n"
            + packet(KIND_PREVIEW, 2)
            + packet(KIND_VERDICT, 3)
            + EVT_CAN
            + b"DBG,x\n"
            + packet(KIND_PREVIEW, 4)
        )
        assert feed_all(parser, data, chunk=333) == [
            HelloLine("1"),
            frame(KIND_PREVIEW, 1),
            HeartbeatLine(5),
            frame(KIND_PREVIEW, 2),
            frame(KIND_VERDICT, 3),
            CAN_EVENT,
            DebugLine("x"),
            frame(KIND_PREVIEW, 4),
        ]

    def test_bad_crc_is_dropped_and_the_next_line_decodes(self, parser: StreamParser) -> None:
        bad = bytearray(packet())
        bad[100] ^= 0xFF
        items = parser.feed(bytes(bad) + EVT_CAN)
        assert items == [FrameError("CRC mismatch"), CAN_EVENT]

    def test_a_bad_crc_does_not_report_noise_inside_the_payload_as_dropped_lines(
        self, parser: StreamParser
    ) -> None:
        # Payload full of 0x0A would otherwise look like hundreds of rejected lines.
        bad = bytearray(encode_packet(KIND_VERDICT, 96, 96, b"\n" * 9216))
        bad[200] = 0x00
        items = parser.feed(bytes(bad) + EVT_CAN)
        assert items == [FrameError("CRC mismatch"), CAN_EVENT]

    def test_wrong_length_is_dropped_and_the_next_line_decodes(self, parser: StreamParser) -> None:
        bad = bytearray(packet())
        bad[9] = 0x01  # length field no longer equals width * height
        items = parser.feed(bytes(bad) + EVT_CAN)
        assert items[0] == FrameError("payload length does not match dimensions")
        assert items[-1] == CAN_EVENT

    def test_unknown_frame_type_is_dropped(self, parser: StreamParser) -> None:
        bad = bytearray(packet())
        bad[4] = 9
        items = parser.feed(bytes(bad) + EVT_CAN)
        assert items[0] == FrameError("unknown frame type")
        assert items[-1] == CAN_EVENT

    def test_oversize_payload_is_refused_without_buffering_it(self, parser: StreamParser) -> None:
        header = (
            MAGIC
            + bytes([1])
            + (200).to_bytes(2, "little")
            + (200).to_bytes(2, "little")
            + (40000).to_bytes(4, "little")
        )
        assert parser.feed(header + EVT_CAN) == [FrameError("payload too large"), CAN_EVENT]

    def test_truncated_packet_followed_by_good_data_loses_nothing_else(
        self, parser: StreamParser
    ) -> None:
        # The Nano reset mid-packet; its next output arrives straight away.
        truncated = packet()[:109]
        following = b"HELLO,2\n" + packet(KIND_PREVIEW, 8) + EVT_CAN
        items = parser.feed(truncated + following)
        assert items[0] == FrameError("CRC mismatch")
        assert items[1:] == [HelloLine("2"), frame(KIND_PREVIEW, 8), CAN_EVENT]

    def test_stall_mid_packet_drops_it_and_resyncs(
        self, parser: StreamParser, clock: FakeClock
    ) -> None:
        assert parser.feed(packet()[:500]) == []
        clock.advance(0.4)
        assert parser.check_stall() == []
        clock.advance(0.2)
        assert parser.check_stall() == [FrameError("stalled mid-packet")]
        assert parser.feed(EVT_CAN) == [CAN_EVENT]

    def test_a_stalled_packet_is_dropped_when_the_next_bytes_arrive(
        self, parser: StreamParser, clock: FakeClock
    ) -> None:
        parser.feed(packet()[:500])
        clock.advance(2.0)
        items = parser.feed(b"HB,1\n" + EVT_CAN)
        assert items == [FrameError("stalled mid-packet"), HeartbeatLine(1), CAN_EVENT]

    def test_a_steady_trickle_is_not_a_stall(self, parser: StreamParser, clock: FakeClock) -> None:
        data = packet()
        items: list[StreamItem] = []
        for i in range(0, len(data), 1000):
            clock.advance(0.3)
            items += parser.feed(data[i : i + 1000])
            items += parser.check_stall()
        assert items == [frame()]

    def test_a_text_line_cut_short_by_a_frame_is_rejected(self, parser: StreamParser) -> None:
        items = parser.feed(b"HB,12" + packet())
        assert items == [Rejected("line interrupted by a frame"), frame()]


# -- fuzz ---------------------------------------------------------------------------

_BIASED = bytes(MAGIC) + b"\n\r\x00\xffEVTHBDG,.0123456789"
_SENTINEL_FRAME = FramePacket(KIND_VERDICT, 8, 8, bytes(range(64)))
_SENTINEL = b"\n" + encode_packet(KIND_VERDICT, 8, 8, bytes(range(64))) + b"HELLO,zz\n"


def _random_bytes(rng: random.Random, n: int) -> bytes:
    if rng.random() < 0.5:
        return rng.randbytes(n)
    return bytes(rng.choice(_BIASED) for _ in range(n))


def _valid_stream(rng: random.Random) -> bytes:
    pieces = []
    for _ in range(rng.randint(1, 8)):
        pick = rng.random()
        if pick < 0.35:
            size = rng.choice([4, 8, 16])
            pieces.append(encode_packet(rng.choice([1, 2]), size, size, rng.randbytes(size * size)))
        elif pick < 0.7:
            pieces.append(EVT_CAN)
        elif pick < 0.85:
            pieces.append(b"HB,%d\n" % rng.randint(0, 10**6))
        else:
            pieces.append(b"DBG,hello\n")
    return b"".join(pieces)


def _corrupt(rng: random.Random, data: bytes) -> bytes:
    buf = bytearray(data)
    for _ in range(rng.randint(1, 6)):
        if not buf:
            break
        op = rng.choice(["flip", "delete", "insert", "truncate", "duplicate"])
        i = rng.randrange(len(buf))
        if op == "flip":
            buf[i] ^= 1 << rng.randrange(8)
        elif op == "delete":
            del buf[i : i + rng.randint(1, 40)]
        elif op == "insert":
            buf[i:i] = _random_bytes(rng, rng.randint(1, 40))
        elif op == "truncate":
            del buf[i:]
        else:
            j = min(len(buf), i + rng.randint(1, 60))
            buf[i:i] = buf[i:j]
    return bytes(buf)


def _feed_randomly(parser: StreamParser, rng: random.Random, data: bytes) -> list[StreamItem]:
    items: list[StreamItem] = []
    i = 0
    while i < len(data):
        step = rng.choice([1, 2, 3, 7, 64, 500])
        items += parser.feed(data[i : i + step])
        i += step
    return items


def _assert_resyncs(parser: StreamParser, clock: FakeClock) -> None:
    clock.advance(1.0)  # a pause long enough to expire any half-received packet
    items = parser.feed(_SENTINEL)
    assert items[-2:] == [_SENTINEL_FRAME, HelloLine("zz")]


def test_fuzz_random_bytes_never_raise_and_always_resync(clock: FakeClock) -> None:
    rng = random.Random(1234)
    started = time.monotonic()
    for _ in range(400):
        parser = StreamParser(clock)
        items = _feed_randomly(parser, rng, _random_bytes(rng, rng.randint(0, 3000)))
        assert all(isinstance(item, get_args(StreamItem)) for item in items)
        _assert_resyncs(parser, clock)
    assert time.monotonic() - started < 30, "parser is suspiciously slow"


def test_fuzz_corrupted_valid_streams_never_raise_and_always_resync(clock: FakeClock) -> None:
    rng = random.Random(5678)
    started = time.monotonic()
    for _ in range(400):
        parser = StreamParser(clock)
        damaged = _corrupt(rng, _valid_stream(rng))
        _feed_randomly(parser, rng, damaged)
        _assert_resyncs(parser, clock)
    assert time.monotonic() - started < 30, "parser is suspiciously slow"


def test_fuzz_an_undamaged_stream_decodes_exactly(clock: FakeClock) -> None:
    rng = random.Random(91011)
    for _ in range(200):
        parser = StreamParser(clock)
        stream = _valid_stream(rng)
        clean = StreamParser(clock).feed(stream)
        assert not any(isinstance(item, (Rejected, FrameError)) for item in clean)
        assert _feed_randomly(parser, rng, stream) == clean


def test_fuzz_frame_damage_never_costs_a_good_line_or_a_good_frame(clock: FakeClock) -> None:
    """Counts must stay exact: whatever happens to a frame, every intact line and every
    intact frame around it is still decoded, with no separator needed."""
    rng = random.Random(2468)
    for _ in range(600):
        stream = bytearray()
        expected: list[StreamItem] = []
        for _ in range(rng.randint(2, 10)):
            pick = rng.random()
            if pick < 0.30:
                pixels = rng.randbytes(64)
                stream += encode_packet(KIND_VERDICT, 8, 8, pixels)
                expected.append(FramePacket(KIND_VERDICT, 8, 8, pixels))
            elif pick < 0.55:
                whole = encode_packet(KIND_PREVIEW, 8, 8, rng.randbytes(64))
                damaged = bytearray(whole)
                if rng.random() < 0.5:
                    damaged[rng.randrange(len(damaged))] ^= 1 << rng.randrange(8)
                else:
                    # Truncated by a reset. Never exactly one byte short: the next byte then
                    # becomes the CRC's last byte and matches by chance 1 time in 256, which
                    # no 16-bit CRC can rule out.
                    del damaged[rng.randrange(1, len(damaged) - 1) :]
                stream += damaged
            elif pick < 0.80:
                stream += EVT_CAN
                expected.append(CAN_EVENT)
            elif pick < 0.90:
                stream += b"HELLO,2\n"
                expected.append(HelloLine("2"))
            else:
                stream += b"HB,9\n"
                expected.append(HeartbeatLine(9))
        parser = StreamParser(clock)
        items = _feed_randomly(parser, rng, bytes(stream))
        # Anything the damage left half-received is flushed by a pause, as in real use.
        clock.advance(1.0)
        items += parser.check_stall()
        decoded = [item for item in items if not isinstance(item, Rejected | FrameError)]
        assert decoded == expected


def test_memory_stays_bounded_on_endless_garbage(clock: FakeClock) -> None:
    parser = StreamParser(clock)
    for _ in range(200):
        parser.feed(b"z" * 10_000)
    assert len(parser._line) <= 66  # the documented bound
