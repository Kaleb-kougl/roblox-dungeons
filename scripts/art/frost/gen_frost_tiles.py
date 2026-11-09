"""
Frost biome tiles (biome.3) in the Lords of Pain ground's style: original art, procedural and deterministic.

  python3 scripts/art/frost/gen_frost_tiles.py [--out <dir>] [--seed <n>]

Writes <out>/frost-floor.png and <out>/frost-wall.png: seamless 256 x 256 textures at the stone floor's density
(256 px = 4 tiles, like tile.biome.1.floor's tilesPerImage 4). The molten tiles' sibling: the same periodic helpers
(scripts/art/molten/gen_molten_tiles.py), cold stone and rime where the molten tiles have basalt and lava.

  floor  cold blue-grey slate flagstones (a jittered hex grid's Voronoi cells, lightly warped: flatter and more
         angular than the basalt), the pack's grit and scratch layer, a soft top-left bevel per stone, and frost: snow
         packed into some joints, a rime rim just inside the stones' edges, hoarfrost patches of fine crystal speckle and
         a few pale ice-filled hairline cracks. The stone stays dark (mean near the placeholder #1e2a33) so the
         enemy bullets keep their 3:1 on the floor; the frost is pale cyan-white, far from every danger hue.
  wall   a wall face of coursed blue-grey blocks (8 courses of 32 px, staggered, rough edges), lit from above, snow
         lying along the top of each block, rime in the joints and short icicles hanging from some blocks' lower edges.

Every layer is periodic (noise filtered in the Fourier domain, Voronoi with wrapped distances, strokes and blocks
drawn modulo the size), so the textures tile without seams. Needs numpy and Pillow.
"""
import argparse, os, sys

sys.dont_write_bytecode = True  # no __pycache__ beside the molten script
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "molten"))
from gen_molten_tiles import N, blur_wrap, fbm, scratches, shade, wrapped_voronoi  # noqa: E402

FLOOR_MEAN = np.array([28.0, 38.0, 48.0])  # cold slate (the placeholder frost floor is #1e2a33)
WALL_MEAN = np.array([44.0, 57.0, 68.0])  # lighter than the floor (placeholder wall #2a3842), so walls read as mass
DESATURATE = 0.25  # stone pulled toward its own grey: the pack's stone is muted
RIME = np.array([128.0, 160.0, 178.0])  # the frost rim and hoarfrost (pale, cold blue)
SNOW = np.array([178.0, 198.0, 210.0])  # packed snow in the joints and on the blocks' tops
ICE = np.array([96.0, 150.0, 178.0])  # ice in the cracks (a clearer cyan)
FROST_PEAK = 0.85  # the frost's strongest mix toward RIME / SNOW


def desaturate(rgb):
    grey = rgb.mean(axis=2, keepdims=True)
    return rgb * (1 - DESATURATE) + grey * DESATURATE


def tone(base, grit, relief, mottled, scratch):
    """Compose a stone colour: base RGB x (1 + variations), the scratches darkening."""
    v = 1.0 + 0.11 * grit + relief + 0.10 * mottled
    rgb = base[None, None, :] * v[..., None]
    return rgb * (1.0 - scratch[..., None])


def mix(rgb, colour, amount):
    a = np.clip(amount, 0, 1)[..., None]
    return rgb * (1 - a) + colour[None, None, :] * a


def speckle(rng, density, size=0.55):
    """Fine crystal speckle: thresholded high-frequency noise, a little blurred so each crystal is 1-2 px."""
    n = fbm(rng, 0.2, 20)
    s = np.clip((n - (2.6 - density)) * 1.6, 0, 1)
    return np.clip(s + 0.6 * blur_wrap(s, size), 0, 1)


