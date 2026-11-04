"""Render the logo concept comparison sheet (docs/brand-concepts.png).

Each concept at 16, 32, 64 and 256 px on the app's dark background and on a
light one; 16 and 32 px are also shown enlarged (nearest neighbour) so the
pixels can be judged. Concept B uses logo-small.svg at 32 px and below, as the
generated app icons do.

Usage: python3 scripts/brand/concept_sheet.py [output.png]
Needs rsvg-convert and Pillow (build-time only).
"""
import io
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "src" / "assets" / "brand"
FONT = "/usr/share/fonts/opentype/inter/Inter-Regular.otf"
CONCEPTS = [
    ("A  Lyrebird in display", "concept-a.svg", "concept-a.svg"),
    ("B  Plume lyre", "concept-b.svg", "logo-small.svg"),
    ("C  Plume-and-strings L", "concept-c.svg", "concept-c.svg"),
]
BACKGROUNDS = [("dark", (30, 34, 49)), ("light", (246, 244, 239))]
SIZES = [16, 32, 64, 256]


def render(svg: Path, size: int) -> Image.Image:
    png = subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), str(svg)],
        check=True,
        capture_output=True,
    ).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main(out: Path) -> None:
    pad, label_w = 24, 230
    row_h = 256 + 2 * pad
    col_w = [16 + pad, 32 + pad, 64 + pad, 256 + pad, 64 + pad, 128 + pad]
    width = label_w + sum(col_w) + pad
    height = len(CONCEPTS) * len(BACKGROUNDS) * row_h
    sheet = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(FONT, 18)
    small = ImageFont.truetype(FONT, 13)
    y = 0
    for name, large_svg, small_svg in CONCEPTS:
        for bg_name, bg in BACKGROUNDS:
            draw.rectangle([0, y, width, y + row_h], fill=bg)
            ink = (240, 236, 226) if bg_name == "dark" else (30, 34, 49)
            draw.text((pad, y + pad), name, font=font, fill=ink)
            draw.text((pad, y + pad + 28), f"on {bg_name}", font=small, fill=ink)
            x = label_w
            for size in SIZES:
                svg = BRAND / (small_svg if size <= 32 else large_svg)
                img = render(svg, size)
                sheet.alpha_composite(img, (x, y + (row_h - size) // 2))
                draw.text((x, y + row_h - pad), f"{size}", font=small, fill=ink)
                x += size + pad
            for size, zoom in ((16, 4), (32, 4)):
                img = render(BRAND / small_svg, size).resize((size * zoom,) * 2, Image.NEAREST)
                sheet.alpha_composite(img, (x, y + (row_h - size * zoom) // 2))
                draw.text((x, y + row_h - pad), f"{size} x{zoom}", font=small, fill=ink)
                x += size * zoom + pad
            y += row_h
    sheet.convert("RGB").save(out, optimize=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "brand-concepts.png")
