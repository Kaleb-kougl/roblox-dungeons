/**
 * The run world registry: world kind -> a builder (seed, options) -> RunSetup. The server's run sessions
 * (runSessions.ts) build every run's world through it, from the seed the SERVER picked, and the client builds its
 * live run with the same builder, so both sides simulate the identical world.
 *
 * Builders must be pure and deterministic (same seed -> same world on every machine), like buildRunConfig.
 *
 * Adding a world is one line in `registerBuiltinWorlds` below, like the endless one:
 *
 *   registerRunWorld("endless", (seed, o) => buildEndlessRunConfig(seed, o.partySize));
 *
 * Which worlds may post to the leaderboards is separate data (shared/leaderboard LEADERBOARD_ELIGIBLE_WORLDS).
 * Which registered worlds the SERVER refuses to run (session starts, including lobby starts) is SERVER_REFUSED_WORLDS.
 * Which worlds are the endless descent (floors, scoring, death-only, the stage loader) is `isEndlessWorld`.
 *
 * @module
 */
import { DAILY, DAILY_WORLD_KIND } from "shared/daily";
import { buildRunConfig, type RunSetup } from "./config";
import { ENDLESS_ROSTER_UNLOCK_FLOORS, buildEndlessRunConfig } from "./endless";
import { TUTORIAL_WORLD_KIND, buildTutorialRunConfig } from "./tutorial";
import { DEV_WORLD_KIND, buildDevRunConfig, type DevRunOptions } from "./dev";
import type { RunWorld } from "./limits";
import type { CharacterId, UpgradeLevels } from "shared/characters";

/** A registered world's name ("game", "dungeonNoEncounter", "greybox", "endless", "daily", "tutorial", "dev"). */
export type RunWorldKind = string;

/** The endless descent's world kind (shared/play RANKED_WORLD_KIND, Play solo's world, is this one). */
export const ENDLESS_WORLD_KIND = "endless";

/**
 * The world is the endless descent: floor after floor from the run seed (buildEndlessRunConfig), always scored, ended
 * only by death, cut into one segment per floor. True for "endless" and "daily" (docs/DAILY.md: the same builder on
 * the server's seed of the day). The tutorial builds endless floors too but is its own world (TUTORIAL_WORLD_KIND).
 */
export function isEndlessWorld(kind: RunWorldKind): boolean {
	return kind === ENDLESS_WORLD_KIND || kind === DAILY_WORLD_KIND;
}

/**
 * Whether world `kind`'s seeded roster keeps the room kinds' unlock floors (shared/dungeon endlessRoster
 * `unlockFloors`): the Daily DAILY.rosterUnlockFloors (docs/DAILY.md DSD17), endless and dev
 * ENDLESS_ROSTER_UNLOCK_FLOORS (DSD18; both false: the run seed alone orders the pool), true for every other world.
 * The builders below and every reader of a run's roster (the stage card, the stage forecast, the Daily card's preview)
 * ask this, so they agree with the floors the sim steps.
 */
export function rosterUnlockFloors(kind: RunWorldKind): boolean {
	if (kind === DAILY_WORLD_KIND) return DAILY.rosterUnlockFloors;
	if (kind === ENDLESS_WORLD_KIND || kind === DEV_WORLD_KIND) return ENDLESS_ROSTER_UNLOCK_FLOORS;
	return true;
}

/**
 * What a world builder (`RunWorldBuilder`) is given besides the seed. The server's run sessions fill it from the
 * validated start request and its own records (party size, characters, upgrades); the client fills the same values from
 * the server's reply, so both build the identical world. A builder ignores the fields its world does not use.
 */
export interface WorldBuildOptions {
	/** Start at the boss door (debug; only honoured where the limits allow it). */
	readonly atBossDoor: boolean;
	/** Co-op (M4): players in the run (default 1); a builder that cannot host a party throws (`config_error`). */
	readonly partySize?: number;
	/**
	 * The `dev` world only (docs/DEV_MODE.md): start floor, god mode and (docs/ARCHER.md AR4) "Both weapons"
	 * (`DevRunOptions.bothWeapons`). Absent: DEFAULT_DEV_RUN. Others ignore it.
	 */
	readonly dev?: DevRunOptions;
	/**
	 * docs/ARCHER.md AR4: each player's character, index order. `endless`, `daily` and `dev`: their loadouts and roll
	 * traits (missing entries, or none passed: DEFAULT_CHARACTER, the Knight); `tutorial`: always the Knight; `game`,
	 * `dungeonNoEncounter`, `greybox`: ignored (both weapons, no traits; ARD9). Echoed as RunSetup.characters.
	 */
	readonly characters?: ReadonlyArray<CharacterId>;
	/**
	 * docs/SILVER.md SV6: each player's Armory upgrade levels, index order (missing entries NO_UPGRADES). Applied where
	 * upgradesApply(kind) (`endless`, `daily`: folded into the characters' traits); `dev` by its panel's
	 * `DevRunOptions.upgrades` (`mine` reads entry 0); `tutorial` and the M1 worlds ignore them. Echoed as
	 * RunSetup.upgrades where applied. The server fills them from the wallet (StartContext.upgrades), the client from
	 * the run-start reply (StartRunReply.upgrades / PartyRunStart.upgrades), so both build the identical config.
	 */
	readonly upgrades?: ReadonlyArray<UpgradeLevels>;
}

/**
 * docs/SILVER.md SV17: the world's run is played as its players' characters (WorldBuildOptions.characters builds
 * their loadouts and traits): `endless`, `daily` and `dev`. The tutorial is always the Knight and M1's worlds play
 * both weapons, so a character pick means nothing there and is never checked for ownership.
 */
