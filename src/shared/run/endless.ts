/**
 * The endless run's SimConfig from its seed (GDD M1 "Endless solo loop"; Roblox port, no web source). Pure and
 * Roblox-API-free: the client builds its live run with buildEndlessRunConfig and the server's replay
 * (validateRun with world "endless") calls the same function, so both get identical floors from the run seed alone.
 *
 *   config   { endless: { runSeed, worldForFloor }, scoring: ENDLESS_SCORING, breakables: BREAKABLES_CONFIG,
 *              drops: ENDLESS_DROPS_CONFIG, affixes: AFFIXES_CONFIG, builds: BUILDS_CONFIG, pellets: PELLETS_CONFIG,
 *              treasure: ENDLESS_TREASURE_CONFIG, pacts: ENDLESS_PACTS_CONFIG, golden: ENDLESS_GOLDEN_CONFIG }
 *            (shared/sim endless.ts: every tick runs with the current floor; endless runs are ALWAYS scored, on client
 *            and server alike, and always have breakable barrels and crates (docs/DECOR.md D4), boost drops, from kills
 *            and from loaded barrels and crates (docs/BOOSTS.md B4, docs/BREAKABLE_DROPS.md BL4), elite affixes (docs/ENEMY_VARIANTS.md EV7), builds (docs/BUILDS.md BU1) and pellets (docs/PELLETS.md PL5:
 *            each floor's pellets come from its world, EndlessFloorWorld.pellets), treasure rooms (docs/TREASURE.md TR5:
 *            each floor's vault, if any, from its world, EndlessFloorWorld.vault, its chest a breakables piece), pacts
 *            (docs/FORTUNE.md PS5: each floor's altars come from its world, EndlessFloorWorld.pactAltars; the tutorial
 *            keeps the classic shrine) and the Goldling (docs/FORTUNE.md GE3: each floor's room, if any, from
 *            EndlessFloorWorld.golden))
 *   floor f  buildEndlessFloor(runSeed, f, ..., { vaults: true, modifiers: ENDLESS_MODIFIER_WORLD }) (shared/dungeon
 *            endless.ts: solid pillars, breakables, the vault, the pact altars, the Goldling's room, the floor modifier,
 *            docs/FLOOR_MODIFIERS.md FM4; the dev world's KV_TreasureDebug adds a VaultOverride and its KV_FloorModifier
 *            a FloorModifierOverride, run/dev.ts) + playerMover (the slide; ./playerMover.ts, docs/WALL_SLIDE.md) / bulletBlocker /
 *            actorMover / actorSteerMover (enemies walk around pillars) on its dungeon; built on first use, kept in a
 *            per-config LRU (ENDLESS_FLOOR_CACHE_SIZE), the dungeons in a server-wide LRU (ENDLESS_DUNGEON_CACHE_SIZE)
 *            keyed by seed and room count
 *   spawn    floor 1's entrance spawn (the recording must start there)
 *
 * `stress` is never set. Characters (docs/ARCHER.md AR4, `options.characters`): each player's loadout and roll traits
 * (run/characters.ts withCharacters: solo `loadout` / `traits`, co-op `party.loadouts` / `traits`; missing entries the
 * Knight's); the world registry's endless / daily / dev builders always pass them. Without (tools, bots, censuses):
 * `loadout` stays absent (DEFAULT_LOADOUT, both weapons) and no traits, exactly as before.
 *
 * Co-op (M4): buildEndlessRunConfig(seed, partySize) with partySize 2..8 adds `party: { size }`, scores with that
 * partySize, and builds every floor's room spawns with the party's budget multiplier (dungeons are shared: the
 * layout does not depend on the party). partySize 1 is exactly the solo config.
 */
