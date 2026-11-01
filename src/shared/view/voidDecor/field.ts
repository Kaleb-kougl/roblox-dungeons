/**
 * The void field (docs/VOID_DECOR.md VD2): per cell, the Chebyshev distance to the nearest non-void cell (a
 * two-pass chamfer transform from every wall / floor / pool cell; 0 on non-void cells), and the enclosed void pockets
 * (4-connected void components that touch neither the grid's edge). Pure, deterministic, allocation-light: a few flat
 * arrays per floor, no per-cell tables.
 */
import { TileType, type Dungeon } from "shared/dungeon";

/** A floor's void field (cells indexed y * W + x, like Dungeon.grid). */
export interface VoidField {
	readonly W: number;
	readonly H: number;
	/** Chebyshev distance to the nearest non-void cell; 0 on non-void cells. */
	readonly dist: ReadonlyArray<number>;
	/** Enclosed-pocket id per void cell (0..pocketCount - 1), -1 if its component touches the grid edge, or non-void. */
	readonly pocket: ReadonlyArray<number>;
	/** Number of enclosed pockets. */
	readonly pocketCount: number;
	/** Largest `dist` of each pocket's cells (index = pocket id). */
	readonly pocketMaxDist: ReadonlyArray<number>;
	/** Largest `dist` on the floor. */
	readonly maxDist: number;
}

/** The voidField of `d` (see the file comment). */
export function voidField(d: Dungeon): VoidField {
	const W = d.W;
	const H = d.H;
	const n = W * H;
	const grid = d.grid;
	// Chebyshev distance transform: two raster passes with unit weights on all eight neighbours (exact for the
	// chessboard metric), no queue. Cells start at 0 (non-void) or n (farther than any real distance).
	const dist = new Array<number>(n, 0);
	let anySolid = false;
	for (let c = 0; c < n; c++) {
		if (grid[c] === TileType.VOID) dist[c] = n;
		else anySolid = true;
	}
	for (let y = 0; y < H; y++) {
		const row = y * W;
		for (let x = 0; x < W; x++) {
			const c = row + x;
			let v = dist[c];
			if (v === 0) continue;
			if (x > 0 && dist[c - 1] + 1 < v) v = dist[c - 1] + 1;
			if (y > 0) {
				const u = c - W;
				if (dist[u] + 1 < v) v = dist[u] + 1;
				if (x > 0 && dist[u - 1] + 1 < v) v = dist[u - 1] + 1;
				if (x < W - 1 && dist[u + 1] + 1 < v) v = dist[u + 1] + 1;
			}
			dist[c] = v;
		}
	}
	let maxDist = 0;
	for (let y = H - 1; y >= 0; y--) {
		const row = y * W;
		for (let x = W - 1; x >= 0; x--) {
			const c = row + x;
			let v = dist[c];
			if (v === 0) continue;
			if (x < W - 1 && dist[c + 1] + 1 < v) v = dist[c + 1] + 1;
			if (y < H - 1) {
				const b = c + W;
				if (dist[b] + 1 < v) v = dist[b] + 1;
				if (x > 0 && dist[b - 1] + 1 < v) v = dist[b - 1] + 1;
				if (x < W - 1 && dist[b + 1] + 1 < v) v = dist[b + 1] + 1;
			}
			dist[c] = v;
			if (v > maxDist) maxDist = v;
		}
	}
	// A grid with no non-void cell at all keeps n everywhere (farther than any real distance).
	if (!anySolid) maxDist = n;
	const queue = new Array<number>(n, 0);

	// Enclosed pockets: 4-connected void components, flood-filled with the same queue array.
	const pocket = new Array<number>(n, -1);
	const seen = new Array<boolean>(n, false);
	const pocketMaxDist: number[] = [];
	let pocketCount = 0;
	for (let start = 0; start < n; start++) {
		if (seen[start] || grid[start] !== TileType.VOID) continue;
		seen[start] = true;
		queue[0] = start;
		let qt = 1;
		let qh = 0;
		let edge = false;
		let deepest = 0;
		while (qh < qt) {
			const c = queue[qh];
			qh++;
			const x = c % W;
			const y = (c - x) / W;
			if (dist[c] > deepest) deepest = dist[c];
			if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
			if (x > 0 && !seen[c - 1] && grid[c - 1] === TileType.VOID) {
				seen[c - 1] = true;
				queue[qt] = c - 1;
				qt++;
			}
			if (x < W - 1 && !seen[c + 1] && grid[c + 1] === TileType.VOID) {
				seen[c + 1] = true;
				queue[qt] = c + 1;
				qt++;
			}
			if (y > 0 && !seen[c - W] && grid[c - W] === TileType.VOID) {
				seen[c - W] = true;
				queue[qt] = c - W;
				qt++;
			}
			if (y < H - 1 && !seen[c + W] && grid[c + W] === TileType.VOID) {
				seen[c + W] = true;
				queue[qt] = c + W;
				qt++;
			}
		}
		if (edge) continue;
		for (let i = 0; i < qt; i++) pocket[queue[i]] = pocketCount;
		pocketMaxDist.push(deepest);
		pocketCount++;
	}
	return { W, H, dist, pocket, pocketCount, pocketMaxDist, maxDist };
}
