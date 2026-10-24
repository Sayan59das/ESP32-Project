# EcoSort Edge

EcoSort Edge sorts items of waste into recyclable or non-recyclable. A camera board (an
OV7675 camera on an Arduino) streams grayscale frames to the laptop over USB. A small neural
network trained on our own photos (`Model/waste_cnn.pt`) labels each frame, and when an item is
placed in view it is counted once, in the matching bin. This repository holds the camera
bridge that runs the model, the bridge that stores and serves the results, and the operator
console that shows what the classifier sees, with the running totals of recyclable and
non-recyclable items directly beneath it.

```
camera board (OV7675): FRM0 grayscale frames, 160x120
    -> USB serial
    -> camera bridge (Model/camera_bridge.py): trained model, counts each item once
    -> EcoSort wire contract on TCP port 7777: text lines and binary frame packets
    -> bridge (FastAPI): parse, validate, store in SQLite, count
    -> SSE (numbers) + MJPEG (live frames)
    -> console (Next.js) in the browser
```

The bridge owns the truth: it recomputes every bin from its own table, keeps every event
and frame, and computes every count. The browser never adds to a counter.

## Run it with the camera (one click)

```bat
run_all.bat          start everything (stop_all.bat stops it)
run_all.bat prod     the same, with the console as a production build
run_all.bat check    only check that everything is ready
```

Plug the camera board in with a data USB cable, close the Arduino Serial Monitor and
`live.py` (only one program can use the port), keep the camera view **empty**, and run
`run_all.bat`. The first run creates the Python environment and installs the packages.
Three windows open and the console opens at http://localhost:3000:

1. **Camera bridge** reads the camera, runs the model and counts items. It finds the board
   by USB vendor id; set `CAMERA_PORT=COM6` (and `CAMERA_BAUD`) at the top of `run_all.bat`
   if you need to name it.
2. **Website bridge** stores every verdict with its frame and serves the data.
3. **Console** is the website.

Put an item in front of the camera: its bin's count goes up by one, once, however long it
stays. Take it away before the next one: the view must be empty in between. Window 1 says
what happens (`calibrating`, `ready`, `item in view`, `counted: recyclable 0.98`). Add
`--verbose` to its command to also see the scene-change value every 2 s, which is what to
look at if items are not noticed or empty views count as items.

How it counts: the model has two classes and no "empty" class, so it answers one or the
other even when nothing is there. The camera bridge therefore watches the *scene*: it
averages the first ~3 s (empty view) into a background and measures how far each frame is
from it, ignoring overall brightness changes. When the picture differs, the model's answers
are averaged until they settle, one verdict is produced, and nothing more is counted until
the view matches the background again. A low-confidence answer is counted as unsure, in
neither bin.

The model runs without PyTorch (`Model/numpy_cnn.py` reads `waste_cnn.pt` and does the same
arithmetic in numpy), so no torch install is needed to run the website. `python
Model/camera_bridge.py --check` loads the model and classifies one training image.

To try it without a board: `python scripts/fake_camera.py` streams scripted frames from
`Model/dataset`, and `python Model/camera_bridge.py --camera socket://127.0.0.1:7778` reads
them.

## Quick start (simulator)

Needs Python 3.11+, Node 20+ and GNU make. On Windows install make with
`winget install ezwinports.make`, or use MSYS2's `mingw32-make`.

```sh
cp .env.example .env
make setup        # Python venv, npm packages, Playwright's Chromium
make sim          # bridge on :8000 and console on :3000, simulated data
```

Open http://localhost:3000. The header says **Simulated data**, and so does a tag on the
camera window: simulated events and frames are never presented as real.

Open the console at `localhost`, not `127.0.0.1`: the bridge accepts the console's origin
from `CORS_ORIGIN`, and the webcam needs a secure origin.

## Running with the Nano

1. Apply `firmware/INTEGRATION.md` to the sketch and flash it.
2. Plug the Nano in with a data USB cable. Close the Arduino Serial Monitor and any Edge
   Impulse tool: only one program can hold the port.
