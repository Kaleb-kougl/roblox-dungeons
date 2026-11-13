/**
 * The developer mode world (docs/DEV_MODE.md; a Roblox-port tool, no web source): the endless run of `runSeed`,
 * started on any floor, with optional god mode. Pure and Roblox-API-free, like buildEndlessRunConfig.
 *
 *   config   the endless config of `runSeed` (solo: scoring, breakables, drops, affixes, builds, pellets, treasure) plus
 *            endless.startFloor / startDepth (shared/sim EndlessConfig) and dev: { invulnerable } (shared/sim
 *            DevSimConfig: god mode, toggled mid-run by DEV_GOD_BUTTON)
 *   floors   identical to the endless run's (same builder): floor N of a dev run on seed S is floor N of the endless
 *            run on seed S, unless `options.vault` (KV_TreasureDebug, parseTreasureDebug) forces / fixes the vaults
 *            (docs/TREASURE.md TR5, correction 12: a VaultOverride into the dev world's own floor cache; never the
 *            server's, the world is refused there), or `options.modifier` (KV_FloorModifier,
 *            parseFloorModifierOverride) forces one floor modifier on every floor where it is eligible
 *            (docs/FLOOR_MODIFIERS.md FM4: a FloorModifierOverride into the same cache), or `options.secret`
 *            (KV_SecretDebug, parseSecretDebug) forces / fixes the secret rooms (docs/SECRET_ROOMS.md SR5: a
 *            SecretOverride into the same cache)
 *   Depth    as if every boss before `startFloor` had been killed (devStartDepth); no boons, relics or curses
 *
 * Characters (docs/ARCHER.md AR4): the picked character's loadout and traits like an endless run (the Knight when none is
 * passed); `bothWeapons` (the dev panel's "Both weapons") gives DEFAULT_LOADOUT (sword and bow) with the character's
 * traits, for testing.
 *
 * Played only on the client: the world is in SERVER_REFUSED_WORLDS (worlds.ts), never leaderboard-eligible, and the
 * client never submits it. Solo only: a party throws.
 */
import { DEV_MODE } from "shared/config";
import {
	ENDLESS_FIRST_FLOOR,
	FloorModifier,
	MODIFIERS,
	VaultLock,
	VaultTier,
	floorModifierKind,
	isBossFloor,
	type FloorModifierOverride,
	type SecretOverride,
	type VaultOverride,
} from "shared/dungeon";
import { DEFAULT_PARTY_SIZE, ENDLESS_FIRST_DEPTH, isIntegerNumber } from "shared/sim";
import type { RunSetup } from "./config";
import { buildEndlessRunConfig } from "./endless";
import type { CharacterId } from "shared/characters";

/** The developer mode world's registry kind. */
export const DEV_WORLD_KIND = "dev";

/** A dev run's choices (the dev panel). */
export interface DevRunOptions {
	/** The floor the run starts on (clamped to DEV_MODE.minFloor..maxFloor). */
	readonly startFloor: number;
	/** God mode at run start. */
	readonly invulnerable: boolean;
	/** Treasure rooms (docs/TREASURE.md TR5): force / fix every floor's vault (KV_TreasureDebug). Absent: as endless. */
	readonly vault?: VaultOverride;
	/**
	 * Floor modifiers (docs/FLOOR_MODIFIERS.md FM4): force one kind on every floor where it is eligible
	 * (KV_FloorModifier, parseFloorModifierOverride). Absent: the floors' own picks, as endless.
	 */
	readonly modifier?: FloorModifierOverride;
	/**
	 * Secret rooms (docs/SECRET_ROOMS.md SR5): force / fix every floor's secret (KV_SecretDebug, parseSecretDebug).
	 * Absent: the floors' own draws, as endless.
	 */
	readonly secret?: SecretOverride;
	/**
	 * docs/ARCHER.md AR4: "Both weapons": the sword and the bow (DEFAULT_LOADOUT) with the picked character's roll
	 * traits. Absent / false: the character's own loadout.
	 */
	readonly bothWeapons?: boolean;
}

/** Workspace string attribute read when a dev run starts (DevModeController): parseTreasureDebug's words. */
export const TREASURE_DEBUG_ATTRIBUTE = "KV_TreasureDebug";

/**
 * KV_TreasureDebug's text -> a VaultOverride (docs/TREASURE.md "Studio check"): words in any case, separated by
 * anything that is not a letter: `every` (a vault on every floor from VAULT.fromFloor), `legendary` / `rare` (the
 * starting tier), `untouched` / `swift` (the lock); the last of each kind wins, unknown words are ignored. Undefined
 * when no word applies. Pure.
 */
export function parseTreasureDebug(text: string | undefined): VaultOverride | undefined {
	if (text === undefined) return undefined;
	let every: boolean | undefined;
	let tier: number | undefined;
	let lock: number | undefined;
	for (const [word] of text.lower().gmatch("%a+")) {
		if (word === "every") every = true;
		else if (word === "legendary") tier = VaultTier.LEGENDARY;
		else if (word === "rare") tier = VaultTier.RARE;
		else if (word === "untouched") lock = VaultLock.UNTOUCHED;
		else if (word === "swift") lock = VaultLock.SWIFT;
	}
	if (every === undefined && tier === undefined && lock === undefined) return undefined;
	return { every, tier, lock };
}

