"""A stand-in Nano for bench tests without hardware.

Speaks the firmware contract (HELLO, HB, EVT, DBG, verdict and preview frames) and obeys
P1 / P0. With --faults it also sends what real serial links produce: corrupt frames,
oversize and garbage lines, a stalled packet, a mid-run HELLO (a Nano reset), a
"background" label and a firmware/server bin mismatch.

Transports:
  --tcp PORT   serve on 127.0.0.1:PORT; run the bridge with
               SOURCE=serial SERIAL_PORT=socket://127.0.0.1:PORT   (works on Windows)
  --pty        create a pseudo-terminal pair and print the device path for SERIAL_PORT
               (Linux and macOS)

Closing the connection (stopping this script) looks to the bridge like an unplugged Nano;
starting it again looks like plugging it back in.

The frames are synthetic. The bridge cannot tell this from a real Nano, so point DB_PATH at
a scratch database (make bench does) and never mix bench runs into real ones.
"""

import argparse
import asyncio
import os
import random
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.classes import ITEMS, expected_firmware_bin
from app.frames import KIND_PREVIEW, KIND_VERDICT, encode_packet
from app.sources.sim_source import FRAME_SIZE, synthetic_frame

FAULTS = (
    "corrupt_crc",
    "oversize_line",
    "garbage_line",
    "stalled_packet",
    "nano_reset",
    "background",
    "bin_mismatch",
)


def say(message: str) -> None:
    print(f"fake-nano: {message}", flush=True)


