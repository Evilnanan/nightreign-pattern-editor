#!/usr/bin/env python3
"""Build the editor's full-resolution maps from exported PNG tiles.

Requires Pillow. Pass the export's `maptiles/png` directory:
    python scripts/build-map-assets.py PATH_TO_MAPTILES_PNG

L0 coordinates increase rightward (X) and upward (Y). Each map's B1
view dims the base map before compositing the original lower-floor tiles,
so their per-pixel alpha controls the transition between floors.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageEnhance


TILE_NAME = re.compile(r"^MENU_MapTile_L0_(\d{2})_(\d{2})\.png$")
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def stitch_map(folder: Path) -> tuple[Image.Image, Image.Image]:
    tiles = {}
    for path in folder.glob("MENU_MapTile_L0_??_??.png"):
        match = TILE_NAME.fullmatch(path.name)
        if match:
            tiles[tuple(map(int, match.groups()))] = path

    expected = {(x, y) for x in range(6) for y in range(6)}
    if set(tiles) != expected:
        raise ValueError(f"{folder}: expected a complete 6x6 L0 grid; missing {sorted(expected - set(tiles))}, extra {sorted(set(tiles) - expected)}")

    base = Image.new("RGBA", (1536, 1536), (0, 0, 0, 0))
    lower = Image.new("RGBA", base.size, (0, 0, 0, 0))
    for (x, y), path in sorted(tiles.items()):
        position = (x * 256, (5 - y) * 256)
        for tile_path, canvas in (
            (path, base),
            (path.with_name(f"{path.stem}_B1.png"), lower),
        ):
            if not tile_path.exists():
                continue
            with Image.open(tile_path) as source:
                if source.size != (256, 256):
                    raise ValueError(f"{tile_path}: expected 256x256, got {source.size}")
                canvas.alpha_composite(source.convert("RGBA"), position)
    return base, lower


def lower_floor(base: Image.Image, lower: Image.Image, brightness: float) -> Image.Image:
    """Dim upper-floor RGB without changing transparency or lower-floor art."""
    if lower.getchannel("A").getbbox() is None:
        raise ValueError("Map has no lower-floor PNG tiles")
    dimmed = ImageEnhance.Brightness(base).enhance(brightness)
    return Image.alpha_composite(dimmed, lower)


def save_map(image: Image.Image, path: Path, quality: int) -> None:
    temporary = path.with_suffix(".webp.tmp")
    try:
        image.save(temporary, format="WEBP", lossless=False, quality=quality, method=6)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"{path.name}: {image.width}x{image.height}, {path.stat().st_size / 1024:.0f} KiB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="maptiles/png directory containing folders 0 through 5")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "public" / "maps")
    parser.add_argument("--quality", type=int, default=90, help="WebP quality, 0-100 (default: 90)")
    parser.add_argument("--upper-brightness", type=float, default=0.4, help="upper-floor brightness in the B1 view, 0-1 (default: 0.4)")
    args = parser.parse_args()
    if not 0 <= args.quality <= 100:
        parser.error("--quality must be between 0 and 100")
    if not 0 <= args.upper_brightness <= 1:
        parser.error("--upper-brightness must be between 0 and 1")

    # Validate and assemble every source before replacing existing assets.
    maps = {}
    for terrain in range(6):
        base, lower = stitch_map(args.source / str(terrain))
        maps[f"map_{terrain}_L0.webp"] = base
        if terrain == 4:
            maps[f"map_{terrain}_L0_B1.webp"] = lower_floor(base, lower, args.upper_brightness)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, image in maps.items():
        save_map(image, args.output / name, args.quality)


if __name__ == "__main__":
    main()
