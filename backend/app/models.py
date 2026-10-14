"""Pydantic models. FastAPI turns these into the OpenAPI schema the frontend types come from."""

from typing import Literal

from pydantic import BaseModel

from .classes import BinName, StoredBin

SourceName = Literal["serial", "sim", "replay"]


class Run(BaseModel):
    id: int
    started_at: str
    source: SourceName


class Event(BaseModel):
    id: int
    run_id: int
    ts: str
    label: str
    confidence: float
    bin: StoredBin
    latency_ms: int
    has_frame: bool
    source: SourceName


class Counts(BaseModel):
    recyclable: int
    trash: int
    unsure: int
    total_sorted: int
    recycle_rate: float | None


class ItemCount(BaseModel):
    label: str
    display_name: str
    bin: BinName
    count: int


class Link(BaseModel):
    source_open: bool
    port: str | None
    last_line_age_s: float | None
    last_heartbeat_age_s: float | None
    nano_resets_seen: int
    dropped_lines: int
    ignored_background: int
    bin_mismatch: int
    frames_received: int
    frame_crc_errors: int
    preview_active: bool
    preview_fps: float | None


class State(BaseModel):
    run: Run
    counts: Counts
    by_item: list[ItemCount]
    last_event: Event | None
    link: Link


class Health(BaseModel):
    ok: bool
    source: SourceName
