"""
Molten biome tiles (biome.2) in the Lords of Pain ground's style: original art, procedural and deterministic.

  python3 scripts/art/molten/gen_molten_tiles.py [--out <dir>] [--seed <n>]

Writes <out>/molten-floor.png and <out>/molten-wall.png: seamless 256 x 256 textures at the stone floor's density
(256 px = 4 tiles, like tile.biome.1.floor's tilesPerImage 4).

  floor  basalt flagstones (a jittered hex grid's Voronoi cells, domain-warped so the joints wander like cooled
         columns), a fine grit and scratch layer like ground_stone1, a soft top-left bevel per stone for the pack's
         pre-rendered look, and lava glowing in many joints (owner, 2026-11-08: dim embers, then brighter): a red-orange
         halo (EMBER) round a hotter core (HOT). Kept red, not the telegraph's orange (CIE76 printed by the checks).
  wall   a wall face of coursed basalt blocks (8 courses of 32 px, staggered, rough edges), the same grit, a bevel
         lit from above and faint embers in a few joints.

Every layer is periodic (noise filtered in the Fourier domain, Voronoi with wrapped distances, strokes and blocks
drawn modulo the size), so the textures tile without seams. Needs numpy and Pillow.
"""
import argparse, math, os
import numpy as np
from PIL import Image

N = 256
FLOOR_MEAN = np.array([47.0, 33.0, 30.0])  # dark warm basalt (the placeholder molten floor is #2a1a16)
WALL_MEAN = np.array([62.0, 42.0, 36.0])  # lighter than the floor (placeholder wall #4a2a20), so walls read as mass
DESATURATE = 0.3  # stone pulled toward its own grey: the pack's stone is muted
EMBER = np.array([196.0, 50.0, 14.0])  # the glow round a seam (lava red)
HOT = np.array([235.0, 55.0, 20.0])  # the seam's core (bright lava red: CIE76 32 from the telegraph #ff8a3d, an orange)
EMBER_PEAK = 0.95  # the glow's strongest mix toward EMBER / HOT


def fbm(rng, beta, lo=1.0):
    """Periodic noise: white noise shaped to a 1 / f^beta spectrum (frequencies under `lo` dropped), unit std."""
    w = rng.standard_normal((N, N))
    f = np.fft.fftfreq(N) * N
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy)
    amp = np.where(r >= lo, 1.0 / np.maximum(r, 1e-6) ** beta, 0.0)
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * amp))
    return (out - out.mean()) / out.std()


