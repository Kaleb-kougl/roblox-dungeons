/**
 * The Goldling's tick step (docs/FORTUNE.md "Appears" / "Escape", GE2): appearance and escape. Only with state.golden
 * (SimConfig.golden) on an endless floor; step() / stepParty() call stepGolden right after stepScore (so the room's
 * engagement and this tick's kills are settled first). Draws NO rng (the main stream, the drops' and its own alike).
 *
 *   WAITING   the room's engagement tick is latched (its score record's engageTick; an unscored run: the tick a player
 *             first entered the room, endless roomsEntered), appearTick = engageTick + config.appearTicks. From
 *             appearTick on: it spawns on the room's spawn tile (EndlessFloorWorld.roomSpawnTiles[room], row order)
 *             farthest from every living player (the largest distance to the nearest of them; ties to the first tile),
 *             RUNNING, seen + 1, events.appeared; a full actor pool (spawnActor returns undefined): SKIPPED,
 *             events.skipped. It is never attached to the room's record (the room clears without it; FD10).
 *   RUNNING   its time is up (v[GOLDEN_TICKS_LEFT] <= 0, still alive): freed (freeActor: no onDeath, score or drop),
 *             ESCAPED, escaped + 1, events.escaped. Coins won stay won. The catch is its onDeath (goldenHooks.ts).
 */
import type { SimState } from "../state";
import type { SimConfig } from "../step";
import { SimCtx } from "../combat/ctx";
import { freeActor, spawnActor } from "../combat/actors/actors";
import { archetypeIndex } from "../combat/actors/registry";
import { GOLDEN_TICKS_LEFT } from "../combat/actors/archetypes/golden";
import { EMPTY_INPUT } from "../input";
import { partySize, playerAt } from "../party";
import { endlessFloorWorld, type SpawnTile } from "../endless";
import { GOLDEN_KIND, GoldenStatus } from "./goldenData";
import type { GoldenState } from "./golden";

const ctx = new SimCtx();

/**
 * The tile of `tiles` farthest from every living player (largest squared distance to the nearest one; ties to the first
 * tile), or undefined when `tiles` is empty. With nobody alive: the first tile.
 */
export function goldenSpawnTile(state: Readonly<SimState>, tiles: ReadonlyArray<SpawnTile>): SpawnTile | undefined {
	let best: SpawnTile | undefined;
	let bestD2 = -1;
	const n = partySize(state);
	for (const t of tiles) {
		let near2 = math.huge;
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			if (p.dead !== 0) continue;
			const dx = t.x - p.x;
			const dz = t.z - p.z;
			const d2 = dx * dx + dz * dz;
			if (d2 < near2) near2 = d2;
		}
		if (near2 > bestD2) {
			best = t;
			bestD2 = near2;
		}
	}
	return best;
}

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
			if (t >= 0) {
				g.engageTick = t;
				g.appearTick = t + g.config.appearTicks;
			}
		}
		if (g.appearTick < 0 || state.tick < g.appearTick) return;
		const tile = goldenSpawnTile(state, world.roomSpawnTiles?.[g.room] ?? []);
		ctx.bind(state, world.config, EMPTY_INPUT);
		const a = tile !== undefined ? spawnActor(ctx, archetypeIndex(GOLDEN_KIND), tile.x, tile.z) : undefined;
		if (a === undefined) {
			g.status = GoldenStatus.SKIPPED;
			g.events.skipped = 1;
			return;
		}
		g.status = GoldenStatus.RUNNING;
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
