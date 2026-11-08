"""
Lords of Pain floor blotches as floor patches for the ancient biome (docs/KENNEY_DECOR.md "LoP floor blotches").

  python3 scripts/art/lop/floor_blotches.py [--vendor <dir>] [--contact <png>]

The Lords of Pain ground overlays `environment/ground_variation1.png` (a darker worn-stone patch) and
`ground_variation2.png` (a soft black stain) are top-down images at the stone floor's own density: 256 px over
`tile.biome.1.floor`'s tilesPerImage 4 = SRC_TILE_PX px a tile. Each is laid on the ground plane centred on the
patch block's centre and drawn as the game camera sees it (pitch 55, yaw 45: one tile along +X is (s, s sin 55) px and
along +Z (-s, s sin 55) px with s = TILE_PX / sqrt 2), the 55 deg screen image `buildFloorArt` expects of a flat piece,
at the decor scale TILE_PX (scripts/art/kenney/reproject.py, render_kit.py). Supersampled by SUPER, then a
premultiplied Lanczos reduce, a 2 px margin. No grading: they are the stone floor's own companions (both darker than
it, so bullets only gain contrast). Writes art/vendor/lords-of-pain-patch/<file>.png (+ .pivot.json: the block centre
in the PNG's pixels, atlases.json `pivot: [x, y]`). Needs Pillow and numpy (Python 3); not part of `npm run`.
Deterministic: the same sources give the same bytes.
"""
import argparse, json, math, os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TILE_PX = 29.6  # the decor scale: pixels per game tile (render_kit.py TILE_PX)
GAME_PITCH = 55.0  # shared/config CAMERA_PITCH_DEG
SRC_TILE_PX = 256 / 4  # the stone floor's density: 256 px, tilesPerImage 4 (art/atlases.json tile.biome.1.floor)
SUPER = 4
PAD = 2
ALPHA_CUT = 4  # the reduce's faint fringe (variation2 is a soft stain: a higher cut would leave a hard rim)
OUT_DIR = "lords-of-pain-patch"
PIECES = [
    {"src": "lords-of-pain/environment/ground_variation1.png", "file": "blotch1.png"},
    {"src": "lords-of-pain/environment/ground_variation2.png", "file": "blotch2.png"},
]


def project(im):
    """The top-down source on the ground plane, its centre on the block centre, as the game camera draws it (SUPER x)."""
    s = TILE_PX * SUPER / math.sqrt(2)
    sp = math.sin(math.radians(GAME_PITCH))
    ex = np.array([s, s * sp]) / SRC_TILE_PX  # screen px per source px along the source's u (world +X)
    ez = np.array([-s, s * sp]) / SRC_TILE_PX  # ... along v (world +Z)
    w, h = im.size
    c = np.array([w / 2, h / 2])
    corners = [np.array(p, dtype=float) - c for p in ((0, 0), (w, 0), (0, h), (w, h))]
    pts = [p[0] * ex + p[1] * ez for p in corners]
    lo = np.floor(np.min(pts, axis=0)) - 2
    hi = np.ceil(np.max(pts, axis=0)) + 2
    size = (int(hi[0] - lo[0]), int(hi[1] - lo[1]))
    origin = -lo  # where the block centre lands on the canvas
    # output -> input: [u, v] = M^-1 (p - origin) + c
    m = np.linalg.inv(np.c_[ex, ez])
    off = c - m @ origin
    coeffs = (m[0, 0], m[0, 1], off[0], m[1, 0], m[1, 1], off[1])
    # premultiplied, so the transparent edge does not bleed black into the stain's colour
    a = np.array(im.convert("RGBA")).astype(np.float64) / 255.0
    pm = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], axis=2)
    chans = [Image.fromarray((pm[..., i] * 255).round().astype(np.uint8)) for i in range(4)]
    warped = [ch.transform(size, Image.AFFINE, coeffs, resample=Image.BICUBIC) for ch in chans]
    return warped, origin


def reduce(warped, origin):
    w, h = warped[0].size
    ow, oh = math.ceil(w / SUPER), math.ceil(h / SUPER)
    # pad to whole SUPER blocks so the reduce is an exact 1 / SUPER
    chans = []
    for ch in warped:
        big = Image.new("L", (ow * SUPER, oh * SUPER), 0)
        big.paste(ch, (0, 0))
        chans.append(np.array(big.resize((ow, oh), Image.LANCZOS)).astype(np.float64) / 255.0)
    o = np.stack(chans, axis=2)
    oa = o[..., 3]
    rgb = np.where(oa[..., None] > 0, o[..., :3] / np.maximum(oa[..., None], 1e-6), 0)
    alpha = np.clip(oa * 255, 0, 255).round().astype(np.uint8)
    alpha[alpha < ALPHA_CUT] = 0
    res = Image.fromarray(np.dstack([np.clip(rgb * 255, 0, 255).round().astype(np.uint8), alpha]), "RGBA")
    x0, y0, x1, y1 = res.getbbox()
    res = res.crop((x0, y0, x1, y1))
    out = Image.new("RGBA", (res.width + 2 * PAD, res.height + 2 * PAD))
    out.paste(res, (PAD, PAD))
    pivot = [round(float(origin[0] / SUPER - x0 + PAD), 2), round(float(origin[1] / SUPER - y0 + PAD), 2)]
    return out, pivot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vendor", default=os.path.join(ROOT, "art", "vendor"))
    ap.add_argument("--contact", help="also write a contact sheet: each blotch on the stone floor at the game's scale")
    args = ap.parse_args()
    out_dir = os.path.join(args.vendor, OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for p in PIECES:
        src = Image.open(os.path.join(args.vendor, p["src"]))
        img, pivot = reduce(*project(src))
        path = os.path.join(out_dir, p["file"])
        img.save(path, optimize=True)
        with open(path + ".pivot.json", "w") as f:
            json.dump({"pivot": pivot}, f)
            f.write("\n")
        made.append((img, pivot))
        print(f"{OUT_DIR}/{p['file']}: {img.width} x {img.height}, pivot {pivot}")
    if args.contact:
        # the stone floor, 2 x 2 repeats (8 x 8 tiles; the texture is seamless), as the camera sees it
        stone = Image.open(os.path.join(args.vendor, "lords-of-pain/environment/ground_stone1.png")).convert("RGBA")
        run = Image.new("RGBA", (stone.width * 2, stone.height * 2))
        for t in range(4):
            run.paste(stone, ((t % 2) * stone.width, (t // 2) * stone.height))
        floor, fpv = reduce(*project(run))
        sheet = Image.new("RGBA", (floor.width * (len(made) + 1), floor.height), (12, 16, 24, 255))
        for i in range(len(made) + 1):
            sheet.alpha_composite(floor, (i * floor.width, 0))
            if i > 0:
                img, pv = made[i - 1]
                sheet.alpha_composite(img, (int(round(i * floor.width + fpv[0] - pv[0])), int(round(fpv[1] - pv[1]))))
        sheet.save(args.contact)
        print(f"contact: {args.contact}")


if __name__ == "__main__":
    main()
