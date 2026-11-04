"""Generate Lyre's app icons and installer images from the logo SVGs.

Run from anywhere:  python3 scripts/brand/generate_assets.py
Build-time tools only (the outputs are committed): rsvg-convert and Pillow.

Sources (src/assets/brand/):
  logo.svg        the logo, used from 48 px up
  logo-small.svg  the same logo drawn for 16 to 32 px (thicker plumes, two
                  strings, edges on the pixel grid)
  wordmark.svg    logo + "Lyre" (made by wordmark.py), used by loading.gif

Outputs (src/assets/):
  icon.svg, icon.png (1024), icons/<n>x<n>.png, icon.ico, setup.ico,
  icon.icns, setup.icns, player-icon.png, loading.gif, dmg-background.png
"""
import io
import math
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "src" / "assets"
BRAND = ASSETS / "brand"
LOGO = BRAND / "logo.svg"
LOGO_SMALL = BRAND / "logo-small.svg"
WORDMARK = BRAND / "wordmark.svg"

ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
SMALL_UP_TO = 32  # sizes up to this use logo-small.svg

FERN_NIGHT = "#142B24"
STRING_IVORY = (0xF1, 0xE4, 0xC8)
STRING_BRIGHT = (0xFF, 0xF8, 0xE8)
STRINGS = "M26 22V48M32 22V48M38 22V48"  # the strings path in logo.svg


def render_svg(svg: str | Path, width: int, height: int | None = None, background: str | None = None) -> Image.Image:
    """Render SVG (a file or SVG text) with rsvg-convert into an RGBA image."""
    args = ["rsvg-convert", "-w", str(width)]
    if height:
        args += ["-h", str(height)]
    if background:
        args += ["-b", background]
    if isinstance(svg, Path):
        result = subprocess.run(args + [str(svg)], check=True, capture_output=True)
    else:
        result = subprocess.run(args, input=svg.encode(), check=True, capture_output=True)
    return Image.open(io.BytesIO(result.stdout)).convert("RGBA")


def icon(size: int) -> Image.Image:
    return render_svg(LOGO_SMALL if size <= SMALL_UP_TO else LOGO, size, size)


def write_pngs() -> dict[int, Image.Image]:
    images = {size: icon(size) for size in ICON_SIZES}
    (ASSETS / "icons").mkdir(exist_ok=True)
    for size, image in images.items():
        image.save(ASSETS / "icons" / f"{size}x{size}.png", optimize=True)
    images[1024].save(ASSETS / "icon.png", optimize=True)
    # The player tab shows its icon at 16 CSS pixels; 64 px of the small
    # drawing scales down 4:1 (or 2:1 on high-density screens) onto whole pixels.
    render_svg(LOGO_SMALL, 64, 64).save(ASSETS / "player-icon.png", optimize=True)
    shutil.copyfile(LOGO, ASSETS / "icon.svg")
    return images


def write_ico(images: dict[int, Image.Image]) -> None:
    largest = images[ICO_SIZES[-1]]
    others = [images[size] for size in ICO_SIZES[:-1]]
    for name in ("icon.ico", "setup.ico"):
        largest.save(
            ASSETS / name,
            format="ICO",
            sizes=[(size, size) for size in ICO_SIZES],
            append_images=others,
        )


def write_icns(images: dict[int, Image.Image]) -> None:
    # macOS is not a target yet; forge.config.js and publish/mac still name these.
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for name in ("icon.icns", "setup.icns"):
        images[1024].save(ASSETS / name, format="ICNS", append_images=[images[s] for s in sizes[:-1]])


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> str:
    return "#%02X%02X%02X" % tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def write_loading_gif() -> None:
    """The Windows installer shows this while it installs: the wordmark, with
    the three strings plucked one after another, then a rest. 320 x 180."""
    template = WORDMARK.read_text()
    if STRINGS not in template:
        raise SystemExit(f"{WORDMARK} no longer contains the strings path {STRINGS!r}")
    fps, seconds = 20, 3.0
    frame_count = int(fps * seconds)
    pluck_at = [0.0, 0.25, 0.5]  # seconds; one string after another, left to right
    frames = []
    for index in range(frame_count):
        t = index / fps
        paths = []
        for x, start in zip((26, 32, 38), pluck_at):
            age = t - start
            energy = math.exp(-age * 1.8) if age >= 0 else 0.0
            sway = 2.6 * energy * math.sin(age * 2 * math.pi * 3) if age >= 0 else 0.0
            colour = mix(STRING_IVORY, STRING_BRIGHT, energy)
            paths.append(
                f'<path d="M{x} 22Q{x + sway:.2f} 35 {x} 48" fill="none" stroke="{colour}" '
                f'stroke-width="{2.4 + 0.6 * energy:.2f}" stroke-linecap="round"/>'
            )
        svg = template.replace(f'<path d="{STRINGS}" fill="none" stroke="#F1E4C8" stroke-width="2.4" stroke-linecap="round"/>', "".join(paths))
        if svg == template:
            raise SystemExit("could not replace the strings in wordmark.svg; update write_loading_gif")
        mark = render_svg(svg, round(80 * _aspect(template)), 80)
        frame = Image.new("RGBA", (320, 180), FERN_NIGHT)
        frame.alpha_composite(mark, ((320 - mark.width) // 2, (180 - mark.height) // 2))
        frames.append(frame.convert("RGB").quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    frames[0].save(
        ASSETS / "loading.gif",
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / fps),
        loop=0,
        optimize=True,
        disposal=1,
    )


def _aspect(svg: str) -> float:
    view_box = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    return float(view_box.group(1)) / float(view_box.group(2))


def write_dmg_background() -> None:
    """macOS disk-image window background (publish/mac, not used yet):
    the window colour with a quiet arrow from the app to Applications."""
    image = Image.new("RGB", (658, 498), FERN_NIGHT)
    draw = ImageDraw.Draw(image)
    y = 249
    draw.line([(270, y), (380, y)], fill=STRING_IVORY, width=3)
    draw.polygon([(392, y), (376, y - 9), (376, y + 9)], fill=STRING_IVORY)
    image.save(ASSETS / "dmg-background.png", optimize=True)


def main() -> None:
    images = write_pngs()
    write_ico(images)
    write_icns(images)
    write_loading_gif()
    write_dmg_background()
    for path in sorted(ASSETS.glob("*")) + sorted((ASSETS / "icons").glob("*")):
        if path.is_file():
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
