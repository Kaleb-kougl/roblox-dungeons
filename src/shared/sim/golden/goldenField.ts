/**
 * The Goldling's flee field in the sim (docs/FORTUNE.md "Moves", GE2). A LEAF (shared/dungeon, the breakables' cell
 * lookups and types only), read by the archetype (combat/actors/archetypes/golden.ts).
 *
 *   sources   goldenReadSources: every fieldTicks ticks (from its first step on this floor) the archetype stores the box
 *             cells of the living players standing inside its room's floor rectangle (player index order) in
 *             GoldenState.src and the tick in fieldTick (hashed). A player outside the rectangle (a corridor, a
 *             doorway, another room) is no source: with nobody in its room the Goldling stands still.
 *   field     goldenField: shared/dungeon fleeField over the room's box with open = the walk mask minus the intact
 *             breakables' cells, from GoldenState.src. Cached (GoldenState.cache, never hashed) under the key (fieldTick,
 *             the floor data, the intact piece count): every input is hashed state, so a clone that rebuilds it from
 *             scratch gets the same field (a piece broken since fieldTick changes the count, and both rebuild).
 *
 * @module
 */
import { cellKey, fleeField, newFleeScratch, worldToGrid } from "shared/dungeon";
import { solidCells } from "../breakables/cells";
import { partySize, playerAt } from "../party";
import type { SimState } from "../state";
import type { GoldenFieldCache, GoldenState } from "./golden";

/** The box-local cell index of world (x, z) in `g`'s floor rectangle, or -1 outside it (or without a floor). */
export function goldenBoxCell(g: Readonly<GoldenState>, x: number, z: number): number {
	const f = g.floor;
	if (f === undefined) return -1;
	const lx = worldToGrid(x) - f.x0;
	const ly = worldToGrid(z) - f.y0;
	if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) return -1;
	return ly * f.w + lx;
}

/** True when world (x, z) is on a FLOOR cell of the Goldling's room (its walk mask). */
export function goldenInRoom(g: Readonly<GoldenState>, x: number, z: number): boolean {
	const c = goldenBoxCell(g, x, z);
	return c >= 0 && g.floor!.walk[c] === 1;
}

/** Re-reads the field's sources (see the file comment) at this tick. No-op without a floor. */
export function goldenReadSources(state: Readonly<SimState>, g: GoldenState): void {
	g.src.clear();
	g.fieldTick = state.tick;
	if (g.floor === undefined) return;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const c = goldenBoxCell(g, p.x, p.z);
		if (c >= 0) g.src.push(c);
	}
}

/** The current flee field (see the file comment), or undefined without a floor. Allocates only on a new floor. */
export function goldenField(state: Readonly<SimState>, g: GoldenState): GoldenFieldCache | undefined {
	const f = g.floor;
	if (f === undefined) return undefined;
	const c = g.cache;
	const intact = state.breakables?.intact ?? 0;
	if (c.scratch !== undefined && c.floor === f && c.fieldTick === g.fieldTick && c.intact === intact) return c;
	const n = f.w * f.h;
	if (c.scratch === undefined || c.floor !== f) {
		c.open = new Array<number>(n, 0);
		c.field = new Array<number>(n, 0);
		c.scratch = newFleeScratch(n);
	}
	const solid = solidCells(state);
	for (let ly = 0; ly < f.h; ly++)
		for (let lx = 0; lx < f.w; lx++) {
			const i = ly * f.w + lx;
			const blocked = solid !== undefined && solid.has(cellKey(f.x0 + lx, f.y0 + ly));
			c.open[i] = f.walk[i] === 1 && !blocked ? 1 : 0;
		}
	fleeField(c.open, f.w, f.h, g.src, g.src.size(), c.field, c.scratch, g.config.fleeFactor);
	c.floor = f;
	c.fieldTick = g.fieldTick;
	c.intact = intact;
	return c;
}
