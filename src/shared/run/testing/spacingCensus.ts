/**
 * Test support for specs (never imported by the game): docs/SWORD_SPACING.md SP0's contact-hit census. Measurements
 * only: nothing here changes a rule, a number or hashed state.
 *
 * Runs (spacingRun): survivalBot.ts's solo endless descent for the Knight (buildEndlessRunConfig with characters
 * ["knight"], the real path), every room with planned spawns fought and the boss fought, IMMORTAL by default (Driver's
 * hearts top-up before every tick: hits still land and count, but no death ends a run early, so every floor up to
 * maxFloor is sampled; `immortal: false` for an honest run), with one of two fighters:
 *   tidy    characterTune.ts's knight fighter unchanged (walks in to TUNE_SWORD_CLOSE, holds FIRE in reach; an analog
 *           move straight at the target)
 *   greedy  the same decisions (guard, volley roll, flask), but played on keyboard and mouse and never stopping: every
 *           in-sight fight frame moves at full magnitude along the nearest of the 8 key directions (keyboardMoveVector's
 *           screen vectors through screenToWorld, quantized like every frame) toward its target, attacking or not:
 *           within GREEDY_DIRECT_TILES of its edge straight at it, farther along the floor's path (greedyKnightFrame);
 *           a roll goes along the key nearest the tidy roll's direction; the aim is the exact direction to the target
 *           (a mouse pointer on the enemy). Out of sight, and for one tick after a key move stalled on a wall, it plays
 *           the tidy fighter's frame (the path walk is analog).
 *
 * Contact hits (ContactProbe): SimCtx.hurtPlayerAt and SimCtx.hurtPlayer (the solo bullet walk's) are wrapped for the
 * run (restored after) and every LANDED call is classified by its caller (debug.info level 2; the headless runner
 * compiles with debug names): `contactDamageOn` (combat/actors/actors.ts stepContactDamage) is a contact hit,
 * `enemyBulletHit` / `enemyBulletHitParty` a bullet hit, anything else (a Jackal lunge, a Charger, a Bulwark bash)
 * "other". Exact: the caller decides, not the hit's source kind (a reaper's own spiral can land while it
 * overlaps). The contact hit's actor is the first live contact actor in slot order overlapping the player at the call,
 * exactly contactDamageOn's pick (landing depends only on the player).
 *
 * Attribution: positions of the player and every actor slot are kept for the last SPACING_WINDOW_TICKS + 1 ticks (after
 * every step); over the window before a contact hit each tick's change of the player-actor distance is split into the
 * player's share and the actor's (the symmetric split: the mean of "player moved first" and "actor moved first"), summed
 * over the ticks the actor existed with the same id on the same floor. Player-driven when the player's closing is larger
 * than the actor's, else enemy-driven. The player's movement is all of it (walk, lunge, roll, a Chainhook's drag).
 *
 * Keep share: on every fight tick (the state the fighter reads), whether the player is inside a live contact actor's
 * keep distance (radius + PLAYER_RADIUS + SPACING_KEEP_MARGIN) and inside its contact range (radius + PLAYER_RADIUS).
 *
 * The census (SWORD_SPACING_CENSUS, split over the shard specs run/swordSpacing.census.<n>: 30 run seeds at about two
 * minutes a seed for the four columns, so 3 seeds a shard) runs every column of SPACING_CENSUS_COLUMNS over its seeds.
 * A column is a SpacingRunOptions: a fighter and the brake (`spacing`, the specs-only switch's kind, which spacingRun
 * sets with setSwordSpacing before the run config is built and restores after; docs/SWORD_SPACING.md SP4): WEB (no
 * brake, SP0's baseline) and ON (SWORD_SPACING) for both fighters.
 *
 * Brake ticks (SP4): after every step the brake's scratch (BRAKE_RESULT.engaged, written by every brakeStep call: the
 * walk's, then the lunge's) is read and cleared, so a tick counts when its LAST brake call cut the step (a walk cut on a
 * lunge tick whose lunge ran free is missed: a lower bound). Reading and clearing the scratch changes nothing: the sim
 * writes it before every read.
 *
 * Entry attribution (SP4): the SP0 split above credits the player with his whole approach, so a braked Knight who
 * walks up to keep distance and is then touched by the enemy's last step still reads player-driven. The entry split
 * attributes only the ticks since the gap was last at or outside the actor's keep distance (radius + PLAYER_RADIUS +
 * SPACING_KEEP_MARGIN; the whole window when it never was): who crossed from keep into contact. A player-driven entry is
 * classed by what moved him most over those ticks: a walk with the brake's hook on (a wall slide's deflection, or the
 * list's tick-start positions: the enemy moved), a walk with it off (SPD1: no FIRE and no combo, or the guard alone;
 * guard ticks counted apart), the lunge, a roll. Every fight frame notes the hook (weaponSpacingActive for the frame's
 * buttons on the state the step starts from, what stepPlayer reads; travel frames: off), every snapshot the guard.
 */
