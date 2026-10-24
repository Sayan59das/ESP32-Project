import asyncio
import contextlib
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
import serial

from app.sources.serial_source import (
    BACKOFF_CAP_S,
    SerialSource,
    _open_port,
    find_port,
    is_busy,
)

pytestmark = pytest.mark.anyio


@dataclass
class Info:
    device: str
    vid: int | None


class Observer:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def opened(self, port: str | None) -> None:
        self.calls.append(("opened", port))

    def closed(self) -> None:
        self.calls.append(("closed", None))

    def port_busy(self, port: str) -> None:
        self.calls.append(("busy", port))

    def stream_restarted(self) -> None:
        self.calls.append(("restarted", None))


class Sleeps:
    """Records backoff delays instead of waiting; stops the source after `limit` of them."""

    def __init__(self, limit: int) -> None:
        self.delays: list[float] = []
        self.limit = limit

    async def __call__(self, seconds: float) -> None:
        self.delays.append(seconds)
        if len(self.delays) >= self.limit:
            raise asyncio.CancelledError
        await asyncio.sleep(0)


class FlakyPort:
    """Delivers its chunks, then fails the way an unplugged USB port does."""

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = list(chunks)
        self.closed = False

    def read(self, size: int) -> bytes:
        if not self.chunks:
            raise serial.SerialException("ClearCommError failed: the device was removed")
        return self.chunks.pop(0)[:size]

    def write(self, data: bytes) -> int:
        return len(data)

    def close(self) -> None:
        self.closed = True


async def drain(source: SerialSource, observer: Observer) -> list[bytes]:
    got: list[bytes] = []
    with contextlib.suppress(asyncio.CancelledError):
        async for chunk in source.chunks(observer):
            got.append(chunk)
    return got


class TestDetection:
    def test_prefers_the_arduino_over_usb_serial_chips(self) -> None:
        ports = [Info("COM3", 0x1A86), Info("COM7", 0x2341), Info("COM4", 0x10C4)]
        assert find_port(ports) == "COM7"

    def test_falls_back_to_cp210x_then_ch340_then_ftdi(self) -> None:
        assert find_port([Info("COM9", 0x0403), Info("COM8", 0x1A86)]) == "COM8"
        assert find_port([Info("COM9", 0x0403), Info("COM2", 0x10C4)]) == "COM2"

    def test_finds_an_esp32_when_it_is_the_only_board(self) -> None:
        # An ESP32-S3 on its own USB, a dev board's CP210x or CH340, an ESP32-CAM's FTDI.
        for vid in (0x303A, 0x10C4, 0x1A86, 0x0403):
            assert find_port([Info("COM12", vid)]) == "COM12"

    def test_espressif_usb_comes_after_arduino_and_before_the_adapter_chips(self) -> None:
        assert find_port([Info("COM4", 0x10C4), Info("COM8", 0x303A)]) == "COM8"
        assert find_port([Info("COM8", 0x303A), Info("COM9", 0x2341)]) == "COM9"

    def test_ignores_unknown_vendors_and_ports_without_one(self) -> None:
        assert find_port([Info("COM1", None), Info("COM5", 0x046D)]) is None

    @pytest.mark.parametrize(
        "message",
        [
            "could not open port 'COM5': PermissionError(13, 'Access is denied.', None, 5)",
            "Could not exclusively lock port /dev/ttyACM0: [Errno 11] Resource temporarily "
            "unavailable",
            "[Errno 16] Device or resource busy: '/dev/ttyACM0'",
        ],
    )
    def test_recognises_a_busy_port(self, message: str) -> None:
        assert is_busy(serial.SerialException(message))

    def test_a_missing_port_is_not_busy(self) -> None:
        missing = "could not open port 'COM9': FileNotFoundError(2, 'The system cannot find')"
        assert not is_busy(serial.SerialException(missing))


class TestOpening:
    def test_never_1200_baud(self) -> None:
        with pytest.raises(ValueError, match="bootloader"):
            SerialSource("COM5", 1200)

    async def test_no_nano_reports_closed_and_backs_off_up_to_10_seconds(self) -> None:
        sleeps = Sleeps(limit=7)
        source = SerialSource(lister=lambda: [], sleep=sleeps)
        observer = Observer()
        assert await drain(source, observer) == []
        assert sleeps.delays == [1, 2, 4, 8, 10, 10, 10]
        assert max(sleeps.delays) == BACKOFF_CAP_S
        assert set(observer.calls) == {("closed", None)}

    async def test_a_busy_port_is_reported_as_busy_not_raised(self) -> None:
        def opener(device: str, baud: int) -> FlakyPort:
            raise serial.SerialException(
                f"could not open port '{device}': PermissionError(13, 'Access is denied.')"
            )

        source = SerialSource("COM5", opener=opener, sleep=Sleeps(limit=2))
        observer = Observer()
        await drain(source, observer)
        assert observer.calls == [("busy", "COM5"), ("busy", "COM5")]

    async def test_opens_at_115200_by_default(self) -> None:
        seen: list[int] = []

        def opener(device: str, baud: int) -> FlakyPort:
            seen.append(baud)
            return FlakyPort([])

        await drain(SerialSource("COM5", opener=opener, sleep=Sleeps(limit=1)), Observer())
        assert seen == [115200]


class TestStreaming:
    async def test_unplugging_reports_closed_and_replugging_recovers(self) -> None:
        ports = [FlakyPort([b"HELLO,1\n", b"HB,5000\n"]), FlakyPort([b"HB,10000\n"])]
        opened: list[FlakyPort] = []

        def opener(device: str, baud: int) -> FlakyPort:
            port = ports.pop(0)
            opened.append(port)
            return port

        source = SerialSource("COM5", opener=opener, sleep=Sleeps(limit=2))
        observer = Observer()
        got = await drain(source, observer)
        assert got == [b"HELLO,1\n", b"HB,5000\n", b"HB,10000\n"]
        assert observer.calls == [
            ("opened", "COM5"),
            ("closed", None),
            ("opened", "COM5"),
            ("closed", None),
        ]
        assert all(port.closed for port in opened)

    async def test_write_without_an_open_port_raises_for_the_supervisor_to_retry(self) -> None:
        with pytest.raises(OSError, match="not open"):
            await SerialSource("COM5").write(b"P1\n")

    async def test_reads_and_writes_through_a_real_pyserial_port(self) -> None:
        # loop:// echoes writes back as reads, so P1 sent by the bridge comes back in.
        source = SerialSource("loop://", opener=_open_port)
        observer = Observer()
        stream: AsyncIterator[bytes] = source.chunks(observer)
        first = asyncio.ensure_future(anext(stream))
        for _ in range(100):
            if observer.calls:
                break
            await asyncio.sleep(0.01)
        assert observer.calls == [("opened", "loop://")]
        await source.write(b"P1\n")
        received = await asyncio.wait_for(first, 2)
        while not received.endswith(b"\n"):  # chunk boundaries are arbitrary
            received += await asyncio.wait_for(anext(stream), 2)
        assert received == b"P1\n"
        await stream.aclose()
        assert observer.calls[-1] == ("closed", None)
