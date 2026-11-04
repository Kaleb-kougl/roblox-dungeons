/**
 * The Goldling in the sim (docs/FORTUNE.md "The Goldling", Design §3, GE2 / GE3; a Roblox-port feature, no web source).
 * OPT-IN: only a SimConfig with `golden` creates `SimState.golden`, and only then does anything here run or the hash
 * grow the appended `golden` group (the LAST group). Without it nothing changes (M1, every golden fixture, the
 * tutorial, every replay that does not set it).
 *
 * Which room (if any) holds a Goldling is floor data (shared/dungeon placeGolden, EndlessFloorWorld.golden): the sim
 * copies it in at floor start (goldenOnFloor) and draws NOTHING from the main rng (state.rngState) or the drops' stream
 * for it. Its own stream (`rngState`, seedToState(seed) ^ GOLDEN_SIM_SALT) is drawn for a jink's side and the catch's
 * boost kinds only.
 *
 *   floor start   goldenOnFloor (createSimState after the score state; stepEndless after rebuildScoreRooms): status
 *                 WAITING with the floor's FloorGolden (its score record index in `record`), else NONE; every per-floor
 *                 field reset. The actor of a Goldling still out is freed with every other actor by the floor change
 *                 (gone, no counter).
 *   appear        stepGolden.ts (after stepScore): appearTicks after the room's record engaged, on the room's spawn tile
 *                 farthest from every living player; a full pool: SKIPPED.
 *   run           the archetype (combat/actors/archetypes/golden.ts) flees on the field of goldenField.ts.
 *   hit / catch   the archetype's onHit / onDeath (goldenHooks.ts): coins per damaging hit, the jackpot on the kill.
 *   escape        stepGolden.ts: its time (escapeTicks) is up: freed (no onDeath, score or drops), ESCAPED.
 *
 * This module holds the config, the state, its floor fill, clone and hash. A LEAF (shared/dungeon, types and
 * goldenData.ts only): the archetype and stepGolden import it without a require cycle.
 */
import type { FloorGolden, FleeScratch } from "shared/dungeon";
import { seedToState } from "../rng";
import type { SimState } from "../state";
import {
	GOLDEN_APPEAR_TICKS,
	GOLDEN_ESCAPE_TICKS,
	GOLDEN_EXTRA_BOOSTS,
	GOLDEN_FIELD_TICKS,
	GOLDEN_HIT_POINTS,
	GOLDEN_JINK_COOLDOWN_TICKS,
	GOLDEN_JINK_RANGE,
	GOLDEN_JINK_SPEED,
	GOLDEN_JINK_TICKS,
	GOLDEN_KILL_POINTS,
	GOLDEN_SIM_SALT,
	GoldenStatus,
} from "./goldenData";

/** SimConfig.golden: presence turns the Goldling on (endless runs: each floor's room comes from its world). */
export interface GoldenConfig {
	/** Ticks from the room's engagement to its appearance. */
	readonly appearTicks: number;
	/** Ticks from its appearance to its escape. */
	readonly escapeTicks: number;
	/** The flee field's sources are re-read every this many ticks. */
	readonly fieldTicks: number;
	/** Jink: a living player within jinkRange (world units) with the cooldown ready starts a jinkTicks sidestep. */
	readonly jinkRange: number;
	readonly jinkCooldownTicks: number;
	readonly jinkTicks: number;
	/** The sidestep's speed, world units / s. */
	readonly jinkSpeed: number;
	/** Base points per damaging hit and of the catch (both x the kills' floor scale). */
	readonly hitPoints: number;
	readonly killPoints: number;
	/** The catch lands party size + extraBoosts boosts. */
	readonly extraBoosts: number;
}

/** The game's Goldling rules (docs/FORTUNE.md; endless worlds). */
export const ENDLESS_GOLDEN_CONFIG: GoldenConfig = table.freeze({
	appearTicks: GOLDEN_APPEAR_TICKS,
	escapeTicks: GOLDEN_ESCAPE_TICKS,
	fieldTicks: GOLDEN_FIELD_TICKS,
	jinkRange: GOLDEN_JINK_RANGE,
	jinkCooldownTicks: GOLDEN_JINK_COOLDOWN_TICKS,
	jinkTicks: GOLDEN_JINK_TICKS,
	jinkSpeed: GOLDEN_JINK_SPEED,
	hitPoints: GOLDEN_HIT_POINTS,
	killPoints: GOLDEN_KILL_POINTS,
	extraBoosts: GOLDEN_EXTRA_BOOSTS,
});

