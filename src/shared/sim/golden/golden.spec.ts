// The Goldling in the sim (docs/FORTUNE.md GE2; docs/GOLDLING_RUMOURS.md GR2 / GR3): opt-in state and its hash group
// (last, releaseTick / piece at its end), the floor fill (WAITING with its piece's slot), hidden in its own barrel or
// crate until a PLAYER breaks it (a sword swing, an arrow, a roll smash, a build effect), then out on the break tick at
// the piece's cell centre; enemy sources (enemy bullets, the slam, a Bomber's blast, a Charger's charge radius) never
// touch that piece; no loot in it; SKIPPED on a full pool; not a room member (the room clears without it, and it stays
// hidden after the clear); a floor change while hidden or out; kept inside its room while it flees, a cornered
// Goldling getting out, the jink drawing only its own stream, the escape at escapeTicks, bit-identical replays (a
// recorded walk-and-swing release too) and a field cache that is a pure function of hashed state, and nothing at all
// without the config. Test-only surgery: teleports, kills through SimCtx, direct damage calls.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { FloorModifier, GOLDEN_PLACE, cellKey, gridToWorld, worldToGrid } from "shared/dungeon";
import {
	BOMBER,
	BulletKind,
	Button,
	BreakableSource,
	CHARGER,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN,
	GOLDEN_ESCAPE_TICKS,
	GOLDEN_HASH_TAIL_FIELDS,
	GOLDEN_HP,
	GOLDEN_JINK,
	GOLDEN_KIND,
	GOLDEN_RUN,
	GOLDEN_SIM_SALT,
	GOLDEN_SUBSYSTEM,
	GOLDEN_TICKS_LEFT,
	GoldenStatus,
	NOT_BROKEN,
	NO_BOOST,
	NO_KIND,
	PACTS_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	TREASURE_SUBSYSTEM,
	PORT_BAND_FORTUNE,
	ScoreSource,
	SimCtx,
	archetypeIds,
	archetypeIndex,
	cloneSimState,
	createSimState,
	damageBreakable,
	fireBurstRaw,
	goldenGuardsPiece,
	goldenInRoom,
	goldenPieceAt,
	goldenPieceCentre,
	goldenSeedState,
	hashLayout,
	hashState,
	isWarbannerAuraTarget,
	packPayload,
	rollSmashBreakables,
	runReplay,
	seedToState,
	simWorldConfig,
	slamBreakables,
	step,
	webArchetypeIds,
	writeHashFields,
	type ActorState,
	type BreakableSourceId,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, type EndlessRunFloor, type EndlessRunSetup } from "shared/run";
import { Driver, frame } from "shared/run/testing";

/**
 * The first (run seed, floor) from floor 2 whose floor rolled a Goldling. A Gilded floor's (docs/FLOOR_MODIFIERS.md FM3:
 * seed 1 floor 3 since the modifiers) is skipped, so the scenes stay the natural roll's room they were written on.
 */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 4; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.golden !== undefined && w.modifier !== FloorModifier.GILDED) return [seed, floor];
		}
	}
	error("no Goldling floor in run seeds 1-60, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly world: EndlessRunFloor;
}

/** A god-mode dev run of SEED from FLOOR, with the Goldling config on (or off); the Archer's bow with `archer`. */
function devRun(golden = true, archer = false): Run {
	const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true }, undefined, archer ? ["archer"] : []);
	// Without secret rooms (docs/SECRET_ROOMS.md SR5: their group would follow the Goldling's, last), nor Silver in
	// crates (docs/SILVER.md SC2: its group would follow theirs).
	const config: SimConfig = {
		...dev.config,
		golden: golden ? ENDLESS_GOLDEN_CONFIG : undefined,
		secrets: undefined,
		silver: undefined,
	};
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

