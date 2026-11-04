// The Goldling in the sim (docs/FORTUNE.md GE2): opt-in state and its hash group (last), the floor fill, appearance
// appearTicks after its room's record engages on the room's spawn tile farthest from the players, not a room member
// (the room clears without it), kept inside its room while it flees, a cornered Goldling getting out, the jink drawing
// only its own stream, the escape at escapeTicks, bit-identical replays (and a field cache that is a pure function of
// hashed state), and nothing at all without the config. Test-only surgery: teleports, kills through SimCtx.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { GOLDEN_PLACE, gridToWorld, worldToGrid } from "shared/dungeon";
import {
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN,
	GOLDEN_APPEAR_TICKS,
	GOLDEN_ESCAPE_TICKS,
	GOLDEN_HP,
	GOLDEN_JINK,
	GOLDEN_KIND,
	GOLDEN_RUN,
	GOLDEN_SIM_SALT,
	GOLDEN_SUBSYSTEM,
	GOLDEN_TICKS_LEFT,
	GoldenStatus,
	NO_KIND,
	PACTS_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	PORT_BAND_FORTUNE,
	SimCtx,
	archetypeIds,
	archetypeIndex,
	createSimState,
	goldenInRoom,
	goldenSeedState,
	goldenSpawnTile,
	hashLayout,
	hashState,
	isWarbannerAuraTarget,
	seedToState,
	simWorldConfig,
	step,
	webArchetypeIds,
	writeHashFields,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, type EndlessRunFloor } from "shared/run";
import { frame } from "shared/run/testing";

/** The first (run seed, floor) from floor 2 whose floor rolled a Goldling. */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 4; floor++)
			if (setup.endlessFloor(floor).golden !== undefined) return [seed, floor];
	}
	error("no Goldling floor in run seeds 1-60, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly world: EndlessRunFloor;
}

/** A god-mode dev run of SEED from FLOOR, with the Goldling config on (or off). */
function devRun(golden = true): Run {
	const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true });
	const config: SimConfig = { ...dev.config, golden: golden ? ENDLESS_GOLDEN_CONFIG : undefined };
	const s = createSimState(SEED, dev.spawn!.x, dev.spawn!.z, config);
	return { config, s, world: buildEndlessRunConfig(SEED).endlessFloor(FLOOR) };
}

function tick(r: Run, input: InputFrame = EMPTY_INPUT): void {
	step(r.s, input, r.config);
}

/** The walk-mask cell of the Goldling room nearest its centre (world). */
function roomCentre(r: Run): [number, number] {
	const g = r.world.golden!;
	const room = r.world.config.encounter!.rooms[g.room];
	let best: [number, number] = [0, 0];
	let bestD2 = math.huge;
	for (let ly = 0; ly < g.h; ly++)
		for (let lx = 0; lx < g.w; lx++) {
			if (g.walk[ly * g.w + lx] !== 1) continue;
			const x = gridToWorld(g.x0 + lx);
			const z = gridToWorld(g.y0 + ly);
			const d2 = (x - room.cx) * (x - room.cx) + (z - room.cz) * (z - room.cz);
			if (d2 < bestD2) {
				bestD2 = d2;
				best = [x, z];
			}
		}
	return best;
}

function place(s: SimState, x: number, z: number): void {
	s.player.x = x;
	s.player.z = z;
	s.player.prevX = x;
	s.player.prevZ = z;
}

/** Teleports the player into the Goldling room and steps once: the room is entered and its record engages. */
function enterRoom(r: Run): number {
	const [x, z] = roomCentre(r);
	place(r.s, x, z);
	tick(r);
	const room = r.world.golden!.room;
	const rec = r.s.score!.rooms.find((x) => x.room === room)!;
	expect(rec.engageTick).toBe(r.s.tick - 1);
	if (r.s.golden !== undefined) expect(r.s.score!.rooms[r.s.golden.record]).toBe(rec);
	return rec.engageTick;
}

