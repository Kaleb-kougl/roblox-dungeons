/**
 * Breakable barrels and crates in the sim (docs/DECOR.md D4, Phase 2 part 4, task R12; a Roblox-port feature, no web
 * source). OPT-IN like endless mode: only a SimConfig with `breakables` creates `SimState.breakables`, and only then is
 * anything here reached or the hash's "breakables" group written. Without it (M1, every golden fixture, the tutorial)
 * no code path below runs and every mover / blocker gets no `solid` argument, so they take exactly the grid-only path.
 *
 * State: one BreakablePiece per piece of the current floor (kind, cell, hp, broken tick), in the floor's placement
 * order (slot = index), rebuilt on every endless floor change (stepEndless nextFloor: resetBreakables). The cell ->
 * slot lookup of the INTACT pieces (`slotByCell`, keyed by shared/dungeon cellKey) and the intact count are derived:
 * never hashed, rebuilt by clone and reset, updated when a piece breaks.
 *
 * What they do (B2 / B3):
 *   block    movement of players and actors (movePlayer, moveActor: the movers' `solid` argument = solidCells(state)),
 *            and every bullet (combat.ts: after the wall test, before graze / players / actors, so a crate shields
 *            whoever stands behind it). NOT line of sight: they are low cover.
 *   damage   player bullets: their payload damage; a plain bullet is consumed, a piercing one (heavy arrow, Piercing
 *            Arrows) flies on only when it broke the piece (no pierce spent), else it stops there. Enemy bullets:
 *            consumed, BREAKABLE_ENEMY_BULLET_DAMAGE each. The sword: sweepArc's breakables pass after the actors
 *            (the swing's base damage; no enemyHits, no combo). Mother Bramble's slam: breaks every piece within
 *            BREAKABLE_SLAM_RADIUS. Not the Ember, not bodies.
 *   score    a piece a PLAYER breaks (sword, player bullet) scores ScoreSource.BREAKABLES (score.ts scoreBreakable):
 *            BREAKABLE_POINTS[kind] x floor; it never feeds the combo and no room record sees it.
 *   events   SimEvents.breakableHits (every hit, the breaking one included) and .breakablesBroken; per tick (cleared
 *            by step(), presentation only, not hashed) `hitSlots` and `brokenSlots` (slot per hit / break, in order).
 *
 * Co-op: the same rules for every player (bullets carry their owner; the team score gets the points). Everything here
 * is deterministic: fixed slot order, no rng, no trig.
 */
import { BREAKABLE_KINDS, cellKey, gridToWorld, type BreakablePlacement } from "shared/dungeon";
import type { SimState } from "../state";
import { breakableSlotAt } from "./cells";
import { scoreBreakable } from "../score/score";
import {
	BREAKABLE_ENEMY_BULLET_DAMAGE,
	BREAKABLE_HIT_RADIUS,
	BREAKABLE_HP,
	BREAKABLE_SLAM_RADIUS,
	BreakableSource,
	NOT_BROKEN,
	type BreakableSourceId,
} from "./breakablesData";

/** SimConfig.breakables: presence turns breakables on; the tunables (BREAKABLES_CONFIG is the game's). */
export interface BreakablesConfig {
	/** hp per kind (BreakableKind order). */
	readonly hp: ReadonlyArray<number>;
	/** Damage one enemy bullet deals to a piece. */
	readonly enemyBulletDamage: number;
	/** Melee: a piece is a circle of this radius round its cell centre. */
	readonly hitRadius: number;
	/** The boss's slam breaks every piece whose cell centre lies within this of the boss. */
	readonly slamRadius: number;
	/**
	 * The pieces of a run WITHOUT endless mode (tests, sandboxes; tile coordinates). Endless runs ignore it: each
	 * floor's pieces come from its world (EndlessFloorWorld.breakables).
	 */
	readonly pieces?: ReadonlyArray<BreakablePlacement>;
}

