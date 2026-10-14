import asyncio
import contextlib
import random
from pathlib import Path

import pytest

from app.frames import KIND_PREVIEW, KIND_VERDICT, FramePacket
from app.protocol import EventLine, HeartbeatLine, HelloLine, StreamItem, StreamParser
from app.sources.base import SourceError
from app.sources.replay_source import ReplaySource, encode_record, read_recording
from app.sources.sim_source import SimSource, synthetic_frame

pytestmark = pytest.mark.anyio

FAST = 100_000  # virtual seconds per real second


class Observer:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def opened(self, port: str | None) -> None:
        self.calls.append("opened")

    def closed(self) -> None:
        self.calls.append("closed")

    def port_busy(self, port: str) -> None:
        self.calls.append("busy")

    def stream_restarted(self) -> None:
        self.calls.append("restarted")


async def collect(source: SimSource | ReplaySource, observer: Observer, until) -> list[StreamItem]:
    """Parse everything the source sends until `until(items)` is true."""
    parser = StreamParser()
    items: list[StreamItem] = []
    agen = source.chunks(observer)
    try:
        async with asyncio.timeout(10):
            async for chunk in agen:
                items += parser.feed(chunk)
                if until(items):
                    break
    finally:
        await agen.aclose()
    return items


def count(items: list[StreamItem], kind: type) -> int:
    return sum(isinstance(item, kind) for item in items)


class TestSynthetic:
    def test_frames_are_96x96_and_deterministic_per_seed(self) -> None:
        a = synthetic_frame("can", random.Random(1))
        b = synthetic_frame("can", random.Random(1))
        assert len(a) == 96 * 96
        assert a == b

    def test_each_class_has_its_own_shape(self) -> None:
        frames = {
            label: synthetic_frame(label, random.Random(1))
            for label in ("can", "glass_bottle", "pen", "phone_case", None)
        }
        assert len(set(frames.values())) == 5

    def test_the_shape_is_dark_and_the_background_is_not(self) -> None:
        frame = synthetic_frame("can", random.Random(1))
        inside = frame[50 * 96 + 48]  # middle of the can
        outside = frame[5 * 96 + 5]
        assert inside < 100 < outside

    def test_shift_moves_the_shape(self) -> None:
        still = synthetic_frame("can", random.Random(1), shift=0)
        moved = synthetic_frame("can", random.Random(1), shift=12)
        assert still != moved


class TestSim:
    async def test_it_says_hello_first_then_sends_events_with_their_frames(self) -> None:
        observer = Observer()
        source = SimSource(seed=3, time_scale=FAST)
        items = await collect(source, observer, lambda i: count(i, EventLine) >= 5)
        assert items[0] == HelloLine("sim")
        assert observer.calls == ["opened", "closed"]
        for index, item in enumerate(items):
            if isinstance(item, EventLine):
                before = items[index - 1]
                assert isinstance(before, FramePacket)
                assert before.kind == KIND_VERDICT
                assert (before.width, before.height) == (96, 96)

    async def test_heartbeats_arrive_with_a_rising_uptime(self) -> None:
        items = await collect(
            SimSource(seed=3, time_scale=FAST), Observer(), lambda i: count(i, HeartbeatLine) >= 4
        )
        uptimes = [i.uptime_ms for i in items if isinstance(i, HeartbeatLine)]
        assert uptimes == sorted(uptimes)
        assert uptimes[0] > 0

    async def test_events_follow_the_spec_ranges(self) -> None:
        source = SimSource(seed=7, time_scale=FAST)
        items = await collect(source, Observer(), lambda i: count(i, EventLine) >= 400)
        events = [i for i in items if isinstance(i, EventLine)]
        known = {"can", "glass_bottle", "pen", "phone_case"}
        sure = [e for e in events if e.label in known]
        unsure = [e for e in events if e.label == "uncertain"]
        assert {e.label for e in sure} == known
        assert all(0.70 <= e.confidence <= 0.99 for e in sure)
        assert all(0.30 <= e.confidence <= 0.69 for e in unsure)
        assert 0.01 <= len(unsure) / len(events) <= 0.14  # about 1 in 15
        mean_latency = sum(e.latency_ms for e in events) / len(events)
        assert 395 <= mean_latency <= 425
        for e in events:
            expected = {"recyclable": "RECYCLABLE", "trash": "TRASH"}
            if e.label in ("can", "glass_bottle"):
                assert e.firmware_bin == expected["recyclable"]
            elif e.label in ("pen", "phone_case"):
                assert e.firmware_bin == expected["trash"]
            else:
                assert e.firmware_bin == "NONE"

    async def test_no_preview_frames_until_p1_and_none_after_p0(self) -> None:
        source = SimSource(seed=3, time_scale=50)
        parser = StreamParser()
        previews = 0

        async def pump() -> None:
            nonlocal previews
            async for chunk in source.chunks(Observer()):
                previews += sum(
                    isinstance(item, FramePacket) and item.kind == KIND_PREVIEW
                    for item in parser.feed(chunk)
                )

        task = asyncio.create_task(pump())
        try:
            await asyncio.sleep(0.3)
            assert previews == 0  # an idle Nano stays event-driven
            await source.write(b"P1\n")
            await asyncio.sleep(0.4)
            assert previews > 3
            await source.write(b"P0\n")
            await asyncio.sleep(0.05)  # a frame already in flight may still arrive
            settled = previews
            await asyncio.sleep(0.3)
            assert previews == settled
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        assert source.commands == [b"P1", b"P0"]

    async def test_commands_with_stray_whitespace_and_several_per_write(self) -> None:
        source = SimSource(seed=1)
        await source.write(b"P1\r\n\nP0\n")
        assert source.commands == [b"P1", b"P0"]

    async def test_closing_the_stream_reports_closed_and_stops_its_tasks(self) -> None:
        observer = Observer()
        before = asyncio.all_tasks()  # includes the test runner's own tasks
        await collect(SimSource(seed=3, time_scale=FAST), observer, lambda i: len(i) >= 3)
        assert observer.calls[-1] == "closed"
        await asyncio.sleep(0)
        assert asyncio.all_tasks() == before


