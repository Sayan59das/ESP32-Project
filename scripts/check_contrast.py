"""Check WCAG 2.x contrast for every text/background pairing the console uses, in both themes.

Reads the colour tokens from frontend/styles/tokens.css, so a changed hex is re-checked
without touching this file. Light is the first `:root` block. Dark is light with the
`:root[data-theme='dark']` block on top; the `prefers-color-scheme: dark` block must hold
exactly the same values, and the check fails if they drift apart. Exits non-zero when any
pairing falls below its threshold in either theme:

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
THEMES = ("light", "dark")

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
    # Running text on the neutrals
    Pairing("ink", "ground", TEXT, "body text, page headings"),
    Pairing("ink", "surface", TEXT, "panels, header, tables, dialogs, secondary buttons"),
    Pairing("ink", "surface-sunk", TEXT, "table headers, insets"),
    Pairing("ink-muted", "ground", TEXT, "notes under panels"),
    Pairing("ink-muted", "surface", TEXT, "secondary text, captions, empty states"),
    Pairing("ink-muted", "surface-sunk", TEXT, "table header labels"),
    Pairing("ink", "signal-tint", TEXT, "confusion matrix cells at full shading"),
    Pairing("surface", "ink", TEXT, "primary buttons, the simulated and replay badge"),
    Pairing("ground", "ink", TEXT, "inverted labels on ink"),
    Pairing("surface", "ink-muted", TEXT, "primary button on hover"),
    # The bin counters and their labels
    Pairing("on-fill", "recyclable", TEXT, "Recyclable tile title and share line"),
    Pairing("on-fill", "recyclable", LARGE_TEXT, "Recyclable counter numeral"),
    Pairing("on-fill", "trash", TEXT, "Trash tile title and share line"),
    Pairing("on-fill", "trash", LARGE_TEXT, "Trash counter numeral"),
    Pairing("on-unsure", "unsure", TEXT, "Unsure tally and badges on the amber fill"),
    # Outcome chips, rows and labels
    Pairing("recyclable-ink", "recyclable-tint", TEXT, "Recyclable badge"),
    Pairing("recyclable-ink", "surface", TEXT, "Recyclable label in the log and breakdown"),
    Pairing("trash-ink", "trash-tint", TEXT, "Trash badge"),
    Pairing("trash-ink", "surface", TEXT, "Trash label in the log and breakdown"),
    Pairing("unsure-ink", "unsure-tint", TEXT, "Unsure badge"),
    Pairing("unsure-ink", "surface", TEXT, "Unsure label in the log and breakdown"),
    Pairing("signal-ink", "signal-tint", TEXT, "Live and linked badges"),
    Pairing("signal-ink", "surface", TEXT, "link status sentence"),
    Pairing("alert-ink", "alert-tint", TEXT, "fault notices and badges"),
    Pairing("alert-ink", "surface", TEXT, "fault text in panels"),
    # The camera window, dark in both themes
    Pairing("on-video", "video-bed", TEXT, "camera window title, state chip, messages"),
    Pairing("on-video-muted", "video-bed", TEXT, "camera window note, toggle border"),
    Pairing("video-bed", "on-video", TEXT, "the chosen image source"),
    # Graphics: bars, icons, lamps, borders, focus
    Pairing("recyclable-mark", "surface", GRAPHIC, "recyclable bars, icons and confidence bar"),
    Pairing("trash-mark", "surface", GRAPHIC, "trash bars, icons and confidence bar"),
    Pairing("unsure-mark", "surface", GRAPHIC, "unsure bars, icons and confidence bar"),
    Pairing("signal", "surface", GRAPHIC, "link lamp when linked"),
    Pairing("alert", "surface", GRAPHIC, "link lamp on a fault, alert icons"),
    Pairing("line-strong", "surface", GRAPHIC, "button and control borders on panels"),
    Pairing("line-strong", "ground", GRAPHIC, "button and control borders on the page"),
    Pairing("focus", "ground", GRAPHIC, "focus ring against the page"),
    Pairing("focus", "surface", GRAPHIC, "focus ring against panels"),
    Pairing("focus-on-video", "video-bed", GRAPHIC, "focus ring inside the camera window"),
    Pairing("alert-on-video", "video-bed", GRAPHIC, "fault icon inside the camera window"),
)


def _blocks(css: str) -> dict[str, str]:
    """The three token blocks: light `:root`, the system dark block, the chosen dark block."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    light = re.search(r"(?m)^:root\s*\{(.*?)^\}", css, flags=re.DOTALL)
    system_dark = re.search(
        r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)"
        r"\s*\{(.*?)\}",
        css,
        flags=re.DOTALL,
    )
    chosen_dark = re.search(r":root\[data-theme='dark'\]\s*\{(.*?)\}", css, flags=re.DOTALL)
    found = {"light": light, "system-dark": system_dark, "chosen-dark": chosen_dark}
    missing = [name for name, match in found.items() if match is None]
    if missing:
        raise ValueError(f"tokens.css is missing the {missing} block(s)")
    return {name: match.group(1) for name, match in found.items()}  # type: ignore[union-attr]