3. Set `SOURCE=serial` in `.env` (leave `SERIAL_PORT` blank to auto-detect) and run
   `make dev`.

The bridge finds the Nano by USB vendor id (Arduino first, then CP210x, CH340, FTDI),
opens it at 115200 and never at 1200 (1200 reboots an Arduino into its bootloader), and
reconnects by itself with backoff from 1 s to 10 s. If another program holds the port the
console says so instead of crashing.

## Make targets

| Target | What it does |
| --- | --- |
| `make setup` | Backend venv, frontend packages, Playwright Chromium |
| `make dev` | Bridge (source from `.env`) and console together |
| `make sim` | The same, on the simulator whatever `.env` says |
| `make test` | Backend pytest and frontend Vitest |
| `make e2e` | Production build, then the Playwright smoke, accessibility and offline tests |
| `make lint` | ruff, the WCAG contrast check, ESLint, Prettier, `tsc --noEmit` |
| `make format` | ruff and Prettier fixes |
| `make types` | OpenAPI schema from FastAPI, then TypeScript types from it |
| `make fake-nano` | A stand-in Nano on TCP port 7777, with link faults |
| `make bench` | Bridge and console reading the fake Nano as a serial port, own database |
| `make record` | Capture 120 s of a real Nano session for replay |

## Configuration

`.env` lives at the repo root and is read by both the bridge and the console.
Environment variables override it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOURCE` | `sim` | `serial`, `sim` or `replay` |
| `SERIAL_PORT` | blank | Blank auto-detects. Also accepts a pyserial URL, e.g. `socket://127.0.0.1:7777` |
| `BAUD` | `115200` | Never 1200 |
| `DB_PATH` | `./ecosort.db` | SQLite file for runs, events and frames |
| `CORS_ORIGIN` | `http://localhost:3000` | The console's origin |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | Where the console finds the bridge |
| `REPLAY_FILE` | `data/sample_session.rec` | Capture used by `SOURCE=replay` |
| `NEXT_TELEMETRY_DISABLED` | `1` | Keeps Next.js from reporting anything |

## Protocol

One USB serial stream carries ASCII text lines and binary frame packets. A packet starts
with `0xEC`, which never appears in ASCII text, so the two cannot be confused.

### Text lines (newline-terminated, at most 64 bytes before the newline)

| Line | Meaning |
| --- | --- |
| `EVT,<label>,<confidence>,<bin>,<latency_ms>` | One classification. Label `recyclable`, `trash` or `uncertain`; confidence `0.00` to `1.00`; bin `RECYCLABLE`, `TRASH` or `NONE`; latency is inference time on the Nano |
| `HELLO,<firmware_version>` | Once per boot, when the host opens the port. A second one during a run means the Nano reset |
| `HB,<uptime_ms>` | Every 5 s. The only proof the Nano is alive between events |
| `DBG,<text>` | Debug text, ignored |

Anything else is dropped and counted. `background` is ignored and counted. `uncertain` is
stored as unsure and added to neither bin. If the firmware's bin disagrees with the
bridge's table, the bridge's bin is stored and the mismatch counted.

### Frame packet (little-endian)

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | Magic `EC A5 F0 5A` |
| 4 | 1 | Type: 1 preview, 2 verdict |
| 5 | 2 | Width (160 from the camera bridge) |
| 7 | 2 | Height (120 from the camera bridge) |
| 9 | 4 | Payload length, width times height, at most 32768 |
| 13 | N | 8-bit grayscale pixels, row-major |
| 13+N | 2 | CRC-16/CCITT-FALSE over bytes 4 to 13+N-1 |

A 160x120 packet is 19215 bytes. The verdict frame comes immediately before its EVT line; the
bridge attaches it to that event and discards it if no EVT follows within 3 s. Preview
frames flow only while the console is open: the bridge sends `P1` when the first viewer
connects and `P0` when the last one leaves, at most 5 frames per second.

## Recording and replaying a session

Stop the bridge, then:

```sh
make record                       # or: python scripts/record.py --seconds 300 --preview
```

