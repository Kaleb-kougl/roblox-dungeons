"""
Grim biome tiles (biome.4, the Grim Vaults) in the Lords of Pain ground's style: original art, procedural and
deterministic.

  python3 scripts/art/grim/gen_grim_tiles.py [--out <dir>] [--seed <n>]

Writes <out>/grim-floor.png and <out>/grim-wall.png: seamless 256 x 256 textures at the stone floor's density
(256 px = 4 tiles, like tile.biome.1.floor's tilesPerImage 4). The molten and frost tiles' sibling: the same periodic
helpers (scripts/art/molten/gen_molten_tiles.py), crypt slate and grave moss where they have basalt and lava / slate
and rime.

  floor  crypt flagstones: dark violet-grey slate SLABS laid on a 32 px lattice (1 x 1 to 3 x 2 cells, packed with
         wrap-around so the bond never lines up), their edges wobbling and their corners worn round, the pack's grit
         and scratch layer, a soft top-left bevel per slab, damp stains, a few cracked slabs and one broken into shards,
         and one grave slab with a faint engraved border and cross. Grave moss (dim, desaturated green, the colour of
         the biome's wisps but far darker) grows in some joints and freckles nearby stone as lichen. The stone stays
         dark (mean near the placeholder #1c1a20) so the enemy bullets keep their 3:1.
  wall   crypt masonry: courses of mixed height (24 / 32 / 40 px, like rough ashlar), staggered blocks with chipped
         corners, lit from above, cracks in a few blocks, damp streaks running down from some joints, and moss on the
         tops of some blocks with short tendrils hanging from it.

Every layer is periodic (noise filtered in the Fourier domain, Voronoi with wrapped distances, slabs, blocks and
strokes drawn modulo the size), so the textures tile without seams. Needs numpy and Pillow.
"""
import argparse, math, os, sys

sys.dont_write_bytecode = True  # no __pycache__ beside the molten script
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "molten"))
from gen_molten_tiles import N, blur_wrap, fbm, scratches, shade, wrapped_voronoi  # noqa: E402

FLOOR_MEAN = np.array([36.0, 33.0, 41.0])  # crypt slate (the placeholder grim floor is #1c1a20; joints pull it down)
WALL_MEAN = np.array([62.0, 57.0, 68.0])  # lighter than the floor (placeholder wall #34303a), so walls read as mass
DESATURATE = 0.3  # stone pulled toward its own grey: the pack's stone is muted
MOSS = np.array([58.0, 76.0, 44.0])  # grave moss: the wisps' green (#9fe66a) darkened and greyed
LICHEN = np.array([84.0, 96.0, 66.0])  # paler lichen freckles
DAMP = 0.22  # how far a damp stain darkens the stone
CELL = 32  # the floor's slab lattice (px): half a tile
SLAB_SHAPES = ((2, 2, 6.0), (3, 2, 2.5), (2, 3, 2.5), (2, 1, 2.0), (1, 2, 2.0), (1, 1, 0.6))  # (w, h, weight) in cells


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
    """Fine freckles: thresholded high-frequency noise, a little blurred so each is 1-2 px."""
    n = fbm(rng, 0.2, 20)
    s = np.clip((n - (2.6 - density)) * 1.6, 0, 1)
    return np.clip(s + 0.6 * blur_wrap(s, size), 0, 1)


def pack_slabs(rng):
    """Slabs on the CELL lattice (G x G cells, wrapping): a list of (x, y, w, h) in cells, and each cell's slab index."""
    g = N // CELL
    owner = -np.ones((g, g), dtype=int)
    slabs = []

    def fits(cx, cy, w, h):
        return all(owner[(cy + j) % g, (cx + i) % g] < 0 for j in range(h) for i in range(w))

    def place(cx, cy, w, h):
        for j in range(h):
            for i in range(w):
                owner[(cy + j) % g, (cx + i) % g] = len(slabs)
        slabs.append((cx, cy, w, h))

    place(int(rng.integers(0, g)), int(rng.integers(0, g)), 2, 3)  # the grave slab, always first
    order = [(cx, cy) for cy in range(g) for cx in range(g)]
    rng.shuffle(order)
    weights = np.array([s[2] for s in SLAB_SHAPES])
    for cx, cy in order:
        if owner[cy, cx] >= 0:
            continue
        for k in rng.choice(len(SLAB_SHAPES), len(SLAB_SHAPES), replace=False, p=weights / weights.sum()):
            w, h, _ = SLAB_SHAPES[k]
            # any placement of the shape that covers this cell, in a random order
            anchors = [(cx - i, cy - j) for j in range(h) for i in range(w)]
            rng.shuffle(anchors)
            hit = next(((ax % g, ay % g) for ax, ay in anchors if fits(ax % g, ay % g, w, h)), None)
            if hit is not None:
                place(hit[0], hit[1], w, h)
                break
    return slabs, owner


