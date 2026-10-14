"""HTTP API. Handlers are `async def` so they run on the event loop thread, next to ingest."""

import csv
import io
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from .frames import to_png
from .hub import EventMsg, LinkMsg, ResetMsg, SubscriberOverflow
from .models import Event, Health, State
from .supervisor import Supervisor

KEEPALIVE_S = 15.0
MJPEG_BOUNDARY = "frame"
_CSV_HEADER = (
    "run_id",
    "ts_utc",
    "label",
    "bin",
    "confidence",
    "latency_ms",
    "source",
    "has_frame",
)

router = APIRouter(prefix="/api")


def get_supervisor(request: Request) -> Supervisor:
    supervisor: Supervisor = request.app.state.supervisor
    return supervisor


SupervisorDep = Annotated[Supervisor, Depends(get_supervisor)]


def require_allowed_origin(request: Request) -> None:
    """Refuse state-changing requests made by another website's page.

    A browser always sends Origin on cross-site POSTs. Requests without one (curl, tests)
    are not a browser being steered by a third party, so they pass.
    """
    origin = request.headers.get("origin")
    if origin is not None and origin != request.app.state.settings.cors_origin:
        raise HTTPException(status_code=403, detail="Origin not allowed")


def format_sse(event: str, data: BaseModel, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {data.model_dump_json()}\n\n"


async def sse_messages(supervisor: Supervisor, last_event_id: int | None) -> AsyncIterator[str]:
    """The /api/stream body.

    Sends `state` first, replays events the client missed (Last-Event-ID), then relays live
    messages. A fresh `state` follows every `event`, so the browser never has to add one to
    a counter itself. The state is built when it is sent, so it can never be stale.
    """
    with supervisor.hub.subscribe() as subscription:
        yield "retry: 1000\n\n"
        state = supervisor.get_state()
        yield format_sse("state", state)
        replayed_up_to = 0
        if last_event_id is not None:
            for event in supervisor.store.events_after(state.run.id, last_event_id):
                replayed_up_to = event.id
                yield format_sse("event", event, event.id)
        while True:
            try:
                message = await subscription.get(KEEPALIVE_S)
            except SubscriberOverflow:
                return  # too slow; the client reconnects and resyncs from `state`
            if message is None:
                yield ": keep-alive\n\n"
            elif isinstance(message, EventMsg):
                if message.event.id > replayed_up_to:
                    yield format_sse("event", message.event, message.event.id)
                yield format_sse("state", supervisor.get_state())
            elif isinstance(message, LinkMsg):
                yield format_sse("link", message.link)
            elif isinstance(message, ResetMsg):
                replayed_up_to = 0
                yield format_sse("state", supervisor.get_state())


async def mjpeg_parts(supervisor: Supervisor) -> AsyncIterator[bytes]:
    """The /api/camera/stream body. Holds one viewer slot for as long as it is open.

    Only the newest frame is ever sent: a slow client skips frames instead of queueing.
    """
    supervisor.viewer_connected()
    try:
        seq = supervisor.hub.frames.seq  # start from the next frame, never a stale one
        while True:
            newest = await supervisor.hub.frames.wait_newer(seq, KEEPALIVE_S)
            if newest is None:
                continue
            seq, jpeg = newest
            head = f"--{MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
            head += f"Content-Length: {len(jpeg)}\r\n\r\n"
            yield head.encode("ascii") + jpeg + b"\r\n"
    finally:
        supervisor.viewer_disconnected()


def _last_event_id(header: str | None) -> int | None:
    if header is None:
        return None
    try:
        value = int(header)
    except ValueError:
        return None
    return value if value >= 0 else None


@router.get("/health", response_model=Health)
async def health(supervisor: SupervisorDep) -> Health:
    return Health(ok=True, source=supervisor.source.name)


@router.get("/state", response_model=State)
async def state(supervisor: SupervisorDep) -> State:
    return supervisor.get_state()


@router.get("/events", response_model=list[Event])
async def events(
    supervisor: SupervisorDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    before_id: Annotated[int | None, Query(ge=1)] = None,
) -> list[Event]:
    """Newest first, within the current run. Older runs are in /api/export.csv."""
    run = supervisor.store.current_run()
    return supervisor.store.recent_events(run.id, limit, before_id)


@router.get(
    "/events/{event_id}/frame.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, 404: {"description": "No frame stored"}},
)
async def event_frame(event_id: int, supervisor: SupervisorDep) -> Response:
    frame = supervisor.store.get_frame(event_id)
    if frame is None:
        raise HTTPException(status_code=404, detail="This event has no frame")
    return Response(
        to_png(frame.pixels, frame.width, frame.height),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get(
    "/camera/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}": {}}}},
)
async def camera_stream(supervisor: SupervisorDep) -> StreamingResponse:
    return StreamingResponse(
        mjpeg_parts(supervisor),
        media_type=f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}",
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def stream(
    supervisor: SupervisorDep,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    return StreamingResponse(
        sse_messages(supervisor, _last_event_id(last_event_id)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/runs", response_model=State, dependencies=[Depends(require_allowed_origin)])
async def new_run(supervisor: SupervisorDep) -> State:
    return supervisor.start_new_run()


@router.get(
    "/export.csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
async def export_csv(supervisor: SupervisorDep) -> Response:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(_CSV_HEADER)
    for (
        run_id,
        ts,
        label,
        bin_name,
        confidence,
        latency,
        source,
        has_frame,
    ) in supervisor.store.export_rows():
        writer.writerow(
            (run_id, ts, label, bin_name, confidence, latency, source, str(has_frame).lower())
        )
    return Response(
        out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="ecosort-events.csv"'},
    )
