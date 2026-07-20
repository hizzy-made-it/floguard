"""Generate favicon set and optimized logo assets from public/images/logo*.png.

Usage (from repo root, after placing high-res sources):
  python frontend/scripts/generate-favicons.py
"""
from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
IMAGES = PUBLIC / "images"

# Brand dark background matching theme-color #0B0F1A
BG_RGBA = (11, 15, 26, 255)
BG_RGB = (11, 15, 26)


def to_rgba(im: Image.Image) -> Image.Image:
    return im if im.mode == "RGBA" else im.convert("RGBA")


def make_square(im: Image.Image, size: int, bg=BG_RGBA) -> Image.Image:
    im = im.copy()
    im.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), bg)
    x = (size - im.width) // 2
    y = (size - im.height) // 2
    canvas.paste(im, (x, y), im)
    return canvas


def write_png_ico(path: Path, images: list[Image.Image]) -> None:
    """Write a multi-size ICO containing PNG-compressed frames (Vista+ / modern browsers)."""
    pngs: list[tuple[int, bytes]] = []
    for im in images:
        s = im.width
        rgb = Image.new("RGB", (s, s), BG_RGB)
        rgba = im.convert("RGBA")
        rgb.paste(rgba, mask=rgba.split()[-1])
        buf = BytesIO()
        rgb.save(buf, format="PNG", optimize=True)
        pngs.append((s, buf.getvalue()))

    num = len(pngs)
    header = struct.pack("<HHH", 0, 1, num)
    entries = b""
    offset = 6 + 16 * num
    body = b""
    for s, data in pngs:
        w = 0 if s >= 256 else s
        h = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        body += data
    path.write_bytes(header + entries + body)


def main() -> None:
    logo = to_rgba(Image.open(IMAGES / "logo.png"))
    icon = to_rgba(Image.open(IMAGES / "logo-icon.png"))
    print("source logo", logo.size, logo.mode)
    print("source icon", icon.size, icon.mode)

    logo_web = logo.copy()
    logo_web.thumbnail((800, 800), Image.Resampling.LANCZOS)
    logo_web.save(IMAGES / "logo.png", format="PNG", optimize=True)
    print("logo.png", logo_web.size)

    icon_ui = icon.copy()
    icon_ui.thumbnail((512, 512), Image.Resampling.LANCZOS)
    icon_ui.save(IMAGES / "logo-icon.png", format="PNG", optimize=True)
    print("logo-icon.png", icon_ui.size)

    # Google Organization logo: shortest side >= 112px (prefer square brand mark)
    logo_schema = make_square(logo, 448)
    logo_schema.save(IMAGES / "logo-schema.png", format="PNG", optimize=True)
    print("logo-schema.png", logo_schema.size)

    sizes_png = {
        "favicon-48x48.png": 48,
        "favicon-96x96.png": 96,
        "favicon-192x192.png": 192,
        "favicon-512x512.png": 512,
        "apple-touch-icon.png": 180,
    }
    for name, size in sizes_png.items():
        make_square(logo, size).save(PUBLIC / name, format="PNG", optimize=True)
        print("wrote", name)

    ico_images = [make_square(logo, s) for s in (16, 32, 48)]
    write_png_ico(PUBLIC / "favicon.ico", ico_images)
    print("wrote favicon.ico", (PUBLIC / "favicon.ico").stat().st_size)


if __name__ == "__main__":
    main()
