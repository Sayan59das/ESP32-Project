import asyncio
import csv
import io
import json
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import routes
from app.config import Settings
from app.frames import to_jpeg
from app.main import create_app
from app.routes import format_sse, mjpeg_parts, sse_messages
from app.sources.sim_source import SimSource
from app.supervisor import Supervisor
from tests.helpers import IdleSource, evt, preview_packet, tiny_frame


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(db_path=str(tmp_path / "api.db"), source="sim")
    with TestClient(create_app(settings, source=IdleSource())) as test_client:
        yield test_client


def bridge(client: TestClient) -> Supervisor:
    supervisor: Supervisor = client.app.state.supervisor  # type: ignore[attr-defined]
    return supervisor


class TestPlainEndpoints:
    def test_health_names_the_source(self, client: TestClient) -> None:
        assert client.get("/api/health").json() == {"ok": True, "source": "sim"}

    def test_state_before_anything_happens(self, client: TestClient) -> None:
        body = client.get("/api/state").json()
        assert body["counts"] == {
            "recyclable": 0,
            "trash": 0,
            "unsure": 0,
            "total_sorted": 0,
            "recycle_rate": None,
        }
        assert [(i["label"], i["count"]) for i in body["by_item"]] == [
            ("recyclable", 0),
            ("trash", 0),
        ]
        assert body["last_event"] is None
        assert body["run"]["source"] == "sim"
        assert set(body["link"]) == {
            "source_open",
            "port",
            "last_line_age_s",
            "last_heartbeat_age_s",
            "nano_resets_seen",
            "dropped_lines",
            "ignored_background",
            "bin_mismatch",
            "frames_received",
            "frame_crc_errors",
            "preview_active",
            "preview_fps",
        }

    def test_state_reflects_ingested_events(self, client: TestClient) -> None:
        bridge(client).ingest_bytes(
            evt("recyclable", "RECYCLABLE") + evt("trash", "TRASH") + evt("trash", "TRASH")
        )
        body = client.get("/api/state").json()
        assert body["counts"]["recyclable"] == 1
        assert body["counts"]["trash"] == 2
        assert body["counts"]["recycle_rate"] == pytest.approx(1 / 3)
        assert body["last_event"]["label"] == "trash"
        assert {i["label"]: i["count"] for i in body["by_item"]}["trash"] == 2


class TestEvents:
    def test_newest_first_with_paging(self, client: TestClient) -> None:
        bridge(client).ingest_bytes(b"".join(evt("recyclable", "RECYCLABLE") for _ in range(5)))
        everything = client.get("/api/events").json()
        ids = [e["id"] for e in everything]
        assert ids == sorted(ids, reverse=True)
        assert [e["id"] for e in client.get("/api/events?limit=2").json()] == ids[:2]
        older = client.get(f"/api/events?limit=10&before_id={ids[2]}").json()
        assert [e["id"] for e in older] == ids[3:]

    def test_event_shape(self, client: TestClient) -> None:
        bridge(client).ingest_bytes(tiny_frame() + evt("recyclable", "RECYCLABLE", "0.94", 412))
        event = client.get("/api/events").json()[0]
        assert set(event) == {
            "id",
            "run_id",
            "ts",
            "label",
            "confidence",
            "bin",
            "latency_ms",
            "has_frame",
            "source",
        }
        assert (event["label"], event["bin"], event["confidence"], event["latency_ms"]) == (
            "recyclable",
            "recyclable",
            0.94,
            412,
        )
        assert event["has_frame"] is True
        assert event["ts"].endswith("Z")

    @pytest.mark.parametrize("query", ["limit=0", "limit=501", "limit=abc", "before_id=0"])
    def test_bad_query_is_a_422(self, client: TestClient, query: str) -> None:
        assert client.get(f"/api/events?{query}").status_code == 422

    def test_only_the_current_run_is_listed(self, client: TestClient) -> None:
        bridge(client).ingest_bytes(evt("recyclable", "RECYCLABLE"))
        client.post("/api/runs")
        assert client.get("/api/events").json() == []


