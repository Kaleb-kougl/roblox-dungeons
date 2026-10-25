/**
 * Stress mode setup (source: `src/bullets/setup.ts` `stressFromQuery` / `MAX_STRESS_BULLETS`, and App.tsx's
 * `stress: stress > 0 ? { bullets: stress, x: spawn.x, z: spawn.z } : undefined`). The web build reads `?stress=N`
 * from the URL; the Roblox client reads a debug attribute (any number or numeric string) and passes the result into
 * SimConfig.stress, so live play and replays build the same stress emitter. Pure: no Roblox API here.
 */

import type { StressConfig } from "../step";

/** Largest accepted stress target (the enemy bullet simulation is sized from it). */
export const MAX_STRESS_BULLETS = 20000;

/**
 * A raw `?stress` value -> live enemy bullets to keep alive: `floor(Number(raw))`, 0 when absent, not a finite
 * number or <= 0, capped at MAX_STRESS_BULLETS. Strings are parsed like JS `Number` for plain decimal / exponent
 * forms (surrounding whitespace allowed, empty = 0).
 */
export function stressTargetFrom(raw: unknown): number {
	let n: number;
	if (typeIs(raw, "number")) n = raw;
	else if (typeIs(raw, "string")) {
		const trimmed = raw.match("^%s*(.-)%s*$")[0] as string;
		n = trimmed === "" ? 0 : tonumber(trimmed) ?? 0 / 0;
	} else return 0;
	n = math.floor(n);
	if (!(n === n && n !== math.huge && n !== -math.huge) || n <= 0) return 0;
	return math.min(n, MAX_STRESS_BULLETS);
}

/** SimConfig.stress for a target (from stressTargetFrom) with rings from (x, z) (the player's spawn); undefined = off. */
export function stressConfig(bullets: number, x: number, z: number): StressConfig | undefined {
	return bullets > 0 ? { bullets, x, z } : undefined;
}
