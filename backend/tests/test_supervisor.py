import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable

import pytest

from app.frames import to_jpeg
from app.hub import EventMsg, Hub, LinkMsg, ResetMsg
from app.link import LinkTracker
from app.sources.base import SourceObserver
from app.store import Store
from app.supervisor import Supervisor
from tests.helpers import FakeClock, IdleSource, evt, preview_packet, tiny_frame


class TestIngest:
    def test_an_event_is_stored_published_and_counted(self, supervisor: Supervisor) -> None:
        with supervisor.hub.subscribe() as sub:
            supervisor.ingest_bytes(evt("can", "RECYCLABLE", "0.94", 412))
            message = sub._queue.get_nowait()
        assert isinstance(message, EventMsg)
        assert (message.event.label, message.event.bin, message.event.latency_ms) == (
            "can",
            "recyclable",
            412,
        )
        state = supervisor.get_state()
        assert (state.counts.recyclable, state.counts.trash, state.counts.total_sorted) == (1, 0, 1)
        assert state.last_event == message.event

    def test_the_server_decides_the_bin_and_counts_a_mismatch(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(evt("pen", "RECYCLABLE"))  # firmware disagrees with the table
        state = supervisor.get_state()
        assert state.last_event is not None
        assert state.last_event.bin == "trash"
        assert (state.counts.trash, state.counts.recyclable) == (1, 0)
        assert state.link.bin_mismatch == 1

    def test_agreeing_firmware_is_not_a_mismatch(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(evt("glass_bottle", "RECYCLABLE") + evt("phone_case", "TRASH"))
        assert supervisor.get_state().link.bin_mismatch == 0

    def test_uncertain_is_stored_as_unsure_and_added_to_neither_total(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(evt("uncertain", "NONE", "0.41"))
        state = supervisor.get_state()
        assert state.last_event is not None
        assert state.last_event.bin == "unsure"
        assert (state.counts.recyclable, state.counts.trash, state.counts.unsure) == (0, 0, 1)
        assert state.counts.total_sorted == 0
        assert state.counts.recycle_rate is None
        assert state.link.bin_mismatch == 0

    def test_uncertain_with_a_real_bin_from_firmware_is_a_mismatch(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(evt("uncertain", "TRASH"))
        assert supervisor.get_state().link.bin_mismatch == 1

    def test_background_is_ignored_counted_and_never_stored(self, supervisor: Supervisor) -> None:
        with supervisor.hub.subscribe() as sub:
            supervisor.ingest_bytes(evt("background", "NONE"))
            assert sub._queue.empty()
        state = supervisor.get_state()
        assert state.link.ignored_background == 1
        assert state.last_event is None
        assert (state.counts.total_sorted, state.counts.unsure) == (0, 0)

    def test_bad_lines_are_dropped_and_counted_but_good_ones_still_land(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(b"nonsense\nEVT,can,9.99,RECYCLABLE,1\n" + evt("pen", "TRASH"))
        state = supervisor.get_state()
        assert state.link.dropped_lines == 2
        assert state.counts.trash == 1

    def test_debug_lines_are_ignored_and_not_counted_as_dropped(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(b"DBG,model loaded\n")
        link = supervisor.get_state().link
        assert link.dropped_lines == 0
        assert link.last_line_age_s == 0.0

    def test_heartbeat_age_tracks_hb_lines_not_other_traffic(
        self, supervisor: Supervisor, clock: FakeClock
    ) -> None:
        assert supervisor.get_state().link.last_heartbeat_age_s is None
        supervisor.ingest_bytes(b"HB,5000\n")
        clock.advance(7)
        supervisor.ingest_bytes(b"DBG,still here\n" + evt("can", "RECYCLABLE"))
        link = supervisor.get_state().link
        assert link.last_heartbeat_age_s == 7.0
        assert link.last_line_age_s == 0.0

    def test_the_first_hello_is_not_a_reset_a_later_one_is(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(b"HELLO,1.0\n")
        assert supervisor.get_state().link.nano_resets_seen == 0
        supervisor.ingest_bytes(b"HB,5000\n" + evt("can", "RECYCLABLE") + b"HELLO,1.0\n")
        assert supervisor.get_state().link.nano_resets_seen == 1

    def test_a_hello_after_heartbeats_alone_is_a_reset(self, supervisor: Supervisor) -> None:
        # The bridge started after the Nano did, so it never saw the first HELLO.
        supervisor.ingest_bytes(b"HB,5000\nHELLO,1.0\n")
        assert supervisor.get_state().link.nano_resets_seen == 1

    def test_hello_counts_as_a_heartbeat(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(b"HELLO,1.0\n")
        assert supervisor.get_state().link.last_heartbeat_age_s == 0.0

    def test_a_handler_failure_is_logged_and_the_next_item_still_lands(
        self, supervisor: Supervisor, store: Store, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real_add = store.add_event
        calls = {"n": 0}

        def flaky(*args: object, **kwargs: object):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("disk full")
            return real_add(*args, **kwargs)  # type: ignore[arg-type]

        monkeypatch.setattr(store, "add_event", flaky)
        supervisor.ingest_bytes(evt("can", "RECYCLABLE") + evt("pen", "TRASH"))
        assert supervisor.get_state().counts.trash == 1


class TestFrames:
    def test_the_verdict_frame_attaches_to_the_next_event(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(tiny_frame(fill=42) + evt("can", "RECYCLABLE"))
        event = supervisor.get_state().last_event
        assert event is not None
        assert event.has_frame is True
        stored = supervisor.store.get_frame(event.id)
        assert stored is not None
        assert stored.pixels == bytes([42]) * 64

    def test_a_frame_is_attached_across_separate_reads(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(tiny_frame())
        supervisor.ingest_bytes(evt("pen", "TRASH"))
        assert supervisor.get_state().last_event.has_frame is True  # type: ignore[union-attr]

    def test_a_frame_older_than_three_seconds_is_discarded(
        self, supervisor: Supervisor, clock: FakeClock
    ) -> None:
        supervisor.ingest_bytes(tiny_frame())
        clock.advance(3.5)
        supervisor.ingest_bytes(evt("can", "RECYCLABLE"))
        assert supervisor.get_state().last_event.has_frame is False  # type: ignore[union-attr]

    def test_a_frame_just_inside_three_seconds_is_kept(
        self, supervisor: Supervisor, clock: FakeClock
    ) -> None:
        supervisor.ingest_bytes(tiny_frame())
        clock.advance(2.9)
        supervisor.ingest_bytes(evt("can", "RECYCLABLE"))
        assert supervisor.get_state().last_event.has_frame is True  # type: ignore[union-attr]

    def test_a_frame_attaches_to_one_event_only(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(tiny_frame() + evt("can", "RECYCLABLE") + evt("pen", "TRASH"))
        events = supervisor.store.recent_events(supervisor.store.current_run().id)
        assert [e.has_frame for e in events] == [False, True]  # newest first

    def test_an_ignored_background_event_still_consumes_its_frame(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(tiny_frame(fill=1) + evt("background", "NONE"))
        supervisor.ingest_bytes(evt("can", "RECYCLABLE"))
        assert supervisor.get_state().last_event.has_frame is False  # type: ignore[union-attr]

    def test_an_uncertain_event_keeps_its_frame_for_inspection(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(tiny_frame() + evt("uncertain", "NONE", "0.41"))
        assert supervisor.get_state().last_event.has_frame is True  # type: ignore[union-attr]

    def test_the_newest_unclaimed_frame_wins(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(tiny_frame(fill=1) + tiny_frame(fill=2) + evt("can", "RECYCLABLE"))
        event = supervisor.get_state().last_event
        assert event is not None
        assert supervisor.store.get_frame(event.id).pixels == bytes([2]) * 64  # type: ignore[union-attr]

    def test_frames_are_counted_and_crc_errors_reported(self, supervisor: Supervisor) -> None:
        bad = bytearray(tiny_frame())
        bad[20] ^= 0xFF
        supervisor.ingest_bytes(tiny_frame() + preview_packet() + bytes(bad) + evt("can", "TRASH"))
        link = supervisor.get_state().link
        assert (link.frames_received, link.frame_crc_errors) == (2, 1)

    def test_a_corrupt_frame_never_costs_the_event_behind_it(self, supervisor: Supervisor) -> None:
        bad = bytearray(tiny_frame())
        bad[30] ^= 0x55
        supervisor.ingest_bytes(bytes(bad) + evt("pen", "TRASH"))
        state = supervisor.get_state()
        assert state.counts.trash == 1
        assert state.last_event.has_frame is False  # type: ignore[union-attr]

    def test_preview_frames_are_not_encoded_when_nobody_is_watching(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(preview_packet())
        assert supervisor.hub.frames.seq == 0
        assert supervisor.get_state().link.frames_received == 1

    def test_preview_frames_reach_the_hub_as_jpeg_when_someone_watches(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.viewer_connected()
        supervisor.ingest_bytes(preview_packet(fill=9))
        assert supervisor.hub.frames.seq == 1
        assert supervisor.hub.frames.jpeg == to_jpeg(bytes([9]) * 64, 8, 8)

    def test_a_preview_frame_never_attaches_to_an_event(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(preview_packet() + evt("can", "RECYCLABLE"))
        assert supervisor.get_state().last_event.has_frame is False  # type: ignore[union-attr]

    def test_preview_fps_is_reported_while_frames_flow(
        self, supervisor: Supervisor, clock: FakeClock
    ) -> None:
        for _ in range(8):
            supervisor.ingest_bytes(preview_packet())
            clock.advance(0.2)
        assert supervisor.get_state().link.preview_fps == 4.0  # 8 frames over a 2 s window
        clock.advance(5)
        assert supervisor.get_state().link.preview_fps is None


class TestRuns:
    def test_a_new_run_zeroes_counts_and_resets_per_run_link_counters(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(b"HB,1\nHELLO,1\n" + evt("can", "RECYCLABLE") + b"junk\n")
        before = supervisor.get_state()
        assert before.counts.total_sorted == 1
        assert before.link.nano_resets_seen == 1
        after = supervisor.start_new_run()
        assert after.run.id != before.run.id
        assert after.counts.total_sorted == 0
        assert after.last_event is None
        assert after.link.nano_resets_seen == 0
        assert after.link.dropped_lines == before.link.dropped_lines  # link-lifetime counter

    def test_a_new_run_notifies_subscribers(self, supervisor: Supervisor) -> None:
        with supervisor.hub.subscribe() as sub:
            supervisor.start_new_run()
            assert sub._queue.get_nowait() == ResetMsg()

    def test_a_pending_frame_does_not_leak_into_the_next_run(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(tiny_frame())
        supervisor.start_new_run()
        supervisor.ingest_bytes(evt("can", "RECYCLABLE"))
        assert supervisor.get_state().last_event.has_frame is False  # type: ignore[union-attr]

    def test_events_after_a_new_run_belong_to_it(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(evt("can", "RECYCLABLE"))
        new = supervisor.start_new_run()
        supervisor.ingest_bytes(evt("pen", "TRASH"))
        state = supervisor.get_state()
        assert state.run.id == new.run.id
        assert (state.counts.recyclable, state.counts.trash) == (0, 1)


class ScriptedSource:
    """Fails a set number of times, then idles; records every open and every command."""

    def __init__(self, failures: int = 0) -> None:
        self.name = "sim"
        self.failures = failures
        self.opens = 0
        self.writes: list[bytes] = []
        self.fail_writes = 0

    async def chunks(self, observer: SourceObserver) -> AsyncIterator[bytes]:
        self.opens += 1
        if self.failures > 0:
            self.failures -= 1
            raise RuntimeError("serial port vanished")
        observer.opened(None)
        try:
            await asyncio.Event().wait()
            yield b""
        finally:
            observer.closed()

    async def write(self, data: bytes) -> None:
        if self.fail_writes > 0:
            self.fail_writes -= 1
            raise OSError("write failed")
        self.writes.append(data)


async def settle(predicate: Callable[[], bool], within_s: float = 2.0) -> None:
    """Poll until `predicate` holds. The supervisor offers no event to wait on."""
    async with asyncio.timeout(within_s):
        while not predicate():  # noqa: ASYNC110
            await asyncio.sleep(0.005)


@contextlib.asynccontextmanager
async def running(supervisor: Supervisor) -> AsyncIterator[None]:
    task = asyncio.create_task(supervisor.run())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@pytest.mark.anyio
class TestLoops:
    async def test_the_first_viewer_sends_p1_and_the_last_to_leave_sends_p0(
        self, store: Store, clock: FakeClock
    ) -> None:
        source = ScriptedSource()
        supervisor = Supervisor(
            store, Hub(), LinkTracker(clock), source, monotonic=clock, tick_s=0.01
        )
        async with running(supervisor):
            await settle(lambda: supervisor.link.source_open)
            assert source.writes == []  # an idle Nano stays event-driven

            supervisor.viewer_connected()
            await settle(lambda: source.writes == [b"P1\n"])
            assert supervisor.get_state().link.preview_active is True

            supervisor.viewer_connected()  # a second tab changes nothing
            supervisor.viewer_disconnected()
            await asyncio.sleep(0.05)
            assert source.writes == [b"P1\n"]

            supervisor.viewer_disconnected()
            await settle(lambda: source.writes == [b"P1\n", b"P0\n"])
            assert supervisor.get_state().link.preview_active is False

    async def test_preview_is_requested_again_when_the_port_comes_back(
        self, store: Store, clock: FakeClock
    ) -> None:
        source = ScriptedSource()
        supervisor = Supervisor(
            store,
            Hub(),
            LinkTracker(clock),
            source,
            monotonic=clock,
            tick_s=0.01,
            sleep=lambda _s: asyncio.sleep(0),
        )
        async with running(supervisor):
            await settle(lambda: supervisor.link.source_open)
            supervisor.viewer_connected()
            await settle(lambda: source.writes == [b"P1\n"])
            supervisor.link.closed()  # the port dropped and reopened
            await asyncio.sleep(0.05)
            supervisor.link.opened(None)
            await settle(lambda: source.writes == [b"P1\n", b"P1\n"])

    async def test_a_failed_command_is_retried(self, store: Store, clock: FakeClock) -> None:
        source = ScriptedSource()
        source.fail_writes = 1
        supervisor = Supervisor(
            store, Hub(), LinkTracker(clock), source, monotonic=clock, tick_s=0.01
        )
        async with running(supervisor):
            await settle(lambda: supervisor.link.source_open)
            supervisor.viewer_connected()
            await asyncio.sleep(0.05)
            assert source.writes == []
            clock.advance(5)  # past the retry delay
            await settle(lambda: source.writes == [b"P1\n"])

    async def test_a_failing_source_is_restarted_with_growing_backoff(
        self, store: Store, clock: FakeClock
    ) -> None:
        delays: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            delays.append(seconds)
            await asyncio.sleep(0)

        source = ScriptedSource(failures=5)
        supervisor = Supervisor(
            store, Hub(), LinkTracker(clock), source, monotonic=clock, tick_s=0.01, sleep=fake_sleep
        )
        async with running(supervisor):
            await settle(lambda: supervisor.link.source_open)
        assert delays == [1.0, 2.0, 4.0, 8.0, 10.0]  # capped at ten seconds
        assert source.opens == 6

    async def test_link_changes_are_published_to_subscribers(
        self, store: Store, clock: FakeClock
    ) -> None:
        supervisor = Supervisor(
            store,
            Hub(),
            LinkTracker(clock),
            IdleSource(),
            monotonic=clock,
            tick_s=0.01,
            link_min_interval_s=0.0,
        )
        async with running(supervisor):
            await settle(lambda: supervisor.link.source_open)
            with supervisor.hub.subscribe() as sub:
                supervisor.ingest_bytes(b"HB,5000\n")
                async with asyncio.timeout(2):
                    while True:
                        message = await sub.get(0.5)
                        if (
                            isinstance(message, LinkMsg)
                            and message.link.last_heartbeat_age_s is not None
                        ):
                            break
                assert message.link.source_open is True

    async def test_link_publishing_is_rate_limited(self, store: Store, clock: FakeClock) -> None:
        supervisor = Supervisor(
            store,
            Hub(),
            LinkTracker(clock),
            IdleSource(),
            monotonic=clock,
            tick_s=0.01,
            link_min_interval_s=1.0,
        )
        async with running(supervisor):
            await settle(lambda: supervisor.link.source_open)
            with supervisor.hub.subscribe() as sub:
                for _ in range(50):
                    supervisor.ingest_bytes(b"HB,1\n")
                    await asyncio.sleep(0.002)
                await asyncio.sleep(0.05)
                published = 0
                while await sub.get(0.01) is not None:
                    published += 1
        assert published <= 2

    async def test_a_half_received_frame_is_dropped_by_the_tick(
        self, store: Store, clock: FakeClock
    ) -> None:
        supervisor = Supervisor(
            store, Hub(), LinkTracker(clock), IdleSource(), monotonic=clock, tick_s=0.01
        )
        async with running(supervisor):
            # _consume starts a fresh parser per connection; wait for it before feeding.
            await settle(lambda: supervisor.link.source_open)
            supervisor.ingest_bytes(tiny_frame()[:30])
            clock.advance(1.0)
            await settle(lambda: supervisor.get_state().link.frame_crc_errors == 1)
