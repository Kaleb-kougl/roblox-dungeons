/**
 * The spacing brake (docs/SWORD_SPACING.md Design 2, SP1; a Roblox-port feature, no web source): a player's step is
 * cut so that it never ends inside a contact enemy's keep distance, and never deeper inside one than it started.
 *
 * A LEAF: it imports nothing from the sim but a type (player.ts and the sword import it; the list is filled by
 * ./spacing.ts).
 *
 * Contract (pinned by spacing.spec.ts): pure and deterministic (fixed entry order, + - * / and sqrt only, no trig, no
 * allocation per call); the result is never longer than the step and never against it (result . step >= 0); for every
 * entry the end distance is >= min(start distance, keep) (a body already inside keep is never pushed out, only kept
 * from going deeper); far from every entry, or with an empty list, the result is the step itself, bit for bit.
 *
 * @module
 */

import type { SpacingConfig } from "./spacingData";

/**
 * One tick's brake (docs/SWORD_SPACING.md Design 1, SP2 / SP3): the sim's spacing list built from the tick-start state
 * and the run's config. step.ts builds it once per tick (only with SimConfig.spacing) and hands it to every stepPlayer
 * and to stepCombat (SimCtx.spacing, the finisher's lunge); undefined everywhere means no brake at all.
 */
export interface SpacingTick {
	/**
	 * The contact enemies to keep off this tick, built from the tick-start state (so every player and the lunge brake
	 * against the same positions).
	 */
	readonly list: Readonly<SpacingList>;
	/** The run's spacing tunables (`SimConfig.spacing`). */
	readonly config: Readonly<SpacingConfig>;
}

/** A flat list of brake entries (centre x / z and keep distance). The arrays grow, never shrink; `count` are live. */
export interface SpacingList {
	/** Entry centres' x, tiles. Only indices below `count` are live. */
	x: number[];
	/** Entry centres' z, tiles. Same index as `x`. */
	z: number[];
	/**
	 * Each entry's keep distance, tiles from its centre: a braked step never ends closer than this (or than it started,
	 * when already inside). Same index as `x`.
	 */
	keep: number[];
	/** Live entries; the arrays may be longer (stale slots kept for reuse). */
	count: number;
}

/** An empty list. */
export function newSpacingList(): SpacingList {
	return { x: [], z: [], keep: [], count: 0 };
}

/** Empties the list (the arrays keep their slots for reuse). */
export function clearSpacingList(list: SpacingList): void {
	list.count = 0;
}

/** Appends one entry: a contact enemy's centre and its keep distance (tiles). */
export function pushSpacingEntry(list: SpacingList, x: number, z: number, keep: number): void {
	const i = list.count;
	if (i < list.x.size()) {
		list.x[i] = x;
		list.z[i] = z;
		list.keep[i] = keep;
	} else {
		list.x.push(x);
		list.z.push(z);
		list.keep.push(keep);
	}
	list.count = i + 1;
}

/** brakeStep's result (module scratch, valid until the next call). `engaged`: the result differs from the step. */
export const BRAKE_RESULT: { x: number; z: number; engaged: boolean } = { x: 0, z: 0, engaged: false };

/**
 * The check pass's tolerance (tiles): an end this little short of min(start distance, keep) is float rounding of the
 * cut arithmetic, not a violation (the cut lands on the keep circle itself).
 */
const VIOLATION_EPS = 1e-9;

/** True when the step (rx, rz) from (px, pz) ends deeper inside entry i than min(start distance, keep) allows. */
function violates(list: Readonly<SpacingList>, i: number, px: number, pz: number, rx: number, rz: number): boolean {
	const keep = list.keep[i];
	const wx = px - list.x[i];
	const wz = pz - list.z[i];
	const d2 = wx * wx + wz * wz;
	const bound = (d2 < keep * keep ? math.sqrt(d2) : keep) - VIOLATION_EPS;
	if (bound <= 0) return false;
	const ex = wx + rx;
	const ez = wz + rz;
	return ex * ex + ez * ez < bound * bound;
}