import { screenToWorld } from "shared/play";
import {
	BRAKE_RESULT,
	Button,
	NO_KIND,
	PLAYER_RADIUS,
	SQRT1_2,
	SWORD_DATA,
	SWORD_STEP_WINDUP,
	SWORD_V_GUARD,
	SWORD_V_STEP,
	SWORD_WEAPON_ID,
	SimCtx,
	archetypeAt,
	playerAt,
	quantizeAxis,
	weaponIndex,
	weaponSpacingActive,
	weaponsAt,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { SwordSpacing, setSwordSpacing, type SwordSpacingKind } from "../swordSpacing";
import { fighterFrame, type FightEnv, type FighterMemory } from "./characterTune";
import { survivalRun, type SurvivalRun } from "./survivalBot";

let swordIndexCache = -1;
function swordIndex(): number {
	if (swordIndexCache < 0) swordIndexCache = weaponIndex(SWORD_WEAPON_ID);
	return swordIndexCache;
}

/** The fighters (file comment). */
export type SpacingFighter = "tidy" | "greedy";

/** Ticks before a contact hit over which it is attributed (docs/SWORD_SPACING.md SP0). */
export const SPACING_WINDOW_TICKS = 10;
/** The plan's keep margin (SWORD_SPACING.marginTiles, Design 6): keep = radius + PLAYER_RADIUS + this. */
export const SPACING_KEEP_MARGIN = 0.15;

/** One census column: a fighter, the brake and a printed label (file comment). */
export interface SpacingRunOptions {
	readonly fighter: SpacingFighter;
	readonly label: string;
	/** The sword spacing brake for the run (setSwordSpacing; default SwordSpacing.ON, the live default). */
	readonly spacing?: SwordSpacingKind;
	/** The last floor fought (default SWORD_SPACING_CENSUS.maxFloor). */
	readonly maxFloor?: number;
	/** Hearts topped up before every tick (default true, file comment). */
	readonly immortal?: boolean;
}

/** The census sample: run seeds 1..seeds, floors 1..maxFloor, over `shards` spec files of consecutive seeds. */
export const SWORD_SPACING_CENSUS = { seeds: 30, maxFloor: 10, shards: 10 } as const;

/** The census columns, in print order (file comment). */
export const SPACING_CENSUS_COLUMNS: ReadonlyArray<SpacingRunOptions> = [
	{ fighter: "tidy", label: "tidy-web", spacing: SwordSpacing.WEB },
	{ fighter: "greedy", label: "greedy-web", spacing: SwordSpacing.WEB },
	{ fighter: "tidy", label: "tidy-brake", spacing: SwordSpacing.ON },
	{ fighter: "greedy", label: "greedy-brake", spacing: SwordSpacing.ON },
];

// ---------------------------------------------------------------------------------------------
// The greedy fighter

/** The 8 keys' world walk directions (keyboardMoveVector's screen vectors through screenToWorld), unit length. */
const KEY_DIRS: ReadonlyArray<{ readonly x: number; readonly z: number }> = (
	[
		[0, 1],
		[SQRT1_2, SQRT1_2],
		[1, 0],
		[SQRT1_2, -SQRT1_2],
		[0, -1],
		[-SQRT1_2, -SQRT1_2],
		[-1, 0],
		[-SQRT1_2, SQRT1_2],
	] as ReadonlyArray<readonly [number, number]>
).map(([right, up]) => screenToWorld(right, up));

/** The key direction nearest the world direction (dx, dz) (largest dot product; the first on a tie). */
export function nearestKeyDir(dx: number, dz: number): { readonly x: number; readonly z: number } {
	let best = KEY_DIRS[0];
	let bestDot = -math.huge;
	for (const k of KEY_DIRS) {
		const d = k.x * dx + k.z * dz;
		if (d > bestDot) {
			bestDot = d;
			best = k;
		}
	}
	return best;
}

function keyFrame(f: InputFrame, dx: number, dz: number): InputFrame {
	const k = nearestKeyDir(dx, dz);
	return { moveX: quantizeAxis(k.x), moveZ: quantizeAxis(k.z), aimX: f.aimX, aimZ: f.aimZ, buttons: f.buttons };
}

/** The greedy fighter heads straight at its target (the key nearest the line) within this of its edge, else along the path. */
export const GREEDY_DIRECT_TILES = SWORD_DATA.reach + 1;
/** A greedy key move that moved the player less than this last tick (not rolling) is stalled on a wall. */
const GREEDY_STALL_TILES = 0.01;

/**
 * The greedy fighter's frame (file comment): the tidy knight's decisions, keyboard moves that never stop. Within
 * GREEDY_DIRECT_TILES of the target's edge the key nearest the straight line to it (the habit measured); farther, the key
 * nearest the floor's path toward it (a player walking round the walls, not into them); and when the last tick's key move
 * stalled on a wall, the tidy frame's move for one tick (a player tries another key).
 */
export function greedyKnightFrame(
	s: SimState,
	t: ActorState | undefined,
	env: FightEnv,
	mem: FighterMemory,
	extra = 0,
): InputFrame {
	const f = fighterFrame(s, "knight", t, env, mem, extra);
	if (t === undefined) return f;
	if (bit32.band(f.buttons, Button.ROLL) !== 0) {
		return f.moveX === 0 && f.moveZ === 0 ? f : keyFrame(f, f.moveX, f.moveZ);
	}
	const p = s.player;
	if (!env.sees(p.x, p.z, t.x, t.z)) return f;
	if (p.rollTicks === 0 && math.abs(p.x - p.prevX) + math.abs(p.z - p.prevZ) < GREEDY_STALL_TILES) return f;
	const dx = t.x - p.x;
	const dz = t.z - p.z;
	if (dx === 0 && dz === 0) return f;
	if (math.sqrt(dx * dx + dz * dz) - t.radius <= GREEDY_DIRECT_TILES) return keyFrame(f, dx, dz);
	const [mx, mz] = env.pathDir(p.x, p.z, t.x, t.z);
	return mx === 0 && mz === 0 ? keyFrame(f, dx, dz) : keyFrame(f, mx, mz);
}

// ---------------------------------------------------------------------------------------------
// The contact probe

/** What landed a hit (file comment). */
export type HitCause = "contact" | "bullet" | "other";

export interface LandedHit {
	readonly cause: HitCause;
	readonly caller: string;
	readonly player: number;
	/** Contact hits: the actor's slot, id and kind; else -1. */
	readonly slot: number;
	readonly id: number;
	readonly kind: number;
}

type HurtAt = (me: SimCtx, i: number, halfHearts: number, source?: number) => boolean;
type Hurt = (me: SimCtx, halfHearts: number, source?: number) => boolean;
type HurtMethods = { hurtPlayerAt: HurtAt; hurtPlayer: Hurt };

/** A landed hit's cause from its caller's name (file comment). */
function causeOf(caller: string): HitCause {
	if (caller === "contactDamageOn") return "contact";
	if (caller === "enemyBulletHit" || caller === "enemyBulletHitParty") return "bullet";
	return "other";
}

/** The first live contact actor in slot order overlapping player `i` (contactDamageOn's pick), or -1. */
function contactSlot(ctx: SimCtx, i: number): number {
	const s = ctx.state;
	const p = playerAt(s, i);
	const actors = s.combat.actors;
	for (let j = 0; j < actors.size(); j++) {
		const a = actors[j];
		if (a.kind === NO_KIND || a.alive === 0) continue;
		if (archetypeAt(a.kind).data.contactDamage <= 0) continue;
		const r = a.radius + PLAYER_RADIUS;
		const dx = p.x - a.x;
		const dz = p.z - a.z;
		if (dx * dx + dz * dz < r * r) return j;
	}
	return -1;
}

/**
 * Wraps SimCtx.hurtPlayerAt while installed (file comment) and collects this tick's landed hits. Install once around a
 * run, restore in every case (`restore`).
 */
export class ContactProbe {
	readonly landed: LandedHit[] = [];
	/** Every caller name seen landing a hit, with its count (the "other" bucket's breakdown). */
	readonly callers = new Map<string, number>();
	private original: HurtMethods | undefined;

	install(): void {
		if (this.original !== undefined) return;
		const cls = SimCtx as unknown as HurtMethods;
		const hurtAt = cls.hurtPlayerAt;
		const hurt = cls.hurtPlayer;
		this.original = { hurtPlayerAt: hurtAt, hurtPlayer: hurt };
		const landed = this.landed;
		const callers = this.callers;
		const note = (me: SimCtx, i: number, caller: string) => {
			callers.set(caller, (callers.get(caller) ?? 0) + 1);
			const cause = causeOf(caller);
			let slot = -1;
			let id = -1;
			let kind = -1;
			if (cause === "contact") {
				slot = contactSlot(me, i);
				if (slot >= 0) {
					const a = me.state.combat.actors[slot];
					id = a.id;
					kind = a.kind;
				}
			}
			landed.push({ cause, caller, player: i, slot, id, kind });
		};
		cls.hurtPlayerAt = (me, i, halfHearts, source) => {
			const ok = hurtAt(me, i, halfHearts, source);
			if (ok) note(me, i, debug.info(2, "n")[0] ?? "?");
			return ok;
		};
		// The solo bullet walk hurts the bound player (SimCtx.hurtPlayer, which never calls hurtPlayerAt).
		cls.hurtPlayer = (me, halfHearts, source) => {
			const ok = hurt(me, halfHearts, source);
			if (ok) note(me, me.playerIndex, debug.info(2, "n")[0] ?? "?");
			return ok;
		};
	}

	restore(): void {
		if (this.original === undefined) return;
		const cls = SimCtx as unknown as HurtMethods;
		cls.hurtPlayerAt = this.original.hurtPlayerAt;
		cls.hurtPlayer = this.original.hurtPlayer;
		this.original = undefined;
	}
}

// ---------------------------------------------------------------------------------------------
// Position history and attribution

interface Snapshot {
	tick: number;
	floor: number;
	px: number;
	pz: number;
	/** After the step: the finisher winding up (its lunge steps next tick), the player rolling. */
	windup: boolean;
	rolling: boolean;
	/** The tick's frame had the brake's hook on (brake-off walk, file comment); the sword guarding after the step. */
	brakeOn: boolean;
	guard: boolean;
	readonly ax: number[];
	readonly az: number[];
	readonly id: number[];
}

/** The last SPACING_WINDOW_TICKS + 1 snapshots (after every step), a ring. */
class History {
	private readonly ring: Snapshot[] = [];
	private head = -1;
	private count = 0;

	constructor() {
		for (let k = 0; k <= SPACING_WINDOW_TICKS; k++)
			this.ring.push({
				tick: -1,
				floor: -1,
				px: 0,
				pz: 0,
				windup: false,
				rolling: false,
				brakeOn: false,
				guard: false,
				ax: [],
				az: [],
				id: [],
			});
	}

	record(s: SimState, brakeOn: boolean): void {
		this.head = (this.head + 1) % this.ring.size();
		this.count = math.min(this.count + 1, this.ring.size());
		const snap = this.ring[this.head];
		snap.tick = s.tick;
		snap.floor = s.endless?.floor ?? 0;
		snap.px = s.player.x;
		snap.pz = s.player.z;
		const w = weaponsAt(s, 0);
		const slot = w.sets[w.activeSet];
		snap.windup = slot.weapon === swordIndex() && slot.v[SWORD_V_STEP] === SWORD_STEP_WINDUP;
		snap.rolling = s.player.rollTicks > 0;
		snap.brakeOn = brakeOn;
		snap.guard = slot.weapon === swordIndex() && slot.v[SWORD_V_GUARD] > 0;
		const actors = s.combat.actors;
		for (let j = 0; j < actors.size(); j++) {
			const a = actors[j];
			const live = a.kind !== NO_KIND && a.alive !== 0;
			snap.ax[j] = a.x;
			snap.az[j] = a.z;
			snap.id[j] = live ? a.id : -1;
		}
		for (let j = actors.size(); j < snap.id.size(); j++) snap.id[j] = -1;
	}

	/** The snapshot `back` ticks before the newest (0 = newest), or undefined. */
	at(back: number): Snapshot | undefined {
		if (back >= this.count) return undefined;
		const n = this.ring.size();
		return this.ring[(this.head - back + n * 2) % n];
	}
}

const dist = (x1: number, z1: number, x2: number, z2: number) =>
	math.sqrt((x1 - x2) * (x1 - x2) + (z1 - z2) * (z1 - z2));

/** One contact hit's window (attribute): closing (positive = the gap shrank) by the player, split by what moved it. */
interface Closing {
	byPlayer: number;
	byActor: number;
	/** The player's part on walk ticks, finisher lunge ticks (with their slowed walk) and roll ticks. */
	walk: number;
	lunge: number;
	roll: number;
	ticks: number;
}

/** The entry split (file comment): closing since the gap was last at or outside keep, the player's by class. */
interface Entry {
	byPlayer: number;
	byActor: number;
	walkOn: number;
	walkOff: number;
	walkGuard: number;
	lunge: number;
	roll: number;
	/** The gap was inside keep over the whole window. */
	deep: boolean;
}

const closing: Closing = { byPlayer: 0, byActor: 0, walk: 0, lunge: 0, roll: 0, ticks: 0 };
const entry: Entry = { byPlayer: 0, byActor: 0, walkOn: 0, walkOff: 0, walkGuard: 0, lunge: 0, roll: 0, deep: true };

/**
 * The window before the newest snapshot for actor `slot` / `id` (file comment), into the module scratch `closing`. A
 * tick is a lunge tick when the snapshot before it shows the finisher winding up (the wind-up lunges in the next
 * stepWeapons), a roll tick when either side shows a roll. The entry split (file comment) goes into the module scratch
 * `entry`, for an actor of keep distance `keep`.
 */
function attribute(h: History, slot: number, id: number, keep: number): Closing {
	const now = h.at(0)!;
	const c = closing;
	c.byPlayer = 0;
	c.byActor = 0;
	c.walk = 0;
	c.lunge = 0;
	c.roll = 0;
	c.ticks = 0;
	const e = entry;
	e.byPlayer = 0;
	e.byActor = 0;
	e.walkOn = 0;
	e.walkOff = 0;
	e.walkGuard = 0;
	e.lunge = 0;
	e.roll = 0;
	e.deep = true;
	for (let back = 1; back <= SPACING_WINDOW_TICKS; back++) {
		const a = h.at(back - 1)!;
		const b = h.at(back);
		if (b === undefined || b.floor !== now.floor || b.id[slot] !== id || a.id[slot] !== id) break;
		const p0x = b.px;
		const p0z = b.pz;
		const a0x = b.ax[slot];
		const a0z = b.az[slot];
		const p1x = a.px;
		const p1z = a.pz;
		const a1x = a.ax[slot];
		const a1z = a.az[slot];
		const d00 = dist(p0x, p0z, a0x, a0z);
		const d11 = dist(p1x, p1z, a1x, a1z);
		const playerPart = 0.5 * (dist(p1x, p1z, a0x, a0z) - d00 + (d11 - dist(p0x, p0z, a1x, a1z)));
		const actorPart = d11 - d00 - playerPart;
		c.byPlayer -= playerPart;
		c.byActor -= actorPart;
		if (a.rolling || b.rolling) c.roll -= playerPart;
		else if (b.windup) c.lunge -= playerPart;
		else c.walk -= playerPart;
		c.ticks++;
		if (e.deep) {
			e.byPlayer -= playerPart;
			e.byActor -= actorPart;
			if (a.rolling || b.rolling) e.roll -= playerPart;
			else if (b.windup) e.lunge -= playerPart;
			else if (a.brakeOn) e.walkOn -= playerPart;
			else {
				e.walkOff -= playerPart;
				if (a.guard) e.walkGuard -= playerPart;
			}
			if (d00 >= keep) e.deep = false; // the entry began at b
		}
	}
	return c;
}

// ---------------------------------------------------------------------------------------------
// The census

/** Contact hits of one archetype. */
export interface ArchetypeContact {
	hits: number;
	playerDriven: number;
	enemyDriven: number;
	/** Sums of the closing distances (tiles) over the window, for the means; the player's split by what moved it. */
	playerClose: number;
	enemyClose: number;
	walkClose: number;
	lungeClose: number;
	rollClose: number;
	/** Player-driven hits whose lunge ticks closed more than the walk and roll ticks together. */
	lungeLed: number;
	/**
	 * The entry split (file comment): player-driven entries, by the class that moved the player most (a braked walk, an
	 * unbraked walk and of those a guard's, the lunge, a roll), and the hits whose gap was inside keep the whole window.
	 */
	entryPlayer: number;
	entryWalkOn: number;
	entryWalkOff: number;
	entryGuard: number;
	entryLunge: number;
	entryRoll: number;
	entryDeep: number;
	/** Hits where neither side closed SPACING_STANDING_TILES (already in contact when the post-hit window ran out). */
	standing: number;
}

/** A contact hit is "standing" when neither the player nor the actor closed this much over the window (tiles). */
export const SPACING_STANDING_TILES = 0.05;

function newArchetypeContact(): ArchetypeContact {
	return {
		hits: 0,
		playerDriven: 0,
		enemyDriven: 0,
		playerClose: 0,
		enemyClose: 0,
		walkClose: 0,
		lungeClose: 0,
		rollClose: 0,
		lungeLed: 0,
		entryPlayer: 0,
		entryWalkOn: 0,
		entryWalkOff: 0,
		entryGuard: 0,
		entryLunge: 0,
		entryRoll: 0,
		entryDeep: 0,
		standing: 0,
	};
}

/** One run's (or a census's) totals. */
export interface SpacingTotals {
	runs: number;
	floors: number;
	rooms: number;
	roomsCleared: number;
	/** Ticks of the cleared room fights (mean clear time = clearTicks / roomsCleared). */
	clearTicks: number;
	bossFights: number;
	/** Contact hits by fight kind (travel: walks between fights). */
	contactRoom: number;
	contactBoss: number;
	contactTravel: number;
	bulletHits: number;
	otherHits: number;
	/** Fight ticks, and those inside a contact enemy's keep distance / contact range: room fights, boss fights. */
	fightTicks: number;
	inKeepTicks: number;
	inContactTicks: number;
	bossFightTicks: number;
	bossInKeepTicks: number;
	bossInContactTicks: number;
	/** Ticks whose last brake call cut the step (file comment): all, and those in a room fight. */
	brakeTicks: number;
	brakeRoomTicks: number;
	/** Per archetype id. */
	readonly byKind: Map<string, ArchetypeContact>;
	/** Landed-hit callers (the probe's breakdown). */
	readonly callers: Map<string, number>;
	readonly ticks: number[];
}

export function newSpacingTotals(): SpacingTotals {
	return {
		runs: 0,
		floors: 0,
		rooms: 0,
		roomsCleared: 0,
		clearTicks: 0,
		bossFights: 0,
		contactRoom: 0,
		contactBoss: 0,
		contactTravel: 0,
		bulletHits: 0,
		otherHits: 0,
		fightTicks: 0,
		inKeepTicks: 0,
		inContactTicks: 0,
		bossFightTicks: 0,
		bossInKeepTicks: 0,
		bossInContactTicks: 0,
		brakeTicks: 0,
		brakeRoomTicks: 0,
		byKind: new Map(),
		callers: new Map(),
		ticks: [],
	};
}

/** Adds `b` into `a`. */
export function mergeSpacingTotals(a: SpacingTotals, b: SpacingTotals): void {
	a.runs += b.runs;
	a.floors += b.floors;
	a.rooms += b.rooms;
	a.roomsCleared += b.roomsCleared;
	a.clearTicks += b.clearTicks;
	a.bossFights += b.bossFights;
	a.contactRoom += b.contactRoom;
	a.contactBoss += b.contactBoss;
	a.contactTravel += b.contactTravel;
	a.bulletHits += b.bulletHits;
	a.otherHits += b.otherHits;
	a.fightTicks += b.fightTicks;
	a.inKeepTicks += b.inKeepTicks;
	a.inContactTicks += b.inContactTicks;
	a.bossFightTicks += b.bossFightTicks;
	a.bossInKeepTicks += b.bossInKeepTicks;
	a.bossInContactTicks += b.bossInContactTicks;
	a.brakeTicks += b.brakeTicks;
	a.brakeRoomTicks += b.brakeRoomTicks;
	for (const [k, v] of b.byKind) {
		const t = a.byKind.get(k) ?? newArchetypeContact();
		t.hits += v.hits;
		t.playerDriven += v.playerDriven;
		t.enemyDriven += v.enemyDriven;
		t.playerClose += v.playerClose;
		t.enemyClose += v.enemyClose;
		t.walkClose += v.walkClose;
		t.lungeClose += v.lungeClose;
		t.rollClose += v.rollClose;
		t.lungeLed += v.lungeLed;
		t.entryPlayer += v.entryPlayer;
		t.entryWalkOn += v.entryWalkOn;
		t.entryWalkOff += v.entryWalkOff;
		t.entryGuard += v.entryGuard;
		t.entryLunge += v.entryLunge;
		t.entryRoll += v.entryRoll;
		t.entryDeep += v.entryDeep;
		t.standing += v.standing;
		a.byKind.set(k, t);
	}
	for (const [k, v] of b.callers) a.callers.set(k, (a.callers.get(k) ?? 0) + v);
	for (const t of b.ticks) a.ticks.push(t);
}

/** The keep / contact test on the state the fighter reads (file comment). */
function keepFlags(s: SimState): [boolean, boolean] {
	const p = s.player;
	let keep = false;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		if (archetypeAt(a.kind).data.contactDamage <= 0) continue;
		const d = dist(p.x, p.z, a.x, a.z);
		if (d < a.radius + PLAYER_RADIUS) return [true, true];
		if (d < a.radius + PLAYER_RADIUS + SPACING_KEEP_MARGIN) keep = true;
	}
	return [keep, false];
}

