/**
 * Pacts in the sim (docs/FORTUNE.md "Pacts", PS2; a Roblox-port feature, no web source): the risk shrines. OPT-IN: only a
 * SimConfig with `pacts` (endless worlds, shared/run buildEndlessRunConfig; never the tutorial, which keeps the classic
 * shrine) creates `SimState.pacts`, and only then does anything here run or the hash grow the appended `pacts` group
 * (after `treasure`). Without it nothing changes (M1, every golden fixture, the tutorial, every replay without it).
 *
 * Where the altars stand is decided when the floor is built (shared/dungeon placePactAltars): pactsOnFloor copies it in
 * at floor start (createSimState after the score and pellet state, stepEndless's floor change after them). On a floor
 * whose altars were placed (`room` >= 0) the classic shrine zone (progression.ts stepRun step 5) is off; on a floor
 * without them (no shrine room, or placement failed) the classic shrine runs as before.
 *
 * State (every field hashed but `config` and `events`):
 *   room, seed, altarX / altarZ   the floor's altars (shrine room id, -1 none; the floor seed for pactCurseIndex; each
 *                 altar's world centre by PactKind). Floor data, reset by pactsOnFloor.
 *   players[i]    greedTaken (1 once player i took Greed at this floor's shrine), hordeTaken (1 once player i took
 *                 Horde here), draftKind (PactKind.GREED while the draft Greed opened is the player's last draft this
 *                 floor, else NO_PACT: the HUD's draft title). Reset by pactsOnFloor.
 *   horde         armed (1 from the take until a room is roused), room / record (the horde room's encounter id and its
 *                 score record index, HORDE_NONE until roused), firstWave (the record's members when the room spawned:
 *                 entries 0 .. firstWave - 1 are the first wave), waveDueTick (the tick wave 2 spawns at, HORDE_NONE
 *                 until the trigger), waveKinds / waveX / waveZ (wave 2: archetype indices and tiles, chosen at the
 *                 trigger), spawned (HORDE_WAVE_PENDING until wave 2 spawned, then how many got a slot). Reset by
 *                 pactsOnFloor (an armed horde that roused no room lapses silently).
 *   taken         per PactKind, pacts taken this run (run counters).
 *
 * This module holds the state, its floor fill, clone and hash. The rules: ./stepPacts.ts (the altars: Greed's curse and
 * Legendary deal, Horde's take; the second wave) and the leaf ./pactRooms.ts (the room hooks endless.ts and score.ts
 * call: the horde room roused, its record held, its x2).
 *
 * @module
 */
import type { FloorPacts } from "shared/dungeon";
import type { SimState } from "../state";
import {
	HORDE_MAX_WAVE,
	HORDE_NONE,
	HORDE_PERCENT,
	HORDE_WAVE_PENDING,
	HORDE_WAVE_TELEGRAPH_TICKS,
	NO_PACT,
	PACT_KIND_COUNT,
	PACT_LEGENDARY_CARDS,
	PACT_PERCENT,
} from "./pactsData";

/** SimConfig.pacts: presence turns pacts on. */
export interface PactsConfig {
	/** Greed's Legendary deal: cards dealt (filled with upgrades when the legendary pool is thinner). */
	readonly legendaryCards: number;
	/** Horde's second wave: at most this many enemies. */
	readonly hordeMaxWave: number;
	/** Horde's second wave: telegraph ticks between the trigger and the spawn. */
	readonly waveTelegraphTicks: number;
	/** Horde's pay, integer percent (a multiple of 100). */
	readonly hordePercent: number;
	/**
	 * Sandboxes without endless mode (specs): the run's one floor of altars. Endless runs ignore it: each floor's altars
	 * come from its world (EndlessFloorWorld.pactAltars).
	 */
	readonly floor?: FloorPacts;
}

/** The game's pact rules (docs/FORTUNE.md; endless worlds, PS5). */
export const ENDLESS_PACTS_CONFIG: PactsConfig = table.freeze({
	legendaryCards: PACT_LEGENDARY_CARDS,
	hordeMaxWave: HORDE_MAX_WAVE,
	waveTelegraphTicks: HORDE_WAVE_TELEGRAPH_TICKS,
	hordePercent: HORDE_PERCENT,
});

/** One player's pact state at this floor's shrine. Every field hashed. */
export interface PactsPlayerState {
	greedTaken: number;
	hordeTaken: number;
	/** PactKind.GREED while the player's last draft this floor was Greed's deal, else NO_PACT. */
	draftKind: number;
}

