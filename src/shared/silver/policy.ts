/**
 * Which runs pay Silver (docs/SILVER.md "What never pays", SVD7). Pure.
 *
 *   pays        endless solo / co-op and the Daily (SILVER_PAYING_WORLDS), accepted by the server's replay; private
 *               servers and abandoned-but-validated runs too (as personal records, NBD4)
 *   never pays  the tutorial, M1 (`game` / `dungeonNoEncounter` / `greybox`), `dev` and any other world; debug runs
 *               (debug limits in force, or started with KV_Debug on), dev runs and stress runs; Studio unless the
 *               wallet is faked (KV_FakeWallet); unranked fallback runs (a refused or unanswered `startRun`: local
 *               seed, never seen by the server); rejected / desynced / expired runs (the caller only asks for
 *               accepted ones)
 *
 * The server asks it in RunSessionService.conclude (world, session debug, Studio without a fake); the client may ask
 * it with its own facts for the dimmed preview (`dev`, `stress`, `unranked`).
 *
 * @module
 */
import { SILVER_PAYING_WORLDS } from "./config";

/** Why a run pays no Silver (undefined: it pays). */
export type SilverIneligibleReason = "world" | "debug" | "dev" | "stress" | "studio" | "unranked";

/**
 * The facts besides the world that can stop a run from paying (`silverEligibility`). The server fills `debug` and
 * `studio` from its session; `dev`, `stress` and `unranked` are facts only the client has, set when it asks for its own
 * preview.
 */
export interface SilverRunFlags {
	/** Debug limits were in force (RunSession.debug) or the run started with KV_Debug on. */
	readonly debug: boolean;
	/** A Studio session whose wallet is NOT faked (KV_FakeWallet): Studio writes nothing, so nothing is paid. */
	readonly studio: boolean;
	/** A developer-mode run (RunContext.dev). */
	readonly dev?: boolean;
	/** A stress run (RunContext.stress > 0). */
	readonly stress?: number;
	/** The unranked fallback (the server never issued the run). */
	readonly unranked?: boolean;
}

/**
 * Whether a run pays Silver: undefined when it pays, else the first reason it does not, checked in this order: a world
 * outside `worlds` (default the paying worlds), an unranked fallback run, debug, a dev run, a stress run, Studio
 * without a faked wallet. It does not look at the run's outcome: the caller asks only for runs the server accepted.
 * Called by the server when a run concludes and by the client for its preview.
 */
export function silverEligibility(
	worldKind: string,
	flags: SilverRunFlags,
	worlds: ReadonlyArray<string> = SILVER_PAYING_WORLDS,
): SilverIneligibleReason | undefined {
	if (!worlds.includes(worldKind)) return "world";
	if (flags.unranked === true) return "unranked";
	if (flags.debug) return "debug";
	if (flags.dev === true) return "dev";
	if (flags.stress !== undefined && flags.stress > 0) return "stress";
	if (flags.studio) return "studio";
	return undefined;
}