/** One census run (file comment); `limitTicks` (smoke specs) stops the run after that many steps. */
export function spacingRun(seed: number, options: SpacingRunOptions, limitTicks?: number): SpacingTotals {
	const totals = newSpacingTotals();
	const probe = new ContactProbe();
	const history = new History();
	let fight: "room" | "boss" | "" = "";
	let brakeOn = false;
	let steps = 0;
	const onStep = (s: SimState) => {
		steps++;
		history.record(s, brakeOn);
		if (BRAKE_RESULT.engaged) {
			totals.brakeTicks++;
			if (fight === "room") totals.brakeRoomTicks++;
			BRAKE_RESULT.engaged = false;
		}
		for (const hit of probe.landed) {
			if (hit.cause === "bullet") totals.bulletHits++;
			else if (hit.cause === "other") totals.otherHits++;
			else {
				if (fight === "room") totals.contactRoom++;
				else if (fight === "boss") totals.contactBoss++;
				else totals.contactTravel++;
				const name = hit.kind >= 0 ? archetypeAt(hit.kind).id : "?";
				const t = totals.byKind.get(name) ?? newArchetypeContact();
				t.hits++;
				if (hit.slot >= 0) {
					const keep = s.combat.actors[hit.slot].radius + PLAYER_RADIUS + SPACING_KEEP_MARGIN;
					const c = attribute(history, hit.slot, hit.id, keep);
					t.playerClose += c.byPlayer;
					t.enemyClose += c.byActor;
					t.walkClose += c.walk;
					t.lungeClose += c.lunge;
					t.rollClose += c.roll;
					if (c.byPlayer > c.byActor) {
						t.playerDriven++;
						if (c.lunge > c.walk + c.roll) t.lungeLed++;
					} else t.enemyDriven++;
					const e = entry;
					if (e.deep) t.entryDeep++;
					if (e.byPlayer > e.byActor) {
						t.entryPlayer++;
						const most = math.max(e.walkOn, e.walkOff, e.lunge, e.roll);
						if (most === e.walkOff) {
							t.entryWalkOff++;
							if (e.walkGuard > e.walkOff / 2) t.entryGuard++;
						} else if (most === e.walkOn) t.entryWalkOn++;
						else if (most === e.lunge) t.entryLunge++;
						else t.entryRoll++;
					}
					if (c.byPlayer < SPACING_STANDING_TILES && c.byActor < SPACING_STANDING_TILES) t.standing++;
				} else t.enemyDriven++;
				totals.byKind.set(name, t);
			}
		}
		probe.landed.clear();
		fight = "";
		brakeOn = false;
		if (limitTicks !== undefined && steps >= limitTicks) s.player.dead = 1; // ends the bot's loops (smoke only)
	};
	const greedy = options.fighter === "greedy";
	const maxFloor = options.maxFloor ?? SWORD_SPACING_CENSUS.maxFloor;
	let run: SurvivalRun;
	const previousSpacing = setSwordSpacing(options.spacing ?? SwordSpacing.ON);
	BRAKE_RESULT.engaged = false;
	probe.install();
	try {
		run = survivalRun(seed, "knight", {
			maxFloor: maxFloor,
			immortal: options.immortal !== false,
			onStep,
			fighter: (s, mode, t, env, mem, extra, kind) => {
				fight = kind;
				const [keep, contact] = keepFlags(s);
				if (kind === "room") {
					totals.fightTicks++;
					if (keep || contact) totals.inKeepTicks++;
					if (contact) totals.inContactTicks++;
				} else {
					totals.bossFightTicks++;
					if (keep || contact) totals.bossInKeepTicks++;
					if (contact) totals.bossInContactTicks++;
				}
				const f = greedy ? greedyKnightFrame(s, t, env, mem, extra) : fighterFrame(s, mode, t, env, mem, extra);
				brakeOn = weaponSpacingActive(weaponsAt(s, 0), f.buttons);
				return f;
			},
		});
	} finally {
		probe.restore();
		setSwordSpacing(previousSpacing);
	}
	totals.runs = 1;
	totals.floors = math.min(run.floorReached, maxFloor + 1) - 1;
	totals.rooms = run.rooms.size();
	for (const r of run.rooms)
		if (r.cleared) {
			totals.roomsCleared++;
			totals.clearTicks += r.ticks;
		}
	totals.bossFights = run.bosses.size();
	for (const [k, v] of probe.callers) totals.callers.set(k, v);
	totals.ticks.push(run.ticks);
	return totals;
}

