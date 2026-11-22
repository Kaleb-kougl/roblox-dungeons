/**
 * A solo run's build (docs/SIM_CONTROLLER.md step 4; moved out of SimController.ts unchanged, its fields now
 * parameters): the debug attribute reads of a run start (KV_World, KV_Seed), the world and its LiveRun
 * ({@link makeSoloRun}), and the pacer that holds a run on screen without a tick ({@link FROZEN_PACER}).
 *
 * @module
 */
import { Workspace } from "@rbxts/services";
import { logWarn } from "client/log";
import type { CharacterId, UpgradeLevels } from "shared/characters";
import type { Dungeon } from "shared/dungeon";
import { DEFAULT_RUN_SEED, LiveRun, RUN_ATTRIBUTES, type LiveRunSetup } from "shared/play";
import {
	DEV_WORLD_KIND,
	LIVE_RUN_WORLD,
	buildWorldSetup,
	errorMessage,
	isValidRunSeed,
	type DevRunOptions,
	type EndlessRunFloor,
	type RunWorld,
	type RunWorldKind,
} from "shared/run";
import { stressConfig, type SimConfig } from "shared/sim";
import type { FrameAdvance, FramePacer } from "shared/view/fx";
import { ownedCharacterOr, statusUpgrades } from "shared/view/silver";
import type { WalletStatus } from "shared/wallet";

const WORLDS: ReadonlyArray<RunWorld> = ["game", "endless", "dungeonNoEncounter", "greybox"];

/**
 * Paces a finished tutorial run: every frame frozen, so the run stays on screen (its last state, alpha unchanged) but
 * runs no tick, records nothing and reports no events (LiveRun.frame still resets the frame's events).
 */
export const FROZEN_PACER: FramePacer = {
	frame(_realDeltaSeconds: number, out: FrameAdvance): FrameAdvance {
		out.simDelta = 0;
		out.frozen = true;
		out.timeScale = 0;
		out.frozenMs = 0;
		return out;
	},
};

/** A solo run as built: the LiveRun and what the RunContext takes from its world setup. */
export interface MadeRun {
	readonly run: LiveRun;
	readonly config: Readonly<SimConfig>;
	readonly dungeon: Dungeon | undefined;
	readonly endlessFloor: ((floor: number) => EndlessRunFloor) | undefined;
	/** RunSetup.characters (docs/ARCHER.md AR4 / AR5 / AR9). */
	readonly characters: ReadonlyArray<CharacterId> | undefined;
}

/** KV_World, else the place's play mode (shared/run LIVE_RUN_WORLD: "endless" unless shared/config PLAY_MODE is "m1"). */
export function readWorld(): RunWorld {
	const raw = Workspace.GetAttribute(RUN_ATTRIBUTES.world);
	return typeIs(raw, "string") && WORLDS.includes(raw as RunWorld) ? (raw as RunWorld) : LIVE_RUN_WORLD;
}

/** KV_Seed, else DEFAULT_RUN_SEED (and a warning for a value that is no run seed). */
export function readSeed(): number {
	const raw = Workspace.GetAttribute(RUN_ATTRIBUTES.seed);
	if (raw === undefined) return DEFAULT_RUN_SEED;
	if (isValidRunSeed(raw)) return raw;
	logWarn(
		`[Sim] ${RUN_ATTRIBUTES.seed} = ${tostring(raw)} is not an integer in [0, 2^32); using ${DEFAULT_RUN_SEED}`,
	);
	return DEFAULT_RUN_SEED;
}

/** What {@link makeSoloRun} reads of the controller, as it is at the call. */
export interface SoloBuildInputs {
	/** Developer mode: the dev run's choices (SimController.devRun). */
	readonly devRun: DevRunOptions | undefined;
	/** The latest wallet push, or undefined before the first. */
	readonly wallet: WalletStatus | undefined;
	/** The upgrade levels the ranked session was built with (StartRunReply.upgrades). */
	readonly rankedUpgrades: UpgradeLevels | undefined;
	/** The character solo runs are built with. */
	readonly runCharacter: CharacterId;
}

/**
 * Builds the run's world (the world registry: the same builder as the server's) and a LiveRun (segmented when
 * `runId` is set: one segment per endless floor, cut on the floor-change tick); returns the error message when
 * the sim refuses the config. `scoring` adds M2 scoring to a non-endless world (KV_Scoring, never submitted).
 */
export function makeSoloRun(
	from: SoloBuildInputs,
	seed: number,
	atBossDoor: boolean,
	stress: number,
	world: RunWorldKind,
	runId: string | undefined,
	scoring: boolean,
): MadeRun | string {
	const [ok, result] = pcall(() => {
		const dev = world === DEV_WORLD_KIND ? from.devRun : undefined;
		// docs/ARCHER.md AR5: the run's character (worlds without characters ignore it; the tutorial is the Knight's).
		// docs/SILVER.md SV6: a ranked run is built with the session's upgrade levels; an unranked one with none; a
		// dev run with its panel's choice (`mine`: the wallet's own levels, buildDevRunConfig reads entry 0).
		const wallet = from.wallet;
		const upgrades =
			runId !== undefined && from.rankedUpgrades !== undefined
				? [from.rankedUpgrades]
				: dev !== undefined
				? [statusUpgrades(wallet)]
				: undefined;
		// docs/SILVER.md SV18: a run the server did not issue (the unranked fallback, a debug or dev run) never builds
		// a character the wallet does not own; a ranked run plays the server's own echo of the pick.
		const character = runId !== undefined ? from.runCharacter : ownedCharacterOr(wallet, from.runCharacter, true);
		const setup = buildWorldSetup(world, seed, {
			atBossDoor,
			dev,
			characters: [character],
			upgrades,
		});
		const spawn = setup.spawn ?? { x: 0, z: 0 };
		const stressCfg = stressConfig(stress, spawn.x, spawn.z);
		const config: Readonly<SimConfig> =
			stressCfg !== undefined ? { ...setup.config, stress: stressCfg } : setup.config;
		const scored: Readonly<SimConfig> =
			scoring && config.scoring === undefined ? { ...config, scoring: {} } : config;
		const runSetup: LiveRunSetup = {
			seed,
			spawnX: spawn.x,
			spawnZ: spawn.z,
			config: scored,
			atBossDoor,
			runId,
			segmentCutAfterTick: (state) => state.events.floorChanged !== 0,
		};
		return {
			run: new LiveRun(runSetup),
			config: scored,
			dungeon: setup.dungeon,
			endlessFloor: setup.endlessFloor,
			characters: setup.characters,
		};
	});
	return ok ? (result as MadeRun) : errorMessage(result);
}
