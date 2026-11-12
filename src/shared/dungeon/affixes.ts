/**
 * Elite affix assignment (docs/ENEMY_VARIANTS.md EV6, decisions EVD6 / EVD7; a Roblox-port feature, no web source):
 * which planned room spawns of an endless floor carry an affix (Hulking, Swift, Shielded, Vengeful). A PURE function
 * of the floor, like the rest of ./endless.ts, so live play, every co-op client and the server's replay agree.
 *
 *   stream   its own: new EncounterRng(affixSeed(floor seed)) = mulberry32 from (seed ^ AFFIXES.salt), run after the
 *            Forge, the room spawns, the boss pick and the breakables; it reads only the room types and the spawn kinds,
 *            so nothing else on the floor moves.
 *   rooms    in id order. Eligible members: a room's planned spawns (spawn order) whose kind is not excluded (the split,
 *            the dummy, any turret, any boss). Unlocked affixes: AFFIXES.unlocks with fromFloor <= floor, in id order.
 *   elite    from eliteFromFloor: k = max(1, ceil(n x eliteSharePercent / 100)) of the n eligible members (none when
 *            n = 0), chosen by a partial Fisher-Yates over the eligible list (k draws: rng.int(j, n - 1) for j = 0..k-1);
 *            then, in spawn order, each chosen member's affix: one rng.int(0, unlocked - 1).
 *   combat   from combatFromFloor: per eligible member in spawn order, one rng.int(0, percentRange - 1) <
 *            combatChancePercent, and on a hit its affix: one rng.int(0, unlocked - 1).
 *   other    rooms (and rooms below their floor) draw nothing.
 *   share    (AffixForce.sharePercent, docs/FLOOR_MODIFIERS.md FM2: the Blood Moon floor, 200) both rules scaled by
 *            sharePercent / 100: the elite share (k = max(1, ceil(n x eliteSharePercent x sharePercent / 100^2)), still
 *            capped at n) and the combat chance (combatChancePercent x sharePercent / 100); the same draws in the same
 *            order, the same excluded kinds. Absent: 100, the floor exactly as before.
 *
 * Output: an affix id per planned spawn (index = room id, then spawn index; AffixKind.NONE = none), the same shape as
 * the room spawns.
 */
import { u32 } from "shared/jsmath";
import { EncounterRng } from "./encounter";
import type { ActorSpawn, EncounterRoom } from "./encounterTypes";
import { AFFIXES, AffixKind } from "./affixesData";

/** Seed of the assignment stream: the floor seed with AFFIXES.salt mixed in (uint32). */
export function affixSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), AFFIXES.salt);
}

/** True when archetype `kind` can never carry an affix (AFFIXES.excludedKinds / excludedPrefixes). */
export function isAffixExcluded(kind: string): boolean {
	if (AFFIXES.excludedKinds.includes(kind)) return true;
	for (const p of AFFIXES.excludedPrefixes) if (kind.sub(1, p.size()) === p) return true;
	return false;
}

/** The affixes unlocked on `floor`, in id order. */
export function unlockedAffixes(floor: number): number[] {
	const out: number[] = [];
	for (const u of AFFIXES.unlocks) if (floor >= u.fromFloor) out.push(u.kind);
	return out;
}

/** Affixed members an elite room with `n` eligible members gets: max(1, ceil(n x share / 100)), 0 when n = 0. */
export function eliteAffixCount(n: number): number {
	if (n <= 0) return 0;
	const num = n * AFFIXES.eliteSharePercent + AFFIXES.percentRange - 1;
	const k = (num - (num % AFFIXES.percentRange)) / AFFIXES.percentRange;
	return math.min(n, math.max(1, k));
}

/**
 * eliteAffixCount with the share scaled by `sharePercent` / 100 (AffixForce, docs/FLOOR_MODIFIERS.md FM2):
 * max(1, ceil(n x share x sharePercent / 100^2)), at most n, 0 when n = 0; 100 is eliteAffixCount(n). Integer math.
 */
export function scaledEliteAffixCount(n: number, sharePercent: number): number {
	if (n <= 0) return 0;
	const range = AFFIXES.percentRange * AFFIXES.percentRange;
	const num = n * AFFIXES.eliteSharePercent * sharePercent + range - 1;
	const k = (num - (num % range)) / range;
	return math.min(n, math.max(1, k));
}

/** assignAffixes' force flag (docs/FLOOR_MODIFIERS.md FM2). Absent or empty: the natural shares. */
export interface AffixForce {
	/** Both affix rules scaled by sharePercent / 100 (the file comment's "share"). Blood Moon floors: 200. */
	readonly sharePercent?: number;
}

/**
 * Affixed planned members in `roomAffixes` (assignAffixes' shape), skipping room id `exceptRoom` (default: none). Pure.
 */
export function countAffixed(roomAffixes: ReadonlyArray<ReadonlyArray<number>>, exceptRoom = -1): number {
	let n = 0;
	for (let id = 0; id < roomAffixes.size(); id++) {
		if (id === exceptRoom) continue;
		for (const a of roomAffixes[id]) if (a !== AffixKind.NONE) n++;
	}
	return n;
}

/**
 * The affix of every planned room spawn of `floor` (see the file comment). `rooms[i].id === i`; `roomSpawns[id]` are
 * room id's planned spawns. Pure. `force.sharePercent`: the Blood Moon floor (file comment).
 */
export function assignAffixes(
	floorSeed: number,
	floor: number,
	rooms: ReadonlyArray<EncounterRoom>,
	roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>,
	force?: AffixForce,
): number[][] {
	const rng = new EncounterRng(affixSeed(floorSeed));
	const unlocked = unlockedAffixes(floor);
	const sharePercent = force?.sharePercent ?? AFFIXES.percentRange;
	const combatChance = (AFFIXES.combatChancePercent * sharePercent) / AFFIXES.percentRange;
	const out: number[][] = [];
	for (let id = 0; id < roomSpawns.size(); id++) {
		const spawns = roomSpawns[id];
		const row: number[] = [];
		const eligible: number[] = [];
		for (let i = 0; i < spawns.size(); i++) {
			row.push(AffixKind.NONE);
			if (!isAffixExcluded(spawns[i].kind)) eligible.push(i);
		}
		out.push(row);
		const room = rooms[id];
		if (room === undefined || eligible.size() === 0 || unlocked.size() === 0) continue;
		const last = unlocked.size() - 1;
		if (room.type === AFFIXES.eliteRoomType && floor >= AFFIXES.eliteFromFloor) {
			const n = eligible.size();
			const k = force === undefined ? eliteAffixCount(n) : scaledEliteAffixCount(n, sharePercent);
			for (let j = 0; j < k; j++) {
				const r = rng.int(j, n - 1);
				const t = eligible[j];
				eligible[j] = eligible[r];
				eligible[r] = t;
			}
			const chosen = new Set<number>();
			for (let j = 0; j < k; j++) chosen.add(eligible[j]);
			for (let i = 0; i < spawns.size(); i++) if (chosen.has(i)) row[i] = unlocked[rng.int(0, last)];
		} else if (room.type === AFFIXES.combatRoomType && floor >= AFFIXES.combatFromFloor) {
			for (const i of eligible) {
				if (rng.int(0, AFFIXES.percentRange - 1) < combatChance) row[i] = unlocked[rng.int(0, last)];
			}
		}
	}
	return out;
}
