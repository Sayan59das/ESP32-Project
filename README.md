# EcoSort Edge

EcoSort Edge is a TinyML waste classifier. An Arduino Nano 33 BLE Sense Lite with an
OV7675 camera classifies each object on the microcontroller itself, as a can, a glass
bottle, a pen or a phone case, and a lookup table puts it in the recyclable or the trash
bin. The Nano reports each verdict, and the frame it classified, over USB serial. This
repository holds the bridge that reads that stream and the operator console that shows
what the classifier sees, with the running totals of recyclable and trash items directly
beneath it.

```
IR sensor -> Nano (capture + inference)
    -> USB serial: text lines and binary frame packets, one stream
    -> bridge (FastAPI): parse, validate, store in SQLite, count
    -> SSE (numbers) + MJPEG (live 96x96 frames)
    -> console (Next.js) in the browser
```

The bridge owns the truth: it recomputes every bin from its own table, keeps every event
and frame, and computes every count. The browser never adds to a counter.

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
| `EVT,<label>,<confidence>,<bin>,<latency_ms>` | One classification. Label `can`, `glass_bottle`, `pen`, `phone_case` or `uncertain`; confidence `0.00` to `1.00`; bin `RECYCLABLE`, `TRASH` or `NONE`; latency is inference time on the Nano |
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
| 5 | 2 | Width (96) |
| 7 | 2 | Height (96) |
| 9 | 4 | Payload length, width times height, at most 16384 |
| 13 | N | 8-bit grayscale pixels, row-major |
| 13+N | 2 | CRC-16/CCITT-FALSE over bytes 4 to 13+N-1 |

A 96x96 packet is 9231 bytes. The verdict frame comes immediately before its EVT line; the
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
| `test_images_per_class` | `{"can": 40, "glass_bottle": 38, "pen": 41, "phone_case": 40}` |
| `test_accuracy_per_class` | Same keys, fractions from 0 to 1 |
| `overall_test_accuracy` | Fraction from 0 to 1 |
| `latency_ms_p50`, `latency_ms_p95` | Milliseconds, inference on the Nano |
| `ram_kb_peak`, `flash_kb` | Kilobytes |
| `model_input`, `model_architecture`, `dataset_notes` | Text |
| `confusion_matrix` | `{"labels": ["can", ...], "rows": [[...], ...]}`, rows are the true item |
| `ir_sensor` | Text: the sensor's model |
| `wiring` | `[{"from": "IR sensor OUT", "to": "Nano D2", "note": "..."}]` |
| `datasets`, `credits` | `[{"name": "...", "licence": "...", "url": "..."}]` |

## Tests

```sh
make test     # 274 backend tests, including parser fuzzing and a firmware contract test
make e2e      # 16 browser tests against the simulator
make lint
```

`backend/tests/test_firmware_contract.py` compiles `firmware/ecosort_io.h` on the host with
g++ against a fake `Serial` and decodes its output with the bridge's own parser, so the
firmware and the bridge are checked against each other (skipped when no C++ compiler is on
PATH). The browser tests check the camera window is square, the bin readout sits flush
under it at the same width, the counts on screen match the API, the frame dialog shows the
96x96 frame, nothing scrolls sideways at 1280, 1024, 768 or 390 pixels, axe finds no WCAG
2.2 AA violations, and no page requests anything outside the machine.

Measured on this build: Lighthouse accessibility 100 on `/` and 100 on `/project`.

## What this does not do

- It does not stream full-resolution video, only the 96 by 96 grayscale frame the model
  sees.
- It does not train models.
- Counts assume the firmware's IR debounce holds: one object, one trigger.
- Inference time is measured on the Nano for the classifier alone; it is not the time from
  an object arriving to its count changing on screen.

## Layout

```
backend/app/        FastAPI bridge: protocol parser, frames, store, hub, sources, routes
backend/tests/      pytest suite
frontend/           Next.js console: app/, components/, lib/, styles/, e2e/
firmware/           ecosort_io.h for the Nano, its integration guide and host test
scripts/            check_contrast.py, export_openapi.py, fake_nano.py, record.py
data/               metrics.json for /project, sample_session.rec for replay
```
