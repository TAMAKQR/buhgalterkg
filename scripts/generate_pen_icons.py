"""Utility to (re)generate the PWA pen icons."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)

BACKGROUND = "#020617"
PEN_BODY = "#38bdf8"
PEN_SHADOW = "#0ea5e9"
PEN_CLIP = "#bae6fd"
PEN_NIB = "#f8fafc"
PEN_NIB_LINE = "#94a3b8"

def _offset_point(point: tuple[float, float], vector: tuple[float, float]) -> tuple[float, float]:
    return point[0] + vector[0], point[1] + vector[1]

def create_icon(size: int) -> None:
    img = Image.new("RGBA", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(img)

    start = (size * 0.28, size * 0.18)
    end = (size * 0.78, size * 0.78)
    width = size * 0.16

    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    half = width / 2

    perp = (px * half, py * half)
    body = [
        _offset_point(start, perp),
        _offset_point(end, perp),
        _offset_point(end, (-perp[0], -perp[1])),
        _offset_point(start, (-perp[0], -perp[1])),
    ]

    shadow = [
        _offset_point(start, (perp[0] * 0.4, perp[1] * 0.4)),
        _offset_point(end, (perp[0] * 0.4, perp[1] * 0.4)),
        _offset_point(end, (-perp[0] * 0.6, -perp[1] * 0.6)),
        _offset_point(start, (-perp[0] * 0.6, -perp[1] * 0.6)),
    ]

    draw.polygon(shadow, fill=PEN_SHADOW)
    draw.polygon(body, fill=PEN_BODY)

    nib_length = width * 0.85
    nib_tip = _offset_point(end, (ux * nib_length, uy * nib_length))
    nib = [
        _offset_point(end, perp),
        nib_tip,
        _offset_point(end, (-perp[0], -perp[1])),
    ]
    draw.polygon(nib, fill=PEN_NIB)
    draw.line([nib_tip, _offset_point(end, (0, 0))], fill=PEN_NIB_LINE, width=int(width * 0.08))

    eraser_length = width * 0.9
    eraser_start = _offset_point(start, (-ux * eraser_length, -uy * eraser_length))
    eraser = [
        _offset_point(eraser_start, perp),
        _offset_point(start, perp),
        _offset_point(start, (-perp[0], -perp[1])),
        _offset_point(eraser_start, (-perp[0], -perp[1])),
    ]
    draw.polygon(eraser, fill=PEN_CLIP)

    clip_offset = half * 0.6
    clip = [
        _offset_point(start, (perp[0] * 0.5, perp[1] * 0.5)),
        _offset_point(start, (-perp[0] * 0.2, -perp[1] * 0.2)),
        _offset_point(_offset_point(start, (-ux * width, -uy * width)), (-perp[0] * 0.2, -perp[1] * 0.2)),
        _offset_point(_offset_point(start, (-ux * width, -uy * width)), (perp[0] * 0.5, perp[1] * 0.5)),
    ]
    draw.polygon(clip, fill=PEN_SHADOW)

    path = ICON_DIR / f"pen-{size}.png"
    img.save(path, "PNG")
    print(f"Saved {path.relative_to(ROOT)}")


def main() -> None:
    for size in (192, 512):
        create_icon(size)


if __name__ == "__main__":
    main()