const f1 = (x: number) => string.format("%.1f", x);
const f2 = (x: number) => string.format("%.2f", x);
const pct = (a: number, b: number) => (b > 0 ? string.format("%.1f %%", (100 * a) / b) : "-");

/** Printed lines of a census (a markdown table per archetype, then the totals). */
export function formatSpacingTotals(label: string, t: SpacingTotals): string[] {
	const lines: string[] = [];
	const contact = t.contactRoom + t.contactBoss + t.contactTravel;
	lines.push(
		`[spacing] ${label}: | archetype | contact hits | player-driven (lunge-led) | enemy-driven | standing | ` +
			`mean close player (walk / lunge / roll) / enemy | ` +
			`entry: player (walk braked / unbraked (guard) / lunge / roll), deep |`,
	);
	const names: string[] = [];
	for (const [k] of t.byKind) names.push(k);
	names.sort();
	let pd = 0;
	let ed = 0;
	for (const k of names) {
		const v = t.byKind.get(k)!;
		pd += v.playerDriven;
		ed += v.enemyDriven;
		const m = (x: number) => f2(x / v.hits);
		lines.push(
			`[spacing] ${label}: | ${k} | ${v.hits} | ${v.playerDriven} (${v.lungeLed}) | ${v.enemyDriven} | ${
				v.standing
			} | ${m(v.playerClose)} (${m(v.walkClose)} / ${m(v.lungeClose)} / ${m(v.rollClose)}) / ${m(
				v.enemyClose,
			)} | ${v.entryPlayer} (${v.entryWalkOn} / ${v.entryWalkOff} (${v.entryGuard}) / ${v.entryLunge} / ${
				v.entryRoll
			}), ${v.entryDeep} |`,
		);
	}
	lines.push(`[spacing] ${label}: | all | ${contact} | ${pd} | ${ed} | | |`);
	lines.push(
		`[spacing] ${label}: runs ${t.runs}, floors ${t.floors}, rooms ${t.rooms} (cleared ${
			t.roomsCleared
		}), boss fights ${t.bossFights}; contact hits room ${t.contactRoom} / boss ${t.contactBoss} / travel ${
			t.contactTravel
		}, per room ${t.rooms > 0 ? f2(t.contactRoom / t.rooms) : "-"}; bullet hits ${t.bulletHits}, other ${
			t.otherHits
		}; mean clear ${t.roomsCleared > 0 ? f1(t.clearTicks / t.roomsCleared) : "-"} ticks; room fight ticks ${
			t.fightTicks
		}, in keep ${pct(t.inKeepTicks, t.fightTicks)}, in contact ${pct(
			t.inContactTicks,
			t.fightTicks,
		)}; boss fight ticks ${t.bossFightTicks}, in keep ${pct(t.bossInKeepTicks, t.bossFightTicks)}, in contact ${pct(
			t.bossInContactTicks,
			t.bossFightTicks,
		)}; brake ticks ${t.brakeTicks} (room fights ${t.brakeRoomTicks})`,
	);
	const callers: string[] = [];
	for (const [k, v] of t.callers) callers.push(`${k} ${v}`);
	callers.sort();
	lines.push(`[spacing] ${label}: callers ${callers.join(", ")}`);
	return lines;
}

