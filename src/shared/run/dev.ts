/**
 * The developer mode world (docs/DEV_MODE.md; a Roblox-port tool, no web source): the endless run of `runSeed`,
 * started on any floor, with optional god mode. Pure and Roblox-API-free, like buildEndlessRunConfig.
 *
 *   config   the endless config of `runSeed` (solo: scoring, breakables, drops, affixes) plus
 *            endless.startFloor / startDepth (shared/sim EndlessConfig) and dev: { invulnerable } (shared/sim
 *            DevSimConfig: god mode, toggled mid-run by DEV_GOD_BUTTON)
 *   floors   identical to the endless run's (same worldForFloor cache): floor N of a dev run on seed S is floor N of
 *            the endless run on seed S
 *   Depth    as if every boss before `startFloor` had been killed (devStartDepth); no boons, relics or curses
 *
 * Played only on the client: the world is in SERVER_REFUSED_WORLDS (worlds.ts), never leaderboard-eligible, and the
 * client never submits it. Solo only: a party throws.
 */
import { DEV_MODE } from "shared/config";
import { ENDLESS_FIRST_FLOOR, isBossFloor } from "shared/dungeon";
import { ENDLESS_FIRST_DEPTH, isIntegerNumber } from "shared/sim";
import type { RunSetup } from "./config";
import { buildEndlessRunConfig } from "./endless";

/** The developer mode world's registry kind. */
export const DEV_WORLD_KIND = "dev";

/** A dev run's choices (the dev panel). */
export interface DevRunOptions {
	/** The floor the run starts on (clamped to DEV_MODE.minFloor..maxFloor). */
	readonly startFloor: number;
	/** God mode at run start. */
	readonly invulnerable: boolean;
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

/** The dev world's RunSetup for `runSeed` (see the file comment). Throws on an invalid seed or a party. */
export function buildDevRunConfig(
	runSeed: number,
	options: Readonly<DevRunOptions> = DEFAULT_DEV_RUN,
	partySize?: number,
): RunSetup {
	if (partySize !== undefined && partySize !== 1) error(`dev world: solo only, got a party of ${partySize}`, 0);
	if (!isIntegerNumber(options.startFloor)) {
		error(`dev world: startFloor must be an integer, got ${tostring(options.startFloor)}`, 0);
	}
	const startFloor = clampDevFloor(options.startFloor);
	const base = buildEndlessRunConfig(runSeed);
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
	};
}
