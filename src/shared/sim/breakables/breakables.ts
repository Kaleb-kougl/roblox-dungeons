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
 *            (the swing's base damage; no enemyHits, no combo). Mother Mayhem's slam: breaks every piece within
 *            BREAKABLE_SLAM_RADIUS. Not the Ember, not bodies.
 *   score    a piece a PLAYER breaks (sword, player bullet; builds v2's roll smash and build effects, BVD12) scores
 *            ScoreSource.BREAKABLES (score.ts scoreBreakable):
 *            BREAKABLE_POINTS[kind] x floor; it never feeds the combo and no room record sees it.
 *   loot     a piece that holds a boost (docs/BREAKABLE_DROPS.md, drops/breakLoot.ts) releases it when it breaks, from
 *            any source (dropsOnBreak, after the score); only with DropsConfig.breakableLoot.
 *   silver   a piece that holds Silver (docs/SILVER.md SC2, silver/silver.ts) pays its stack into state.silver.total
 *            when it breaks, from any source (silverOnBreak, right after dropsOnBreak); only with SimConfig.silver.
 *   events   SimEvents.breakableHits (every hit, the breaking one included) and .breakablesBroken; per tick (cleared
 *            by step(), presentation only, not hashed) `hitSlots` and `brokenSlots` (slot per hit / break, in order).
 *   chest    a vault's chest (docs/TREASURE.md, BreakableKind.CHEST, hp CHEST_HP) blocks like any piece but is never
 *            damaged: no hit, event, score, loot or break from any source (bullets that reach it still stop).
 *   crack    a secret room's cracked wall (docs/SECRET_ROOMS.md SR2, BreakableKind.CRACKED_WALL, hp CRACKED_WALL_HP) is
 *            inert like the chest (inertPiece): it blocks bodies and every bullet and takes no damage, and every
 *            contact that reaches damageBreakable is a KNOCK instead (knockSlots / knockSources / knockPlayers, per tick,
 *            unhashed): bullets, slams, blasts, Demolition and Siege's shock (their area loops skip only the chest, so
 *            the crack reaches damageBreakable's early return), the sword's swings (the melee pass). Its openers are
 *            sim/secrets (SR3).
 *   golden   the Goldling's hiding place (docs/GOLDLING_RUMOURS.md GR2, RD13; the floor's last piece, SimConfig.golden
 *            only): a barrel or crate like any other for the players, but enemy sources (enemy bullets, the boss's
 *            slam, a Bomber's blast, a Charger's charge) never reach it, exactly like the chest (a Charger stuns on
 *            it, a bullet stops); a player's break also releases the Goldling (golden/goldenHooks.ts goldenOnBreak).
 *
 * Co-op: the same rules for every player (bullets carry their owner; the team score gets the points). Everything here
 * is deterministic: fixed slot order, no rng, no trig.
 */
import {
	BREAKABLE_PIECE_KINDS,
	cellKey,
	gridToWorld,
	type BreakableLoot,
	type BreakablePlacement,
} from "shared/dungeon";
import type { SimState } from "../state";
import { breakableSlotAt } from "./cells";
import { scoreBreakable } from "../score/score";
import { dropsOnBreak } from "../drops/breakLoot";
import { silverOnBreak } from "../silver/silver";
import { goldenGuardsPiece } from "../golden/golden";
import { goldenOnBreak } from "../golden/goldenHooks";
import { CHEST_HP } from "../treasure/treasureData";
import { bindRollSmash, buildsOnPieceBroken } from "../builds/wrecker";
import { secretsOpenPiece } from "../secrets/open";
import { SecretHow } from "../secrets/secretsData";
import { PLAYER_RADIUS } from "../playerData";
import {
	BREAKABLE_ENEMY_BULLET_DAMAGE,
	BREAKABLE_HIT_RADIUS,
	BREAKABLE_HP,
	BREAKABLE_SLAM_RADIUS,
	BreakableKind,
	BreakableSource,
	CRACKED_WALL_HP,
	NOT_BROKEN,
	inertPiece,
	type BreakableSourceId,
} from "./breakablesData";

/** SimConfig.breakables: presence turns breakables on; the tunables (BREAKABLES_CONFIG is the game's). */
export interface BreakablesConfig {
	/** hp per clutter kind (BreakableKind order; the chest's is CHEST_HP, never read from here). */
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
	/**
	 * With `pieces` (a run WITHOUT endless mode): the pieces that hold a boost ({ slot into `pieces`, Boost index }),
	 * read only when the run's DropsConfig.breakableLoot is set (docs/BREAKABLE_DROPS.md). Endless runs ignore it: each
	 * floor's loot comes from its world (EndlessFloorWorld.breakableLoot).
	 */
	readonly loot?: ReadonlyArray<BreakableLoot>;
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
	/**
	 * Per tick, presentation only (cleared each tick, not hashed; docs/SECRET_ROOMS.md SR2): every knock on a cracked
	 * wall, in order: its slot, the BreakableSource of the contact and the party index of the player behind it (-1 for
	 * none: enemy bullets, slams, a Bomber's blast, a Charger).
	 */
	knockSlots: number[];
	knockSources: number[];
	knockPlayers: number[];
}

function kindIndex(kind: string): number {
	const i = (BREAKABLE_PIECE_KINDS as ReadonlyArray<string>).indexOf(kind);
	if (i < 0) error(`breakables: unknown kind ${kind}`, 0);
	return i;
}

function piecesFrom(config: Readonly<BreakablesConfig>, list: ReadonlyArray<BreakablePlacement>): BreakablePiece[] {
	const out: BreakablePiece[] = [];
	for (const p of list) {
		const kind = kindIndex(p.kind);
		// The vault's chest (docs/TREASURE.md correction 3) and a secret's crack (docs/SECRET_ROOMS.md SR2) have a fixed hp
		// by kind: they never take damage.
		const hp =
			kind === BreakableKind.CHEST
				? CHEST_HP
				: kind === BreakableKind.CRACKED_WALL
				? CRACKED_WALL_HP
				: config.hp[kind];
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
		knockSlots: [],
		knockSources: [],
		knockPlayers: [],
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
		knockSlots: [...b.knockSlots],
		knockSources: [...b.knockSources],
		knockPlayers: [...b.knockPlayers],
	};
	rebuildDerived(out);
	return out;
}

/** Start of every tick (step / stepParty). */
export function clearBreakableEvents(b: BreakablesState): void {
	b.hitSlots.clear();
	b.brokenSlots.clear();
	b.knockSlots.clear();
	b.knockSources.clear();
	b.knockPlayers.clear();
}

/** A knock on the cracked wall in `slot` (docs/SECRET_ROOMS.md SR2): the per-tick feed only, no state change. */
export function knockBreakable(b: BreakablesState, slot: number, source: number, player: number): void {
	b.knockSlots.push(slot);
	b.knockSources.push(source);
	b.knockPlayers.push(player);
}

/**
 * Damages the intact piece in `slot` by `amount` from `source` (BreakableSource). An inert piece (inertPiece: a chest,
 * docs/TREASURE.md correction 3, or a secret's cracked wall, docs/SECRET_ROOMS.md SR2) returns false before any of this:
 * no hit event, hit slot, score, loot or break (a bullet that reached it still stops: the callers consume it); a cracked
 * wall's contact is a knock (knockBreakable, `owner` as its player). So does the Goldling's piece (docs/GOLDLING_RUMOURS.md
 * RD13, golden/golden.ts goldenGuardsPiece) for the enemy sources ENEMY_BULLET and SLAM (enemy bullets, the boss's slam,
 * a Bomber's blast, a Charger's charge). Otherwise events.breakableHits += 1 and the
 * slot joins hitSlots; at hp <= 0 it breaks this tick: hp 0, brokenTick = state.tick, out of the lookup,
 * events.breakablesBroken += 1, brokenSlots; a player's break (MELEE / PLAYER_BULLET, and builds v2's ROLL / BUILD,
 * docs/BUILDS_V2.md BVD12) scores (scoreBreakable) and releases a hiding Goldling from its piece (goldenOnBreak); a loaded
 * piece releases its boost (dropsOnBreak, every source) and a Silver piece pays (silverOnBreak, every source).
 * `owner` (docs/BUILDS_V2.md BV5): the party index of the player who broke it (-1: nobody, as for enemy bullets, the
 * boss's slam, a Bomber's blast or a Charger's charge) and `gen` the break's proc generation; a break with an owner
 * calls the leaf hook buildsOnPieceBroken (Wrecker / Powder Keg's smash proc; nothing without builds). Returns true
 * when it broke. A broken (or missing) slot: nothing, false.
 */
export function damageBreakable(
	state: SimState,
	slot: number,
	amount: number,
	source: BreakableSourceId,
	owner = -1,
	gen = 0,
): boolean {
	const b = state.breakables;
	if (b === undefined) return false;
	const p = b.pieces[slot];
	if (p === undefined || p.brokenTick !== NOT_BROKEN) return false;
	if (inertPiece(p.kind)) {
		// A secret's crack (docs/SECRET_ROOMS.md SR2) reports the contact as a knock; a chest is silent.
		if (p.kind === BreakableKind.CRACKED_WALL) knockBreakable(b, slot, source, owner);
		return false;
	}
	const playerSource =
		source === BreakableSource.MELEE ||
		source === BreakableSource.PLAYER_BULLET ||
		source === BreakableSource.ROLL ||
		source === BreakableSource.BUILD;
	if (!playerSource && goldenGuardsPiece(state, slot)) return false;
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
	if (playerSource) {
		scoreBreakable(state, p.kind);
		goldenOnBreak(state, slot);
	}
	dropsOnBreak(state, slot);
	// Silver in crates (docs/SILVER.md SC2): a Silver piece pays the team (a leaf; nothing without SimConfig.silver).
	silverOnBreak(state, slot);
	// Builds v2 (BV5): Wrecker / Powder Keg's smash proc for the piece's owner (a leaf; nothing without builds).
	if (owner >= 0) buildsOnPieceBroken(state, slot, owner, gen);
	return true;
}

/**
 * Wrecker's roll smash (docs/BUILDS_V2.md BV5; called through the leaf builds/wrecker.ts buildsRollSmash, which checks
 * the boon): player `owner`'s body (PLAYER_RADIUS) at (x, z) about to move by (dx, dz) this roll tick breaks, in slot
 * order, every intact piece but a chest whose circle (config.hitRadius round its cell centre) the body touches along
 * that step (the segment's distance to the centre below the two radii's sum; no trig), at full hp, BreakableSource.ROLL,
 * credited to `owner` at generation 0. A secret's cracked wall it touches opens instead (docs/SECRET_ROOMS.md SR3:
 * secrets/open.ts, SecretHow.ROLL; not counted). Returns the pieces broken.
 */
export function rollSmashBreakables(
	state: SimState,
	owner: number,
	x: number,
	z: number,
	dx: number,
	dz: number,
): number {
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return 0;
	const reach = PLAYER_RADIUS + b.config.hitRadius;
	const reach2 = reach * reach;
	const len2 = dx * dx + dz * dz;
	let broken = 0;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		if (p.brokenTick !== NOT_BROKEN || p.kind === BreakableKind.CHEST) continue;
		const px = gridToWorld(p.x) - x;
		const pz = gridToWorld(p.y) - z;
		// The step's point nearest the centre: t along (dx, dz), clamped to the segment.
		let t = len2 > 0 ? (px * dx + pz * dz) / len2 : 0;
		if (t < 0) t = 0;
		else if (t > 1) t = 1;
		const ex = px - t * dx;
		const ez = pz - t * dz;
		if (ex * ex + ez * ez >= reach2) continue;
		if (p.kind === BreakableKind.CRACKED_WALL) {
			secretsOpenPiece(state, i, SecretHow.ROLL, owner);
			continue;
		}
		if (damageBreakable(state, i, p.hp, BreakableSource.ROLL, owner, 0)) broken++;
	}
	return broken;
}
bindRollSmash(rollSmashBreakables);

