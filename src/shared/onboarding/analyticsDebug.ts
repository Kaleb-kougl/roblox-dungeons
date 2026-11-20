/**
 * The analytics debug echo (docs/TUTORIAL_FUNNEL.md TF8): with the Workspace attribute ANALYTICS_DEBUG_ATTRIBUTE set
 * to true, TelemetryService prints every event spec it logs (Studio sends nothing to AnalyticsService, so this is how a
 * Studio session shows what a live server would send). Off by default. Pure formatting, headlessly tested.
 *
 * @module
 */
import type { AnalyticsEventSpec, AnalyticsFields } from "shared/run";

/** Workspace attribute (boolean, off by default): TelemetryService echoes every analytics spec to the server log. */
export const ANALYTICS_DEBUG_ATTRIBUTE = "KV_AnalyticsDebug";

function describeFields(f: AnalyticsFields | undefined): string {
	if (f === undefined) return "";
	const parts: string[] = [];
	if (f.field01 !== undefined) parts.push(`f1=${f.field01}`);
	if (f.field02 !== undefined) parts.push(`f2=${f.field02}`);
	if (f.field03 !== undefined) parts.push(`f3=${f.field03}`);
	return parts.size() > 0 ? ` [${parts.join(" ")}]` : "";
}

/**
 * One line per spec: `custom <name> = <value>`, `funnel <funnel> #<step> <name> (session <id>)`, `onboarding #<step>
 * <name>`, `progression <status> <path> #<level> <name>`, then the fields (`[f1=.. f2=.. f3=..]`). `sessionId`: the
 * funnel session id the spec is logged with (shown for funnel specs only).
 */
export function describeAnalyticsSpec(spec: AnalyticsEventSpec, sessionId?: string): string {
	const fields = describeFields(spec.fields);
	if (spec.kind === "custom") return `custom ${spec.name} = ${spec.value}${fields}`;
	if (spec.kind === "funnel") {
		const session = sessionId !== undefined ? ` (session ${sessionId})` : "";
		return `funnel ${spec.funnel} #${spec.step} ${spec.stepName}${session}${fields}`;
	}
	if (spec.kind === "onboarding") return `onboarding #${spec.step} ${spec.stepName}${fields}`;
	return `progression ${spec.status} ${spec.path} #${spec.level} ${spec.levelName}${fields}`;
}
