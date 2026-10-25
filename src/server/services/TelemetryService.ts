import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { AnalyticsService, Players } from "@rbxts/services";
import { serverLogger } from "server/log";
import {
	RUN_FUNNEL,
	analyticsForRejection,
	analyticsForRun,
	analyticsForSession,
	summarizeRunSession,
	type AnalyticsEventSpec,
	type AnalyticsFields,
	type RunTelemetryRecord,
} from "shared/run";
import { RunValidationService } from "./RunValidationService";

const log = serverLogger("Telemetry");

/**
 * Playtest telemetry on Roblox (replaces the web build's F9 JSON export, docs/PLAYTEST.md): AnalyticsService funnel,
 * progression and custom events, derived SERVER-SIDE from the validated replay of each run (shared/run telemetry.ts
 * and analytics.ts). The client sends no telemetry at all, so it cannot forge any: a rejected run only produces a
 * `RunRejected` event bucketed by reject code. Event names: docs/SERVER.md.
 *
 * Per player it also keeps the session's accepted runs and logs the session events (retry after death, the Fun-gate
 * signal) when the player leaves. A run still validating when its player leaves belongs to that session: the summary
 * waits for it (RunValidationService `waitUntilIdle`), then the player's entry is dropped; nothing is kept for a
 * departed player after that.
 */
@Service({})
export class TelemetryService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly sessions = new Map<Player, RunTelemetryRecord[]>();
	/** Players between PlayerRemoving and their session summary: their late runs still join the session. */
	private readonly leaving = new Set<Player>();

	constructor(private readonly runs: RunValidationService) {}

	onStart(): void {
		this.janitor.Add(
			this.runs.onRunAccepted((player, run) => {
				if (player.Parent !== undefined || this.leaving.has(player)) {
					const list = this.sessions.get(player) ?? [];
					list.push(run.telemetry);
					this.sessions.set(player, list);
				}
				this.logAll(player, analyticsForRun(run.telemetry), run.runId);
			}),
		);
		this.janitor.Add(
			this.runs.onRunRejected((player, code) => this.logAll(player, [analyticsForRejection(code)], undefined)),
		);
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.leaving.add(player);
				task.spawn(() => this.endSession(player));
			}),
		);
	}

	/**
	 * Logs custom / funnel / progression events that are not derived from a run's replay (LobbyService: shared/lobby
	 * analytics.ts). Each failing call is logged and skipped.
	 */
	logEvents(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>): void {
		this.logAll(player, specs, undefined);
	}

	/** Waits for the player's runs still validating, then logs the session summary and forgets the player. */
	private endSession(player: Player): void {
		this.runs.waitUntilIdle(player);
		this.leaving.delete(player);
		const list = this.sessions.get(player);
		this.sessions.delete(player);
		if (list) this.logAll(player, analyticsForSession(summarizeRunSession(list)), undefined);
	}

	/** Logs specs in order; one failing call (bad field, throttling) never stops the rest. */
	protected logAll(player: Player, specs: ReadonlyArray<AnalyticsEventSpec>, funnelSessionId: string | undefined) {
		for (const spec of specs) {
			const [ok, err] = pcall(() => this.logOne(player, spec, funnelSessionId));
			if (!ok) log.warn("ANALYTICS_FAILED", `${spec.kind} event: ${tostring(err)}`);
		}
	}

	protected logOne(player: Player, spec: AnalyticsEventSpec, funnelSessionId: string | undefined): void {
		const fields = customFields(spec.fields);
		if (spec.kind === "custom") {
			AnalyticsService.LogCustomEvent(player, spec.name, spec.value, fields);
		} else if (spec.kind === "funnel") {
			const sessionId = spec.funnel === RUN_FUNNEL ? funnelSessionId : undefined;
			AnalyticsService.LogFunnelStepEvent(player, spec.funnel, sessionId, spec.step, spec.stepName, fields);
		} else {
			const status =
				spec.status === "Start"
					? Enum.AnalyticsProgressionType.Start
					: spec.status === "Complete"
					? Enum.AnalyticsProgressionType.Complete
					: Enum.AnalyticsProgressionType.Fail;
			AnalyticsService.LogProgressionEvent(player, spec.path, status, spec.level, spec.levelName, fields);
		}
	}
}

/** AnalyticsService's customFields dictionary (keys are AnalyticsCustomFieldKeys names), or undefined. */
function customFields(f: AnalyticsFields | undefined): Record<string, string> | undefined {
	if (!f) return undefined;
	const out: Record<string, string> = {};
	if (f.field01 !== undefined) out[Enum.AnalyticsCustomFieldKeys.CustomField01.Name] = f.field01;
	if (f.field02 !== undefined) out[Enum.AnalyticsCustomFieldKeys.CustomField02.Name] = f.field02;
	if (f.field03 !== undefined) out[Enum.AnalyticsCustomFieldKeys.CustomField03.Name] = f.field03;
	return out;
}
