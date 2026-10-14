from app.frames import FramePacket
from app.store import Store, utc_now_iso

FRAME = FramePacket(2, 8, 8, bytes(range(64)))


def add(store: Store, run_id: int, label: str, bin_name: str, frame: FramePacket | None = None):
    return store.add_event(run_id, label, 0.9, bin_name, 400, frame)  # type: ignore[arg-type]


class TestRuns:
    def test_ensure_run_creates_the_first_run(self, store: Store) -> None:
        run = store.ensure_run("sim")
        assert (run.id, run.source) == (1, "sim")
        assert store.current_run() == run

    def test_ensure_run_resumes_an_open_run_of_the_same_source(self, store: Store) -> None:
        first = store.ensure_run("sim")
        add(store, first.id, "can", "recyclable")
        assert store.ensure_run("sim") == first
        assert store.counts(first.id).recyclable == 1

    def test_a_different_source_never_shares_a_run(self, store: Store) -> None:
        sim = store.ensure_run("sim")
        serial = store.ensure_run("serial")
        replay = store.ensure_run("replay")
        assert len({sim.id, serial.id, replay.id}) == 3
        assert store.current_run().source == "replay"

    def test_switching_source_closes_the_old_run_so_only_one_is_open(self, store: Store) -> None:
        store.ensure_run("sim")
        store.ensure_run("serial")
        store.ensure_run("sim")
        open_runs = store._db.execute("SELECT COUNT(*) FROM runs WHERE ended_at IS NULL")
        assert open_runs.fetchone()[0] == 1

    def test_started_at_is_utc_iso_8601(self) -> None:
        stamp = utc_now_iso()
        assert stamp.endswith("Z")
        assert len(stamp) == len("2026-01-01T00:00:00.000Z")


class TestCounting:
    def test_empty_run_has_zero_counts_and_a_null_rate(self, store: Store) -> None:
        run = store.ensure_run("sim")
        counts = store.counts(run.id)
        assert (counts.recyclable, counts.trash, counts.unsure, counts.total_sorted) == (0, 0, 0, 0)
        assert counts.recycle_rate is None

    def test_recyclable_and_trash_are_counted_by_bin(self, store: Store) -> None:
        run = store.ensure_run("sim")
        for label, bin_name in [
            ("can", "recyclable"),
            ("glass_bottle", "recyclable"),
            ("can", "recyclable"),
            ("pen", "trash"),
        ]:
            add(store, run.id, label, bin_name)
        counts = store.counts(run.id)
        assert (counts.recyclable, counts.trash, counts.total_sorted) == (3, 1, 4)
        assert counts.recycle_rate == 0.75

    def test_unsure_is_reported_separately_and_never_added_to_a_bin(self, store: Store) -> None:
        run = store.ensure_run("sim")
        add(store, run.id, "can", "recyclable")
        add(store, run.id, "uncertain", "unsure")
        add(store, run.id, "uncertain", "unsure")
        counts = store.counts(run.id)
        assert (counts.recyclable, counts.trash, counts.unsure) == (1, 0, 2)
        assert counts.total_sorted == 1
        assert counts.recycle_rate == 1.0

    def test_only_unsure_events_still_give_a_null_rate(self, store: Store) -> None:
        run = store.ensure_run("sim")
        add(store, run.id, "uncertain", "unsure")
        assert store.counts(run.id).recycle_rate is None

    def test_by_item_always_lists_all_four_items_with_zeros(self, store: Store) -> None:
        run = store.ensure_run("sim")
        assert [(i.label, i.display_name, i.bin, i.count) for i in store.by_item(run.id)] == [
            ("can", "Can", "recyclable", 0),
            ("glass_bottle", "Glass bottle", "recyclable", 0),
            ("pen", "Pen", "trash", 0),
            ("phone_case", "Phone case", "trash", 0),
        ]

    def test_by_item_counts_each_label_and_skips_unsure(self, store: Store) -> None:
        run = store.ensure_run("sim")
        add(store, run.id, "pen", "trash")
        add(store, run.id, "pen", "trash")
        add(store, run.id, "can", "recyclable")
        add(store, run.id, "uncertain", "unsure")
        assert {i.label: i.count for i in store.by_item(run.id)} == {
            "can": 1,
            "glass_bottle": 0,
            "pen": 2,
            "phone_case": 0,
        }


