# Camera bridge: the trained model <-> the EcoSort website.
#
#   python Model/camera_bridge.py                 # camera auto-detected, listens on 7777
#   python Model/camera_bridge.py --camera COM6
#
# The camera board streams grayscale frames over USB ("FRM0" packets, see camera.py). This
# program is the only thing that touches that serial port: it reads the frames, runs
# waste_cnn.pt on them, decides when one item has been placed in view (presence.py), and
# serves the EcoSort wire contract (HELLO, HB, EVT, verdict and preview frames) on a local
# TCP port. The website's bridge connects to it as if it were a Nano:
#
#   SOURCE=serial   SERIAL_PORT=socket://127.0.0.1:7777      (run_all.bat sets this)
#
# Start it with the camera view EMPTY: the first seconds calibrate the empty background.
# Close the Arduino Serial Monitor and live.py/capture.py first: one program per port.

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import sys
import threading
import time
from pathlib import Path

import numpy as np
import serial
from PIL import Image
from serial.tools import list_ports

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # numpy_cnn, presence
sys.path.insert(0, str(HERE.parent / "backend"))  # the website's frame encoder and bin table

from numpy_cnn import NumpyCNN  # noqa: E402
from presence import UNCERTAIN, ItemCounter  # noqa: E402

from app.classes import expected_firmware_bin  # noqa: E402
from app.frames import KIND_PREVIEW, KIND_VERDICT, encode_packet  # noqa: E402

VERSION = "camera-bridge-1.0"
MAGIC = b"FRM0"
FRAME_W, FRAME_H = 160, 120  # what waste_cnn.pt was trained on (model.py IMG_W, IMG_H)
HEARTBEAT_S = 5.0
PREVIEW_INTERVAL_S = 0.2  # at most 5 preview frames per second, like the firmware contract
CAMERA_FRESH_S = 3.0  # no frame for this long and the heartbeat stops: the console says so
BOOTLOADER_BAUD = 1200  # an Arduino reboots into its bootloader at this rate
# USB vendor ids, most likely first: Arduino, Espressif (native USB), CP210x, CH340, FTDI.
VENDOR_PRIORITY = (0x2341, 0x303A, 0x10C4, 0x1A86, 0x0403)

# The model's class names -> the labels the website's item table knows (backend/app/classes.py).
WEBSITE_LABEL = {"recyclable": "recyclable", "non_recyclable": "trash", UNCERTAIN: UNCERTAIN}


def say(message: str) -> None:
    print(f"camera-bridge: {message}", flush=True)


def find_camera_port() -> str | None:
    ports = sorted(list_ports.comports(), key=lambda p: p.device)
    for vid in VENDOR_PRIORITY:
        for port in ports:
            if port.vid == vid:
                return port.device
    return None


# -- camera ------------------------------------------------------------------------------


class FrameReader(threading.Thread):
    """Reads FRM0 packets from the camera port in the background and keeps only the newest.

    Reconnects by itself, so unplugging and replugging the board mid-demo recovers. Accepts
    pyserial URLs (socket://host:port), which is how fake_camera.py stands in for the board.
    """

    def __init__(self, port: str | None, baud: int) -> None:
        super().__init__(daemon=True, name="camera-reader")
        self._port = port
        self._baud = baud
        self._lock = threading.Lock()
        self._latest: tuple[int, float, np.ndarray] | None = None
        self._seq = 0
        self._stop_flag = threading.Event()
        self.connected = False
        self.device: str | None = None

    def stop(self) -> None:
        self._stop_flag.set()

    def snapshot(self) -> tuple[int, float, np.ndarray] | None:
        with self._lock:
            return self._latest

    def age(self) -> float:
        snap = self.snapshot()
        return float("inf") if snap is None else time.monotonic() - snap[1]

    def run(self) -> None:
        last_problem = ""
        delay = 1.0
        while not self._stop_flag.is_set():
            device = self._port or find_camera_port()
            problem = ""
            if device is None:
                problem = "no camera board found: plug it in with a data USB cable"
            else:
                try:
                    ser = serial.serial_for_url(
                        device, baudrate=self._baud, timeout=0.2, exclusive=True
                    )
                except (serial.SerialException, OSError, ValueError) as exc:
                    problem = (
                        f"cannot open {device}: {exc} (is the Serial Monitor or live.py open?)"
                    )
                else:
                    self.device, self.connected, delay = device, True, 1.0
                    say(f"camera port {device} open at {self._baud} baud")
                    last_problem = ""
                    try:
                        self._read(ser)
                    except (serial.SerialException, OSError) as exc:
                        problem = f"camera port lost: {exc}"
                    finally:
                        self.connected = False
                        with contextlib.suppress(Exception):
                            ser.close()
            if problem and problem != last_problem:
                say(problem)
                last_problem = problem
            self._stop_flag.wait(delay)
            delay = min(delay * 1.5, 5.0)

    def _read(self, ser: serial.SerialBase) -> None:
        buf = bytearray()
        while not self._stop_flag.is_set():
            chunk = ser.read(65536)  # whatever arrives within the timeout
            if not chunk:
                continue
            buf += chunk
            self._extract(buf)
            if len(buf) > 4 * (8 + 640 * 480):  # nothing parsable in ages: start over
                buf.clear()

    def _extract(self, buf: bytearray) -> None:
        while True:
            at = buf.find(MAGIC)
            if at < 0:
                self._note_text(bytes(buf[:-3]))
                del buf[:-3]  # keep a possible half magic
                return
            if at:
                self._note_text(bytes(buf[:at]))
                del buf[:at]
            if len(buf) < 8:
                return
            w = int.from_bytes(buf[4:6], "little")
            h = int.from_bytes(buf[6:8], "little")
            if not (0 < w <= 640 and 0 < h <= 480):
                del buf[:1]  # a false header inside pixel data: keep scanning
                continue
            need = 8 + w * h
            if len(buf) < need:
                return
            frame = np.frombuffer(bytes(buf[8:need]), dtype=np.uint8).reshape(h, w)
            del buf[:need]
            with self._lock:
                self._seq += 1
                self._latest = (self._seq, time.monotonic(), frame)

    @staticmethod
    def _note_text(junk: bytes) -> None:
        # The board prints plain text when its camera fails to start ("INIT FAILED ...").
        for line in junk.decode("ascii", "ignore").splitlines():
            if line.strip().startswith("INIT"):
                say(f"board says: {line.strip()[:100]}")


