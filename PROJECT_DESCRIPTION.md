# EcoSort Edge: full project description

EcoSort Edge is a small waste-sorting system. A camera looks at one item at a time, a neural
network decides whether the item is **recyclable** or **non-recyclable**, and a web console
shows what the classifier sees together with running totals for each bin. Every decision is
stored with the exact frame the model saw, so a result can always be checked afterwards.

This file describes the whole project: what it is for, how the parts fit together, how an item
travels from the camera to a number on screen, how to run and test it, and where its limits
are. `README.md` is the shorter operating guide; this file is the explanation behind it.

---

## 1. The idea in one paragraph

An OV7675 camera on an Arduino board streams grayscale frames to a laptop over USB. A small
convolutional neural network, trained from scratch on photos taken for this project, labels
each frame. A scene-watching counter turns the stream of per-frame answers into exactly one
verdict per item placed in view. The verdict goes to a FastAPI service that validates it,
stores it in SQLite, and pushes it to a Next.js console in the browser. The console never adds
to a counter itself: every number on screen is computed and owned by the server.

## 2. What the system does, concretely

- Classifies items into two classes: `recyclable` and `non_recyclable` (the website calls the
  second one `trash`).
- Counts each item **once**, however long it stays in view, and not again until the view has
  been empty.
- Reports low-confidence answers as **unsure**, counted in neither bin.
- Shows the live grayscale frame the model reads, the last verdict, the running totals, the
  per-item breakdown and a log of recent events with thumbnails.
- Keeps every event and its frame in a database, supports separate **runs**, and exports a run
  as CSV.
- Works fully offline on one laptop. Nothing leaves the machine and the site makes no external
  requests.
- Has a simulator and a fake camera so the whole stack can be developed and tested without
  hardware.

## 3. Architecture

```
camera board (OV7675 on an Arduino): "FRM0" grayscale frames, 160x120
    |  USB serial, 921600 baud
    v
camera bridge  (Model/camera_bridge.py)
    runs the trained model, decides when one item has been placed in view, counts it once
    |  EcoSort wire contract over TCP port 7777: text lines + binary frame packets
    v
website bridge (backend/, FastAPI)
    parses and validates the stream, stores events and frames in SQLite, computes counts
    |  Server-Sent Events (numbers) + MJPEG (live frames) + REST
    v
console        (frontend/, Next.js)
    the pages: the story (/), the console the operator looks at (/console, http://localhost:3000/console),
    the testing results (/testing) and the project page (/project)
```

Design rules that run through every layer:

1. **The server owns the truth.** It recomputes every bin from its own item table, keeps every
   event and frame, and computes every count. The browser only displays.
2. **The model never picks a bin.** It outputs a label. A lookup table
   (`backend/app/classes.py`) is the single place that maps label to bin. The firmware and the
   camera bridge may send a bin as well; if it disagrees with the table, the server stores its
   own value and counts the mismatch.
3. **Nothing is faked silently.** Simulated data and replayed recordings are labelled as such
   in the header and on the camera window. A missing value in the Results page reads
   "Not measured yet" and is never estimated.
4. **Bad input never crashes the system.** Corrupt packets, junk lines, resets, stalls and a
   busy serial port are all handled, reported, and recovered from.

## 4. Repository layout

