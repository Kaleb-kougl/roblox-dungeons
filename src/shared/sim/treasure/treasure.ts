/**
 * Treasure rooms in the sim (docs/TREASURE.md TR2; a Roblox-port feature, no web source). OPT-IN: only a SimConfig
 * with `treasure` creates `SimState.treasure`, and only then does anything here run or the hash grow the appended
 * `treasure` group (after `pellets`, the LAST group). Without it nothing changes (M1, every golden fixture, the tutorial,
 * every replay that does not set it).
 *
 * Where the vault is, its lock and its starting tier are decided when the floor is built (shared/dungeon placeVault):
 * the sim copies the plan in at floor start (treasureOnFloor, from createSimState after the pellets and from
 * stepEndless's floor change after pelletsOnFloor) and draws NO rng for it. The chest itself is the floor's breakables
 * piece `plan.slot` (kind BreakableKind.CHEST: unbreakable, blocks bodies and bullets, not sight).
 *
 *   floor start   a vault plan whose room has a score record: SEALED with the plan's room, record index, slot, chest
 *                 centre (world), facing, lock and tier; every per-vault scalar reset. No plan, or a room without a
 *                 record (no scoring): NONE. An unopened vault of the floor before is lost silently. The run counters
 *                 (opened / kept / legendary), bonusDeals and the treasure stream carry over.
 *   the lock      stepTreasure.ts (TR3, after stepScore): SEALED -> ARMED -> (CRACKED) -> UNLOCKED.
 *   the open      TR4: UNLOCKED -> OPENED, the grants, drawn from this state's own stream (rngState: an RngHolder,
 *                 seedToState(seed) XOR TREASURE.salt, never state.rngState).
 *
 * This module holds the state, its floor fill, clone and hash. Score: score.ts scoreTreasure (ScoreSource.TREASURE,
 * combo-neutral), padded in by addTreasureScoreSources.
 */
import { gridToWorld, type VaultPlan } from "shared/dungeon";
import { seedToState } from "../rng";
import type { SimState } from "../state";
import { BreakableKind } from "../breakables/breakablesData";
import { TREASURE, TREASURE_UNSET, VaultStatus, type TreasureConfig } from "./treasureData";

/** Per-tick treasure events for presentation (toasts, the crack, the unlock). Cleared every tick; NOT hashed. */
export interface TreasureEvents {
	/** 1 on the tick the vault armed (its room engaged). */
	armed: number;
	/** 1 on the tick its lock cracked. */
	cracked: number;
	/** 1 on the tick its room cleared and the chest unlocked. */
	unlocked: number;
}

/** SimState.treasure: plain numbers, every field but `config` and `events` hashed. */
export interface TreasureState {
	readonly config: Readonly<TreasureConfig>;
	/** The treasure stream (mulberry32 word): an RngHolder for the open's draws (TR4). */
	rngState: number;
	/** VaultStatus. */
	status: number;
	/** The vault room's encounter room id, its score record index (state.score.rooms) and the chest's breakables slot. */
	room: number;
	record: number;
	slot: number;
	/** The chest's centre (world). */
	x: number;
	z: number;
	/** Facing into the room (the boosts land in front, TR4). */
	fx: number;
	fz: number;
	/** VaultLock. */
	lock: number;
	/** VaultTier the vault started at, and now (one lower after a crack). */
	startTier: number;
	tier: number;
	/** state.tick it armed, TREASURE_UNSET before. */
	armTick: number;
	/** SWIFT: ticks left on the countdown (TREASURE_UNSET for UNTOUCHED or before arming). */
	ticksLeft: number;
	/** UNTOUCHED: the party's hits allowed since the engagement (TREASURE_UNSET for SWIFT or before arming). */
	allowance: number;
	/** state.tick the lock cracked, TREASURE_UNSET while it holds. */
	crackTick: number;
	/** On the clear after a crack: SWIFT ticks over (clear tick - crack tick) / UNTOUCHED hits over the allowance. */
	missBy: number;
	/** On the clear with the lock kept: SWIFT ticks left / UNTOUCHED hits unused. */
	spare: number;
	/** Per player: extra deals for the next floor's draft (a Legendary open, TR4). */
	bonusDeals: number[];
	/** Run counters (the recap's highlight, TR4): chests opened, opened with the lock kept, opened Legendary. */
	opened: number;
	kept: number;
	legendary: number;
	/** Not hashed. */
	events: TreasureEvents;
}

/** The run's chest tally for the recap (docs/TREASURE.md Design §4, RR). */
export interface TreasureRunSummary {
	readonly opened: number;
	readonly kept: number;
	readonly legendary: number;
}

function emptyEvents(): TreasureEvents {
	return { armed: 0, cracked: 0, unlocked: 0 };
}

/** The treasure stream's first word for a run seeded `seed` (seedToState(seed) XOR TREASURE.salt). */
export function treasureSeedState(seed: number): number {
	return bit32.bxor(seedToState(seed), TREASURE.salt);
}

