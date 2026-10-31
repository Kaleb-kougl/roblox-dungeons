/**
 * Endless mode in the sim (GDD "Endless mode"; a Roblox-port feature, no web source): an unbroken descent through
 * floors until the player dies. Opt-in: only a SimConfig with `endless` creates `SimState.endless`, and only then does
 * step() run this module and the hash grow the appended `endless` group. Without it nothing here runs, so every golden
 * fixture replays exactly as before.
 *
 * The world changes per floor, so it is not fixed in the SimConfig: `SimConfig.endless.worldForFloor(floor)` is a
 * PURE, cached callback (shared/run endless.ts builds it from the run seed alone) and every tick runs with the current
 * floor's SimConfig (`simWorldConfig`). Live play and the server's replay therefore build identical worlds; generating
 * a floor mid-tick is fine (deterministic).
 *
 * stepEndless runs after stepCombat and before stepScore (step.ts), in this fixed order:
 *   1. a boss died this tick (events.bossDefeated): Depth + 1 (events.depthChanged); a closed stairwell opens
 *      (events.stairwellOpened)
 *   2. the player is dead: nothing else (death ends the run; no respawn in endless)
 *   3. the floor ends when DEBUG_FLOOR_BUTTON is pressed (edge) or the stairwell is open and the player's center is
 *      within STAIRWELL_RADIUS of it: scoring's floor clear (awardFloorClear(floor just ended): 1000 x floor x the
 *      share of its enemy rooms cleared, the boss counting as one room on a boss floor; at the current Depth, the
 *      debug skip included: debug runs never post), enemy and player bullets cleared, every actor freed (no
 *      onDeath), the next floor's world, the player at its entrance (hearts kept; armor, flask and Embers refilled: refillAtCheckpoint),
 *      the new floor's breakables (state.breakables, when the run has them), the floor's initial spawns (the boss on
 *      boss floors), scoring's room records rebuilt for the new floor
 *      (rebuildScoreRooms, deferred), events.floorChanged = the new floor. Stop.
 *   4. the player stands on a room's floor for the first time this floor: events.roomEntered = id + 1, and that room's
 *      deferred enemies spawn (EndlessFloorWorld.roomSpawns, in order, each at least SPAWN_SAFE_RADIUS from every
 *      living player: see safeRoomSpawns; a full pool drops the rest, counted in
 *      combat.actorsDropped); with elite affixes (state.affixes) each planned spawn carries its
 *      EndlessFloorWorld.roomAffixes entry (same index), stamped by spawnActor before the archetype's init; scoring
 *      attaches them to the room's record and engages it (attachScoreRoomMembers)
 *
 * Co-op (M4, party.ts), every per-player rule in player index order:
 *   2. EVERY player is dead: nothing else (the run is over); a dead player otherwise just waits (no mid-floor revive)
 *   3. the floor ends when every LIVING player's center is in the stairwell zone (one player can wait there for the
 *      rest instead of dragging the party down mid-fight), or on any player's DEBUG_FLOOR_BUTTON edge (players who
 *      left never send one). Every player moves to the entrance; the dead (unless they left) come back with
 *      PARTY_REVIVE_HALF_HEARTS; everyone's armor / flask / Embers refill.
 *   4. each living player in index order can enter a room first (several rooms may spawn on one tick)
 *
 * Scaling (endlessData.ts) is applied where things are made: actor hp in spawnActor, enemy bullet speed in
 * SimCtx.fireEnemy. Both read state.endless, so they follow the floor and Depth at that moment.
 */
import type { BreakablePlacement } from "shared/dungeon";
import type { InputFrame } from "./input";
import type { SimState } from "./state";
import type { SimConfig } from "./step";
import { refillAtCheckpoint } from "./player";
import { DEBUG_FLOOR_BUTTON, ENDLESS_FIRST_DEPTH, SPAWN_SAFE_RADIUS, STAIRWELL_RADIUS } from "./endlessData";
import { ENDLESS_FIRST_FLOOR } from "shared/dungeon";
import { isIntegerNumber } from "./jsnum";
import { SimCtx } from "./combat/ctx";
import { freeActor, spawnActor } from "./combat/actors/actors";
import { archetypeIndex } from "./combat/actors/registry";
import { NO_KIND, type ActorState } from "./combat/actors/types";
import type { ActorSpawn } from "./combat/actors/encounter";
import { attachScoreRoomMembers, awardFloorClear, rebuildScoreRooms } from "./score/score";
import { hasLeft, isPartyWiped, partySize, playerAt, revivePartyMember } from "./party";
import { PARTY_REVIVE_HALF_HEARTS } from "./partyData";
import { resetBreakables } from "./breakables/breakables";
import { dropsOnRoomSpawned } from "./drops/drops";
import { tutorialOnRoomSpawned } from "./tutorial/tutorial";