```
Model/              the trained model and the camera bridge
  waste_cnn.pt        trained weights (1.1 MB)
  model.py            SmallCNN architecture (PyTorch, for training)
  numpy_cnn.py        the same network in plain NumPy, used at run time (no torch needed)
  presence.py         the scene-based "one item, one count" logic
  camera.py           reads the camera's FRM0 packets from the serial port
  camera_bridge.py    runs the model on live frames and serves the wire contract on :7777
  capture.py          collects labelled training photos with OpenCV
  train.py            trains and evaluates the model
  live.py             a standalone live viewer for the model
  dataset/            104 recyclable + 165 non_recyclable training frames
  MODEL_TECH_STACK.txt  the model's tech stack and training details

backend/            the website bridge (FastAPI)
  app/protocol.py     parser for text lines and packet framing
  app/frames.py       frame packet encode/decode, CRC-16, PNG/JPEG conversion
  app/classes.py      the one item -> bin table
  app/store.py        SQLite storage: runs, events, frames
  app/hub.py          in-process pub/sub feeding SSE and MJPEG
  app/supervisor.py   the core loop: source bytes -> parser -> store -> hub
  app/link.py         link health tracking (heartbeats, resets)
  app/routes.py       the HTTP API
  app/sources/        serial, simulator and replay sources
  tests/              pytest suite

frontend/           the console (Next.js 14, React 18, TypeScript)
  app/page.tsx        the home story: a scroll through a 3D world (three.js)
  app/console/        the console: the page the operator works at (flat, no 3D)
  app/testing/        what was tested and what came out, from data/testing.json
  app/project/        the "How EcoSort Edge works" page and Results
  components/         camera window, bin readout, last verdict, event log, breakdown, ...
  lib/                API client, SSE client, reducer, formatting, metrics parsing, copy text
  e2e/                Playwright tests (layout, states, keyboard, accessibility, offline)
  DESIGN.md           tokens, components, outcome colours and icons, states

firmware/           optional path: classify on an Arduino Nano instead of on the laptop
  ecosort_io/ecosort_io.h   the whole wire contract as one header
  INTEGRATION.md            how to wire it into an Edge Impulse sketch
  test/host_test.cpp        compiles the header on a PC to test it

scripts/            check_contrast.py, export_openapi.py, fake_nano.py, fake_camera.py, record.py
data/               metrics.json (Results page values), sample_session.rec (replay capture)
run_all.bat         start everything with one double click
stop_all.bat        stop everything
Makefile            developer targets (setup, dev, test, e2e, lint, ...)
```

## 5. The model

**Task.** Look at one 160x120 grayscale frame and answer `recyclable` or `non_recyclable`.

**Architecture.** `SmallCNN`, 293,970 trainable parameters, trained from scratch (no
pretrained backbone).

| Stage | Detail |
| --- | --- |
| Input | 1 x 120 x 160 grayscale; pixel / 255, then (x - 0.5) / 0.25 |
| Blocks | 4 blocks of Conv3x3, BatchNorm, ReLU, Conv3x3, BatchNorm, ReLU, MaxPool 2x2 |
| Channels | 1, 16, 32, 64, 128 |
| Head | global average pool, Dropout 0.3, Linear 128 to 2, softmax |

**Training** (`Model/train.py`): PyTorch with torchvision transforms, AdamW (learning rate
1e-3, weight decay 1e-4), cosine annealing over 40 epochs, batch size 32, class-weighted
cross-entropy with label smoothing 0.05. Augmentation: random affine (rotation 10 degrees,
shift 12%, scale 0.85 to 1.15, shear 5), horizontal flip, brightness and contrast jitter, and
random erasing on 25% of frames. The best epoch by validation accuracy is kept. Evaluation
uses scikit-learn, with a confusion matrix and training curves saved as PNG files.

**Data.** 269 frames captured with `Model/capture.py`: 104 recyclable and 165 non-recyclable.
The validation split is 20% of each class with a fixed seed (53 frames).

**Result and its honest reading.** Validation accuracy is 100% (20/20 recyclable, 33/33
non-recyclable). The validation frames come from the same capture sessions as the training
frames, so this number is optimistic for a new bin, a different light or a different angle.
Treat it as a sanity check, not as a field accuracy.

**Running it without PyTorch.** `Model/numpy_cnn.py` reads `waste_cnn.pt` directly (through a
restricted unpickler that allows only the types a state dict needs) and repeats the same
arithmetic in NumPy: BatchNorm is folded into the convolutions and the convolutions run as
matrix multiplications. This exists because Windows Application Control blocks
`torch_python.dll` on the development PC. It reproduces the trained model's validation result
and takes about 40 ms per frame on a laptop CPU.

## 6. Counting: how one item becomes one count

The model has no "empty" class, so on an empty scene it still answers one of its two classes.
Counting every confident frame would add dozens of items per second. The camera bridge
therefore counts from the **scene**, not from the model alone (`Model/presence.py`):

1. **Calibrating.** In the first ~3 seconds after start the view must be empty. The frames are
   averaged into a background, and their noise sets the trigger thresholds. Overall brightness
   changes are ignored.
