/**
 * Boost drops in the sim (docs/BOOSTS.md B1 / B2; a Roblox-port feature, no web source). OPT-IN like breakables: only
 * a SimConfig with `drops` creates `SimState.drops`, and only then is anything here reached or the hash's "drops"
 * group written (appended after every other group). Without it (M1, every golden fixture, every world until it sets
 * the config) no code path below runs and every effect accessor (boostMods.ts) is neutral.
 *
 * Randomness: the drop stream is its OWN mulberry32 word (`DropsState.rngState`, seeded seedToState(seed) XOR
 * DROPS.salt), never state.rngState, so no boon offer, relic, curse or archetype draw moves when drops roll.
 *
 * Kills (dropsOnKill, from killActor before onDeath; kill order is deterministic, so the draw order is too):
 *   1. a guarantee (DropsConfig.guaranteed, the tutorial): the kill of the LAST living member of a guaranteed room's
 *      deferred spawns (dropsOnRoomSpawned recorded their actor ids) drops the guarantee's kind. No draw, no pity
 *      change but the reset; it bypasses every rule below (the training dummy too; with no free slot it is lost). Stop.
 *      A member's earlier deaths leave the guard (a reviving member counts its first death) and go on to 2 like any
 *      kill.
 *   2. not eligible (no draw, pity untouched): a reviving archetype (def.stepDead: turrets), a boss (data.boss), an
 *      archetype in DROP_INELIGIBLE_ARCHETYPES (the training dummy), or a kill inside the boss room (roomAt type
 *      "boss" or the encounter's bossRoom: the boss's summons and anything else in the arena).
 *   3. no free ground slot: skipped without a draw; it counts as a dry kill (killsSinceDrop += 1).
 *   4. pity (pityKills > 0 and killsSinceDrop >= pityKills): drops, no roll draw.
 *      else the archetype's percent (chanceByArchetype, else chancePercent): 0 -> dry, no draw; else ONE
 *      rngInt(0, 99) < percent drops, else dry (killsSinceDrop += 1).
 *   5. a drop picks its kind with ONE weighted rngInt(0, BOOST_TOTAL_WEIGHT - 1), lands in the lowest free slot at the
 *      actor's position (spawnTick = this tick, ticksLeft = groundTicks), killsSinceDrop = 0, events.dropped.
 * Draws per kill: guarantee 0, ineligible 0, full 0, pity 1, roll hit 2, roll miss 1, percent 0 0.
 *
 * stepDrops (step / stepParty: after stepRun, before stepScore, so a boon draft's frozen ticks skip it and every timer
 * freezes with the world), in this order:
 *   1. the floor changed this tick (events.floorChanged): every ground slot freed (silently) and every guard dropped;
 *      running boosts keep counting
 *   2. DEBUG_DROP_BUTTON press edges, living players in index order: the next kind (debugNextKind, then + 1 mod
 *      BOOST_COUNT) lands DEBUG_DROP_AHEAD in front of the player in the lowest free slot (none free: nothing). No draw
 *   3. boost timers, players in index order, kinds in Boost order: ticks - 1; reaching 0 ends it (events.ended; Aegis:
 *      its pips go too)
 *   4. ground slots in slot order: a drop that landed before this tick ages (ticksLeft - 1); at 0 it fades
 *      (events.expired, slot freed). So a drop can be taken on exactly groundTicks ticks, its landing tick included
 *   5. pickups, slots in order: the first living player (index order) whose centre is within pickupRadius takes it:
 *      ticks[kind] = the boost's full duration (a repeat pickup refreshes it), Aegis also aegisPips = AEGIS_PIPS;
 *      events.collected, slot freed. A drop can be taken on the tick it lands
 * Deaths (boostMods.ts boostsOnPlayerDied, from damagePlayer, forfeitSoloRun and markPlayerLeft): that player's timers
 * and pips are cleared at once. Pickups score nothing and never feed the combo (P6).
 *
 * Co-op: per player state in party index order (solo: one); only the picker is boosted.
 */