/**
 * Workspace attribute read when a dev run starts (the client's DevModeController; docs/FLOOR_MODIFIERS.md FM4):
 * parseFloorModifierOverride's value.
 */
export const FLOOR_MODIFIER_ATTRIBUTE = "KV_FloorModifier";

/**
 * KV_FloorModifier's value -> a FloorModifierOverride (docs/FLOOR_MODIFIERS.md "Studio check"): a string naming a kind
 * by its MODIFIERS key in any case, letters only ("gilded", "Hoard", "blood moon", "BLOOD_MOON" -> bloodMoon), or a
 * number that is a kind's FloorModifier id. Undefined for anything else (absent, empty, "none", 0, unknown words,
 * other types). Pure.
 */
export function parseFloorModifierOverride(value: unknown): FloorModifierOverride | undefined {
	if (typeIs(value, "number")) {
		const kind = floorModifierKind(value);
		return kind !== undefined && kind.id !== FloorModifier.NONE ? { every: true, kind: kind.id } : undefined;
	}
	if (!typeIs(value, "string")) return undefined;
	const letters = value.lower().gsub("%A", "")[0];
	if (letters === "") return undefined;
	for (const k of MODIFIERS.kinds) if (k.key.lower() === letters) return { every: true, kind: k.id };
	return undefined;
}

/** Workspace string attribute read when a dev run starts (DevModeController): parseSecretDebug's words. */
export const SECRET_DEBUG_ATTRIBUTE = "KV_SecretDebug";

/**
 * KV_SecretDebug's text -> a SecretOverride (docs/SECRET_ROOMS.md "Studio check"): words in any case, separated by
 * anything that is not a letter: `every` (a secret on every floor from SECRET.fromFloor that has a candidate),
 * `legendary` / `rare` (the chest's tier); the last of each kind wins, unknown words are ignored. Undefined when no word
 * applies. Pure.
 */
export function parseSecretDebug(text: string | undefined): SecretOverride | undefined {
	if (text === undefined) return undefined;
	let every: boolean | undefined;
	let tier: number | undefined;
	for (const [word] of text.lower().gmatch("%a+")) {
		if (word === "every") every = true;
		else if (word === "legendary") tier = VaultTier.LEGENDARY;
		else if (word === "rare") tier = VaultTier.RARE;
	}
	if (every === undefined && tier === undefined) return undefined;
	return { every, tier };
}

/** A dev run with no choices made: DEV_MODE's defaults. */
export const DEFAULT_DEV_RUN: DevRunOptions = table.freeze({
	startFloor: DEV_MODE.defaultFloor,
	invulnerable: DEV_MODE.defaultInvulnerable,
});

/** `floor` rounded down and clamped to the dev panel's range (DEV_MODE.minFloor..maxFloor). */
export function clampDevFloor(floor: number): number {
	const f = floor === floor ? math.floor(floor) : DEV_MODE.minFloor; // NaN -> the first floor
	return math.clamp(f, math.max(DEV_MODE.minFloor, ENDLESS_FIRST_FLOOR), DEV_MODE.maxFloor);
}

/** The Depth a run reaching `floor` has when it killed every boss before it: 1 + boss floors below `floor`. */
export function devStartDepth(floor: number): number {
	let depth = ENDLESS_FIRST_DEPTH;
	for (let f = ENDLESS_FIRST_FLOOR; f < floor; f++) if (isBossFloor(f)) depth++;
	return depth;
}

/**
 * The dev world's RunSetup for `runSeed` (see the file comment) as `characters[0]` (absent: DEFAULT_CHARACTER). Throws on
 * an invalid seed or a party.
 */
export function buildDevRunConfig(
	runSeed: number,
	options: Readonly<DevRunOptions> = DEFAULT_DEV_RUN,
	partySize?: number,
	characters: ReadonlyArray<CharacterId> = [],
): RunSetup {
	if (partySize !== undefined && partySize !== 1) error(`dev world: solo only, got a party of ${partySize}`, 0);
	if (!isIntegerNumber(options.startFloor)) {
		error(`dev world: startFloor must be an integer, got ${tostring(options.startFloor)}`, 0);
	}
	const startFloor = clampDevFloor(options.startFloor);
	const base = buildEndlessRunConfig(runSeed, DEFAULT_PARTY_SIZE, {
		vaultOverride: options.vault,
		modifierOverride: options.modifier,
		secretOverride: options.secret,
		characters,
		bothWeapons: options.bothWeapons,
	});
	const endless = base.config.endless;
	const endlessFloor = base.endlessFloor;
	if (endless === undefined) error("dev world: the endless config has no floors", 0);
	const first = endlessFloor(startFloor);
	return {
		config: {
			...base.config,
			endless: { ...endless, startFloor, startDepth: devStartDepth(startFloor) },
			dev: { invulnerable: options.invulnerable },
		},
		spawn: { x: first.spawnX, z: first.spawnZ },
		dungeon: first.dungeon,
		endlessFloor,
		characters: base.characters,
	};
}