2. **Absent.** Nothing is in view. The background slowly follows lighting drift.
3. **Present.** The picture differs from the background: an item has arrived. The model's
   answers over the following frames are averaged until they settle, and **one** verdict is
   produced.
4. Nothing more is counted until the scene matches the background again, meaning the item was
   removed.

A verdict below 60% confidence becomes `uncertain` and is counted as unsure, in neither bin.

**A camera that is off.** The counter ignores overall brightness and the model has no "empty"
class, so a picture that goes black or flat would look like "the view changed" and the model
would answer confidently about nothing: a false item. `FrameHealth` (also in
`Model/presence.py`) therefore checks every frame before the model or the counter sees it. A
mean brightness under 20, a contrast (standard deviation) under 4, or ten identical frames in
a row mean the picture is dead; every training frame has a brightness of at least 59 and a
contrast of at least 30, so a live picture from this rig is nowhere near the limits. Dead
frames are never counted, the camera bridge stops sending heartbeats so the console says the
camera is not responding, and when the picture returns, or after a gap of 3 seconds or more in
the stream, the counter learns the empty view again (the view must be empty). The limits are
constants at the top of `presence.py`.
The logic is pure NumPy with no clock or I/O of its own (the caller passes the time), which is
what makes it unit-testable.

## 7. The camera bridge

`Model/camera_bridge.py` is the only program that touches the camera's serial port.

- Finds the board by scanning the serial ports for a USB vendor id (Arduino, Espressif native
  USB, CP210x, CH340, FTDI, in that order; `Model/camera_port.py`), or uses `--camera COM6` /
  `CAMERA_PORT`. That covers an ESP32 on its own, whether it connects over its own USB or
  through one of those adapter chips. The log says which port it found and what the system
  calls it, and, when it finds nothing, which ports it did see. `capture.py` and `live.py` scan
  the same way.
- Never opens the port at 1200 baud, because that reboots an Arduino into its bootloader.
- Decodes `FRM0` frames (4-byte magic, width, height, then pixels), runs the model, and feeds
  the counter.
- Serves the EcoSort wire contract on `127.0.0.1:7777`, so the website bridge connects to it as
  if it were a board: `HELLO`, `HB` heartbeats, `EVT` verdicts, verdict frames and preview
  frames (at most 5 per second).
- Stops its heartbeat if no camera frame has arrived for 3 seconds, so the console shows the
  camera as not responding.
- `--check` loads the model and classifies one training image. `--verbose` prints the
  scene-change value every 2 seconds, which is the number to look at when items are missed or
  empty views count as items.

Its console window says what it is doing: `calibrating`, `ready`, `item in view`,
`counted: recyclable 0.98`.

## 8. The wire contract

One byte stream carries ASCII text lines and binary frame packets. A packet starts with `0xEC`,
which never appears in ASCII, so the two cannot be confused.

**Text lines** (newline-terminated, at most 64 bytes):

| Line | Meaning |
| --- | --- |
| `EVT,<label>,<confidence>,<bin>,<latency_ms>` | One classification. Label is `recyclable`, `trash` or `uncertain`; bin is `RECYCLABLE`, `TRASH` or `NONE` |
| `HELLO,<version>` | Once per boot. A second one during a run means the device reset |
| `HB,<uptime_ms>` | Every 5 s. The only proof the device is alive between events |
| `DBG,<text>` | Debug text, ignored |

Anything else is dropped and counted. `background` is ignored and counted. `uncertain` is
stored as unsure and added to neither bin.

**Frame packet** (little-endian): magic `EC A5 F0 5A`; type (1 preview, 2 verdict); width;
height; payload length (width x height, at most 32768); 8-bit grayscale pixels, row-major;
then a CRC-16/CCITT-FALSE. A 160x120 packet is 19,215 bytes. A verdict frame is sent
immediately before its `EVT` line; the server attaches it to that event and discards it if no
`EVT` follows within 3 seconds. Preview frames flow only while a browser is watching: the
server sends `P1` when the first viewer connects and `P0` when the last leaves.

## 9. The website bridge (backend)

FastAPI with uvicorn, Pydantic models, pyserial, Pillow and SQLite.