import { rngInt, seedToState } from "../rng";
import type { InputFrame } from "../input";
import type { SimState } from "../state";
import type { SimCtx } from "../combat/ctx";
import type { ActorState } from "../combat/actors/types";
import { archetypeAt, archetypeIndex } from "../combat/actors/registry";
import type { EncounterConfig } from "../combat/actors/encounter";
import { partySize, playerAt } from "../party";
import {
	AEGIS_PIPS,
	BOOSTS,
	BOOST_COUNT,
	BOOST_TOTAL_WEIGHT,
	Boost,
	DEBUG_DROP_AHEAD,
	DEBUG_DROP_BUTTON,
	DROPS,
	DROP_EXCLUDED_ROOM_TYPE,
	DROP_GROUND_TICKS,
	DROP_INELIGIBLE_ARCHETYPES,
	DROP_ROLL_RANGE,
	NO_BOOST,
	boostTicks,
} from "./dropsData";

// ---------------------------------------------------------------------------------------------
// Config

/** Tutorial (docs/BOOSTS.md B9): the last kill among room `room`'s deferred spawns on floor `floor` drops `kind`. */
export interface DropGuarantee {
	readonly floor: number;
	readonly room: number;
	/** Boost index. */
	readonly kind: number;
}

/** SimConfig.drops: presence turns drops on; the tunables (DROPS_CONFIG is the game's). */
export interface DropsConfig {
	/** Percent per eligible kill for an archetype not in chanceByArchetype (0: no random drops). */
	readonly chancePercent: number;
	/** Percent per archetype id (overrides chancePercent). */
	readonly chanceByArchetype: ReadonlyMap<string, number>;
	/** Eligible dry kills before the next eligible kill always drops; 0 = no pity. */
	readonly pityKills: number;
	/** Ticks a drop lies on the floor. */
	readonly groundTicks: number;
	/** World units: a living player's centre within this of a drop takes it. */
	readonly pickupRadius: number;
	/** Ground slots. */
	readonly maxOnGround: number;
	/** Guaranteed drops (the tutorial). Absent: none. */
	readonly guaranteed?: ReadonlyArray<DropGuarantee>;
}

/** The game's drops config (endless solo and co-op; docs/BOOSTS.md "Worlds"). */
export const DROPS_CONFIG: DropsConfig = table.freeze({
	chancePercent: DROPS.chancePercent,
	chanceByArchetype: DROPS.chanceByArchetype,
	pityKills: DROPS.pityKills,
	groundTicks: DROP_GROUND_TICKS,
	pickupRadius: DROPS.pickupRadius,
	maxOnGround: DROPS.maxOnGround,
});

const NO_CHANCES: ReadonlyMap<string, number> = new Map<string, number>();

/**
 * A config with no random drops and no pity, only `guaranteed` (the tutorial's: docs/BOOSTS.md "Worlds", B9). The
 * ground life, pickup radius and slot count are DROPS_CONFIG's.
 */
export function guaranteedDropsConfig(guaranteed: ReadonlyArray<DropGuarantee>): DropsConfig {
	return table.freeze({
		...DROPS_CONFIG,
		chancePercent: 0,
		chanceByArchetype: NO_CHANCES,
		pityKills: 0,
		guaranteed,
	});
}

// ---------------------------------------------------------------------------------------------
// State

/** One ground slot. Plain numbers, every field hashed. */
export interface GroundDrop {
	/** Boost index; NO_BOOST = a free slot (the other fields are 0). */
	kind: number;
	/** World position. */
	x: number;
	z: number;
	/** state.tick it landed on. */
	spawnTick: number;
	/** Ground life left, ticks (counts down on every unfrozen tick after the landing one; 0 = it fades). */
	ticksLeft: number;
}

/** One player's boosts. Every field hashed. */
export interface BoostPlayerState {
	/** Ticks left per Boost index (0 = off). */
	ticks: number[];
	/** Aegis pips left (0..AEGIS_PIPS). */
	aegisPips: number;
}

/** A guaranteed room whose spawns are alive (DropsConfig.guaranteed). Hashed. */
export interface DropGuard {
	/** Boost index the last kill drops. */
	kind: number;
	/** Actor ids (ActorState.id, never reused in a run) of the members still alive, spawn order. */
	ids: number[];
}

export interface DropCollected {
	readonly player: number;
	readonly kind: number;
	readonly slot: number;
	readonly x: number;
	readonly z: number;
}

export interface DropExpired {
	readonly slot: number;
	readonly kind: number;
	readonly x: number;
	readonly z: number;
}

export interface BoostEnded {
	readonly player: number;
	readonly kind: number;
}

