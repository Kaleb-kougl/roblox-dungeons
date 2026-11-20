/**
 * Floor inputs of the stage asset manifest (docs/STAGE_ASSETS.md SA3; the manifest: shared/view stageAssets.ts). Pure,
 * no Roblox APIs, never draws from any rng the sim reads.
 *
 *   exact     stageInputOf / stageInputOfLayout read a forged floor: every kind in its initial spawns (the boss, M1's
 *             encounter) and planned room spawns, nearest the player's spawn first; its boss; its features (pieces,
 *             loot, pellets, power pellet, vault, relic pedestals = a treasure room, pact altars, the Goldling, a
 *             secret room); its
 *             biome (the Forge theme's BIOMES index, biomeIndexOf).
 *   forecast  forecastStageInput builds nothing: the run's roster on the floor (endlessRoster: a room only buys roster
 *             kinds), the boss of a boss floor (bossKindFor(floorSeed)), the biome from the Forge's theme rule
 *             (resolveParams on endlessFloorParams: the "auto" theme of the floor seed, which a reroll keeps), every
 *             feature on. A superset of the exact input by construction (stageInput.spec checks it).
 *   menu      forecastFirstFloor: no seed yet (menu, lobby): every kind floor 1 can roll, the given biome (default 1).
 *             Floor 1's biome is the seed's auto theme, so any of the five; biome 1 is the plan's guess (SA7 may
 *             prefetch the others behind it).
 *
 * Characters are passed in by the caller (the run's visuals, shared/view stageCharacters; no roster: STAGE_CHARACTERS).
 * Only type imports from shared/view, and BIOMES by file from the theme contract, so the server's shared/run never
 * loads the presentation layer or the theme packs.
 *
 * @module
 */
import {
	BREAKABLE_KINDS,
	ENDLESS_FIRST_FLOOR,
	ENDLESS_ROOM_KINDS,
	NO_POWER_PELLET,
	bossKindFor,
	endlessFloorParams,
	endlessRoster,
	isBossFloor,
	resolveParams,
	type ActorSpawn,
	type Dungeon,
	type EncounterConfig,
	type EndlessFloorLayout,
} from "shared/dungeon";
import { DAILY_WORLD_KIND } from "shared/daily";
import { archetypeAt, archetypeIndex, hasArchetype, type SimConfig } from "shared/sim";
import { BIOMES } from "shared/theme/contract";
import type { StageAssetInput, StageFeatures } from "shared/view";
import type { EndlessRunFloor } from "./endless";
import { ENDLESS_WORLD_KIND, rosterUnlockFloors } from "./worlds";

/** The floor's biome as 1..5 for a Forge theme key (theme BIOMES order: the biome whose forgeTheme it is), 0 if none. */
export function biomeIndexForTheme(themeKey: string): number {
	const i = BIOMES.findIndex((b) => b.forgeTheme === themeKey);
	return i >= 0 ? i + 1 : 0;
}

/** The floor's biome as 1..5 (theme BIOMES order), 0 without a floor (the greybox world). */
export function biomeIndexOf(dungeon: Dungeon | undefined): number {
	return dungeon === undefined ? 0 : biomeIndexForTheme(dungeon.params.themeKey);
}

/** What stageInputOf reads of a run (the client's RunContext satisfies it). */
export interface StageRunSource {
	/** The world registry kind (worlds.ts). */
	readonly world: string;
	/** The current floor's dungeon (M1 worlds: the run's), undefined in the greybox world. */
	readonly dungeon: Dungeon | undefined;
	/** The run's (endless: the current floor's) SimConfig: M1 worlds read its encounter. */
	readonly config: Readonly<SimConfig>;
	/** Endless-built runs (endless, daily, dev, tutorial): each floor's world and layout. */
	readonly endlessFloor: ((floor: number) => EndlessRunFloor) | undefined;
}

const NO_FEATURES: StageFeatures = {
	breakables: false,
	breakableLoot: false,
	pellets: false,
	powerPellet: false,
	vault: false,
	pedestals: false,
	pacts: false,
	golden: false,
	secret: false,
};

const EVERY_FEATURE: StageFeatures = {
	breakables: true,
	breakableLoot: true,
	pellets: true,
	powerPellet: true,
	vault: true,
	pedestals: true,
	pacts: true,
	golden: true,
	secret: true,
};

