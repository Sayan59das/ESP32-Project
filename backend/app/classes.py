"""The one item -> bin table. Nothing else on the server decides which bin an item goes in."""

from dataclasses import dataclass
from typing import Literal

BinName = Literal["recyclable", "trash"]
StoredBin = Literal["recyclable", "trash", "unsure"]

UNCERTAIN = "uncertain"
BACKGROUND = "background"


@dataclass(frozen=True, slots=True)
class Item:
    label: str
    display_name: str
    bin: BinName


ITEMS: tuple[Item, ...] = (
    Item("can", "Can", "recyclable"),
    Item("glass_bottle", "Glass bottle", "recyclable"),
    Item("pen", "Pen", "trash"),
    Item("phone_case", "Phone case", "trash"),
)

# Every label the firmware may legitimately send. "background" is accepted by the
# parser only so the bridge can count and ignore it.
ALL_LABELS: tuple[str, ...] = (*(item.label for item in ITEMS), UNCERTAIN, BACKGROUND)

_BY_LABEL = {item.label: item for item in ITEMS}

_FIRMWARE_BIN: dict[str, str] = {"recyclable": "RECYCLABLE", "trash": "TRASH"}


def item_for(label: str) -> Item | None:
    return _BY_LABEL.get(label)


def stored_bin(label: str) -> StoredBin | None:
    """Bin the server stores for a label. None for labels that are never stored."""
    if label == UNCERTAIN:
        return "unsure"
    item = _BY_LABEL.get(label)
    return item.bin if item else None


def expected_firmware_bin(label: str) -> str:
    """What the firmware should have printed in the bin field for this label."""
    item = _BY_LABEL.get(label)
    return _FIRMWARE_BIN[item.bin] if item else "NONE"
