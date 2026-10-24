"""The camera path: Model/numpy_cnn.py, Model/presence.py and Model/camera_bridge.py.

These sit next to the trained model rather than in backend/app, so the tests put Model/ on
the path. They need numpy; the model-dependent ones also need Model/waste_cnn.pt and the
dataset it was trained on, and skip without them.
"""

import pickle
import sys
import zipfile
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")

MODEL_DIR = Path(__file__).resolve().parents[2] / "Model"
if not (MODEL_DIR / "presence.py").exists():
    pytest.skip("Model/ is not in this checkout", allow_module_level=True)
sys.path.insert(0, str(MODEL_DIR))

import camera_bridge  # noqa: E402
import numpy_cnn  # noqa: E402
import presence  # noqa: E402

from app.protocol import EventLine, parse_line  # noqa: E402

FPS = 10
STEP = 1.0 / FPS
H, W = 120, 160


# -- helpers -----------------------------------------------------------------------------


def scene(seed: int = 0) -> "np.ndarray":
    """A textured empty scene."""
    rng = np.random.default_rng(seed)
    return rng.integers(90, 160, (H, W)).astype(np.float32)


def noisy(base: "np.ndarray", rng, sigma: float = 1.5, gain: float = 1.0) -> "np.ndarray":
    return np.clip(base * gain + rng.normal(0, sigma, base.shape), 0, 255).astype(np.uint8)


def with_item(base: "np.ndarray") -> "np.ndarray":
    out = base.copy()
    out[30:100, 40:120] = 20.0  # a big dark object
    return out


REC = np.array([0.95, 0.05], dtype=np.float32)
NON = np.array([0.04, 0.96], dtype=np.float32)
UNSURE = np.array([0.52, 0.48], dtype=np.float32)


class Run:
    """Drives an ItemCounter with a scripted scene at 10 frames per second."""

    def __init__(self, **kwargs) -> None:
        self.counter = presence.ItemCounter(["recyclable", "non_recyclable"], **kwargs)
        self.rng = np.random.default_rng(1)
        self.base = scene()
        self.t = 0.0
        self.verdicts: list[presence.Verdict] = []

    def play(self, seconds: float, *, item=False, probs=REC, gain: float = 1.0) -> None:
        for _ in range(round(seconds * FPS)):
            frame = noisy(with_item(self.base) if item else self.base, self.rng, gain=gain)
            verdict = self.counter.feed(frame, probs, self.t)
            if verdict is not None:
                self.verdicts.append(verdict)
            self.t += STEP


# -- the counting gate -------------------------------------------------------------------


def test_nothing_is_counted_while_the_view_is_empty() -> None:
    run = Run()
    run.play(8)
    assert run.verdicts == []
    assert run.counter.state == presence.ABSENT


def test_one_item_is_counted_once_however_long_it_stays() -> None:
    run = Run()
    run.play(4)
    run.play(20, item=True, probs=REC)
    assert [(v.label, round(v.confidence, 2)) for v in run.verdicts] == [("recyclable", 0.95)]


def test_each_item_counts_once_and_takes_the_label_of_its_own_frames() -> None:
    run = Run()
    run.play(4)
    run.play(3, item=True, probs=REC)
    run.play(3)
    run.play(3, item=True, probs=NON)
    run.play(3)
    run.play(3, item=True, probs=REC)
    assert [v.label for v in run.verdicts] == ["recyclable", "non_recyclable", "recyclable"]


def test_the_model_flipping_while_the_item_stays_does_not_count_it_twice() -> None:
    run = Run()
    run.play(4)
    run.play(2, item=True, probs=REC)
    run.play(6, item=True, probs=NON)
    assert len(run.verdicts) == 1


def test_a_moment_of_empty_view_is_needed_before_the_next_item() -> None:
    run = Run()
    run.play(4)
    run.play(3, item=True, probs=REC)
    run.play(0.3)  # gone for less than the re-arm time...
    run.play(3, item=True, probs=NON)  # ...so this is still the same item
    assert len(run.verdicts) == 1


def test_a_glimpse_shorter_than_the_trigger_time_is_ignored() -> None:
    run = Run()
    run.play(4)
    run.play(0.1, item=True)
    run.play(4)
    assert run.verdicts == []
    assert run.counter.state == presence.ABSENT


def test_an_unsure_model_is_counted_as_uncertain_after_the_wait() -> None:
    run = Run()
    run.play(4)
    run.play(5, item=True, probs=UNSURE)
    assert [v.label for v in run.verdicts] == [presence.UNCERTAIN]


def test_an_item_that_leaves_before_the_model_is_sure_counts_as_uncertain() -> None:
    run = Run()
    run.play(4)
    run.play(1.5, item=True, probs=UNSURE)
    run.play(3)
    assert [v.label for v in run.verdicts] == [presence.UNCERTAIN]


