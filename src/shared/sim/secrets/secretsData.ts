/**
 * Secret room tunables in the sim (docs/SECRET_ROOMS.md SR3 / SR4; a Roblox-port feature, no web source). Data only:
 * secrets.ts, open.ts and stepSecrets.ts read it. Where a floor's secret is (the crack, the chamber, the chest, its tier)
 * is shared/dungeon placeSecret's (SECRET); the open's points are score/scoreData.ts SECRET_POINTS.
 *
 * @module
 */
import {
	TREASURE_BOOSTS,
	TREASURE_POINTS,
	TREASURE_REACH_TILES,
	TREASURE_RELIC_FALLBACK_BOOSTS,
} from "../treasure/treasureData";
import { SECRET_POINTS } from "../score/scoreData";

/** SimConfig.secrets: presence turns secret rooms on; the tunables (SECRETS_CONFIG is the game's). */
export interface SecretsConfig {
	/** A living present player whose centre is within this of the chest's centre opens it (the vault's reach). */
	readonly reachTiles: number;
	/** The crack's open: SECRET points at the kills' floor scaling (SECRET_POINTS). */
	readonly openPoints: number;
	/** The chest's SECRET points by tier (VaultTier order: the vault's treasure points). */
	readonly points: ReadonlyArray<number>;
	/** Boost draws per share by tier (the vault's). */
	readonly boosts: ReadonlyArray<number>;
	/** A relic share whose player owns every relic: this many boosts instead (the vault's). */
	readonly relicFallbackBoosts: number;
}

/** The game's secrets config (every endless world; shared/run buildEndlessRunConfig). The chest gives the vault's. */
export const SECRETS_CONFIG: SecretsConfig = table.freeze({
	reachTiles: TREASURE_REACH_TILES,
	openPoints: SECRET_POINTS,
	points: TREASURE_POINTS,
	boosts: TREASURE_BOOSTS,
	relicFallbackBoosts: TREASURE_RELIC_FALLBACK_BOOSTS,
});

/**
 * The secrets' own stream (the chest's relic and boost draws only): seedToState(seed) XOR this ("KVSR"), like the
 * treasure's (0x4b565452) and the drops' (0x4b564452). Unused anywhere else (shared/dungeon secrets.spec checks the salts).
 */
export const SECRETS_SALT = 0x4b565352;

/** The floor's secret: none, hidden behind its crack, opened (the chamber reachable), its chest taken. Hashed. */
export const SecretStatus = { NONE: 0, HIDDEN: 1, OPEN: 2, TAKEN: 3 } as const;

/** What opened the crack (SRD2 / SRD3). Append only: hashed and counted per run (SecretsState.byHow). */
export const SecretHow = { FINISHER: 0, ROLL: 1, HEAVY: 2, CHARGER: 3 } as const;
export type SecretHowId = (typeof SecretHow)[keyof typeof SecretHow];
/** Entries of SecretsState.byHow. */
export const SECRET_HOW_COUNT = 4;

/** An unset index or tick. */
export const SECRET_UNSET = -1;
