from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # Later files win, so a repo-root .env overrides a backend/.env.
    model_config = SettingsConfigDict(env_file=("backend/.env", ".env"), extra="ignore")

    source: Literal["serial", "sim", "replay"] = "sim"
    serial_port: str | None = None
    baud: int = 115200
    db_path: str = "./ecosort.db"
    cors_origin: str = "http://localhost:3000"
    replay_file: Path = REPO_ROOT / "data" / "sample_session.rec"

    @field_validator("serial_port", mode="before")
    @classmethod
    def _blank_port_means_auto_detect(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("baud")
    @classmethod
    def _never_1200(cls, value: int) -> int:
        if value == 1200:
            raise ValueError("BAUD=1200 reboots an Arduino into its bootloader; use 115200")
        if value <= 0:
            raise ValueError("BAUD must be positive")
        return value