def test_auto_exposure_changing_the_brightness_is_not_an_item() -> None:
    run = Run()
    run.play(4)
    run.play(3, gain=1.25)
    run.play(3, gain=0.8)
    run.play(3)
    assert run.verdicts == []


def test_slow_lighting_drift_is_followed_and_never_triggers() -> None:
    run = Run()
    run.play(4)
    for step in range(60):
        run.play(0.5, gain=1.0 + 0.002 * step)
    assert run.verdicts == []


def test_an_item_that_never_leaves_triggers_a_recalibration_not_a_hang() -> None:
    messages: list[str] = []
    run = Run(stuck_s=10.0, log=messages.append)
    run.play(4)
    run.play(15, item=True)
    assert any("recalibrating" in m for m in messages)
    assert run.counter.state in (presence.CALIBRATING, presence.ABSENT)


def test_thresholds_follow_the_cameras_own_noise() -> None:
    quiet, loud = Run(), Run()
    loud.rng = np.random.default_rng(2)
    quiet.play(4)
    for _ in range(round(4 * FPS)):
        frame = noisy(loud.base, loud.rng, sigma=12.0)
        loud.counter.feed(frame, REC, loud.t)
        loud.t += STEP
    assert loud.counter.state == presence.ABSENT
    assert loud.counter.t_on > quiet.counter.t_on


# -- reading the camera stream -----------------------------------------------------------


def frame_packet(frame: "np.ndarray") -> bytes:
    h, w = frame.shape
    return b"FRM0" + w.to_bytes(2, "little") + h.to_bytes(2, "little") + frame.tobytes()


def reader_with(data: bytes, chunk: int | None = None) -> camera_bridge.FrameReader:
    reader = camera_bridge.FrameReader("unused", 921600)
    buf = bytearray()
    step = chunk or len(data) or 1
    for i in range(0, len(data), step):
        buf += data[i : i + step]
        reader._extract(buf)
    return reader


def test_the_reader_keeps_the_newest_frame() -> None:
    rng = np.random.default_rng(3)
    frames = [rng.integers(0, 256, (H, W), dtype=np.uint8) for _ in range(3)]
    reader = reader_with(b"".join(frame_packet(f) for f in frames))
    seq, _, latest = reader.snapshot()
    assert seq == 3
    assert np.array_equal(latest, frames[2])


@pytest.mark.parametrize("chunk", [1, 7, 4096])
def test_frames_survive_being_split_at_any_point(chunk: int) -> None:
    frame = np.random.default_rng(4).integers(0, 256, (H, W), dtype=np.uint8)
    reader = reader_with(frame_packet(frame), chunk)
    assert np.array_equal(reader.snapshot()[2], frame)


def test_garbage_and_board_text_before_a_frame_are_skipped() -> None:
    frame = np.random.default_rng(5).integers(0, 256, (H, W), dtype=np.uint8)
    junk = b"INIT FAILED camera\r\n\x00\xff FRM junk FR"
    reader = reader_with(junk + frame_packet(frame))
    assert np.array_equal(reader.snapshot()[2], frame)


def test_a_false_header_inside_noise_is_not_taken_for_a_frame() -> None:
    frame = np.random.default_rng(6).integers(0, 256, (H, W), dtype=np.uint8)
    bogus = b"FRM0" + (60000).to_bytes(2, "little") + (60000).to_bytes(2, "little")
    reader = reader_with(bogus + frame_packet(frame))
    assert reader.snapshot()[0] == 1
    assert np.array_equal(reader.snapshot()[2], frame)


def test_no_frame_means_no_snapshot_and_an_infinite_age() -> None:
    reader = camera_bridge.FrameReader("unused", 921600)
    assert reader.snapshot() is None
    assert reader.age() == float("inf")


# -- what the website receives -----------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "firmware_bin"),
    [("recyclable", "RECYCLABLE"), ("trash", "TRASH"), ("uncertain", "NONE")],
)
def test_event_lines_parse_with_the_bin_the_website_expects(label: str, firmware_bin: str) -> None:
    line = camera_bridge.event_line(label, 0.973, 71)
    assert parse_line(line) == EventLine(label, 0.97, firmware_bin, 71)


def test_event_lines_clamp_confidence_and_latency() -> None:
    assert parse_line(camera_bridge.event_line("trash", 1.7, 5_000_000)) == EventLine(
        "trash", 1.0, "TRASH", 999999
    )
    assert parse_line(camera_bridge.event_line("trash", -0.2, -3)) == EventLine(
        "trash", 0.0, "TRASH", 0
    )


def test_every_class_the_model_can_say_is_a_label_the_website_knows() -> None:
    from app.classes import ALL_LABELS

    assert set(camera_bridge.WEBSITE_LABEL.values()) <= set(ALL_LABELS)