/**
 * An enemy bullet whose centre is at (x, z): true when a piece stopped it (consumed; the piece took the damage, but a
 * chest takes none).
 */
export function enemyBulletHitsBreakable(state: SimState, b: Readonly<BreakablesState>, x: number, z: number): boolean {
	const slot = breakableSlotAt(b, x, z);
	if (slot < 0) return false;
	damageBreakable(state, slot, b.config.enemyBulletDamage, BreakableSource.ENEMY_BULLET);
	return true;
}

/**
 * The melee pass (sweepArc, after the actors): every intact piece but a chest, in slot order, whose circle (hitRadius round its
 * cell centre) reaches into the arc from (x, z) toward (dirX, dirZ), `radius` long, half-angle cosine `halfAngleCos`
 * (the actors' test: in reach, and in the cone unless the arc's origin is inside the circle), takes `damage`, credited
 * to `owner` (docs/BUILDS_V2.md BV5: the swinging player, generation 0; -1 nobody). A secret's cracked wall in the arc
 * (docs/SECRET_ROOMS.md SR3) opens on a `finisher` pass (the sword's third hit: secrets/open.ts, SecretHow.FINISHER;
 * absent or false: never) and is knocked otherwise; neither is counted. Returns the pieces hit.
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
	owner = -1,
	finisher = false,
): number {
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return 0;
	const r = b.config.hitRadius;
	let hits = 0;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		// A vault's chest is never hit (docs/TREASURE.md correction 3): not counted either. A secret's crack opens or
		// knocks below (docs/SECRET_ROOMS.md SR2 / SR3).
		if (p.brokenTick !== NOT_BROKEN || p.kind === BreakableKind.CHEST) continue;
		const dx = gridToWorld(p.x) - x;
		const dz = gridToWorld(p.y) - z;
		const d2 = dx * dx + dz * dz;
		const reach = radius + r;
		if (d2 > reach * reach) continue;
		const d = math.sqrt(d2);
		if (d > r && dx * dirX + dz * dirZ < halfAngleCos * d) continue;
		if (p.kind === BreakableKind.CRACKED_WALL) {
			// The finisher opens it; any other pass (or no secrets state) knocks (damageBreakable's early return).
			if (!(finisher && secretsOpenPiece(state, i, SecretHow.FINISHER, owner)))
				damageBreakable(state, i, damage, BreakableSource.MELEE, owner, 0);
			continue;
		}
		damageBreakable(state, i, damage, BreakableSource.MELEE, owner, 0);
		hits++;
	}
	return hits;
}

/**
 * The boss's slam at (x, z): breaks every intact piece but a chest whose cell centre is within config.slamRadius.
 * `radius` (docs/NEW_ENEMIES.md NE1: the Bomber's blast, the Charger's charge) replaces config.slamRadius when given;
 * absent, exactly the boss's slam. A Charger's charge stops at a chest like at a wall (the mover), so it stuns; so it
 * does at the Goldling's hidden piece, which damageBreakable refuses for SLAM (docs/GOLDLING_RUMOURS.md GR0).
 */
export function slamBreakables(state: SimState, x: number, z: number, radius?: number): number {
	const b = state.breakables;
	if (b === undefined || b.intact === 0) return 0;
	const r = radius ?? b.config.slamRadius;
	const r2 = r * r;
	let broken = 0;
	for (let i = 0; i < b.pieces.size(); i++) {
		const p = b.pieces[i];
		// A vault's chest never breaks (docs/TREASURE.md correction 3). A secret's crack goes on to damageBreakable,
		// which knocks and returns false (docs/SECRET_ROOMS.md SR2): never counted.
		if (p.brokenTick !== NOT_BROKEN || p.kind === BreakableKind.CHEST) continue;
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