**Pipeline.** A *source* produces bytes (real serial or TCP port, the simulator, or a replay
file). The *supervisor* feeds them through the stream parser, validates each item, looks the
bin up in the item table, writes to the *store*, and publishes to the *hub*, which fans out to
every connected browser.

**Sources** (chosen by `SOURCE` in `.env`):

| Source | Purpose |
| --- | --- |
| `serial` | A real device, or any pyserial URL such as `socket://127.0.0.1:7777`. Reconnects by itself with backoff from 1 s to 10 s. Reports a busy port instead of crashing |
| `sim` | Synthetic events and synthetic grayscale frames with dark silhouettes. Always labelled "Simulated data". It depends on no camera: switching a camera on or off changes nothing |
| `replay` | Plays back a recorded session at its original timing, looped, under a "Replay" banner |

**Storage** (SQLite, `ecosort.db`):

| Table | Columns |
| --- | --- |
| `runs` | id, started_at, ended_at, source (`serial`, `sim` or `replay`) |
| `events` | id, run_id, ts, label, confidence, bin (`recyclable`, `trash` or `unsure`), latency_ms |
| `frames` | event_id, width, height, raw pixels |

**HTTP API** (all under `/api`):

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /state` | Current counts, link state, run info |
| `GET /events` | Recent events |
| `GET /events/{id}/frame.png` | The lossless frame the model saw for that event |
| `GET /camera/stream` | MJPEG live view |
| `GET /stream` | Server-Sent Events: new events and link changes, with resume by event id |
| `POST /runs` | Start a new run (restricted to the allowed browser origin) |
| `GET /export.csv` | The run as a CSV file |

## 10. The console (frontend)

Next.js 14 (App Router), React 18, TypeScript. Typed from the server's OpenAPI schema
(`make types`).

**Main page.** The camera window (a square view of the classifier's frame, with a source
switch to a laptop webcam that the classifier does not use, and a pause control for the
picture) with the bin readout flush beneath it at the same width: two large counters,
Recyclable (green) and Trash (slate), and an amber Unsure row that is counted in neither.
Next to it: the last verdict with its confidence and frame, the item breakdown, link status,
run controls (new run, with a confirmation that explains the current run stays saved), and the
event log with thumbnails that open in a dialog. The simulator and a replay are labelled
"Simulator" and "Replay" in the link badge and "no camera in use" on the camera window, never
"Linked". Every outcome is shown
with an icon and a word as well as its colour. There is a light and a dark theme (following
the system, with a switch). An empty run, paused live updates, an unreachable service, a
camera that is not linked or not responding, and page errors each have their own message and
next step. The design is documented in `frontend/DESIGN.md`.

**Home story (`/`) and testing page (`/testing`).** Two scroll-driven 3D pages built with three.js
(loaded only on those pages, so the console is unaffected): a fixed canvas behind eight (home) or
six (testing) chapters, with a camera that flies between them. Everything in the world is made
in code (no model, texture or font download), the real words are plain HTML, and the canvas is
hidden from assistive technology. The movement can be paused and a browser set to reduce motion
starts paused; without WebGL the words are all still there. The home story's text is a draft
written from the project's own facts. The testing page shows only what `scripts/record_tests.py`
recorded in `data/testing.json`: automated checks, seven camera-off scenarios run through the real
model and counting gate, the model's score on the frames held back from training (with the
plain statement that it is optimistic), and empty frames for photographs or video of the rig
until some are added.

**Project page (`/project`).** A written explanation of the system with a flow diagram,
results, a confusion matrix, limits, wiring and credits. It reads `data/metrics.json` on every
request. Every key may be null and a null or malformed value renders "Not measured yet".
At the moment `data/metrics.json` has every key set to null, so those sections show
"Not measured yet" until real figures are entered.

**Quality bar.** WCAG 2.2 AA is checked automatically with axe, colour contrast is checked by
`scripts/check_contrast.py` for both themes, the layout is tested at 1280, 1024, 768, 390 and
320 pixels with no horizontal scrolling, keyboard use is tested (a skip link, dialogs that
keep focus and give it back), and a test confirms that no page requests anything outside the
machine.

## 11. Other boards

**An ESP32 as the camera board.** `firmware/ecosort_esp32_camera/` streams `FRM0` frames from an
ESP32 with a camera driver supported by `esp32-camera`, so an ESP32 alone can replace the
Arduino. The camera bridge needs no change: it reads those frames and scans for the board like
any other. It is written for the Arduino Nano ESP32 with an OV7670/OV7675 module (pin table in
the guide) and the AI-Thinker ESP32-CAM. It compiles for the Nano ESP32; it has not been flashed
or run with a camera. The model was trained on OV7675 frames, so accuracy with another sensor is
unmeasured. Guide: `firmware/ESP32_CAMERA.md`.

**Optional: classify on the board instead of the laptop.**

The original design ran the model on an Arduino Nano 33 BLE Sense Lite (with an infrared
sensor as the trigger) and used the laptop only as a listener. That path is still supported.
`firmware/ecosort_io/ecosort_io.h` implements the entire wire contract in one header: a single
output function so nothing interleaves, `HELLO` / `HB` / `EVT` / `DBG` lines, frame packets
streamed in 64-byte chunks from the existing image buffer, a non-blocking reader for the
`P1` / `P0` commands, and an Edge Impulse `ei_printf` override that turns SDK text into `DBG`
lines. `firmware/INTEGRATION.md` shows the exact diff for an Edge Impulse
`nano_ble33_sense_camera` sketch. An ESP32 can optionally receive a text copy of the `EVT`
lines on the Nano's `Serial1` for a separate wireless dashboard; the console does not need it.

The firmware's bin table (`bin_for` in the header) uses the same two labels as the website:
`recyclable` gives `RECYCLABLE`, `trash` gives `TRASH`.

## 12. Running it

### With the camera (one click)

```bat
run_all.bat          start everything (stop_all.bat stops it)
run_all.bat prod     the same, with the console as a production build
run_all.bat check    only verify that everything is ready
```

1. Plug the camera board in with a **data** USB cable (a charge-only cable carries no data).
2. Close the Arduino Serial Monitor and `live.py`: only one program can hold the port.
3. Keep the camera view **empty**, then run `run_all.bat`.

The first run creates the Python environment (`.venv`) and installs the Python and website
packages. Three windows open (camera bridge, website bridge, console) and the browser opens
`http://localhost:3000/console`. The script checks that ports 3000, 7777 and 8000 are free and says
what is wrong if anything is missing (Python, Node, the model file, a busy port).