/** The Goldling's piece: its slot, grid cell and world centre. */
function pieceOf(r: Run): { slot: number; gx: number; gy: number; x: number; z: number } {
	const g = r.world.golden!;
	return { slot: g.piece, gx: g.pieceX, gy: g.pieceY, x: gridToWorld(g.pieceX), z: gridToWorld(g.pieceY) };
}

/**
 * A stand cell `dist` cells straight off the piece (4 directions in order) whose cells up to the piece are open floor
 * of the room (walk mask, no piece): the stand's world centre and the unit direction to the piece. Falls back to 1.
 */
function standBy(r: Run, dist: number): { x: number; z: number; dx: number; dz: number } {
	const g = r.world.golden!;
	const solid = new Set<number>();
	for (const b of r.world.breakables ?? []) solid.add(cellKey(b.x, b.y));
	const open = (gx: number, gy: number) => {
		const lx = gx - g.x0;
		const ly = gy - g.y0;
		if (lx < 0 || ly < 0 || lx >= g.w || ly >= g.h) return false;
		return g.walk[ly * g.w + lx] === 1 && !solid.has(cellKey(gx, gy));
	};
	for (const want of [dist, 1])
		for (const [ox, oy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			let ok = true;
			for (let k = 1; k <= want && ok; k++) ok = open(g.pieceX + ox * k, g.pieceY + oy * k);
			if (ok)
				return {
					x: gridToWorld(g.pieceX + ox * want),
					z: gridToWorld(g.pieceY + oy * want),
					dx: -ox,
					dz: -oy,
				};
		}
	error("no open cell beside the Goldling's piece", 0);
}

/** Breaks the Goldling's piece (test surgery, `source` credited to player 0) and steps once: it comes out. */
function release(r: Run, source: BreakableSourceId = BreakableSource.MELEE): number {
	const p = pieceOf(r);
	const piece = r.s.breakables!.pieces[p.slot];
	const at = r.s.tick;
	expect(damageBreakable(r.s, p.slot, piece.hp, source, 0)).toBe(true);
	expect(r.s.golden!.releaseTick).toBe(at);
	tick(r);
	return at;
}

/** Engages the room, then breaks the piece open: the Goldling is out (RUNNING). */
function untilOut(r: Run): void {
	enterRoom(r);
	release(r);
	expect(r.s.golden!.status).toBe(GoldenStatus.RUNNING);
}

/** It came out on tick `at`, at the piece's cell centre: RUNNING, seen + 1, events.appeared, appearTick = at. */
function expectOutAt(r: Run, at: number): void {
	const g = r.s.golden!;
	const p = pieceOf(r);
	expect([g.status, g.releaseTick, g.appearTick, g.events.appeared, g.seen]).toEqual([
		GoldenStatus.RUNNING,
		at,
		at,
		1,
		1,
	]);
	const a = goldenActor(r.s);
	expect([a.x, a.z, a.spawnTick]).toEqual([p.x, p.z, at]);
	expect(goldenPieceCentre(g)).toEqual({ x: p.x, z: p.z });
	expect(r.s.breakables!.pieces[p.slot].brokenTick).toBe(at);
	expect(goldenPieceAt(r.s, p.slot)).toBe(false);
	expect([a.aiState, a.v[GOLDEN_TICKS_LEFT], a.hp]).toEqual([GOLDEN_RUN, GOLDEN_ESCAPE_TICKS, a.hpMax]);
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
		// RD8 (a): the 10 s window stays; the appear delay is gone (it comes out of its piece, RD10).
		expect(ENDLESS_GOLDEN_CONFIG.escapeTicks).toBe(600);
		expect((ENDLESS_GOLDEN_CONFIG as unknown as { appearTicks?: number }).appearTicks).toBe(undefined);
		// The plan's re-relax factor (GE4 measured 1.2 / 2 / 3: the catch rate barely moves, so the plan's stays).
		expect(ENDLESS_GOLDEN_CONFIG.fleeFactor).toBe(1.2);
		expect(GOLDEN_ESCAPE_TICKS).toBe(600);
	});

	it("absent config: no golden state, no golden group; its piece is an ordinary piece (enemy damage lands)", () => {
		const off = devRun(false);
		expect(off.s.golden).toBe(undefined);
		const layout = hashLayout(off.s, true);
		expect(layout.groups.map((gr) => gr.name).includes(GOLDEN_SUBSYSTEM)).toBe(false);
		// Pacts (docs/FORTUNE.md PS5: the dev world sets them too) stay the last group, after pellets and treasure
		// (docs/TREASURE.md TR5).
		expect(layout.groups[layout.groups.size() - 1].name).toBe(PACTS_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 2].name).toBe(TREASURE_SUBSYSTEM);
		expect(layout.groups[layout.groups.size() - 3].name).toBe(PELLETS_SUBSYSTEM);
		// The floor still has the piece (floor data), but nothing guards it.
		const p = pieceOf(off);
		expect(off.s.breakables!.pieces.size()).toBe(p.slot + 1);
		expect([goldenGuardsPiece(off.s, p.slot), goldenPieceAt(off.s, p.slot)]).toEqual([false, false]);
		damageBreakable(off.s, p.slot, 1, BreakableSource.ENEMY_BULLET);
		expect(off.s.breakables!.hitSlots).toEqual([p.slot]);
	});

	it("present: the golden group is last (after pellets, treasure, pacts), releaseTick / piece at its end, = writeHashFields; WAITING on its floor", () => {
		const r = devRun();
		const g = r.s.golden!;
		expect([g.status, g.room, g.floor, g.piece, g.releaseTick]).toEqual([
			GoldenStatus.WAITING,
			r.world.golden!.room,
			r.world.golden,
			r.world.golden!.piece,
			-1,
		]);
		expect(r.s.score!.rooms[g.record].room).toBe(g.room);
		const layout = hashLayout(r.s, true);
		const names = layout.groups.map((gr) => gr.name);
		expect([
			names[names.size() - 4],
			names[names.size() - 3],
			names[names.size() - 2],
			names[names.size() - 1],
		]).toEqual([PELLETS_SUBSYSTEM, TREASURE_SUBSYSTEM, PACTS_SUBSYSTEM, GOLDEN_SUBSYSTEM]);
		expect(layout.names.size()).toBe(layout.values.size());
		const last = layout.groups[layout.groups.size() - 1];
		expect(layout.names[last.start]).toBe("golden.rngState");
		expect([...GOLDEN_HASH_TAIL_FIELDS]).toEqual(["releaseTick", "piece"]);
		expect([layout.names[last.finish - 3], layout.names[last.finish - 2], layout.names[last.finish - 1]]).toEqual([
			"golden.src.length",
			"golden.releaseTick",
			"golden.piece",
		]);
		expect([layout.values[last.finish - 2], layout.values[last.finish - 1]]).toEqual([-1, g.piece]);
		expect(layout.values).toEqual(writeHashFields(r.s, []));
		// The hash sees both: a release (surgery) and the piece slot change it.
		const twin = cloneSimState(r.s);
		expect([twin.golden!.releaseTick, twin.golden!.piece]).toEqual([-1, g.piece]);
		twin.golden!.releaseTick = 5;
		expect(hashState(twin)).never.toBe(hashState(r.s));
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

describe("golden: hidden in its piece, released by a player (GR2)", () => {
	it("WAITING in its own barrel or crate: the floor's last piece, intact, glinting (goldenPieceAt) on that slot only", () => {
		const r = devRun();
		const g = r.s.golden!;
		const p = pieceOf(r);
		const b = r.s.breakables!;
		expect(b.pieces.size()).toBe(p.slot + 1);
		const piece = b.pieces[p.slot];
		expect([piece.x, piece.y, piece.brokenTick]).toEqual([p.gx, p.gy, NOT_BROKEN]);
		expect(r.world.golden!.pieceKind === "barrel" ? piece.kind === 0 : piece.kind === 1).toBe(true);
		for (let i = 0; i < b.pieces.size(); i++) {
			expect([i, goldenPieceAt(r.s, i)]).toEqual([i, i === p.slot]);
			expect([i, goldenGuardsPiece(r.s, i)]).toEqual([i, i === p.slot]);
		}
		expect([g.releaseTick, g.appearTick, g.engageTick]).toEqual([-1, -1, -1]);
	});

	it("no appearance before the break: the room engages (engageTick latched) and fights 20 s, it stays hidden", () => {
		const r = devRun();
		const engaged = enterRoom(r);
		const g = r.s.golden!;
		expect(g.engageTick).toBe(engaged);
		const kind = archetypeIndex(GOLDEN_KIND);
		for (let k = 0; k < 1200; k++) {
			tick(r);
			expect(g.status).toBe(GoldenStatus.WAITING);
		}
		expect([g.engageTick, g.releaseTick, g.appearTick, g.seen, g.events.appeared]).toEqual([engaged, -1, -1, 0, 0]);
		for (const a of r.s.combat.actors) expect(a.kind === kind).toBe(false);
		expect(goldenPieceAt(r.s, g.piece)).toBe(true);
	});

	it("a sword swing breaks it open: out on the break tick at the cell centre, the break scored like any piece", () => {
		const r = devRun();
		const p = pieceOf(r);
		const by = standBy(r, 1);
		place(r.s, by.x, by.z);
		const piece = r.s.breakables!.pieces[p.slot];
		const counts0 = r.s.score!.counts[ScoreSource.BREAKABLES];
		for (let k = 0; k < 120 && piece.brokenTick === NOT_BROKEN; k++)
			tick(r, frame(0, 0, Button.FIRE, by.dx, by.dz));
		expect(piece.brokenTick).never.toBe(NOT_BROKEN);
		expectOutAt(r, piece.brokenTick);
		expect(r.s.score!.counts[ScoreSource.BREAKABLES]).toBe(counts0 + 1);
	});

	it("an arrow (the Archer's bow) breaks it open the same way", () => {
		const r = devRun(true, true);
		const p = pieceOf(r);
		const by = standBy(r, 2);
		place(r.s, by.x, by.z);
		const piece = r.s.breakables!.pieces[p.slot];
		let bulletHits = 0;
		for (let k = 0; k < 600 && piece.brokenTick === NOT_BROKEN; k++) {
			tick(r, frame(0, 0, Button.FIRE, by.dx, by.dz));
			bulletHits += r.s.breakables!.hitSlots.filter((x) => x === p.slot).size();
		}
		expect(piece.brokenTick).never.toBe(NOT_BROKEN);
		expect(bulletHits).toBeGreaterThan(0);
		expectOutAt(r, piece.brokenTick);
	});

	it("a roll smash (Wrecker's ROLL) and a build effect (BUILD) break it open too", () => {
		const roll = devRun();
		const p = pieceOf(roll);
		const by = standBy(roll, 1);
		place(roll.s, by.x, by.z);
		const at = roll.s.tick;
		expect(rollSmashBreakables(roll.s, 0, by.x, by.z, by.dx, by.dz)).toBeGreaterThanOrEqual(1);
		expect(roll.s.breakables!.pieces[p.slot].brokenTick).toBe(at);
		tick(roll);
		expectOutAt(roll, at);
		const build = devRun();
		const bAt = release(build, BreakableSource.BUILD);
		expectOutAt(build, bAt);
	});

	it("enemy sources never damage it: enemy bullets, the slam, a Bomber's blast and a Charger's radius; a player still can", () => {
		const r = devRun();
		const p = pieceOf(r);
		const b = r.s.breakables!;
		const piece = b.pieces[p.slot];
		const hp = piece.hp;
		const ev0 = [r.s.events.breakableHits, r.s.events.breakablesBroken];
		for (const src of [BreakableSource.ENEMY_BULLET, BreakableSource.SLAM])
			expect(damageBreakable(r.s, p.slot, 1e6, src)).toBe(false);
		expect([r.s.events.breakableHits, r.s.events.breakablesBroken]).toEqual(ev0);
		expect([b.hitSlots.includes(p.slot), b.brokenSlots.includes(p.slot)]).toEqual([false, false]);
		// The slam (boss radius), a Bomber's blast and a Charger's charge pass, all centred on the piece.
		slamBreakables(r.s, p.x, p.z);
		slamBreakables(r.s, p.x, p.z, BOMBER.data.blastBreakRadius);
		slamBreakables(r.s, p.x, p.z, CHARGER.data.radius + CHARGER.data.chargeBreakRadius + 1);
		expect([piece.hp, piece.brokenTick, b.slotByCell.get(cellKey(p.gx, p.gy))]).toEqual([hp, NOT_BROKEN, p.slot]);
		// Real enemy bullets fired at it from 2 cells off: stopped there (it still shields), no damage.
		// (the player stays at the floor's entrance, out of the room)
		const by = standBy(r, 2);
		const em = r.s.combat.enemyBullets.acquireEmitter();
		r.s.combat.enemyEmitters += 1;
		const payload = packPayload(1, BulletKind.ENEMY, 1);
		for (let shot = 0; shot < 12; shot++) {
			r.s.combat.enemySpawned += fireBurstRaw(
				r.s.combat.enemyBullets,
				em,
				by.x,
				by.z,
				by.dx,
				by.dz,
				1,
				0,
				6,
				2,
				payload,
			);
			for (let k = 0; k < 20; k++) {
				tick(r);
				expect(b.hitSlots.includes(p.slot)).toBe(false);
			}
		}
		expect([piece.hp, piece.brokenTick, r.s.golden!.status]).toEqual([hp, NOT_BROKEN, GoldenStatus.WAITING]);
		// The same enemy damage on an ordinary piece lands.
		const other = b.pieces.findIndex((q, i) => i !== p.slot && q.brokenTick === NOT_BROKEN && q.kind !== 2);
		if (other >= 0) {
			damageBreakable(r.s, other, 1, BreakableSource.ENEMY_BULLET);
			expect(b.hitSlots.includes(other)).toBe(true);
		}
		// A player's break still releases it.
		const at = release(r);
		expectOutAt(r, at);
	});

	it("it never holds loot: its slot is NO_BOOST, every loot slot is earlier, its break drops nothing", () => {
		const r = devRun();
		const p = pieceOf(r);
		const d = r.s.drops!;
		expect(d.pieceLoot.size()).toBe(p.slot + 1);
		expect(d.pieceLoot[p.slot]).toBe(NO_BOOST);
		for (const l of r.world.breakableLoot ?? []) expect(l.slot < p.slot).toBe(true);
		const ground0 = d.ground.map((x) => x.kind);
		const piece = r.s.breakables!.pieces[p.slot];
		damageBreakable(r.s, p.slot, piece.hp, BreakableSource.MELEE, 0);
		expect([d.events.fromPiece.size(), d.events.lostLoot.size()]).toEqual([0, 0]);
		expect(d.ground.map((x) => x.kind)).toEqual(ground0);
	});

	it("another piece's break releases nothing", () => {
		const r = devRun();
		const p = pieceOf(r);
		const b = r.s.breakables!;
		const other = b.pieces.findIndex((q, i) => i !== p.slot && q.kind !== 2);
		expect(other >= 0).toBe(true);
		damageBreakable(r.s, other, 1e6, BreakableSource.MELEE, 0);
		tick(r);
		expect([r.s.golden!.status, r.s.golden!.releaseTick]).toEqual([GoldenStatus.WAITING, -1]);
	});

	it("a full pool skips it: never appears, SKIPPED", () => {
		const r = devRun();
		enterRoom(r);
		const g = r.s.golden!;
		// Fill every free slot with corpses-to-be: spawn dummies until the pool is full (test surgery).
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		while (ctx.spawnActor("dummy", 0, 0) !== undefined);
		const at = release(r);
		expect([g.status, g.events.skipped, g.seen, g.releaseTick, g.appearTick]).toEqual([
			GoldenStatus.SKIPPED,
			1,
			0,
			at,
			-1,
		]);
	});

	it("the room clears without it: still hidden after the clear, and breaking the piece then lets it run", () => {
		const r = devRun();
		enterRoom(r);
		const g = r.s.golden!;
		const rec = r.s.score!.rooms[g.record];
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		for (let k = 0; k < 20 && rec.cleared === 0; k++) {
			for (let m = 0; m < rec.memberSlots.size(); m++) {
				const a = r.s.combat.actors[rec.memberSlots[m]];
				if (a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) ctx.killActor(a);
			}
			tick(r);
		}
		expect(rec.cleared).toBe(1);
		for (let k = 0; k < 300; k++) tick(r);
		expect([g.status, goldenPieceAt(r.s, g.piece)]).toEqual([GoldenStatus.WAITING, true]);
		const at = release(r);
		expectOutAt(r, at);
		expect(rec.memberIds.includes(g.actorId)).toBe(false);
	});

	it("a floor change while hidden: gone with its piece, no counters; the next floor's own Goldling or none", () => {
		const r = devRun();
		enterRoom(r);
		const g = r.s.golden!;
		tick(r, frame(0, 0, DEBUG_FLOOR_BUTTON));
		expect(r.s.endless!.floor).toBe(FLOOR + 1);
		const nextGolden = r.config.endless!.worldForFloor(FLOOR + 1).golden;
		expect([g.status, g.room, g.piece, g.releaseTick, g.appearTick, g.engageTick]).toEqual([
			nextGolden !== undefined ? GoldenStatus.WAITING : GoldenStatus.NONE,
			nextGolden !== undefined ? nextGolden.room : -1,
			nextGolden !== undefined ? nextGolden.piece : -1,
			-1,
			-1,
			-1,
		]);
		expect([g.seen, g.escaped, g.caught]).toEqual([0, 0, 0]);
	});
});

describe("golden: running, room, escape (GE2)", () => {
	it("is not a member of its room's record: the room clears without it, and it keeps running", () => {
		const r = devRun();
		untilOut(r);
		const g = r.s.golden!;
		const rec = r.s.score!.rooms[g.record];
		expect(rec.memberIds.includes(g.actorId)).toBe(false);
		for (const rr of r.s.score!.rooms) expect(rr.memberIds.includes(g.actorId)).toBe(false);
		const ctx = new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
		// Several passes: an Ooze's slimelets join the room when it dies (which kinds the room holds is the run's
		// roster, docs/DAILY.md DSD18).
		for (let pass = 0; pass < 8; pass++) {
			let killed = 0;
			for (let m = 0; m < rec.memberSlots.size(); m++) {
				const a = r.s.combat.actors[rec.memberSlots[m]];
				if (a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) {
					ctx.killActor(a);
					killed++;
				}
			}
			if (killed === 0) break;
		}
		tick(r);
		expect(rec.cleared).toBe(1);
		expect(g.status).toBe(GoldenStatus.RUNNING);
		expect(goldenActor(r.s).alive).toBe(1);
	});

	it("flees inside its room (never a doorway or corridor), escapes exactly escapeTicks after appearing", () => {
		const r = devRun();
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
});

/** Released this many ticks after the room engages in the determinism runs. */
const RELEASE_AFTER = 90;

describe("golden: determinism (GE2, GR2)", () => {
	it("two runs with the same input hash identically every tick; the jink draws only its own stream", () => {
		const a = devRun();
		const b = devRun();
		enterRoom(a);
		enterRoom(b);
		let jinkDraws = 0;
		for (let k = 0; k < RELEASE_AFTER + GOLDEN_ESCAPE_TICKS + 30; k++) {
			if (k === RELEASE_AFTER) {
				release(a);
				release(b);
			}
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

	it("a recorded honest run (walk to the piece, swing it open, chase) replays bit-identically", () => {
		const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true });
		const drv = new Driver(dev as EndlessRunSetup, SEED);
		const g = drv.state.golden!;
		const r: Run = { config: dev.config, s: drv.state, world: buildEndlessRunConfig(SEED).endlessFloor(FLOOR) };
		const by = standBy(r, 1);
		drv.walkTo(
			by.x,
			by.z,
			() => {
				const p = drv.state.player;
				return math.abs(p.x - by.x) + math.abs(p.z - by.z) < 0.3 || g.releaseTick >= 0;
			},
			4000,
		);
		for (let k = 0; k < 200 && g.releaseTick < 0; k++) drv.tick(frame(0, 0, Button.FIRE, by.dx, by.dz));
		expect(g.releaseTick >= 0).toBe(true);
		for (let k = 0; k < 120; k++) drv.tick(frame(0, 0, Button.FIRE, by.dx, by.dz));
		expect(g.status === GoldenStatus.RUNNING || g.status === GoldenStatus.CAUGHT).toBe(true);
		const replayed = runReplay(drv.recorder.getRecording(), dev.config);
		expect(hashState(replayed)).toBe(hashState(drv.state));
		expect([replayed.golden!.releaseTick, replayed.golden!.appearTick]).toEqual([g.releaseTick, g.appearTick]);
	});

	it("a clone taken while it hides steps exactly as the original through the release", () => {
		const a = devRun();
		enterRoom(a);
		for (let k = 0; k < 30; k++) tick(a);
		const b: Run = { config: a.config, s: cloneSimState(a.s), world: a.world };
		expect(hashState(b.s)).toBe(hashState(a.s));
		release(a);
		release(b);
		for (let k = 0; k < 120; k++) {
			tick(a);
			tick(b);
			expect(hashState(a.s)).toBe(hashState(b.s));
		}
	});

	it("the flee field cache is a pure function of hashed state: dropping it every tick changes nothing", () => {
		const a = devRun();
		const b = devRun();
		untilOut(a);
		untilOut(b);
		for (let k = 0; k < 200; k++) {
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
		for (let k = 0; k < RELEASE_AFTER + GOLDEN_ESCAPE_TICKS + 30; k++) {
			if (k === RELEASE_AFTER) {
				// The same break in both (the twin's piece is an ordinary one).
				for (const r of [on, off]) {
					const p = pieceOf(r);
					damageBreakable(r.s, p.slot, r.s.breakables!.pieces[p.slot].hp, BreakableSource.MELEE, 0);
				}
			}
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
		untilOut(r);
		const g = r.s.golden!;
		const slot = g.actorSlot;
		const id = g.actorId;
		tick(r, frame(0, 0, DEBUG_FLOOR_BUTTON));
		expect(r.s.endless!.floor).toBe(FLOOR + 1);
		expect(r.s.combat.actors[slot].id).never.toBe(id);
		const nextFloorGolden = r.config.endless!.worldForFloor(FLOOR + 1).golden;
		expect([g.status, g.room, g.actorSlot, g.coins, g.hits, g.fieldTick, g.src.size(), g.releaseTick]).toEqual([
			nextFloorGolden !== undefined ? GoldenStatus.WAITING : GoldenStatus.NONE,
			nextFloorGolden !== undefined ? nextFloorGolden.room : -1,
			-1,
			0,
			0,
			-1,
			0,
			-1,
		]);
		expect([g.seen, g.escaped, g.caught]).toEqual([1, 0, 0]);
	});
});
