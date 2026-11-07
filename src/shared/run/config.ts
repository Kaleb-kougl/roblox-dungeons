/**
 * The run's SimConfig from its seed, exactly as the web build's App.tsx builds the M1 run (project-kaleb-vale
 * src/App.tsx @ 42897e2, the `run` memo):
 *
 *   dungeon  = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed })
 *   spawn    = runSpawn(dungeon, atBossDoor)              (entrance; boss door only behind the debug flag)
 *   config   = { moveResolver: circleMover(dungeon, PLAYER_RADIUS), isBulletBlocked: bulletBlocker(dungeon),
 *                actorMover: actorMover(dungeon), encounter: placeEncounter(dungeon, DEFAULT_ENCOUNTER) }
 *
 * except the player's mover, a port retune (docs/WALL_SLIDE.md WSD1): `playerMover(dungeon)` is the slide unless a
 * spec set `setPlayerMover(PlayerMover.WEB)` (the web build's circleMover, for the golden fixtures).
 *
 * `loadout` stays absent (= DEFAULT_LOADOUT) and `stress` is never set: a stress run (`?stress=N`) is a debug mode and
 * is not a run the server accepts. Pure and Roblox-API-free, so the client builds its live run with the same function
 * and the server's replay gets the identical world.
 */
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bulletBlocker,
	generateDungeon,
	placeEncounter,
	runSpawn,
	type Dungeon,
	type WorldXZ,
} from "shared/dungeon";
import { DEFAULT_SIM_CONFIG, isValidPartySize, type ScoringConfig, type SimConfig } from "shared/sim";
import { DUNGEON_CACHE_SIZE, type RunWorld } from "./limits";
import { isValidRunSeed } from "./seed";
import { buildEndlessRunConfig, type EndlessRunFloor } from "./endless";
import { playerMover } from "./playerMover";

export { isValidRunSeed };

export interface RunConfigOptions {
	/** Start just outside the boss room's door (the web build's debug `?spawn=boss`). Default: the entrance. */
	atBossDoor?: boolean;
	/** Default "game" (the real run). See RunWorld. */
	world?: RunWorld;
	/**
	 * M2 scoring (opt-in for the M1 worlds): sets SimConfig.scoring. Absent (the default, and what validateRun builds):
	 * the M1 run, unscored, hash-identical to the web build's fixtures. A scored run hashes differently, so its
	 * submissions only validate against a server that builds the same option. Ignored by world "endless", which is
	 * always scored (ENDLESS_SCORING).
	 */
	scoring?: ScoringConfig;
	/**
	 * Co-op (M4): players in the run (default 1). 2+ adds SimConfig.party (and the scoring's partySize when scored).
	 * World "endless" also scales enemy hp and room budgets with it (buildEndlessRunConfig).
	 */
	partySize?: number;
}

export interface RunSetup {
	config: SimConfig;
	/** Where the recording must start. Undefined in the greybox world (any spawn inside the bounds clamp). */
	spawn: WorldXZ | undefined;
	/** The generated floor (undefined in the greybox world). Endless: floor 1's. */
	dungeon: Dungeon | undefined;
	/** Endless runs only (buildEndlessRunConfig): each floor's world and layout, the cached objects the sim steps with. */
	endlessFloor?: (floor: number) => EndlessRunFloor;
}

// ---------------------------------------------------------------------------------------------
// Dungeon cache (generating a floor costs milliseconds; every run on a seed reuses it). Dungeons are never mutated.

const cachedSeeds: number[] = [];
const cachedDungeons = new Map<number, Dungeon>();

/** The MVP floor for `seed`, generated once and kept in a small least-recently-used cache. */
export function dungeonForSeed(seed: number): Dungeon {
	const hit = cachedDungeons.get(seed);
	if (hit !== undefined) {
		const at = cachedSeeds.indexOf(seed);
		if (at >= 0) cachedSeeds.remove(at);
		cachedSeeds.push(seed);
		return hit;
	}
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	cachedDungeons.set(seed, d);
	cachedSeeds.push(seed);
	while (cachedSeeds.size() > DUNGEON_CACHE_SIZE) {
		const oldest = cachedSeeds.remove(0);
		if (oldest !== undefined) cachedDungeons.delete(oldest);
	}
	return d;
}

/** Seeds currently cached, least recently used first (for tests). */
export function cachedDungeonSeeds(): ReadonlyArray<number> {
	return [...cachedSeeds];
}

/**
 * Builds the run's SimConfig and spawn for `seed` (see the file comment). Throws on an invalid seed. World "endless"
 * is buildEndlessRunConfig(seed) (./endless.ts).
 */
export function buildRunConfig(seed: number, options: RunConfigOptions = {}): RunSetup {
	if (!isValidRunSeed(seed)) error(`buildRunConfig: seed must be an integer in [0, 2^32), got ${tostring(seed)}`, 0);
	const world = options.world ?? "game";
	const partySize = options.partySize ?? 1;
	// Always scored; the boss door has no meaning there.
	if (world === "endless") return buildEndlessRunConfig(seed, partySize);
	if (world === "greybox") {
		const grey: SimConfig =
			options.scoring !== undefined ? { ...DEFAULT_SIM_CONFIG, scoring: options.scoring } : DEFAULT_SIM_CONFIG;
		return { config: withParty(grey, partySize), spawn: undefined, dungeon: undefined };
	}

	const dungeon = dungeonForSeed(seed);
	const spawn = runSpawn(dungeon, options.atBossDoor === true);
	const config: SimConfig = {
		moveResolver: playerMover(dungeon),
		isBulletBlocked: bulletBlocker(dungeon),
		actorMover: actorMover(dungeon),
		encounter: world === "game" ? placeEncounter(dungeon, DEFAULT_ENCOUNTER) : undefined,
	};
	if (options.scoring !== undefined) config.scoring = options.scoring;
	return { config: withParty(config, partySize), spawn: { x: spawn.x, z: spawn.z }, dungeon };
}

/** `config` for a party of `partySize` (unchanged for 1): party state, and a scored run's combo cut per party. */
function withParty(config: SimConfig, partySize: number): SimConfig {
	if (partySize === 1) return config;
	if (!isValidPartySize(partySize)) error(`buildRunConfig: bad party size ${tostring(partySize)}`, 0);
	const out: SimConfig = { ...config, party: { size: partySize } };
	if (config.scoring !== undefined) out.scoring = { ...config.scoring, partySize };
	return out;
}
