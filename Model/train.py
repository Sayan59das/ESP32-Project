# Train the waste classifier on the images collected by capture.py.
#
#   python train.py
#
# Outputs:
#   waste_cnn.pt          best model by validation accuracy (+ class names)
#   training_curves.png   loss / accuracy per epoch
#   confusion_matrix.png  validation confusion matrix

import random
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

from model import CLASSES, IMG_H, IMG_W, MEAN, STD, SmallCNN

ROOT = Path("dataset")
EPOCHS = 40
BATCH = 32
LR = 1e-3
VAL_FRAC = 0.2
SEED = 0

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"device: {device}")

# ---------------------------------------------------------------- data ----
items = []
for label, name in enumerate(CLASSES):
    files = sorted((ROOT / name).glob("*.png"))
    if not files:
        raise SystemExit(f"no images in {ROOT / name} -- run capture.py first")
    items += [(f, label) for f in files]
    print(f"{name:12s} {len(files)} images")

if len(items) < 60:
    raise SystemExit("too few images to train -- collect a few hundred per class")

# stratified split
train_items, val_items = [], []
for label in range(len(CLASSES)):
    group = [it for it in items if it[1] == label]
    random.Random(SEED).shuffle(group)
    cut = max(1, int(len(group) * VAL_FRAC))
    val_items += group[:cut]
    train_items += group[cut:]
print(f"train {len(train_items)}  val {len(val_items)}")

train_tf = transforms.Compose([
    transforms.RandomAffine(degrees=10, translate=(0.12, 0.12),
                            scale=(0.85, 1.15), shear=5, fill=0),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.4, contrast=0.4),
    transforms.ToTensor(),
    transforms.Normalize([MEAN], [STD]),
    transforms.RandomErasing(p=0.25, scale=(0.02, 0.12)),
])

val_tf = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize([MEAN], [STD]),
])


class FrameDataset(Dataset):
    def __init__(self, items, tf):
        self.items = items
        self.tf = tf

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        img = Image.open(path).convert("L")
        if img.size != (IMG_W, IMG_H):
            img = img.resize((IMG_W, IMG_H), Image.BILINEAR)
        return self.tf(img), label


# num_workers=0 keeps this simple and safe on Windows; the dataset is small.
train_dl = DataLoader(FrameDataset(train_items, train_tf), batch_size=BATCH,
                      shuffle=True, num_workers=0, drop_last=False)
val_dl = DataLoader(FrameDataset(val_items, val_tf), batch_size=BATCH,
                    shuffle=False, num_workers=0)

# --------------------------------------------------------------- model ----
net = SmallCNN().to(device)
counts = Counter(label for _, label in train_items)
weights = torch.tensor([len(train_items) / (len(CLASSES) * counts[i])
                        for i in range(len(CLASSES))], dtype=torch.float32, device=device)
criterion = nn.CrossEntropyLoss(weight=weights, label_smoothing=0.05)
opt = torch.optim.AdamW(net.parameters(), lr=LR, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)

hist = {"train_loss": [], "val_loss": [], "train_acc": [], "val_acc": []}
best_acc, best_state = 0.0, None

for epoch in range(1, EPOCHS + 1):
    net.train()
    loss_sum = correct = total = 0
    for x, y in train_dl:
        x, y = x.to(device), y.to(device)
        opt.zero_grad(set_to_none=True)
        out = net(x)
        loss = criterion(out, y)
        loss.backward()
        opt.step()
        loss_sum += loss.item() * y.size(0)
        correct += (out.argmax(1) == y).sum().item()
        total += y.size(0)
    tr_loss, tr_acc = loss_sum / total, correct / total

    net.eval()
    loss_sum = correct = total = 0
    preds, trues = [], []
    with torch.no_grad():
        for x, y in val_dl:
            x, y = x.to(device), y.to(device)
            out = net(x)
            loss_sum += criterion(out, y).item() * y.size(0)
            p = out.argmax(1)
            correct += (p == y).sum().item()
            total += y.size(0)
            preds += p.cpu().tolist()
            trues += y.cpu().tolist()
    va_loss, va_acc = loss_sum / total, correct / total

    sched.step()
    hist["train_loss"].append(tr_loss)
    hist["val_loss"].append(va_loss)
    hist["train_acc"].append(tr_acc)
    hist["val_acc"].append(va_acc)
    print(f"epoch {epoch:3d}/{EPOCHS}  train {tr_loss:.3f}/{tr_acc:.3f}   "
          f"val {va_loss:.3f}/{va_acc:.3f}")

    if va_acc >= best_acc:
        best_acc = va_acc
        best_state = {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}
        best_preds, best_trues = preds, trues

torch.save({"state_dict": best_state, "classes": CLASSES,
            "img_w": IMG_W, "img_h": IMG_H, "mean": MEAN, "std": STD},
           "waste_cnn.pt")
print(f"\nbest validation accuracy: {best_acc:.3f}  -> waste_cnn.pt")
print(classification_report(best_trues, best_preds, target_names=CLASSES, digits=3))

# --------------------------------------------------------------- plots ----
fig, ax = plt.subplots(1, 2, figsize=(11, 4))
ax[0].plot(hist["train_loss"], label="train")
ax[0].plot(hist["val_loss"], label="val")
ax[0].set_title("loss"); ax[0].set_xlabel("epoch"); ax[0].legend()
ax[1].plot(hist["train_acc"], label="train")
ax[1].plot(hist["val_acc"], label="val")
ax[1].set_title("accuracy"); ax[1].set_xlabel("epoch"); ax[1].legend()
fig.tight_layout()
fig.savefig("training_curves.png", dpi=130)

cm = confusion_matrix(best_trues, best_preds, labels=range(len(CLASSES)))
fig, ax = plt.subplots(figsize=(5.2, 4.6))
im = ax.imshow(cm, cmap="Blues")
ax.set_xticks(range(len(CLASSES)), CLASSES, rotation=20)
ax.set_yticks(range(len(CLASSES)), CLASSES)
ax.set_xlabel("predicted"); ax.set_ylabel("true")
ax.set_title(f"validation confusion matrix (acc {best_acc:.3f})")
for i in range(len(CLASSES)):
    for j in range(len(CLASSES)):
        ax.text(j, i, cm[i, j], ha="center", va="center",
                color="white" if cm[i, j] > cm.max() / 2 else "black")
fig.colorbar(im)
fig.tight_layout()
fig.savefig("confusion_matrix.png", dpi=130)
print("wrote training_curves.png and confusion_matrix.png")