def floor(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    # a lighter warp than the basalt: slate breaks straighter
    wx = fbm(rng, 1.6, 2) * 3.0 + fbm(rng, 1.0, 8) * 0.8
    wy = fbm(rng, 1.6, 2) * 3.0 + fbm(rng, 1.0, 8) * 0.8
    x = (xx + wx) % N
    y = (yy + wy) % N
    cols, rows = 5, 6
    pts = []
    for r in range(rows):
        for c in range(cols):
            px = (c + 0.5 * (r % 2)) * N / cols + rng.normal(0, 9)
            py = r * N / rows + rng.normal(0, 9)
            pts.append((px % N, py % N))
    for _ in range(4):  # a few smaller stones wedged between the big ones
        pts.append(tuple(rng.uniform(0, N, 2)))
    d1, d2, idx = wrapped_voronoi(pts, x, y)
    edge = d2 - d1  # 0 on a joint
    joint = np.clip(1.0 - edge / 3.0, 0, 1) ** 1.5
    cell_tone = rng.normal(0, 0.08, len(pts))[idx]
    dome = np.clip(edge / 9.0, 0, 1) ** 0.7
    height = dome * 5.0 + fbm(rng, 1.2, 4) * 0.35
    relief = shade(height, strength=0.24)
    grit = fbm(rng, 0.55, 6)
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 70, 24, 0.42)
    scr = np.maximum(scr, 0.6 * blur_wrap(scr, 0.6))
    rgb = tone(FLOOR_MEAN, grit, relief + cell_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.75 * joint)[..., None]

    # frost: a slow field decides where the cold has settled (about half the floor)
    cold = np.clip((fbm(rng, 1.8, 1) + 0.45) * 1.1, 0, 1)
    # rime rim just inside each stone's edge, lit side brighter (top-left light)
    rim = np.clip(1.0 - np.abs(edge - 3.6) / 1.8, 0, 1) * np.clip(fbm(rng, 1.0, 6) * 0.8 + 0.5, 0, 1)
    rim *= 0.75 + 0.25 * np.clip(relief * 6 + 0.5, 0, 1)
    rgb = mix(rgb, RIME, rim * cold * 0.35)
    # snow packed into the joints where the cold is deepest
    snow_gate = np.clip((cold - 0.2) * 2.5, 0, 1) * np.clip(fbm(rng, 1.3, 3) * 0.6 + 0.8, 0, 1)
    # the joint band only (no halo), broken up so it reads as packed grains, not a painted line; capped where a
    # small stone's whole face lies within the band, so no cell fills solid white
    grains = np.clip(fbm(rng, 0.4, 10) * 0.5 + 0.9, 0, 1)
    band = np.clip(1.0 - edge / 3.0, 0, 1) ** 0.9
    band = np.maximum(band, np.minimum(blur_wrap(band, 0.9), 0.5) * 0.7)  # a soft drift either side
    snow = band * snow_gate * grains
    snow *= np.clip((d1 - 2.0) / 4.0, 0, 1)  # thin out near a stone's seed (tiny cells)
    rgb = mix(rgb, SNOW, snow * FROST_PEAK * 0.85)
    # hoarfrost: crystal speckle over the stones, in patches
    hoar = speckle(rng, 1.05) * np.clip((cold - 0.3) * 1.6, 0, 1)
    rgb = mix(rgb, RIME, hoar * 0.6)
    # pale ice in a few hairline cracks across the stones
    h1, h2, _ = wrapped_voronoi([tuple(rng.uniform(0, N, 2)) for _ in range(50)], (x + wx) % N, (y + wy) % N)
    hair = np.clip(1.0 - (h2 - h1) / 1.0, 0, 1) * np.clip(fbm(rng, 1.5, 2) * 0.9, 0, 1)
    hair *= np.clip(edge / 4.0, 0, 1)  # not on the joints themselves
    rgb *= (1.0 - 0.3 * blur_wrap(hair, 1.0))[..., None]  # the crack's dark bed
    rgb = mix(rgb, ICE, np.clip(hair * 0.8 + blur_wrap(hair, 0.7) * 0.4, 0, 1) * 0.7 * np.clip(cold + 0.3, 0, 1))
    return np.clip(rgb, 0, 255)