class FakeNano:
    def __init__(
        self,
        write: Callable[[bytes], Awaitable[None]],
        *,
        seed: int | None,
        interval: tuple[float, float],
        faults: bool,
    ) -> None:
        self._write = write
        self._rng = random.Random(seed)
        self._interval = interval
        self._faults = faults
        self._fault_index = 0
        self._preview = asyncio.Event()
        self._booted = time.monotonic()
        self._lock = asyncio.Lock()  # one line or packet at a time, like the firmware

    def command(self, line: bytes) -> None:
        line = line.strip()
        if line == b"P1":
            self._preview.set()
            say("P1: preview on")
        elif line == b"P0":
            self._preview.clear()
            say("P0: preview off")
        elif line:
            say(f"ignored command {line!r}")

    async def send(self, data: bytes) -> None:
        async with self._lock:
            await self._write(data)

    def uptime_ms(self) -> int:
        return int((time.monotonic() - self._booted) * 1000)

    async def run(self) -> None:
        await self.send(b"HELLO,fake-nano-1.0\n")
        await self.send(b"DBG,fake Nano: synthetic frames, not a camera\n")
        await asyncio.gather(self._heartbeats(), self._events(), self._previews())

    async def _heartbeats(self) -> None:
        while True:
            await asyncio.sleep(5)
            await self.send(f"HB,{self.uptime_ms()}\n".encode())

    async def _previews(self) -> None:
        cycle = [item.label for item in ITEMS]
        while True:
            await self._preview.wait()
            label = cycle[int(time.monotonic() / 4) % len(cycle)]
            frame = synthetic_frame(label, self._rng, round(self._rng.uniform(-8, 8)))
            await self.send(encode_packet(KIND_PREVIEW, FRAME_SIZE, FRAME_SIZE, frame))
            await asyncio.sleep(0.2)

    async def _events(self) -> None:
        labels = [item.label for item in ITEMS]
        while True:
            await asyncio.sleep(self._rng.uniform(*self._interval))
            if self._faults and self._rng.random() < 0.5:
                await self._fault()
                continue
            uncertain = self._rng.random() < 1 / 15
            label = "uncertain" if uncertain else self._rng.choice(labels)
            confidence = self._rng.uniform(0.3, 0.69) if uncertain else self._rng.uniform(0.7, 0.99)
            await self._classify(label, confidence, expected_firmware_bin(label))

    async def _classify(self, label: str, confidence: float, firmware_bin: str) -> None:
        latency = max(50, round(self._rng.gauss(410, 35)))
        frame = synthetic_frame(None if label in ("uncertain", "background") else label, self._rng)
        line = f"EVT,{label},{confidence:.2f},{firmware_bin},{latency}\n".encode()
        async with self._lock:  # the verdict frame and its EVT line, back to back
            await self._write(encode_packet(KIND_VERDICT, FRAME_SIZE, FRAME_SIZE, frame) + line)
        say(f"sent {line.decode().strip()}")

    async def _fault(self) -> None:
        fault = FAULTS[self._fault_index % len(FAULTS)]
        self._fault_index += 1
        say(f"fault: {fault}")
        if fault == "corrupt_crc":
            packet = bytearray(
                encode_packet(
                    KIND_VERDICT, FRAME_SIZE, FRAME_SIZE, synthetic_frame("can", self._rng)
                )
            )
            packet[-1] ^= 0xFF
            await self.send(bytes(packet) + b"EVT,can,0.91,RECYCLABLE,402\n")
        elif fault == "oversize_line":
            await self.send(b"DBG," + b"x" * 100 + b"\n")
        elif fault == "garbage_line":
            await self.send(b"Predictions (DSP: 5 ms.):\n")
        elif fault == "stalled_packet":
            packet = encode_packet(
                KIND_PREVIEW, FRAME_SIZE, FRAME_SIZE, synthetic_frame("pen", self._rng)
            )
            async with self._lock:
                await self._write(packet[: len(packet) // 2])
                await asyncio.sleep(1.0)  # longer than the bridge's 500 ms stall limit
                await self._write(b"\nHB,%d\n" % self.uptime_ms())
        elif fault == "nano_reset":
            self._booted = time.monotonic()
            await self.send(b"HELLO,fake-nano-1.0\n")
        elif fault == "background":
            await self._classify("background", 0.97, "NONE")
        elif fault == "bin_mismatch":
            await self._classify("pen", 0.88, "RECYCLABLE")


async def serve_tcp(port: int, args: argparse.Namespace) -> None:
    async def client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        say(f"host connected from {writer.get_extra_info('peername')}")

        async def write(data: bytes) -> None:
            writer.write(data)
            await writer.drain()

        nano = FakeNano(
            write, seed=args.seed, interval=(args.min_s, args.max_s), faults=args.faults
        )
        runner = asyncio.create_task(nano.run())
        try:
            while line := await reader.readline():
                nano.command(line)
        except ConnectionError:
            pass
        finally:
            runner.cancel()
            await asyncio.gather(runner, return_exceptions=True)
            writer.close()
            say("host disconnected")

    server = await asyncio.start_server(client, "127.0.0.1", port)
    say(f"listening on socket://127.0.0.1:{port}")
    async with server:
        await server.serve_forever()


async def serve_pty(args: argparse.Namespace) -> None:
    import tty  # POSIX only

    controller, device = os.openpty()
    tty.setraw(device)
    say(f"pty ready: SERIAL_PORT={os.ttyname(device)}")
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), os.fdopen(controller, "rb", buffering=0)
    )

    async def write(data: bytes) -> None:
        await asyncio.to_thread(os.write, controller, data)

    nano = FakeNano(write, seed=args.seed, interval=(args.min_s, args.max_s), faults=args.faults)
    runner = asyncio.create_task(nano.run())
    while line := await reader.readline():
        nano.command(line)
    runner.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    transport = parser.add_mutually_exclusive_group()
    transport.add_argument("--tcp", type=int, metavar="PORT", default=7777)
    transport.add_argument("--pty", action="store_true")
    parser.add_argument("--faults", action="store_true", help="mix in link faults")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--min-s", type=float, default=3.0, help="shortest gap between items")
    parser.add_argument("--max-s", type=float, default=9.0, help="longest gap between items")
    args = parser.parse_args()
    try:
        asyncio.run(serve_pty(args) if args.pty else serve_tcp(args.tcp, args))
    except KeyboardInterrupt:
        say("stopped")


if __name__ == "__main__":
    main()