/** A candidate spawn position (structurally shared/dungeon's TileXZ). */
export interface SpawnTile {
	readonly x: number;
	readonly z: number;
}

/** One floor's world, as the sim sees it. Built outside the sim (shared/run), never mutated. */
export interface EndlessFloorWorld {
	readonly floor: number;
	/** The SimConfig the floor's ticks run with: collision, bullet blocker, actor mover, encounter, loadout. */
	readonly config: Readonly<SimConfig>;
	/** A boss floor: the stairwell opens when the boss dies (else it is open from the start). */
	readonly bossFloor: boolean;
	/** Where the player arrives (world). */
	readonly spawnX: number;
	readonly spawnZ: number;
	/** The stairwell's center (world). */
	readonly stairX: number;
	readonly stairZ: number;
	/** Deferred enemies per room id, spawned when the player first enters the room. */
	readonly roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>;
	/**
	 * Candidate spawn tiles per room id (world tile centers, row order): where a spawn that would land within
	 * SPAWN_SAFE_RADIUS of a living player is moved to. Absent (hand-built test worlds): spawns are never moved.
	 */
	readonly roomSpawnTiles?: ReadonlyArray<ReadonlyArray<SpawnTile>>;
	/** Room id under world (x, z), -1 for none. Pure. A callback property (called with `.`). */
	readonly roomIdAt: (x: number, z: number) => number;
	/**
	 * Breakable barrels and crates of the floor (tile coordinates; shared/dungeon placeBreakables, docs/DECOR.md D4).
	 * Read only when the run's SimConfig.breakables is set (breakables/breakables.ts). Absent: none.
	 */
	readonly breakables?: ReadonlyArray<BreakablePlacement>;
	/**
	 * Elite affixes per planned room spawn (shared/dungeon assignAffixes, docs/ENEMY_VARIANTS.md EV6): an affix id
	 * (shared/dungeon AffixKind, 0 = none) per roomSpawns entry, same shape. Read only when the run's SimConfig.affixes
	 * is set (affixes/affixes.ts). Absent: none (the tutorial, hand-built test worlds).
	 */
	readonly roomAffixes?: ReadonlyArray<ReadonlyArray<number>>;
}

/** SimConfig.endless. */
export interface EndlessConfig {
	/** The run's seed (every floor derives from it). */
	readonly runSeed: number;
	/** Floor `floor`'s world. MUST be pure and cheap on repeat calls (cached): step() calls it every tick. */
	readonly worldForFloor: (floor: number) => Readonly<EndlessFloorWorld>;
	/**
	 * Developer mode's floor jump (docs/DEV_MODE.md): the run starts on this floor (an integer >= ENDLESS_FIRST_FLOOR).
	 * Absent: ENDLESS_FIRST_FLOOR, exactly as before. Only the client's local `dev` world sets it.
	 */
	readonly startFloor?: number;
	/** With startFloor: the Depth the run starts at (an integer >= ENDLESS_FIRST_DEPTH). Absent: ENDLESS_FIRST_DEPTH. */
	readonly startDepth?: number;
}

/** The floor an endless run starts on: `startFloor`, or ENDLESS_FIRST_FLOOR. Throws on an invalid startFloor. */
export function endlessStartFloor(config: Readonly<EndlessConfig>): number {
	const floor = config.startFloor;
	if (floor === undefined) return ENDLESS_FIRST_FLOOR;
	if (!isIntegerNumber(floor) || floor < ENDLESS_FIRST_FLOOR) {
		error(`endless: startFloor must be an integer >= ${ENDLESS_FIRST_FLOOR}, got ${tostring(floor)}`, 0);
	}
	return floor;
}