/** True when (rx, rz) keeps the contract against the step (sx, sz): never against it, no entry violated. */
function brakeValid(
	list: Readonly<SpacingList>,
	px: number,
	pz: number,
	sx: number,
	sz: number,
	rx: number,
	rz: number,
): boolean {
	if (rx * sx + rz * sz < 0) return false;
	const n = list.count;
	for (let i = 0; i < n; i++) if (violates(list, i, px, pz, rx, rz)) return false;
	return true;
}

/**
 * Brakes the step (dx, dz) of a body at (px, pz) against every entry of `list`, in order (docs/SWORD_SPACING.md
 * Design 2); the result goes to BRAKE_RESULT.
 *
 * Per entry, with w = P - e, d = |w|, n = w / d and R the step so far: an entry is engaged when R moves toward it
 * (R . w < 0) and R's end is inside keep. R splits into its inward part a (along -n) and its tangential part t. Inside
 * the stop cone (a >= stopConeCos x |R|: R points within the cone's half-angle of the centre) t is dropped. Then:
 *   - outside keep (d >= keep): the inward part is cut so the end lands on the keep circle with t kept
 *     (a' = d - sqrt(keep^2 - |t|^2); in the cone, t = 0, a' = d - keep: a straight stop at keep);
 *   - inside keep (d < keep, the enemy walked in): the inward part is removed (along or away only; nothing inward).
 * An exact overlap (d = 0) has no inward direction (every step moves away from the centre), so R . w = 0 passes it.
 *
 * Check pass: when an entry engaged and the result ends deeper inside any entry than min(d, keep), or points against
 * the step (several cuts in a row), the step is re-cut from scratch: every violator's inward part (along its n) is
 * removed from the original step once, in entry order; if that still breaks the contract the result is zero.
 */
export function brakeStep(
	list: Readonly<SpacingList>,
	px: number,
	pz: number,
	dx: number,
	dz: number,
	stopConeCos: number,
): void {
	let rx = dx;
	let rz = dz;
	let touched = false;
	const n = list.count;
	for (let i = 0; i < n; i++) {
		const wx = px - list.x[i];
		const wz = pz - list.z[i];
		if (!(rx * wx + rz * wz < 0)) continue; // not toward this entry
		const keep = list.keep[i];
		const ex = wx + rx;
		const ez = wz + rz;
		if (ex * ex + ez * ez >= keep * keep) continue; // ends outside keep
		const d = math.sqrt(wx * wx + wz * wz);
		if (d === 0) continue; // underflow of a tiny offset: treated as the exact overlap
		const nx = wx / d;
		const nz = wz / d;
		const a = -(rx * nx + rz * nz); // inward part, > 0
		if (!(a > 0)) continue;
		let tx = rx + a * nx;
		let tz = rz + a * nz;
		if (a >= stopConeCos * math.sqrt(rx * rx + rz * rz)) {
			tx = 0;
			tz = 0;
		}
		if (d >= keep) {
			const t2 = tx * tx + tz * tz;
			const room = keep * keep - t2;
			let cut = t2 === 0 ? d - keep : d - (room > 0 ? math.sqrt(room) : 0);
			if (cut > a) cut = a;
			if (cut < 0) cut = 0;
			rx = tx - cut * nx;
			rz = tz - cut * nz;
		} else {
			rx = tx;
			rz = tz;
		}
		touched = true;
	}
	if (touched && !brakeValid(list, px, pz, dx, dz, rx, rz)) {
		let fx = dx;
		let fz = dz;
		for (let i = 0; i < n; i++) {
			if (!violates(list, i, px, pz, rx, rz)) continue;
			const wx = px - list.x[i];
			const wz = pz - list.z[i];
			const d = math.sqrt(wx * wx + wz * wz); // > VIOLATION_EPS: a violator's bound is positive
			const nx = wx / d;
			const nz = wz / d;
			const along = fx * nx + fz * nz;
			if (along < 0) {
				fx -= along * nx;
				fz -= along * nz;
			}
		}
		if (brakeValid(list, px, pz, dx, dz, fx, fz)) {
			rx = fx;
			rz = fz;
		} else {
			rx = 0;
			rz = 0;
		}
	}
	BRAKE_RESULT.x = rx;
	BRAKE_RESULT.z = rz;
	BRAKE_RESULT.engaged = rx !== dx || rz !== dz;
}