function goldenActor(s: SimState): ActorState {
	const g = s.golden!;
	const a = s.combat.actors[g.actorSlot];
	expect([a.kind, a.id]).toEqual([archetypeIndex(GOLDEN_KIND), g.actorId]);
	return a;
}

/** Steps until the Goldling is out (it appears at the end of tick appearTick). */
function untilOut(r: Run, input: InputFrame = EMPTY_INPUT): void {
	const g = r.s.golden!;
	while (g.status === GoldenStatus.WAITING) {
		expect(r.s.tick).toBeLessThanOrEqual(g.appearTick < 0 ? math.huge : g.appearTick);
		tick(r, input);
	}
	expect(g.status).toBe(GoldenStatus.RUNNING);
}

describe("golden: archetype and opt-in state (GE2)", () => {
	it("is band PORT_BAND_FORTUNE, index 18, harmless, no room enemy, never in a Warbanner's aura", () => {
		expect(GOLDEN.id).toBe(GOLDEN_KIND);
		expect(GOLDEN.band).toBe(PORT_BAND_FORTUNE);
		// Index 18 in the game's table (7 web ids, the dummy, the Demon Lord, band 3's four, band 4's five); this spec's
		// world also registers shared/sim/testing's band-0 test archetypes, which number before it.
		const index = webArchetypeIds().size() + 11;
		expect(archetypeIndex(GOLDEN_KIND)).toBe(index);
		expect(archetypeIds()[index]).toBe(GOLDEN_KIND);
		expect(archetypeIndex(GOLDEN_KIND)).toBe(archetypeIndex("warbanner") + 1);
		expect(archetypeIds().size()).toBe(index + 1);
		// GE4 tuned the plan's 10 to 24 (docs/FORTUNE.md GE4, run/goldenCensus.spec.ts).
		expect(GOLDEN_HP).toBe(24);
		expect([GOLDEN.data.hp, GOLDEN.data.radius, GOLDEN.data.speed, GOLDEN.data.contactDamage]).toEqual([
			GOLDEN_HP,
			0.3,
			5.1,
			0,
		]);
		expect((GOLDEN.data as { roomEnemy?: boolean }).roomEnemy).toBe(undefined);
		expect(isWarbannerAuraTarget(archetypeIndex(GOLDEN_KIND))).toBe(false);
		expect([ENDLESS_GOLDEN_CONFIG.appearTicks, ENDLESS_GOLDEN_CONFIG.escapeTicks]).toEqual([180, 600]);
		// The plan's re-relax factor (GE4 measured 1.2 / 2 / 3: the catch rate barely moves, so the plan's stays).
		expect(ENDLESS_GOLDEN_CONFIG.fleeFactor).toBe(1.2);
		expect([GOLDEN_APPEAR_TICKS, GOLDEN_ESCAPE_TICKS]).toEqual([180, 600]);
	});

	it("absent config: no golden state, no golden group, the run hashes exactly as before", () => {
		const off = devRun(false);
		expect(off.s.golden).toBe(undefined);
		const layout = hashLayout(off.s, true);
		expect(layout.groups.map((gr) => gr.name).includes(GOLDEN_SUBSYSTEM)).toBe(false);
		// Pacts (docs/FORTUNE.md PS5: the dev world sets them too) stay the last group, after pellets.
		expect(layout.groups[layout.groups.size() - 1].name).toBe(PACTS_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 2].name).toBe(PELLETS_SUBSYSTEM);
	});

	it("present: the golden group is last (after pellets, pacts), a name per value, = writeHashFields; WAITING on its floor", () => {
		const r = devRun();
		const g = r.s.golden!;
		expect([g.status, g.room, g.floor]).toEqual([GoldenStatus.WAITING, r.world.golden!.room, r.world.golden]);
		expect(r.s.score!.rooms[g.record].room).toBe(g.room);
		const layout = hashLayout(r.s, true);
		const names = layout.groups.map((gr) => gr.name);
		expect([names[names.size() - 3], names[names.size() - 2], names[names.size() - 1]]).toEqual([
			PELLETS_SUBSYSTEM,
			PACTS_SUBSYSTEM,
			GOLDEN_SUBSYSTEM,
		]);
		expect(layout.names.size()).toBe(layout.values.size());
		const last = layout.groups[layout.groups.size() - 1];
		expect(layout.names[last.start]).toBe("golden.rngState");
		expect(layout.names[last.finish - 1]).toBe("golden.src.length");
		expect(layout.values).toEqual(writeHashFields(r.s, []));
	});

	it("its stream has a salt of its own (not the floor roll's GOLDEN_PLACE.salt): seedToState(seed) ^ 0x7a3c5e91", () => {
		expect(GOLDEN_SIM_SALT).toBe(0x7a3c5e91);
		expect(GOLDEN_SIM_SALT).never.toBe(GOLDEN_PLACE.salt);
		for (const seed of [0, 1, SEED, 1337, 0x7fffffff]) {
			expect(goldenSeedState(seed)).toBe(bit32.bxor(seedToState(seed), GOLDEN_SIM_SALT));
			expect(createSimState(seed, 0, 0, devRun().config).golden!.rngState).toBe(goldenSeedState(seed));
		}
	});
});