def wall(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    courses = 8
    ch = N // courses
    height = np.zeros((N, N))
    joint = np.zeros((N, N))
    block_tone = np.zeros((N, N))
    occl = np.zeros((N, N))
    top = np.zeros((N, N))  # depth below a block's top edge (px), for the snow caps
    bottom = np.full((N, N), 1e3)  # distance above a block's bottom edge (px), for the icicles
    blockx = np.zeros((N, N))  # x within the block, for icicle placement
    wob = fbm(rng, 1.7, 2) * 1.6 + fbm(rng, 0.9, 10) * 0.5
    jw = 2.0 + 1.2 * np.clip(fbm(rng, 1.3, 3), -1, 1)
    icicles = np.zeros((N, N))
    block_snow = np.zeros((N, N))  # per block: how much of its top the snow covers (some blocks bare)
    hang = []
    for c in range(courses):
        y0 = c * ch
        widths = []
        while sum(widths) < N:
            widths.append(int(rng.integers(34, 70)))
        widths[-1] -= sum(widths) - N
        if widths[-1] < 20:
            widths[-2] += widths[-1]
            widths.pop()
        off = int(rng.integers(0, N))
        edges = np.cumsum([0] + widths)
        rows = slice(y0, y0 + ch)
        ly = yy[rows] - y0 + wob[rows] * 0.6
        for i, w in enumerate(widths):
            a = (edges[i] + off) % N
            lx = (xx[rows] - a + wob[rows]) % N
            inside = lx < w
            dx = np.minimum(lx, w - lx)
            dy = np.minimum(ly, ch - ly)
            dist = np.minimum(dx, dy)
            t = rng.normal(0, 0.12)
            height[rows] = np.where(inside, np.clip(dist / 6.0, 0, 1) ** 0.7 * 5.0, height[rows])
            joint[rows] = np.where(inside, np.clip(1.0 - dist / jw[rows], 0, 1) ** 1.4, joint[rows])
            occl[rows] = np.where(inside, np.clip(1.0 - dist / 7.0, 0, 1) ** 2, occl[rows])
            block_tone[rows] = np.where(inside, t, block_tone[rows])
            top[rows] = np.where(inside, ly, top[rows])
            bottom[rows] = np.where(inside, ch - ly, bottom[rows])
            blockx[rows] = np.where(inside, lx, blockx[rows])
            snowy = rng.uniform() >= 0.25
            block_snow[rows] = np.where(inside, rng.uniform(0.6, 1.25) if snowy else 0.0, block_snow[rows])
            # icicles hang from the snow on this block's top (placed now, drawn once the caps are known)
            if snowy and rng.uniform() < 0.55:
                for _ in range(int(rng.integers(1, 4))):
                    hang.append((a + rng.uniform(6, w - 6), y0, rng.uniform(5, 13), rng.uniform(1.0, 1.9)))
    height += fbm(rng, 1.1, 4) * 0.5
    relief = shade(height, light=(-0.35, -1.0), strength=0.2)
    grit = fbm(rng, 0.55, 6) * 1.4
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 55, 18, 0.4)
    rgb = tone(WALL_MEAN, grit, relief + block_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.8 * joint - 0.18 * occl)[..., None]
    # rime in the joints
    rime_gate = np.clip(fbm(rng, 1.3, 2) * 0.8 + 0.55, 0, 1)
    rgb = mix(rgb, RIME, np.clip(joint - 0.4, 0, 1) / 0.6 * rime_gate * 0.5)
    # snow along the top of each block: a band with a wobbly lower edge, thicker in drifts
    drift = 2.6 + 2.8 * np.clip(fbm(rng, 1.6, 2) * 0.8 + 0.4, 0, 1.3) + fbm(rng, 0.8, 12) * 0.5
    drift = drift * block_snow
    cap = np.clip((drift - top) / 1.2, 0, 1) * (top > 0.8)
    cap_shade = 0.82 + 0.18 * np.clip(1.0 - top / np.maximum(drift, 1), 0, 1)  # the cap's top catches the light
    rgb = mix(rgb, SNOW * 1.0, cap * FROST_PEAK)
    rgb *= np.where(cap > 0, cap_shade, 1.0)[..., None]
    # a soft shadow under the cap
    under = np.clip(1.0 - np.abs(top - drift - 1.2) / 1.4, 0, 1) * (cap < 0.5)
    rgb *= (1.0 - 0.18 * under)[..., None]
    # hoarfrost speckle, more near the tops of the blocks
    hoar = speckle(rng, 0.8) * np.clip(1.0 - top / 18.0, 0, 1)
    rgb = mix(rgb, RIME, hoar * 0.55)
    for ix, y0, length, half in hang:
        start = y0 + max(2, int(drift[y0 + 2, int(ix) % N]))  # the cap's lower edge
        for s in range(int(length) + 1):
            f = 1.0 - s / length  # tapers to a point
            hw = half * max(f, 0.0)
            py = int(start + s) % N
            for px in range(int(ix - half - 1), int(ix + half + 2)):
                cover = np.clip(hw + 0.5 - abs(px + 0.5 - ix), 0, 1)
                if cover > 0:
                    icicles[py, px % N] = max(icicles[py, px % N], cover * (0.5 + 0.5 * f))
    # each icicle's faint shadow on the stone, down-right
    rgb *= (1.0 - 0.25 * np.clip(np.roll(np.roll(icicles, 1, 0), 1, 1) - icicles, 0, 1))[..., None]
    # the icicles: ice with a lit left edge
    lit = np.clip(icicles - np.roll(icicles, 1, 1), 0, 1)
    rgb = mix(rgb, ICE, icicles * 0.9)
    rgb = mix(rgb, SNOW, lit * 0.5)
    return np.clip(rgb, 0, 255)


def save(rgb, path):
    Image.fromarray(rgb.round().astype(np.uint8), "RGB").save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "..", "art", "vendor", "kaleb-vale", "frost"))
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    f = floor(np.random.default_rng(args.seed))
    w = wall(np.random.default_rng(args.seed + 1000))
    save(f, os.path.join(args.out, "frost-floor.png"))
    save(w, os.path.join(args.out, "frost-wall.png"))
    for name, a in (("floor", f), ("wall", w)):
        m = a.reshape(-1, 3).mean(0).round().astype(int)
        print(f"frost-{name}.png: 256 x 256, mean #{m[0]:02x}{m[1]:02x}{m[2]:02x}")


if __name__ == "__main__":
    main()