def test_a_frame_of_another_size_is_fitted_to_the_model_input() -> None:
    small = np.zeros((72, 96), dtype=np.uint8)
    assert camera_bridge.fit_to_model(small).shape == (H, W)
    exact = np.zeros((H, W), dtype=np.uint8)
    assert camera_bridge.fit_to_model(exact) is exact


# -- the torch-free model ----------------------------------------------------------------


def test_the_checkpoint_loader_refuses_code_in_the_pickle(tmp_path: Path) -> None:
    class Evil:
        def __reduce__(self):
            import os

            return (os.system, ("echo pwned",))

    path = tmp_path / "evil.pt"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("evil/data.pkl", pickle.dumps({"state_dict": Evil()}, protocol=2))
        z.writestr("evil/byteorder", "little")
    with pytest.raises(pickle.UnpicklingError, match="not allowed"):
        numpy_cnn.load_checkpoint(path)


def test_the_checkpoint_loader_refuses_a_non_little_endian_file(tmp_path: Path) -> None:
    path = tmp_path / "big.pt"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("big/data.pkl", pickle.dumps({}, protocol=2))
        z.writestr("big/byteorder", "big")
    with pytest.raises(ValueError, match="big-endian"):
        numpy_cnn.load_checkpoint(path)


needs_model = pytest.mark.skipif(
    not (MODEL_DIR / "waste_cnn.pt").exists() or not (MODEL_DIR / "dataset").is_dir(),
    reason="Model/waste_cnn.pt or Model/dataset is not here",
)


@needs_model
def test_the_numpy_model_classifies_the_training_images_like_the_trained_net() -> None:
    from PIL import Image

    net = numpy_cnn.NumpyCNN.from_checkpoint(MODEL_DIR / "waste_cnn.pt")
    assert net.classes == ["recyclable", "non_recyclable"]
    for name in net.classes:
        files = sorted((MODEL_DIR / "dataset" / name).glob("*.png"))[:12]
        assert files, f"no images for {name}"
        for f in files:
            probs = net.predict(np.asarray(Image.open(f).convert("L")))
            assert probs.sum() == pytest.approx(1.0, abs=1e-4)
            assert net.classes[int(probs.argmax())] == name, f.name


@needs_model
def test_the_camera_bridge_end_to_end_counts_one_item_per_presentation() -> None:
    """Real model, real gate, real contract encoding: empty view, an item, empty, an item."""
    import asyncio

    from PIL import Image

    from app.classes import stored_bin
    from app.protocol import FramePacket, StreamParser

    net = numpy_cnn.NumpyCNN.from_checkpoint(MODEL_DIR / "waste_cnn.pt")

    def first(name: str) -> "np.ndarray":
        f = sorted((MODEL_DIR / "dataset" / name).glob("*.png"))[0]
        return np.asarray(Image.open(f).convert("L"))

    pictures = {name: first(name) for name in net.classes}
    empty = np.median(
        np.stack([pictures["recyclable"], pictures["non_recyclable"]]), axis=0
    ).astype(np.float32)
    rng = np.random.default_rng(7)

    class Args:
        verbose = False
        min_conf = 0.60

    class Sink:
        def __init__(self) -> None:
            self.data = bytearray()

        def write(self, data: bytes) -> None:
            self.data += data

        async def drain(self) -> None:
            return None

    reader = camera_bridge.FrameReader("unused", 921600)
    bridge = camera_bridge.Bridge(net, reader, Args())
    sink = Sink()
    bridge._writer = sink  # type: ignore[assignment]

    script = [
        ("empty", 3.0),
        ("recyclable", 2.0),
        ("empty", 2.0),
        ("non_recyclable", 2.0),
        ("empty", 2.0),
    ]

    async def drive() -> None:
        # The bridge's own loop, fed frame by frame on a virtual clock.
        t = 0.0
        for name, seconds in script:
            base = empty if name == "empty" else pictures[name].astype(np.float32)
            for _ in range(round(seconds * FPS)):
                frame = noisy(base, rng, sigma=2.0)
                probs = net.predict(frame)
                verdict = bridge._counter.feed(frame, probs, t)
                if verdict is not None:
                    label = camera_bridge.WEBSITE_LABEL[verdict.label]
                    packet = camera_bridge.encode_packet(
                        camera_bridge.KIND_VERDICT, W, H, frame.tobytes()
                    )
                    await bridge.send(
                        packet + camera_bridge.event_line(label, verdict.confidence, 40)
                    )
                t += STEP

    asyncio.run(drive())
    items = StreamParser().feed(bytes(sink.data))
    events = [i for i in items if isinstance(i, EventLine)]
    assert [(e.label, stored_bin(e.label)) for e in events] == [
        ("recyclable", "recyclable"),
        ("trash", "trash"),
    ]
    assert sum(isinstance(i, FramePacket) for i in items) == 2  # one verdict frame each
