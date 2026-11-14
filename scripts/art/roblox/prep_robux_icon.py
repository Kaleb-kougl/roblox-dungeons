#!/usr/bin/env python3
"""
Roblox's Robux icon for the Get Silver prices (docs/SILVER_SHOP.md, "Robux icon"; theme id `ui.icon.robux`).

The icon is Roblox's own mark, so it is never redrawn here: the owner copies Roblox's official white icon out of the
Roblox Studio install (macOS: /Applications/RobloxStudio.app/Contents/Resources/content/textures/ui/common/robux@3x.png)
into art/vendor/roblox/ (gitignored: not ours to redistribute), and this script makes the button-glyph version of it:

  - crop to its visible pixels (alpha > NOISE_ALPHA), centred on a square canvas (aspect kept);
  - downsample to SIZE x SIZE with Lanczos on premultiplied alpha (no dark fringe);
  - every pixel white with its alpha kept (the button tints it like its text, UI_ART's white glyph set);
  - alpha hardened to 0 / 255 at HARD_ALPHA (the menus draw art Pixelated, 2 screen px per art px: a soft edge would
    read as blocky grey), unless --soft.

Writes art/vendor/roblox/robux-icon.png (the `images` entry `ui.icon.robux` in art/atlases.json), then:
  node scripts/art/build-atlases.js --only ui.icon.robux        -> art/upload/ui-robux.png + packs/vale/layout.ts
  node scripts/art/build-atlases.js --lock --only ui.icon.robux -> art/vendor.lock.json

Usage: python3 scripts/art/roblox/prep_robux_icon.py [--src PATH] [--out PATH] [--size N] [--soft]
Needs Pillow (python3 -m pip install Pillow). Not run by art:build.
"""
import argparse
import os
import sys

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEFAULT_SRC = os.path.join(REPO, "art", "vendor", "roblox", "robux@3x.png")
DEFAULT_OUT = os.path.join(REPO, "art", "vendor", "roblox", "robux-icon.png")
# The glyph size: UI_ART.iconBox.glyph is 16 reference px; the UI sheet's glyphs (gear, mute) are 11-14 art px.
SIZE = 12
# Source pixels at or below this alpha are noise (left out of the crop).
NOISE_ALPHA = 8
# The hard edge: a downsampled pixel at or above this alpha is opaque, below it clear.
HARD_ALPHA = 128
OPAQUE = 255


def prep(src: Image.Image, size: int = SIZE, soft: bool = False) -> Image.Image:
    rgba = src.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda a: OPAQUE if a > NOISE_ALPHA else 0)
    box = alpha.getbbox()
    if box is None:
        raise ValueError("the source has no visible pixels")
    cut = rgba.crop(box)
    side = max(cut.width, cut.height)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cut, ((side - cut.width) // 2, (side - cut.height) // 2))
    # premultiplied resample: "RGBa" is Pillow's premultiplied mode
    small = square.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    a = small.getchannel("A")
    if not soft:
        a = a.point(lambda v: OPAQUE if v >= HARD_ALPHA else 0)
    white = Image.new("RGBA", (size, size), (OPAQUE, OPAQUE, OPAQUE, 0))
    white.putalpha(a)
    return white


def main(argv: list) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--src", default=DEFAULT_SRC)
    p.add_argument("--out", default=DEFAULT_OUT)
    p.add_argument("--size", type=int, default=SIZE)
    p.add_argument("--soft", action="store_true", help="keep the downsampled alpha (no hard edge)")
    args = p.parse_args(argv)
    if not os.path.exists(args.src):
        print(
            f"missing {args.src}\n"
            "Copy Roblox's icon there first (macOS):\n"
            "  mkdir -p art/vendor/roblox && cp "
            "/Applications/RobloxStudio.app/Contents/Resources/content/textures/ui/common/robux@3x.png art/vendor/roblox/",
            file=sys.stderr,
        )
        return 1
    out = prep(Image.open(args.src), args.size, args.soft)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    out.save(args.out)
    opaque = sum(out.getchannel("A").histogram()[1:])
    print(f"wrote {args.out} ({args.size} x {args.size}, {opaque} visible px)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