import {
	ENDLESS_FIRST_FLOOR,
	actorMover,
	actorSteerMover,
	bodyBlocker,
	bulletBlocker,
	buildEndlessFloor,
	generateDungeon,
	roomIdAt,
	type Dungeon,
	type EndlessFloorLayout,
	type FloorModifierOverride,
	type FloorModifierWorld,
	type ForgeParams,
	type VaultOverride,
} from "shared/dungeon";
import {
	BREAKABLES_CONFIG,
	DEFAULT_PARTY_SIZE,
	ENDLESS_DROPS_CONFIG,
	ENDLESS_PACTS_CONFIG,
	AFFIXES_CONFIG,
	BUILDS_CONFIG,
	ENDLESS_GOLDEN_CONFIG,
	MAX_PARTY_SIZE,
	PELLETS_CONFIG,
	ENDLESS_TREASURE_CONFIG,
	isValidPartySize,
	type EndlessFloorWorld,
	type ScoringConfig,
	type SimConfig,
} from "shared/sim";
import { ENDLESS_DUNGEON_CACHE_SIZE, ENDLESS_FLOOR_CACHE_SIZE } from "./limits";
import { isValidRunSeed } from "./seed";
import type { RunSetup } from "./config";
import { playerMover, playerMoverKind, type PlayerMoverKind } from "./playerMover";
import { partyCharacters, withCharacters } from "./characters";
import type { CharacterId } from "shared/characters";

// ---------------------------------------------------------------------------------------------
// Dungeon cache (least recently used out first). Dungeons are never mutated.

const cachedKeys: string[] = [];
const cachedDungeons = new Map<string, Dungeon>();

function dungeonKey(params: ForgeParams): string {
	return `${params.seed}/${params.roomCount}`;
}

/**
 * generateDungeon(params), generated once per (seed, room count) and kept in a small LRU cache. Only for
 * endlessFloorParams (the key ignores the other params, which are the same on every endless floor).
 */
export function endlessDungeon(params: ForgeParams): Dungeon {
	const key = dungeonKey(params);
	const hit = cachedDungeons.get(key);
	if (hit !== undefined) {
		const at = cachedKeys.indexOf(key);
		if (at >= 0) cachedKeys.remove(at);
		cachedKeys.push(key);
		return hit;
	}
	const d = generateDungeon(params);
	cachedDungeons.set(key, d);
	cachedKeys.push(key);
	while (cachedKeys.size() > ENDLESS_DUNGEON_CACHE_SIZE) {
		const oldest = cachedKeys.remove(0);
		if (oldest !== undefined) cachedDungeons.delete(oldest);
	}
	return d;
}

/** Keys ("seed/roomCount") of the cached endless dungeons, least recently used first (for tests). */
export function cachedEndlessDungeonKeys(): ReadonlyArray<string> {
	return [...cachedKeys];
}

// ---------------------------------------------------------------------------------------------
// Floors

/** One endless floor as the sim sees it (EndlessFloorWorld), plus its layout for the client and tools. */
export interface EndlessRunFloor extends EndlessFloorWorld {
	readonly layout: EndlessFloorLayout;
	readonly dungeon: Dungeon;
}

/**
 * The sim parts every endless world runs, as the floor modifier pick reads them (shared/dungeon FloorModifierWorld,
 * docs/FLOOR_MODIFIERS.md FM4): the endless config below always sets SimConfig.golden (ENDLESS_GOLDEN_CONFIG), pellets
 * (PELLETS_CONFIG), drops with breakableLoot (ENDLESS_DROPS_CONFIG) and affixes (AFFIXES_CONFIG), solo and co-op, the
 * Daily and dev alike (endless.spec checks it), so every part is on.
 */
export const ENDLESS_MODIFIER_WORLD: FloorModifierWorld = table.freeze({
	golden: true,
	pellets: true,
	breakableLoot: true,
	affixes: true,
});

/**
 * Builds floor `floor` of the run `runSeed` for a party of `partySize` (uncached; the dungeon comes from
 * endlessDungeon's cache), vaults on (docs/TREASURE.md TR5) and floor modifiers on (ENDLESS_MODIFIER_WORLD,
 * docs/FLOOR_MODIFIERS.md FM4); `vaultOverride`: the dev world's KV_TreasureDebug only; `mover`: the player's mover
 * (default: the current `playerMoverKind()`); `unlockFloors` false: the Daily's roster
 * (EndlessFloorOptions.unlockFloors); `modifierOverride`: the dev world's KV_FloorModifier only. Pure.
 */