/** One kind and how near the player's spawn it first stands (squared, world units). */
interface KindDistance {
	readonly kind: string;
	readonly d2: number;
}

/** Folds `spawns` into `nearest` (kind -> smallest squared distance from (sx, sz)). */
function foldSpawns(spawns: ReadonlyArray<ActorSpawn>, sx: number, sz: number, nearest: Map<string, number>): void {
	for (const s of spawns) {
		const dx = s.x - sx;
		const dz = s.z - sz;
		const d2 = dx * dx + dz * dz;
		const was = nearest.get(s.kind);
		if (was === undefined || d2 < was) nearest.set(s.kind, d2);
	}
}

/** The kinds of `nearest`, nearest first (ties by id: a total order, so Luau's unstable sort is deterministic). */
function kindsByDistance(nearest: ReadonlyMap<string, number>): Array<string> {
	const rows = new Array<KindDistance>();
	for (const [kind, d2] of nearest) rows.push({ kind, d2 });
	rows.sort((a, b) => (a.d2 !== b.d2 ? a.d2 < b.d2 : a.kind < b.kind));
	return rows.map((r) => r.kind);
}

/** Is archetype id `kind` a boss (its data.boss)? Unregistered kinds are not. */
function isBossKind(kind: string): boolean {
	return hasArchetype(kind) && archetypeAt(archetypeIndex(kind)).data.boss === true;
}

/** Does the encounter have a treasure room (a relic pedestal, drawn as the vault's chest)? */
function hasTreasureRoom(encounter: EncounterConfig | undefined): boolean {
	if (encounter === undefined) return false;
	for (const r of encounter.rooms) if (r.type === "treasure") return true;
	return false;
}

/** The exact input of a built floor layout (an endless, daily, dev or tutorial floor). */
export function stageInputOfLayout(
	world: string,
	layout: EndlessFloorLayout,
	characters: ReadonlyArray<string>,
	runStart = false,
): StageAssetInput {
	const nearest = new Map<string, number>();
	foldSpawns(layout.encounter.spawns, layout.spawn.x, layout.spawn.z, nearest);
	for (const room of layout.roomSpawns) foldSpawns(room, layout.spawn.x, layout.spawn.z, nearest);
	let pieces = false;
	for (const p of layout.breakables ?? []) {
		// Clutter only (barrel / crate): a vault's or secret's chest and a secret's crack draw no breakable art
		// (docs/SECRET_ROOMS.md SR0).
		if ((BREAKABLE_KINDS as ReadonlyArray<string>).includes(p.kind)) {
			pieces = true;
			break;
		}
	}
	const pellets = layout.pellets;
	const power = pellets !== undefined && pellets.power !== NO_POWER_PELLET;
	const regular = pellets !== undefined && pellets.tiles.size() > (power ? 1 : 0);
	return {
		world,
		floor: layout.floor,
		biome: biomeIndexOf(layout.dungeon),
		characters: [...characters],
		actorKinds: kindsByDistance(nearest),
		bossKind: layout.bossKind,
		features: {
			breakables: pieces,
			// docs/SILVER.md SC3: Silver pieces glint like loaded ones, so a floor with Silver and no loot loads the glint
			breakableLoot: (layout.breakableLoot?.size() ?? 0) > 0 || (layout.breakableSilver?.size() ?? 0) > 0,
			pellets: regular,
			powerPellet: power,
			vault: layout.vault !== undefined,
			pedestals: hasTreasureRoom(layout.encounter),
			pacts: layout.pactAltars !== undefined,
			golden: layout.golden !== undefined,
			// docs/SECRET_ROOMS.md SR6: only on a floor that holds one (the forecast lists it on every floor)
			secret: layout.secret !== undefined,
		},
		runStart,
	};
}

/**
 * The exact input of an M1-style floor (one dungeon, its encounter's initial spawns; no endless features): kinds
 * nearest the entrance room's centre first; the boss is the first boss archetype among the spawns.
 */
