/**
 * Builds in the sim (docs/BUILDS.md BU1 / BU2; a Roblox-port feature, no web source): boon levels, duos, the per-player
 * counters the evolutions and duos read, the proc queue, and the boss double draft's deals left. OPT-IN like affixes:
 * only a SimConfig with `builds` (endless worlds, shared/run buildEndlessRunConfig) creates `SimState.builds`, and only
 * then is anything here reached or the hash's "builds" group written (appended after every other group, after
 * "affixes"). Without it (M1, every golden fixture, the tutorial) the draft is today's (drawBoonOffers / grantBoon) and
 * every boon is level I (runMods.ts computeRunMods without a build).
 *
 * State per player (state.builds.players[i], party index order, one per RunState player):
 *   levels           one per Boon index (BOON_COUNT): 0 = not owned, 1..boonMaxLevel. RunPlayerState.boons keeps the
 *                    distinct boons in the order taken (level I pushes there), so every existing reader still works
 *   duos             duo indices, in the order taken
 *   grazes / kills / arrows / bigHits   counters for the evolutions and duos that count (BU5 / BU6: Thrill Seeker,
 *                    Jackpot, Flurry, Storm Blade, Close Call); 0 until those rules exist
 *   draftsLeft       deals left in the open draft, the one on screen included: 1 after a floor, 2 after a boss floor
 *                    (BUD4); a confirm with draftsLeft > 1 re-deals (./cards.ts) instead of closing. 0 while closed
 * and for the world: `procs`, the kill queue (BU3: { x, z, owner, gen, slot, id } per kill; empty until then).
 *
 * Events (BuildEvents) are presentation only: cleared every tick, NOT hashed.
 */
import type { SimState } from "../state";
import { BOON_COUNT } from "../progression/progressionData";
import { CardKind, BUILD_RULES, cardBoon, cardDuo, type BuildRules, type CardKindId } from "./buildsData";

// ---------------------------------------------------------------------------------------------
// Config

/** SimConfig.builds: presence turns builds on; the rules (BUILDS_CONFIG is the game's). */
export type BuildsConfig = BuildRules;

/** The game's builds config (endless solo and co-op). */
export const BUILDS_CONFIG: BuildsConfig = BUILD_RULES;

// ---------------------------------------------------------------------------------------------
// State

/** One player's build. Every field hashed. */
export interface BuildPlayerState {
	/** Per Boon index: 0 = not owned, else the level (1..boonMaxLevel). */
	levels: number[];
	/** Duo indices, in the order taken. */
	duos: number[];
	/** Counters (BU5 / BU6). */
	grazes: number;
	kills: number;
	arrows: number;
	bigHits: number;
	/** Deals left in the open draft (the one on screen included); 0 while no draft is open. */
	draftsLeft: number;
}

/** One queued kill (BU3). Every field hashed. */
export interface BuildProc {
	/** The corpse's position. */
	x: number;
	z: number;
	/** The credited player (party index). */
	owner: number;
	/** The generation (0: the player's own swing / arrow; n + 1: a kill by an effect of generation n). */
	gen: number;
	/** The victim's actor slot and id (skipped as a target). */
	slot: number;
	id: number;
}

/** Per tick, presentation only (cleared every tick, NOT hashed). BU3+ fills the effects; BU2 the takes. */
export interface BuildEvents {
	/** Players (party index) whose pick this tick was an evolution (level III), and the boon. */
	evolvedPlayer: number[];
	evolvedBoon: number[];
	/** Players whose pick this tick was a duo, and the duo. */
	duoPlayer: number[];
	duoTaken: number[];
}

/** SimState.builds. */
export interface BuildsState {
	/** The run's rules (config, constant for the run: not hashed). */
	readonly config: Readonly<BuildsConfig>;
	/** One per player, party index order. */
	players: BuildPlayerState[];
	/** The kill queue, oldest first (BU3). */
	procs: BuildProc[];
	/** NOT hashed. */
	events: BuildEvents;
}

function newPlayer(): BuildPlayerState {
	const levels: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) levels.push(0);
	return { levels, duos: [], grazes: 0, kills: 0, arrows: 0, bigHits: 0, draftsLeft: 0 };
}

function emptyEvents(): BuildEvents {
	return { evolvedPlayer: [], evolvedBoon: [], duoPlayer: [], duoTaken: [] };
}

/** Builds state at run start: an empty build per player (`players`: the party size, 1 solo). No rng. */
export function createBuildsState(config: Readonly<BuildsConfig>, players = 1): BuildsState {
	const out: BuildPlayerState[] = [];
	for (let i = 0; i < players; i++) out.push(newPlayer());
	return { config, players: out, procs: [], events: emptyEvents() };
}

