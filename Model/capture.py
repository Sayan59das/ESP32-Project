# Dataset capture tool for the OV7675 stream.
#
#   python capture.py
#
# Keys (focus the "capture" window first):
#   1 / 2 / 3  save one frame to dataset/empty, dataset/can, dataset/phone_case
#   r          toggle burst recording into the last class you pressed
#   u          undo the last saved file
#   q          quit
#
# Images are saved as the raw 160x120 grayscale frame -- exactly what the model
# will see at inference time. Close the Arduino Serial Monitor before running.

import os
import time
from pathlib import Path

import cv2

from camera import CameraStream
from model import CLASSES

ROOT = Path("dataset")
BURST_EVERY = 3        # during burst recording, save 1 of every N frames
KEY_FOR = {ord(str(i + 1)): i for i in range(len(CLASSES))}  # follows CLASSES

for name in CLASSES:
    (ROOT / name).mkdir(parents=True, exist_ok=True)

counts = {name: len(list((ROOT / name).glob("*.png"))) for name in CLASSES}
last_saved = None
selected = 0
recording = False
frame_i = 0


def save(frame, class_idx):
    global last_saved
    name = CLASSES[class_idx]
    stamp = time.strftime("%Y%m%d_%H%M%S") + f"_{int(time.time() * 1000) % 1000:03d}"
    path = ROOT / name / f"{name}_{stamp}.png"
    cv2.imwrite(str(path), frame)
    counts[name] += 1
    last_saved = path


cam = CameraStream()
cv2.namedWindow("capture", cv2.WINDOW_NORMAL)
cv2.resizeWindow("capture", 640, 560)

print("waiting for frames...")
print("1=empty  2=can  3=phone_case   r=burst   u=undo   q=quit")

first = True
while True:
    key = cv2.waitKey(1) & 0xFF
    if key == ord("q"):
        break

    frame = cam.read_frame()
    if frame is None:
        continue
    if first:
        print(f"streaming {frame.shape[1]}x{frame.shape[0]}")
        first = False
    frame_i += 1

    if key in KEY_FOR:
        selected = KEY_FOR[key]
        save(frame, selected)
    elif key == ord("r"):
        recording = not recording
    elif key == ord("u") and last_saved is not None:
        if last_saved.exists():
            os.remove(last_saved)
            counts[last_saved.parent.name] -= 1
        last_saved = None

    if recording and frame_i % BURST_EVERY == 0:
        save(frame, selected)

    # ---- display ----
    big = cv2.resize(frame, (640, 480), interpolation=cv2.INTER_NEAREST)
    big = cv2.cvtColor(big, cv2.COLOR_GRAY2BGR)
    panel = cv2.copyMakeBorder(big, 0, 80, 0, 0, cv2.BORDER_CONSTANT, value=(20, 20, 20))

    for i, name in enumerate(CLASSES):
        active = i == selected
        color = (0, 255, 255) if active else (180, 180, 180)
        cv2.putText(panel, f"{i + 1} {name}: {counts[name]}", (12 + i * 215, 510),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    total = sum(counts.values())
    status = f"REC -> {CLASSES[selected]}" if recording else "idle"
    cv2.putText(panel, f"{status}   total {total}", (12, 545),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (0, 0, 255) if recording else (160, 160, 160), 2)
    cv2.putText(panel, "r=burst  u=undo  q=quit", (330, 545),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1)

    cv2.imshow("capture", panel)

cam.close()
cv2.destroyAllWindows()
print("saved:", ", ".join(f"{k}={v}" for k, v in counts.items()))
