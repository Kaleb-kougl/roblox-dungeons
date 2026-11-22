/*
 * Ported from Dungeon Forge (https://github.com/majidmanzarpour/threejs-procedural-dungeon), src/main.js.
 * MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of the web build's src/dungeon/forge/delaunay.ts @ 42897e2. Same arithmetic in the same order
 * (the circumcircle test decides which edges exist, so it must match bit for bit).
 */
import { jsRem } from "shared/jsmath";

/** A point of the triangulation (a room centre). */
export interface Point2 {
	/** x, in the caller's units. */
	x: number;
	/** y, in the caller's units. */
	y: number;
}

interface Vtx {
	x: number;
	y: number;
	/** Input index; -1..-3 for the super-triangle. */
	i: number;
}

interface Tri {
	v: [Vtx, Vtx, Vtx];
	ccx: number;
	ccy: number;
	r2: number;
}

/** Below this |determinant| the triangle is degenerate (infinite circumcircle). */
const DEGENERATE_EPS = 1e-12;
/** Golden-ratio / sqrt(2) jitter that breaks co-circular ties, scaled by JITTER_SCALE. */
const JITTER_X = 0.618033;
const JITTER_Y = 0.414213;
const JITTER_SCALE = 1e-3;
/** Super-triangle size, in multiples of the point set's extent. */
const SUPER_SCALE = 30;
/** Edge key: lo * EDGE_KEY_MUL + hi (room counts stay below 4096). */
const EDGE_KEY_MUL = 4096;

function mkTri(a: Vtx, b: Vtx, c: Vtx): Tri {
	const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
	if (math.abs(d) < DEGENERATE_EPS) return { v: [a, b, c], ccx: 0, ccy: 0, r2: math.huge };
	const a2 = a.x * a.x + a.y * a.y,
		b2 = b.x * b.x + b.y * b.y,
		c2 = c.x * c.x + c.y * c.y;
	const ccx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
	const ccy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
	const r2 = (a.x - ccx) * (a.x - ccx) + (a.y - ccy) * (a.y - ccy);
	return { v: [a, b, c], ccx, ccy, r2 };
}

/**
 * Bowyer-Watson Delaunay triangulation. Returns unique undirected edges [lo, hi] in the
 * original's discovery order (the MST and loop stages depend on that order).
 */
export function delaunay(pts: ReadonlyArray<Point2>): Array<[number, number]> {
	const n = pts.size();
	if (n < 2) return [];
	if (n === 2) return [[0, 1]];
	// Tiny deterministic jitter breaks co-circular ties.
	const P: Vtx[] = pts.map((p, i) => ({
		x: p.x + jsRem(i * JITTER_X, 1) * JITTER_SCALE,
		y: p.y + jsRem(i * JITTER_Y, 1) * JITTER_SCALE,
		i,
	}));
	let minX = 1e18,
		minY = 1e18,
		maxX = -1e18,
		maxY = -1e18;
	for (const p of P) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	// Math.max(a, b, 1): no NaN or -0 can occur here (finite extents, the 1 wins over any zero).
	const dm = math.max(maxX - minX, maxY - minY, 1),
		mx = (minX + maxX) / 2,
		my = (minY + maxY) / 2;
	const s1: Vtx = { x: mx - SUPER_SCALE * dm, y: my - dm, i: -1 },
		s2: Vtx = { x: mx, y: my + SUPER_SCALE * dm, i: -2 },
		s3: Vtx = { x: mx + SUPER_SCALE * dm, y: my - dm, i: -3 };

	let tris: Tri[] = [mkTri(s1, s2, s3)];
	for (const p of P) {
		const bad: Tri[] = [],
			edges: Array<[Vtx, Vtx]> = [];
		for (const t of tris) {
			if ((p.x - t.ccx) * (p.x - t.ccx) + (p.y - t.ccy) * (p.y - t.ccy) < t.r2) bad.push(t);
		}
		for (const t of bad) for (let e = 0; e < 3; e++) edges.push([t.v[e], t.v[(e + 1) % 3]]);
		const poly: Array<[Vtx, Vtx]> = [];
		const ne = edges.size();
		for (let i = 0; i < ne; i++) {
			let shared = false;
			for (let j = 0; j < ne; j++) {
				if (i === j) continue;
				const a = edges[i],
					b = edges[j];
				if ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])) {
					shared = true;
					break;
				}
			}
			if (!shared) poly.push(edges[i]);
		}
		tris = tris.filter((t) => !bad.includes(t));
		for (const e of poly) tris.push(mkTri(e[0], e[1], p));
	}
	tris = tris.filter((t) => t.v[0].i >= 0 && t.v[1].i >= 0 && t.v[2].i >= 0);
	const seen = new Set<number>(),
		out: Array<[number, number]> = [];
	for (const t of tris)
		for (let e = 0; e < 3; e++) {
			const a = t.v[e].i,
				b = t.v[(e + 1) % 3].i,
				lo = math.min(a, b),
				hi = math.max(a, b),
				k = lo * EDGE_KEY_MUL + hi;
			// membership only: the output order is the push order of `out`, not Set iteration
			if (!seen.has(k)) {
				seen.add(k);
				out.push([lo, hi]);
			}
		}
	return out;
}
