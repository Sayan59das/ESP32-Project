# An ESP32 as the camera board

The camera bridge reads any board that sends the project's `FRM0` frames over USB serial
(`Model/camera.py` describes the format). `ecosort_esp32_camera/ecosort_esp32_camera.ino` does
that from an ESP32, so **an ESP32 on its own is enough**: no Arduino Nano 33 BLE is needed.
The ESP32 only sends the picture; the trained model still runs on the laptop.

## What has and has not been checked

- The sketch **compiles** for the Arduino Nano ESP32 (board package `arduino:esp32` 2.0.18),
  with both pin blocks. That is all that has been checked.
- It has **not been flashed or run** with a real camera, and the AI-Thinker block has not
  been compiled against the Espressif board package. Treat the first run as a test.
- The model was trained on frames from the **OV7675** rig. A different sensor, lens or angle
  changes the picture, so accuracy on this board is unknown until you test it (see
  [Accuracy](#accuracy-with-a-different-camera)).

## 1. Pick your board

| Board | Camera | Notes |
| --- | --- | --- |
| Arduino Nano ESP32 | OV7670 or OV7675 module, wired by you | The default block. Table below. |
| AI-Thinker ESP32-CAM | OV2640 on the board | Uncomment `BOARD_AI_THINKER`. Needs a USB-serial adapter or the ESP32-CAM-MB base to flash and to stream. |
| Anything else | Any camera the `esp32-camera` driver supports | Edit the pin numbers in the first block of the sketch. |

The `esp32-camera` driver names OV2640, OV3660, OV5640, OV7670, OV7725, NT99141 and GC0308
among others. **It does not name the OV7675.** Its product id looks like the OV7670's, so it
may be detected as one, but that is not verified. If the board prints `INIT FAILED camera
0x105` with correct wiring, try an OV7670 module.

### Arduino Nano ESP32 with an OV7670 / OV7675 module

The camera driver takes **GPIO numbers**, not the `D` and `A` labels. The labels are for you
to wire by; the sketch already uses the GPIO numbers.

| Camera module pin | Nano ESP32 label | GPIO |
| --- | --- | --- |
| 3V3, GND | 3V3, GND | |
| PWDN | GND | |
| RESET | 3V3 | |
| XCLK | D10 | 21 |
| SIOD (SDA) | A4 | 11 |
| SIOC (SCL) | A5 | 12 |
| D0 to D7 | D2, D3, D4, D5, D6, D7, D8, D9 | 5, 6, 7, 8, 9, 10, 17, 18 |
| VSYNC | D12 | 47 |
| HREF | A0 | 1 |
| PCLK | D11 | 38 |

Use a 3.3 V module and keep the wires short; a long, loose bundle is the usual cause of
torn pictures at 20 MHz. If you wire differently, change the numbers in the sketch, not the
table.

## 2. Flash it

1. Arduino IDE: **Tools > Board > Arduino ESP32 Boards > Arduino Nano ESP32** (or
   *AI Thinker ESP32-CAM* from the Espressif package for that board).
2. Open `firmware/ecosort_esp32_camera/ecosort_esp32_camera.ino`. For an AI-Thinker board,
   uncomment `#define BOARD_AI_THINKER` near the top.
3. Upload. For an ESP32-CAM without the MB base, connect GPIO0 to GND while uploading and
   remove it afterwards.
4. Open the Serial Monitor once at 921600: you should see `INIT OK camera pid 0x...`. Then
   **close it**: only one program can hold the port.

## 3. Run it

Plug in **only the ESP32** and run `run_all.bat`. The camera bridge scans the serial ports
(Arduino, Espressif, CP210x, CH340 and FTDI chips) and window 1 says which one it found:

```
camera-bridge: camera port COM5 (USB Serial Device) open at 921600 baud (found by scanning)
camera-bridge: board says: INIT OK camera pid 0x76, 160x120 grayscale
camera-bridge: calibrating: keep the camera view EMPTY
```

Keep the view empty for the first few seconds: that is when it learns the background. If more
than one board is plugged in and it picks the wrong one, name it with `CAMERA_PORT=COM6`
(top of `run_all.bat`). `Model/capture.py` and `Model/live.py` scan the same way.

Many ESP32 boards on a plain USB-serial chip restart when a program opens the port, so the
first frames can arrive a second or two after the bridge starts. That is normal.

## Troubleshooting

| What you see | What it means |
| --- | --- |
| `no camera board found ... (serial ports seen: ...)` | The ESP32 is not on the list. Try another cable (many are charge-only), another port, or name it with `CAMERA_PORT`. |
| `board says: INIT FAILED camera 0x105` | The sensor did not answer. Check power, SIOD/SIOC, XCLK and RESET/PWDN. |
| `INIT FAILED camera stopped sending frames` | The camera lost power or a wire came loose. It retries by itself. |
| Console says "Camera not responding" | No usable picture: unplugged, or the picture is dark, flat or frozen. Window 1 says which. |
| Picture upside down or mirrored | Set `CAM_VFLIP` or `CAM_HMIRROR` to 1 in the sketch. |
| Torn or noisy pictures | Shorten the wires, lower `CAM_XCLK_HZ` to 10000000. |
| Window 1 shows nothing after `open at 921600 baud` | The Serial Monitor or another program is holding the port, or the sketch is not flashed. |

Over a USB-serial chip, 921600 baud carries about five frames per second, like the Arduino
path. Over native USB (Nano ESP32, ESP32-S3) it can be faster, but the bridge's counting does
not need more.

## Accuracy with a different camera

`Model/waste_cnn.pt` learned from 269 frames of one OV7675 rig. With another sensor the
brightness, contrast, sharpness and field of view differ, so it may be less sure, and a
low-confidence answer is counted as Unsure rather than guessed. To measure and, if needed,
retrain for this board:

Both tools run from the `Model` folder and need OpenCV and PyTorch, which the website does
not (see `Model/requirements.txt`).

1. `cd Model`, then `python capture.py` with the ESP32 plugged in. Keys 1 and 2 save the
   current frame as a labelled example (the keys are listed at the top of `capture.py`).
   It scans for the board like the bridge does.
2. `python train.py` trains and evaluates, and writes a confusion matrix.
3. Keep the validation caveat in mind: frames from the same session as the training frames
   give an optimistic score. Test with frames captured on a different day.