Put an item in front of the camera: its bin's count goes up by one. Take it away before the
next item.

### Without hardware

```sh
cp .env.example .env
make setup        # Python venv, npm packages, Playwright's Chromium
make sim          # bridge on :8000 and console on :3000, simulated data
```

To exercise the real camera path without a board, run `python scripts/fake_camera.py` (it
streams scripted frames from `Model/dataset`) and start the camera bridge with
`--camera socket://127.0.0.1:7778`. `make fake-nano` and `make bench` do the same for the
board-side protocol, including corrupt frames, bad lines, resets and stalls.

Open the console at `localhost`, not `127.0.0.1`: the server accepts the console's origin from
`CORS_ORIGIN`, and the webcam needs a secure origin.

### Configuration (`.env` at the repo root)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOURCE` | `sim` | `serial`, `sim` or `replay` |
| `SERIAL_PORT` | blank | Blank auto-detects; also accepts a pyserial URL |
| `BAUD` | `115200` | Never 1200 |
| `DB_PATH` | `./ecosort.db` | SQLite file for runs, events and frames |
| `CORS_ORIGIN` | `http://localhost:3000` | The console's origin |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | Where the console finds the server |
| `REPLAY_FILE` | `data/sample_session.rec` | Capture used by `SOURCE=replay` |
| `NEXT_TELEMETRY_DISABLED` | `1` | Keeps Next.js from reporting anything |

`run_all.bat` overrides `SOURCE` and `SERIAL_PORT` so the website bridge reads the camera
bridge at `socket://127.0.0.1:7777`. Optional `CAMERA_PORT`, `CAMERA_BAUD` and
`ECOSORT_NO_BROWSER` settings sit at the top of the script.

### Recording and replaying a real session