export function endlessRunFloor(
	runSeed: number,
	floor: number,
	partySize: number = DEFAULT_PARTY_SIZE,
	vaultOverride?: VaultOverride,
	mover: PlayerMoverKind = playerMoverKind(),
	unlockFloors = true,
	modifierOverride?: FloorModifierOverride,
): EndlessRunFloor {
	return endlessFloorWorld(
		buildEndlessFloor(runSeed, floor, endlessDungeon, partySize, {
			vaults: true,
			vaultOverride,
			unlockFloors,
			modifiers: ENDLESS_MODIFIER_WORLD,
			modifierOverride,
		}),
		mover,
	);
}

/**
 * The sim's world for a built floor layout: playerMover (the slide, docs/WALL_SLIDE.md; `mover` defaults to the
 * current `playerMoverKind()`) / bulletBlocker / actorMover / actorSteerMover on its dungeon and its encounter, its
 * spawns and stairwell. What every endless floor steps with; the tutorial (tutorial.ts) builds its hand-scripted floors
 * through it too, so they move, block and steer exactly like an endless floor. Pure.
 */
export function endlessFloorWorld(
	layout: EndlessFloorLayout,
	mover: PlayerMoverKind = playerMoverKind(),
): EndlessRunFloor {
	const d = layout.dungeon;
	const config: SimConfig = {
		moveResolver: playerMover(d, mover),
		isBulletBlocked: bulletBlocker(d),
		isBodyBlocked: bodyBlocker(d),
		actorMover: actorMover(d),
		actorSteerMover: actorSteerMover(d),
		encounter: layout.encounter,
	};
	return {
		floor: layout.floor,
		config,
		bossFloor: layout.bossFloor,
		spawnX: layout.spawn.x,
		spawnZ: layout.spawn.z,
		stairX: layout.stairwell.x,
		stairZ: layout.stairwell.z,
		roomSpawns: layout.roomSpawns,
		roomSpawnTiles: layout.roomSpawnTiles,
		roomIdAt: (x, z) => roomIdAt(d, x, z),
		breakables: layout.breakables,
		roomAffixes: layout.roomAffixes,
		breakableLoot: layout.breakableLoot,
		pellets: layout.pellets,
		vault: layout.vault,
		pactAltars: layout.pactAltars,
		golden: layout.golden,
		modifier: layout.modifier,
		layout,
		dungeon: d,
	};
}

/** An endless RunSetup: also hands out each floor (the same cached objects the sim steps with). */
export interface EndlessRunSetup extends RunSetup {
	/** Floor `floor`'s world and layout (cached; what config.endless.worldForFloor returns). */
	readonly endlessFloor: (floor: number) => EndlessRunFloor;
}

/**
 * A per-run floor cache: the last floor asked for is returned at once (step() asks every tick). The player's mover is
 * read here, when the config is built, so every floor of the run moves the same way (setPlayerMover).
 */
function floorCache(
	runSeed: number,
	partySize: number,
	vaultOverride: VaultOverride | undefined,
	unlockFloors: boolean,
	modifierOverride: FloorModifierOverride | undefined,
): (floor: number) => EndlessRunFloor {
	const mover = playerMoverKind();
	const floors: number[] = [];
	const worlds = new Map<number, EndlessRunFloor>();
	let lastFloor = -1;
	let last: EndlessRunFloor | undefined;
	return (floor) => {
		if (floor === lastFloor && last !== undefined) return last;
		let w = worlds.get(floor);
		if (w === undefined) {
			w = endlessRunFloor(runSeed, floor, partySize, vaultOverride, mover, unlockFloors, modifierOverride);
			worlds.set(floor, w);
			floors.push(floor);
			while (floors.size() > ENDLESS_FLOOR_CACHE_SIZE) {
				const oldest = floors.remove(0);
				if (oldest !== undefined) worlds.delete(oldest);
			}
		} else {
			const at = floors.indexOf(floor);
			if (at >= 0) floors.remove(at);
			floors.push(floor);
		}
		lastFloor = floor;
		last = w;
		return w;
	};
}

/** M2 scoring of every endless run: solo (party size 1). Part of the config, so the server's replay is scored too. */
export const ENDLESS_SCORING: ScoringConfig = table.freeze({ partySize: DEFAULT_PARTY_SIZE });

