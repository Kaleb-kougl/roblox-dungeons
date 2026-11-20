/**
 * Roblox port (docs/BOOST_ART.md BAD3): the boost auras' per-rank art, in its own module (contract.ts and validate.ts
 * sit near Luau's 200-locals-per-function limit; validate.ts takes one name, `boostAuraArtProblems`, and ThemeCore one,
 * `boostAuraRanksOf`).
 *
 * `fx.boost.aura.<kind>` (BOOST_FX_IDS, optional like every fx ID) is an ordinary fx sprite set (one facing, `play`,
 * the fx fields) that may also carry its art for every stack rank, because BoostAuraController draws each running
 * boost one ring wider than the one before it (shared/view auraDisc) and pixel art must not be scaled up for that:
 *   - `ringPx` (aura IDs only, required on them): the ring's radius in art px from the pivot, one entry per rank drawn
 *     (1..BOOST_AURA_ART.maxRanks, positive, increasing), each inside the cell (<= the pivot's distance to every edge);
 *     the renderer maps rank r's ring exactly onto its disc's radius;
 *   - rank 0's loop is `play` (FX_ANIMATION); rank r > 0's is `rank.<r>` (boostAuraRankAnimation), one for every
 *     further `ringPx` entry and no other `rank.*` name; every one loops; their cells are validate.ts
 *     validateSpriteSet's (inside the sheet), as for every animation; a set's ranks share its cell and pivot;
 *   - `tint` the kind's own role `boost.<kind>` (the renderer draws the aura in it, so the fx colour rules,
 *     validate.ts fxColorReport, check the colour that is drawn).
 * Any other fx ID with a `ringPx` or a `rank.*` animation is an error (aura IDs only).
 *
 * @module
 */

import { BOOST_KINDS, FX_ANIMATION, boostAuraFxId, boostId, type BoostKind } from "./contract";
import { describeValue, isArrayLike, isObj, sortedEntries } from "./util";

/** Per-rank aura art limits and names. */
export const BOOST_AURA_ART = {
	/** Most stack ranks an aura draws (one ring per boost kind). */
	maxRanks: BOOST_KINDS.size(),
	/** Rank r > 0's animation is `<rankPrefix><r>`; rank 0's is FX_ANIMATION (`play`). */
	rankPrefix: "rank.",
} as const;

/** The animation of stack rank `rank`: `play` for 0, `rank.<rank>` above. */
export function boostAuraRankAnimation(rank: number): string {
	return rank === 0 ? FX_ANIMATION : `${BOOST_AURA_ART.rankPrefix}${rank}`;
}

/** The boost kind whose aura `id` is (boostAuraFxId), or undefined. */
export function boostAuraKindOf(id: string): BoostKind | undefined {
	for (const k of BOOST_KINDS) {
		if (boostAuraFxId(k) === id) {
			return k;
		}
	}
	return undefined;
}

/** One rank of an aura: its animation and its ring's radius, art px from the pivot. */
export interface BoostAuraRank {
	readonly animation: string;
	readonly ringPx: number;
}

/** A shape problem of an fx set: the path under `assets.<id>` and the message. */
export interface BoostAuraArtProblem {
	path: Array<string>;
	msg: string;
}

function isRankName(name: string): boolean {
	const p = BOOST_AURA_ART.rankPrefix;
	return name.sub(1, p.size()) === p;
}