/** The Pact of the Horde on this floor. Every field hashed. */
export interface HordeState {
	armed: number;
	room: number;
	record: number;
	firstWave: number;
	waveDueTick: number;
	waveKinds: number[];
	waveX: number[];
	waveZ: number[];
	spawned: number;
}

/** Per-tick pact events for presentation. Cleared at the start of every tick; NOT hashed. Parallel lists per group. */
export interface PactsEvents {
	/** Greed taken this tick: the player, the curse (Curse index) and the cards dealt. */
	greedPlayer: number[];
	greedCurse: number[];
	greedCards: number[];
	/** Horde taken this tick: the player. */
	hordePlayer: number[];
	/** The horde room roused this tick (encounter room id + 1), else 0. */
	hordeRoused: number;
	/** Wave 2's trigger this tick: its size (the telegraph starts), else 0. */
	waveTelegraphed: number;
	/** Wave 2 spawned this tick: 1 + how many got a slot (1 = none fitted), else 0. */
	waveSpawned: number;
	/** The horde room's record cleared this tick (its x2 paid): 1, else 0. */
	hordeCleared: number;
}

/** SimState.pacts. */
export interface PactsState {
	readonly config: PactsConfig;
	room: number;
	seed: number;
	altarX: number[];
	altarZ: number[];
	players: PactsPlayerState[];
	horde: HordeState;
	taken: number[];
	/** Not hashed. */
	events: PactsEvents;
}

/** Throws on a config whose numbers break the rules (the x2 must stay an exact integer factor). */
function validated(config: PactsConfig): PactsConfig {
	const ok = (n: number, min: number) => n >= min && n % 1 === 0 && n !== math.huge;
	if (!ok(config.legendaryCards, 1)) error(`pacts: legendaryCards must be an integer >= 1`, 0);
	if (!ok(config.hordeMaxWave, 1)) error(`pacts: hordeMaxWave must be an integer >= 1`, 0);
	if (!ok(config.waveTelegraphTicks, 0)) error(`pacts: waveTelegraphTicks must be an integer >= 0`, 0);
	if (!ok(config.hordePercent, PACT_PERCENT) || config.hordePercent % PACT_PERCENT !== 0)
		error(`pacts: hordePercent must be a multiple of ${PACT_PERCENT}, got ${config.hordePercent}`, 0);
	return config;
}

function newPlayer(): PactsPlayerState {
	return { greedTaken: 0, hordeTaken: 0, draftKind: NO_PACT };
}

function newHorde(): HordeState {
	return {
		armed: 0,
		room: HORDE_NONE,
		record: HORDE_NONE,
		firstWave: 0,
		waveDueTick: HORDE_NONE,
		waveKinds: [],
		waveX: [],
		waveZ: [],
		spawned: HORDE_WAVE_PENDING,
	};
}

function emptyEvents(): PactsEvents {
	return {
		greedPlayer: [],
		greedCurse: [],
		greedCards: [],
		hordePlayer: [],
		hordeRoused: 0,
		waveTelegraphed: 0,
		waveSpawned: 0,
		hordeCleared: 0,
	};
}

/** Pacts state at run start for `players` (the party size, 1 solo); no altars yet (pactsOnFloor). No rng. */
export function createPactsState(config: PactsConfig, players = 1): PactsState {
	const out: PactsPlayerState[] = [];
	for (let i = 0; i < players; i++) out.push(newPlayer());
	const taken: number[] = [];
	for (let k = 0; k < PACT_KIND_COUNT; k++) taken.push(0);
	return {
		config: validated(config),
		room: HORDE_NONE,
		seed: 0,
		altarX: [],
		altarZ: [],
		players: out,
		horde: newHorde(),
		taken,
		events: emptyEvents(),
	};
}

/**
 * A new floor (createSimState, stepEndless's floor change): the floor's altars (`floor` absent: none, the classic shrine
 * runs), every player's takes and draft kind cleared, the Horde reset (an armed or running horde lapses: its room and
 * record are gone with the floor). No-op without state.pacts. No rng.
 */
