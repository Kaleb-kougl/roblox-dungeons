"""
Reproject Kenney's isometric sprites to the game camera (docs/KENNEY_DECOR.md).

  python3 scripts/art/kenney/reproject.py [--only piece,...] [--contact <png>]

Reads scripts/art/kenney/kenney.json; source paths are relative to art/vendor/. Writes
art/vendor/kenney/<piece>/<file>.png and <file>.png.pivot.json (the footprint's centre on the floor in the PNG's
pixels: atlases.json `pivot: [x, y]`), like scripts/art/kit/render_kit.py. Needs Pillow and numpy (Python 3).

Kenney renders every piece in a 256 x 512 cell with an orthographic camera at pitch 30, yaw 45 (its Information.png);
the game's camera is at pitch 55, yaw 45 (shared/config CAMERA_PITCH_DEG). Any plane's image under one orthographic
camera is an affine image of the same plane under the other, so:

  flat     the ground plane's map (x unchanged, depth x sin 55 / sin 30): exact for carpets, planks, dirt.
  box      the piece's body box (x0, x1, z0, z1, h in Kenney tiles about the cell's ground centre; measured from the
           silhouette, or `boxFrom` another source so variants line up): its top, +X and +Z faces each warped by their
           own affine (three corners), masked to the face's game polygon. Exact for the faces; what sticks out of the
           box is approximate.
  uniform  one vertical scale `k` about the footprint's centre (round and open shapes: tables, chairs, barrels).

World axes: x = the screen-down-right ground axis (the game's +X), z = screen-down-left (+Z), y = up. Kenney facing E
shows a wall piece's front on +X, S on +Z. Baked shadows (black, translucent) are dropped: the kit pieces have none.
`wall` pieces (normal "x" / "z") stand with their back on the cell's back edge; the pivot is the footprint's centre
on the floor, half a game tile in front of the back for wall pieces. `compose` pastes more cells over the first
before anything else; `layers` draws more sources over the result, each reprojected in its own mode with the same
pivot (the stockpile: barrels under a scaffold). `stretch` (box mode, wall pieces) draws the box longer along its wall,
about the pivot (the wide bookcases over two cells). Scale: `scale` game tiles to a Kenney tile (matched on
the barrel, KND5; a piece may set its own: the bookcases fit the kit bookcase's cell and DECOR_BOX), then the TILE_PX
decor scale; graded like the kits (`grade`, a piece's own fields override).
"""
import argparse, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
VENDOR = os.path.join(ROOT, "art", "vendor")
TILE_PX = 29.6  # the decor scale: pixels per game tile (render_kit.py TILE_PX)
GAME_PITCH = 55.0
KENNEY_PITCH = 30.0
KT_PX = 256 / math.sqrt(2)  # Kenney pixels per Kenney tile side (the diamond is 256 wide)
GROUND = (128.0, 448.0)  # a standing piece's cell centre on the ground (measured: column, candle stand, wall corner)
SURFACE = (128.0, 428.0)  # a floor tile's top-surface centre (its diamond's top vertex is at y 364)
CANVAS = (1000, 1200)
ORIGIN = np.array([500.0, 850.0])  # where the pivot lands on the work canvas


def basis(pitch_deg):
    p = math.radians(pitch_deg)
    a = math.sqrt(0.5) * KT_PX
    # image coordinates (y down): one Kenney tile along each world axis
    return {"x": np.array([a, a * math.sin(p)]), "z": np.array([-a, a * math.sin(p)]), "y": np.array([0.0, -KT_PX * math.cos(p)])}


EI = basis(KENNEY_PITCH)
EG = basis(GAME_PITCH)


def proj(e, p):
    return p[0] * e["x"] + p[1] * e["z"] + p[2] * e["y"]


def load(rel, drop_shadow=True):
    im = Image.open(os.path.join(VENDOR, rel)).convert("RGBA")
    a = np.array(im)
    if drop_shadow:
        # Kenney's shadow: black at partial alpha (its soft edge a little lighter)
        sh = (a[..., 3] < 250) & (a[..., :3].max(-1) < 40)
        a[sh, 3] = 0
    return Image.fromarray(a)


def body(im):
    a = np.array(im).astype(int)
    return a[..., 3] > 200


