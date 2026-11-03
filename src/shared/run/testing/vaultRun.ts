/**
 * Test support for specs (never imported by the game): endless runs whose floors are built with vaults on
 * (docs/TREASURE.md TR2 / TR3). Until TR5 no world sets SimConfig.treasure or passes `vaults: true` to
 * buildEndlessFloor; these runs do both, so the sim's treasure rooms can be tested on real floors. Every floor is the
 * game's endless floor (buildEndlessRunConfig's config: breakables, drops, affixes, builds, pellets) plus its vault and
 * the chest piece; `override` (VaultOverride, the dev world's KV_TreasureDebug) forces a vault on every floor from
 * VAULT.fromFloor and / or its tier and lock. `startFloor` starts the run there (dev mode's floor jump, with its Depth).
 */
import { buildEndlessFloor, type VaultOverride } from "shared/dungeon";
import { ENDLESS_TREASURE_CONFIG, type SimConfig, type TreasureConfig } from "shared/sim";
import { devStartDepth } from "../dev";
import {
	buildEndlessRunConfig,
	endlessDungeon,
	endlessFloorWorld,
	type EndlessRunFloor,
	type EndlessRunSetup,
} from "../endless";

export interface VaultRunOptions {
	/** Absent: placeVault's own draws (about one floor in two from floor 2). */
	readonly override?: VaultOverride;
	/** SimConfig.treasure. Absent: ENDLESS_TREASURE_CONFIG; `false`: no treasure config (the floors keep their vaults). */
	readonly treasure?: TreasureConfig | false;
	/** The run's first floor (EndlessConfig.startFloor); absent: floor 1. */
	readonly startFloor?: number;
}

/** A vault run of `runSeed` for a party of `partySize` (see the file comment). Floors are cached for the run. */
export function buildVaultRunConfig(
	runSeed: number,
	partySize = 1,
	options: Readonly<VaultRunOptions> = {},
): EndlessRunSetup {
	const base = buildEndlessRunConfig(runSeed, partySize);
	const floors = new Map<number, EndlessRunFloor>();
	const worldForFloor = (floor: number): EndlessRunFloor => {
		let w = floors.get(floor);
		if (w === undefined) {
			const layout = buildEndlessFloor(runSeed, floor, endlessDungeon, partySize, {
				vaults: true,
				vaultOverride: options.override,
			});
			w = endlessFloorWorld(layout);
			floors.set(floor, w);
		}
		return w;
	};
	const start = options.startFloor;
	const first = worldForFloor(start ?? 1);
	const treasure = options.treasure === false ? undefined : options.treasure ?? ENDLESS_TREASURE_CONFIG;
	const config: SimConfig = {
		...base.config,
		endless:
			start !== undefined
				? { runSeed, worldForFloor, startFloor: start, startDepth: devStartDepth(start) }
				: { runSeed, worldForFloor },
		treasure,
	};
	return {
		config,
		spawn: { x: first.spawnX, z: first.spawnZ },
		dungeon: first.dungeon,
		endlessFloor: worldForFloor,
	};
}