/** Every per-vault scalar back to "no vault" (status NONE). */
function resetVault(t: TreasureState): void {
	t.status = VaultStatus.NONE;
	t.room = TREASURE_UNSET;
	t.record = TREASURE_UNSET;
	t.slot = TREASURE_UNSET;
	t.x = 0;
	t.z = 0;
	t.fx = 0;
	t.fz = 0;
	t.lock = TREASURE_UNSET;
	t.startTier = TREASURE_UNSET;
	t.tier = TREASURE_UNSET;
	t.armTick = TREASURE_UNSET;
	t.ticksLeft = TREASURE_UNSET;
	t.allowance = TREASURE_UNSET;
	t.crackTick = TREASURE_UNSET;
	t.missBy = TREASURE_UNSET;
	t.spare = TREASURE_UNSET;
}

/** Treasure state at run start: `players` (the party size, 1 solo), no vault yet (treasureOnFloor fills it). No rng. */
export function createTreasureState(config: Readonly<TreasureConfig>, seed: number, players: number): TreasureState {
	const bonusDeals: number[] = [];
	for (let i = 0; i < players; i++) bonusDeals.push(0);
	return {
		config,
		rngState: treasureSeedState(seed),
		status: VaultStatus.NONE,
		room: TREASURE_UNSET,
		record: TREASURE_UNSET,
		slot: TREASURE_UNSET,
		x: 0,
		z: 0,
		fx: 0,
		fz: 0,
		lock: TREASURE_UNSET,
		startTier: TREASURE_UNSET,
		tier: TREASURE_UNSET,
		armTick: TREASURE_UNSET,
		ticksLeft: TREASURE_UNSET,
		allowance: TREASURE_UNSET,
		crackTick: TREASURE_UNSET,
		missBy: TREASURE_UNSET,
		spare: TREASURE_UNSET,
		bonusDeals,
		opened: 0,
		kept: 0,
		legendary: 0,
		events: emptyEvents(),
	};
}

/**
 * A new floor (createSimState after the pellets, stepEndless after pelletsOnFloor): the floor's vault `plan` (absent:
 * none) replaces the last floor's (see the file comment). No-op without state.treasure. With breakables, throws when
 * piece `plan.slot` is not an intact chest on the plan's cell (floor data out of step). No rng.
 */
export function treasureOnFloor(state: SimState, plan: VaultPlan | undefined): void {
	const t = state.treasure;
	if (t === undefined) return;
	resetVault(t);
	if (plan === undefined) return;
	const b = state.breakables;
	if (b !== undefined) {
		const piece = b.pieces[plan.slot];
		if (piece === undefined || piece.kind !== BreakableKind.CHEST || piece.x !== plan.x || piece.y !== plan.y)
			error(`treasure: breakables slot ${plan.slot} is not the vault's chest at (${plan.x}, ${plan.y})`, 0);
	}
	const records = state.score?.rooms ?? [];
	let record = TREASURE_UNSET;
	for (let k = 0; k < records.size(); k++) {
		if (records[k].room === plan.room) {
			record = k;
			break;
		}
	}
	if (record === TREASURE_UNSET) return;
	t.status = VaultStatus.SEALED;
	t.room = plan.room;
	t.record = record;
	t.slot = plan.slot;
	t.x = gridToWorld(plan.x);
	t.z = gridToWorld(plan.y);
	t.fx = plan.fx;
	t.fz = plan.fz;
	t.lock = plan.lock;
	t.startTier = plan.tier;
	t.tier = plan.tier;
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearTreasureEvents(t: TreasureState): void {
	const e = t.events;
	e.armed = 0;
	e.cracked = 0;
	e.unlocked = 0;
}

export function cloneTreasureState(t: Readonly<TreasureState>): TreasureState {
	return { ...t, bonusDeals: [...t.bonusDeals], events: { ...t.events } };
}

/** The run's chest tally (zeros without treasure). */
export function treasureRunSummary(state: Readonly<SimState>): TreasureRunSummary {
	const t = state.treasure;
	if (t === undefined) return { opened: 0, kept: 0, legendary: 0 };
	return { opened: t.opened, kept: t.kept, legendary: t.legendary };
}

// ---------------------------------------------------------------------------------------------
// Hash: the `treasure` group, appended after `pellets` (last) only when state.treasure exists.

/** Hashed scalars, in order (dump names `treasure.<name>`); then bonusDeals' length and values. Append only. */
export const TREASURE_HASH_FIELDS = [
	"rngState",
	"status",
	"room",
	"record",
	"slot",
	"x",
	"z",
	"fx",
	"fz",
	"lock",
	"startTier",
	"tier",
	"armTick",
	"ticksLeft",
	"allowance",
	"crackTick",
	"missBy",
	"spare",
	"opened",
	"kept",
	"legendary",
] as const;

export function writeTreasureHash(t: Readonly<TreasureState>, out: number[]): void {
	for (const f of TREASURE_HASH_FIELDS) out.push(t[f]);
	out.push(t.bonusDeals.size());
	for (const v of t.bonusDeals) out.push(v);
}

/** Dump names for writeTreasureHash, same order (`treasure.status`, `treasure.bonusDeals[1]`, ...). */
export function treasureHashNames(t: Readonly<TreasureState>, out: string[]): void {
	for (const f of TREASURE_HASH_FIELDS) out.push(`treasure.${f}`);
	out.push("treasure.bonusDeals.length");
	for (let i = 0; i < t.bonusDeals.size(); i++) out.push(`treasure.bonusDeals[${i}]`);
}
