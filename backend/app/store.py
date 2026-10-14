"""SQLite repository: runs, events and verdict frames. Plain sqlite3, no ORM.

Events are never deleted. Counts are always computed from the events table, per run.
A run belongs to exactly one source, so simulated and real events can never mix.
"""

import sqlite3
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .classes import ITEMS, StoredBin
from .frames import FramePacket
from .models import Counts, Event, ItemCount, Run, SourceName

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    source     TEXT NOT NULL CHECK (source IN ('serial', 'sim', 'replay'))
);
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     INTEGER NOT NULL REFERENCES runs(id),
    ts         TEXT NOT NULL,
    label      TEXT NOT NULL,
    confidence REAL NOT NULL,
    bin        TEXT NOT NULL CHECK (bin IN ('recyclable', 'trash', 'unsure')),
    latency_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_run ON events (run_id, id);
CREATE TABLE IF NOT EXISTS frames (
    event_id INTEGER PRIMARY KEY REFERENCES events(id),
    width    INTEGER NOT NULL,
    height   INTEGER NOT NULL,
    pixels   BLOB NOT NULL
);
"""

_EVENT_SELECT = """
SELECT e.id, e.run_id, e.ts, e.label, e.confidence, e.bin, e.latency_ms,
       f.event_id IS NOT NULL AS has_frame, r.source
