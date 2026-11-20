/**
 * Test support for specs (never imported by the game): an endless run with the vault options the dev world's
 * KV_TreasureDebug gives (docs/TREASURE.md TR2 / TR5). Since TR5 every endless world has vaults and SimConfig.treasure
 * (buildEndlessRunConfig), so this is a thin wrapper over the real builder: `override` (VaultOverride) forces a vault on
 * every floor from VAULT.fromFloor and / or fixes its tier and lock (buildEndlessRunConfig's `vaultOverride`, as
 * buildDevRunConfig passes it), `treasure` replaces or drops (`false`: the floors keep their vaults and chest pieces,
 * the sim has no treasure state) the treasure config, and `startFloor` starts the run there (dev mode's floor jump, with
 * its Depth; any party size, unlike the dev world).
 *
 * @module
 */
import type { VaultOverride } from "shared/dungeon";
import type { SimConfig, TreasureConfig } from "shared/sim";
import { devStartDepth } from "../dev";
import { buildEndlessRunConfig, type EndlessRunSetup } from "../endless";

/**
 * Spec support. Options of `buildVaultRunConfig`: what a vault spec changes on the real endless run. All absent gives
 * the endless run of that seed.
 */
export interface VaultRunOptions {
	/** Absent: placeVault's own draws (about one floor in two from floor 2). */
	readonly override?: VaultOverride;
	/** SimConfig.treasure. Absent: the endless world's (ENDLESS_TREASURE_CONFIG); `false`: none. */
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
	const base = buildEndlessRunConfig(runSeed, partySize, { vaultOverride: options.override });
	const endless = base.config.endless!;
	const start = options.startFloor;
	const first = base.endlessFloor(start ?? 1);
	const treasure = options.treasure === false ? undefined : options.treasure ?? base.config.treasure;
	const config: SimConfig = {
		...base.config,
		endless: start !== undefined ? { ...endless, startFloor: start, startDepth: devStartDepth(start) } : endless,
		treasure,
	};
	return {
		config,
		spawn: { x: first.spawnX, z: first.spawnZ },
		dungeon: first.dungeon,
		endlessFloor: base.endlessFloor,
	};
}
