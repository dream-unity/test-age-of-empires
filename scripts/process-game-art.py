#!/usr/bin/env python3
"""Fast magenta chroma + export for Dawn of Empires sprites and tiles."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path("/workspace")
ART = ROOT / "artifacts" / "imagine_images"
OUT = ROOT / "public" / "game"
ASSETS = ROOT / "assets" / "sprites"


def chroma(im: Image.Image, dist_thresh: float = 88.0) -> Image.Image:
    arr = np.asarray(im.convert("RGBA")).copy()
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    dist = np.sqrt((r - 255.0) ** 2 + g**2 + (b - 255.0) ** 2)
    mag = (dist < dist_thresh) | ((r > 175) & (b > 175) & (g < 95) & ((r + b) > (2 * g + 70)))
    arr[:, :, 3] = np.where(mag, 0, arr[:, :, 3])
    # Despill magenta fringe
    fringe = (~mag) & (r > 140) & (b > 140) & (g < 150) & (r + b > 2 * g + 40)
    if np.any(fringe):
        lum = 0.35 * r + 0.45 * g + 0.20 * b
        arr[:, :, 0] = np.where(fringe, np.clip(lum, 0, 255), arr[:, :, 0])
        arr[:, :, 1] = np.where(fringe, np.clip(lum, 0, 255), arr[:, :, 1])
        arr[:, :, 2] = np.where(fringe, np.clip(lum * 0.92, 0, 255), arr[:, :, 2])
        a = arr[:, :, 3].astype(np.float32)
        arr[:, :, 3] = np.where(fringe, np.clip(a * 0.55, 0, 255), arr[:, :, 3])
    return Image.fromarray(arr.astype(np.uint8))


def trim(im: Image.Image, pad: int = 8) -> Image.Image:
    alpha = np.asarray(im.split()[-1])
    ys, xs = np.where(alpha > 12)
    if len(xs) == 0:
        return im
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad)
    y1 = min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def save_png(im: Image.Image, path: Path, max_side: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im
    if max_side:
        w, h = out.size
        m = max(w, h)
        if m > max_side:
            scale = max_side / m
            out = out.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    out.save(path, "PNG", optimize=True)


def tile_qc(path: Path, dest: Path, size: int = 256) -> None:
    im = Image.open(path).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    # 2x2 seam check
    qc = Image.new("RGB", (size * 2, size * 2))
    for y in range(2):
        for x in range(2):
            qc.paste(im, (x * size, y * size))
    qc.save(dest.with_name(dest.stem + "-2x2.png"), "PNG")


SHEETS = {
    "villager": ("5d5d9aab-1966-44f1-890b-8d52ea836370.jpg", 4, 4),
    "clubman": ("494456f0-4e88-4f21-8906-73c822a41582.jpg", 4, 4),
    "bowman": ("5297c89a-b7bb-4034-823a-23f5db4e5c53.jpg", 4, 4),
    "scout": ("3f51ab49-bbb2-4163-8c0b-877f2b6194d8.jpg", 4, 4),
    "swordsman": ("d6bd6a9b-2b87-4441-84ed-a51d8326116c.jpg", 4, 4),
    "cavalry": ("ceb7da4e-0bcd-467c-83bf-9f82aacb8778.jpg", 4, 4),
    "priest": ("3a08e899-3d75-43ec-8bfe-c89ac522bb36.jpg", 2, 2),
}

SINGLES = {
    "tree": "542f119f-9809-4830-b611-1942b157b441.jpg",
    "berry": "0d83ab23-7606-478b-8f36-9cbcbb5c4acf.jpg",
    "gold": "fe83fccd-e8fb-42b2-b092-1ef7f223ebf0.jpg",
    "stone": "5ee4b041-6102-4b07-a8a2-f923c1d17955.jpg",
    "gazelle": "1c4a09a0-e89c-40c6-be30-c0ec02557650.jpg",
    "farm": "7a116e86-c724-4e5b-96a6-04a1346c874f.jpg",
    "town_center": "f78530c3-75a4-4f7b-a9b4-17b1abcee047.jpg",
    "house": "6c5dc4cd-1195-4d48-a4e4-b82e6db77b90.jpg",
    "barracks": "efe0c080-3bfb-4c89-bac5-a1795fe15d58.jpg",
    "granary": "d27568ca-74d6-4ef7-b76b-51463d689799.jpg",
    "storage_pit": "585980da-bda0-412c-9a36-48e80543820d.jpg",
    "archery": "e06da8e1-5a08-4559-a29d-b84b1038bd0f.jpg",
    "stable": "44939e47-09aa-470c-8dcb-ba037c660e5e.jpg",
    "tower": "1889eee1-7c55-4a91-8edd-2656f8624e42.jpg",
    "temple": "90e92164-c1d2-45c2-8052-d204c5b5bf42.jpg",
    "market": "fc1ae07b-6752-4824-aed1-1c554f24cd2b.jpg",
    "wall": "9099eff4-45fd-4274-9435-1490042e655d.jpg",
    "catapult": "ddcae2a6-697c-4e06-967b-b5d7fae73c2a.jpg",
}

ICONS = {
    "food": "dc3e2fea-a139-4b84-8411-2e60caec77f7.jpg",
    "wood": "d9553fd5-ff50-48cd-8a05-75411254a82f.jpg",
    "gold": "6bd07e71-ceaa-445e-b7bb-da66adab5be6.jpg",
    "stone": "35b20c35-ad76-4fde-90ef-00134ab74ff2.jpg",
}

TILES = {
    "grass": "f57b6e53-586c-43b9-b701-cfe153db411c.jpg",
    "dirt": "e7bd7707-a765-4ee5-98fd-6cfb09347d33.jpg",
    "water": "6219166a-16e7-4ae3-983b-6f8374b3e13d.jpg",
}


def main() -> None:
    sprites = OUT / "sprites"
    tiles = OUT / "tiles"
    ui = OUT / "ui"
    sprites.mkdir(parents=True, exist_ok=True)
    tiles.mkdir(parents=True, exist_ok=True)
    ui.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    meta: dict = {"sheets": {}, "singles": {}, "tiles": {}, "ui": {}}

    title = ART / "458419bd-1756-4bec-923f-313900900ccf.jpg"
    if title.exists():
        im = Image.open(title).convert("RGB")
        im = im.resize((1600, 900), Image.Resampling.LANCZOS)
        im.save(OUT / "title.jpg", "JPEG", quality=86, optimize=True)

    for name, file in TILES.items():
        src = ART / file
        dest = tiles / f"{name}.png"
        tile_qc(src, dest, 256)
        meta["tiles"][name] = f"/game/tiles/{name}.png"

    for name, (file, rows, cols) in SHEETS.items():
        src = ART / file
        im = chroma(Image.open(src), 92)
        # Keep full sheet; scale to a tidy atlas
        side = 1024 if cols == 4 else 512
        im = im.resize((side, side), Image.Resampling.LANCZOS)
        path = sprites / f"{name}.png"
        save_png(im, path)
        save_png(im, ASSETS / name / "sheet-transparent.png")
        meta["sheets"][name] = {
            "src": f"/game/sprites/{name}.png",
            "rows": rows,
            "cols": cols,
        }

    for name, file in SINGLES.items():
        src = ART / file
        im = trim(chroma(Image.open(src), 90), pad=10)
        max_side = 420 if name in {"town_center", "barracks", "archery", "stable"} else 340
        if name == "tree":
            max_side = 280
        if name in {"berry", "gold", "stone", "gazelle", "wall", "catapult"}:
            max_side = 220
        path = sprites / f"{name}.png"
        save_png(im, path, max_side=max_side)
        save_png(im, ASSETS / name / "clean.png", max_side=max_side)
        meta["singles"][name] = f"/game/sprites/{name}.png"

    for name, file in ICONS.items():
        src = ART / file
        im = trim(chroma(Image.open(src), 90), pad=6)
        path = ui / f"{name}.png"
        save_png(im, path, max_side=128)
        meta["ui"][name] = f"/game/ui/{name}.png"

    (OUT / "manifest.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("wrote", OUT / "manifest.json")


if __name__ == "__main__":
    main()
