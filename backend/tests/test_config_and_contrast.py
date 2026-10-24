import importlib.util
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.classes import ITEMS, expected_firmware_bin, item_for, stored_bin
from app.config import REPO_ROOT, Settings

_spec = importlib.util.spec_from_file_location(
    "check_contrast", REPO_ROOT / "scripts" / "check_contrast.py"
)
assert _spec is not None
assert _spec.loader is not None
check_contrast = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_contrast)


class TestSettings:
    def test_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for name in ("SOURCE", "SERIAL_PORT", "BAUD", "DB_PATH", "CORS_ORIGIN"):
            monkeypatch.delenv(name, raising=False)
        settings = Settings(_env_file=None)
        assert (settings.source, settings.baud, settings.cors_origin) == (
            "sim",
            115200,
            "http://localhost:3000",
        )
        assert settings.serial_port is None

    def test_a_blank_serial_port_means_auto_detect(self) -> None:
        assert Settings(_env_file=None, serial_port="").serial_port is None
        assert Settings(_env_file=None, serial_port="  ").serial_port is None
        assert Settings(_env_file=None, serial_port="COM5").serial_port == "COM5"

    def test_1200_baud_is_refused_because_it_reboots_the_nano(self) -> None:
        with pytest.raises(ValidationError, match="bootloader"):
            Settings(_env_file=None, baud=1200)

    @pytest.mark.parametrize("baud", [0, -9600])
    def test_nonsense_baud_is_refused(self, baud: int) -> None:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, baud=baud)

    def test_unknown_source_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, source="webcam")  # type: ignore[arg-type]

    def test_the_default_replay_file_is_in_the_repo_data_folder(self) -> None:
        assert Settings(_env_file=None).replay_file == REPO_ROOT / "data" / "sample_session.rec"


class TestClasses:
    def test_the_item_to_bin_table(self) -> None:
        assert {item.label: item.bin for item in ITEMS} == {
            "recyclable": "recyclable",
            "trash": "trash",
        }

    def test_stored_bins(self) -> None:
        assert stored_bin("recyclable") == "recyclable"
        assert stored_bin("trash") == "trash"
        assert stored_bin("uncertain") == "unsure"
        assert stored_bin("background") is None
        assert stored_bin("unicorn") is None

    def test_expected_firmware_bin_is_none_for_everything_unsorted(self) -> None:
        assert expected_firmware_bin("recyclable") == "RECYCLABLE"
        assert expected_firmware_bin("trash") == "TRASH"
        assert expected_firmware_bin("uncertain") == "NONE"
        assert expected_firmware_bin("background") == "NONE"

    def test_item_for_unknown_labels(self) -> None:
        assert item_for("trash") is not None
        assert item_for("uncertain") is None


class TestContrastScript:
    def test_black_on_white_is_21_to_1(self) -> None:
        assert check_contrast.contrast_ratio("#000000", "#ffffff") == pytest.approx(21.0)

    def test_same_colour_is_1_to_1(self) -> None:
        assert check_contrast.contrast_ratio("#336699", "#336699") == pytest.approx(1.0)

    def test_every_pairing_the_console_uses_passes(self) -> None:
        failures = [r for r in check_contrast.evaluate() if not r.passed]
        assert not failures, [
            (r.pairing.foreground, r.pairing.background, round(r.ratio, 2)) for r in failures
        ]

    def test_ink_muted_clears_4_5_on_the_ground_as_the_plan_requires(self) -> None:
        ratio = check_contrast.contrast_ratio(
            check_contrast.load_tokens()["ink-muted"], check_contrast.load_tokens()["ground"]
        )
        assert ratio >= 4.5

    def test_a_weak_pairing_is_reported_as_a_failure(self) -> None:
        tokens = {**check_contrast.load_tokens(), "ink-muted": "#aab4b8"}
        failed = [r for r in check_contrast.evaluate(tokens) if not r.passed]
        assert any(r.pairing.foreground == "ink-muted" for r in failed)

    def test_an_unknown_token_is_an_error_not_a_silent_pass(self) -> None:
        tokens = check_contrast.load_tokens()
        del tokens["hivis"]
        with pytest.raises(KeyError):
            check_contrast.evaluate(tokens)

    def test_tokens_are_read_from_the_css_file(self) -> None:
        tokens = check_contrast.load_tokens()
        assert tokens["bin-blue"] == "#0b5cad"
        assert tokens["hivis"] == "#f2c100"
        assert {
            "ground",
            "surface",
            "ink",
            "ink-muted",
            "bin-blue",
            "bin-charcoal",
            "hivis",
            "video-bed",
        } <= set(tokens)

    def test_the_script_runs_and_exits_zero(self) -> None:
        assert check_contrast.main() == 0
        assert Path(check_contrast.TOKENS_CSS).exists()
