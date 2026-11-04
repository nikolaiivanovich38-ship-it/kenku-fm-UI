"""Build the wordmark SVGs: logo.svg beside "Lyre" set in Lora SemiBold.

The letters are converted to outlines, so the SVG needs no font. Lora is
licensed under the SIL Open Font License 1.1, which allows this.

Usage: python3 scripts/brand/wordmark.py [path/to/Lora-Variable.ttf]
Writes src/assets/brand/wordmark.svg (light letters, for dark backgrounds) and
wordmark-on-light.svg (dark letters). Needs fontTools (build-time only).
"""
import re
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "src" / "assets" / "brand"
DEFAULT_FONT = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"
TEXT = "Lyre"
WEIGHT = 600
# Layout in logo units: the logo tile is 64 high; the capital L stands 34 high
# with its baseline level with the bottom of the lyre's sound box.
CAP_HEIGHT = 34
BASELINE = 49
GAP = 14
TRACKING = 0.5  # extra space between letters, in logo units

COLOURS = {"wordmark.svg": "#F1E4C8", "wordmark-on-light.svg": "#142B24"}


def letter_paths(font_path: str) -> tuple[str, float]:
    font = instantiateVariableFont(TTFont(font_path), {"wght": WEIGHT})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    cap = font["OS/2"].sCapHeight
    scale = CAP_HEIGHT / cap
    x = 0.0
    parts = []
    for char in TEXT:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        # Font units point up; SVG points down. Flip and scale onto the baseline.
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        parts.append(pen.getCommands())
        x += glyphs[name].width * scale + TRACKING
    return " ".join(parts), x - TRACKING


def logo_body() -> str:
    svg = (BRAND / "logo.svg").read_text()
    inner = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S).group(1)
    inner = re.sub(r"\s*<title>.*?</title>|\s*<desc>.*?</desc>", "", inner, flags=re.S)
    # ids must stay unique if both wordmarks are ever inlined in one page.
    return inner


def main() -> None:
    font_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FONT
    letters, width = letter_paths(font_path)
    total = 64 + GAP + width + 4
    for file_name, colour in COLOURS.items():
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total:.1f} 64" '
            f'width="{total * 4:.0f}" height="256">\n'
            "  <title>Lyre</title>\n"
            f"{logo_body().rstrip()}\n"
            f'  <path transform="translate({64 + GAP} {BASELINE})" fill="{colour}" d="{letters}"/>\n'
            "</svg>\n"
        )
        (BRAND / file_name).write_text(svg)
        print(f"wrote {BRAND / file_name}")


if __name__ == "__main__":
    main()