class TestFramePng:
    def test_it_returns_the_stored_frame_as_a_lossless_grayscale_png(
        self, client: TestClient
    ) -> None:
        bridge(client).ingest_bytes(tiny_frame(fill=77) + evt("recyclable", "RECYCLABLE"))
        event_id = client.get("/api/events").json()[0]["id"]
        response = client.get(f"/api/events/{event_id}/frame.png")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert "immutable" in response.headers["cache-control"]
        image = Image.open(io.BytesIO(response.content))
        assert (image.format, image.mode, image.size) == ("PNG", "L", (8, 8))
        assert image.tobytes() == bytes([77]) * 64

    def test_an_event_without_a_frame_is_a_404(self, client: TestClient) -> None:
        bridge(client).ingest_bytes(evt("recyclable", "RECYCLABLE"))
        event_id = client.get("/api/events").json()[0]["id"]
        assert client.get(f"/api/events/{event_id}/frame.png").status_code == 404

    def test_an_unknown_event_is_a_404(self, client: TestClient) -> None:
        assert client.get("/api/events/4242/frame.png").status_code == 404


class TestRunsAndExport:
    def test_a_new_run_zeroes_the_counts_and_the_export_keeps_the_old_one(
        self, client: TestClient
    ) -> None:
        bridge(client).ingest_bytes(
            tiny_frame() + evt("recyclable", "RECYCLABLE") + evt("trash", "TRASH")
        )
        old_run = client.get("/api/state").json()["run"]["id"]
        response = client.post("/api/runs")
        assert response.status_code == 200
        fresh = response.json()
        assert fresh["run"]["id"] != old_run
        assert fresh["counts"]["total_sorted"] == 0
        assert client.get("/api/state").json()["counts"]["total_sorted"] == 0

        bridge(client).ingest_bytes(evt("recyclable", "RECYCLABLE"))
        rows = list(csv.reader(io.StringIO(client.get("/api/export.csv").text)))
        assert rows[0] == [
            "run_id",
            "ts_utc",
            "label",
            "bin",
            "confidence",
            "latency_ms",
            "source",
            "has_frame",
        ]
        body = rows[1:]
        assert [(r[0], r[2], r[3], r[6], r[7]) for r in body] == [
            (str(old_run), "recyclable", "recyclable", "sim", "true"),
            (str(old_run), "trash", "trash", "sim", "false"),
            (str(fresh["run"]["id"]), "recyclable", "recyclable", "sim", "false"),
        ]

    def test_export_is_a_csv_download(self, client: TestClient) -> None:
        response = client.get("/api/export.csv")
        assert response.headers["content-type"].startswith("text/csv")
        assert "attachment" in response.headers["content-disposition"]
        assert response.text.splitlines() == [
            "run_id,ts_utc,label,bin,confidence,latency_ms,source,has_frame"
        ]

    def test_a_post_from_another_website_is_refused(self, client: TestClient) -> None:
        run_before = client.get("/api/state").json()["run"]["id"]
        refused = client.post("/api/runs", headers={"Origin": "http://evil.example"})
        assert refused.status_code == 403
        assert client.get("/api/state").json()["run"]["id"] == run_before

    def test_a_post_from_the_console_origin_is_allowed(self, client: TestClient) -> None:
        response = client.post("/api/runs", headers={"Origin": "http://localhost:3000"})
        assert response.status_code == 200