# -- the contract ------------------------------------------------------------------------


def event_line(label: str, confidence: float, latency_ms: int) -> bytes:
    confidence = min(1.0, max(0.0, confidence))
    latency_ms = min(999999, max(0, latency_ms))
    return f"EVT,{label},{confidence:.2f},{expected_firmware_bin(label)},{latency_ms}\n".encode()


def fit_to_model(frame: np.ndarray) -> np.ndarray:
    """The frame as the model was trained on it (train.py resizes anything else the same way)."""
    if frame.shape == (FRAME_H, FRAME_W):
        return frame
    image = Image.fromarray(frame).resize((FRAME_W, FRAME_H), Image.BILINEAR)
    return np.asarray(image)


class Bridge:
    def __init__(self, net: NumpyCNN, reader: FrameReader, args: argparse.Namespace) -> None:
        self._net = net
        self._reader = reader
        self._verbose = args.verbose
        self._booted = time.monotonic()
        self._lock = asyncio.Lock()  # one line or packet at a time, like the firmware
        self._writer: asyncio.StreamWriter | None = None
        self._preview = False
        self._dbg: list[str] = []
        self._counter = ItemCounter(net.classes, min_conf=args.min_conf, log=self._log)
        self.items = {"recyclable": 0, "trash": 0, UNCERTAIN: 0}

    # -- plumbing --

    def _log(self, message: str) -> None:
        say(message)
        self._dbg.append(message)

    def uptime_ms(self) -> int:
        return int((time.monotonic() - self._booted) * 1000)

    async def send(self, data: bytes) -> bool:
        writer = self._writer
        if writer is None:
            return False
        async with self._lock:
            try:
                writer.write(data)
                await writer.drain()
                return True
            except (ConnectionError, OSError):
                if self._writer is writer:
                    self._writer = None
                return False

    async def _flush_debug(self) -> None:
        pending, self._dbg = self._dbg, []
        for text in pending:
            line = "".join(c if 0x20 <= ord(c) < 0x7F else "?" for c in text)[:60]
            await self.send(f"DBG,{line}\n".encode())

    async def on_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        previous = self._writer
        if previous is not None:  # a reconnecting bridge replaces a stale connection
            previous.close()
        say(f"website bridge connected from {writer.get_extra_info('peername')}")
        self._writer, self._preview = writer, False
        await self.send(f"HELLO,{VERSION}\n".encode())
        await self.send(b"DBG,camera bridge: trained model on live camera frames\n")
        try:
            while line := await reader.readline():
                command = line.strip()
                if command == b"P1":
                    self._preview = True
                elif command == b"P0":
                    self._preview = False
        except (ConnectionError, OSError):
            pass
        finally:
            if self._writer is writer:
                self._writer, self._preview = None, False
            writer.close()
            say("website bridge disconnected")

    # -- loops --

    async def heartbeats(self) -> None:
        # The heartbeat is the proof the camera is alive: no frames, no heartbeat, and the
        # console says the board is not responding instead of showing a stale "connected".
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            if self._reader.age() < CAMERA_FRESH_S:
                await self.send(f"HB,{self.uptime_ms()}\n".encode())
            elif self._writer is not None:
                where = self._reader.device or "no board"
                await self.send(f"DBG,no camera frames from {where}\n".encode()[:68])

    async def pipeline(self) -> None:
        last_seq, last_preview, last_status = 0, 0.0, 0.0
        latencies: list[float] = []
        frames_since_status = 0
        while True:
            snap = self._reader.snapshot()
            if snap is None or snap[0] == last_seq:
                await asyncio.sleep(0.01)
                continue
            last_seq, _, raw = snap
            frame = fit_to_model(raw)

            started = time.perf_counter()
            probs = await asyncio.to_thread(self._net.predict, frame)
            latencies = [*latencies, (time.perf_counter() - started) * 1000][-16:]
            frames_since_status += 1

            now = time.monotonic()
            verdict = self._counter.feed(frame, probs, now)
            if verdict is not None:
                label = WEBSITE_LABEL[verdict.label]
                self.items[label] += 1
                tag = "sent" if self._writer is not None else "DROPPED (website not connected)"
                say(f"item #{sum(self.items.values())}: {label} {verdict.confidence:.2f} -> {tag}")
                latency = round(float(np.mean(latencies)))
                packet = encode_packet(
                    KIND_VERDICT, frame.shape[1], frame.shape[0], frame.tobytes()
                )
                await self.send(packet + event_line(label, verdict.confidence, latency))
            elif self._preview and now - last_preview >= PREVIEW_INTERVAL_S:
                last_preview = now
                await self.send(
                    encode_packet(KIND_PREVIEW, frame.shape[1], frame.shape[0], frame.tobytes())
                )
            await self._flush_debug()

            if self._verbose and now - last_status >= 2.0:
                fps = frames_since_status / max(now - last_status, 1e-6) if last_status else 0.0
                last_status, frames_since_status = now, 0
                top = int(probs.argmax())
                say(
                    f"{self._counter.state:11s} change {self._counter.change:5.1f} "
                    f"(on>{self._counter.t_on:.1f} off<{self._counter.t_off:.1f})  "
                    f"model {self._net.classes[top]} {probs[top]:.2f}  "
                    f"{fps:.1f} fps  {np.mean(latencies):.0f} ms"
                )