/** SimState.endless: plain numbers, every field hashed (writeEndlessHash). */
export interface EndlessState {
	/** Current floor, from 1. */
	floor: number;
	/** Depth, from 1: +1 per boss kill. */
	depth: number;
	/** 1 while the stairwell can be used. */
	stairsOpen: number;
	/** state.tick of the floor's first tick (= the recording frame index where the floor starts). */
	floorStartTick: number;
	/** Per room id of the current floor: 1 once the player has entered it (its enemies spawned then). */
	roomsEntered: number[];
}

function zeros(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(0);
	return out;
}

function roomCountOf(world: Readonly<EndlessFloorWorld>): number {
	return world.roomSpawns.size();
}

/**
 * Endless state at run start, on `world` (shared/dungeon ENDLESS_FIRST_FLOOR, or EndlessConfig.startFloor's) at
 * `depth` (default ENDLESS_FIRST_DEPTH; throws unless an integer >= it).
 */
export function createEndlessState(
	world: Readonly<EndlessFloorWorld>,
	depth: number = ENDLESS_FIRST_DEPTH,
): EndlessState {
	if (!isIntegerNumber(depth) || depth < ENDLESS_FIRST_DEPTH) {
		error(`endless: startDepth must be an integer >= ${ENDLESS_FIRST_DEPTH}, got ${tostring(depth)}`, 0);
	}
	return {
		floor: world.floor,
		depth,
		stairsOpen: world.bossFloor ? 0 : 1,
		floorStartTick: 0,
		roomsEntered: zeros(roomCountOf(world)),
	};
}

export function cloneEndlessState(e: Readonly<EndlessState>): EndlessState {
	return { ...e, roomsEntered: [...e.roomsEntered] };
}

/** The current floor's world, or undefined outside endless mode. */
export function endlessFloorWorld(
	state: Readonly<SimState>,
	config: Readonly<SimConfig>,
): Readonly<EndlessFloorWorld> | undefined {
	const e = state.endless;
	const endless = config.endless;
	if (e === undefined || endless === undefined) return undefined;
	return endless.worldForFloor(e.floor);
}

/** The SimConfig this tick runs with: the current floor's in endless mode, else `config` itself. */
export function simWorldConfig(state: Readonly<SimState>, config: Readonly<SimConfig>): Readonly<SimConfig> {
	const world = endlessFloorWorld(state, config);
	return world !== undefined ? world.config : config;
}

const ctx = new SimCtx();

function pressed(prevButtons: number, buttons: number, bit: number): boolean {
	return bit32.band(buttons, bit) !== 0 && bit32.band(prevButtons, bit) === 0;
}

/**
 * Spawns `spawns` in order; returns the actors that got a slot (a full pool drops the rest). `affixes[i]` (elite
 * affixes: spawn i's planned affix, paired by index BEFORE any spawn can be dropped) is stamped by spawnActor before
 * the archetype's init; absent or 0: none.
 */
function spawnAll(spawns: ReadonlyArray<ActorSpawn>, affixes?: ReadonlyArray<number>): ActorState[] {
	const out: ActorState[] = [];
	for (let i = 0; i < spawns.size(); i++) {
		const s = spawns[i];
		const a = spawnActor(ctx, archetypeIndex(s.kind), s.x, s.z, affixes?.[i] ?? 0);
		if (a !== undefined) out.push(a);
	}
	return out;
}