def write_rec(path: Path, records: list[tuple[int, bytes]]) -> None:
    path.write_bytes(b"".join(encode_record(offset, data) for offset, data in records))


class TestReplay:
    RECORDS = (
        (0, b"HELLO,1.0\n"),
        (150, b"HB,5000\nEVT,can,0.9"),
        (400, b"4,RECYCLABLE,412\n"),
    )

    def source(self, path: Path, sleeps: list[float]) -> ReplaySource:
        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)
            await asyncio.sleep(0)

        return ReplaySource(path, loop_gap_s=2.0, sleep=fake_sleep)

    async def test_it_replays_chunks_at_their_recorded_offsets(self, tmp_path: Path) -> None:
        path = tmp_path / "s.rec"
        write_rec(path, list(self.RECORDS))
        sleeps: list[float] = []
        observer = Observer()
        agen = self.source(path, sleeps).chunks(observer)
        chunks = [await anext(agen) for _ in range(3)]
        await agen.aclose()
        assert chunks == [data for _, data in self.RECORDS]
        assert sleeps == [0.0, 0.15, 0.25]
        assert observer.calls == ["opened", "closed"]

    async def test_chunk_splits_are_preserved_so_the_parser_sees_what_it_saw_live(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "s.rec"
        write_rec(path, list(self.RECORDS))
        items = await collect(self.source(path, []), Observer(), lambda i: count(i, EventLine) >= 1)
        assert items == [
            HelloLine("1.0"),
            HeartbeatLine(5000),
            EventLine("can", 0.94, "RECYCLABLE", 412),
        ]

    async def test_it_loops_and_the_looped_hello_is_not_a_nano_reset(self, tmp_path: Path) -> None:
        path = tmp_path / "s.rec"
        write_rec(path, list(self.RECORDS))
        sleeps: list[float] = []
        observer = Observer()
        agen = self.source(path, sleeps).chunks(observer)
        chunks = [await anext(agen) for _ in range(4)]
        await agen.aclose()
        assert chunks[3] == b"HELLO,1.0\n"
        assert observer.calls == ["opened", "restarted", "closed"]
        assert 2.0 in sleeps  # the gap before the loop restarts

    async def test_an_empty_recording_is_a_source_error_with_advice(self, tmp_path: Path) -> None:
        path = tmp_path / "empty.rec"
        path.write_bytes(b"")
        with pytest.raises(SourceError, match=r"scripts/record\.py"):
            await anext(self.source(path, []).chunks(Observer()))

    async def test_a_missing_file_is_a_source_error(self, tmp_path: Path) -> None:
        with pytest.raises(SourceError, match="Cannot read"):
            await anext(self.source(tmp_path / "nope.rec", []).chunks(Observer()))

    async def test_a_source_error_leaves_the_link_untouched(self, tmp_path: Path) -> None:
        observer = Observer()
        with pytest.raises(SourceError):
            await anext(self.source(tmp_path / "nope.rec", []).chunks(observer))
        assert observer.calls == []

    def test_a_truncated_final_record_is_ignored(self, tmp_path: Path) -> None:
        path = tmp_path / "s.rec"
        path.write_bytes(encode_record(0, b"HB,1\n") + encode_record(10, b"HB,2\n")[:-3])
        assert read_recording(path) == [(0, b"HB,1\n")]

    def test_the_record_layout_is_offset_u32_then_length_u16_little_endian(self) -> None:
        assert encode_record(0x01020304, b"ab") == b"\x04\x03\x02\x01\x02\x00ab"

    async def test_commands_are_accepted_and_ignored(self, tmp_path: Path) -> None:
        await self.source(tmp_path / "x.rec", []).write(b"P1\n")
