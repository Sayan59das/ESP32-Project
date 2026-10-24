# Decides when an item has been placed in front of the camera and counts it exactly once.
#
# The trained model has two classes (recyclable, non_recyclable) and no "empty" class, so it
# answers one or the other even when nothing is there. Counting every confident frame would
# add dozens of items per second, so the count is driven by the SCENE instead:
#
#   CALIBRATING  the first seconds after start: the view must be EMPTY. The frames are
#                averaged into a background, and their noise sets the trigger thresholds.
#   ABSENT       nothing in view. The background follows slow lighting drift.
#   PRESENT      the picture differs from the background (an item arrived). When the model's
#                averaged answer is confident, ONE verdict is produced. Nothing more is
#                counted until the scene is back to the background (the item was removed).
#
# Pure numpy, no I/O, no clock of its own: the caller passes `now` in seconds. That is what
# makes it testable.

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

UNCERTAIN = "uncertain"
CALIBRATING, ABSENT, PRESENT = "calibrating", "absent", "present"


@dataclass(frozen=True, slots=True)
class Verdict:
    label: str  # a model class name, or "uncertain"
    confidence: float  # 0..1, of the averaged answer
    frames: int  # frames the answer is based on


def shrink(frame: np.ndarray, k: int = 4) -> np.ndarray:
    """Block-average a frame by k in both directions: 160x120 -> 40x30. Cheap, and it
    averages the sensor noise away before frames are compared."""
    h, w = frame.shape
    h2, w2 = h // k * k, w // k * k
    return frame[:h2, :w2].reshape(h2 // k, k, w2 // k, k).mean(axis=(1, 3), dtype=np.float32)


def scene_change(small: np.ndarray, background: np.ndarray) -> float:
    """Mean absolute difference in grey levels (0..255) after removing each picture's own
    average brightness, so the camera's auto-exposure moving does not look like an item."""
    return float(np.abs((small - small.mean()) - (background - background.mean())).mean())


class ItemCounter:
    def __init__(
        self,
        classes: Sequence[str],
        *,
        min_conf: float = 0.60,  # below this the verdict is "uncertain" (same as live.py)
        calibrate_s: float = 2.5,
        calibrate_min_frames: int = 8,
        on_s: float = 0.3,  # the scene must differ this long before it counts as an item
        on_min_frames: int = 2,
        settle_s: float = 0.5,  # then wait this long for the model's answer to settle
        settle_min_frames: int = 3,
        vote_frames: int = 8,  # average the model over (at most) the last N frames
        wait_s: float = 3.0,  # give up waiting for a confident answer: "uncertain"
        off_s: float = 0.8,  # the scene must match the background this long to re-arm
        off_min_frames: int = 3,
        stuck_s: float = 60.0,  # an item that never leaves: recalibrate rather than hang
        background_rate: float = 0.05,
        min_on: float = 8.0,
        min_off: float = 3.0,
        k_on: float = 5.0,
        k_off: float = 2.5,
        log: Callable[[str], None] | None = None,
    ) -> None:
        self.classes = list(classes)
        self.p = {
            "min_conf": min_conf,
            "calibrate_s": calibrate_s,
            "calibrate_min_frames": calibrate_min_frames,
            "on_s": on_s,
            "on_min_frames": on_min_frames,
            "settle_s": settle_s,
            "settle_min_frames": settle_min_frames,
            "vote_frames": vote_frames,
            "wait_s": wait_s,
            "off_s": off_s,
            "off_min_frames": off_min_frames,
            "stuck_s": stuck_s,
            "background_rate": background_rate,
            "min_on": min_on,
            "min_off": min_off,
            "k_on": k_on,
            "k_off": k_off,
        }
        self._log = log or (lambda _msg: None)
        self.state = CALIBRATING
        self.change = 0.0  # last scene_change, for status lines
        self.t_on = self.t_off = 0.0
        self._start_calibration()

    # -- public ----------------------------------------------------------------------

    def recalibrate(self) -> None:
        """Forget the background and learn a new one. The view must be empty."""
        self._start_calibration()

    def feed(self, frame: np.ndarray, probs: np.ndarray, now: float) -> Verdict | None:
        """One camera frame and the model's probabilities for it. Returns a Verdict at the
        moment an item is counted, otherwise None."""
        small = shrink(frame)
        if self.state == CALIBRATING:
            self._calibrate(small, now)
            return None
        self.change = scene_change(small, self._bg)
        if self.state == ABSENT:
            self._while_absent(small, probs, now)
            return None
        return self._while_present(small, probs, now)

    # -- calibration -----------------------------------------------------------------

    def _start_calibration(self) -> None:
        self.state = CALIBRATING
        self._cal: list[np.ndarray] = []
        self._cal_start: float | None = None
        self._reset_item()
        self._log("calibrating: keep the camera view EMPTY")

    def _calibrate(self, small: np.ndarray, now: float) -> None:
        if self._cal_start is None:
            self._cal_start = now
        self._cal.append(small)
        if (
            now - self._cal_start < self.p["calibrate_s"]
            or len(self._cal) < self.p["calibrate_min_frames"]
        ):
            return
        self._bg = np.mean(self._cal, axis=0, dtype=np.float32)
        noise = max(scene_change(s, self._bg) for s in self._cal)
        self.t_off = max(self.p["min_off"], self.p["k_off"] * noise)
        self.t_on = max(self.p["min_on"], self.p["k_on"] * noise, 2.0 * self.t_off)
        self._cal = []
        self.state = ABSENT
        self._log(
            f"ready: camera noise {noise:.1f}, item trigger above {self.t_on:.1f}, "
            f"clear below {self.t_off:.1f}"
        )

    # -- the two running states -------------------------------------------------------

    def _reset_item(self) -> None:
        self._on_since: float | None = None
        self._on_frames = 0
        self._probs: list[np.ndarray] = []
        self._present_since = 0.0
        self._decided = False
        self._decided_at = 0.0
        self._off_since: float | None = None
        self._off_frames = 0

    def _while_absent(self, small: np.ndarray, probs: np.ndarray, now: float) -> None:
        if self.change > self.t_on:
            if self._on_since is None:
                self._on_since, self._on_frames, self._probs = now, 0, []
            self._on_frames += 1
            self._probs.append(probs)
            if (
                now - self._on_since >= self.p["on_s"]
                and self._on_frames >= self.p["on_min_frames"]
            ):
                self.state = PRESENT
                self._present_since = self._on_since
                self._decided = False
                self._off_since, self._off_frames = None, 0
                self._log(f"item in view (scene change {self.change:.1f})")
            return
        # Nothing there: forget a flicker and let the background follow lighting drift.
        self._on_since, self._on_frames, self._probs = None, 0, []
        rate = self.p["background_rate"]
        self._bg = (1.0 - rate) * self._bg + rate * small

    def _answer(self) -> tuple[str, float]:
        recent = self._probs[-self.p["vote_frames"] :]
        if not recent:
            return UNCERTAIN, 0.0
        mean = np.mean(recent, axis=0)
        idx = int(mean.argmax())
        return self.classes[idx], float(mean[idx])

    def _while_present(self, small: np.ndarray, probs: np.ndarray, now: float) -> Verdict | None:
        # Only frames that still differ from the background carry an item. The model has no
        # "empty" class, so on a frame that looks empty (the item is leaving) it answers
        # confidently about nothing; those frames must never take part in the vote.
        item_in_frame = self.change >= self.t_off
        if item_in_frame:
            self._probs.append(probs)
            del self._probs[:-64]  # an item can sit in view for minutes; keep memory flat
        verdict: Verdict | None = None
        elapsed = now - self._present_since
        if not self._decided and item_in_frame:
            label, conf = self._answer()
            settled = (
                elapsed >= self.p["settle_s"] and len(self._probs) >= self.p["settle_min_frames"]
            )
            if settled and conf >= self.p["min_conf"]:
                verdict = Verdict(label, conf, len(self._probs))
            elif elapsed >= self.p["wait_s"]:
                verdict = Verdict(UNCERTAIN, conf, len(self._probs))
            if verdict is not None:
                self._decided, self._decided_at = True, now
                self._log(f"counted: {verdict.label} {verdict.confidence:.2f}")

        if self.change < self.t_off:
            if self._off_since is None:
                self._off_since, self._off_frames = now, 0
            self._off_frames += 1
            if (
                now - self._off_since >= self.p["off_s"]
                and self._off_frames >= self.p["off_min_frames"]
            ):
                if not self._decided and elapsed >= self.p["settle_s"]:
                    label, conf = self._answer()  # left before it was sure: count it as unsure
                    verdict = Verdict(UNCERTAIN, conf, len(self._probs))
                    self._log(f"counted: uncertain {conf:.2f} (item left early)")
                self.state = ABSENT
                self._bg = small.copy()  # snap to the clean scene
                self._reset_item()
                self._log("view clear, ready for the next item")
        else:
            self._off_since, self._off_frames = None, 0
            if self._decided and now - self._decided_at > self.p["stuck_s"]:
                self._log("item has not left for a long time: recalibrating (view must be empty)")
                self._start_calibration()
        return verdict