def measure_box(im, anchor=GROUND):
    """The body box (x0, x1, z0, z1, h) in Kenney tiles about `anchor`, from the silhouette's bottom, left and right
    corners (a box's lowest point is its (x1, z1) ground corner, its leftmost (x0, z1), its rightmost (x1, z0))."""
    ys, xs = np.nonzero(body(im))
    i = ys.argmax()
    vx, vy = xs[ys == ys.max()].mean(), ys.max() + 1
    lx, rx = xs.min(), xs.max() + 1
    m = np.c_[EI["x"], EI["z"]]
    x1, z1 = np.linalg.solve(m, np.array([vx, vy]) - np.array(anchor))
    x0 = x1 - (vx - lx) / EI["x"][0]
    z0 = z1 - (rx - vx) / EI["x"][0]
    # height: the left corner's vertical edge (its lowest body pixel to the silhouette's top there)
    lcol = ys[xs <= lx + 1]
    h = (lcol.max() + 1 - lcol.min()) / -EI["y"][1]
    return [float(v) for v in (x0, x1, z0, z1, h)]


def affine(src3, dst3):
    d = np.c_[np.array(dst3, dtype=float), np.ones(3)]
    m = np.linalg.solve(d, np.array(src3, dtype=float)).T
    return tuple(m.ravel())


def warp(im, src3, dst3):
    return im.transform(CANVAS, Image.AFFINE, affine(src3, dst3), resample=Image.BICUBIC)


class Mapper:
    """World points (Kenney tiles) to source pixels (Kenney camera) and canvas pixels (game camera, pivot at ORIGIN)."""

    def __init__(self, anchor, pivot, stretch=(1.0, 1.0, 1.0)):
        self.anchor = np.array(anchor)
        self.pivot = np.array(pivot, dtype=float)
        self.stretch = np.array(stretch, dtype=float)

    def src(self, p):
        return self.anchor + proj(EI, p)

    def dst(self, p):
        return ORIGIN + proj(EG, (np.array(p, dtype=float) - self.pivot) * self.stretch)


def poly_mask(points, grow=0):
    m = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in points], fill=255)
    return m.filter(ImageFilter.MaxFilter(grow)) if grow > 1 else m


