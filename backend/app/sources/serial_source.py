"""Real hardware: the Nano 33 BLE Sense over USB serial.

Finds the port by USB vendor id unless SERIAL_PORT names one, opens it at 115200 (never
1200, which reboots an Arduino into its bootloader), and reconnects with backoff from 1 s
up to 10 s. A missing or busy port is reported to the observer, never raised, so the app
keeps running and the console can say what is wrong.

SERIAL_PORT may also be a pyserial URL such as socket://127.0.0.1:7777, which is how
scripts/fake_nano.py stands in for the board on machines without a pty.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from typing import Any, Protocol

import serial
from serial.tools import list_ports

from ..models import SourceName
from .base import SourceObserver

logger = logging.getLogger(__name__)

# Searched in this order: Arduino first, then Espressif's own USB, then the usual USB-serial
# bridge chips (which is how most ESP32 boards and ESP32-CAM programmers connect).
VENDOR_PRIORITY = (
    0x2341,  # Arduino, including the Nano ESP32
    0x303A,  # Espressif: an ESP32-S2 or S3 over its own USB
    0x10C4,  # Silicon Labs CP210x
    0x1A86,  # QinHeng CH340
    0x0403,  # FTDI
)
BOOTLOADER_BAUD = 1200
READ_CHUNK = 4096
# A read returns what arrived within this window (up to READ_CHUNK bytes): a whole frame
# packet takes a few reads, and an idle port costs 50 reads a second.
READ_TIMEOUT_S = 0.02
WRITE_TIMEOUT_S = 1.0
BACKOFF_START_S = 1.0
BACKOFF_CAP_S = 10.0

_BUSY_MARKERS = (
    "permissionerror",
    "access is denied",
    "exclusively lock",
    "resource busy",
    "resource temporarily unavailable",
)


class PortInfo(Protocol):
    device: str
    vid: int | None


class Port(Protocol):
    def read(self, size: int) -> bytes: ...

    def write(self, data: bytes) -> int | None: ...

    def close(self) -> None: ...


def find_port(ports: Iterable[PortInfo]) -> str | None:
    """The first port whose vendor id is in VENDOR_PRIORITY, best vendor first."""
    by_device = sorted(ports, key=lambda p: p.device)
    for vid in VENDOR_PRIORITY:
        for info in by_device:
            if info.vid == vid:
                return info.device
    return None


def is_busy(error: BaseException) -> bool:
    """Whether an open failure means another program holds the port."""
    text = str(error).lower()
    return any(marker in text for marker in _BUSY_MARKERS)


def _open_port(device: str, baud: int) -> Port:
    port: Port = serial.serial_for_url(
        device,
        baudrate=baud,
        timeout=READ_TIMEOUT_S,
        write_timeout=WRITE_TIMEOUT_S,
        exclusive=True,
    )
    return port


def _read_some(port: Port) -> bytes:
    """Whatever arrives within READ_TIMEOUT_S, up to READ_CHUNK bytes; b"" if nothing.

    Not sized by `in_waiting`: on socket:// URLs that reports at most 1, which would turn
    a 9 KB frame into thousands of one-byte reads.
    """
    return port.read(READ_CHUNK)


class SerialSource:
    name: SourceName = "serial"

    def __init__(
        self,
        port: str | None = None,
        baud: int = 115200,
        *,
        opener: Callable[[str, int], Port] = _open_port,
        lister: Callable[[], Iterable[Any]] = list_ports.comports,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if baud == BOOTLOADER_BAUD:
            raise ValueError("1200 baud reboots an Arduino into its bootloader; use 115200")
        self._configured = port
        self._baud = baud
        self._opener = opener
        self._lister = lister
        self._sleep = sleep
        self._port: Port | None = None
        self._write_lock = asyncio.Lock()

    async def write(self, data: bytes) -> None:
        """Send P1 / P0. Raises OSError when the port is not open; the supervisor retries."""
        port = self._port
        if port is None:
            raise OSError("the serial port is not open")
        async with self._write_lock:
            try:
                await asyncio.to_thread(port.write, data)
            except serial.SerialException as exc:
                raise OSError(str(exc)) from exc

    async def chunks(self, observer: SourceObserver) -> AsyncIterator[bytes]:
        backoff = BACKOFF_START_S
        while True:
            device = self._configured or find_port(await asyncio.to_thread(self._lister))
            if device is None:
                observer.closed()  # no port and not open: "No Nano found"
                await self._sleep(backoff)
                backoff = min(BACKOFF_CAP_S, backoff * 2)
                continue
            try:
                port = await asyncio.to_thread(self._opener, device, self._baud)
            except (serial.SerialException, OSError, ValueError) as exc:
                if is_busy(exc):
                    logger.warning("%s is busy: %s", device, exc)
                    observer.port_busy(device)
                else:
                    logger.info("cannot open %s: %s", device, exc)
                    observer.closed()
                await self._sleep(backoff)
                backoff = min(BACKOFF_CAP_S, backoff * 2)
                continue

            self._port = port
            observer.opened(device)
            backoff = BACKOFF_START_S
            logger.info("serial port %s open at %d baud", device, self._baud)
            try:
                while True:
                    data = await asyncio.to_thread(_read_some, port)
                    if data:
                        yield data
            except (serial.SerialException, OSError) as exc:
                logger.warning("lost %s: %s", device, exc)
            finally:
                self._port = None
                try:
                    port.close()
                except (serial.SerialException, OSError) as exc:
                    logger.debug("closing %s: %s", device, exc)
                observer.closed()
            await self._sleep(backoff)