/**
 * Per tick, presentation only (cleared every tick, NOT hashed). A floor change frees the old floor's slots silently
 * (read events.floorChanged); a slot in `dropped` may already be free again by the end of the tick (collected at once,
 * or a floor change), so read ground[slot].
 */
export interface DropsEvents {
	/** Slots a drop landed in this tick, in order. */
	dropped: number[];
	/** Pickups this tick, in order (slot order). */
	collected: DropCollected[];
	/** Drops that faded this tick (slot order). */
	expired: DropExpired[];
	/** Boosts whose timer ran out this tick (player order, kind order); never a death or a broken Aegis. */
	ended: BoostEnded[];
	/** Players whose Aegis pip absorbed a hit this tick, in hit order. */
	aegisBroke: number[];
}

/** SimState.drops. */
export interface DropsState {
	/** The run's tunables (config, constant for the run: not hashed). */
	readonly config: Readonly<DropsConfig>;
	/** The drop stream's mulberry32 word (hashed). */
	rngState: number;
	/** Eligible kills since the last drop (pity). */
	killsSinceDrop: number;
	/** The kind the next DEBUG_DROP_BUTTON press drops. */
	debugNextKind: number;
	/** config.maxOnGround slots, slot order. */
	ground: GroundDrop[];
	/** Guaranteed rooms with living members, in the order they spawned. */
	guards: DropGuard[];
	/** One per player, party index order (solo: one). */
	players: BoostPlayerState[];
	/** NOT hashed. */
	events: DropsEvents;
}

function freeSlot(): GroundDrop {
	return { kind: NO_BOOST, x: 0, z: 0, spawnTick: 0, ticksLeft: 0 };
}

function clearSlot(g: GroundDrop): void {
	g.kind = NO_BOOST;
	g.x = 0;
	g.z = 0;
	g.spawnTick = 0;
	g.ticksLeft = 0;
}

function newBoostPlayer(): BoostPlayerState {
	const ticks: number[] = [];
	for (let k = 0; k < BOOST_COUNT; k++) ticks.push(0);
	return { ticks, aegisPips: 0 };
}

function emptyEvents(): DropsEvents {
	return { dropped: [], collected: [], expired: [], ended: [], aegisBroke: [] };
}

/** The drop stream's first word for a run seeded `seed` (seedToState(seed) XOR DROPS.salt). */
export function dropsSeedState(seed: number): number {
	return bit32.bxor(seedToState(seed), DROPS.salt);
}

/** Drops state at run start: `players` (the party size, 1 solo), every slot free, no boost. No rng. */
export function createDropsState(config: Readonly<DropsConfig>, seed: number, players: number): DropsState {
	if (!(config.maxOnGround >= 1) || config.maxOnGround % 1 !== 0)
		error(`drops: maxOnGround must be a positive integer, got ${config.maxOnGround}`, 0);
	const ground: GroundDrop[] = [];
	for (let i = 0; i < config.maxOnGround; i++) ground.push(freeSlot());
	const list: BoostPlayerState[] = [];
	for (let i = 0; i < players; i++) list.push(newBoostPlayer());
	return {
		config,
		rngState: dropsSeedState(seed),
		killsSinceDrop: 0,
		debugNextKind: Boost.FURY,
		ground,
		guards: [],
		players: list,
		events: emptyEvents(),
	};
}

export function cloneDropsState(d: Readonly<DropsState>): DropsState {
	return {
		config: d.config,
		rngState: d.rngState,
		killsSinceDrop: d.killsSinceDrop,
		debugNextKind: d.debugNextKind,
		ground: d.ground.map((g) => ({ ...g })),
		guards: d.guards.map((g) => ({ kind: g.kind, ids: [...g.ids] })),
		players: d.players.map((p) => ({ ticks: [...p.ticks], aegisPips: p.aegisPips })),
		events: {
			dropped: [...d.events.dropped],
			collected: d.events.collected.map((e) => ({ ...e })),
			expired: d.events.expired.map((e) => ({ ...e })),
			ended: d.events.ended.map((e) => ({ ...e })),
			aegisBroke: [...d.events.aegisBroke],
		},
	};
}

/** Start of every tick (step / stepParty, with the other event clears; frozen draft ticks too). */
export function clearDropsEvents(d: DropsState): void {
	const e = d.events;
	e.dropped.clear();
	e.collected.clear();
	e.expired.clear();
	e.ended.clear();
	e.aegisBroke.clear();
}

// ---------------------------------------------------------------------------------------------
// Landing

