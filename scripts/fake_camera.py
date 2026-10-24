"""A stand-in for the camera board, for testing the whole chain without hardware.

Streams the same FRM0 packets as the board's cam_stream sketch (b"FRM0", width and height
as 2-byte little endian, then width*height grayscale bytes) over TCP, so the camera bridge
can read it with --camera socket://127.0.0.1:PORT.

The scene is scripted: an "empty" view (the median of the dataset, plus sensor noise) and
items, each one a real image from Model/dataset held in view with noise. The default script
presents a recyclable item, clears the view, presents a non-recyclable one, clears it, and
repeats, which is exactly what should move the website's counters one at a time.

  python scripts/fake_camera.py                      # port 7778, loops forever
  python scripts/fake_camera.py --loops 2 --fps 10
  python scripts/fake_camera.py --sequence empty:4,recyclable:3,empty:3,non_recyclable:3

The frames are not live camera data. Never point real runs at this.
"""

import argparse
import asyncio
import random
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

DEFAULT_SEQUENCE = "empty:5,recyclable:3,empty:3,non_recyclable:3,empty:3"
NOISE_SIGMA = 2.0


def say(message: str) -> None:
    print(f"fake-camera: {message}", flush=True)


def load_dataset(root: Path) -> dict[str, list[np.ndarray]]:
    classes: dict[str, list[np.ndarray]] = {}
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        frames = [np.asarray(Image.open(f).convert("L")) for f in sorted(folder.glob("*.png"))]
        if frames:
            classes[folder.name] = frames
    if not classes:
        sys.exit(f"no images under {root}")
    return classes


def parse_sequence(text: str, known: set[str]) -> list[tuple[str, float]]:
    steps = []
    for part in text.split(","):
        name, _, seconds = part.partition(":")
        if name != "empty" and name not in known:
            sys.exit(f"unknown scene {name!r}; use empty or one of {sorted(known)}")
        steps.append((name, float(seconds)))
    return steps


def packet(frame: np.ndarray) -> bytes:
    h, w = frame.shape
    return b"FRM0" + w.to_bytes(2, "little") + h.to_bytes(2, "little") + frame.tobytes()


class Camera:
    def __init__(self, classes, steps, fps, loops, seed):
        self.classes = classes
        self.steps = steps
        self.fps = fps
        self.loops = loops
        self.rng = random.Random(seed)
        self.noise = np.random.default_rng(seed)
        self.empty = np.median(np.stack([f for fs in classes.values() for f in fs]), axis=0)

    def noisy(self, base: np.ndarray) -> np.ndarray:
        jitter = self.noise.normal(0.0, NOISE_SIGMA, base.shape)
        return np.clip(base + jitter, 0, 255).astype(np.uint8)

    async def stream(self, write) -> None:
        loop = 0
        while self.loops == 0 or loop < self.loops:
            loop += 1
            for name, seconds in self.steps:
                scene = self.empty if name == "empty" else self.rng.choice(self.classes[name])
                say(f"scene: {name} for {seconds:g} s")
                end = time.monotonic() + seconds
                while time.monotonic() < end:
                    await write(packet(self.noisy(scene.astype(np.float32))))
                    await asyncio.sleep(1.0 / self.fps)
        say("script finished; holding an empty view")
        while True:
            await write(packet(self.noisy(self.empty.astype(np.float32))))
            await asyncio.sleep(1.0 / self.fps)


async def serve(camera: Camera, port: int) -> None:
    async def client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        say(f"reader connected from {writer.get_extra_info('peername')}")

        async def write(data: bytes) -> None:
            writer.write(data)
            await writer.drain()

        try:
            await camera.stream(write)
        except (ConnectionError, OSError):
            pass
        finally:
            writer.close()
            say("reader disconnected")

    server = await asyncio.start_server(client, "127.0.0.1", port)
    say(f"streaming on socket://127.0.0.1:{port}")
    async with server:
        await server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tcp", type=int, default=7778, metavar="PORT")
    parser.add_argument(
        "--dataset", default=str(Path(__file__).resolve().parents[1] / "Model" / "dataset")
    )
    parser.add_argument("--sequence", default=DEFAULT_SEQUENCE)
    parser.add_argument("--fps", type=float, default=8.0)
    parser.add_argument("--loops", type=int, default=0, help="0 = forever")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    classes = load_dataset(Path(args.dataset))
    steps = parse_sequence(args.sequence, set(classes))
    camera = Camera(classes, steps, args.fps, args.loops, args.seed)
    try:
        asyncio.run(serve(camera, args.tcp))
    except KeyboardInterrupt:
        say("stopped")


if __name__ == "__main__":
    main()
