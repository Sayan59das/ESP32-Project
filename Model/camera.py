# Shared serial frame reader for the OV7675 stream from cam_stream.ino
# Used by capture.py and live.py. Protocol unchanged:
#   b"FRM0" + width (2 bytes LE) + height (2 bytes LE) + width*height grayscale bytes
#
# Close the Arduino Serial Monitor before running anything that uses this.

import sys

import numpy as np
import serial

PORT = "COM6"  # change if your board enumerates elsewhere
BAUD = 921600
MAGIC = b"FRM0"


class CameraStream:
    """Non-blocking-ish reader. read_frame() does one short pass over the port
    and returns a (h, w) uint8 array, or None if no complete frame was ready.
    Call it in a loop alongside cv2.waitKey() so the window stays responsive."""

    def __init__(self, port=PORT, baud=BAUD, timeout=2):
        try:
            self.ser = serial.Serial(port, baud, timeout=timeout)
        except serial.SerialException as e:
            print(f"could not open {port}: {e}")
            print("is the Arduino Serial Monitor still open?")
            sys.exit(1)
        self._text = bytearray()

    def _read_exact(self, n):
        buf = bytearray()
        while len(buf) < n:
            chunk = self.ser.read(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return bytes(buf)

    def drain(self, frame_bytes, max_queued=2):
        """If the host has fallen behind, throw away the backlog instead of
        reading through it. A backlog means the OS buffer has already
        overflowed, so those bytes are mid-frame garbage -- reading them is
        what desyncs the stream and produces torn frames."""
        if self.ser.in_waiting > max_queued * frame_bytes:
            self.ser.reset_input_buffer()

    def read_frame(self, max_scan=200000):
        """Scan for the next frame header and return that frame, or None.

        The scan loops internally rather than consuming one byte per call, so
        regaining alignment after a dropped byte takes milliseconds instead of
        one byte per cv2.waitKey() tick."""
        scanned = 0
        while scanned < max_scan:
            b = self.ser.read(1)
            if not b:
                return None
            scanned += 1

            if b != MAGIC[0:1]:
                # Plain text from the board (e.g. "INIT FAILED ...") -- surface
                # it instead of letting an init failure look like silence.
                if b == b"\n":
                    line = self._text.decode(errors="ignore").strip()
                    if line.startswith("INIT"):
                        print(f"[board] {line}")
                    self._text = bytearray()
                elif len(self._text) < 200:
                    self._text += b
                continue

            if self._read_exact(3) != MAGIC[1:]:
                continue

            hdr = self._read_exact(4)
            if hdr is None:
                return None
            w = int.from_bytes(hdr[0:2], "little")
            h = int.from_bytes(hdr[2:4], "little")
            if not (0 < w <= 640 and 0 < h <= 480):
                continue  # false header inside pixel data -- keep scanning

            data = self._read_exact(w * h)
            if data is None:
                return None

            return np.frombuffer(data, dtype=np.uint8).reshape(h, w).copy()

        return None

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass
