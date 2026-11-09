"""
Verdant biome tiles (biome.5) in the Lords of Pain ground's style: original art, procedural and deterministic.

  python3 scripts/art/verdant/gen_verdant_tiles.py [--out <dir>] [--seed <n>]

Writes <out>/verdant-floor.png and <out>/verdant-wall.png: seamless 256 x 256 textures at the stone floor's density
(256 px = 4 tiles, like tile.biome.1.floor's tilesPerImage 4). The molten and frost tiles' sibling: the same periodic
helpers (scripts/art/molten/gen_molten_tiles.py), an overgrown ruin where those have lava and rime.

  floor  weathered grey-green limestone flagstones (a jittered hex grid's Voronoi cells, lightly warped), the pack's grit
         and scratch layer, a soft top-left bevel per stone, and the growth: moss filling the joints and creeping over
         the stones' edges where a slow "damp" field allows, cushions of moss on some stones (a bumpy, lit surface),
         grass tufts sprouting from the joints, a scatter of small fallen leaves, lichen speckle and a few mossy hairline
         cracks. The stone stays dark (mean near the placeholder #1d2a1d) so the enemy bullets keep their 3:1 on the
         floor; every green is far from the pink bullets and the orange telegraph.
  wall   a wall face of coursed limestone blocks (8 courses of 32 px, staggered, rough edges), lit from above, moss
         lying along the top of most blocks and in the joints, lichen speckle, and ivy: vines trailing down across
         several courses, hung with small lit leaves.

Every layer is periodic (noise filtered in the Fourier domain, Voronoi with wrapped distances, strokes, blocks and
vines drawn modulo the size), so the textures tile without seams. Needs numpy and Pillow.
"""
import argparse, math, os, sys

sys.dont_write_bytecode = True  # no __pycache__ beside the molten script
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "molten"))
from gen_molten_tiles import N, blur_wrap, fbm, scratches, shade, wrapped_voronoi  # noqa: E402

FLOOR_STONE = np.array([26.0, 33.0, 25.0])  # weathered grey-green limestone, dark (placeholder floor #1d2a1d)
WALL_STONE = np.array([45.0, 56.0, 45.0])  # paler, warmer limestone blocks (placeholder wall #283626)
DESATURATE = 0.2  # stone pulled toward its own grey: the pack's stone is muted
MOSS_DEEP = np.array([22.0, 44.0, 20.0])  # moss in the joints and the shade
MOSS = np.array([40.0, 70.0, 30.0])  # moss cushions and caps
MOSS_LIT = np.array([74.0, 108.0, 46.0])  # moss catching the light, grass blade tips
LEAF = np.array([34.0, 62.0, 28.0])  # ivy leaves
LEAF_LIT = np.array([70.0, 104.0, 46.0])  # a leaf's lit edge
BLADE = np.array([52.0, 86.0, 34.0])  # grass blades (a fresher green than the moss)
LITTER = np.array([58.0, 50.0, 30.0])  # fallen leaves (dry olive-brown, kept dark: far from the telegraph's orange)
LICHEN = np.array([104.0, 112.0, 86.0])  # pale grey-green lichen speckle


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
    """Fine speckle: thresholded high-frequency noise, a little blurred so each fleck is 1-2 px."""
    n = fbm(rng, 0.2, 20)
    s = np.clip((n - (2.6 - density)) * 1.6, 0, 1)
    return np.clip(s + 0.6 * blur_wrap(s, size), 0, 1)


def moss_surface(rng, rgb, cover, lit_gain=1.0):
    """Paint moss where `cover` (0..1) says: a bumpy cushion texture, lit top-left, deep in its hollows."""
    bumps = fbm(rng, 1.3, 10) + 0.35 * fbm(rng, 0.8, 24)
    relief = shade(bumps * 1.6 + cover * 3.0, strength=0.5)
    c = np.clip(cover, 0, 1)[..., None]
    lightness = np.clip(0.58 + 0.16 * bumps + relief * lit_gain, 0, 1)[..., None]
    low = MOSS_DEEP + (MOSS - MOSS_DEEP) * np.minimum(lightness, 0.5) * 2  # deep -> moss over 0..0.5
    moss = low + (MOSS_LIT - MOSS) * np.maximum(lightness - 0.5, 0) * 2  # moss -> lit over 0.5..1
    return rgb * (1 - c) + moss * c


def stroke(canvas, x, y, ang, length, width, value, bend=0.0):
    """A tapered stroke drawn modulo N (for grass blades and vines): max-blends `value` into canvas."""
    steps = max(2, int(length * 2))
    for s in range(steps):
        t = s / (steps - 1)
        hw = width * (1.0 - t) * 0.5 + 0.35
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                px, py = x + ox, y + oy
                d = math.hypot(px - x, py - y)
                cov = max(0.0, min(1.0, hw + 0.5 - d))
                if cov > 0:
                    ix, iy = int(round(px)) % N, int(round(py)) % N
                    canvas[iy, ix] = max(canvas[iy, ix], cov * value * (0.55 + 0.45 * t))
        ang += bend
        x += math.cos(ang) * 0.5
        y += math.sin(ang) * 0.5


def blob(canvas, cx, cy, rx, ry, ang, value=1.0):
    """A small antialiased ellipse (a leaf) drawn modulo N; max-blends into canvas."""
    r = int(max(rx, ry)) + 2
    ca, sa = math.cos(ang), math.sin(ang)
    for py in range(int(cy) - r, int(cy) + r + 1):
        for px in range(int(cx) - r, int(cx) + r + 1):
            dx, dy = px + 0.5 - cx, py + 0.5 - cy
            u = (dx * ca + dy * sa) / rx
            v = (-dx * sa + dy * ca) / ry
            d = math.sqrt(u * u + v * v)
            cov = max(0.0, min(1.0, (1.0 - d) * min(rx, ry) + 0.5))
            if cov > 0:
                canvas[py % N, px % N] = max(canvas[py % N, px % N], cov * value)


def floor(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    # a light warp: cut limestone breaks fairly straight, worn soft at the edges
    wx = fbm(rng, 1.6, 2) * 3.4 + fbm(rng, 1.0, 8) * 0.9
    wy = fbm(rng, 1.6, 2) * 3.4 + fbm(rng, 1.0, 8) * 0.9
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
    joint = np.clip(1.0 - edge / 3.2, 0, 1) ** 1.5
    cell_tone = rng.normal(0, 0.08, len(pts))[idx]
    dome = np.clip(edge / 9.0, 0, 1) ** 0.7
    height = dome * 5.0 + fbm(rng, 1.2, 4) * 0.35
    relief = shade(height, strength=0.24)
    grit = fbm(rng, 0.55, 6)
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 70, 24, 0.42)
    scr = np.maximum(scr, 0.6 * blur_wrap(scr, 0.6))
    rgb = tone(FLOOR_STONE, grit, relief + cell_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.75 * joint)[..., None]
    # weathering stains: darker damp blotches across the stones
    stain = np.clip(fbm(rng, 1.5, 2) * 0.6 + 0.1, 0, 1)
    rgb *= (1.0 - 0.18 * stain)[..., None]

    # lichen speckle on the dry stone
    damp = np.clip((fbm(rng, 1.6, 2) + 0.45) * 1.1, 0, 1)  # where the moss has taken (about half the floor)
    lichen = speckle(rng, 0.95) * np.clip(1.0 - damp * 1.2, 0, 1) * np.clip(edge / 4.0, 0, 1)
    rgb = mix(rgb, LICHEN, lichen * 0.35)

    # moss in the joints, creeping over the stones' edges with a ragged front
    ragged = fbm(rng, 0.8, 10) * 0.9 + fbm(rng, 1.3, 4) * 0.6
    reach = 1.5 + 4.0 * damp + np.clip(ragged, -1.5, 1.5) * 1.1  # px from the joint the moss reaches
    joint_moss = np.clip((reach - edge) / 1.6, 0, 1) * np.clip(damp * 1.6 + 0.25, 0, 1)
    # cushions on some stones in the dampest places
    cushion = np.clip((fbm(rng, 1.4, 3) + fbm(rng, 0.9, 10) * 0.3 - 1.0 + damp * 0.9) * 1.8, 0, 1)
    cushion *= np.clip(damp * 1.5 - 0.2, 0, 1)
    cover = np.clip(np.maximum(joint_moss, cushion), 0, 1)
    cover = np.clip(blur_wrap(cover, 0.7) * 1.1, 0, 1)  # a soft, fuzzy front
    # a soft dark rim where moss meets bare stone (it sits proud of the stone)
    rim = np.clip(blur_wrap(cover, 1.0) - cover, 0, 1)
    rgb *= (1.0 - 0.45 * rim)[..., None]
    rgb = moss_surface(rng, rgb, cover * 0.95)
    # joints stay dark under the moss
    rgb *= (1.0 - 0.35 * joint * cover)[..., None]

    # mossy hairline cracks across a few stones
    h1, h2, _ = wrapped_voronoi([tuple(rng.uniform(0, N, 2)) for _ in range(45)], (x + wx) % N, (y + wy) % N)
    hair = np.clip(1.0 - (h2 - h1) / 1.0, 0, 1) * np.clip(fbm(rng, 1.5, 2) * 0.9, 0, 1)
    hair *= np.clip(edge / 4.0, 0, 1)
    rgb *= (1.0 - 0.35 * blur_wrap(hair, 1.0))[..., None]
    rgb = mix(rgb, MOSS_DEEP, np.clip(hair * 0.8, 0, 1) * 0.6)

    # grass tufts sprouting from the joints (damp places mostly)
    blades = np.zeros((N, N))
    joint_px = np.argwhere((edge < 1.6) & (damp > 0.15))
    for _ in range(140):
        jy, jx = joint_px[rng.integers(len(joint_px))]
        base_ang = rng.uniform(0, math.tau)
        for _ in range(int(rng.integers(3, 7))):
            ang = base_ang + rng.normal(0, 0.55)
            stroke(blades, jx + rng.normal(0, 0.8), jy + rng.normal(0, 0.8), ang,
                   rng.uniform(3.0, 7.5), rng.uniform(1.2, 2.0), 1.0, bend=rng.normal(0, 0.05))
    shadow = np.clip(np.roll(np.roll(blades, 1, 0), 1, 1) - blades, 0, 1)  # down-right, away from the light
    rgb *= (1.0 - 0.45 * shadow)[..., None]
    tip = np.clip(blades - 0.55, 0, 1) / 0.45  # strokes brighten toward their ends
    rgb = mix(rgb, BLADE, np.clip(blades * 1.4, 0, 1) * 0.95)
    rgb = mix(rgb, MOSS_LIT, tip * 0.8)

    # a scatter of small fallen leaves, mostly on bare stone
    litter = np.zeros((N, N))
    lit_edge = np.zeros((N, N))
    for _ in range(26):
        cx, cy = rng.uniform(0, N, 2)
        rx, ry, ang = rng.uniform(2.4, 3.6), rng.uniform(1.2, 1.8), rng.uniform(0, math.tau)
        blob(litter, cx, cy, rx, ry, ang)
        blob(lit_edge, cx - 0.7, cy - 0.7, rx * 0.8, ry * 0.6, ang, 0.8)
    rgb *= (1.0 - 0.35 * np.clip(np.roll(np.roll(litter, 1, 0), 1, 1) - litter, 0, 1))[..., None]
    shade_l = 0.75 + 0.25 * np.clip(lit_edge, 0, 1)
    litter_col = LITTER[None, None, :] * shade_l[..., None] * (1.0 + 0.15 * fbm(rng, 0.3, 30))[..., None]
    a = np.clip(litter, 0, 1)[..., None] * 0.9
    rgb = rgb * (1 - a) + litter_col * a
    return np.clip(rgb, 0, 255)


def wall(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    courses = 8
    ch = N // courses
    height = np.zeros((N, N))
    joint = np.zeros((N, N))
    block_tone = np.zeros((N, N))
    occl = np.zeros((N, N))
    top = np.zeros((N, N))  # depth below a block's top edge (px), for the moss caps
    block_moss = np.zeros((N, N))  # per block: how much of its top the moss covers (some blocks bare)
    wob = fbm(rng, 1.7, 2) * 1.6 + fbm(rng, 0.9, 10) * 0.5
    jw = 2.0 + 1.2 * np.clip(fbm(rng, 1.3, 3), -1, 1)
    vines = []
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
            mossy = rng.uniform() >= 0.3
            block_moss[rows] = np.where(inside, rng.uniform(0.5, 1.3) if mossy else 0.0, block_moss[rows])
    for _ in range(5):  # ivy: a few vines trailing down from anywhere (they wrap), 3-6 courses long
        vines.append((rng.uniform(0, N), rng.uniform(0, N), rng.uniform(3, 6) * ch))
    height += fbm(rng, 1.1, 4) * 0.5
    relief = shade(height, light=(-0.35, -1.0), strength=0.2)
    grit = fbm(rng, 0.55, 6) * 1.4
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 55, 18, 0.4)
    rgb = tone(WALL_STONE, grit, relief + block_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.8 * joint - 0.18 * occl)[..., None]
    # damp streaks running down the face from the joints
    streak = np.clip(blur_wrap(fbm(rng, 0.6, 12), 0.6) * 0.5, 0, 1)
    streak = np.clip(blur_wrap(np.repeat(streak.mean(axis=0, keepdims=True), N, 0), 1.0) + fbm(rng, 1.2, 3) * 0.3, 0, 1)
    rgb *= (1.0 - 0.14 * streak)[..., None]
    # lichen
    rgb = mix(rgb, LICHEN, speckle(rng, 0.85) * 0.3)
    # moss in the joints (patchy)
    joint_gate = np.clip(fbm(rng, 1.3, 2) * 0.8 + 0.5, 0, 1)
    joint_moss = np.clip(joint - 0.35, 0, 1) / 0.65 * joint_gate
    # moss along the top of each block: a band with a ragged lower edge, thicker in clumps, hanging over a little
    clump = 3.2 + 4.0 * np.clip(fbm(rng, 1.6, 2) * 0.8 + 0.4, 0, 1.3) + fbm(rng, 0.8, 12) * 1.2
    clump = clump * block_moss
    cap = np.clip((clump - top) / 1.4, 0, 1) * (top > 0.6)
    cover = np.clip(np.maximum(cap, joint_moss * 0.85), 0, 1)
    under = np.clip(1.0 - np.abs(top - clump - 1.3) / 1.5, 0, 1) * (cap < 0.5)  # a soft shadow under the cap
    rgb *= (1.0 - 0.25 * under)[..., None]
    rgb = moss_surface(rng, rgb, cover * 0.95, lit_gain=1.2)

    # ivy: a wandering stem with leaves on alternating sides
    stem = np.zeros((N, N))
    leaf = np.zeros((N, N))
    leaf_lit = np.zeros((N, N))
    leaf_tone = np.zeros((N, N))
    for vx, vy, length in vines:
        ang = math.pi / 2  # down
        s = 0.0
        side = 1
        while s < length:
            ang = math.pi / 2 + max(-0.6, min(0.6, (ang - math.pi / 2) + rng.normal(0, 0.12)))
            for ox in (-0.5, 0.0, 0.5):
                ix, iy = int(round(vx + ox)) % N, int(round(vy)) % N
                stem[iy, ix] = max(stem[iy, ix], 0.85 - abs(ox))
            vx += math.cos(ang) * 0.5
            vy += math.sin(ang) * 0.5
            s += 0.5
            if rng.uniform() < 0.13:
                la = ang + side * rng.uniform(0.9, 1.5)
                d = rng.uniform(3.0, 4.2)
                lx, ly = vx + math.cos(la) * d, vy + math.sin(la) * d
                rx, ry = rng.uniform(3.0, 4.2), rng.uniform(1.5, 2.1)
                blob(leaf, lx, ly, rx, ry, la)
                blob(leaf_lit, lx - 0.8, ly - 0.9, rx * 0.65, ry * 0.55, la, 0.9)
                blob(leaf_tone, lx, ly, rx + 0.5, ry + 0.5, la, rng.uniform(0.75, 1.15))
                side = -side
    body = np.clip(np.maximum(stem, leaf), 0, 1)
    shadow = np.clip(blur_wrap(np.roll(np.roll(body, 2, 0), 1, 1), 0.8) - body, 0, 1)  # cast down-right
    rgb *= (1.0 - 0.5 * shadow)[..., None]
    rgb = mix(rgb, MOSS_DEEP, stem * 0.9)
    leaf_col = LEAF[None, None, :] * (np.where(leaf_tone > 0, leaf_tone, 1.0) * (1.0 + 0.08 * fbm(rng, 0.3, 30)))[..., None]
    a = np.clip(leaf, 0, 1)[..., None]
    rgb = rgb * (1 - a) + leaf_col * a
    rgb = mix(rgb, LEAF_LIT, np.clip(leaf_lit, 0, 1) * np.clip(leaf, 0, 1) * 0.6)
    return np.clip(rgb, 0, 255)


def save(rgb, path):
    Image.fromarray(rgb.round().astype(np.uint8), "RGB").save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "..", "art", "vendor", "kaleb-vale", "verdant"))
    ap.add_argument("--seed", type=int, default=5)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    f = floor(np.random.default_rng(args.seed))
    w = wall(np.random.default_rng(args.seed + 1000))
    save(f, os.path.join(args.out, "verdant-floor.png"))
    save(w, os.path.join(args.out, "verdant-wall.png"))
    for name, a in (("floor", f), ("wall", w)):
        m = a.reshape(-1, 3).mean(0).round().astype(int)
        print(f"verdant-{name}.png: 256 x 256, mean #{m[0]:02x}{m[1]:02x}{m[2]:02x}")


if __name__ == "__main__":
    main()
