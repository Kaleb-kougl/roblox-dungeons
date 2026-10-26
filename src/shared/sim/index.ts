/**
 * Barrel for the deterministic simulation (PLAN.md tasks 4, 6, 7). See README.md.
 *
 * Everything reachable from `step()` lives here and must stay plain TypeScript: no Roblox services, Instances,
 * datatypes (Vector3, CFrame, ...), Flamework decorators, clocks (`os.clock`, `tick`, `time`) or `math.random`. The
 * headless test runner enforces this by loading src/shared/sim modules in a restricted environment (see CLAUDE.md).
 */
export * from "./units";
export * from "./jsnum";
export * from "./json";
export * from "./rng";
export * from "./input";
export * from "./loop";
export * from "./playerData";
export {
	ROLL_DASH_STEP,
	ROLL_RECOVERY_STEP,
	STEP_TOLERANCE,
	WALK_STEP,
	PLAYER_HASH_FIELDS,
	damagePlayer,
	isPlayerInvulnerable,
	killPlayerState,
	movePlayer,
	newPlayerState,
	refillAtCheckpoint,
	respawnPlayer,
	runStartHalfHearts,
	stepPlayer,
	writePlayerHash,
	writePlayerStateHash,
} from "./player";
export * from "./state";
export {
	DEFAULT_BOUNDS,
	DEFAULT_SIM_CONFIG,
	forfeitSoloRun,
	step,
	stepParty,
	type ActorMover,
	type BulletBlocker,
	type MoveResolver,
	type SimBounds,
	type SimConfig,
	type StressConfig,
} from "./step";
export * from "./replay";
export * from "./recordingCodec";
export * from "./hashLayout";
export * from "./parity";
export type { RunStartCause, SimControls, SimObserver } from "./observer";
export * from "./combat";
export * from "./endlessData";
export * from "./endless";
export * from "./score";
export * from "./progression";
export * from "./partyData";
export * from "./party";
export * from "./tutorial";
export * from "./breakables";
export * from "./drops";