/** The lowest free ground slot, -1 when every slot is taken. */
function lowestFreeSlot(d: Readonly<DropsState>): number {
	for (let i = 0; i < d.ground.size(); i++) if (d.ground[i].kind === NO_BOOST) return i;
	return -1;
}

/** `kind` lands in ground slot `slot` at (x, z) on `tick`. */
function land(d: DropsState, slot: number, kind: number, x: number, z: number, tick: number): void {
	const g = d.ground[slot];
	g.kind = kind;
	g.x = x;
	g.z = z;
	g.spawnTick = tick;
	g.ticksLeft = d.config.groundTicks;
	d.events.dropped.push(slot);
}

/** The weighted kind pick: ONE rngInt(0, BOOST_TOTAL_WEIGHT - 1) from the drop stream. */
export function pickBoostKind(d: DropsState): number {
	let roll = rngInt(d, 0, BOOST_TOTAL_WEIGHT - 1);
	for (let k = 0; k < BOOST_COUNT; k++) {
		const w = BOOSTS[k].weight;
		if (roll < w) return k;
		roll -= w;
	}
	return BOOST_COUNT - 1; // unreachable: the roll is below the total weight
}

/** The drop percent of archetype `id` under `config`. */
export function dropChancePercent(config: Readonly<DropsConfig>, id: string): number {
	return config.chanceByArchetype.get(id) ?? config.chancePercent;
}

/** A guard member died: its id leaves the guard. Returns the guard's kind when it was the last one, else NO_BOOST. */
function guardKill(d: DropsState, actorId: number): number {
	for (let g = 0; g < d.guards.size(); g++) {
		const guard = d.guards[g];
		const at = guard.ids.indexOf(actorId);
		if (at < 0) continue;
		guard.ids.remove(at);
		if (guard.ids.size() > 0) return NO_BOOST;
		d.guards.remove(g);
		return guard.kind;
	}
	return NO_BOOST;
}

/**
 * True when the floor's encounter spawns a boss (archetype data.boss). Only then is the boss room excluded (P5: the
 * boss, its summons, the arena). Every endless floor has a "boss"-type room, but on a floor without a boss it is just
 * the stairwell room, and kills there roll like anywhere else. Pure: reads the fixed encounter config.
 */
function encounterHasBoss(encounter: Readonly<EncounterConfig>): boolean {
	const spawns = encounter.spawns;
	for (let i = 0; i < spawns.size(); i++) {
		if (archetypeAt(archetypeIndex(spawns[i].kind)).data.boss === true) return true;
	}
	return false;
}

/**
 * killActor (before onDeath): actor `a` just died. The rules and draw counts are at the top of this file. `reviving`:
 * the archetype comes back (def.stepDead). No-op without state.drops.
 */
export function dropsOnKill(ctx: SimCtx, a: Readonly<ActorState>, reviving: boolean): void {
	const state = ctx.state;
	const d = state.drops;
	if (d === undefined) return;

	// 1. A guaranteed room's last member.
	if (d.guards.size() > 0) {
		const kind = guardKill(d, a.id);
		if (kind !== NO_BOOST) {
			const slot = lowestFreeSlot(d);
			if (slot >= 0) {
				land(d, slot, kind, a.x, a.z, state.tick);
				d.killsSinceDrop = 0;
			}
			return;
		}
	}

	// 2. Eligibility.
	if (reviving) return;
	const def = archetypeAt(a.kind);
	if (def.data.boss === true || DROP_INELIGIBLE_ARCHETYPES.includes(def.id)) return;
	const room = ctx.roomAt(a.x, a.z);
	if (room !== undefined && encounterHasBoss(ctx.encounter)) {
		if (room.type === DROP_EXCLUDED_ROOM_TYPE || room.id === ctx.encounter.bossRoom) return;
	}

	// 3. A full ground: skipped, a dry kill.
	const slot = lowestFreeSlot(d);
	if (slot < 0) {
		d.killsSinceDrop += 1;
		return;
	}

	// 4. Pity, else the roll.
	const config = d.config;
	const pity = config.pityKills > 0 && d.killsSinceDrop >= config.pityKills;
	if (!pity) {
		const percent = dropChancePercent(config, def.id);
		if (!(percent > 0) || rngInt(d, 0, DROP_ROLL_RANGE - 1) >= percent) {
			d.killsSinceDrop += 1;
			return;
		}
	}

	// 5. The kind, and it lands.
	land(d, slot, pickBoostKind(d), a.x, a.z, state.tick);
	d.killsSinceDrop = 0;
}