class TestCors:
    def test_the_console_origin_is_allowed(self, client: TestClient) -> None:
        response = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"

    def test_other_origins_get_no_cors_header(self, client: TestClient) -> None:
        response = client.get("/api/health", headers={"Origin": "http://evil.example"})
        assert "access-control-allow-origin" not in response.headers

    def test_preflight_for_the_run_button(self, client: TestClient) -> None:
        response = client.options(
            "/api/runs",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code == 200
        assert "POST" in response.headers["access-control-allow-methods"]


def test_openapi_schema_carries_the_contract(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert "has_frame" in schema["components"]["schemas"]["Event"]["properties"]
    link = schema["components"]["schemas"]["Link"]["properties"]
    assert {"frames_received", "frame_crc_errors", "preview_active", "preview_fps"} <= set(link)
    assert set(schema["paths"]) >= {
        "/api/health",
        "/api/state",
        "/api/events",
        "/api/events/{event_id}/frame.png",
        "/api/camera/stream",
        "/api/stream",
        "/api/runs",
        "/api/export.csv",
    }


def test_the_sim_source_feeds_the_api_end_to_end(tmp_path: Path) -> None:
    settings = Settings(db_path=str(tmp_path / "sim.db"), source="sim")
    app = create_app(settings, source=SimSource(seed=5, time_scale=2000))
    with TestClient(app) as test_client:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = test_client.get("/api/state").json()
            if state["counts"]["total_sorted"] >= 5:
                break
            time.sleep(0.05)
        else:
            pytest.fail("the simulator produced no events")
        assert state["run"]["source"] == "sim"
        assert state["link"]["source_open"] is True
        assert state["link"]["dropped_lines"] == 0
        assert state["link"]["frame_crc_errors"] == 0
        newest = test_client.get("/api/events").json()[0]
        assert newest["has_frame"] is True
        frame = test_client.get(f"/api/events/{newest['id']}/frame.png")
        png = Image.open(io.BytesIO(frame.content))
        assert (png.mode, png.size) == ("L", (96, 96))


# -- the streams, driven directly because an HTTP test client buffers endless bodies -----


def parse_sse(text: str) -> tuple[str, dict, str | None]:
    event = data = event_id = None
    for line in text.strip().splitlines():
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
        elif line.startswith("id: "):
            event_id = line[4:]
    assert event is not None, text
    assert data is not None, text
    return event, data, event_id


@pytest.mark.anyio
class TestSse:
    async def test_state_comes_first_then_each_event_is_followed_by_fresh_state(
        self, supervisor: Supervisor
    ) -> None:
        stream = sse_messages(supervisor, None)
        assert await anext(stream) == "retry: 1000\n\n"
        kind, state, _ = parse_sse(await anext(stream))
        assert kind == "state"
        assert state["counts"]["total_sorted"] == 0

        seen_ids = []
        for label, bin_name in [
            ("recyclable", "RECYCLABLE"),
            ("trash", "TRASH"),
            ("recyclable", "RECYCLABLE"),
        ]:
            supervisor.ingest_bytes(evt(label, bin_name))
            kind, event, event_id = parse_sse(await anext(stream))
            assert (kind, event_id) == ("event", str(event["id"]))
            seen_ids.append(event["id"])
            kind, state, _ = parse_sse(await anext(stream))
            assert kind == "state"
            assert state["last_event"]["id"] == event["id"]
        assert seen_ids == sorted(set(seen_ids))
        assert state["counts"]["total_sorted"] == 3  # the tally of what was streamed
        await stream.aclose()

    async def test_resuming_with_last_event_id_replays_only_what_was_missed(
        self, supervisor: Supervisor
    ) -> None:
        for _ in range(4):
            supervisor.ingest_bytes(evt("recyclable", "RECYCLABLE"))
        recent = supervisor.store.recent_events(supervisor.store.current_run().id)
        first, second, third, fourth = (e.id for e in reversed(recent))

        stream = sse_messages(supervisor, second)
        await anext(stream)  # retry
        assert parse_sse(await anext(stream))[0] == "state"
        replayed = [parse_sse(await anext(stream)) for _ in range(2)]
        assert [(k, i) for k, _, i in replayed] == [("event", str(third)), ("event", str(fourth))]
        assert first < second

        supervisor.ingest_bytes(evt("trash", "TRASH"))  # a live event after the replay
        kind, event, _ = parse_sse(await anext(stream))
        assert (kind, event["label"]) == ("event", "trash")
        await stream.aclose()

    async def test_the_state_sent_on_connect_already_includes_replayed_events(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.ingest_bytes(evt("recyclable", "RECYCLABLE") + evt("trash", "TRASH"))
        stream = sse_messages(supervisor, 0)
        await anext(stream)
        _, state, _ = parse_sse(await anext(stream))
        assert state["counts"]["total_sorted"] == 2  # counts come from the server, once
        await stream.aclose()

    async def test_a_new_run_resends_the_state_zeroed(self, supervisor: Supervisor) -> None:
        supervisor.ingest_bytes(evt("recyclable", "RECYCLABLE"))
        stream = sse_messages(supervisor, None)
        await anext(stream)
        await anext(stream)
        supervisor.start_new_run()
        kind, state, _ = parse_sse(await anext(stream))
        assert kind == "state"
        assert state["counts"]["total_sorted"] == 0
        assert state["last_event"] is None
        await stream.aclose()

    async def test_link_changes_are_relayed_as_link_messages(self, supervisor: Supervisor) -> None:
        from app.hub import LinkMsg

        stream = sse_messages(supervisor, None)
        await anext(stream)
        await anext(stream)
        supervisor.hub.publish(LinkMsg(supervisor.link.snapshot()))
        kind, link, event_id = parse_sse(await anext(stream))
        assert (kind, event_id) == ("link", None)
        assert "source_open" in link
        await stream.aclose()

    async def test_a_keep_alive_comment_is_sent_when_nothing_happens(
        self, supervisor: Supervisor, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(routes, "KEEPALIVE_S", 0.02)
        stream = sse_messages(supervisor, None)
        await anext(stream)
        await anext(stream)
        assert await anext(stream) == ": keep-alive\n\n"
        await stream.aclose()

    async def test_a_subscriber_that_falls_behind_is_cut_off_to_resync(
        self, supervisor: Supervisor
    ) -> None:
        from app.hub import Hub, ResetMsg

        supervisor.hub = Hub(max_queue=2)
        stream = sse_messages(supervisor, None)
        await anext(stream)
        await anext(stream)
        for _ in range(5):
            supervisor.hub.publish(ResetMsg())
        with pytest.raises(StopAsyncIteration):
            await anext(stream)

    async def test_disconnecting_releases_the_subscription(self, supervisor: Supervisor) -> None:
        stream = sse_messages(supervisor, None)
        await anext(stream)
        assert supervisor.hub.subscriber_count == 1
        await stream.aclose()
        assert supervisor.hub.subscriber_count == 0

    def test_format_sse_shape(self, supervisor: Supervisor) -> None:
        text = format_sse("state", supervisor.get_state())
        assert text.startswith("event: state\ndata: {")
        assert text.endswith("}\n\n")
        assert "id:" not in text
        assert format_sse("event", supervisor.get_state().run, 7).startswith("id: 7\nevent: event")


@pytest.mark.anyio
class TestMjpeg:
    async def test_it_streams_multipart_jpeg_parts_of_the_newest_frame(
        self, supervisor: Supervisor
    ) -> None:
        stream = mjpeg_parts(supervisor)
        first = asyncio.ensure_future(anext(stream))
        await asyncio.sleep(0)
        supervisor.ingest_bytes(preview_packet(fill=9))
        part = await asyncio.wait_for(first, 2)
        boundary, headers, rest = part.split(b"\r\n", 2)
        assert boundary == b"--frame"
        assert headers == b"Content-Type: image/jpeg"
        length_line, blank, body = rest.split(b"\r\n", 2)
        jpeg = to_jpeg(bytes([9]) * 64, 8, 8)
        assert length_line == f"Content-Length: {len(jpeg)}".encode()
        assert blank == b""
        assert body == jpeg + b"\r\n"
        await stream.aclose()

    async def test_a_viewer_counts_while_connected_and_not_after(
        self, supervisor: Supervisor
    ) -> None:
        stream = mjpeg_parts(supervisor)
        task = asyncio.ensure_future(anext(stream))
        await asyncio.sleep(0)
        assert supervisor.viewers == 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await stream.aclose()
        assert supervisor.viewers == 0

    async def test_a_new_viewer_never_gets_a_stale_frame(self, supervisor: Supervisor) -> None:
        supervisor.hub.frames.publish(b"old frame from an earlier viewer")
        stream = mjpeg_parts(supervisor)
        task = asyncio.ensure_future(anext(stream))
        await asyncio.sleep(0.02)
        assert not task.done()
        supervisor.hub.frames.publish(to_jpeg(bytes(64), 8, 8))
        assert (await asyncio.wait_for(task, 2)).startswith(b"--frame")
        await stream.aclose()

    async def test_a_slow_client_skips_frames_instead_of_queueing_them(
        self, supervisor: Supervisor
    ) -> None:
        supervisor.viewer_connected()
        stream = mjpeg_parts(supervisor)
        task = asyncio.ensure_future(anext(stream))
        await asyncio.sleep(0)
        for fill in (1, 2, 3, 4, 5):
            supervisor.ingest_bytes(preview_packet(fill))
        part = await asyncio.wait_for(task, 2)
        assert to_jpeg(bytes([5]) * 64, 8, 8) in part  # only the newest
        await stream.aclose()
        supervisor.viewer_disconnected()