export function cloneBuildsState(s: Readonly<BuildsState>): BuildsState {
	const e = s.events;
	return {
		config: s.config,
		players: s.players.map((p) => ({ ...p, levels: [...p.levels], duos: [...p.duos] })),
		procs: s.procs.map((q) => ({ ...q })),
		events: {
			evolvedPlayer: [...e.evolvedPlayer],
			evolvedBoon: [...e.evolvedBoon],
			duoPlayer: [...e.duoPlayer],
			duoTaken: [...e.duoTaken],
		},
	};
}

/** Start of every tick (step.ts, with the other event clears). */
export function clearBuildEvents(s: BuildsState): void {
	const e = s.events;
	e.evolvedPlayer.clear();
	e.evolvedBoon.clear();
	e.duoPlayer.clear();
	e.duoTaken.clear();
}

// ---------------------------------------------------------------------------------------------
// Reads

/** Player `playerIndex`'s build, or undefined (no builds in this run, or no such player). */
export function buildPlayer(state: Readonly<SimState>, playerIndex: number): BuildPlayerState | undefined {
	return state.builds?.players[playerIndex];
}

/** The level of `boon` for a build (0 = not owned). */
export function buildLevel(p: Readonly<BuildPlayerState>, boon: number): number {
	return p.levels[boon] ?? 0;
}

/** This tick's presentation events, or undefined without builds. */
export function buildEvents(state: Readonly<SimState>): Readonly<BuildEvents> | undefined {
	return state.builds?.events;
}

/**
 * What picking `card` does for player `playerIndex` (CardKind): a duo card is DUO; a boon card is NEW (level 0),
 * UPGRADE (level 1) or EVOLUTION (level 2 and above). Without builds every boon card is NEW (today's draft). -1 for an
 * id that is no card.
 */
export function cardKind(state: Readonly<SimState>, playerIndex: number, card: number): CardKindId | -1 {
	if (cardDuo(card) >= 0) return CardKind.DUO;
	const b = cardBoon(card);
	if (b < 0) return -1;
	const p = buildPlayer(state, playerIndex);
	const level = p !== undefined ? buildLevel(p, b) : 0;
	return level <= 0 ? CardKind.NEW : level === 1 ? CardKind.UPGRADE : CardKind.EVOLUTION;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "builds" group, appended after every other group (after "affixes") only when state.builds exists.
//   players.length; per player: levels (length + values), duos (length + values), BUILD_PLAYER_SCALARS;
//   procs.length; per proc BUILD_PROC_FIELDS

/** Scalar BuildPlayerState fields after the two lists, in hash order. Append only. */
export const BUILD_PLAYER_SCALARS = ["grazes", "kills", "arrows", "bigHits", "draftsLeft"] as const;

/** Per proc, in hash order. Append only. */
export const BUILD_PROC_FIELDS = ["x", "z", "owner", "gen", "slot", "id"] as const;

function pushList(out: number[], list: ReadonlyArray<number>): void {
	out.push(list.size());
	for (const v of list) out.push(v);
}

function pushListNames(out: string[], prefix: string, list: ReadonlyArray<number>): void {
	out.push(`${prefix}.length`);
	for (let i = 0; i < list.size(); i++) out.push(`${prefix}[${i}]`);
}

export function writeBuildsHash(s: Readonly<BuildsState>, out: number[]): void {
	out.push(s.players.size());
	for (const p of s.players) {
		pushList(out, p.levels);
		pushList(out, p.duos);
		for (const f of BUILD_PLAYER_SCALARS) out.push(p[f]);
	}
	out.push(s.procs.size());
	for (const q of s.procs) for (const f of BUILD_PROC_FIELDS) out.push(q[f]);
}

/** Dump names for writeBuildsHash, same order (`builds.players[0].levels[3]`, `builds.procs[0].gen`, ...). */
export function buildsHashNames(s: Readonly<BuildsState>, out: string[]): void {
	out.push("builds.players.length");
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		const prefix = `builds.players[${i}]`;
		pushListNames(out, `${prefix}.levels`, p.levels);
		pushListNames(out, `${prefix}.duos`, p.duos);
		for (const f of BUILD_PLAYER_SCALARS) out.push(`${prefix}.${f}`);
	}
	out.push("builds.procs.length");
	for (let k = 0; k < s.procs.size(); k++) for (const f of BUILD_PROC_FIELDS) out.push(`builds.procs[${k}].${f}`);
}
