"""The firmware's output, decoded by the bridge's own parser.

Compiles firmware/test/host_test.cpp (ecosort_io.h against a fake Serial), runs it, and
checks every byte it produced parses into exactly the expected lines and frames. Skipped
when no C++ compiler is on PATH.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.frames import KIND_PREVIEW, KIND_VERDICT, FramePacket
from app.protocol import (
    DebugLine,
    EventLine,
    FrameError,
    HeartbeatLine,
    HelloLine,
    Rejected,
    StreamParser,
)

REPO = Path(__file__).resolve().parents[2]
FIRMWARE = REPO / "firmware"
CXX = shutil.which("g++") or shutil.which("clang++")

pytestmark = pytest.mark.skipif(CXX is None, reason="no C++ compiler on PATH")

GRADIENT = bytes(((x * 2 + y) & 0xFF) for y in range(96) for x in range(96))
BANNER = "Edge Impulse standalone inferencing (Arduino) with a long banner line"


@pytest.fixture(scope="module")
def nano_bytes(tmp_path_factory: pytest.TempPathFactory) -> bytes:
    assert CXX is not None
    work = tmp_path_factory.mktemp("firmware")
    exe = work / "host_test"
    compile_cmd = [
        CXX,
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-static",
        f"-I{FIRMWARE / 'ecosort_io'}",
        str(FIRMWARE / "test" / "host_test.cpp"),
        "-o",
        str(exe),
    ]
    subprocess.run(compile_cmd, check=True, capture_output=True, timeout=120)
    out = work / "nano.bin"
    run = subprocess.run([str(exe), str(out)], capture_output=True, text=True, timeout=30)
    assert run.returncode == 0, run.stderr
    return out.read_bytes()


def test_the_stream_decodes_into_exactly_the_expected_items(nano_bytes: bytes) -> None:
    items = StreamParser().feed(nano_bytes)
    assert not [i for i in items if isinstance(i, Rejected | FrameError)]

    debug = [i.text for i in items if isinstance(i, DebugLine)]
    others = [i for i in items if not isinstance(i, DebugLine)]
    assert debug[:2] == [BANNER[:60], BANNER[60:]]  # split to fit 64 bytes with "DBG,"
    assert debug[2] == "Predictions: -0.25000"
    assert len(debug) == 3

    hello, verdict, *events, heartbeat, preview = others
    assert hello == HelloLine("1.0.0-host")
    assert isinstance(verdict, FramePacket)
    assert (verdict.kind, verdict.width, verdict.height) == (KIND_VERDICT, 96, 96)
    assert verdict.pixels == GRADIENT
    assert events == [
        EventLine("recyclable", 0.94, "RECYCLABLE", 412),
        EventLine("uncertain", 0.41, "NONE", 408),
        EventLine("trash", 1.0, "TRASH", 999999),
        EventLine("trash", 0.0, "TRASH", 0),
    ]
    assert heartbeat == HeartbeatLine(5010)
    assert isinstance(preview, FramePacket)
    assert preview.kind == KIND_PREVIEW
    assert preview.pixels == GRADIENT


def test_every_line_fits_the_64_byte_limit(nano_bytes: bytes) -> None:
    text = bytearray()
    parser_items = StreamParser().feed(nano_bytes)
    frames = [i for i in parser_items if isinstance(i, FramePacket)]
    packet_size = 13 + 96 * 96 + 2
    assert len(frames) == 2
    # Remove the two packets, then every remaining line must be 64 bytes or fewer.
    rest = nano_bytes
    for _ in frames:
        start = rest.index(b"\xec\xa5\xf0\x5a")
        text += rest[:start]
        rest = rest[start + packet_size :]
    text += rest
    lines = bytes(text).split(b"\n")
    assert lines[-1] == b""
    assert all(0 < len(line) <= 64 for line in lines[:-1])


def test_the_verdict_frame_comes_right_before_its_event(nano_bytes: bytes) -> None:
    items = [i for i in StreamParser().feed(nano_bytes) if not isinstance(i, DebugLine)]
    verdict_at = next(n for n, i in enumerate(items) if isinstance(i, FramePacket))
    assert isinstance(items[verdict_at + 1], EventLine)