FROM events e
JOIN runs r ON r.id = e.run_id
LEFT JOIN frames f ON f.event_id = e.id
"""


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _event(row: sqlite3.Row) -> Event:
    return Event(
        id=row["id"],
        run_id=row["run_id"],
        ts=row["ts"],
        label=row["label"],
        confidence=row["confidence"],
        bin=row["bin"],
        latency_ms=row["latency_ms"],
        has_frame=bool(row["has_frame"]),
        source=row["source"],
    )


def _run(row: sqlite3.Row) -> Run:
    return Run(id=row["id"], started_at=row["started_at"], source=row["source"])


class Store:
    def __init__(self, path: str | Path, clock: Callable[[], str] = utc_now_iso) -> None:
        self._clock = clock
        self._lock = threading.RLock()
        # Autocommit; transactions are explicit in `_tx`.
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA synchronous = NORMAL")
        self._db.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._db.execute("COMMIT")

    # -- runs -------------------------------------------------------------------

    def ensure_run(self, source: SourceName) -> Run:
        """Resume the open run if it belongs to `source`; otherwise close it and start one."""
        with self._tx() as db:
            row = db.execute(
                "SELECT * FROM runs WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row is not None and row["source"] == source:
                return _run(row)
            now = self._clock()
            # Close every open run, not just the newest, so at most one is ever open.
            db.execute("UPDATE runs SET ended_at = ? WHERE ended_at IS NULL", (now,))
            return self._insert_run(db, source, now)

    def start_new_run(self, source: SourceName) -> Run:
        """End the current run and begin a zeroed one. Old runs and events stay."""
        with self._tx() as db:
            now = self._clock()
            db.execute("UPDATE runs SET ended_at = ? WHERE ended_at IS NULL", (now,))
            return self._insert_run(db, source, now)

    def current_run(self) -> Run:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM runs WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
            ).fetchone()
        if row is None:
            raise RuntimeError("no open run; call ensure_run first")
        return _run(row)

    @staticmethod
    def _insert_run(db: sqlite3.Connection, source: SourceName, now: str) -> Run:
        cursor = db.execute("INSERT INTO runs (started_at, source) VALUES (?, ?)", (now, source))
        return Run(id=cursor.lastrowid or 0, started_at=now, source=source)

    # -- events -----------------------------------------------------------------

    def add_event(
        self,
        run_id: int,
        label: str,
        confidence: float,
        bin: StoredBin,
        latency_ms: int,
        frame: FramePacket | None = None,
    ) -> Event:
        """Store an event, stamped with the server's UTC receive time, and its frame."""
        with self._tx() as db:
            cursor = db.execute(
                "INSERT INTO events (run_id, ts, label, confidence, bin, latency_ms)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, self._clock(), label, confidence, bin, latency_ms),
            )
            event_id = cursor.lastrowid or 0
            if frame is not None:
                db.execute(
                    "INSERT INTO frames (event_id, width, height, pixels) VALUES (?, ?, ?, ?)",
                    (event_id, frame.width, frame.height, frame.pixels),
                )
            row = db.execute(_EVENT_SELECT + " WHERE e.id = ?", (event_id,)).fetchone()
        return _event(row)

    def recent_events(
        self, run_id: int, limit: int = 50, before_id: int | None = None
    ) -> list[Event]:
        """Newest first, within one run."""
        sql = _EVENT_SELECT + " WHERE e.run_id = ?"
        args: list[int] = [run_id]
        if before_id is not None:
            sql += " AND e.id < ?"
            args.append(before_id)
        sql += " ORDER BY e.id DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            return [_event(row) for row in self._db.execute(sql, args)]

    def events_after(self, run_id: int, after_id: int, limit: int = 500) -> list[Event]:
        """Oldest first, for resuming a dropped stream."""
        sql = _EVENT_SELECT + " WHERE e.run_id = ? AND e.id > ? ORDER BY e.id ASC LIMIT ?"
        with self._lock:
            return [_event(row) for row in self._db.execute(sql, (run_id, after_id, limit))]

    def last_event(self, run_id: int) -> Event | None:
        events = self.recent_events(run_id, limit=1)
        return events[0] if events else None

    def get_frame(self, event_id: int) -> FramePacket | None:
        with self._lock:
            row = self._db.execute(
                "SELECT width, height, pixels FROM frames WHERE event_id = ?", (event_id,)
            ).fetchone()
        if row is None:
            return None
        return FramePacket(2, row["width"], row["height"], bytes(row["pixels"]))

    # -- aggregation ------------------------------------------------------------

    def counts(self, run_id: int) -> Counts:
        with self._lock:
            rows = self._db.execute(
                "SELECT bin, COUNT(*) AS n FROM events WHERE run_id = ? GROUP BY bin", (run_id,)
            ).fetchall()
        by_bin = {row["bin"]: row["n"] for row in rows}
        recyclable = by_bin.get("recyclable", 0)
        trash = by_bin.get("trash", 0)
        total = recyclable + trash
        return Counts(
            recyclable=recyclable,
            trash=trash,
            unsure=by_bin.get("unsure", 0),
            total_sorted=total,
            recycle_rate=recyclable / total if total else None,
        )

    def by_item(self, run_id: int) -> list[ItemCount]:
        """Always one row per known item, zeros included, in table order."""
        with self._lock:
            rows = self._db.execute(
                "SELECT label, COUNT(*) AS n FROM events WHERE run_id = ? AND bin != 'unsure'"
                " GROUP BY label",
                (run_id,),
            ).fetchall()
        by_label = {row["label"]: row["n"] for row in rows}
        return [
            ItemCount(
                label=item.label,
                display_name=item.display_name,
                bin=item.bin,
                count=by_label.get(item.label, 0),
            )
            for item in ITEMS
        ]

    # -- export -----------------------------------------------------------------

    def export_rows(self) -> list[tuple[int, str, str, str, float, int, str, bool]]:
        """Every event of every run: run_id, ts, label, bin, confidence, latency, source, frame."""
        sql = (
            "SELECT e.run_id, e.ts, e.label, e.bin, e.confidence, e.latency_ms, r.source,"
            " f.event_id IS NOT NULL AS has_frame"
            " FROM events e JOIN runs r ON r.id = e.run_id"
            " LEFT JOIN frames f ON f.event_id = e.id ORDER BY e.id"
        )
        with self._lock:
            return [
                (
                    row["run_id"],
                    row["ts"],
                    row["label"],
                    row["bin"],
                    row["confidence"],
                    row["latency_ms"],
                    row["source"],
                    bool(row["has_frame"]),
                )
                for row in self._db.execute(sql)
            ]
