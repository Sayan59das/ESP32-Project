"""Record a raw serial session from the Nano into a .rec file for SOURCE=replay.

Each chunk the port returns is stored with its millisecond offset from the start, so replay
reproduces the real timing and the real chunk splits. Stop the bridge first: only one
program can hold the port.

  python scripts/record.py                      # auto-detect, until Ctrl+C
  python scripts/record.py --seconds 120 --preview
  python scripts/record.py --port COM5 --out data/sample_session.rec --force
"""

import argparse
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

import serial  # noqa: E402  (after the path insert)
from serial.tools import list_ports  # noqa: E402

from app.frames import FramePacket  # noqa: E402
from app.protocol import EventLine, FrameError, HeartbeatLine, Rejected, StreamParser  # noqa: E402
from app.sources.replay_source import encode_record  # noqa: E402
from app.sources.serial_source import (  # noqa: E402
    BOOTLOADER_BAUD,
    READ_CHUNK,
    READ_TIMEOUT_S,
    find_port,
)


def summarise(raw: bytes) -> str:
    items = StreamParser().feed(raw)
    events = sum(isinstance(i, EventLine) for i in items)
    frames = sum(isinstance(i, FramePacket) for i in items)
    beats = sum(isinstance(i, HeartbeatLine) for i in items)
    bad = sum(isinstance(i, Rejected | FrameError) for i in items)
    return f"{events} events, {frames} frames, {beats} heartbeats, {bad} rejected"


def main() -> int:
    parser = argparse.ArgumentParser(description="Record a raw Nano serial session.")
    parser.add_argument("--port", help="serial port or pyserial URL; default: auto-detect")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--seconds", type=float, help="stop after this long; default: Ctrl+C")
    parser.add_argument("--preview", action="store_true", help="send P1 so previews are captured")
    parser.add_argument("--out", type=Path, default=REPO / "data" / "sample_session.rec")
    parser.add_argument("--force", action="store_true", help="overwrite a non-empty file")
    args = parser.parse_args()

    if args.baud == BOOTLOADER_BAUD:
        parser.error("1200 baud reboots the Nano into its bootloader; use 115200")
    if args.out.exists() and args.out.stat().st_size > 0 and not args.force:
        parser.error(f"{args.out} already holds a recording; pass --force to replace it")
    device = args.port or find_port(list_ports.comports())
    if device is None:
        parser.error("no Nano found; plug it in or pass --port")

    try:
        port = serial.serial_for_url(
            device, baudrate=args.baud, timeout=READ_TIMEOUT_S, exclusive=True
        )
    except serial.SerialException as exc:
        print(f"cannot open {device}: {exc}", file=sys.stderr)
        print(
            "If the bridge or the Arduino Serial Monitor is running, close it first.",
            file=sys.stderr,
        )
        return 1

    records: list[bytes] = []
    raw = bytearray()
    started = time.monotonic()
    print(f"recording {device} to {args.out}; Ctrl+C to stop", flush=True)
    try:
        if args.preview:
            port.write(b"P1\n")
        while args.seconds is None or time.monotonic() - started < args.seconds:
            chunk = port.read(READ_CHUNK)
            if chunk:
                offset_ms = int((time.monotonic() - started) * 1000)
                records.append(encode_record(offset_ms, chunk))
                raw += chunk
    except KeyboardInterrupt:
        pass
    finally:
        if args.preview:
            port.write(b"P0\n")
        port.close()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(b"".join(records))
    elapsed = time.monotonic() - started
    print(
        f"wrote {len(records)} chunks, {len(raw)} bytes, {elapsed:.0f} s: {summarise(bytes(raw))}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
