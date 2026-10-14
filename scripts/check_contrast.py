"""Check WCAG 2.x contrast for every text/background pairing the console uses.

Reads the colour tokens from frontend/styles/tokens.css, so a changed hex is re-checked
without touching this file. Exits non-zero when any pairing falls below its threshold:

    text under 24px          4.5 : 1
    text 24px and up         3.0 : 1   (the counter numerals)
    graphics and focus ring  3.0 : 1

When a component starts using a new text/background pairing, add it to PAIRINGS.
Run:  python scripts/check_contrast.py
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

TOKENS_CSS = Path(__file__).resolve().parents[1] / "frontend" / "styles" / "tokens.css"

TEXT = 4.5
LARGE_TEXT = 3.0
GRAPHIC = 3.0


@dataclass(frozen=True)
class Pairing:
    foreground: str  # token name, without the leading --
    background: str  # token name, or "fg@NN%/bg" for a translucent fill over a token
    minimum: float
    used_for: str


# Every pairing the design uses. Keep this in step with the components.
PAIRINGS: tuple[Pairing, ...] = (
    Pairing("ink", "ground", TEXT, "body text, secondary buttons, unsure band, Export CSV"),
    Pairing("ink", "surface", TEXT, "header, panels, tables, camera tag, selected source option"),
    Pairing("ink-muted", "ground", TEXT, "the line under the bin readout"),
    Pairing("ink-muted", "surface", TEXT, "table headers, empty states, dimmed unsure rows"),
    Pairing("ground", "ink", TEXT, "simulated banner, primary buttons, link details"),
    Pairing("ground", "ink-muted", TEXT, "primary button on hover"),
    Pairing("white", "bin-blue", TEXT, "Recyclable title, share line, band, verdict strip"),
    Pairing("white", "bin-blue", LARGE_TEXT, "Recyclable counter numeral"),
    Pairing("white", "bin-charcoal", TEXT, "Trash title, share line, band, verdict strip"),
    Pairing("hivis", "bin-charcoal", LARGE_TEXT, "Trash counter numeral"),
    Pairing("surface", "video-bed", TEXT, "camera window title, note and state messages"),
    Pairing("ink", "hivis@35%/surface", TEXT, "log row text at the peak of the new-row highlight"),
    Pairing("ink", "ground", GRAPHIC, "focus ring against the page"),
    Pairing("ink", "surface", GRAPHIC, "focus ring against panels, the link lamp"),
    Pairing("hivis", "video-bed", GRAPHIC, "focus ring offset on the dark camera header"),
    Pairing("white", "bin-charcoal", GRAPHIC, "true-ratio mark over the trash bin"),
    Pairing("white", "bin-blue", GRAPHIC, "true-ratio mark over the recyclable bin"),
)


def load_tokens(path: Path = TOKENS_CSS) -> dict[str, str]:
    """Colour tokens only: custom properties whose value is a plain #rrggbb."""
    css = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.DOTALL)
    pairs = re.findall(r"--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", css)
    return {name: value.lower() for name, value in pairs}


def _rgb(hex_colour: str) -> tuple[float, float, float]:
    return tuple(int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5))  # type: ignore[return-value]


def _blend(
    fg: tuple[float, float, float], alpha: float, bg: tuple[float, float, float]
) -> tuple[float, float, float]:
    return tuple(alpha * f + (1 - alpha) * b for f, b in zip(fg, bg, strict=True))  # type: ignore[return-value]


def _luminance(rgb: tuple[float, float, float]) -> float:
    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(
    fg: tuple[float, float, float] | str, bg: tuple[float, float, float] | str
) -> float:
    fg_rgb = _rgb(fg) if isinstance(fg, str) else fg
    bg_rgb = _rgb(bg) if isinstance(bg, str) else bg
    lighter, darker = sorted((_luminance(fg_rgb), _luminance(bg_rgb)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def _resolve(spec: str, tokens: dict[str, str]) -> tuple[float, float, float]:
    translucent = re.fullmatch(r"([a-z0-9-]+)@(\d+)%/([a-z0-9-]+)", spec)
    if translucent:
        top, percent, under = translucent.groups()
        return _blend(_rgb(tokens[top]), int(percent) / 100, _rgb(tokens[under]))
    return _rgb(tokens[spec])


@dataclass(frozen=True)
class Result:
    pairing: Pairing
    ratio: float

    @property
    def passed(self) -> bool:
        return self.ratio >= self.pairing.minimum


def evaluate(tokens: dict[str, str] | None = None) -> list[Result]:
    tokens = tokens if tokens is not None else load_tokens()
    results = []
    for pairing in PAIRINGS:
        names = re.findall(r"[a-z][a-z0-9-]*", f"{pairing.foreground} {pairing.background}")
        missing = [name for name in names if name not in tokens and not name.isdigit()]
        if missing:
            raise KeyError(f"tokens.css has no colour token(s) {missing} for {pairing}")
        foreground = _resolve(pairing.foreground, tokens)
        background = _resolve(pairing.background, tokens)
        ratio = contrast_ratio(foreground, background)
        results.append(Result(pairing, ratio))
    return results


def main() -> int:
    results = evaluate()
    width = max(len(f"{r.pairing.foreground} on {r.pairing.background}") for r in results)
    failed = 0
    for result in results:
        pairing = result.pairing
        label = f"{pairing.foreground} on {pairing.background}"
        status = "ok  " if result.passed else "FAIL"
        failed += not result.passed
        print(
            f"{status} {label:<{width}}  {result.ratio:5.2f} : 1  "
            f"(needs {pairing.minimum}) {pairing.used_for}"
        )
    print(f"\n{len(results) - failed} of {len(results)} pairings pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