function nextFloor(state: SimState, input: Readonly<InputFrame>, endless: EndlessConfig, e: EndlessState): void {
	// Scoring: the floor just ended pays its clear bonus by the share of its rooms cleared (stairwell or debug skip
	// alike), at the Depth in force now. A boss floor's boss is one more room, cleared once it died (the stairwell of a
	// boss floor only opens on the boss kill).
	const ended = endless.worldForFloor(e.floor);
	awardFloorClear(state, e.floor, ended.bossFloor, ended.bossFloor && e.stairsOpen !== 0);
	const c = state.combat;
	c.enemyBullets.clear();
	c.playerBullets.clear();
	const actors = c.actors;
	for (let i = 0; i < actors.size(); i++) if (actors[i].kind !== NO_KIND) freeActor(ctx, actors[i]);

	e.floor += 1;
	const world = endless.worldForFloor(e.floor);
	e.stairsOpen = world.bossFloor ? 0 : 1;
	e.floorStartTick = state.tick + 1;
	e.roomsEntered = zeros(roomCountOf(world));

	// Every player at the entrance (index order); co-op: the dead come back (not those who left).
	for (let i = 0; i < partySize(state); i++) {
		const p = playerAt(state, i);
		p.x = world.spawnX;
		p.z = world.spawnZ;
		p.prevX = world.spawnX;
		p.prevZ = world.spawnZ;
		if (p.dead !== 0 && !hasLeft(state, i)) revivePartyMember(p, PARTY_REVIVE_HALF_HEARTS);
		refillAtCheckpoint(state, p);
	}

	// Breakables (docs/DECOR.md D4): the new floor's pieces, all intact.
	if (state.breakables !== undefined) resetBreakables(state.breakables, world.breakables ?? []);

	ctx.bind(state, world.config, input);
	spawnAll(world.config.encounter?.spawns ?? []);
	// Scoring: the new floor's room records (deferred: members join when each room's enemies spawn).
	rebuildScoreRooms(state, world.config.encounter, world.roomSpawns, world.roomAffixes);
	state.events.floorChanged = e.floor;
}

/** Every living player stands in the open stairwell zone (solo: the player does). */
function partyInStairwell(state: Readonly<SimState>, world: Readonly<EndlessFloorWorld>): boolean {
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const dx = p.x - world.stairX;
		const dz = p.z - world.stairZ;
		if (dx * dx + dz * dz > STAIRWELL_RADIUS * STAIRWELL_RADIUS) return false;
	}
	return true;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

/**
 * Where a room's deferred enemies actually spawn: `spawns` (the layout's positions, in order) with every spawn closer
 * than SPAWN_SAFE_RADIUS to a living player moved (SPAWN_SAFE_RADIUS in endlessData.ts). Spawns that are far enough
 * keep their tile. Each moved spawn, in order, takes the free `tiles` entry nearest its planned position among those
 * at least SPAWN_SAFE_RADIUS from every living player; when none is left (a cramped room), the free tile farthest from
 * the nearest living player. "Free" = no other spawn of this room on it, so two spawns never share a tile, and the
 * moved spawns as a group never end up closer to the players than planned. `tiles` must contain every planned
 * position (the layout's roomSpawnTiles does). Ties go to the earlier tile (row order). Pure and deterministic: reads
 * only hashed player state.
 */
export function safeRoomSpawns(
	state: Readonly<SimState>,
	spawns: ReadonlyArray<ActorSpawn>,
	tiles: ReadonlyArray<SpawnTile>,
): ActorSpawn[] {
	const out: ActorSpawn[] = [];
	for (const sp of spawns) out.push(sp);
	const px: number[] = [];
	const pz: number[] = [];
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead === 0 && !hasLeft(state, i)) {
			px.push(p.x);
			pz.push(p.z);
		}
	}
	if (px.size() === 0) return out;
	const nearest2 = (x: number, z: number) => {
		let m = math.huge;
		for (let k = 0; k < px.size(); k++) m = math.min(m, dist2(x, z, px[k], pz[k]));
		return m;
	};
	const safe2 = SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS;
	const takenX: number[] = [];
	const takenZ: number[] = [];
	const isTaken = (x: number, z: number) => {
		for (let k = 0; k < takenX.size(); k++) if (takenX[k] === x && takenZ[k] === z) return true;
		return false;
	};
	const moved: number[] = [];
	for (let i = 0; i < out.size(); i++) {
		const sp = out[i];
		if (nearest2(sp.x, sp.z) >= safe2) {
			takenX.push(sp.x);
			takenZ.push(sp.z);
		} else moved.push(i);
	}
	for (const i of moved) {
		const sp = out[i];
		let best = -1;
		let bestD = math.huge;
		let far = -1;
		let farD = -1;
		for (let j = 0; j < tiles.size(); j++) {
			const t = tiles[j];
			if (isTaken(t.x, t.z)) continue;
			const m = nearest2(t.x, t.z);
			if (m >= safe2) {
				const d = dist2(t.x, t.z, sp.x, sp.z);
				if (d < bestD) {
					best = j;
					bestD = d;
				}
			} else if (m > farD) {
				far = j;
				farD = m;
			}
		}
		const pick = best >= 0 ? best : far;
		if (pick >= 0) {
			const t = tiles[pick];
			out[i] = { kind: sp.kind, x: t.x, z: t.z };
		}
		takenX.push(out[i].x);
		takenZ.push(out[i].z);
	}
	return out;
}