export function stageInputOfEncounter(
	world: string,
	floor: number,
	dungeon: Dungeon | undefined,
	encounter: EncounterConfig | undefined,
	characters: ReadonlyArray<string>,
	runStart = false,
): StageAssetInput {
	const nearest = new Map<string, number>();
	let bossKind: string | undefined;
	if (encounter !== undefined) {
		const entrance = encounter.rooms[encounter.entranceRoom];
		foldSpawns(encounter.spawns, entrance?.cx ?? 0, entrance?.cz ?? 0, nearest);
		for (const s of encounter.spawns) {
			if (isBossKind(s.kind)) {
				bossKind = s.kind;
				break;
			}
		}
	}
	return {
		world,
		floor,
		biome: biomeIndexOf(dungeon),
		characters: [...characters],
		actorKinds: kindsByDistance(nearest),
		bossKind,
		features: { ...NO_FEATURES, pedestals: hasTreasureRoom(encounter) },
		runStart,
	};
}

/**
 * The exact input of floor `floor` of a run: its forged layout for an endless-built run (`src.endlessFloor`: endless,
 * daily, dev, tutorial; floor n + 1 is pre-generated during floor n's draft, so this costs nothing then), else the
 * run's dungeon and encounter (M1 worlds).
 */
export function stageInputOf(
	src: StageRunSource,
	floor: number,
	characters: ReadonlyArray<string>,
	runStart = false,
): StageAssetInput {
	if (src.endlessFloor !== undefined) {
		return stageInputOfLayout(src.world, src.endlessFloor(floor).layout, characters, runStart);
	}
	return stageInputOfEncounter(src.world, floor, src.dungeon, src.config.encounter, characters, runStart);
}

/**
 * A forecast of floor `floor` of the endless-built run `runSeed` (endless, daily, dev), forging nothing: the run's
 * roster on the floor, the boss of a boss floor, the floor seed's theme, every feature (see the file comment).
 */
export function forecastStageInput(
	runSeed: number,
	floor: number,
	characters: ReadonlyArray<string>,
	world: string = ENDLESS_WORLD_KIND,
	runStart = false,
): StageAssetInput {
	const params = endlessFloorParams(runSeed, floor);
	const kinds = endlessRoster(runSeed, floor, rosterUnlockFloors(world));
	const bossKind = isBossFloor(floor) ? bossKindFor(params.seed) : undefined;
	if (bossKind !== undefined) kinds.push(bossKind);
	return {
		world,
		floor,
		biome: biomeIndexForTheme(resolveParams(params).themeKey),
		characters: [...characters],
		actorKinds: kinds,
		bossKind,
		features: EVERY_FEATURE,
		runStart,
	};
}

/**
 * The Daily's first floor for today's seed `seed` (shared/view/menu todaysDailySeed): forecastStageInput on floor 1 of
 * the daily world, a run start (the run kit), forging nothing. Its roster follows the Daily's rule (rosterUnlockFloors,
 * docs/DAILY.md DSD17) and its biome is the floor seed's theme, so it names the very kinds, biome and music that run
 * will meet: the menu / lobby prefetch queues it ahead of forecastFirstFloor's every-biome guess (docs/STAGE_ASSETS.md
 * SA7).
 */
export function forecastDailyFirstFloor(seed: number, characters: ReadonlyArray<string>): StageAssetInput {
	return forecastStageInput(seed, ENDLESS_FIRST_FLOOR, characters, DAILY_WORLD_KIND, true);
}

/**
 * The menu / lobby guess at a first floor (no seed yet): every kind floor 1 can roll under `world`'s roster rule
 * (rosterUnlockFloors: without unlock floors, the endless / dev / daily rule since docs/DAILY.md DSD18, every room kind
 * of ENDLESS_ROOM_KINDS; with them, the kinds unlocked on floor 1), biome `biome` (default 1), every feature, the run
 * kit.
 */
export function forecastFirstFloor(
	characters: ReadonlyArray<string>,
	biome = 1,
	world: string = ENDLESS_WORLD_KIND,
): StageAssetInput {
	const unlockFloors = rosterUnlockFloors(world);
	const kinds = new Array<string>();
	for (const k of ENDLESS_ROOM_KINDS) {
		if (!unlockFloors || (k.fromFloor ?? ENDLESS_FIRST_FLOOR) <= ENDLESS_FIRST_FLOOR) kinds.push(k.kind);
	}
	return {
		world,
		floor: ENDLESS_FIRST_FLOOR,
		biome,
		characters: [...characters],
		actorKinds: kinds,
		features: EVERY_FEATURE,
		runStart: true,
	};
}
