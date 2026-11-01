/**
 * Burst shapes of the Roblox port's own archetypes (docs/BOSS_DEMONLORD.md D4), next to ./arcTable.ts (the web
 * build's shapes, GENERATED from the golden fixtures/arc-table.json, which this port never edits).
 *
 * The web table exists for bit-for-bit parity with V8: its values are V8's Math.sin / Math.cos, which no Roblox
 * machine reproduces. A port-only shape has no web counterpart to match, so its sin / cos only have to be identical on
 * every Roblox client and server: they come from shared/dungeon/forge's dsin / dcos (plain IEEE double arithmetic,
 * correctly rounded, the Dungeon Forge's trig), computed once at module load from gen.arc's own angle formula. The sim
 * still never calls math.sin / math.cos. projectilePatterns.ts merges this table into the arc lookup and refuses a
 * shape that is already in the web table (arcTablePort.spec.ts checks the values and the merge).
 *
 * Add a shape: one PORT_ARC_SOURCES row (count, spread computed exactly as the BurstSpec computes it, and where it comes
 * from). A shape missing here still errors with "arc table miss".
 */

import { dcos, dsin } from "shared/dungeon/forge";
import type { ArcShape } from "./arcTable";

/** One port shape: gen.arc(count, spread) and the BurstSpec(s) that fire it. */
export interface PortArcSource {
	readonly count: number;
	readonly spread: number;
	readonly source: string;
}

const TAU = math.pi * 2;
/** gen.arc's full-ring test: `spread >= TAU - 1e-9`. */
const FULL_RING_THRESHOLD = TAU - 1e-9;

/**
 * Every port-only burst shape. Spreads are written with the same expression (and constants) as the archetype's
 * BurstSpec so the float is the same one: boss/demonlord.ts CLEAVE_SPREAD = 2.4, HELLFIRE_GAP = 1.0 (FULL_RING = 2 PI);
 * archetypes/imp.ts IMP_FAN_SPREAD = 0.7 (docs/ENEMY_VARIANTS.md EV2).
 */
export const PORT_ARC_SOURCES: ReadonlyArray<PortArcSource> = [
	{ count: 7, spread: 2.4, source: "boss/demonlord.ts CLEAVE (and DOUBLE_CLEAVE's two arcs)" },
	{ count: 8, spread: TAU / 3 - 1.0, source: "boss/demonlord.ts HELLFIRE_ARC (three per ring)" },
	{ count: 5, spread: 0.7, source: "archetypes/imp.ts FAN (IMP_FAN_SPREAD)" },
	// docs/BUILDS.md BU1: full rings (spread FULL_RING = 2 PI, combat/patterns.ts; TAU here is the same expression)
	{ count: 8, spread: TAU, source: "builds/effectsData.ts VOLATILE_BURSTS[0], THRILL_SEEKER_RING (8 @ FULL_RING)" },
	{ count: 12, spread: TAU, source: "builds/effectsData.ts VOLATILE_BURSTS[1] (12 @ FULL_RING)" },
];

/** gen.arc's angle of bullet `i` of (count, spread) at heading 0 (the formula in ./projectilePatterns.ts). */
export function arcAngle(count: number, spread: number, i: number): number {
	const full = spread >= FULL_RING_THRESHOLD;
	return full ? 0 + (i / count) * TAU : count === 1 ? 0 : 0 + (i / (count - 1) - 0.5) * spread;
}

function buildShape(src: PortArcSource): ArcShape {
	const sin: number[] = [];
	const cos: number[] = [];
	for (let i = 0; i < src.count; i++) {
		const angle = arcAngle(src.count, src.spread, i);
		sin.push(dsin(angle));
		cos.push(dcos(angle));
	}
	return { count: src.count, spread: src.spread, full: src.spread >= FULL_RING_THRESHOLD, sin, cos };
}

/** The port shapes with their sin / cos (dsin / dcos of gen.arc's angles), in PORT_ARC_SOURCES order. */
export const PORT_ARC_SHAPES: ReadonlyArray<ArcShape> = PORT_ARC_SOURCES.map(buildShape);