describe("golden: appearance, room, escape (GE2)", () => {
	it("appears appearTicks after the room engages, on the room's spawn tile farthest from the player", () => {
		const r = devRun();
		const engaged = enterRoom(r);
		const g = r.s.golden!;
		expect(g.engageTick).toBe(engaged);
		expect(g.appearTick).toBe(engaged + GOLDEN_APPEAR_TICKS);
		while (r.s.tick < g.appearTick) {
			tick(r);
			expect(g.status).toBe(GoldenStatus.WAITING);
		}
		tick(r); // tick appearTick: it spawns at the end
		expect(g.status).toBe(GoldenStatus.RUNNING);
		expect(g.events.appeared).toBe(1);
		expect(g.seen).toBe(1);
		const a = goldenActor(r.s);
		expect(a.spawnTick).toBe(g.appearTick);
		const tile = goldenSpawnTile(r.s, r.world.roomSpawnTiles![g.room])!;
		expect([a.x, a.z]).toEqual([tile.x, tile.z]);
		// Farthest: no spawn tile of the room is farther from the player.
		const p = r.s.player;
		const d2 = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
		for (const t of r.world.roomSpawnTiles![g.room])
			expect((t.x - p.x) * (t.x - p.x) + (t.z - p.z) * (t.z - p.z)).toBeLessThanOrEqual(d2);
		expect([a.aiState, a.v[GOLDEN_TICKS_LEFT], a.hp]).toEqual([GOLDEN_RUN, GOLDEN_ESCAPE_TICKS, a.hpMax]);
	});

	it("is not a member of its room's record: the room clears without it, and it keeps running", () => {
		const r = devRun();
		enterRoom(r);
		untilOut(r);
		const g = r.s.golden!;
		const rec = r.s.score!.rooms[g.record];
		expect(rec.memberIds.includes(g.actorId)).toBe(false);
		for (const rr of r.s.score!.rooms) expect(rr.memberIds.includes(g.actorId)).toBe(false);
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		for (let m = 0; m < rec.memberSlots.size(); m++) {
			const a = r.s.combat.actors[rec.memberSlots[m]];
			if (a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) ctx.killActor(a);
		}
		tick(r);
		expect(rec.cleared).toBe(1);
		expect(g.status).toBe(GoldenStatus.RUNNING);
		expect(goldenActor(r.s).alive).toBe(1);
	});

	it("flees inside its room (never a doorway or corridor), escapes exactly escapeTicks after appearing", () => {
		const r = devRun();
		enterRoom(r);
		untilOut(r);
		const g = r.s.golden!;
		const a = goldenActor(r.s);
		const appear = g.appearTick;
		let moved = 0;
		let jinks = 0;
		let wasJink = false;
		while (g.status === GoldenStatus.RUNNING) {
			// The player chases it (straight at it, no attack).
			const p = r.s.player;
			const dx = a.x - p.x;
			const dz = a.z - p.z;
			const len = math.sqrt(dx * dx + dz * dz);
			const x0 = a.x;
			const z0 = a.z;
			tick(r, len > 1e-6 ? frame(dx / len, dz / len) : EMPTY_INPUT);
			if (g.status !== GoldenStatus.RUNNING) break;
			expect(goldenInRoom(g, a.x, a.z)).toBe(true);
			moved += math.sqrt((a.x - x0) * (a.x - x0) + (a.z - z0) * (a.z - z0));
			const isJink = a.aiState === GOLDEN_JINK;
			if (isJink && !wasJink) jinks++;
			wasJink = isJink;
		}
		expect(g.status).toBe(GoldenStatus.ESCAPED);
		expect(r.s.tick - 1).toBe(appear + GOLDEN_ESCAPE_TICKS); // freed at the end of tick appear + 600
		expect([g.escaped, g.caught]).toEqual([1, 0]);
		expect(g.events.escaped).never.toBe(undefined);
		expect(r.s.combat.actors[g.actorSlot].id).never.toBe(g.actorId); // the slot is free
		expect(moved).toBeGreaterThan(5);
		print(
			`[golden] chased for ${GOLDEN_ESCAPE_TICKS} ticks: moved ${string.format(
				"%.1f",
				moved,
			)} units, ${jinks} jinks`,
		);
	});

	it("gets out of a corner: placed by the room's wall with the player close, it ends farther from the player", () => {
		const r = devRun();
		enterRoom(r);
		untilOut(r);
		const g = r.s.golden!;
		const f = g.floor!;
		const a = goldenActor(r.s);
		// The walk cell nearest the box's top-left corner; the player 2 cells toward the centre.
		let cx = -1;
		let cy = -1;
		for (let s = 0; s < f.w + f.h && cx < 0; s++)
			for (let ly = 0; ly <= s && cx < 0; ly++) {
				const lx = s - ly;
				if (lx < f.w && ly < f.h && f.walk[ly * f.w + lx] === 1) {
					cx = lx;
					cy = ly;
				}
			}
		a.x = gridToWorld(f.x0 + cx);
		a.z = gridToWorld(f.y0 + cy);
		let px = cx + 2;
		let py = cy + 2;
		if (f.walk[py * f.w + px] !== 1) [px, py] = [cx + 1, cy + 1];
		place(r.s, gridToWorld(f.x0 + px), gridToWorld(f.y0 + py));
		const d0 = math.sqrt((a.x - r.s.player.x) * (a.x - r.s.player.x) + (a.z - r.s.player.z) * (a.z - r.s.player.z));
		for (let k = 0; k < 120 && g.status === GoldenStatus.RUNNING; k++) {
			tick(r);
			expect(goldenInRoom(g, a.x, a.z)).toBe(true);
		}
		const d1 = math.sqrt((a.x - r.s.player.x) * (a.x - r.s.player.x) + (a.z - r.s.player.z) * (a.z - r.s.player.z));
		print(
			`[golden] cornered at ${string.format("%.2f", d0)} from the player, ${string.format("%.2f", d1)} after 2 s`,
		);
		expect(d1).toBeGreaterThan(d0 + 3);
		// Not still in its corner.
		expect(math.abs(worldToGrid(a.x) - (f.x0 + cx)) + math.abs(worldToGrid(a.z) - (f.y0 + cy))).toBeGreaterThan(3);
	});

	it("a full pool skips it: never appears, SKIPPED", () => {
		const r = devRun();
		enterRoom(r);
		const g = r.s.golden!;
		while (r.s.tick < g.appearTick) tick(r);
		// Fill every free slot with corpses-to-be: spawn dummies until the pool is full (test surgery).
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		while (ctx.spawnActor("dummy", 0, 0) !== undefined);
		tick(r);
		expect([g.status, g.events.skipped, g.seen]).toEqual([GoldenStatus.SKIPPED, 1, 0]);
	});
});