async def serve(bridge: Bridge, port: int) -> None:
    server = await asyncio.start_server(bridge.on_client, "127.0.0.1", port)
    say(
        f"listening on socket://127.0.0.1:{port}  (website: SOURCE=serial SERIAL_PORT=socket://127.0.0.1:{port})"
    )
    tasks = [asyncio.create_task(bridge.pipeline()), asyncio.create_task(bridge.heartbeats())]
    try:
        async with server:
            await server.serve_forever()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the trained model on the camera board and feed the EcoSort website."
    )
    parser.add_argument(
        "--camera",
        default=os.environ.get("CAMERA_PORT"),
        help="serial port or pyserial URL of the camera board (default: auto-detect)",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=int(os.environ.get("CAMERA_BAUD", "921600")),
        help="camera stream baud rate (camera.py uses 921600; never 1200)",
    )
    parser.add_argument(
        "--listen",
        type=int,
        default=int(os.environ.get("CAMERA_BRIDGE_PORT", "7777")),
        help="TCP port the website's bridge connects to",
    )
    parser.add_argument("--model", default=str(HERE / "waste_cnn.pt"))
    parser.add_argument(
        "--min-conf", type=float, default=0.60, help="below this the verdict is 'uncertain'"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="print the scene-change value and model answer every 2 s (for tuning)",
    )
    parser.add_argument(
        "--check", action="store_true", help="load the model, classify one dataset image, and exit"
    )
    args = parser.parse_args()
    if args.baud == BOOTLOADER_BAUD:
        sys.exit("1200 baud reboots an Arduino into its bootloader; use 921600")

    net = NumpyCNN.from_checkpoint(args.model)
    unknown = [c for c in net.classes if c not in WEBSITE_LABEL]
    if unknown:
        sys.exit(f"the model has classes the website does not know: {unknown}; edit WEBSITE_LABEL")
    say(f"model loaded: {', '.join(net.classes)}")

    if args.check:
        sample = next((HERE / "dataset" / net.classes[0]).glob("*.png"), None)
        if sample is None:
            sys.exit("--check needs at least one image in Model/dataset/")
        probs = net.predict(np.asarray(Image.open(sample).convert("L")))
        say(
            f"check ok: {sample.name} -> "
            f"{ {c: round(float(p), 3) for c, p in zip(net.classes, probs, strict=True)} }"
        )
        return

    reader = FrameReader(args.camera, args.baud)
    reader.start()
    bridge = Bridge(net, reader, args)
    try:
        asyncio.run(serve(bridge, args.listen))
    except KeyboardInterrupt:
        say("stopped")
    finally:
        reader.stop()


if __name__ == "__main__":
    main()