/** A damaging hit this tick (presentation: the coin burst, the +50 pop, the climbing hit sound). */
export interface GoldenHitEvent {
	readonly x: number;
	readonly z: number;
	/** The hitting player (SimCtx.playerIndex at the hit). */
	readonly player: number;
	readonly points: number;
	/** Damaging hits so far on this Goldling, this one included (the hit sound's ladder step). */
	readonly hits: number;
}

/** The catch this tick. */
export interface GoldenCaughtEvent {
	readonly x: number;
	readonly z: number;
	readonly player: number;
	/** The kill's points (the jackpot; the killing hit's coins are in `hits`). */
	readonly points: number;
	/** Ground slots of the boosts that landed (state.drops), in landing order. */
	readonly boosts: number[];
	/** Boosts lost to a full ground. */
	lost: number;
}

/** Per-tick Goldling events for presentation. Cleared at the start of every tick; NOT hashed. */
export interface GoldenEvents {
	/** 1 on the tick it appeared (its actor: GoldenState.actorSlot). */
	appeared: number;
	/** 1 on the tick it was due but the pool was full. */
	skipped: number;
	/** The catch's kill points this tick (score.ts scoreKill writes it just before onDeath; 0 otherwise). */
	jackpot: number;
	hits: GoldenHitEvent[];
	caught?: GoldenCaughtEvent;
	/** Where it escaped from, on the tick it did (its coins: GoldenState.coins). */
	escaped?: { readonly x: number; readonly z: number };
}

/**
 * The flee field cache (goldenField.ts): a pure function of hashed state (the floor's walk mask, `src` at `fieldTick`
 * and the intact breakables), rebuilt whenever its key differs. NOT hashed; a clone starts with an empty cache.
 */
export interface GoldenFieldCache {
	/** Key: the GoldenState.fieldTick it was built for (-1: empty), the floor data and the intact piece count. */
	fieldTick: number;
	floor: FloorGolden | undefined;
	intact: number;
	/** Per box cell: 1 when the Goldling can stand there now (walk mask minus intact breakables). */
	open: number[];
	/** The flee field (shared/dungeon fleeField). */
	field: number[];
	scratch: FleeScratch | undefined;
}

/** SimState.golden. Plain numbers (every one hashed but the floor data, the cache and the events). */
export interface GoldenState {
	readonly config: GoldenConfig;
	/** The Goldling's own mulberry32 word (hashed). */
	rngState: number;
	/** GoldenStatus. */
	status: number;
	/** The floor's Goldling room (encounter room id), -1 for none. */
	room: number;
	/** Index into state.score.rooms of that room's record, -1 for none (or no scoring). */
	record: number;
	/** The tick its room engaged (-1: not yet). */
	engageTick: number;
	/** The tick it appears / appeared (engageTick + appearTicks; -1: not known yet). */
	appearTick: number;
	/** Its actor's pool slot and ActorState.id while RUNNING (and after: the corpse / last position), -1 / 0 before. */
	actorSlot: number;
	actorId: number;
	/** Coins won from this floor's Goldling so far (its hits' points; the jackpot not included). */
	coins: number;
	/** Damaging hits on this floor's Goldling. */
	hits: number;
	/** Run counters: Goldlings that appeared, were caught, escaped. */
	seen: number;
	caught: number;
	escaped: number;
	/** The flee field's sources: the tick they were read (-1: never this floor) and the box cells (living players). */
	fieldTick: number;
	src: number[];
	/** Floor data (EndlessFloorWorld.golden): hashed through `room` only. */
	floor: FloorGolden | undefined;
	/** Not hashed (a pure function of hashed state). */
	cache: GoldenFieldCache;
	/** Not hashed. */
	events: GoldenEvents;
}

function emptyEvents(): GoldenEvents {
	return { appeared: 0, skipped: 0, jackpot: 0, hits: [], caught: undefined, escaped: undefined };
}

function emptyCache(): GoldenFieldCache {
	return { fieldTick: -1, floor: undefined, intact: -1, open: [], field: [], scratch: undefined };
}

/** The Goldling stream's first word for a run seeded `seed` (seedToState(seed) XOR GOLDEN_SIM_SALT). */
export function goldenSeedState(seed: number): number {
	return bit32.bxor(seedToState(seed), GOLDEN_SIM_SALT);
}

/** A Goldling state with no floor yet (goldenOnFloor fills it). No rng. */
export function createGoldenState(config: GoldenConfig, seed: number): GoldenState {
	return {
		config,
		rngState: goldenSeedState(seed),
		status: GoldenStatus.NONE,
		room: -1,
		record: -1,
		engageTick: -1,
		appearTick: -1,
		actorSlot: -1,
		actorId: 0,
		coins: 0,
		hits: 0,
		seen: 0,
		caught: 0,
		escaped: 0,
		fieldTick: -1,
		src: [],
		floor: undefined,
		cache: emptyCache(),
		events: emptyEvents(),
	};
}