/**
 * stepEndless (a room's deferred enemies just spawned, `spawned` in spawn order): when DropsConfig.guaranteed names
 * this floor and room, their actor ids become a guard. No-op without state.drops or a matching guarantee.
 */
export function dropsOnRoomSpawned(state: SimState, roomId: number, spawned: ReadonlyArray<ActorState>): void {
	const d = state.drops;
	const list = d?.config.guaranteed;
	const e = state.endless;
	if (d === undefined || list === undefined || e === undefined || spawned.size() === 0) return;
	for (const g of list) {
		if (g.floor !== e.floor || g.room !== roomId) continue;
		const ids: number[] = [];
		for (const a of spawned) ids.push(a.id);
		d.guards.push({ kind: g.kind, ids });
		return;
	}
}

// ---------------------------------------------------------------------------------------------
// The drops phase of a tick

function within(x: number, z: number, cx: number, cz: number, radius: number): boolean {
	const dx = x - cx;
	const dz = z - cz;
	return dx * dx + dz * dz <= radius * radius;
}

function pressed(prevButtons: number, buttons: number, bit: number): boolean {
	return bit32.band(buttons, bit) !== 0 && bit32.band(prevButtons, bit) === 0;
}

/**
 * The drops phase of an unfrozen tick (order at the top of this file). `inputs[i]` is player i's frame this tick and
 * `prevButtons[i]` that player's prevButtons from BEFORE this tick's stepPlayer (the debug press edge); a solo run
 * passes one of each.
 */