`make record` (or `python scripts/record.py --seconds 300 --preview`) captures what a real
device sends. Set `SOURCE=replay` to play it back looped under a "Replay" banner. The
repository ships `data/sample_session.rec` empty until a real session is recorded.

## 13. Testing and checks

| Command | What it covers |
| --- | --- |
| `make test` | Backend pytest (parser fuzzing, framing, store, hub, supervisor, sources, routes, the camera bridge and counter, the firmware contract) and frontend Vitest (reducer, formatting, metrics parsing) |
| `make e2e` | A production build, then Playwright: smoke tests against the simulator, axe accessibility, responsive layout, offline behaviour |
| `make lint` | ruff (check and format), the WCAG contrast check, ESLint, Prettier, `tsc --noEmit` |
| `python Model/camera_bridge.py --check` | The model loads and classifies a sample image |
| `run_all.bat check` | Everything the launcher needs is present and the ports are free |

State when this file was written: the backend suite had 299 tests passing and 3 skipped, the
30 frontend unit tests passed, and all 16 Playwright browser tests passed against the
simulator on a fresh production build. `ruff`, ESLint and `tsc` reported no problems, and
`run_all.bat check` reported everything ready. The 3 skipped tests are the firmware contract
tests, which compile `ecosort_io.h` with g++ and skip when no C++ compiler is on `PATH`; the
firmware host test (`firmware/test/host_test.cpp`) was therefore not run on this machine. The
camera path has not been run end to end against a physical board in this session.

On Windows with `core.autocrlf=true`, files are checked out with CRLF and `prettier --check`
reports many files; that is line-ending noise, and `prettier --check --end-of-line auto .`
passes.

## 14. Technology summary

| Area | Technology |
| --- | --- |
| Camera | OV7675 on an Arduino, or an ESP32 camera board (untested on hardware), grayscale 160x120 over USB serial at 921600 baud |
| Model training | Python, PyTorch, torchvision, scikit-learn, matplotlib, OpenCV (capture) |
| Model inference | NumPy only (`numpy_cnn.py`), Pillow, pyserial, asyncio |
| Website bridge | FastAPI, uvicorn, Pydantic, SQLite, Server-Sent Events, MJPEG |
| Console | Next.js 14, React 18, TypeScript, CSS modules with design tokens |
| Tests | pytest, Vitest, Playwright with axe-core |
| Tooling | ruff, ESLint, Prettier, GNU make, Windows batch launcher |
| Optional board path | Arduino Nano 33 BLE Sense Lite, Edge Impulse, optional ESP32 mirror |

## 15. Known limits

- **Two answers only.** The model cannot say "this is something new". Anything unfamiliar is
  forced into one class, or reported as unsure when the confidence is low.
- **Small dataset.** 269 frames from one camera setup. The 100% validation figure is
  optimistic; a different bin, light or angle may do worse.
- **Low resolution.** Frames are 160x120 grayscale, so thin or small objects are only a few
  pixels wide, and glass is hard because a clear bottle is mostly reflections and background.
- **Counting rules.** Counting assumes the view is empty when the camera bridge starts and
  empty between items. Two items placed one straight after the other count as one. The trigger
  thresholds adapt to the camera's noise but have not been tuned on real footage.
- **Latency.** The reported time is the model's inference time for one frame, not the time
  from an object arriving to its count changing on screen.
- **No video.** The console shows the 160x120 grayscale frame the model reads, not
  full-resolution video.
- **Not a trainer.** The website does not train models; `Model/train.py` does.
- **Results page.** `data/metrics.json` is empty, so the Results page shows "Not measured yet"
  until measured values are entered.

## 16. Glossary

- **Bridge.** A program that sits between two things and translates. The *camera bridge*
  connects the camera to the model and the wire contract; the *website bridge* connects the
  wire contract to the database and the browser.
- **Wire contract.** The agreed text lines and binary packets described in section 8.
- **Verdict.** One classification result for one item: label, confidence, bin, latency and the
  frame the model saw.
- **Run.** One counting session. Starting a new run resets the counts on screen; the old run
  stays saved on the computer.
- **SSE.** Server-Sent Events: a one-way stream from server to browser, used for numbers.
- **MJPEG.** A stream of JPEG images, used for the live camera view.
