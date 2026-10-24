# Torch-free inference for SmallCNN (model.py), so the website bridge can run waste_cnn.pt on
# machines where PyTorch cannot be installed or loaded (e.g. Windows Application Control
# blocking torch_python.dll). Needs only numpy.
#
#   net = NumpyCNN.from_checkpoint("waste_cnn.pt")
#   probs = net.predict(frame)          # frame: (120, 160) uint8 -> softmax over net.classes
#
# The checkpoint is read with a restricted unpickler: only the handful of globals a torch
# state dict needs are allowed, so a tampered file cannot run code.

from __future__ import annotations

import pickle
import zipfile
from collections import OrderedDict
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

BN_EPS = 1e-5  # torch.nn.BatchNorm2d default; model.py does not change it


class _Storage:
    """Stand-in for torch.FloatStorage / torch.LongStorage while unpickling."""

    dtype: np.dtype

    def __init__(self, data: np.ndarray) -> None:
        self.data = data


class _FloatStorage(_Storage):
    dtype = np.dtype("<f4")


class _LongStorage(_Storage):
    dtype = np.dtype("<i8")


def _rebuild_tensor_v2(storage, offset, size, stride, requires_grad, hooks, metadata=None):
    itemsize = storage.data.itemsize
    view = np.lib.stride_tricks.as_strided(
        storage.data[offset:],
        shape=tuple(size),
        strides=tuple(s * itemsize for s in stride),
    )
    return np.array(view)  # own the memory; the zip buffer goes away


_ALLOWED = {
    ("collections", "OrderedDict"): OrderedDict,
    ("torch", "FloatStorage"): _FloatStorage,
    ("torch", "LongStorage"): _LongStorage,
    ("torch._utils", "_rebuild_tensor_v2"): _rebuild_tensor_v2,
}


class _Unpickler(pickle.Unpickler):
    def __init__(self, file, archive: zipfile.ZipFile, prefix: str) -> None:
        super().__init__(file)
        self._archive = archive
        self._prefix = prefix

    def find_class(self, module: str, name: str):
        try:
            return _ALLOWED[(module, name)]
        except KeyError:
            raise pickle.UnpicklingError(
                f"checkpoint wants {module}.{name}, which is not allowed"
            ) from None

    def persistent_load(self, pid):
        kind, storage_type, key, _location, _numel = pid
        if kind != "storage":
            raise pickle.UnpicklingError(f"unknown persistent id {kind!r}")
        raw = self._archive.read(f"{self._prefix}/data/{key}")
        return storage_type(np.frombuffer(raw, dtype=storage_type.dtype))


def load_checkpoint(path: str | Path) -> dict:
    """Read a torch.save()d dict (state_dict as numpy arrays) without importing torch."""
    with zipfile.ZipFile(path) as archive:
        pkl = next(n for n in archive.namelist() if n.endswith("/data.pkl"))
        prefix = pkl[: -len("/data.pkl")]
        if archive.read(f"{prefix}/byteorder") != b"little":
            raise ValueError("big-endian checkpoints are not supported")
        with archive.open(pkl) as handle:
            return _Unpickler(handle, archive, prefix).load()


def _fold_bn(conv_w, gamma, beta, mean, var):
    scale = gamma / np.sqrt(var + BN_EPS)
    return conv_w * scale[:, None, None, None], beta - mean * scale


def _conv3x3(x: np.ndarray, w: np.ndarray, b: np.ndarray) -> np.ndarray:
    """x (C,H,W), w (O,C,3,3) -> (O,H,W); stride 1, zero padding 1."""
    c, h, wd = x.shape
    o = w.shape[0]
    padded = np.pad(x, ((0, 0), (1, 1), (1, 1)))
    windows = sliding_window_view(padded, (3, 3), axis=(1, 2))  # (C,H,W,3,3)
    columns = windows.transpose(1, 2, 0, 3, 4).reshape(h * wd, c * 9)
    out = columns @ w.reshape(o, c * 9).T + b  # (H*W, O)
    return out.T.reshape(o, h, wd)


def _maxpool2(x: np.ndarray) -> np.ndarray:
    c, h, w = x.shape
    h2, w2 = h // 2, w // 2
    return x[:, : h2 * 2, : w2 * 2].reshape(c, h2, 2, w2, 2).max(axis=(2, 4))


class NumpyCNN:
    """SmallCNN: four (conv-BN-ReLU, conv-BN-ReLU, maxpool) blocks, global average pool, linear."""

    def __init__(self, state: dict, classes: list[str], mean: float, std: float) -> None:
        self.classes = list(classes)
        self.mean = float(mean)
        self.std = float(std)
        self._blocks = []
        for i in range(4):
            layers = []
            for conv_idx, bn_idx in ((0, 1), (3, 4)):
                p = f"features.{i}"
                w, b = _fold_bn(
                    state[f"{p}.{conv_idx}.weight"].astype(np.float32),
                    state[f"{p}.{bn_idx}.weight"],
                    state[f"{p}.{bn_idx}.bias"],
                    state[f"{p}.{bn_idx}.running_mean"],
                    state[f"{p}.{bn_idx}.running_var"],
                )
                layers.append((w.astype(np.float32), b.astype(np.float32)))
            self._blocks.append(layers)
        self._fc_w = state["head.2.weight"].astype(np.float32)
        self._fc_b = state["head.2.bias"].astype(np.float32)
        if self._fc_w.shape[0] != len(self.classes):
            raise ValueError("checkpoint has a different number of outputs than classes")

    @classmethod
    def from_checkpoint(cls, path: str | Path) -> NumpyCNN:
        ckpt = load_checkpoint(path)
        return cls(ckpt["state_dict"], ckpt["classes"], ckpt["mean"], ckpt["std"])

    def preprocess(self, frame: np.ndarray) -> np.ndarray:
        return ((frame.astype(np.float32) / 255.0) - self.mean) / self.std

    def logits(self, frame: np.ndarray) -> np.ndarray:
        x = self.preprocess(frame)[None, :, :]  # (1,H,W)
        for layers in self._blocks:
            for w, b in layers:
                x = np.maximum(_conv3x3(x, w, b), 0.0)
            x = _maxpool2(x)
        pooled = x.mean(axis=(1, 2))  # global average pool -> (128,)
        return self._fc_w @ pooled + self._fc_b

    def predict(self, frame: np.ndarray) -> np.ndarray:
        """Softmax probabilities, one per class, in `classes` order."""
        z = self.logits(frame)
        e = np.exp(z - z.max())
        return e / e.sum()