export function stepDrops(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	prevButtons: ReadonlyArray<number>,
): void {
	const d = state.drops;
	if (d === undefined) return;
	const ev = d.events;
	const n = partySize(state);
	const ground = d.ground;

	// 1. A new floor: the old floor's drops and guards are gone.
	if (state.events.floorChanged !== 0) {
		for (const g of ground) clearSlot(g);
		d.guards.clear();
	}

	// 2. Debug drops, living players in index order.
	for (let i = 0; i < n; i++) {
		const input = inputs[i];
		if (input === undefined || !pressed(prevButtons[i], input.buttons, DEBUG_DROP_BUTTON)) continue;
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const slot = lowestFreeSlot(d);
		if (slot < 0) continue;
		land(d, slot, d.debugNextKind, p.x + p.faceX * DEBUG_DROP_AHEAD, p.z + p.faceZ * DEBUG_DROP_AHEAD, state.tick);
		d.debugNextKind = (d.debugNextKind + 1) % BOOST_COUNT;
	}

	// 3. Boost timers, player order, kind order.
	for (let i = 0; i < d.players.size(); i++) {
		const bp = d.players[i];
		const ticks = bp.ticks;
		for (let k = 0; k < ticks.size(); k++) {
			if (ticks[k] <= 0) continue;
			ticks[k] -= 1;
			if (ticks[k] > 0) continue;
			if (k === Boost.AEGIS) bp.aegisPips = 0;
			ev.ended.push({ player: i, kind: k });
		}
	}

	// 4. Ground life, slot order.
	for (let s = 0; s < ground.size(); s++) {
		const g = ground[s];
		if (g.kind === NO_BOOST || g.spawnTick === state.tick) continue;
		g.ticksLeft -= 1;
		if (g.ticksLeft > 0) continue;
		ev.expired.push({ slot: s, kind: g.kind, x: g.x, z: g.z });
		clearSlot(g);
	}

	// 5. Pickups: per slot, the first living player (index order) in reach.
	const r = d.config.pickupRadius;
	for (let s = 0; s < ground.size(); s++) {
		const g = ground[s];
		if (g.kind === NO_BOOST) continue;
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			const bp = d.players[i];
			if (p.dead !== 0 || bp === undefined || !within(p.x, p.z, g.x, g.z, r)) continue;
			const kind = g.kind;
			bp.ticks[kind] = boostTicks(kind);
			if (kind === Boost.AEGIS) bp.aegisPips = AEGIS_PIPS;
			ev.collected.push({ player: i, kind, slot: s, x: g.x, z: g.z });
			clearSlot(g);
			break;
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Read-only helpers for the client (render, HUD, audio)

/** One running boost of a player. */
export interface ActiveBoost {
	/** Boost index. */
	readonly kind: number;
	readonly ticksLeft: number;
	/** The boost's full duration (boostTicks(kind)). */
	readonly totalTicks: number;
}

const NO_GROUND: ReadonlyArray<Readonly<GroundDrop>> = table.freeze([]);

/** The ground slots (slot order; free slots have kind NO_BOOST); empty without drops. */
export function dropsGround(state: Readonly<SimState>): ReadonlyArray<Readonly<GroundDrop>> {
	return state.drops?.ground ?? NO_GROUND;
}

/** A drop's full ground life in ticks (the blink starts from it); DROP_GROUND_TICKS without drops. */
export function dropGroundTicks(state: Readonly<SimState>): number {
	return state.drops?.config.groundTicks ?? DROP_GROUND_TICKS;
}

/** This tick's drop events, or undefined without drops. */
export function dropsEvents(state: Readonly<SimState>): Readonly<DropsEvents> | undefined {
	return state.drops?.events;
}

/** Player `playerIndex`'s running boosts in Boost order (into `out` when given, which is cleared first). */
export function activeBoosts(state: Readonly<SimState>, playerIndex: number, out: ActiveBoost[] = []): ActiveBoost[] {
	out.clear();
	const bp = state.drops?.players[playerIndex];
	if (bp === undefined) return out;
	for (let k = 0; k < bp.ticks.size(); k++) {
		const left = bp.ticks[k];
		if (left > 0) out.push({ kind: k, ticksLeft: left, totalTicks: boostTicks(k) });
	}
	return out;
}

/** Ticks left of player `playerIndex`'s boost `kind` (0: not running, or no drops). */
export function boostTicksLeft(state: Readonly<SimState>, playerIndex: number, kind: number): number {
	return state.drops?.players[playerIndex]?.ticks[kind] ?? 0;
}

/** Player `playerIndex`'s Aegis pips (0 without drops). */
export function aegisPips(state: Readonly<SimState>, playerIndex: number): number {
	return state.drops?.players[playerIndex]?.aegisPips ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "drops" group, appended after every other group only when state.drops exists.
//   rngState, killsSinceDrop, debugNextKind; ground.length, per slot DROP_GROUND_HASH_FIELDS; guards.length, per guard
//   kind, ids.length, ids; players.length, per player ticks.length, ticks, aegisPips

/** Per ground slot, in this order (dump names `drops.ground[<slot>].<name>`). Append only. */
export const DROP_GROUND_HASH_FIELDS = ["kind", "x", "z", "spawnTick", "ticksLeft"] as const;

export function writeDropsHash(d: Readonly<DropsState>, out: number[]): void {
	out.push(d.rngState, d.killsSinceDrop, d.debugNextKind);
	out.push(d.ground.size());
	for (const g of d.ground) for (const f of DROP_GROUND_HASH_FIELDS) out.push(g[f]);
	out.push(d.guards.size());
	for (const g of d.guards) {
		out.push(g.kind, g.ids.size());
		for (const id of g.ids) out.push(id);
	}
	out.push(d.players.size());
	for (const p of d.players) {
		out.push(p.ticks.size());
		for (const t of p.ticks) out.push(t);
		out.push(p.aegisPips);
	}
}

/** Dump names for writeDropsHash, same order. */
export function dropsHashNames(d: Readonly<DropsState>, out: string[]): void {
	out.push("drops.rngState", "drops.killsSinceDrop", "drops.debugNextKind", "drops.ground.length");
	for (let s = 0; s < d.ground.size(); s++)
		for (const f of DROP_GROUND_HASH_FIELDS) out.push(`drops.ground[${s}].${f}`);
	out.push("drops.guards.length");
	for (let g = 0; g < d.guards.size(); g++) {
		const prefix = `drops.guards[${g}]`;
		out.push(`${prefix}.kind`, `${prefix}.ids.length`);
		for (let k = 0; k < d.guards[g].ids.size(); k++) out.push(`${prefix}.ids[${k}]`);
	}
	out.push("drops.players.length");
	for (let i = 0; i < d.players.size(); i++) {
		const prefix = `drops.players[${i}]`;
		out.push(`${prefix}.ticks.length`);
		for (let k = 0; k < d.players[i].ticks.size(); k++) out.push(`${prefix}.ticks[${k}]`);
		out.push(`${prefix}.aegisPips`);
	}
}