def wrapped_voronoi(points, x, y):
    """F1, F2 distances and the nearest point's index, with wrap-around (periodic) distances."""
    d1 = np.full(x.shape, 1e9)
    d2 = np.full(x.shape, 1e9)
    idx = np.zeros(x.shape, dtype=int)
    for i, (px, py) in enumerate(points):
        dx = np.abs(x - px)
        dx = np.minimum(dx, N - dx)
        dy = np.abs(y - py)
        dy = np.minimum(dy, N - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idx = np.where(closer, i, idx)
        d1 = np.where(closer, d, d1)
    return d1, d2, idx


def shade(height, light=(-1.0, -1.0), strength=1.0):
    """Lambert-ish relief from a periodic height field, lit from `light` (image x, y; top-left by default)."""
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / 2
    lx, ly = light
    norm = math.hypot(lx, ly)
    return -(gx * lx + gy * ly) / norm * strength


def scratches(rng, count, length, darkness):
    """Short dark curved strokes like the pack's ground (drawn modulo N, so they wrap)."""
    out = np.zeros((N, N))
    for _ in range(count):
        x, y = rng.uniform(0, N, 2)
        ang = rng.uniform(0, math.tau)
        bend = rng.normal(0, 0.06)
        steps = int(rng.uniform(0.5, 1.0) * length)
        for s in range(steps):
            t = s / max(1, steps - 1)
            w = math.sin(math.pi * t)  # taper at both ends
            out[int(y) % N, int(x) % N] = max(out[int(y) % N, int(x) % N], darkness * w)
            ang += bend
            x += math.cos(ang)
            y += math.sin(ang)
    return out


def blur_wrap(a, radius):
    """A periodic Gaussian blur (Fourier domain)."""
    f = np.fft.fftfreq(N)
    fx, fy = np.meshgrid(f, f)
    g = np.exp(-2 * (math.pi * radius) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def tone(base, grit, relief, mottled, scratch):
    """Compose a stone colour: base RGB x (1 + variations), the scratches darkening."""
    v = 1.0 + 0.10 * grit + relief + 0.10 * mottled
    rgb = base[None, None, :] * v[..., None]
    return rgb * (1.0 - scratch[..., None])


def desaturate(rgb):
    grey = rgb.mean(axis=2, keepdims=True)
    return rgb * (1 - DESATURATE) + grey * DESATURATE


def floor(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    # domain warp: the joints wander
    wx = fbm(rng, 1.6, 2) * 5.0 + fbm(rng, 1.0, 8) * 1.2
    wy = fbm(rng, 1.6, 2) * 5.0 + fbm(rng, 1.0, 8) * 1.2
    x = (xx + wx) % N
    y = (yy + wy) % N
    # a jittered hex grid of stones, 5 columns x 6 rows (about 0.8 x 0.7 tiles each); 6 rows keep the grid periodic
    cols, rows = 5, 6
    pts = []
    for r in range(rows):
        for c in range(cols):
            px = (c + 0.5 * (r % 2)) * N / cols + rng.normal(0, 8)
            py = r * N / rows + rng.normal(0, 8)
            pts.append((px % N, py % N))
    for _ in range(6):  # a few small stones wedged between the big ones
        pts.append(tuple(rng.uniform(0, N, 2)))
    d1, d2, idx = wrapped_voronoi(pts, x, y)
    edge = d2 - d1  # 0 on a joint
    joint = np.clip(1.0 - edge / 3.2, 0, 1) ** 1.5  # the dark joint, about 3 px wide
    # each stone a little apart in tone, and pillowed (domed toward its middle) for the bevel
    cell_tone = rng.normal(0, 0.07, len(pts))[idx]
    dome = np.clip(edge / 10.0, 0, 1) ** 0.6
    height = dome * 6.0 + fbm(rng, 1.2, 4) * 0.35
    relief = shade(height, strength=0.22)
    grit = fbm(rng, 0.55, 6)  # fine grain
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 70, 26, 0.45)
    scr = np.maximum(scr, 0.6 * blur_wrap(scr, 0.6))
    # hairline cracks across the stones (a finer Voronoi, only where a noise lets them through)
    h1, h2, _ = wrapped_voronoi([tuple(rng.uniform(0, N, 2)) for _ in range(60)], (x + wx) % N, (y + wy) % N)
    hair = np.clip(1.0 - (h2 - h1) / 1.1, 0, 1) * np.clip(fbm(rng, 1.5, 2) * 0.9, 0, 1) * 0.5
    scr = np.maximum(scr, hair)
    rgb = tone(FLOOR_MEAN, grit, relief + cell_tone, mottled, scr)
    rgb = desaturate(rgb)
    # the joints sink dark
    rgb *= (1.0 - 0.78 * joint)[..., None]
    # embers: deep in the joints, only where a slow noise lets them through (some seams glow, most are cold)
    gate = np.clip((fbm(rng, 1.8, 1) + 0.15) * 1.3, 0, 1)
    flicker = 0.75 + 0.25 * np.clip(fbm(rng, 0.9, 3), -1, 1)
    core = np.clip(1.0 - edge / 1.9, 0, 1)
    glow = core * gate * flicker
    halo = blur_wrap(glow, 2.4) * 0.9
    e = np.clip(glow * EMBER_PEAK + halo * 0.5, 0, EMBER_PEAK)
    hot = np.clip(glow - 0.55, 0, 1) / 0.45  # the middle of the brightest seams
    col = EMBER[None, None, :] * (1 - hot[..., None]) + HOT[None, None, :] * hot[..., None]
    rgb = rgb * (1 - e[..., None]) + col * e[..., None]
    return np.clip(rgb, 0, 255)


def wall(rng):
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    courses = 8
    ch = N // courses
    height = np.zeros((N, N))
    joint = np.zeros((N, N))
    block_tone = np.zeros((N, N))
    occl = np.zeros((N, N))
    wob = fbm(rng, 1.7, 2) * 1.6 + fbm(rng, 0.9, 10) * 0.5  # rough, chipped block edges
    jw = 2.0 + 1.4 * np.clip(fbm(rng, 1.3, 3), -1, 1)  # the joint's width wanders
    for c in range(courses):
        y0 = c * ch
        # block widths partitioning N, offset so joints stagger (and wrap)
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
        ly = (yy[rows] - y0 + wob[rows] * 0.6)
        for i, w in enumerate(widths):
            a = (edges[i] + off) % N
            lx = (xx[rows] - a + wob[rows]) % N
            inside = lx < w
            # distance to this block's border (px)
            dx = np.minimum(lx, w - lx)
            dy = np.minimum(ly, ch - ly)
            dist = np.minimum(dx, dy)
            t = rng.normal(0, 0.12)
            height[rows] = np.where(inside, np.clip(dist / 6.0, 0, 1) ** 0.7 * 5.0, height[rows])
            joint[rows] = np.where(inside, np.clip(1.0 - dist / jw[rows], 0, 1) ** 1.4, joint[rows])
            occl[rows] = np.where(inside, np.clip(1.0 - dist / 7.0, 0, 1) ** 2, occl[rows])
            block_tone[rows] = np.where(inside, t, block_tone[rows])
    height += fbm(rng, 1.1, 4) * 0.5
    relief = shade(height, light=(-0.35, -1.0), strength=0.2)
    grit = fbm(rng, 0.55, 6)
    mottled = fbm(rng, 1.4, 2)
    scr = scratches(rng, 55, 18, 0.4)
    grit = grit * 1.4
    rgb = tone(WALL_MEAN, grit, relief + block_tone, mottled, scr)
    rgb = desaturate(rgb)
    rgb *= (1.0 - 0.8 * joint - 0.18 * occl)[..., None]
    # a few joints keep a faint ember
    gate = np.clip((fbm(rng, 1.8, 1) - 0.7) * 1.6, 0, 1)
    core = np.clip(joint - 0.55, 0, 1) / 0.45
    glow = core * gate
    halo = blur_wrap(glow, 2.0) * 0.8
    e = np.clip(glow * EMBER_PEAK * 0.85 + halo * 0.45, 0, EMBER_PEAK)
    rgb = rgb * (1 - e[..., None]) + EMBER[None, None, :] * e[..., None]
    return np.clip(rgb, 0, 255)


def save(rgb, path):
    Image.fromarray(rgb.round().astype(np.uint8), "RGB").save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "..", "art", "vendor", "kaleb-vale", "molten"))
    ap.add_argument("--seed", type=int, default=2)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    f = floor(np.random.default_rng(args.seed))
    w = wall(np.random.default_rng(args.seed + 1000))
    save(f, os.path.join(args.out, "molten-floor.png"))
    save(w, os.path.join(args.out, "molten-wall.png"))
    for name, a in (("floor", f), ("wall", w)):
        m = a.reshape(-1, 3).mean(0).round().astype(int)
        print(f"molten-{name}.png: 256 x 256, mean #{m[0]:02x}{m[1]:02x}{m[2]:02x}")


if __name__ == "__main__":
    main()