class TestNewRun:
    def test_a_new_run_zeroes_counts_without_deleting_events(self, store: Store) -> None:
        old = store.ensure_run("sim")
        add(store, old.id, "can", "recyclable")
        add(store, old.id, "pen", "trash")
        new = store.start_new_run("sim")
        assert new.id != old.id
        assert store.current_run() == new
        assert store.counts(new.id).total_sorted == 0
        assert store.last_event(new.id) is None
        assert store.counts(old.id).total_sorted == 2
        assert len(store.export_rows()) == 2

    def test_only_the_new_run_is_open(self, store: Store) -> None:
        old = store.ensure_run("sim")
        store.start_new_run("sim")
        row = store._db.execute("SELECT ended_at FROM runs WHERE id = ?", (old.id,)).fetchone()
        assert row["ended_at"] is not None


class TestEvents:
    def test_events_are_stamped_with_the_server_time_and_the_run_source(self, store: Store) -> None:
        run = store.ensure_run("replay")
        event = add(store, run.id, "can", "recyclable")
        assert event.ts.endswith("Z")
        assert (event.run_id, event.source, event.has_frame) == (run.id, "replay", False)

    def test_recent_events_are_newest_first_and_page_with_before_id(self, store: Store) -> None:
        run = store.ensure_run("sim")
        ids = [add(store, run.id, "can", "recyclable").id for _ in range(5)]
        assert [e.id for e in store.recent_events(run.id, limit=3)] == ids[::-1][:3]
        assert [e.id for e in store.recent_events(run.id, 10, before_id=ids[2])] == [ids[1], ids[0]]

    def test_recent_events_stay_inside_their_run(self, store: Store) -> None:
        old = store.ensure_run("sim")
        add(store, old.id, "can", "recyclable")
        new = store.start_new_run("sim")
        assert store.recent_events(new.id) == []

    def test_events_after_returns_oldest_first_for_resume(self, store: Store) -> None:
        run = store.ensure_run("sim")
        ids = [add(store, run.id, "can", "recyclable").id for _ in range(4)]
        assert [e.id for e in store.events_after(run.id, ids[0])] == ids[1:]
        assert store.events_after(run.id, ids[-1]) == []


class TestFrames:
    def test_a_frame_is_stored_with_its_event_and_read_back_exactly(self, store: Store) -> None:
        run = store.ensure_run("sim")
        event = add(store, run.id, "can", "recyclable", FRAME)
        assert event.has_frame is True
        stored = store.get_frame(event.id)
        assert stored is not None
        assert (stored.width, stored.height, stored.pixels) == (8, 8, FRAME.pixels)

    def test_an_event_without_a_frame_says_so(self, store: Store) -> None:
        run = store.ensure_run("sim")
        event = add(store, run.id, "can", "recyclable")
        assert event.has_frame is False
        assert store.get_frame(event.id) is None
        assert store.get_frame(9999) is None

    def test_has_frame_survives_queries_and_export(self, store: Store) -> None:
        run = store.ensure_run("sim")
        with_frame = add(store, run.id, "can", "recyclable", FRAME)
        add(store, run.id, "pen", "trash")
        by_id = {e.id: e.has_frame for e in store.recent_events(run.id)}
        assert by_id[with_frame.id] is True
        assert [row[-1] for row in store.export_rows()] == [True, False]

    def test_a_new_run_keeps_the_old_runs_frames(self, store: Store) -> None:
        old = store.ensure_run("sim")
        event = add(store, old.id, "can", "recyclable", FRAME)
        store.start_new_run("sim")
        assert store.get_frame(event.id) is not None


def test_export_rows_cover_every_run_in_order(store: Store) -> None:
    sim = store.ensure_run("sim")
    add(store, sim.id, "can", "recyclable")
    serial = store.ensure_run("serial")
    add(store, serial.id, "pen", "trash")
    rows = store.export_rows()
    assert [(r[0], r[2], r[3], r[6]) for r in rows] == [
        (sim.id, "can", "recyclable", "sim"),
        (serial.id, "pen", "trash", "serial"),
    ]
