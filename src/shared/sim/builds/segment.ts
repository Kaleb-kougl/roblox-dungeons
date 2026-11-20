/**
 * The builds' point-to-segment test (Skewer's line, docs/LEGENDARIES.md LG4; Full Heart's beam, docs/BUILDS_V2.md
 * BV7). A pure leaf: no imports, so every rule module (and the bow, through ./fullHeart.ts) can share it without a
 * require cycle.
 *
 * @module
 */

/**
 * True when (x, z) lies within sqrt(`r2`) of the segment (x1, z1) -> (x2, z2): the squared distance to the nearest
 * point of the segment, with multiplies and comparisons only (no sqrt, no division): inside the segment's span the
 * squared perpendicular distance times the squared length is |p|^2 |d|^2 - (p . d)^2.
 */
export function nearSegment(x: number, z: number, x1: number, z1: number, x2: number, z2: number, r2: number): boolean {
	const dx = x2 - x1;
	const dz = z2 - z1;
	const px = x - x1;
	const pz = z - z1;
	const t = px * dx + pz * dz;
	if (t <= 0) return px * px + pz * pz <= r2;
	const len2 = dx * dx + dz * dz;
	if (t >= len2) {
		const ex = x - x2;
		const ez = z - z2;
		return ex * ex + ez * ez <= r2;
	}
	return (px * px + pz * pz) * len2 - t * t <= r2 * len2;
}
