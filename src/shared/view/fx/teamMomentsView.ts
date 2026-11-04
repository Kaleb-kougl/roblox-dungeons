/**
 * The co-op moments' presentation rules (docs/RUN_RECAP.md CM2), pure. TeamMoments (teamMoments.ts) decides WHAT
 * happened; these decide how it shows, and the client only draws:
 *   - teamPerfectFor: the frame's team perfect of a room clear (the stamp / chip text, the pulse rings, the sound).
 *   - teamPulsePlayers: who gets a pulse ring (every living party member, CMD2: near or far).
 * The SYNC! callout's timeline is syncCallout.ts. Presentation only.
 */
import { MAX_PARTY_SIZE, partySize, playerAt, type SimState } from "shared/sim";
import type { RoomClear } from "./roomClears";
import type { TeamPerfectMoment } from "./teamMoments";

/** The team perfect of clear `c` among the frame's (same tick and room), or undefined (not one, or a solo run). */
export function teamPerfectFor(
	c: Pick<RoomClear, "tick" | "room">,
	perfects: ReadonlyArray<TeamPerfectMoment>,
): TeamPerfectMoment | undefined {
	for (const p of perfects) if (p.tick === c.tick && p.room === c.room) return p;
	return undefined;
}

/** Fills `out` with every living player's index (party order) and returns it: the team pulse's rings. */
export function teamPulsePlayers(state: Readonly<SimState>, out: number[]): number[] {
	out.clear();
	const n = math.min(partySize(state), MAX_PARTY_SIZE);
	for (let i = 0; i < n; i++) if (playerAt(state, i).dead === 0) out.push(i);
	return out;
}

/** A parsed TEAM_MOMENTS_VIEW.debug attribute value (see there). */
export type TeamMomentsDebug =
	| { readonly kind: "perfect"; readonly streak: number }
	| { readonly kind: "sync"; readonly far: boolean; readonly count: number };

/**
 * Parses the KV_TeamMomentsDebug attribute: "perfect" / "perfect:<n>" (n >= 1 whole), "sync" / "sync:far" / "sync:<n>"
 * (n players, 2..MAX_PARTY_SIZE); anything else (a non-string included) is undefined.
 */
export function parseTeamMomentsDebug(raw: unknown): TeamMomentsDebug | undefined {
	if (!typeIs(raw, "string")) return undefined;
	const [h, a] = raw.match("^(%a+):?(%w*)$");
	if (!typeIs(h, "string")) return undefined;
	const head = h;
	const arg = typeIs(a, "string") ? a : "";
	const n = arg !== "" ? tonumber(arg) : undefined;
	if (head === "perfect") {
		if (arg === "") return { kind: "perfect", streak: 1 };
		if (n === undefined || n < 1 || n !== math.floor(n)) return undefined;
		return { kind: "perfect", streak: n };
	}
	if (head === "sync") {
		if (arg === "") return { kind: "sync", far: false, count: 2 };
		if (arg === "far") return { kind: "sync", far: true, count: 2 };
		if (n === undefined || n < 2 || n > MAX_PARTY_SIZE || n !== math.floor(n)) return undefined;
		return { kind: "sync", far: false, count: n };
	}
	return undefined;
}