describe("golden: determinism (GE2)", () => {
	it("two runs with the same input hash identically every tick; the jink draws only its own stream", () => {
		const a = devRun();
		const b = devRun();
		enterRoom(a);
		enterRoom(b);
		let jinkDraws = 0;
		for (let k = 0; k < GOLDEN_APPEAR_TICKS + GOLDEN_ESCAPE_TICKS + 30; k++) {
			const ga = a.s.golden!;
			// Walk at the Goldling once it is out (jinks happen), else stand.
			let input = EMPTY_INPUT;
			if (ga.status === GoldenStatus.RUNNING) {
				const act = a.s.combat.actors[ga.actorSlot];
				const dx = act.x - a.s.player.x;
				const dz = act.z - a.s.player.z;
				const len = math.sqrt(dx * dx + dz * dz);
				if (len > 1e-6) input = frame(dx / len, dz / len);
			}
			const before = ga.rngState;
			tick(a, input);
			tick(b, input);
			if (ga.rngState !== before) jinkDraws++;
			expect(hashState(a.s)).toBe(hashState(b.s));
		}
		expect(jinkDraws).toBeGreaterThan(0);
	});

	it("the flee field cache is a pure function of hashed state: dropping it every tick changes nothing", () => {
		const a = devRun();
		const b = devRun();
		enterRoom(a);
		enterRoom(b);
		for (let k = 0; k < GOLDEN_APPEAR_TICKS + 200; k++) {
			const g = b.s.golden!;
			g.cache.fieldTick = -1;
			g.cache.scratch = undefined;
			g.cache.floor = undefined;
			tick(a);
			tick(b);
			expect(hashState(a.s)).toBe(hashState(b.s));
		}
		expect(a.s.golden!.status).toBe(GoldenStatus.RUNNING);
	});

	it("the main rng and the drops' stream never move for it: a no-golden twin draws the same, tick by tick", () => {
		const on = devRun(true);
		const off = devRun(false);
		enterRoom(on);
		enterRoom(off);
		for (let k = 0; k < GOLDEN_APPEAR_TICKS + GOLDEN_ESCAPE_TICKS + 30; k++) {
			const g = on.s.golden!;
			let input = EMPTY_INPUT;
			if (g.status === GoldenStatus.RUNNING) {
				const act = on.s.combat.actors[g.actorSlot];
				const dx = act.x - on.s.player.x;
				const dz = act.z - on.s.player.z;
				const len = math.sqrt(dx * dx + dz * dz);
				if (len > 1e-6) input = frame(dx / len, dz / len);
			}
			tick(on, input);
			tick(off, input);
			expect([k, on.s.rngState, on.s.drops!.rngState]).toEqual([k, off.s.rngState, off.s.drops!.rngState]);
		}
		expect(on.s.golden!.status).toBe(GoldenStatus.ESCAPED);
	});

	it("a floor change while it runs: gone (freed with the floor), the next floor's own room or none", () => {
		const r = devRun();
		enterRoom(r);
		untilOut(r);
		const g = r.s.golden!;
		const slot = g.actorSlot;
		const id = g.actorId;
		tick(r, frame(0, 0, DEBUG_FLOOR_BUTTON));
		expect(r.s.endless!.floor).toBe(FLOOR + 1);
		expect(r.s.combat.actors[slot].id).never.toBe(id);
		const nextFloorGolden = r.config.endless!.worldForFloor(FLOOR + 1).golden;
		expect([g.status, g.room, g.actorSlot, g.coins, g.hits, g.fieldTick, g.src.size()]).toEqual([
			nextFloorGolden !== undefined ? GoldenStatus.WAITING : GoldenStatus.NONE,
			nextFloorGolden !== undefined ? nextFloorGolden.room : -1,
			-1,
			0,
			0,
			-1,
			0,
		]);
		expect([g.seen, g.escaped, g.caught]).toEqual([1, 0, 0]);
	});
});