def _hex_tokens(block: str) -> dict[str, str]:
    """Colour tokens only: custom properties whose value is a plain #rrggbb."""
    pairs = re.findall(r"--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", block)
    return {name: value.lower() for name, value in pairs}


def load_themes(path: Path = TOKENS_CSS) -> dict[str, dict[str, str]]:
    blocks = _blocks(path.read_text(encoding="utf-8"))
    light = _hex_tokens(blocks["light"])
    return {"light": light, "dark": {**light, **_hex_tokens(blocks["chosen-dark"])}}


def dark_blocks_differ(path: Path = TOKENS_CSS) -> dict[str, tuple[str | None, str | None]]:
    """Tokens whose value differs between the system dark block and the chosen dark block."""
    blocks = _blocks(path.read_text(encoding="utf-8"))
    system = _hex_tokens(blocks["system-dark"])
    chosen = _hex_tokens(blocks["chosen-dark"])
    return {
        name: (system.get(name), chosen.get(name))
        for name in sorted(set(system) | set(chosen))
        if system.get(name) != chosen.get(name)
    }


def load_tokens(path: Path = TOKENS_CSS, theme: str = "light") -> dict[str, str]:
    return load_themes(path)[theme]


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
    theme: str = "light"

    @property
    def passed(self) -> bool:
        return self.ratio >= self.pairing.minimum


def evaluate(tokens: dict[str, str] | None = None, theme: str = "light") -> list[Result]:
    tokens = tokens if tokens is not None else load_tokens(theme=theme)
    results = []
    for pairing in PAIRINGS:
        names = re.findall(r"[a-z][a-z0-9-]*", f"{pairing.foreground} {pairing.background}")
        missing = [name for name in names if name not in tokens and not name.isdigit()]
        if missing:
            raise KeyError(f"tokens.css has no colour token(s) {missing} for {pairing}")
        foreground = _resolve(pairing.foreground, tokens)
        background = _resolve(pairing.background, tokens)
        ratio = contrast_ratio(foreground, background)
        results.append(Result(pairing, ratio, theme))
    return results


def main() -> int:
    failed = 0
    total = 0
    for theme in THEMES:
        results = evaluate(theme=theme)
        width = max(len(f"{r.pairing.foreground} on {r.pairing.background}") for r in results)
        print(f"{theme} theme")
        for result in results:
            pairing = result.pairing
            label = f"{pairing.foreground} on {pairing.background}"
            status = "ok  " if result.passed else "FAIL"
            failed += not result.passed
            print(
                f"  {status} {label:<{width}}  {result.ratio:5.2f} : 1  "
                f"(needs {pairing.minimum}) {pairing.used_for}"
            )
        total += len(results)
        print()
    drift = dark_blocks_differ()
    for name, (system, chosen) in drift.items():
        print(f"FAIL --{name}: system dark block {system}, chosen dark block {chosen}")
    print(f"{total - failed} of {total} pairings pass across {len(THEMES)} themes")
    if drift:
        print(f"{len(drift)} token(s) differ between the two dark blocks")
    return 1 if failed or drift else 0


if __name__ == "__main__":
    sys.exit(main())
