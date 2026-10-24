# Live classification of the OV7675 stream using waste_cnn.pt.
#
#   python live.py
#
# Keys: q = quit, s = save the current frame to misclassified/ (for hard cases)
# Close the Arduino Serial Monitor before running.

import time
from pathlib import Path

import cv2
import numpy as np
import torch

from camera import CameraStream
from model import SmallCNN

CKPT = "waste_cnn.pt"
SMOOTH = 0.6        # EMA factor on probabilities: higher = steadier, slower
MIN_CONF = 0.60     # below this the label is shown as "uncertain"
FRAME_BYTES = 160 * 120 + 8   # one QQVGA frame plus the FRM0 header

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
ckpt = torch.load(CKPT, map_location=device)
classes = ckpt["classes"]
mean, std = ckpt["mean"], ckpt["std"]

net = SmallCNN(num_classes=len(classes)).to(device)
net.load_state_dict(ckpt["state_dict"])
net.eval()
print(f"loaded {CKPT} on {device}: {', '.join(classes)}")

COLORS = [(150, 150, 150), (0, 200, 255), (0, 255, 120)]  # empty, can, phone_case

cam = CameraStream()
cv2.namedWindow("live", cv2.WINDOW_NORMAL)
cv2.resizeWindow("live", 640, 580)

probs_ema = np.zeros(len(classes), dtype=np.float32)
fps, last_t = 0.0, time.time()
Path("misclassified").mkdir(exist_ok=True)

while True:
    key = cv2.waitKey(1) & 0xFF
    if key == ord("q"):
        break

    # Inference is slower than frames arrive, so drop any backlog before
    # reading. read_frame() then resyncs on the next real header.
    cam.drain(FRAME_BYTES)

    frame = cam.read_frame()
    if frame is None:
        continue

    x = torch.from_numpy(frame).float().div_(255.0).sub_(mean).div_(std)
    x = x.unsqueeze(0).unsqueeze(0).to(device)
    with torch.no_grad():
        p = torch.softmax(net(x), dim=1)[0].cpu().numpy()

    probs_ema = SMOOTH * probs_ema + (1 - SMOOTH) * p if probs_ema.any() else p
    idx = int(probs_ema.argmax())
    conf = float(probs_ema[idx])
    label = classes[idx] if conf >= MIN_CONF else "uncertain"
    color = COLORS[idx % len(COLORS)] if conf >= MIN_CONF else (90, 90, 90)

    now = time.time()
    fps = 0.9 * fps + 0.1 / max(now - last_t, 1e-6)
    last_t = now

    if key == ord("s"):
        cv2.imwrite(f"misclassified/{time.strftime('%Y%m%d_%H%M%S')}_{label}.png", frame)

    big = cv2.cvtColor(cv2.resize(frame, (640, 480), interpolation=cv2.INTER_NEAREST),
                       cv2.COLOR_GRAY2BGR)
    panel = cv2.copyMakeBorder(big, 0, 100, 0, 0, cv2.BORDER_CONSTANT, value=(20, 20, 20))

    cv2.putText(panel, f"{label}  {conf * 100:.0f}%", (14, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 3)
    cv2.putText(panel, f"{fps:.0f} fps", (545, 32),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (160, 160, 160), 2)

    for i, name in enumerate(classes):
        y = 500 + i * 28
        cv2.putText(panel, f"{name:<12}", (14, y + 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
        cv2.rectangle(panel, (160, y), (160 + int(probs_ema[i] * 400), y + 16),
                      COLORS[i % len(COLORS)], -1)
        cv2.putText(panel, f"{probs_ema[i] * 100:5.1f}%", (575, y + 13),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

    cv2.imshow("live", panel)

cam.close()
cv2.destroyAllWindows()