This writes `data/sample_session.rec`: each chunk the port returned, with a 4-byte
millisecond offset and a 2-byte length. Set `SOURCE=replay` and run `make dev` to play it
back at its recorded timing, looped, under a **Replay of a recorded session** banner. The
repository ships the file empty until a real session is recorded.

## Bench test without hardware

```sh
make fake-nano    # terminal 1: a fake Nano with corrupt frames, bad lines, resets, stalls
make bench        # terminal 2: the bridge reads it as SERIAL_PORT=socket://127.0.0.1:7777
```

Stopping the fake Nano looks like unplugging the board; starting it again looks like
plugging it back in. On Linux or macOS `python scripts/fake_nano.py --pty` creates a
pseudo-terminal instead and prints the path for `SERIAL_PORT`. The bench writes to
`bench.db`, never to the real database.

## Results page

`/project` reads `data/metrics.json` on every request. Every key may be null, and a null or
malformed value renders "Not measured yet"; nothing is estimated.

| Key | Shape |
| --- | --- |
| `test_images_per_class` | `{"recyclable": 20, "trash": 33}` |
| `test_accuracy_per_class` | Same keys, fractions from 0 to 1 |
| `overall_test_accuracy` | Fraction from 0 to 1 |
| `latency_ms_p50`, `latency_ms_p95` | Milliseconds, inference time for one frame |
| `ram_kb_peak`, `flash_kb` | Kilobytes (only meaningful when classifying on a board) |
| `model_input`, `model_architecture`, `dataset_notes` | Text |
| `confusion_matrix` | `{"labels": ["recyclable", "trash"], "rows": [[...], ...]}`, rows are the true item |
| `ir_sensor` | Text: the sensor's model (only when a board with a trigger sensor is used) |
| `wiring` | `[{"from": "camera USB", "to": "laptop", "note": "..."}]` |
| `datasets`, `credits` | `[{"name": "...", "licence": "...", "url": "..."}]` |

## Tests

```sh
make test     # about 300 backend tests, including parser fuzzing and a firmware contract test
make e2e      # 44 browser tests against the simulator
make lint
```

`backend/tests/test_firmware_contract.py` compiles `firmware/ecosort_io.h` on the host with
g++ against a fake `Serial` and decodes its output with the bridge's own parser, so the
firmware and the bridge are checked against each other (skipped when no C++ compiler is on
PATH). The browser tests check the camera window is square, the bin readout sits flush
under it at the same width, the counts on screen match the API, the frame dialog shows the
96x96 frame, nothing scrolls sideways at 1280, 1024, 768, 390 or 320 pixels, the empty,
paused, unreachable and 404 states, keyboard use (skip link, dialogs, pausing the preview),
that axe finds no WCAG 2.2 AA violations in the light and dark themes, and that no page
requests anything outside the machine.

## What this does not do

- It does not stream full-resolution video, only the 160 by 120 grayscale frame the model
  sees.
- It does not train models (`Model/train.py` does).
- Counts assume a clear view between items, and an empty view when the camera bridge
  starts. Two items placed one straight after the other count as one. Its trigger levels
  adapt to the camera's noise but have not been tuned on real footage.
- The model knows two answers. It cannot say "this is something new".
- Inference time is the model on the laptop for one frame; it is not the time from an
  object arriving to its count changing on screen.

## Layout

```
backend/app/        FastAPI bridge: protocol parser, frames, store, hub, sources, routes
backend/tests/      pytest suite
frontend/           Next.js console: app/, components/, lib/, styles/, e2e/
                    (tokens, components, outcome colours and states: frontend/DESIGN.md)
Model/              the trained model and the camera bridge: camera_bridge.py, numpy_cnn.py,
                    presence.py, plus train.py, live.py and the dataset
firmware/           ecosort_io.h for classifying on a Nano instead, its guide and host test
scripts/            check_contrast.py, export_openapi.py, fake_nano.py, fake_camera.py, record.py
run_all.bat         starts everything; stop_all.bat stops it
data/               metrics.json for /project, sample_session.rec for replay
```