export function charactersApply(kind: RunWorldKind): boolean {
	return kind === ENDLESS_WORLD_KIND || kind === DAILY_WORLD_KIND || kind === DEV_WORLD_KIND;
}

/**
 * docs/SILVER.md SV6 / SVD3: the world's run applies its players' Armory upgrades (their levels are read at the
 * start and folded into the traits): the endless descent and the Daily, solo and co-op. False for every other world:
 * `dev` decides through its own panel option (DevRunOptions.upgrades), the tutorial and M1's worlds never.
 */
export function upgradesApply(kind: RunWorldKind): boolean {
	return kind === ENDLESS_WORLD_KIND || kind === DAILY_WORLD_KIND;
}

/** Builds a run's world from its seed. Pure and deterministic; may throw (a session start answers `config_error`). */
export type RunWorldBuilder = (seed: number, options: WorldBuildOptions) => RunSetup;

const builders = new Map<RunWorldKind, RunWorldBuilder>();
const order: RunWorldKind[] = [];

/** Registers (or replaces) a world kind. */
export function registerRunWorld(kind: RunWorldKind, builder: RunWorldBuilder): void {
	if (!builders.has(kind)) order.push(kind);
	builders.set(kind, builder);
}

/** The registered world kinds, in registration order. */
export function runWorldKinds(): ReadonlyArray<RunWorldKind> {
	return [...order];
}

/**
 * True for a registered world kind (an untrusted value: a world name off the wire). Registered is not the same as
 * playable on the server: see `isServerRunWorld`.
 */
export function isRunWorldKind(kind: unknown): kind is RunWorldKind {
	return typeIs(kind, "string") && builders.has(kind);
}

/**
 * Registered worlds the server never runs: they are played only locally on the client (the first-run tutorial,
 * docs/TUTORIAL.md; developer mode, docs/DEV_MODE.md). They stay registered so the client's buildWorldSetup builds them; run session starts
 * (runSessions.ts: ranked, party and lobby starts alike) refuse them (`unknown_world`), so no run in them is ever
 * submitted, validated or posted.
 */
export const SERVER_REFUSED_WORLDS: ReadonlySet<RunWorldKind> = new ReadonlySet([TUTORIAL_WORLD_KIND, DEV_WORLD_KIND]);

/** A registered world the server may run (session starts, including lobby starts): not in SERVER_REFUSED_WORLDS. */
export function isServerRunWorld(kind: unknown): kind is RunWorldKind {
	return isRunWorldKind(kind) && !SERVER_REFUSED_WORLDS.has(kind);
}

/** The world's RunSetup for `seed`. Throws on an unknown kind or whatever the builder throws. */
export function buildWorldSetup(kind: RunWorldKind, seed: number, options: WorldBuildOptions): RunSetup {
	const builder = builders.get(kind);
	if (builder === undefined) error(`unknown world kind ${tostring(kind)}`, 0);
	return builder(seed, options);
}

function legacyWorld(world: RunWorld): RunWorldBuilder {
	return (seed, o) => buildRunConfig(seed, { atBossDoor: o.atBossDoor, world, partySize: o.partySize });
}

function registerBuiltinWorlds(): void {
	registerRunWorld("game", legacyWorld("game"));
	registerRunWorld("dungeonNoEncounter", legacyWorld("dungeonNoEncounter"));
	registerRunWorld("greybox", legacyWorld("greybox"));
	// Endless mode (always scored; the boss door has no meaning there). One line per new world.
	// docs/ARCHER.md AR4: endless / daily / dev build every player's character (the Knight for a missing pick).
	registerRunWorld(ENDLESS_WORLD_KIND, (seed, o) =>
		buildEndlessRunConfig(seed, o.partySize, { characters: o.characters ?? [], upgrades: o.upgrades }),
	);
	// The Daily (docs/DAILY.md): the endless descent, identical setup for the same seed. The server picks its seed of
	// the day (RunSessionDeps.dailySeed, a server-only secret); a server world (not SERVER_REFUSED_WORLDS).
	// Its roster ignores the unlock floors (rosterUnlockFloors, docs/DAILY.md DSD17).
	registerRunWorld(DAILY_WORLD_KIND, (seed, o) =>
		buildEndlessRunConfig(seed, o.partySize, {
			characters: o.characters ?? [],
			upgrades: o.upgrades,
			unlockFloors: rosterUnlockFloors(DAILY_WORLD_KIND),
		}),
	);
	// The first-run tutorial (docs/TUTORIAL.md): a fixed world whatever the seed (and whatever `characters`: the Knight,
	// docs/ARCHER.md owner answer 3), solo only, never leaderboard-eligible
	// (shared/leaderboard LEADERBOARD_ELIGIBLE_WORLDS), played locally and refused by the server (SERVER_REFUSED_WORLDS).
	registerRunWorld(TUTORIAL_WORLD_KIND, (_seed, o) => buildTutorialRunConfig(o.partySize));
	// Developer mode (docs/DEV_MODE.md): an endless run started on any floor, optional god mode. Solo, client-only
	// (SERVER_REFUSED_WORLDS), never leaderboard-eligible.
	// docs/SILVER.md SV6: its upgrades by the panel's DevRunOptions.upgrades (`mine` = the player's own, o.upgrades[0]).
	registerRunWorld(DEV_WORLD_KIND, (seed, o) =>
		buildDevRunConfig(seed, o.dev, o.partySize, o.characters ?? [], o.upgrades?.[0]),
	);
}

registerBuiltinWorlds();
