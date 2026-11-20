/**
 * The endless run's SimConfig from its seed (GDD M1 "Endless solo loop"; Roblox port, no web source). Pure and
 * Roblox-API-free: the client builds its live run with buildEndlessRunConfig and the server's replay
 * (validateRun with world "endless") calls the same function, so both get identical floors from the run seed alone.
 *
 *   config   { endless: { runSeed, worldForFloor }, scoring: ENDLESS_SCORING, breakables: BREAKABLES_CONFIG,
 *              drops: ENDLESS_DROPS_CONFIG, affixes: AFFIXES_CONFIG, builds: BUILDS_CONFIG, pellets: PELLETS_CONFIG,
 *              treasure: ENDLESS_TREASURE_CONFIG, pacts: ENDLESS_PACTS_CONFIG, golden: ENDLESS_GOLDEN_CONFIG,
 *              secrets: SECRETS_CONFIG, silver: ENDLESS_SILVER_CONFIG }
 *            (shared/sim endless.ts: every tick runs with the current floor; endless runs are ALWAYS scored, on client
 *            and server alike, and always have breakable barrels and crates (docs/DECOR.md D4), boost drops, from kills
 *            and from loaded barrels and crates (docs/BOOSTS.md B4, docs/BREAKABLE_DROPS.md BL4), elite affixes (docs/ENEMY_VARIANTS.md EV7), builds (docs/BUILDS.md BU1) and pellets (docs/PELLETS.md PL5:
 *            each floor's pellets come from its world, EndlessFloorWorld.pellets), treasure rooms (docs/TREASURE.md TR5:
 *            each floor's vault, if any, from its world, EndlessFloorWorld.vault, its chest a breakables piece), pacts
 *            (docs/FORTUNE.md PS5: each floor's altars come from its world, EndlessFloorWorld.pactAltars; the tutorial
 *            keeps the classic shrine) and the Goldling (docs/FORTUNE.md GE3: each floor's room, if any, from
 *            EndlessFloorWorld.golden) and secret rooms (docs/SECRET_ROOMS.md SR5: each floor's crack, chamber and chest,
 *            if any, from EndlessFloorWorld.secret, the movers built on its carved dungeon) and Silver in crates
 *            (docs/SILVER.md SC2: each floor's Silver pieces from EndlessFloorWorld.breakableSilver))
 *   floor f  buildEndlessFloor(runSeed, f, ..., { vaults: true, modifiers: ENDLESS_MODIFIER_WORLD, secrets: true,
 *            silver: true })
 *            (shared/dungeon
 *            endless.ts: solid pillars, breakables, the vault, the pact altars, the Goldling's room, the floor modifier,
 *            docs/FLOOR_MODIFIERS.md FM4; the dev world's KV_TreasureDebug adds a VaultOverride and its KV_FloorModifier
 *            a FloorModifierOverride and its KV_SecretDebug a SecretOverride and its KV_SilverDebug a SilverOverride, run/dev.ts) + playerMover (the slide; ./playerMover.ts, docs/WALL_SLIDE.md) / bulletBlocker /
 *            actorMover / actorSteerMover (enemies walk around pillars) on its dungeon (a secret floor's carved copy,
 *            layout.secret.dungeon); built on first use, kept in a
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
 *
 * @module
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
	type SecretOverride,
	type SilverOverride,
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
	SECRETS_CONFIG,
	ENDLESS_SILVER_CONFIG,
	isValidPartySize,
	type EndlessFloorWorld,
	type ScoringConfig,
	type SimConfig,
} from "shared/sim";
import { ENDLESS_DUNGEON_CACHE_SIZE, ENDLESS_FLOOR_CACHE_SIZE } from "./limits";
import { isValidRunSeed } from "./seed";
import type { RunSetup } from "./config";
import { playerMover, playerMoverKind, type PlayerMoverKind } from "./playerMover";
import { swordSpacing } from "./swordSpacing";
import { partyCharacters, partyUpgrades, withCharacters } from "./characters";
import type { CharacterId, UpgradeLevels } from "shared/characters";

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
 * (default: the current `playerMoverKind()`); `unlockFloors`: whether the seeded roster keeps the room kinds' unlock
 * floors (EndlessFloorOptions.unlockFloors; default ENDLESS_ROSTER_UNLOCK_FLOORS, false: every endless world's rule
 * since docs/DAILY.md DSD18); `modifierOverride`: the dev world's KV_FloorModifier only; secrets on (docs/SECRET_ROOMS.md
 * SR5), `secretOverride`: the dev world's KV_SecretDebug only; Silver pieces on (docs/SILVER.md SC1),
 * `silverOverride`: the dev world's KV_SilverDebug only. Pure.
 */
