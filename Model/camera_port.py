# Finding the camera board among the serial ports (the "scan").
#
# One place for the camera bridge (camera_bridge.py) and the tools that read the camera
# directly (capture.py, live.py through camera.py), so a board is found the same way
# everywhere, including when it is the only thing plugged in.

from __future__ import annotations

import re

from serial.tools import list_ports

# USB vendor ids, most likely first:
#   0x2341  Arduino (the Nano 33 BLE, and the Nano ESP32 over its own USB)
#   0x303A  Espressif (an ESP32-S2 or S3 over its own USB)
#   0x10C4  Silicon Labs CP210x, 0x1A86  CH340 and CH9102, 0x0403  FTDI:
#           the USB-serial chips on ESP32 dev boards and ESP32-CAM programmers
VENDOR_PRIORITY = (0x2341, 0x303A, 0x10C4, 0x1A86, 0x0403)


def _natural(device: str) -> list[object]:
    """COM3 before COM10."""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", device)]


def find_camera_port() -> str | None:
    """The serial port most likely to be the camera board, or None when there is none."""
    ports = sorted(list_ports.comports(), key=lambda p: _natural(p.device))
    for vid in VENDOR_PRIORITY:
        for port in ports:
            if port.vid == vid:
                return port.device
    return None


def describe_port(device: str) -> str:
    """What the operating system calls this port, for the log."""
    for port in list_ports.comports():
        if port.device == device:
            return port.description or "serial port"
    return "serial port"


def ports_seen() -> str:
    """Every serial port there is, so 'no camera board found' says what it did find."""
    ports = sorted(list_ports.comports(), key=lambda p: _natural(p.device))
    if not ports:
        return "none"
    return ", ".join(f"{p.device} ({p.description or 'serial port'})" for p in ports)
