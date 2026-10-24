import asyncio

import pytest

from app.hub import EventMsg, Hub, LatestFrame, LinkMsg, ResetMsg, SubscriberOverflow
from app.models import Event, Link

pytestmark = pytest.mark.anyio

EVENT = Event(
    id=1,
    run_id=1,
    ts="2026-01-01T00:00:00.000Z",
    label="recyclable",
    confidence=0.9,
    bin="recyclable",
    latency_ms=400,
    has_frame=False,
    source="sim",
)


async def test_subscribers_receive_messages_in_order() -> None:
    hub = Hub()
    with hub.subscribe() as sub:
        hub.publish(EventMsg(EVENT))
        hub.publish(ResetMsg())
        assert await sub.get(1) == EventMsg(EVENT)
        assert await sub.get(1) == ResetMsg()


async def test_every_subscriber_gets_every_message() -> None:
    hub = Hub()
    with hub.subscribe() as a, hub.subscribe() as b:
        hub.publish(ResetMsg())
        assert await a.get(1) == ResetMsg()
        assert await b.get(1) == ResetMsg()


async def test_get_returns_none_after_a_quiet_period() -> None:
    hub = Hub()
    with hub.subscribe() as sub:
        assert await sub.get(0.01) is None


async def test_leaving_the_context_unsubscribes() -> None:
    hub = Hub()
    with hub.subscribe():
        assert hub.subscriber_count == 1
    assert hub.subscriber_count == 0


async def test_a_slow_subscriber_is_dropped_instead_of_blocking_publishers() -> None:
    hub = Hub(max_queue=3)
    with hub.subscribe() as slow, hub.subscribe() as keeping_up:
        for _ in range(5):
            hub.publish(ResetMsg())
            assert await keeping_up.get(1) == ResetMsg()
        assert hub.subscriber_count == 1
        with pytest.raises(SubscriberOverflow):
            await slow.get(1)


async def test_link_messages_are_delivered_whole() -> None:
    hub = Hub()
    link = Link(
        source_open=True,
        port=None,
        last_line_age_s=None,
        last_heartbeat_age_s=None,
        nano_resets_seen=0,
        dropped_lines=0,
        ignored_background=0,
        bin_mismatch=0,
        frames_received=0,
        frame_crc_errors=0,
        preview_active=False,
        preview_fps=None,
    )
    with hub.subscribe() as sub:
        hub.publish(LinkMsg(link))
        assert await sub.get(1) == LinkMsg(link)


class TestLatestFrame:
    async def test_waits_for_a_frame_newer_than_the_one_seen(self) -> None:
        frames = LatestFrame()
        waiter = asyncio.create_task(frames.wait_newer(0, 1))
        await asyncio.sleep(0)
        frames.publish(b"one")
        assert await waiter == (1, b"one")

    async def test_returns_immediately_when_a_newer_frame_already_exists(self) -> None:
        frames = LatestFrame()
        frames.publish(b"one")
        assert await frames.wait_newer(0, 1) == (1, b"one")

    async def test_times_out_with_none_when_no_frame_arrives(self) -> None:
        assert await LatestFrame().wait_newer(0, 0.01) is None

    async def test_a_slow_viewer_skips_to_the_newest_frame(self) -> None:
        frames = LatestFrame()
        for payload in (b"a", b"b", b"c"):
            frames.publish(payload)
        assert await frames.wait_newer(0, 1) == (3, b"c")

    async def test_every_waiting_viewer_is_woken(self) -> None:
        frames = LatestFrame()
        waiters = [asyncio.create_task(frames.wait_newer(0, 1)) for _ in range(3)]
        await asyncio.sleep(0)
        frames.publish(b"x")
        assert await asyncio.gather(*waiters) == [(1, b"x")] * 3

    async def test_a_cancelled_viewer_leaves_no_waiter_behind(self) -> None:
        frames = LatestFrame()
        waiter = asyncio.create_task(frames.wait_newer(0, 10))
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert frames._waiters == []