/**
 * A new floor (createSimState after the score state, stepEndless after rebuildScoreRooms): WAITING with `floor`'s
 * Goldling room (its score record looked up), else NONE; every per-floor field reset, the run counters and the stream
 * kept. No-op without state.golden. No rng.
 */
export function goldenOnFloor(state: SimState, floor: FloorGolden | undefined): void {
	const g = state.golden;
	if (g === undefined) return;
	g.floor = floor;
	g.status = floor !== undefined ? GoldenStatus.WAITING : GoldenStatus.NONE;
	g.room = floor !== undefined ? floor.room : -1;
	g.record = -1;
	if (floor !== undefined) {
		const records = state.score?.rooms ?? [];
		for (let k = 0; k < records.size(); k++) {
			if (records[k].room === floor.room) {
				g.record = k;
				break;
			}
		}
	}
	g.engageTick = -1;
	g.appearTick = -1;
	g.actorSlot = -1;
	g.actorId = 0;
	g.coins = 0;
	g.hits = 0;
	g.fieldTick = -1;
	g.src.clear();
	g.cache = emptyCache();
}

/** Start of every tick (step.ts, with the other event clears; frozen draft ticks too). */
export function clearGoldenEvents(g: GoldenState): void {
	const e = g.events;
	e.appeared = 0;
	e.skipped = 0;
	e.jackpot = 0;
	e.hits.clear();
	e.caught = undefined;
	e.escaped = undefined;
}

export function cloneGoldenState(g: Readonly<GoldenState>): GoldenState {
	const e = g.events;
	const caught = e.caught;
	return {
		config: g.config,
		rngState: g.rngState,
		status: g.status,
		room: g.room,
		record: g.record,
		engageTick: g.engageTick,
		appearTick: g.appearTick,
		actorSlot: g.actorSlot,
		actorId: g.actorId,
		coins: g.coins,
		hits: g.hits,
		seen: g.seen,
		caught: g.caught,
		escaped: g.escaped,
		fieldTick: g.fieldTick,
		src: [...g.src],
		floor: g.floor,
		// A pure function of hashed state: the clone rebuilds it on first use.
		cache: emptyCache(),
		events: {
			appeared: e.appeared,
			skipped: e.skipped,
			jackpot: e.jackpot,
			hits: e.hits.map((h) => ({ ...h })),
			caught: caught !== undefined ? { ...caught, boosts: [...caught.boosts] } : undefined,
			escaped: e.escaped !== undefined ? { ...e.escaped } : undefined,
		},
	};
}

/** The Goldling's actor while it is out (RUNNING, its slot still holding its id), else undefined. */
export function goldenRunningSlot(state: Readonly<SimState>): number {
	const g = state.golden;
	if (g === undefined || g.status !== GoldenStatus.RUNNING) return -1;
	const a = state.combat.actors[g.actorSlot];
	return a !== undefined && a.id === g.actorId ? g.actorSlot : -1;
}

// ---------------------------------------------------------------------------------------------
// Hash: the `golden` group, appended after every other group only when state.golden exists (the last group).

/** Hashed scalar GoldenState fields, in order. Append only. */
export const GOLDEN_HASH_FIELDS = [
	"rngState",
	"status",
	"room",
	"record",
	"engageTick",
	"appearTick",
	"actorSlot",
	"actorId",
	"coins",
	"hits",
	"seen",
	"caught",
	"escaped",
	"fieldTick",
] as const;

/**
 * writeGoldenHash order: GOLDEN_HASH_FIELDS, then the source count and each source cell. The floor data (walk mask) is
 * a pure function of the floor seed and enters through `room`; the field cache is a pure function of hashed state.
 */
export function writeGoldenHash(g: Readonly<GoldenState>, out: number[]): void {
	for (const f of GOLDEN_HASH_FIELDS) out.push(g[f]);
	out.push(g.src.size());
	for (const c of g.src) out.push(c);
}

/** Dump names for writeGoldenHash, same order (`golden.status`, `golden.src[0]`, ...). */
export function goldenHashNames(g: Readonly<GoldenState>, out: string[]): void {
	for (const f of GOLDEN_HASH_FIELDS) out.push(`golden.${f}`);
	out.push("golden.src.length");
	for (let i = 0; i < g.src.size(); i++) out.push(`golden.src[${i}]`);
}
