/**
 * The Goldling's tick step (docs/FORTUNE.md "Appears" / "Escape", GE2; docs/GOLDLING_RUMOURS.md GR2): release and
 * escape. Only with state.golden (SimConfig.golden) on an endless floor; step() / stepParty() call stepGolden right after
 * stepScore (so the room's engagement, this tick's kills and this tick's breaks are settled first). Draws NO rng (the
 * main stream, the drops' and its own alike).
 *
 *   WAITING   hidden in its piece. The room's engagement tick is latched once (its score record's engageTick; an
 *             unscored run: the tick a player first entered the room, endless roomsEntered): the view's room rumour
 *             reads it; nothing here times off it. Once a player broke its piece (releaseTick >= 0, goldenHooks.ts
 *             goldenOnBreak, earlier this tick): it spawns at the piece's cell centre (goldenPieceCentre), RUNNING,
 *             appearTick = this tick, seen + 1, events.appeared; a full actor pool (spawnActor returns undefined):
 *             SKIPPED, events.skipped. It is never attached to the room's record (the room clears without it; FD10).
 *             Never released: it stays WAITING until the floor ends (no counter).
 *   RUNNING   its time is up (v[GOLDEN_TICKS_LEFT] <= 0, still alive): freed (freeActor: no onDeath, score or drop),
 *             ESCAPED, escaped + 1, events.escaped. Coins won stay won. The catch is its onDeath (goldenHooks.ts).
 *
 * @module
 */
import type { SimState } from "../state";
import type { SimConfig } from "../step";
import { SimCtx } from "../combat/ctx";
import { freeActor, spawnActor } from "../combat/actors/actors";
import { archetypeIndex } from "../combat/actors/registry";
import { GOLDEN_TICKS_LEFT } from "../combat/actors/archetypes/golden";
import { EMPTY_INPUT } from "../input";
import { endlessFloorWorld } from "../endless";
import { GOLDEN_KIND, GoldenStatus } from "./goldenData";
import { goldenPieceCentre, type GoldenState } from "./golden";

const ctx = new SimCtx();

/** The tick its room engaged, or -1 (see the file comment). */
function engagedAt(state: Readonly<SimState>, g: Readonly<GoldenState>): number {
	const rec = g.record >= 0 ? state.score?.rooms[g.record] : undefined;
	if (rec !== undefined) return rec.engageTick;
	const e = state.endless;
	return e !== undefined && e.roomsEntered[g.room] === 1 ? state.tick : -1;
}

/** See the file comment. No-op without state.golden or outside endless mode. */
export function stepGolden(state: SimState, config: Readonly<SimConfig>): void {
	const g = state.golden;
	if (g === undefined || g.floor === undefined) return;
	const world = endlessFloorWorld(state, config);
	if (world === undefined) return;
	if (g.status === GoldenStatus.WAITING) {
		if (g.engageTick < 0) {
			const t = engagedAt(state, g);
			if (t >= 0) g.engageTick = t;
		}
		if (g.releaseTick < 0) return;
		const at = goldenPieceCentre(g)!;
		ctx.bind(state, world.config, EMPTY_INPUT);
		const a = spawnActor(ctx, archetypeIndex(GOLDEN_KIND), at.x, at.z);
		if (a === undefined) {
			g.status = GoldenStatus.SKIPPED;
			g.events.skipped = 1;
			return;
		}
		g.status = GoldenStatus.RUNNING;
		g.appearTick = state.tick;
		g.actorSlot = state.combat.actors.indexOf(a);
		g.actorId = a.id;
		g.seen += 1;
		g.events.appeared = 1;
		return;
	}
	if (g.status === GoldenStatus.RUNNING) {
		const a = state.combat.actors[g.actorSlot];
		if (a === undefined || a.id !== g.actorId || a.alive === 0) return;
		if (a.v[GOLDEN_TICKS_LEFT] > 0) return;
		const x = a.x;
		const z = a.z;
		ctx.bind(state, world.config, EMPTY_INPUT);
		freeActor(ctx, a);
		g.status = GoldenStatus.ESCAPED;
		g.escaped += 1;
		g.events.escaped = { x, z };
	}
}