export function endlessRunFloor(
	runSeed: number,
	floor: number,
	partySize: number = DEFAULT_PARTY_SIZE,
	vaultOverride?: VaultOverride,
	mover: PlayerMoverKind = playerMoverKind(),
	unlockFloors: boolean = ENDLESS_ROSTER_UNLOCK_FLOORS,
	modifierOverride?: FloorModifierOverride,
	secretOverride?: SecretOverride,
	silverOverride?: SilverOverride,
): EndlessRunFloor {
	return endlessFloorWorld(
		buildEndlessFloor(runSeed, floor, endlessDungeon, partySize, {
			vaults: true,
			vaultOverride,
			unlockFloors,
			modifiers: ENDLESS_MODIFIER_WORLD,
			modifierOverride,
			secrets: true,
			secretOverride,
			silver: true,
			silverOverride,
		}),
		mover,
	);
}

/**
 * The sim's world for a built floor layout: playerMover (the slide, docs/WALL_SLIDE.md; `mover` defaults to the
 * current `playerMoverKind()`) / bulletBlocker / actorMover / actorSteerMover on its dungeon and its encounter, its
 * spawns and stairwell. What every endless floor steps with; the tutorial (tutorial.ts) builds its hand-scripted floors
 * through it too, so they move, block and steer exactly like an endless floor. A secret floor (docs/SECRET_ROOMS.md
 * SR5): the five movers and blockers are built on its carved dungeon (layout.secret.dungeon: the chamber and the crack
 * cells FLOOR, the crack held shut by its pieces); `roomIdAt` and `dungeon` stay the Forge's (the chamber is in no room
 * either way; the client draws the Forge's floor). The config's `roomIdAt` (docs/NEW_ENEMIES_3.md NT2, the Mortar's
 * room test) is the world's own. Pure.
 */
