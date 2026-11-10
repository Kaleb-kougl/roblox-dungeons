/**
 * The worker's mirror run (docs/ROLLBACK_SPIKE.md Design 5, RBD6): the config and the fresh state built from a setup
 * message exactly as the main client builds its run (client SimController: `startCoop` builds
 * `buildWorldSetup(worldKind, seed, { atBossDoor: false, partySize, characters })`; a solo run `makeRun` builds
 * `buildWorldSetup(world, seed, { atBossDoor, dev, characters: [character] })`; docs/ARCHER.md AR5 plus KV_Stress / KV_Scoring), so the deterministic sim keeps the
 * mirror on the main state's hashes. Pure (the world builders are); the worker VM must keep the default tunings
 * (never the web parity setters).
 */
import { buildWorldSetup, isRunWorldKind, type RunSetup } from "shared/run";
import { createSimState, stressConfig, type SimConfig, type SimState } from "shared/sim";
import type { RollbackSetupMsg } from "./protocol";

export interface RollbackMirrorRun {
	readonly setup: RunSetup;
	/** The run's SimConfig (what stepParty takes; the floor configs come from it). */
	readonly config: Readonly<SimConfig>;
	readonly state: SimState;
}

/** The run config the main client builds for `msg` (see the file comment). Throws on an unknown world kind. */
export function rollbackMirrorConfig(msg: Readonly<RollbackSetupMsg>): {
	setup: RunSetup;
	config: Readonly<SimConfig>;
} {
	if (!isRunWorldKind(msg.worldKind)) error(`rollback mirror: unknown world kind ${msg.worldKind}`, 0);
	const coop = msg.coop;
	const setup = coop
		? buildWorldSetup(msg.worldKind, msg.seed, {
				atBossDoor: false,
				partySize: msg.partySize,
				characters: msg.characters,
		  })
		: buildWorldSetup(msg.worldKind, msg.seed, {
				atBossDoor: msg.atBossDoor,
				dev: msg.dev,
				characters: msg.characters,
		  });
	const spawn = setup.spawn ?? { x: 0, z: 0 };
	const stress = coop ? undefined : stressConfig(msg.stress, spawn.x, spawn.z);
	const base: Readonly<SimConfig> = stress !== undefined ? { ...setup.config, stress } : setup.config;
	const config: Readonly<SimConfig> =
		!coop && msg.scoring && base.scoring === undefined ? { ...base, scoring: {} } : base;
	return { setup, config };
}

/** The mirror's config and its state at tick 0. */
export function buildRollbackMirror(msg: Readonly<RollbackSetupMsg>): RollbackMirrorRun {
	const { setup, config } = rollbackMirrorConfig(msg);
	const spawn = setup.spawn ?? { x: 0, z: 0 };
	return { setup, config, state: createSimState(msg.seed, spawn.x, spawn.z, config) };
}
