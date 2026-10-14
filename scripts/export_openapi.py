"""Write the bridge's OpenAPI schema to a file, for openapi-typescript (`make types`).

Usage: python scripts/export_openapi.py frontend/lib/openapi.json
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.main import create_app  # noqa: E402  (importable only after the path insert)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: export_openapi.py OUTPUT_PATH")
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    schema = create_app().openapi()  # builds the schema only; the lifespan never starts
    out.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