/** Some player pressed DEBUG_FLOOR_BUTTON this tick (edge against their prevButtons from before the tick). */
function floorSkipPressed(inputs: ReadonlyArray<Readonly<InputFrame>>, prevButtons: ReadonlyArray<number>): boolean {
	for (let i = 0; i < inputs.size(); i++)
		if (pressed(prevButtons[i], inputs[i].buttons, DEBUG_FLOOR_BUTTON)) return true;
	return false;
}

/** The first room `p` stands in that nobody entered yet this floor: spawns its deferred enemies. */
function enterRoom(state: SimState, world: Readonly<EndlessFloorWorld>, e: EndlessState, x: number, z: number): void {
	const id = world.roomIdAt(x, z);
	if (id >= 0 && id < e.roomsEntered.size() && e.roomsEntered[id] === 0) {
		e.roomsEntered[id] = 1;
		state.events.roomEntered = id + 1;
		const tiles = world.roomSpawnTiles?.[id];
		const planned = world.roomSpawns[id];
		// safeRoomSpawns keeps the planned order and count (it only moves spawns), so index i is still planned spawn i.
		const affixes = state.affixes !== undefined ? world.roomAffixes?.[id] : undefined;
		const spawned = spawnAll(tiles !== undefined ? safeRoomSpawns(state, planned, tiles) : planned, affixes);
		attachScoreRoomMembers(state, id, spawned); // scoring: the room engages now
		dropsOnRoomSpawned(state, id, spawned); // boost drops: a guaranteed room's members (the tutorial)
		tutorialOnRoomSpawned(state, e.floor, id, spawned); // the tutorial's block lesson: hold its room's enemies
	}
}

/**
 * The endless phase of a tick (order at the top of this file). `inputs[i]` is player i's frame this tick and
 * `prevButtons[i]` that player's prevButtons from BEFORE this tick's stepPlayer (the press edge of DEBUG_FLOOR_BUTTON);
 * a solo run passes one of each.
 */
export function stepEndless(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	config: Readonly<SimConfig>,
	prevButtons: ReadonlyArray<number>,
): void {
	const input = inputs[0];
	const e = state.endless;
	const endless = config.endless;
	if (e === undefined || endless === undefined) return;
	const ev = state.events;
	const world = endless.worldForFloor(e.floor);
	ctx.bind(state, world.config, input);

	// 1. Boss kill.
	if (ev.bossDefeated !== 0) {
		e.depth += 1;
		ev.depthChanged = e.depth;
		if (e.stairsOpen === 0) {
			e.stairsOpen = 1;
			ev.stairwellOpened = 1;
		}
	}

	// 2. Death of the whole party ends the run.
	if (isPartyWiped(state)) return;

	// 3. The stairwell (or the debug skip).
	if ((e.stairsOpen !== 0 && partyInStairwell(state, world)) || floorSkipPressed(inputs, prevButtons)) {
		nextFloor(state, input, endless, e);
		return;
	}

	// 4. First entry into a room, living players in index order.
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead === 0) enterRoom(state, world, e, p.x, p.z);
	}
}

// ---------------------------------------------------------------------------------------------
// Hash: the `endless` group, appended after playerBullets only when state.endless exists.

/** writeEndlessHash order (dump names `endless.<name>`, then `endless.roomsEntered[i]`). */
export const ENDLESS_HASH_FIELDS = ["floor", "depth", "stairsOpen", "floorStartTick"] as const;

export function writeEndlessHash(e: Readonly<EndlessState>, out: number[]): void {
	for (const f of ENDLESS_HASH_FIELDS) out.push(e[f]);
	out.push(e.roomsEntered.size());
	for (const v of e.roomsEntered) out.push(v);
}

export function endlessHashNames(e: Readonly<EndlessState>, out: string[]): void {
	for (const f of ENDLESS_HASH_FIELDS) out.push(`endless.${f}`);
	out.push("endless.roomsEntered.length");
	for (let i = 0; i < e.roomsEntered.size(); i++) out.push(`endless.roomsEntered[${i}]`);
}