def slab_fields(slabs, owner, x, y, corner):
    """Per pixel: the slab index, local coordinates, the slab's size (px) and the distance to its worn edge."""
    g = N // CELL
    cell_x = (x // CELL).astype(int) % g
    cell_y = (y // CELL).astype(int) % g
    idx = owner[cell_y, cell_x]
    sx = np.array([s[0] for s in slabs])[idx] * CELL
    sy = np.array([s[1] for s in slabs])[idx] * CELL
    w = np.array([s[2] for s in slabs])[idx] * CELL
    h = np.array([s[3] for s in slabs])[idx] * CELL
    lx = (x - sx) % N
    ly = (y - sy) % N
    dx = np.minimum(lx, w - lx)
    dy = np.minimum(ly, h - ly)
    edge = np.minimum(dx, dy)
    # worn corners: inside a corner's square the distance is to a quarter circle
    cx = np.clip(corner - dx, 0, None)
    cy = np.clip(corner - dy, 0, None)
    in_corner = (dx < corner) & (dy < corner)
    edge = np.where(in_corner, corner - np.sqrt(cx * cx + cy * cy), edge)
    return idx, lx, ly, w, h, edge


def floor(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    # a light warp: hand-cut slabs, not a printed grid
    wx = fbm(rng, 1.6, 2) * 1.6 + fbm(rng, 1.0, 10) * 0.6
    wy = fbm(rng, 1.6, 2) * 1.6 + fbm(rng, 1.0, 10) * 0.6
    x = (xx + wx) % N
    y = (yy + wy) % N
    slabs, owner = pack_slabs(rng)
    corner = 5.0 + 2.0 * np.clip(fbm(rng, 1.2, 4), -1, 1)
    idx, lx, ly, w, h, edge = slab_fields(slabs, owner, x, y, corner)
    # chipped edges: the joint eats into the slab where a noise says so
    chip = np.clip(fbm(rng, 1.1, 6) * 1.1, 0, None) * 1.4
    edge = edge - chip
    jw = 2.2
    joint = np.clip(1.0 - edge / jw, 0, 1) ** 1.4
    count = len(slabs)
    slab_tone = rng.normal(0, 0.075, count)[idx]
    # slabs sit a little uneven: a slight per-slab tilt in the bevel's height
    tilt_x = rng.normal(0, 0.012, count)[idx]
    tilt_y = rng.normal(0, 0.012, count)[idx]
    dome = np.clip(edge / 8.0, 0, 1) ** 0.6
    height = dome * 4.5 + (lx * tilt_x + ly * tilt_y) + fbm(rng, 1.2, 4) * 0.35

    # one slab broken into shards (never the grave slab): a few Voronoi seeds inside it
    broken = 1 + int(rng.integers(0, count - 1))
    bx, by, bw, bh = slabs[broken]
    seeds = [((bx * CELL + rng.uniform(4, bw * CELL - 4)) % N, (by * CELL + rng.uniform(4, bh * CELL - 4)) % N)
             for _ in range(4 + bw * bh)]
    s1, s2, sidx = wrapped_voronoi(seeds, x, y)
    in_broken = idx == broken
    shard_edge = s2 - s1
    shard_joint = np.clip(1.0 - shard_edge / 1.6, 0, 1) ** 1.2 * in_broken
    joint = np.maximum(joint, shard_joint * 0.9)
    shard_tone = rng.normal(0, 0.06, len(seeds))[sidx] * in_broken
    height += np.where(in_broken, np.clip(shard_edge / 5.0, 0, 1) ** 0.6 * 2.0 - 2.0, 0.0)

    # the grave slab (index 0): an engraved border inset 6 px and a cross on the upper two thirds
    gx, gy, gw, gh = slabs[0]
    on_grave = idx == 0
    border = np.clip(1.6 - np.abs(edge + chip - 8.0), 0, 1)
    cxm = gw * CELL / 2
    cross_v = (np.abs(lx - cxm) < 1.6) & (ly > 16) & (ly < gh * CELL * 0.72)
    cross_h = (np.abs(ly - gh * CELL * 0.34) < 1.6) & (np.abs(lx - cxm) < gw * CELL * 0.24)
    groove = np.maximum(border, (cross_v | cross_h).astype(float)) * on_grave
    groove = np.clip(groove * np.clip(fbm(rng, 1.0, 6) * 0.4 + 0.95, 0, 1), 0, 1)  # worn in places
    height -= groove * 1.2

    relief = shade(height, strength=0.22)
    grit = fbm(rng, 0.55, 6)
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 80, 24, 0.42)
    scr = np.maximum(scr, 0.6 * blur_wrap(scr, 0.6))
    # hairline cracks across some slabs (a finer Voronoi, gated per slab and by noise)
    cracked = rng.uniform(0, 1, count) < 0.3
    cracked[0] = False
    h1, h2, _ = wrapped_voronoi([tuple(rng.uniform(0, N, 2)) for _ in range(40)], (x + wx * 2) % N, (y + wy * 2) % N)
    hair = np.clip(1.0 - (h2 - h1) / 1.0, 0, 1) * np.clip(fbm(rng, 1.5, 2) * 1.1 + 0.2, 0, 1)
    hair *= cracked[idx] * np.clip((edge - 2.0) / 3.0, 0, 1)
    scr = np.maximum(scr, hair * 0.55)

    rgb = tone(FLOOR_MEAN, grit, relief + slab_tone + shard_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.78 * joint)[..., None]
    # the engraving: a dark cut with its lower-right lip catching the top-left light
    lip = np.clip(np.roll(np.roll(groove, 1, 0), 1, 1) - groove, 0, 1)
    rgb *= (1.0 - 0.6 * groove + 0.55 * lip)[..., None]
    # damp: slow dark stains, soaking out from the joints more than the middles
    damp = np.clip(fbm(rng, 1.9, 1) * 0.9 - 0.1, 0, 1) * (0.6 + 0.4 * np.clip(1.0 - edge / 12.0, 0, 1))
    rgb *= (1.0 - DAMP * damp)[..., None]

    # grave moss: in the joints where a slow field lets it grow (about a third of the floor), creeping a little onto
    # the slabs' edges, and lichen freckles round it
    grow = np.clip((fbm(rng, 1.8, 1) + 0.1) * 1.3, 0, 1)
    tufts = np.clip(fbm(rng, 0.5, 8) * 0.6 + 0.75, 0, 1)
    band = np.clip(1.0 - (edge - 0.5) / 4.2, 0, 1) ** 1.1
    moss = band * grow * tufts
    rgb = mix(rgb, MOSS, moss * 0.85)
    lichen = speckle(rng, 0.9) * np.clip(grow * 1.3 - 0.15, 0, 1) * np.clip(1.0 - edge / 14.0, 0, 1)
    rgb = mix(rgb, LICHEN, lichen * 0.45)
    return np.clip(rgb, 0, 255)


def course_heights(rng):
    """Mixed course heights summing to N (rough ashlar)."""
    while True:
        hs = []
        while sum(hs) < N:
            hs.append(int(rng.choice([24, 32, 32, 40])))
        if sum(hs) == N:
            return hs


def wall(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    height = np.zeros((N, N))
    joint = np.zeros((N, N))
    block_tone = np.zeros((N, N))
    occl = np.zeros((N, N))
    top = np.zeros((N, N))  # depth below a block's top edge (px), for the moss caps
    block_moss = np.zeros((N, N))  # per block: how much moss its top carries (most blocks bare)
    cracked = np.zeros((N, N))
    wob = fbm(rng, 1.7, 2) * 1.8 + fbm(rng, 0.9, 10) * 0.7  # rough, chipped block edges
    jw = 2.2 + 1.2 * np.clip(fbm(rng, 1.3, 3), -1, 1)
    hang = []  # moss tendrils
    streaks = []  # damp streaks
    y0 = 0
    for ch in course_heights(rng):
        widths = []
        while sum(widths) < N:
            widths.append(int(rng.integers(36, 76)))
        widths[-1] -= sum(widths) - N
        if widths[-1] < 22:
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
            corner = rng.uniform(3, 8)  # worn corners
            cx = np.clip(corner - dx, 0, None)
            cy = np.clip(corner - dy, 0, None)
            dist = np.where((dx < corner) & (dy < corner), corner - np.sqrt(cx * cx + cy * cy), np.minimum(dx, dy))
            t = rng.normal(0, 0.11)
            height[rows] = np.where(inside, np.clip(dist / 6.0, 0, 1) ** 0.7 * 5.0, height[rows])
            joint[rows] = np.where(inside, np.clip(1.0 - dist / jw[rows], 0, 1) ** 1.4, joint[rows])
            occl[rows] = np.where(inside, np.clip(1.0 - dist / 7.0, 0, 1) ** 2, occl[rows])
            block_tone[rows] = np.where(inside, t, block_tone[rows])
            top[rows] = np.where(inside, ly, top[rows])
            mossy = rng.uniform() < 0.3
            block_moss[rows] = np.where(inside, rng.uniform(0.6, 1.2) if mossy else 0.0, block_moss[rows])
            cracked[rows] = np.where(inside, 1.0 if rng.uniform() < 0.22 else 0.0, cracked[rows])
            if mossy and rng.uniform() < 0.6:
                for _ in range(int(rng.integers(1, 4))):
                    hang.append((a + rng.uniform(5, w - 5), y0, rng.uniform(7, 18)))
            if rng.uniform() < 0.28:  # a damp streak down from this block's top joint
                streaks.append((a + rng.uniform(4, w - 4), y0, rng.uniform(22, 60), rng.uniform(2.0, 4.5)))
        y0 += ch
    height += fbm(rng, 1.1, 4) * 0.55
    # cracks in some blocks
    h1, h2, _ = wrapped_voronoi([tuple(rng.uniform(0, N, 2)) for _ in range(36)], xx, yy)
    hair = np.clip(1.0 - (h2 - h1) / 1.0, 0, 1) * np.clip(fbm(rng, 1.5, 2) * 1.1 + 0.2, 0, 1) * cracked
    hair *= np.clip(1.0 - joint * 2, 0, 1)
    height -= hair * 0.8
    relief = shade(height, light=(-0.35, -1.0), strength=0.2)
    grit = fbm(rng, 0.55, 6) * 1.4
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 60, 18, 0.4)
    scr = np.maximum(scr, hair * 0.6)
    rgb = tone(WALL_MEAN, grit, relief + block_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.8 * joint - 0.2 * occl)[..., None]
    # damp streaks: soft dark runs, widest at the joint they leak from, fading down
    wet = np.zeros((N, N))
    for sx, sy, length, half in streaks:
        for s in range(int(length)):
            f = 1.0 - s / length
            hw = half * (0.6 + 0.4 * f)
            py = int(sy + s) % N
            for px in range(int(sx - hw - 1), int(sx + hw + 2)):
                cover = np.clip(hw + 0.5 - abs(px + 0.5 - sx), 0, 1) * f
                wet[py, px % N] = max(wet[py, px % N], cover)
    wet = blur_wrap(wet, 1.2) * np.clip(fbm(rng, 0.9, 6) * 0.4 + 0.8, 0, 1)
    rgb *= (1.0 - 0.42 * np.clip(wet * 1.3, 0, 1))[..., None]
    # moss in some joints
    grow = np.clip((fbm(rng, 1.8, 1) - 0.35) * 1.5, 0, 1)
    rgb = mix(rgb, MOSS * 0.8, np.clip(joint - 0.35, 0, 1) / 0.65 * grow * 0.7)
    # moss caps on the tops of some blocks: a ragged band
    depth = (3.0 + 3.2 * np.clip(fbm(rng, 1.4, 3) * 0.8 + 0.4, 0, 1.4) + fbm(rng, 0.6, 12) * 0.9) * block_moss
    cap = np.clip((depth - top) / 1.3, 0, 1) * (top > 0.6)
    cap *= np.clip(fbm(rng, 0.5, 10) * 0.5 + 0.85, 0, 1)
    cap_shade = 0.8 + 0.25 * np.clip(1.0 - top / np.maximum(depth, 1), 0, 1)
    rgb = mix(rgb, MOSS * 1.1, cap * 0.92)
    rgb *= np.where(cap > 0.05, cap_shade, 1.0)[..., None]
    lichen = speckle(rng, 0.8) * np.clip(1.0 - top / 10.0, 0, 1) * np.clip(block_moss, 0, 1)
    rgb = mix(rgb, LICHEN, lichen * 0.5)
    # tendrils hanging from the caps
    vines = np.zeros((N, N))
    for ix, yt, length in hang:
        start = yt + max(2, int(depth[(yt + 2) % N, int(ix) % N]))
        sway = rng.uniform(-0.25, 0.25)
        for s in range(int(length) + 1):
            f = 1.0 - s / length
            px = ix + sway * s
            py = int(start + s) % N
            for qx in range(int(px - 2), int(px + 3)):
                cover = np.clip(0.5 + 0.6 * f + 0.5 - abs(qx + 0.5 - px), 0, 1)
                if cover > 0:
                    vines[py, qx % N] = max(vines[py, qx % N], cover * (0.55 + 0.45 * f))
    rgb *= (1.0 - 0.22 * np.clip(np.roll(np.roll(vines, 1, 0), 1, 1) - vines, 0, 1))[..., None]  # faint shadow
    rgb = mix(rgb, MOSS, vines * 0.95)
    return np.clip(rgb, 0, 255)


def save(rgb, path):
    Image.fromarray(rgb.round().astype(np.uint8), "RGB").save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "..", "art", "vendor", "kaleb-vale", "grim"))
    ap.add_argument("--seed", type=int, default=4)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    f = floor(np.random.default_rng(args.seed))
    w = wall(np.random.default_rng(args.seed + 1000))
    save(f, os.path.join(args.out, "grim-floor.png"))
    save(w, os.path.join(args.out, "grim-wall.png"))
    for name, a in (("floor", f), ("wall", w)):
        m = a.reshape(-1, 3).mean(0).round().astype(int)
        print(f"grim-{name}.png: 256 x 256, mean #{m[0]:02x}{m[1]:02x}{m[2]:02x}")


if __name__ == "__main__":
    main()