export function pactsOnFloor(state: SimState, floor: FloorPacts | undefined): void {
	const p = state.pacts;
	if (p === undefined) return;
	p.altarX.clear();
	p.altarZ.clear();
	p.room = HORDE_NONE;
	p.seed = 0;
	if (floor !== undefined && floor.altars.size() === PACT_KIND_COUNT) {
		p.room = floor.room;
		p.seed = floor.seed;
		for (const a of floor.altars) {
			p.altarX.push(a.x);
			p.altarZ.push(a.z);
		}
	}
	for (const pl of p.players) {
		pl.greedTaken = 0;
		pl.hordeTaken = 0;
		pl.draftKind = NO_PACT;
	}
	p.horde = newHorde();
}

/** True when the current floor's altars stand (the classic shrine zone is off). */
export function pactAltarsPlaced(state: Readonly<SimState>): boolean {
	const p = state.pacts;
	return p !== undefined && p.room >= 0;
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearPactsEvents(p: PactsState): void {
	const e = p.events;
	e.greedPlayer.clear();
	e.greedCurse.clear();
	e.greedCards.clear();
	e.hordePlayer.clear();
	e.hordeRoused = 0;
	e.waveTelegraphed = 0;
	e.waveSpawned = 0;
	e.hordeCleared = 0;
}

export function clonePactsState(p: Readonly<PactsState>): PactsState {
	const h = p.horde;
	const e = p.events;
	return {
		config: p.config,
		room: p.room,
		seed: p.seed,
		altarX: [...p.altarX],
		altarZ: [...p.altarZ],
		players: p.players.map((q) => ({ ...q })),
		horde: { ...h, waveKinds: [...h.waveKinds], waveX: [...h.waveX], waveZ: [...h.waveZ] },
		taken: [...p.taken],
		events: {
			...e,
			greedPlayer: [...e.greedPlayer],
			greedCurse: [...e.greedCurse],
			greedCards: [...e.greedCards],
			hordePlayer: [...e.hordePlayer],
		},
	};
}

/** This tick's presentation events, or undefined without pacts. */
export function pactsEvents(state: Readonly<SimState>): Readonly<PactsEvents> | undefined {
	return state.pacts?.events;
}

// ---------------------------------------------------------------------------------------------
// Hash: the `pacts` group, appended after `treasure` (and `pellets`) only when state.pacts exists.
//   room, seed, altars.length, (x, z) per altar; players.length, PACT_PLAYER_FIELDS per player; HORDE_SCALARS,
//   wave.length, (kind, x, z) per wave entry; taken.length, taken per PactKind

/** Hashed per player, in order. Append only. */
export const PACT_PLAYER_FIELDS = ["greedTaken", "hordeTaken", "draftKind"] as const;
/** Hashed HordeState scalars, in order. Append only. */
export const HORDE_SCALARS = ["armed", "room", "record", "firstWave", "waveDueTick", "spawned"] as const;

export function writePactsHash(p: Readonly<PactsState>, out: number[]): void {
	out.push(p.room, p.seed, p.altarX.size());
	for (let k = 0; k < p.altarX.size(); k++) out.push(p.altarX[k], p.altarZ[k]);
	out.push(p.players.size());
	for (const q of p.players) for (const f of PACT_PLAYER_FIELDS) out.push(q[f]);
	const h = p.horde;
	for (const f of HORDE_SCALARS) out.push(h[f]);
	out.push(h.waveKinds.size());
	for (let k = 0; k < h.waveKinds.size(); k++) out.push(h.waveKinds[k], h.waveX[k], h.waveZ[k]);
	out.push(p.taken.size());
	for (const n of p.taken) out.push(n);
}

/** Dump names for writePactsHash, same order (`pacts.players[0].greedTaken`, `pacts.horde.wave[1].x`, ...). */
export function pactsHashNames(p: Readonly<PactsState>, out: string[]): void {
	out.push("pacts.room", "pacts.seed", "pacts.altars.length");
	for (let k = 0; k < p.altarX.size(); k++) out.push(`pacts.altars[${k}].x`, `pacts.altars[${k}].z`);
	out.push("pacts.players.length");
	for (let i = 0; i < p.players.size(); i++) for (const f of PACT_PLAYER_FIELDS) out.push(`pacts.players[${i}].${f}`);
	for (const f of HORDE_SCALARS) out.push(`pacts.horde.${f}`);
	out.push("pacts.horde.wave.length");
	for (let k = 0; k < p.horde.waveKinds.size(); k++)
		out.push(`pacts.horde.wave[${k}].kind`, `pacts.horde.wave[${k}].x`, `pacts.horde.wave[${k}].z`);
	out.push("pacts.taken.length");
	for (let k = 0; k < p.taken.size(); k++) out.push(`pacts.taken[${k}]`);
}