/** The game's breakables config (every endless run; shared/run buildEndlessRunConfig). */
export const BREAKABLES_CONFIG: BreakablesConfig = table.freeze({
	hp: BREAKABLE_HP,
	enemyBulletDamage: BREAKABLE_ENEMY_BULLET_DAMAGE,
	hitRadius: BREAKABLE_HIT_RADIUS,
	slamRadius: BREAKABLE_SLAM_RADIUS,
});

/** One piece. Plain numbers, every field hashed. */
export interface BreakablePiece {
	/** BreakableKind. */
	kind: number;
	/** Tile coordinates (world x = x, z = y). */
	x: number;
	y: number;
	/** hp left (0 once broken). */
	hp: number;
	/** state.tick it broke on, NOT_BROKEN while intact. */
	brokenTick: number;
}

/** SimState.breakables. */
export interface BreakablesState {
	/** The run's tunables (config, constant for the run: not hashed). */
	readonly config: Readonly<BreakablesConfig>;
	/** The current floor's pieces, slot = index (hashed). */
	pieces: BreakablePiece[];
	/** Derived (never hashed; rebuilt on clone and reset): cellKey -> slot of every intact piece. */
	slotByCell: Map<number, number>;
	/** Derived: intact pieces. */
	intact: number;
	/** Per tick, presentation only (cleared each tick, not hashed): the slot of every hit / break, in order. */
	hitSlots: number[];
	brokenSlots: number[];
}

function kindIndex(kind: string): number {
	const i = (BREAKABLE_KINDS as ReadonlyArray<string>).indexOf(kind);
	if (i < 0) error(`breakables: unknown kind ${kind}`, 0);
	return i;
}

function piecesFrom(config: Readonly<BreakablesConfig>, list: ReadonlyArray<BreakablePlacement>): BreakablePiece[] {
	const out: BreakablePiece[] = [];
	for (const p of list) {
		const kind = kindIndex(p.kind);
		const hp = config.hp[kind];
		if (hp === undefined || !(hp > 0)) error(`breakables: no hp for kind ${p.kind}`, 0);
		out.push({ kind, x: p.x, y: p.y, hp, brokenTick: NOT_BROKEN });
	}
	return out;
}

/** Rebuilds the derived lookup and intact count from `b.pieces`. */
function rebuildDerived(b: BreakablesState): void {
	b.slotByCell.clear();
	let intact = 0;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		if (p.brokenTick !== NOT_BROKEN) continue;
		b.slotByCell.set(cellKey(p.x, p.y), i);
		intact++;
	}
	b.intact = intact;
}

/** Breakables state at run start with `list` (floor 1's pieces in endless mode, else config.pieces). No rng. */
export function createBreakablesState(
	config: Readonly<BreakablesConfig>,
	list: ReadonlyArray<BreakablePlacement>,
): BreakablesState {
	const b: BreakablesState = {
		config,
		pieces: piecesFrom(config, list),
		slotByCell: new Map(),
		intact: 0,
		hitSlots: [],
		brokenSlots: [],
	};
	rebuildDerived(b);
	return b;
}

/** A new floor (stepEndless): every piece replaced by `list`'s, intact (this tick's hit / broken slots cleared). */
export function resetBreakables(b: BreakablesState, list: ReadonlyArray<BreakablePlacement>): void {
	b.pieces = piecesFrom(b.config, list);
	rebuildDerived(b);
	// This tick's slots named the old floor's pieces.
	clearBreakableEvents(b);
}

export function cloneBreakablesState(b: Readonly<BreakablesState>): BreakablesState {
	const out: BreakablesState = {
		config: b.config,
		pieces: b.pieces.map((p) => ({ ...p })),
		slotByCell: new Map(),
		intact: 0,
		hitSlots: [...b.hitSlots],
		brokenSlots: [...b.brokenSlots],
	};
	rebuildDerived(out);
	return out;
}

/** Start of every tick (step / stepParty). */
export function clearBreakableEvents(b: BreakablesState): void {
	b.hitSlots.clear();
	b.brokenSlots.clear();
}

/**
 * Damages the intact piece in `slot` by `amount` from `source` (BreakableSource). events.breakableHits += 1 and the
 * slot joins hitSlots; at hp <= 0 it breaks this tick: hp 0, brokenTick = state.tick, out of the lookup,
 * events.breakablesBroken += 1, brokenSlots; a player's break (MELEE / PLAYER_BULLET) scores (scoreBreakable).
 * Returns true when it broke. A broken (or missing) slot: nothing, false.
 */
