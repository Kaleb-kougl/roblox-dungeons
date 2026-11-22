/**
 * SimController's co-op pieces that are not the frame (docs/SIM_CONTROLLER.md step 3; moved out of SimController.ts
 * unchanged, its fields now parameters): the LockstepClient's build from the A/B attributes (docs/FRAME_PACING.md
 * FPD8 / Design 12 / FP20, docs/LOCAL_PREDICTION.md LPD6), the two KV_Debug outputs (the debug line's numbers and the
 * `[Pace]` line) and a member's name. No clock read here: `logArrivals` is handed the frame's own `now`.
 *
 * @module
 */
import { Players, Workspace } from "@rbxts/services";
import { clientStore } from "client/store";
import { DEFAULT_LOCKSTEP, LockstepClient, formatArrivalLine } from "shared/lockstep";
import type { PartyRunStart } from "shared/network";
import { RUN_ATTRIBUTES } from "shared/play";
import type { buildWorldSetup } from "shared/run";
import { latencyProbeView, leadDebugView, pacingDebugView, predictionDebugView } from "shared/view";
import type { RunContext } from "./context";

/** A co-op run's client and the A/B switches it was built with (RunContext.pacingOff / leadOff / predictOff). */
export interface BuiltCoopClient {
	readonly client: LockstepClient;
	/** KV_PacingOff was set: no playout clock. */
	readonly pacingOff: boolean;
	/** KV_LeadOff was set: the legacy miss counter. */
	readonly leadOff: boolean;
	/** KV_PredictOff was set: no local prediction. */
	readonly predictOff: boolean;
}

/**
 * Builds the party run's LockstepClient (SimController.startCoop): reads the A/B attributes now, prints one `[Sim]`
 * line per switch that is on.
 */
export function buildCoopClient(
	start: PartyRunStart,
	setup: ReturnType<typeof buildWorldSetup>,
	spawn: { readonly x: number; readonly z: number },
	localIndex: number,
): BuiltCoopClient {
	// KV_PacingOff (docs/FRAME_PACING.md FPD8), KV_LeadOff (Design 12) and KV_LeadBump (Revision 3, FP20): A/B
	// switches for playtests, read at every co-op start, combinable (KV_LeadOff wins over KV_LeadBump).
	const pacingOff = Workspace.GetAttribute(RUN_ATTRIBUTES.pacingOff) === true;
	const leadOff = Workspace.GetAttribute(RUN_ATTRIBUTES.leadOff) === true;
	const leadBump = !leadOff && Workspace.GetAttribute(RUN_ATTRIBUTES.leadBump) === true;
	// KV_PredictOff (docs/LOCAL_PREDICTION.md LPD6): the same kind of switch for local prediction.
	const predictOff = Workspace.GetAttribute(RUN_ATTRIBUTES.predictOff) === true;
	const shippedLead = DEFAULT_LOCKSTEP.lead;
	const client = new LockstepClient({
		runId: start.runId,
		seed: start.seed,
		spawn,
		config: setup.config,
		players: start.members.size(),
		localIndex,
		tunables:
			pacingOff || leadOff || leadBump || predictOff
				? {
						...DEFAULT_LOCKSTEP,
						pacing: pacingOff ? undefined : DEFAULT_LOCKSTEP.pacing,
						lead:
							leadOff || shippedLead === undefined
								? undefined
								: leadBump
								? { ...shippedLead, lateBump: true }
								: shippedLead,
						prediction: predictOff ? undefined : DEFAULT_LOCKSTEP.prediction,
				  }
				: undefined,
	});
	if (pacingOff) print(`[Sim] co-op run ${start.runId}: frame pacing off (${RUN_ATTRIBUTES.pacingOff})`);
	if (leadOff) print(`[Sim] co-op run ${start.runId}: measured lead off (${RUN_ATTRIBUTES.leadOff})`);
	if (leadBump) print(`[Sim] co-op run ${start.runId}: late bump on (${RUN_ATTRIBUTES.leadBump})`);
	if (predictOff) print(`[Sim] co-op run ${start.runId}: local prediction off (${RUN_ATTRIBUTES.predictOff})`);
	return { client, pacingOff, leadOff, predictOff };
}

/**
 * KV_Debug co-op: the latency probe's numbers, the effective and net lead and the pacing part to the debug line
 * (with the HUD snapshot); nothing otherwise. `drawnActive` / `snapCount`: the drawn local player's (shared/view/predict
 * DrawnLocalPlayer isActive / snapCount).
 */
export function publishLatencyProbe(
	ctx: RunContext,
	coop: LockstepClient,
	drawnActive: boolean,
	snapCount: number,
): void {
	const probe = ctx.latencyProbe;
	if (probe === undefined) return;
	const pacing = pacingDebugView(coop.pacingStats(), coop.backlog(), ctx.pacingOff !== true);
	const lead = leadDebugView(coop.leadStats(), ctx.leadOff !== true);
	const prediction = predictionDebugView(coop.predictionStats(), ctx.predictOff !== true, drawnActive, snapCount);
	clientStore.setLatencyProbe(
		latencyProbeView(
			probe,
			coop.inputLead(),
			coop.misses,
			coop.netLead(),
			pacing,
			lead,
			coop.mismatches,
			prediction,
		),
	);
}

/**
 * KV_Debug co-op (docs/FRAME_PACING.md FP0): the frame into the arrival log, and its `[Pace]` line once a window is
 * full. Nothing without the log (it only exists under KV_Debug).
 */
export function logArrivals(ctx: RunContext, coop: LockstepClient, now: number, dt: number): void {
	const log = ctx.arrivalLog;
	if (log === undefined) return;
	log.frame(now, dt);
	if (!log.due(now)) return;
	print(
		formatArrivalLine(log.take(now), {
			pacing: coop.pacingStats(),
			pacingOff: ctx.pacingOff === true,
			lead: coop.inputLead(),
			netLead: coop.netLead(),
			misses: coop.mismatches,
			leadStats: coop.leadStats(),
			leadOff: ctx.leadOff === true,
			backlog: coop.backlog(),
		}),
	);
}

/**
 * A party member's name for the spectate bar: the Player's DisplayName, or `#<userId>` (the lobby's fallback,
 * client/ui/menu useNameOf) for a member already gone from the server (never watched: left players are no candidates).
 */
export function memberName(userId: number): string {
	return Players.GetPlayerByUserId(userId)?.DisplayName ?? `#${userId}`;
}
