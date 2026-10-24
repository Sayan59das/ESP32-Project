"""Record what the tests and the camera-off scenarios did into data/testing.json.

The Testing page shows this file and nothing else: every figure on it was measured by a run of
this script, and a part that has not been recorded says "Not measured yet" there.

    python scripts/record_tests.py                  everything
    python scripts/record_tests.py --only scenarios just the camera-off scenarios
    python scripts/record_tests.py --skip browser   everything but the (slow) browser suite

A part that is not run keeps its previous values. The `media` list (your own rig photos and
videos) is never touched: edit it by hand, see data/README.md.

The browser suite needs the console built first (`cd frontend && npm run build`); run this with
the project's virtualenv so pytest and numpy are importable.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "testing.json"
MODEL_DIR = ROOT / "Model"
FRONTEND = ROOT / "frontend"

PARTS = ("backend", "frontend", "browser", "contrast", "scenarios", "model")

SUITES = {
    "backend": (
        "Backend",
        "pytest: parsing, framing, storage, the camera bridge and counter, serial scanning",
    ),
    "frontend": (
        "Console logic",
        "Vitest: state, formatting, link and camera states, the 3D scene's maths",
    ),
    "browser": (
        "Browser",
        "Playwright: layout, states, keyboard, accessibility, offline and the 3D pages",
    ),
    "contrast": (
        "Colour contrast",
        "Every text and control colour pair in both themes, against WCAG 2.2 AA",
    ),
}


def run(command: list[str], cwd: Path) -> tuple[str, float]:
    """Run a command: its output and how long it took. A failing run is data, not an error."""
    started = time.monotonic()
    done = subprocess.run(
        command, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return done.stdout + done.stderr, time.monotonic() - started


def npm(*args: str) -> list[str]:
    found = shutil.which("npm") or shutil.which("npm.cmd")
    if found is None:
        raise SystemExit("npm was not found on the PATH")
    return [found, *args]


def suite(label_id: str, passed: int, failed: int, skipped: int, seconds: float) -> dict:
    label, what = SUITES[label_id]
    return {
        "id": label_id,
        "label": label,
        "what": what,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "seconds": round(seconds, 1),
    }


def record_backend() -> dict:
    out, seconds = run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-c",
            "backend/pyproject.toml",
            "--rootdir",
            "backend",
            "backend/tests",
            "-q",
            "-p",
            "no:cacheprovider",
        ],
        ROOT,
    )
    counts = dict.fromkeys(("passed", "failed", "skipped", "error", "errors"), 0)
    summary = next(
        (line for line in reversed(out.splitlines()) if " passed" in line or " failed" in line), ""
    )
    for number, word in re.findall(r"(\d+) (passed|failed|skipped|errors?)", summary):
        counts[word] += int(number)
    return suite(
        "backend",
        counts["passed"],
        counts["failed"] + counts["error"] + counts["errors"],
        counts["skipped"],
        seconds,
    )


def record_frontend() -> dict:
    report = Path(tempfile.mkdtemp()) / "vitest.json"
    _, seconds = run(
        npm("run", "test", "--", "--reporter=json", f"--outputFile={report}"), FRONTEND
    )
    data = json.loads(report.read_text(encoding="utf-8"))
    return suite(
        "frontend",
        data["numPassedTests"],
        data["numFailedTests"],
        data["numPendingTests"] + data.get("numTodoTests", 0),
        seconds,
    )


def record_browser() -> dict:
    if not (FRONTEND / ".next" / "BUILD_ID").exists():
        raise SystemExit("the browser suite needs a build: cd frontend && npm run build")
    out, seconds = run(npm("run", "e2e", "--", "--reporter=json"), FRONTEND)
    start = out.find("{")
    stats = json.loads(out[start:])["stats"]
    return suite(
        "browser",
        stats["expected"] + stats["flaky"],
        stats["unexpected"],
        stats["skipped"],
        seconds,
    )


def record_contrast() -> dict:
    out, seconds = run([sys.executable, "scripts/check_contrast.py"], ROOT)
    found = re.search(r"(\d+) of (\d+) pairings pass", out)
    if found is None:
        raise SystemExit(f"could not read the contrast result:\n{out[-400:]}")
    passed, total = int(found.group(1)), int(found.group(2))
    return suite("contrast", passed, total - passed, 0, seconds)


# -- the model and the camera-off scenarios ------------------------------------------------

H, W = 120, 160
FPS = 10
STEP = 1.0 / FPS


def load_model():
    """The trained network and the dataset pictures, or (None, None) when they are not here."""
    sys.path.insert(0, str(MODEL_DIR))
    try:
        import numpy_cnn
        from PIL import Image  # noqa: F401
    except ImportError:
        return None, None
    checkpoint = MODEL_DIR / "waste_cnn.pt"
    dataset = MODEL_DIR / "dataset"
    if not checkpoint.exists() or not dataset.exists():
        return None, None
    return numpy_cnn.NumpyCNN.from_checkpoint(checkpoint), dataset


def dataset_frames(dataset: Path, classes: list[str]) -> dict[str, list[Path]]:
    return {name: sorted((dataset / name).glob("*.png")) for name in classes}


def record_model() -> dict | None:
    net, dataset = load_model()
    if net is None:
        return None
    import numpy as np
    import numpy_cnn
    from PIL import Image

    files = dataset_frames(dataset, net.classes)
    # The split train.py made: its seed and its share, applied to the same sorted list.
    seed, share = 0, 0.2
    training: dict[str, int] = {}
    held_out: dict[str, int] = {}
    correct: dict[str, int] = {}
    for name, group in files.items():
        group = list(group)
        random.Random(seed).shuffle(group)
        cut = max(1, int(len(group) * share))
        validation = group[:cut]
        training[name] = len(group) - cut
        held_out[name] = len(validation)
        right = 0
        for path in validation:
            probs = net.predict(np.asarray(Image.open(path).convert("L")))
            right += int(net.classes[int(probs.argmax())] == name)
        correct[name] = right

    state = numpy_cnn.load_checkpoint(MODEL_DIR / "waste_cnn.pt")["state_dict"]
    parameters = sum(
        int(np.asarray(array).size)
        for key, array in state.items()
        if not key.endswith(("running_mean", "running_var", "num_batches_tracked"))
    )
    return {
        "parameters": parameters,
        "training_frames": training,
        "validation_frames": held_out,
        "validation_correct": correct,
    }


class Args:
    verbose = False
    min_conf = 0.60


def noisy(base, rng, sigma: float = 1.5, gain: float = 1.0):
    import numpy as np

    return np.clip(base * gain + rng.normal(0, sigma, base.shape), 0, 255).astype(np.uint8)


async def play(bridge, clock: list[float], seconds: float, make, verdicts: list) -> None:
    for _ in range(round(seconds * FPS)):
        verdict = await bridge.step(make(), clock[0])
        if verdict is not None:
            verdicts.append(verdict)
        clock[0] += STEP


def record_scenarios() -> list[dict] | None:
    net, dataset = load_model()
    if net is None:
        return None
    # The bridge narrates what it sees; this script only wants the results.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return _scenarios(net, dataset)


def _scenarios(net, dataset) -> list[dict]:
    import camera_bridge
    import numpy as np
    import presence
    from PIL import Image

    files = dataset_frames(dataset, net.classes)

    def first(name: str):
        return np.asarray(Image.open(files[name][0]).convert("L"))

    pictures = {name: first(name) for name in net.classes}
    # The empty view: what the two real frames have in common, with a structure to tell apart.
    empty = np.median(np.stack(list(pictures.values())), axis=0).astype(np.float32)

    def scenario(
        id_: str,
        title: str,
        what: str,
        expectation: str,
        dead,
        dead_seconds: float = 6.0,
        unplugged: bool = False,
    ) -> dict:
        async def go() -> dict:
            rng = np.random.default_rng(1)
            reader = camera_bridge.FrameReader("unused", 921600)
            bridge = camera_bridge.Bridge(net, reader, Args())
            verdicts: list = []
            clock = [100.0]
            await play(bridge, clock, 4, lambda: noisy(empty, rng), verdicts)
            dead(clock)  # a gap in time, for the unplugged board
            await play(bridge, clock, dead_seconds, lambda: dead.make(rng), verdicts)
            return {
                "counted": len(verdicts),
                "alive": bool(bridge.picture_live(clock[0])),
                "reported": bridge._picture_note,
            }

        result = asyncio.run(go())
        return {
            "id": id_,
            "title": title,
            "what": what,
            "expectation": expectation,
            "counted": result["counted"],
            "alive": result["alive"],
            "reported": result["reported"],
            # Passing means what `expectation` says: nothing counted, and the picture called dead,
            # except after an unplug, where the board is alive again and still counts nothing.
            "passed": result["counted"] == 0 and result["alive"] == unplugged,
        }

    class Dead:
        def __init__(self, make, gap: float = 0.0) -> None:
            self.make = make
            self.gap = gap

        def __call__(self, clock: list[float]) -> None:
            clock[0] += self.gap

    nothing = "Counts nothing, and the console says the camera is not responding."
    results = [
        scenario(
            "off",
            "Camera switched off",
            "The board keeps sending, but every pixel is black.",
            nothing,
            Dead(lambda rng: np.zeros((H, W), dtype=np.uint8)),
        ),
        scenario(
            "covered",
            "Lens covered",
            "A hand over the lens: almost black, with sensor noise.",
            nothing,
            Dead(lambda rng: noisy(np.full((H, W), 6.0, dtype=np.float32), rng, sigma=2.0)),
        ),
        scenario(
            "lights",
            "Room lights off",
            "The scene is still there, at a seventh of its brightness.",
            nothing,
            Dead(lambda rng: noisy(empty, rng, gain=0.15)),
        ),
        scenario(
            "flat",
            "Flat grey picture",
            "A uniform grey, with a little noise: no scene at all.",
            nothing,
            Dead(lambda rng: noisy(np.full((H, W), 128.0, dtype=np.float32), rng, sigma=2.0)),
        ),
    ]
    stuck = noisy(empty, np.random.default_rng(3))
    results.append(
        scenario(
            "frozen",
            "Frozen picture",
            "The same frame, over and over: the board is alive but the sensor is stuck.",
            nothing,
            Dead(lambda rng: stuck.copy()),
        )
    )
    results.append(
        scenario(
            "unplugged",
            "Board unplugged, then a different view",
            "Twenty seconds with no frames, then a scene that is not the one it learned.",
            "Counts nothing while it learns the new view.",
            Dead(lambda rng: noisy(empty[:, ::-1], rng), gap=20.0),
            dead_seconds=5.0,
            unplugged=True,
        )
    )

    # The comeback: off, on again with an empty view, then one real item.
    async def comeback() -> dict:
        rng = np.random.default_rng(1)
        reader = camera_bridge.FrameReader("unused", 921600)
        bridge = camera_bridge.Bridge(net, reader, Args())
        verdicts: list = []
        clock = [100.0]
        item = pictures["recyclable"].astype(np.float32)
        await play(bridge, clock, 3, lambda: noisy(empty, rng), verdicts)
        await play(bridge, clock, 4, lambda: np.zeros((H, W), dtype=np.uint8), verdicts)
        await play(bridge, clock, 3, lambda: noisy(empty, rng), verdicts)
        await play(bridge, clock, 2, lambda: noisy(item, rng, sigma=2.0), verdicts)
        await play(bridge, clock, 2, lambda: noisy(empty, rng), verdicts)
        return {
            "counted": len(verdicts),
            "alive": bool(bridge.picture_live(clock[0])),
            "reported": ", ".join(v.label for v in verdicts) or None,
        }

    came = asyncio.run(comeback())
    results.append(
        {
            "id": "comeback",
            "title": "Switched off, then on again",
            "what": "Off for four seconds, back with an empty view, then one recyclable item.",
            "expectation": "Counts that one item, once, with its own label.",
            "passed": came["counted"] == 1 and came["alive"] and came["reported"] == "recyclable",
            **came,
        }
    )
    assert presence.DARK_OR_FLAT  # the reasons the bridge reports come from presence.py
    return results


# -- the file --------------------------------------------------------------------------------


def git(*args: str) -> str:
    done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return done.stdout.strip()


def commit_label() -> str | None:
    head = git("rev-parse", "--short", "HEAD")
    if not head:
        return None
    return f"{head} + uncommitted changes" if git("status", "--porcelain") else head


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--only", choices=PARTS, nargs="+", help="run just these parts")
    parser.add_argument("--skip", choices=PARTS, nargs="+", default=[], help="leave these out")
    options = parser.parse_args()
    wanted = [p for p in (options.only or PARTS) if p not in options.skip]

    data = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    suites = {s["id"]: s for s in data.get("suites", [])}

    recorders = {
        "backend": record_backend,
        "frontend": record_frontend,
        "browser": record_browser,
        "contrast": record_contrast,
    }
    for part in PARTS:
        if part not in wanted or part not in recorders:
            continue
        print(f"recording {part} ...", flush=True)
        suites[part] = recorders[part]()
        s = suites[part]
        print(f"  {s['passed']} passed, {s['failed']} failed, {s['skipped']} skipped", flush=True)

    if "scenarios" in wanted:
        print("recording the camera-off scenarios ...", flush=True)
        scenarios = record_scenarios()
        if scenarios is None:
            print("  skipped: the trained model or the dataset is not here")
        else:
            data["scenarios"] = scenarios
            data["scenario_note"] = (
                "Run with the real model on a scene built from our own training frames, "
                "not filmed: it tests the counting, not the lens."
            )
            for s in scenarios:
                verdict = "ok  " if s["passed"] else "FAIL"
                print(f"  {verdict} {s['title']}: counted {s['counted']}, alive {s['alive']}")
    if "model" in wanted:
        print("recording the model ...", flush=True)
        model = record_model()
        if model is None:
            print("  skipped: the trained model or the dataset is not here")
        else:
            data["model"] = model

    order = ["backend", "frontend", "browser", "contrast"]
    data["suites"] = [suites[k] for k in order if k in suites]
    data["recorded_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["commit"] = commit_label()
    data.setdefault("media", [])
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {DATA.relative_to(ROOT)}")
    failed = sum(s["failed"] for s in data["suites"]) + sum(
        not s["passed"] for s in data.get("scenarios", [])
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