function isNum(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

/**
 * The per-rank shape problems of fx sprite set `def` with ID `id` (see the module comment), paths relative to the asset.
 * Empty for a well-formed aura, and for any other fx set without rank fields.
 */
export function boostAuraShapeProblems(id: string, def: unknown): Array<BoostAuraArtProblem> {
	const out = new Array<BoostAuraArtProblem>();
	if (!isObj(def)) {
		return out;
	}
	const anims = isObj(def.animations) ? def.animations : {};
	const kind = boostAuraKindOf(id);
	if (kind === undefined) {
		if (def.ringPx !== undefined) {
			out.push({ path: ["ringPx"], msg: "per-rank rings are drawn on fx.boost.aura.<kind> sets only" });
		}
		for (const [name] of sortedEntries(anims)) {
			if (isRankName(name)) {
				out.push({
					path: ["animations", name],
					msg: "per-rank animations are drawn on fx.boost.aura.<kind> sets only",
				});
			}
		}
		return out;
	}
	const max = BOOST_AURA_ART.maxRanks;
	const rings = def.ringPx;
	const ringsOk =
		isArrayLike(rings) &&
		rings.size() >= 1 &&
		rings.size() <= max &&
		rings.every((px, r) => isNum(px) && px > 0 && (r === 0 || px > (rings[r - 1] as number)));
	if (!ringsOk) {
		out.push({
			path: ["ringPx"],
			msg: `must list each rank's ring radius (art px from the pivot): 1..${max} positive numbers, increasing; got ${describeValue(
				rings,
			)}`,
		});
		return out;
	}
	const ringList = rings as ReadonlyArray<number>;
	const n = ringList.size();
	for (let r = 0; r < n; r++) {
		const name = boostAuraRankAnimation(r);
		const a = anims[name];
		if (!isObj(a)) {
			out.push({
				path: ["animations"],
				msg: `missing ${name}: ringPx lists ${n} ranks, so rank ${r} needs its loop`,
			});
		} else if (a.loop !== true) {
			out.push({
				path: ["animations", name, "loop"],
				msg: "an aura loops for as long as its boost runs: must be true",
			});
		}
	}
	for (const [name] of sortedEntries(anims)) {
		const r = isRankName(name) ? tonumber(name.sub(BOOST_AURA_ART.rankPrefix.size() + 1)) : undefined;
		if (isRankName(name) && (r === undefined || r < 1 || r >= n || r % 1 !== 0)) {
			out.push({ path: ["animations", name], msg: `no ring for it: ringPx lists ranks 0..${n - 1}` });
		}
	}
	const pivot = def.pivot;
	if (isObj(pivot) && isNum(pivot.x) && isNum(pivot.y) && isNum(def.frameW) && isNum(def.frameH)) {
		const room = math.min(pivot.x, def.frameW - pivot.x, pivot.y, def.frameH - pivot.y);
		for (let r = 0; r < n; r++) {
			if (ringList[r] > room) {
				out.push({
					path: ["ringPx"],
					msg: `rank ${r}'s ring (${ringList[r]} px) reaches past the ${def.frameW}x${def.frameH} cell (${room} px from the pivot to its nearest edge)`,
				});
				break;
			}
		}
	}
	const role = boostId(kind);
	if (def.tint !== role) {
		out.push({
			path: ["tint"],
			msg: `an aura is drawn in its boost's role: must be "${role}", got ${describeValue(def.tint)}`,
		});
	}
	return out;
}

/** Every fx sprite set's per-rank shape problem as a validator message (path `assets.<id>...`), IDs sorted. */
export function boostAuraArtProblems(manifest: unknown): Array<BoostAuraArtProblem> {
	const out = new Array<BoostAuraArtProblem>();
	if (!isObj(manifest) || !isObj(manifest.assets)) {
		return out;
	}
	for (const [id, def] of sortedEntries(manifest.assets)) {
		if (id.sub(1, 3) !== "fx." || !isObj(def) || def.kind !== "sprites") {
			continue;
		}
		for (const p of boostAuraShapeProblems(id, def)) {
			out.push({ path: ["assets", id, ...p.path], msg: p.msg });
		}
	}
	return out;
}

/**
 * The ranks of aura `id`'s art `def` for ThemeCore.fx: undefined when `id` is not an aura ID; the first shape problem
 * (a string) when the set cannot be drawn per rank; else one BoostAuraRank per `ringPx` entry, rank order.
 */
export function boostAuraRanksOf(id: string, def: unknown): Array<BoostAuraRank> | string | undefined {
	if (boostAuraKindOf(id) === undefined || !isObj(def)) {
		return undefined;
	}
	const problems = boostAuraShapeProblems(id, def);
	if (problems.size() > 0) {
		return `${problems[0].path.join(".")} ${problems[0].msg}`;
	}
	const rings = def.ringPx as ReadonlyArray<number>;
	return rings.map((ringPx, r) => ({ animation: boostAuraRankAnimation(r), ringPx }));
}