/**
 * One machine-readable line of `t` (`[spacing-raw] <label> key=value ...`, archetypes as `kind:<id>=hits/player/enemy/
 * playerClose/enemyClose`), so the shards' totals can be summed for the doc.
 */
export function formatSpacingRaw(label: string, t: SpacingTotals): string {
	const parts: string[] = [];
	const scalar: ReadonlyArray<keyof SpacingTotals> = [
		"runs",
		"floors",
		"rooms",
		"roomsCleared",
		"clearTicks",
		"bossFights",
		"contactRoom",
		"contactBoss",
		"contactTravel",
		"bulletHits",
		"otherHits",
		"fightTicks",
		"inKeepTicks",
		"inContactTicks",
		"bossFightTicks",
		"bossInKeepTicks",
		"bossInContactTicks",
		"brakeTicks",
		"brakeRoomTicks",
	];
	for (const k of scalar) parts.push(`${k}=${t[k] as number}`);
	const n6 = (x: number) => string.format("%.6f", x);
	for (const [k, v] of t.byKind) {
		const xs = [
			v.hits,
			v.playerDriven,
			v.enemyDriven,
			n6(v.playerClose),
			n6(v.enemyClose),
			n6(v.walkClose),
			n6(v.lungeClose),
			n6(v.rollClose),
			v.lungeLed,
			v.standing,
			v.entryPlayer,
			v.entryWalkOn,
			v.entryWalkOff,
			v.entryGuard,
			v.entryLunge,
			v.entryRoll,
			v.entryDeep,
		];
		parts.push(`kind:${k}=${xs.join("/")}`);
	}
	for (const [k, v] of t.callers) parts.push(`caller:${k}=${v}`);
	let ticks = 0;
	for (const x of t.ticks) ticks += x;
	parts.push(`simTicks=${ticks}`);
	return `[spacing-raw] ${label} ${parts.join(" ")}`;
}

/** One shard of the census (run seeds first..last, censusShard): every column over its seeds, merged, and its lines. */
export function swordSpacingShard(
	first: number,
	last: number,
	columns: ReadonlyArray<SpacingRunOptions> = SPACING_CENSUS_COLUMNS,
): { readonly lines: string[]; readonly totals: SpacingTotals[] } {
	const lines: string[] = [];
	const totals: SpacingTotals[] = [];
	for (const col of columns) {
		const all = newSpacingTotals();
		for (let seed = first; seed <= last; seed++) mergeSpacingTotals(all, spacingRun(seed, col));
		totals.push(all);
		for (const l of formatSpacingTotals(`${col.label} seeds ${first}-${last}`, all)) lines.push(l);
		lines.push(formatSpacingRaw(col.label, all));
	}
	return { lines, totals };
}
