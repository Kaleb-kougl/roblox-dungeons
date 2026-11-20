/**
 * Which runs claim Codex entries (claude/codex-plan.md "Rules", decisions CXD6 / CXD14, R8 / R9). Pure; the client
 * asks it once at run start (CodexController / SimController) and claims nothing when `claims` is false.
 *
 *   endless and the daily, solo or co-op   claim, with codex toasts
 *   the tutorial                           claims silently (its lessons own the toast area; R8)
 *   everything else                        nothing: the dev world, M1 (`game` / `dungeonNoEncounter` / `greybox`),
 *                                          any world not listed
 * and never a run started with KV_Debug on, a dev run (`ctx.dev`) or a stress run (R9). Private servers claim. Studio
 * claims too (the session cache; with KV_FakeCodex for tests): only the server's DataStore WRITE is gated there
 * (codexWritesAllowed, CODEX.writeFromStudio).
 *
 * @module
 */
import { DAILY_WORLD_KIND } from "shared/daily";
import { ENDLESS_WORLD_KIND, TUTORIAL_WORLD_KIND, type RunWorldKind } from "shared/run";
import { CODEX } from "./config";

export interface CodexPolicy {
	/** Worlds whose runs claim and show codex toasts. */
	readonly toastWorlds: ReadonlyArray<RunWorldKind>;
	/** Worlds whose runs claim silently (no codex toasts or decorations). */
	readonly silentWorlds: ReadonlyArray<RunWorldKind>;
	/** Runs started with KV_Debug on claim (never in production). */
	readonly claimDebug: boolean;
	/** Dev runs (RunContext.dev) claim. */
	readonly claimDev: boolean;
	/** Stress runs (RunContext.stress > 0) claim. */
	readonly claimStress: boolean;
	/** Studio writes the DataStore. */
	readonly writeFromStudio: boolean;
}

export const CODEX_POLICY: CodexPolicy = table.freeze({
	toastWorlds: table.freeze([ENDLESS_WORLD_KIND, DAILY_WORLD_KIND]),
	silentWorlds: table.freeze([TUTORIAL_WORLD_KIND]),
	claimDebug: false,
	claimDev: false,
	claimStress: false,
	writeFromStudio: CODEX.writeFromStudio,
});

/** What the client knows at run start. */
export interface CodexRunContext {
	/** RunContext.world. */
	readonly world: RunWorldKind;
	/** KV_Debug was on at run start (SimController). */
	readonly debug: boolean;
	/** RunContext.dev. */
	readonly dev: boolean;
	/** RunContext.stress (0 = off). */
	readonly stress: number;
	/** RunService:IsStudio(). Does not gate claims (see the module comment). */
	readonly studio: boolean;
}

export interface CodexEligibility {
	/** The run records Codex entries. */
	readonly claims: boolean;
	/** The run shows codex toasts, decorated chips and draft-card tags (implies `claims`). */
	readonly toasts: boolean;
}

const NONE: CodexEligibility = table.freeze({ claims: false, toasts: false });
const SILENT: CodexEligibility = table.freeze({ claims: true, toasts: false });
const FULL: CodexEligibility = table.freeze({ claims: true, toasts: true });

export function codexEligibility(ctx: CodexRunContext, policy: CodexPolicy = CODEX_POLICY): CodexEligibility {
	if (ctx.debug && !policy.claimDebug) return NONE;
	if (ctx.dev && !policy.claimDev) return NONE;
	if (ctx.stress > 0 && !policy.claimStress) return NONE;
	if (policy.toastWorlds.includes(ctx.world)) return FULL;
	if (policy.silentWorlds.includes(ctx.world)) return SILENT;
	return NONE;
}

/** The server may write the Codex DataStore (Studio only with `writeFromStudio`). */
export function codexWritesAllowed(studio: boolean, policy: CodexPolicy = CODEX_POLICY): boolean {
	return !studio || policy.writeFromStudio;
}
