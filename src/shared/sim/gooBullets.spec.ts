// docs/ENEMY_VARIANTS.md EV1 (EVD13 / EVD14): goo puddles, BulletKind.GOO. Fired through ctx.fireEnemy from a test
// archetype (shared/sim/testing's test.dummy), the way the Ooze will fire them:
//   - hit radius by kind: GOO hits at GOO_BULLET_RADIUS, every other kind exactly at ENEMY_BULLET_RADIUS;
//   - never grazes (no graze points, no combo, no feed), solo and co-op;
//   - a sword guard erases it without guard points, the parry feed or events.bulletsDeleted;
//   - an ordinary sword swing does NOT erase it;
//   - it counts in events.gooSpawned (the enemy-shoot sound skips it) and in combat.enemySpawned.
// Breakables (goo neither damages nor is stopped by a piece) are in breakables/breakables.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TEST_DUMMY } from "shared/sim/testing";
import {
	BulletKind,
	BulletPayload,
	Button,
	COMBO_MIN,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	ENEMY_BULLET_RADIUS,
	GOO_BULLET_RADIUS,
	GUARD_CANCEL_POINTS,
	HIT_NORMAL,
	START_HALF_HEARTS,
	ScoreSource,
	SimCtx,
	archetypeAt,
	createSimState,
	enemyBulletHitRadius,
	playerAt,
	step,
	stepParty,
	sweepGooErased,
	type ActorState,
	type BurstSpec,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const ENCOUNTER = { spawns: [{ kind: TEST_DUMMY.id, x: 5, z: -5 }], rooms: [], entranceRoom: -1, bossRoom: -1 };
const SCORED: SimConfig = { ...DEFAULT_SIM_CONFIG, scoring: {}, encounter: ENCOUNTER };
const DUO: SimConfig = { ...DEFAULT_SIM_CONFIG, party: { size: 2 }, scoring: { partySize: 2 }, encounter: ENCOUNTER };
const IDLE: InputFrame = { ...EMPTY_INPUT };
const GUARD: InputFrame = { ...EMPTY_INPUT, buttons: Button.ALT };
const SWING: InputFrame = { ...EMPTY_INPUT, buttons: Button.FIRE };

/** A stationary puddle (the Ooze's shape: speed 0, 3 s). */
const PUDDLE: BurstSpec = { count: 1, spread: 0, speed: 0, life: 3, damage: HIT_NORMAL, kind: BulletKind.GOO };
const STILL_SHOT: BurstSpec = { ...PUDDLE, kind: BulletKind.SNIPER };
/** Moving versions (a graze needs a bullet that passes the player). */
const MOVING_GOO: BurstSpec = { ...PUDDLE, speed: 6 };
const MOVING_SHOT: BurstSpec = { ...MOVING_GOO, kind: BulletKind.SNIPER };

function dummyOf(s: SimState): ActorState {
	for (const a of s.combat.actors) if (a.kind >= 0 && archetypeAt(a.kind).id === TEST_DUMMY.id) return a;
	return error("no test.dummy");
}

/** The test dummy fires `spec` from (x, z) toward +Z through ctx.fireEnemy. Returns the bullets spawned. */
function fire(s: SimState, config: SimConfig, spec: BurstSpec, x: number, z: number): number {
	return new SimCtx().bind(s, config, EMPTY_INPUT).fireEnemy(dummyOf(s), 0, 1, spec, x, z);
}

function kinds(s: SimState): number[] {
	const out: number[] = [];
	s.combat.enemyBullets.forEachActive((_i, _pos, payload) => {
		out.push(BulletPayload.get(payload, "kind"));
		return false;
	});
	return out;
}

function placePlayer(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

describe("goo: hit radius by kind (EVD13)", () => {
	it("GOO hits at GOO_BULLET_RADIUS; every other kind exactly at ENEMY_BULLET_RADIUS", () => {
		expect(GOO_BULLET_RADIUS).toBe(0.35);
		expect(BulletKind.GOO).toBe(7);
		for (let k = 0; k < BulletKind.GOO; k++) expect(enemyBulletHitRadius(k)).toBe(ENEMY_BULLET_RADIUS);
		expect(enemyBulletHitRadius(BulletKind.GOO)).toBe(GOO_BULLET_RADIUS);
	});

	it("solo: a puddle 0.6 from the player hits; a still bullet there does not; a puddle 0.75 away does not", () => {
		const goo = createSimState(1, 0, 0, SCORED);
		fire(goo, SCORED, PUDDLE, 0.6, 0);
		for (let t = 0; t < 10; t++) step(goo, IDLE, SCORED);
		expect(goo.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		expect(goo.combat.enemyBullets.activeCount).toBe(0); // consumed by the hit

		const shot = createSimState(1, 0, 0, SCORED);
		fire(shot, SCORED, STILL_SHOT, 0.6, 0);
		for (let t = 0; t < 10; t++) step(shot, IDLE, SCORED);
		expect(shot.player.hearts).toBe(START_HALF_HEARTS);

		const far = createSimState(1, 0, 0, SCORED);
		fire(far, SCORED, PUDDLE, 0.75, 0);
		for (let t = 0; t < 10; t++) step(far, IDLE, SCORED);
		expect(far.player.hearts).toBe(START_HALF_HEARTS);
	});

	it("co-op: the puddle's radius applies to every player", () => {
		const s = createSimState(1, 0, 0, DUO);
		placePlayer(s, 0, -4, -4);
		placePlayer(s, 1, 0, 0);
		fire(s, DUO, PUDDLE, 0.6, 0);
		for (let t = 0; t < 10; t++) stepParty(s, [IDLE, IDLE], DUO);
		expect(playerAt(s, 1).hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		expect(playerAt(s, 0).hearts).toBe(START_HALF_HEARTS);
	});
});

describe("goo: no grazes (EVD14)", () => {
	it("solo: a bullet passing 0.8 away grazes; goo on the same line scores, feeds and reports nothing", () => {
		const shot = createSimState(1, 0, 0, SCORED);
		fire(shot, SCORED, MOVING_SHOT, 0.8, -5);
		for (let t = 0; t < 150; t++) step(shot, IDLE, SCORED);
		expect(shot.score!.counts[ScoreSource.GRAZES]).toBe(1);

		const goo = createSimState(1, 0, 0, SCORED);
		fire(goo, SCORED, MOVING_GOO, 0.8, -5);
		let feed = 0;
		for (let t = 0; t < 150; t++) {
			step(goo, IDLE, SCORED);
			feed += goo.score!.events.grazeX.size() + goo.score!.events.grazes;
		}
		expect(goo.score!.counts[ScoreSource.GRAZES]).toBe(0);
		expect(goo.score!.points[ScoreSource.GRAZES]).toBe(0);
		expect(goo.score!.combo).toBe(COMBO_MIN);
		expect(feed).toBe(0);
		expect(goo.player.hearts).toBe(START_HALF_HEARTS);
	});

	it("co-op: goo grazes no player either", () => {
		const s = createSimState(1, 0, 0, DUO);
		placePlayer(s, 0, 0, 0);
		placePlayer(s, 1, 4, 0);
		fire(s, DUO, MOVING_GOO, 0.8, -5);
		for (let t = 0; t < 150; t++) stepParty(s, [IDLE, IDLE], DUO);
		expect(s.score!.counts[ScoreSource.GRAZES]).toBe(0);
	});
});

/** Two still bullets and one puddle in front of the player at the origin (default facing +X +Z), inside reach. */
function mixedInFront(s: SimState): void {
	fire(s, SCORED, STILL_SHOT, 0.7, 0.7);
	fire(s, SCORED, STILL_SHOT, 0.8, 0.6);
	fire(s, SCORED, PUDDLE, 0.6, 0.8);
}

describe("goo vs the sword (EVD14)", () => {
	it("a guard erases goo with no guard points, no parry feed and no bulletsDeleted", () => {
		const s = createSimState(1, 0, 0, SCORED);
		fire(s, SCORED, PUDDLE, 0.7, 0.7);
		fire(s, SCORED, PUDDLE, 0.6, 0.8);
		step(s, GUARD, SCORED);
		const e = s.score!.events;
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		expect(sweepGooErased()).toBe(2);
		expect(e.guardCancels).toBe(0);
		expect([e.guardX.size(), e.guardZ.size(), e.guardPlayer.size()]).toEqual([0, 0, 0]);
		expect(s.score!.points[ScoreSource.GUARD]).toBe(0);
		expect(s.events.bulletsDeleted).toBe(0);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
	});

	it("a guard over goo and bullets scores and reports the bullets only", () => {
		const s = createSimState(1, 0, 0, SCORED);
		mixedInFront(s);
		step(s, GUARD, SCORED);
		const e = s.score!.events;
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		expect(e.guardCancels).toBe(2);
		expect([e.guardX.size(), e.guardPlayer.size()]).toEqual([2, 2]);
		expect(s.score!.points[ScoreSource.GUARD]).toBe(2 * GUARD_CANCEL_POINTS);
		expect(s.events.bulletsDeleted).toBe(2);
	});

	it("an ordinary swing erases the bullets but leaves the goo on the floor", () => {
		const s = createSimState(1, 0, 0, SCORED);
		mixedInFront(s);
		step(s, SWING, SCORED);
		expect(s.events.bulletsDeleted).toBe(2);
		expect(sweepGooErased()).toBe(0);
		expect(kinds(s)).toEqual([BulletKind.GOO]);
	});
});

describe("goo: the enemy-shoot cue's event (EVD14)", () => {
	it("fireEnemy counts goo in events.gooSpawned and combat.enemySpawned; other kinds only in enemySpawned", () => {
		const s = createSimState(1, 0, 0, SCORED);
		const before = s.combat.enemySpawned;
		expect(fire(s, SCORED, PUDDLE, 3, 3)).toBe(1);
		expect(s.events.gooSpawned).toBe(1);
		expect(s.combat.enemySpawned).toBe(before + 1);
		expect(fire(s, SCORED, STILL_SHOT, 3, 2)).toBe(1);
		expect(s.events.gooSpawned).toBe(1);
		expect(s.combat.enemySpawned).toBe(before + 2);
		step(s, IDLE, SCORED);
		expect(s.events.gooSpawned).toBe(0); // per tick, like every event
	});
});