def hull(points):
    """Convex hull (monotone chain) of 2D points."""
    pts = sorted(set((float(p[0]), float(p[1])) for p in points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def do_flat(im, mp, src_mask=None):
    if src_mask is not None:
        a = np.array(im)
        a[..., 3] = np.minimum(a[..., 3], np.array(src_mask))
        im = Image.fromarray(a)
    g = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    return warp(im, [mp.src(p) for p in g], [mp.dst(p) for p in g])


def do_box(im, mp, box):
    x0, x1, z0, z1, h = box
    faces = {
        "top": [(x0, z0, h), (x1, z0, h), (x0, z1, h), (x1, z1, h)],
        "xp": [(x1, z0, 0), (x1, z1, 0), (x1, z0, h), (x1, z1, h)],
        "zp": [(x0, z1, 0), (x1, z1, 0), (x0, z1, h), (x1, z1, h)],
    }
    # what lies outside every face in the source (a step, a book on the floor) goes on the ground's map, under the box
    sm = Image.new("L", im.size, 0)
    sd = ImageDraw.Draw(sm)
    for name, f in faces.items():
        q = [mp.src(f[i]) for i in (0, 1, 3, 2)]
        if name == "top":
            q = hull(q + [(p[0], p[1] - 400) for p in q])
        sd.polygon([tuple(p) for p in q], fill=255)
    sm = sm.filter(ImageFilter.MaxFilter(5))
    rest = np.array(im)
    rest[np.array(sm) > 0, 3] = 0
    out = do_flat(Image.fromarray(rest), mp)
    # paint the faces back to front: the top's overhangs go under the fronts
    for name in ("top", "xp", "zp"):
        f = faces[name]
        w = warp(im, [mp.src(p) for p in f[:3]], [mp.dst(p) for p in f[:3]])
        quad = [mp.dst(f[i]) for i in (0, 1, 3, 2)]
        if name == "top":
            # whatever stands above the box (a candle, a ladder's top) rides on the top face's map
            quad = hull(quad + [(p[0], p[1] - 400) for p in quad])
        m = poly_mask(quad, 5)
        layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        layer.paste(w, (0, 0), m)
        out.alpha_composite(layer)
    return out


def do_uniform(im, mp, k, at):
    """Scale y by k about the world ground point `at` (its source pixel lands on its game pixel)."""
    s = mp.src(at)
    d = mp.dst(at)
    # out -> in: x = x' - d.x + s.x ; y = (y' - d.y) / k + s.y
    return im.transform(CANVAS, Image.AFFINE, (1, 0, s[0] - d[0], 0, 1 / k, s[1] - d[1] / k), resample=Image.BICUBIC)


def reduce_and_grade(canvas, scale, grade, pad=2):
    a = np.array(canvas).astype(np.float64) / 255.0
    ys, xs = np.nonzero(a[..., 3] > 0.02)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    # crop on whole-pixel bounds, then a premultiplied Lanczos reduce
    a = a[y0:y1, x0:x1]
    al = a[..., 3:4]
    pm = np.concatenate([a[..., :3] * al, al], axis=2)
    w, h = max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale))
    ch = [Image.fromarray((pm[..., i] * 255).round().astype(np.uint8)).resize((w, h), Image.LANCZOS) for i in range(4)]
    o = np.stack([np.array(c).astype(np.float64) / 255.0 for c in ch], axis=2)
    oa = o[..., 3:4]
    rgb = np.where(oa > 0, o[..., :3] / np.maximum(oa, 1e-6), 0)
    img = Image.fromarray(np.clip(rgb * 255, 0, 255).round().astype(np.uint8), "RGB")
    if grade:
        img = ImageEnhance.Color(img).enhance(grade["saturation"])
        img = ImageEnhance.Brightness(img).enhance(grade["brightness"])
        img = ImageEnhance.Contrast(img).enhance(grade["contrast"])
        t = np.array(img).astype(np.float64) * np.array(grade["tint"])
        img = Image.fromarray(np.clip(t, 0, 255).round().astype(np.uint8), "RGB")
    res = img.convert("RGBA")
    alpha = np.clip(oa[..., 0] * 255, 0, 255).round().astype(np.uint8)
    alpha[alpha < 16] = 0  # the reduce's faint fringe and stray shadow-edge pixels
    res.putalpha(Image.fromarray(alpha))
    # trim to what is left after the fringe cut, then the 2 px margin render_kit.py leaves
    tx0, ty0, tx1, ty1 = res.getbbox()
    res = res.crop((tx0, ty0, tx1, ty1))
    out = Image.new("RGBA", (res.width + 2 * pad, res.height + 2 * pad))
    out.paste(res, (pad, pad))
    sx, sy = w / (x1 - x0), h / (y1 - y0)
    pivot = [round(float((ORIGIN[0] - x0) * sx - tx0 + pad), 2), round(float((ORIGIN[1] - y0) * sy - ty0 + pad), 2)]
    return out, pivot


def source_image(spec, v):
    layers = v.get("compose", spec.get("compose"))
    first = load(fmt(spec["src"], v), spec.get("dropShadow", True))
    if layers:
        base = Image.new("RGBA", first.size)
        for layer in layers:
            base.alpha_composite(load(fmt(layer, v), spec.get("dropShadow", True)))
        return base
    return first


def fmt(path, v):
    return path.replace("{f}", v["facing"])


