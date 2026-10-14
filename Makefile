# EcoSort Edge. Run every target from the repo root.
# Needs GNU make. On Windows: `winget install ezwinports.make`, or MSYS2's mingw32-make.

ifeq ($(OS),Windows_NT)
  PY := "backend/.venv/Scripts/python.exe"
  BOOTSTRAP_PY := python
else
  PY := "backend/.venv/bin/python"
  BOOTSTRAP_PY := python3
endif

# The console must work offline and report nothing: no Next.js telemetry.
export NEXT_TELEMETRY_DISABLED := 1

UVICORN := $(PY) -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000
FAKE_NANO_PORT := 7777

.PHONY: setup dev dev-bridge dev-console sim test e2e lint format types build start \
	fake-nano bench record

# Backend virtualenv, frontend packages, and the browser for the smoke test.
setup:
	$(BOOTSTRAP_PY) -m venv backend/.venv
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd frontend && npm install && npx playwright install chromium

# The bridge (source from .env) and the console, together. Ctrl+C stops both.
dev:
	$(MAKE) -j2 dev-bridge dev-console

dev-bridge:
	$(UVICORN)

dev-console:
	cd frontend && npm run dev

# The bridge and the console on the simulator, whatever .env says.
sim: export SOURCE = sim
sim: dev

test:
	$(PY) -m pytest -c backend/pyproject.toml --rootdir backend backend/tests
	cd frontend && npm test

# Browser smoke test against the simulator, on a production build.
e2e: build
	cd frontend && npx playwright test

lint:
	$(PY) -m ruff check backend scripts
	$(PY) -m ruff format --check backend scripts
	$(PY) scripts/check_contrast.py
	cd frontend && npm run lint && npm run typecheck

format:
	$(PY) -m ruff check --fix backend scripts
	$(PY) -m ruff format backend scripts
	cd frontend && npm run format

# OpenAPI schema from FastAPI, then TypeScript types from it.
types:
	$(PY) scripts/export_openapi.py frontend/lib/openapi.json
	cd frontend && npm run types

build:
	cd frontend && npm run build

# The production console on :3000 (run the bridge alongside with make dev-bridge).
start:
	cd frontend && npm run start

# Bench test without hardware: a fake Nano on a TCP port, and the bridge reading it as a
# serial port. The bench writes to its own database so it never mixes with real runs.
fake-nano:
	$(PY) scripts/fake_nano.py --tcp $(FAKE_NANO_PORT) --faults

bench: export SOURCE = serial
bench: export SERIAL_PORT = socket://127.0.0.1:$(FAKE_NANO_PORT)
bench: export DB_PATH = ./bench.db
bench: dev

# Capture a real Nano session for SOURCE=replay. Stop the bridge first.
record:
	$(PY) scripts/record.py --preview --seconds 120