/** Options of buildEndlessRunConfig that only tools and the dev world pass (every game world passes none). */
export interface EndlessRunOptions {
	/**
	 * Forces / fixes every floor's vault (shared/dungeon VaultOverride): the dev world's KV_TreasureDebug (run/dev.ts)
	 * and specs only. Absent: placeVault's own draws.
	 */
	readonly vaultOverride?: VaultOverride;
	/**
	 * Forces one floor modifier on every floor where it is eligible (shared/dungeon FloorModifierOverride,
	 * docs/FLOOR_MODIFIERS.md FM4): the dev world's KV_FloorModifier (run/dev.ts) and specs only. Absent: the floors'
	 * own picks.
	 */
	readonly modifierOverride?: FloorModifierOverride;
	/**
	 * docs/ARCHER.md AR4: the players' characters (index order; missing entries DEFAULT_CHARACTER's). Absent: no
	 * characters at all (both weapons, no traits; tools and specs), not the Knight.
	 */
	readonly characters?: ReadonlyArray<CharacterId>;
	/** With `characters`: every player carries both weapons with their character's traits (the dev world's option). */
	readonly bothWeapons?: boolean;
	/**
	 * False: the seeded roster ignores the room kinds' unlock floors (shared/dungeon EndlessFloorOptions.unlockFloors):
	 * the Daily (DAILY.rosterUnlockFloors, ./worlds.ts rosterUnlockFloors). Absent or true: as before.
	 */
	readonly unlockFloors?: boolean;
}

/**
 * Builds the endless run's SimConfig and spawn for `runSeed` and a party of `partySize` (see the file comment). Throws
 * on an invalid seed or party size.
 */
export function buildEndlessRunConfig(
	runSeed: number,
	partySize: number = DEFAULT_PARTY_SIZE,
	options: Readonly<EndlessRunOptions> = {},
): EndlessRunSetup {
	if (!isValidRunSeed(runSeed)) {
		error(`buildEndlessRunConfig: seed must be an integer in [0, 2^32), got ${tostring(runSeed)}`, 0);
	}
	if (!isValidPartySize(partySize)) {
		error(`buildEndlessRunConfig: party size must be an integer in [1, ${MAX_PARTY_SIZE}], got ${partySize}`, 0);
	}
	const worldForFloor = floorCache(
		runSeed,
		partySize,
		options.vaultOverride,
		options.unlockFloors !== false,
		options.modifierOverride,
	);
	const first = worldForFloor(ENDLESS_FIRST_FLOOR);
	const base: SimConfig =
		partySize === DEFAULT_PARTY_SIZE
			? {
					endless: { runSeed, worldForFloor },
					scoring: ENDLESS_SCORING,
					breakables: BREAKABLES_CONFIG,
					drops: ENDLESS_DROPS_CONFIG,
					affixes: AFFIXES_CONFIG,
					builds: BUILDS_CONFIG,
					pellets: PELLETS_CONFIG,
					treasure: ENDLESS_TREASURE_CONFIG,
					pacts: ENDLESS_PACTS_CONFIG,
					golden: ENDLESS_GOLDEN_CONFIG,
			  }
			: {
					endless: { runSeed, worldForFloor },
					scoring: { partySize },
					party: { size: partySize },
					breakables: BREAKABLES_CONFIG,
					drops: ENDLESS_DROPS_CONFIG,
					affixes: AFFIXES_CONFIG,
					builds: BUILDS_CONFIG,
					pellets: PELLETS_CONFIG,
					treasure: ENDLESS_TREASURE_CONFIG,
					pacts: ENDLESS_PACTS_CONFIG,
					golden: ENDLESS_GOLDEN_CONFIG,
			  };
	const characters = options.characters !== undefined ? partyCharacters(options.characters, partySize) : undefined;
	const config =
		characters !== undefined ? withCharacters(base, characters, { bothWeapons: options.bothWeapons }) : base;
	return {
		config,
		spawn: { x: first.spawnX, z: first.spawnZ },
		dungeon: first.dungeon,
		endlessFloor: worldForFloor,
		characters,
	};
}