export function damageBreakable(state: SimState, slot: number, amount: number, source: BreakableSourceId): boolean {
	const b = state.breakables;
	if (b === undefined) return false;
	const p = b.pieces[slot];
	if (p === undefined || p.brokenTick !== NOT_BROKEN) return false;
	const ev = state.events;
	ev.breakableHits += 1;
	b.hitSlots.push(slot);
	const hp = p.hp - amount;
	if (hp > 0) {
		p.hp = hp;
		return false;
	}
	p.hp = 0;
	p.brokenTick = state.tick;
	b.slotByCell.delete(cellKey(p.x, p.y));
	b.intact -= 1;
	ev.breakablesBroken += 1;
	b.brokenSlots.push(slot);
	if (source === BreakableSource.MELEE || source === BreakableSource.PLAYER_BULLET) scoreBreakable(state, p.kind);
	return true;
}

/** An enemy bullet whose centre is at (x, z): true when a piece stopped it (consumed; the piece took the damage). */
export function enemyBulletHitsBreakable(state: SimState, b: Readonly<BreakablesState>, x: number, z: number): boolean {
	const slot = breakableSlotAt(b, x, z);
	if (slot < 0) return false;
	damageBreakable(state, slot, b.config.enemyBulletDamage, BreakableSource.ENEMY_BULLET);
	return true;
}

/**
 * The melee pass (sweepArc, after the actors): every intact piece, in slot order, whose circle (hitRadius round its
 * cell centre) reaches into the arc from (x, z) toward (dirX, dirZ), `radius` long, half-angle cosine `halfAngleCos`
 * (the actors' test: in reach, and in the cone unless the arc's origin is inside the circle), takes `damage`.
 * Returns the pieces hit.
 */
export function meleeHitBreakables(
	state: SimState,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	radius: number,
	halfAngleCos: number,
	damage: number,
): number {
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return 0;
	const r = b.config.hitRadius;
	let hits = 0;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		if (p.brokenTick !== NOT_BROKEN) continue;
		const dx = gridToWorld(p.x) - x;
		const dz = gridToWorld(p.y) - z;
		const d2 = dx * dx + dz * dz;
		const reach = radius + r;
		if (d2 > reach * reach) continue;
		const d = math.sqrt(d2);
		if (d > r && dx * dirX + dz * dirZ < halfAngleCos * d) continue;
		damageBreakable(state, i, damage, BreakableSource.MELEE);
		hits++;
	}
	return hits;
}

/** The boss's slam at (x, z): breaks every intact piece whose cell centre is within config.slamRadius. */
export function slamBreakables(state: SimState, x: number, z: number): number {
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return 0;
	const r2 = b.config.slamRadius * b.config.slamRadius;
	let broken = 0;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		if (p.brokenTick !== NOT_BROKEN) continue;
		const dx = gridToWorld(p.x) - x;
		const dz = gridToWorld(p.y) - z;
		if (dx * dx + dz * dz > r2) continue;
		if (damageBreakable(state, i, p.hp, BreakableSource.SLAM)) broken++;
	}
	return broken;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "breakables" group, appended after every other group but "drops" only when state.breakables exists.

/** Per piece, in this order (dump names `breakables[<slot>].<name>`). */
export const BREAKABLE_HASH_FIELDS = ["kind", "x", "y", "hp", "brokenTick"] as const;

export function writeBreakablesHash(b: Readonly<BreakablesState>, out: number[]): void {
	out.push(b.pieces.size());
	for (const p of b.pieces) for (const f of BREAKABLE_HASH_FIELDS) out.push(p[f]);
}

export function breakablesHashNames(b: Readonly<BreakablesState>, out: string[]): void {
	out.push("breakables.length");
	for (let i = 0; i < b.pieces.size(); i++) for (const f of BREAKABLE_HASH_FIELDS) out.push(`breakables[${i}].${f}`);
}