def render(name, spec, cfg, boxes):
    tiles = spec.get("scale", cfg["scale"])  # game tiles to a Kenney tile
    gt = 1.0 / tiles  # one game tile in Kenney tiles
    scale = TILE_PX * tiles / KT_PX
    grade = {**cfg["grade"], **spec.get("grade", {})}
    results = []
    for v in spec["variants"]:
        im = source_image(spec, v)
        mode = v.get("mode", spec.get("mode", "box"))
        if mode == "flat":
            anchor = SURFACE
            mp = Mapper(anchor, (0, 0, 0))
            mask = None
            if spec.get("topOnly"):
                # a floor tile's top face only (its diamond); the slab's sides are not floor
                c = np.array(SURFACE)
                d = [c + proj(EI, p) for p in ((-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0))]
                mask = Image.new("L", im.size, 0)
                ImageDraw.Draw(mask).polygon([tuple(p) for p in d], fill=255)
            canvas = do_flat(im, mp, mask)
            if spec.get("pivot") == "bbox":
                ys, xs = np.nonzero(np.array(canvas)[..., 3] > 8)
                cx, cy = (xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2
                sh = np.round(ORIGIN - np.array([cx, cy])).astype(int)
                moved = Image.new("RGBA", CANVAS)
                moved.alpha_composite(canvas, (int(sh[0]), int(sh[1])))
                canvas = moved
            box = None
        else:
            key = fmt(v.get("boxFrom", spec.get("boxFrom", spec["src"])), v)
            if key not in boxes:
                boxes[key] = measure_box(load(key))
            box = v.get("box", spec.get("box")) or boxes[key]
            x0, x1, z0, z1, h = box
            wall = v.get("normal") if spec.get("wall") else None
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            if wall == "x":
                pivot = (x0 + gt / 2, cz, 0)
            elif wall == "z":
                pivot = (cx, z0 + gt / 2, 0)
            else:
                pivot = (cx, cz, 0)
            # `stretch` (box mode): the game box drawn that much longer along a wall piece's run (its wall's axis), about
            # the pivot: the wide bookcases fill the two cells they are drawn over (docs/KENNEY_DECOR.md KN3)
            st = float(v.get("stretch", spec.get("stretch", 1.0)))
            stretch = (1.0, st, 1.0) if wall == "x" else (st, 1.0, 1.0) if wall == "z" else (1.0, 1.0, 1.0)
            mp = Mapper(GROUND, pivot, stretch)
            at = (x0, cz, 0) if wall == "x" else (cx, z0, 0) if wall == "z" else (cx, cz, 0)
            if mode == "box":
                canvas = do_box(im, mp, box)
            else:
                canvas = do_uniform(im, mp, v.get("k", spec.get("k", 1.0)), at)
            # `layers`: more sources drawn over this one with the same pivot, each in its own mode (the stockpile:
            # the barrels uniform, the scaffold over them as a box)
            for layer in spec.get("layers", []):
                lim = load(fmt(layer["src"], v), spec.get("dropShadow", True))
                if layer.get("mode", "box") == "box":
                    lc = do_box(lim, mp, layer.get("box") or measure_box(lim))
                else:
                    lc = do_uniform(lim, mp, layer.get("k", 1.0), at)
                canvas.alpha_composite(lc)
        out, pv = reduce_and_grade(canvas, scale, grade)
        d = os.path.join(VENDOR, cfg["out"], name)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, v["file"])
        out.save(path)
        with open(path + ".pivot.json", "w") as f:
            json.dump(pv, f)
        foot = None if box is None else [round(float((box[1] - box[0]) * tiles * mp.stretch[0]), 2), round(float((box[3] - box[2]) * tiles * mp.stretch[1]), 2), round(float(box[4] * tiles), 2)]
        results.append((name, v["file"], out.size, pv, foot))
        print(f"{name}/{v['file']}: {out.size[0]}x{out.size[1]} pivot {pv}" + (f" box {foot} game tiles (x, z, h)" if foot else ""), flush=True)
    return results


def contact(results, cfg, path):
    ims = [(n, f, Image.open(os.path.join(VENDOR, cfg["out"], n, f)), pv) for n, f, _, pv, _ in results]
    cols = 10
    cw = max(i.width for _, _, i, _ in ims) + 8
    chh = max(i.height for _, _, i, _ in ims) + 8
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, rows * chh), (44, 42, 52, 255))
    dr = ImageDraw.Draw(sheet)
    for i, (n, f, im, pv) in enumerate(ims):
        x, y = (i % cols) * cw + 4, (i // cols) * chh + 4
        sheet.alpha_composite(im, (x, y))
        px, py = x + pv[0], y + pv[1]
        dr.rectangle([px - 0.5, py - 0.5, px + 0.5, py + 0.5], fill=(255, 60, 200, 255))
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
    sheet.save(path)
    print("contact", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--contact", default="")
    ap.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "kenney.json"))
    args = ap.parse_args()
    cfg = json.load(open(args.config))
    only = [s for s in args.only.split(",") if s]
    boxes, results = {}, []
    for name, spec in cfg["pieces"].items():
        if name.startswith("$") or (only and name not in only):
            continue
        results += render(name, spec, cfg, boxes)
    if args.contact:
        contact(results, cfg, args.contact)


if __name__ == "__main__":
    main()
