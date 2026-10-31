/**
 * The run world registry: world kind -> a builder (seed, options) -> RunSetup. The server's run sessions
 * (runSessions.ts) build every run's world through it, from the seed the SERVER picked, and the client builds its
 * live run with the same builder, so both sides simulate the identical world.
 *
 * Builders must be pure and deterministic (same seed -> same world on every machine), like buildRunConfig.
 *
 * Adding a world is one line in `registerBuiltinWorlds` below, like the endless one:
 *
 *   registerRunWorld("endless", (seed, o) => buildEndlessRunConfig(seed, o.partySize));
 *
 * Which worlds may post to the leaderboards is separate data (shared/leaderboard LEADERBOARD_ELIGIBLE_WORLDS).
 * Which registered worlds the SERVER refuses to run (session starts, including lobby starts) is SERVER_REFUSED_WORLDS.
 */
import { buildRunConfig, type RunSetup } from "./config";
import { buildEndlessRunConfig } from "./endless";
import { TUTORIAL_WORLD_KIND, buildTutorialRunConfig } from "./tutorial";
import { DEV_WORLD_KIND, buildDevRunConfig, type DevRunOptions } from "./dev";
import type { RunWorld } from "./limits";

/** A registered world's name ("game", "dungeonNoEncounter", "greybox", "endless", "tutorial", "dev"). */
export type RunWorldKind = string;

export interface WorldBuildOptions {
	/** Start at the boss door (debug; only honoured where the limits allow it). */
	readonly atBossDoor: boolean;
	/** Co-op (M4): players in the run (default 1); a builder that cannot host a party throws (`config_error`). */
	readonly partySize?: number;
	/** The `dev` world only (docs/DEV_MODE.md): start floor and god mode. Absent: DEFAULT_DEV_RUN. Others ignore it. */
	readonly dev?: DevRunOptions;
}

/** Builds a run's world from its seed. Pure and deterministic; may throw (a session start answers `config_error`). */
export type RunWorldBuilder = (seed: number, options: WorldBuildOptions) => RunSetup;

const builders = new Map<RunWorldKind, RunWorldBuilder>();
const order: RunWorldKind[] = [];

/** Registers (or replaces) a world kind. */
export function registerRunWorld(kind: RunWorldKind, builder: RunWorldBuilder): void {
	if (!builders.has(kind)) order.push(kind);
	builders.set(kind, builder);
}

/** The registered world kinds, in registration order. */
export function runWorldKinds(): ReadonlyArray<RunWorldKind> {
	return [...order];
}

export function isRunWorldKind(kind: unknown): kind is RunWorldKind {
	return typeIs(kind, "string") && builders.has(kind);
}

/**
 * Registered worlds the server never runs: they are played only locally on the client (the first-run tutorial,
 * docs/TUTORIAL.md; developer mode, docs/DEV_MODE.md). They stay registered so the client's buildWorldSetup builds them; run session starts
 * (runSessions.ts: ranked, party and lobby starts alike) refuse them (`unknown_world`), so no run in them is ever
 * submitted, validated or posted.
 */
export const SERVER_REFUSED_WORLDS: ReadonlySet<RunWorldKind> = new ReadonlySet([TUTORIAL_WORLD_KIND, DEV_WORLD_KIND]);

/** A registered world the server may run (session starts, including lobby starts): not in SERVER_REFUSED_WORLDS. */
export function isServerRunWorld(kind: unknown): kind is RunWorldKind {
	return isRunWorldKind(kind) && !SERVER_REFUSED_WORLDS.has(kind);
}

/** The world's RunSetup for `seed`. Throws on an unknown kind or whatever the builder throws. */
export function buildWorldSetup(kind: RunWorldKind, seed: number, options: WorldBuildOptions): RunSetup {
	const builder = builders.get(kind);
	if (builder === undefined) error(`unknown world kind ${tostring(kind)}`, 0);
	return builder(seed, options);
}

function legacyWorld(world: RunWorld): RunWorldBuilder {
	return (seed, o) => buildRunConfig(seed, { atBossDoor: o.atBossDoor, world, partySize: o.partySize });
}

function registerBuiltinWorlds(): void {
	registerRunWorld("game", legacyWorld("game"));
	registerRunWorld("dungeonNoEncounter", legacyWorld("dungeonNoEncounter"));
	registerRunWorld("greybox", legacyWorld("greybox"));
	// Endless mode (always scored; the boss door has no meaning there). One line per new world.
	registerRunWorld("endless", (seed, o) => buildEndlessRunConfig(seed, o.partySize));
	// The first-run tutorial (docs/TUTORIAL.md): a fixed world whatever the seed, solo only, never leaderboard-eligible
	// (shared/leaderboard LEADERBOARD_ELIGIBLE_WORLDS), played locally and refused by the server (SERVER_REFUSED_WORLDS).
	registerRunWorld(TUTORIAL_WORLD_KIND, (_seed, o) => buildTutorialRunConfig(o.partySize));
	// Developer mode (docs/DEV_MODE.md): an endless run started on any floor, optional god mode. Solo, client-only
	// (SERVER_REFUSED_WORLDS), never leaderboard-eligible.
	registerRunWorld(DEV_WORLD_KIND, (seed, o) => buildDevRunConfig(seed, o.dev, o.partySize));
}

registerBuiltinWorlds();
