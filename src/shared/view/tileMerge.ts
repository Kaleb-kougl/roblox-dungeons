/**
 * Greedy rectangle meshing for the dungeon floor: covers every cell of one tile type with as few axis-aligned
 * rectangles as the greedy scan finds, so the world builder makes one Part per rectangle instead of one per tile.
 * Each matching cell is covered by exactly one rectangle (no overlaps), so floor colours and wall heights stay exact.
 *
 * Scan order: rows top to bottom (y), cells left to right (x). At the first uncovered matching cell the rectangle
 * grows right while cells match, then down while the whole row segment matches and is uncovered.
 *
 * @module
 */

/** Cells [x, x + w) x [y, y + h) of the grid (grid units: x = column, y = row). */
export interface TileRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** Rectangles covering every cell (x, y) of a W x H grid where `matches(x, y)` is true. */
export function greedyRects(W: number, H: number, matches: (x: number, y: number) => boolean): TileRect[] {
	const covered = table.create<boolean>(W * H, false);
	const out = new Array<TileRect>();
	for (let y = 0; y < H; y++) {
		let x = 0;
		while (x < W) {
			if (covered[y * W + x] || !matches(x, y)) {
				x++;
				continue;
			}
			let w = 1;
			while (x + w < W && !covered[y * W + x + w] && matches(x + w, y)) {
				w++;
			}
			let h = 1;
			let grow = true;
			while (grow && y + h < H) {
				for (let k = 0; k < w; k++) {
					const c = (y + h) * W + x + k;
					if (covered[c] || !matches(x + k, y + h)) {
						grow = false;
						break;
					}
				}
				if (grow) {
					h++;
				}
			}
			for (let dy = 0; dy < h; dy++) {
				for (let k = 0; k < w; k++) {
					covered[(y + dy) * W + x + k] = true;
				}
			}
			out.push({ x, y, w, h });
			x += w;
		}
	}
	return out;
}

/** Rectangles for every cell of `grid` (indexed y * W + x) equal to `value`. */
export function greedyRectsOf(grid: ReadonlyArray<number>, W: number, H: number, value: number): TileRect[] {
	return greedyRects(W, H, (x, y) => grid[y * W + x] === value);
}
