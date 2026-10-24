# Shared model definition and constants for train.py and live.py.

import torch.nn as nn

# Order matters: it is the label order used everywhere.
#   recyclable      <- can, wrapper
#   non_recyclable  <- phone case
CLASSES = ["recyclable", "non_recyclable"]
IMG_W = 160
IMG_H = 120

# Dataset normalization (grayscale, single channel)
MEAN = 0.5
STD = 0.25


def _block(cin, cout):
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class SmallCNN(nn.Module):
    """Small CNN for 1x120x160 grayscale input. ~0.4M params -- trains in a
    couple of minutes on an RTX 4050 and stays well inside 6 GB."""

    def __init__(self, num_classes=len(CLASSES)):
        super().__init__()
        self.features = nn.Sequential(
            _block(1, 16),    # 120x160 -> 60x80
            _block(16, 32),   # -> 30x40
            _block(32, 64),   # -> 15x20
            _block(64, 128),  # -> 7x10
        )
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.pool(x)
        return self.head(x)