export function endlessFloorWorld(
	layout: EndlessFloorLayout,
	mover: PlayerMoverKind = playerMoverKind(),
): EndlessRunFloor {
	const d = layout.dungeon;
	const sim = layout.secret?.dungeon ?? d;
	const roomOf = (x: number, z: number) => roomIdAt(d, x, z);
	const config: SimConfig = {
		moveResolver: playerMover(sim, mover),
		isBulletBlocked: bulletBlocker(sim),
		isBodyBlocked: bodyBlocker(sim),
		actorMover: actorMover(sim),
		actorSteerMover: actorSteerMover(sim),
		encounter: layout.encounter,
		// docs/NEW_ENEMIES_3.md NT2 (NTD3): the Mortar's room test, the world's own roomIdAt (the Forge's dungeon).
		roomIdAt: roomOf,
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
		roomIdAt: roomOf,
		breakables: layout.breakables,
		roomAffixes: layout.roomAffixes,
		breakableLoot: layout.breakableLoot,
		pellets: layout.pellets,
		vault: layout.vault,
		pactAltars: layout.pactAltars,
		golden: layout.golden,
		modifier: layout.modifier,
		secret: layout.secret,
		breakableSilver: layout.breakableSilver,
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
	secretOverride: SecretOverride | undefined,
	silverOverride: SilverOverride | undefined,
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
			w = endlessRunFloor(
				runSeed,
				floor,
				partySize,
				vaultOverride,
				mover,
				unlockFloors,
				modifierOverride,
				secretOverride,
				silverOverride,
			);
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

/**
 * Whether an endless run's seeded roster keeps the room kinds' unlock floors (shared/dungeon endlessRoster
 * `unlockFloors`, EndlessRoomKind.fromFloor). False (owner, 2026-11-11, docs/DAILY.md DSD18; the Daily since DSD17):
 * the run seed alone orders the pool, so floor 1 is swarmers plus ONE seeded kind that may be any of the ten room
 * kinds (never a turret, boss, the dummy or the Goldling; no affix unlocks before floor 4), and every later floor adds
 * the next kind of the shuffle (ROSTER.floorsPerKind 1: the full roster on floor 10). buildEndlessRunConfig's default, so the endless and dev worlds and every tool or spec
 * that builds an endless run follow it; the tutorial (its own floors) and M1 never read it.
 */
export const ENDLESS_ROSTER_UNLOCK_FLOORS = false;

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
	 * Forces / fixes every floor's secret room (shared/dungeon SecretOverride, docs/SECRET_ROOMS.md SR5): the dev world's
	 * KV_SecretDebug (run/dev.ts) and specs only. Absent: placeSecret's own draws.
	 */
	readonly secretOverride?: SecretOverride;
	/**
	 * Fixes every floor's Silver pieces (shared/dungeon SilverOverride, docs/SILVER.md SC1): the dev world's KV_SilverDebug
	 * (run/dev.ts) and specs only. Absent: placeBreakableSilver's own draws.
	 */
	readonly silverOverride?: SilverOverride;
	/**
	 * docs/ARCHER.md AR4: the players' characters (index order; missing entries DEFAULT_CHARACTER's). Absent: no
	 * characters at all (both weapons, no traits; tools and specs), not the Knight.
	 */
	readonly characters?: ReadonlyArray<CharacterId>;
	/** With `characters`: every player carries both weapons with their character's traits (the dev world's option). */
	readonly bothWeapons?: boolean;
	/**
	 * docs/SILVER.md SV6, with `characters` only (ignored without them): each player's Armory upgrade levels, index
	 * order (missing entries NO_UPGRADES; a junk entry throws), folded into their character's traits. Echoed as
	 * RunSetup.upgrades.
	 */
	readonly upgrades?: ReadonlyArray<UpgradeLevels>;
	/**
	 * Whether the seeded roster keeps the room kinds' unlock floors (shared/dungeon EndlessFloorOptions.unlockFloors;
	 * ./worlds.ts rosterUnlockFloors). Absent: ENDLESS_ROSTER_UNLOCK_FLOORS (false). True: the DSD9 rule (specs only).
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
		options.unlockFloors ?? ENDLESS_ROSTER_UNLOCK_FLOORS,
		options.modifierOverride,
		options.secretOverride,
		options.silverOverride,
	);
	const first = worldForFloor(ENDLESS_FIRST_FLOOR);
	const solo: SimConfig =
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
					secrets: SECRETS_CONFIG,
					silver: ENDLESS_SILVER_CONFIG,
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
					secrets: SECRETS_CONFIG,
					silver: ENDLESS_SILVER_CONFIG,
			  };
	// docs/SWORD_SPACING.md SPD6: the sword's spacing brake, read when the config is built (absent under
	// SwordSpacing.WEB); a run-config field, so every floor of the run brakes the same way.
	const spacing = swordSpacing();
	const base: SimConfig = spacing !== undefined ? { ...solo, spacing } : solo;
	const characters = options.characters !== undefined ? partyCharacters(options.characters, partySize) : undefined;
	const upgrades = characters !== undefined ? partyUpgrades(options.upgrades, partySize) : undefined;
	const config =
		characters !== undefined
			? withCharacters(base, characters, { bothWeapons: options.bothWeapons, upgrades })
			: base;
	return {
		config,
		spawn: { x: first.spawnX, z: first.spawnZ },
		dungeon: first.dungeon,
		endlessFloor: worldForFloor,
		characters,
		upgrades,
	};
}
