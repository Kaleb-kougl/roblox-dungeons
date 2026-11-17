// The Stormcaller and BulletKind.STRIKE (docs/NEW_ENEMIES.md NE5, NED7): the cast (one cooldown draw, the row fixed
// at cast start: centre = the target, offset = the bearing turned 90 degrees x 2.2), the strike (one STRIKE bullet per
// open point; wall / void / breakable points skipped, no draw; an all-skipped cast still spends its cooldown), and the
// STRIKE rules: one hit per player, roll i-frames avoid it, no grazes, no sweep erases it (the guard included), it
// breaks nothing and is not stopped by a piece, it holds 6 collision passes whatever the Hourglass does, and
// events.strikes (not the enemy-shoot cue). Goo is unchanged (gooBullets.spec, slime.spec). Determinism: real endless
// floors, solo and a party of two, replayed and pinned.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, cellKey, isBulletBlockingTile, lineOfSight, tileAt, worldToGrid } from "shared/dungeon";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";
import { TEST_DUMMY } from "shared/sim/testing";
import {
	AXIS_MAX,
	AiState,
	BREAKABLES_CONFIG,
	BulletKind,
	BulletPayload,
	Button,
	DEFAULT_BOUNDS,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	GRAZE_DONE_BIT,
	GRAZE_NEAR_BIT,
	HIT_NORMAL,
	PORT_BAND_ENEMIES_2,
	Rng,
	ROLL_IFRAME_TICKS,
	SIM_DT,
	SOLO_PLAYER,
	START_HALF_HEARTS,
	STATE_ENGAGED,
	STORMCALLER,
	STORMCALLER_ATTACK_CAST,
	STORMCALLER_CENTRE_X,
	STORMCALLER_CENTRE_Z,
	STORMCALLER_KEEP,
	STORMCALLER_OFFSET_X,
	STORMCALLER_OFFSET_Z,
	STORMCALLER_STRAFE,
	STORMCALLER_STRIKE_TICKS,
	STRIKE_BULLET_RADIUS,
	ScoreSource,
	SimCtx,
	V_HOME_X,
	V_HOME_Z,
	archetypeAt,
	archetypeIndex,
	createSimState,
	enemyBulletHitRadius,
	fireBurst,
	hashState,
	partySize,
	playerAt,
	solidCells,
	step,
	stepParty,
	sweepGooErased,
	type ActorSpawn,
	type ActorState,
	type BurstSpec,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const D = STORMCALLER.data;
const STRIKE = D.strike;
const enc = (spawns: ActorSpawn[]) => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });
const IDLE: InputFrame = { ...EMPTY_INPUT };
const GUARD: InputFrame = { ...EMPTY_INPUT, buttons: Button.ALT };
const SWING: InputFrame = { ...EMPTY_INPUT, buttons: Button.FIRE };
const ROLL: InputFrame = { ...EMPTY_INPUT, buttons: Button.ROLL };

/** Players can't be hurt (enemy bullets pass through them: consumed only when a hit lands). */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}
function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}
const d2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const casting = (a: Readonly<ActorState>): boolean =>
	a.alive === 1 && a.aiState === AiState.TELEGRAPH && a.attack === STORMCALLER_ATTACK_CAST;

interface Live {
	readonly slot: number;
	readonly x: number;
	readonly z: number;
	readonly kind: number;
	readonly payload: number;
}
function liveBullets(s: SimState): Live[] {
	const out: Live[] = [];
	s.combat.enemyBullets.forEachActive((slot, pos, payload) => {
		out.push({ slot, x: pos.x, z: pos.z, kind: BulletPayload.get(payload, "kind"), payload });
		return false;
	});
	return out;
}
/** The three points of the row in v[] (i order). */
function rowPoints(a: Readonly<ActorState>): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = [];
	const mid = (D.strikeCount - 1) / 2;
	for (let i = 0; i < D.strikeCount; i++) {
		const k = i - mid;
		out.push([
			a.v[STORMCALLER_CENTRE_X] + a.v[STORMCALLER_OFFSET_X] * k,
			a.v[STORMCALLER_CENTRE_Z] + a.v[STORMCALLER_OFFSET_Z] * k,
		]);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Direct fire (the goo spec's way): a test dummy fires the Stormcaller's own strike spec through ctx.fireEnemy.

const DUMMY_AT = enc([{ kind: TEST_DUMMY.id, x: 5, z: -5 }]);
const SCORED: SimConfig = { ...DEFAULT_SIM_CONFIG, scoring: {}, encounter: DUMMY_AT };
const DUO: SimConfig = { ...DEFAULT_SIM_CONFIG, party: { size: 2 }, scoring: { partySize: 2 }, encounter: DUMMY_AT };
const STILL_SHOT: BurstSpec = { ...STRIKE, kind: BulletKind.SNIPER, pierce: undefined, life: 1 };

function dummyOf(s: SimState): ActorState {
	for (const a of s.combat.actors) if (a.kind >= 0 && archetypeAt(a.kind).id === TEST_DUMMY.id) return a;
	return error("no test.dummy");
}
function fire(s: SimState, config: SimConfig, spec: BurstSpec, x: number, z: number): number {
	return new SimCtx().bind(s, config, EMPTY_INPUT).fireEnemy(dummyOf(s), 0, 1, spec, x, z);
}

describe("stormcaller: registry and data", () => {
	it("is in band 4 (index 16 pinned by newEnemies.spec; test archetypes shift it here) with the planned data", () => {
		const k = archetypeIndex("stormcaller");
		expect(archetypeAt(k)).toBe(STORMCALLER);
		expect([k - archetypeIndex("reaper"), archetypeIndex("warbanner") - k]).toEqual([1, 1]);
		expect(STORMCALLER.band).toBe(PORT_BAND_ENEMIES_2);
		expect([D.hp, D.radius, D.speed, D.contactDamage, D.roomEnemy]).toEqual([5, 0.35, 2.4, 0, true]);
		expect([D.keepMin, D.keepMax, D.castCooldownMin, D.castCooldownMax, D.castTicks]).toEqual([
			7, 10, 216, 264, 60,
		]);
		expect([D.strikeCount, D.strikeRadius, D.strikeSpacing, D.strikeLifeTicks]).toEqual([3, 1.1, 2.2, 6]);
		expect([STRIKE.count, STRIKE.spread, STRIKE.speed, STRIKE.kind, STRIKE.damage]).toEqual([
			1,
			0,
			0,
			BulletKind.STRIKE,
			HIT_NORMAL,
		]);
		expect([STRIKE.life, STRIKE.pierce]).toEqual([6 * SIM_DT, STORMCALLER_STRIKE_TICKS]);
		// The hold rides in the payload's pierce field, so it must fit there.
		expect(STORMCALLER_STRIKE_TICKS <= BulletPayload.max("pierce")).toBe(true);
		expect(enemyBulletHitRadius(BulletKind.STRIKE)).toBe(STRIKE_BULLET_RADIUS);
		const row = D.fx!.strikeRow!;
		expect([row.state, row.attack, row.count, row.radius, row.fillTicks]).toEqual([
			AiState.TELEGRAPH,
			STORMCALLER_ATTACK_CAST,
			3,
			STRIKE_BULLET_RADIUS,
			D.castTicks,
		]);
		expect([row.centreX, row.centreZ, row.offsetX, row.offsetZ]).toEqual([3, 4, 5, 6]);
		expect(STORMCALLER_KEEP).toBe(STATE_ENGAGED);
		expect([V_HOME_X, V_HOME_Z, STORMCALLER_STRAFE]).toEqual([1, 2, 7]);
	});
});

describe("STRIKE: events.strikes, not the enemy-shoot cue", () => {
	it("fireEnemy counts strikes in events.strikes and combat.enemySpawned, never in gooSpawned", () => {
		const s = createSimState(1, 0, 0, SCORED);
		const before = s.combat.enemySpawned;
		expect(fire(s, SCORED, STRIKE, 3, 3)).toBe(1);
		expect([s.events.strikes, s.events.gooSpawned, s.combat.enemySpawned]).toEqual([1, 0, before + 1]);
		expect(fire(s, SCORED, STILL_SHOT, 3, 2)).toBe(1);
		expect([s.events.strikes, s.combat.enemySpawned]).toEqual([1, before + 2]);
		step(s, IDLE, SCORED);
		expect(s.events.strikes).toBe(0); // per tick
	});
});

describe("STRIKE: hits", () => {
	it("solo: hurts once (HIT_NORMAL) and is consumed; a strike 1.6 away never hurts", () => {
		const s = createSimState(1, 0, 0, SCORED);
		fire(s, SCORED, STRIKE, 1, 0.5); // 1.12 from the player: inside 1.1 + PLAYER_RADIUS
		step(s, IDLE, SCORED);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		for (let t = 0; t < 10; t++) step(s, IDLE, SCORED);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);

		const far = createSimState(1, 0, 0, SCORED);
		fire(far, SCORED, STRIKE, 1.6, 0);
		for (let t = 0; t < 10; t++) step(far, IDLE, SCORED);
		expect(far.player.hearts).toBe(START_HALF_HEARTS);
	});

	it("a player between two strikes of a row is hurt once", () => {
		const s = createSimState(1, 0, 0, SCORED);
		fire(s, SCORED, STRIKE, -1.1, 0);
		fire(s, SCORED, STRIKE, 1.1, 0);
		for (let t = 0; t < 10; t++) step(s, IDLE, SCORED);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
	});

	it("co-op: one strike over both players hurts one of them once (consumed by the landed hit)", () => {
		const s = createSimState(1, 0, 0, DUO);
		put(s, 0, -0.5, 0);
		put(s, 1, 0.5, 0);
		fire(s, DUO, STRIKE, 0, 0);
		for (let t = 0; t < 10; t++) stepParty(s, [IDLE, IDLE], DUO);
		expect([playerAt(s, 0).hearts, playerAt(s, 1).hearts]).toEqual([
			START_HALF_HEARTS - HIT_NORMAL,
			START_HALF_HEARTS,
		]);
		expect(s.combat.enemyBullets.activeCount).toBe(0);
	});

	it("roll i-frames avoid it: no hit over its whole hold; shorter i-frames and it lands once they end", () => {
		const covered = createSimState(1, 0, 0, SCORED);
		covered.player.iframeTicks = ROLL_IFRAME_TICKS;
		fire(covered, SCORED, STRIKE, 0, 0);
		for (let t = 0; t < STORMCALLER_STRIKE_TICKS; t++) step(covered, IDLE, SCORED);
		expect(covered.player.hearts).toBe(START_HALF_HEARTS);
		expect(covered.combat.enemyBullets.activeCount).toBe(0); // the hold ran out

		const short = createSimState(1, 0, 0, SCORED);
		short.player.iframeTicks = 3;
		fire(short, SCORED, STRIKE, 0, 0);
		let hitAt = -1;
		for (let t = 0; t < STORMCALLER_STRIKE_TICKS && hitAt < 0; t++) {
			step(short, IDLE, SCORED);
			if (short.player.hearts < START_HALF_HEARTS) hitAt = t;
		}
		expect(hitAt).toBe(2); // stepPlayer counts the i-frames down before the collision pass

		// A real roll pressed on the strike's tick.
		const rolled = createSimState(1, 0, 0, SCORED);
		fire(rolled, SCORED, STRIKE, 0, 0);
		step(rolled, ROLL, SCORED);
		for (let t = 0; t < 10; t++) step(rolled, IDLE, SCORED);
		expect(rolled.player.hearts).toBe(START_HALF_HEARTS);
	});
});

describe("STRIKE: holds exactly its ticks, Hourglass or not", () => {
	// An endless arena (no rooms) so the run has progression state and the Hourglass can slow enemy bullets.
	const world: EndlessFloorWorld = {
		floor: 1,
		config: { bounds: DEFAULT_BOUNDS, encounter: enc([]) },
		bossFloor: false,
		spawnX: 0,
		spawnZ: 0,
		stairX: 1000,
		stairZ: 1000,
		roomSpawns: [],
		roomIdAt: () => -1,
	};
	const ARENA: SimConfig = { endless: { runSeed: 7, worldForFloor: () => world }, scoring: {} };

	/** Steps a bullet of `spec` at (3, 3) survives (ghost player, nothing else around), the Hourglass slow on or off. */
	function passes(spec: BurstSpec, slowed: boolean): number {
		const s = createSimState(7, 0, 0, ARENA);
		ghost(s);
		if (slowed) s.run!.players[SOLO_PLAYER].hourglassTicks = 1000; // the slow runs while any timer does
		expect(fireBurst(s.combat.enemyBullets, 0, 3, 3, 0, 1, spec, archetypeIndex("stormcaller") + 1)).toBe(1);
		let alive = 0;
		while (s.combat.enemyBullets.activeCount > 0 && alive < 100) {
			step(s, IDLE, ARENA);
			alive += 1;
		}
		return alive;
	}

	it("a strike is consumed on its 6th pass, slowed or not; an ordinary bullet of the same life lasts 7 steps, 9 slowed", () => {
		const plain: BurstSpec = { ...STRIKE, kind: BulletKind.ENEMY, pierce: undefined };
		expect(passes(STRIKE, false)).toBe(STORMCALLER_STRIKE_TICKS);
		expect(passes(STRIKE, true)).toBe(STORMCALLER_STRIKE_TICKS); // not stretched
		expect(passes(plain, false)).toBe(STORMCALLER_STRIKE_TICKS + 1); // its float life ends in the 7th step
		expect(passes(plain, true)).toBe(9); // stretched by 1 / 0.7
	});
});

describe("STRIKE: no grazes", () => {
	it("solo and co-op: never touches the graze bits, scores, feeds or combos anything", () => {
		for (const config of [SCORED, DUO]) {
			const s = createSimState(1, 0, 0, config);
			ghost(s);
			fire(s, config, STRIKE, 0.5, 0);
			fire(s, config, STRIKE, 1.6, 0); // outside the hit circle
			fire(s, config, STILL_SHOT, 0.6, 0.6); // control: an ordinary bullet in the graze ring is marked
			const step1 = () => (config === DUO ? stepParty(s, [IDLE, IDLE], config) : step(s, IDLE, config));
			step1();
			for (const b of liveBullets(s)) {
				const bits = bit32.band(b.payload, bit32.bor(GRAZE_NEAR_BIT, GRAZE_DONE_BIT));
				expect([b.kind, bits !== 0]).toEqual([b.kind, b.kind !== BulletKind.STRIKE]);
			}
			let feed = 0;
			for (let t = 0; t < 10; t++) {
				step1();
				feed += s.score!.events.grazeX.size() + s.score!.events.grazes;
			}
			expect([s.score!.counts[ScoreSource.GRAZES], s.score!.points[ScoreSource.GRAZES], feed]).toEqual([0, 0, 0]);
		}
	});
});

describe("STRIKE vs the sword (NED7)", () => {
	/** A strike, a still bullet and a goo puddle in front of the player at the origin (facing +X +Z), in reach. */
	function mixed(s: SimState): void {
		fire(s, SCORED, STRIKE, 1.2, 1.2); // 1.70 away: outside the strike's hit circle, inside the guard's 1.9
		fire(s, SCORED, STILL_SHOT, 0.8, 0.6);
		fire(s, SCORED, { count: 1, spread: 0, speed: 0, life: 3, damage: HIT_NORMAL, kind: BulletKind.GOO }, 0.6, 0.8);
	}
	const kinds = (s: SimState) => liveBullets(s).map((b) => b.kind);

	it("the guard erases the bullet and the goo (as before) but leaves the strike: no guard points for it", () => {
		const s = createSimState(1, 0, 0, SCORED);
		mixed(s);
		step(s, GUARD, SCORED);
		expect(kinds(s)).toEqual([BulletKind.STRIKE]);
		expect(sweepGooErased()).toBe(1);
		expect([s.events.bulletsDeleted, s.score!.events.guardCancels]).toEqual([1, 1]);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
	});

	it("an ordinary swing erases the bullet only: goo and the strike stay", () => {
		const s = createSimState(1, 0, 0, SCORED);
		mixed(s);
		step(s, SWING, SCORED);
		expect(s.events.bulletsDeleted).toBe(1);
		const left = kinds(s);
		left.sort();
		expect(left).toEqual([BulletKind.GOO, BulletKind.STRIKE]);
	});
});

describe("STRIKE vs breakables", () => {
	const PIECES: SimConfig = {
		...SCORED,
		breakables: { ...BREAKABLES_CONFIG, pieces: [{ x: 4, y: 0, kind: "barrel" }] },
	};
	const kinds = (s: SimState) => liveBullets(s).map((b) => b.kind);
	it("a strike on a piece's cell neither damages it nor is stopped; an ordinary bullet there hits it", () => {
		const s = createSimState(1, 0, 0, PIECES);
		const hp0 = s.breakables!.pieces[0].hp;
		fire(s, PIECES, STRIKE, 4, 0);
		step(s, IDLE, PIECES);
		expect([s.breakables!.pieces[0].hp, s.events.breakableHits]).toEqual([hp0, 0]);
		expect(kinds(s)).toEqual([BulletKind.STRIKE]);

		const c = createSimState(1, 0, 0, PIECES);
		fire(c, PIECES, STILL_SHOT, 4, 0);
		step(c, IDLE, PIECES);
		expect(c.events.breakableHits).toBe(1);
		expect(c.combat.enemyBullets.activeCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------
// The Stormcaller itself in an open arena: it at (0, 8), the player at the origin.

const OPEN: SimConfig = { encounter: enc([{ kind: "stormcaller", x: 0, z: 8 }]) };

describe("stormcaller: the cast and the strike", () => {
	it("casts every cooldown: one draw at cast start, the row on the target, perpendicular, 2.2 apart; 3 strikes", () => {
		const s = createSimState(11, 0, 0, OPEN);
		ghost(s);
		const a = s.combat.actors[0];
		let casts = 0;
		let strikes = 0;
		let castTick = -1;
		let lastStrike = -1;
		let x0 = 0;
		let z0 = 0;
		for (let t = 0; t < 1800; t++) {
			const rng0 = s.rngState;
			const wasCasting = casting(a);
			step(s, IDLE, OPEN);
			if (!wasCasting && casting(a)) {
				casts += 1;
				castTick = t;
				x0 = a.x;
				z0 = a.z;
				// Exactly one draw (the next cooldown), at the cast start.
				const one = new Rng(0);
				one.setState(rng0);
				one.next();
				expect(s.rngState).toBe(one.getState());
				expect(a.cooldown >= D.castCooldownMin && a.cooldown <= D.castCooldownMax).toBe(true);
				// The row: centre on the target, offset = bearing turned 90 degrees x spacing.
				expect([a.v[STORMCALLER_CENTRE_X], a.v[STORMCALLER_CENTRE_Z]]).toEqual([s.player.x, s.player.z]);
				const ox = a.v[STORMCALLER_OFFSET_X];
				const oz = a.v[STORMCALLER_OFFSET_Z];
				expect(math.sqrt(ox * ox + oz * oz)).toBeCloseTo(D.strikeSpacing, 12);
				expect(math.abs(ox * (s.player.x - a.x) + oz * (s.player.z - a.z))).toBeLessThan(1e-9);
				expect(math.sqrt(d2(a.x, a.z, s.player.x, s.player.z)) <= D.castRange).toBe(true);
			} else {
				expect(s.rngState).toBe(rng0); // no other draw
			}
			if (casting(a)) expect([a.x, a.z]).toEqual([x0, z0]); // planted while casting
			if (s.events.strikes > 0) {
				strikes += s.events.strikes;
				expect(s.events.strikes).toBe(3);
				expect(t - castTick).toBe(D.castTicks);
				expect(a.aiState).toBe(STORMCALLER_KEEP);
				const live = liveBullets(s).filter((b) => b.kind === BulletKind.STRIKE);
				expect(live.size()).toBe(3);
				const pts = rowPoints(a);
				for (const b of live) {
					let near = false;
					for (const [px, pz] of pts) if (d2(b.x, b.z, px, pz) < 1e-18) near = true;
					expect(near).toBe(true);
				}
				expect(t - lastStrike >= D.castTicks + D.castCooldownMin || lastStrike < 0).toBe(true);
				lastStrike = t;
			}
		}
		expect(casts).toBeGreaterThanOrEqual(5);
		// Every cast struck, unless a leash cut it short or the last one is still running.
		expect(strikes % 3).toBe(0);
		expect(strikes >= 3 * (casts - 1)).toBe(true);
	});

	it("never tracks: the strikes land on the cast-start row while the player walks off", () => {
		const s = createSimState(5, 0, 0, OPEN);
		ghost(s);
		const a = s.combat.actors[0];
		a.cooldown = 0;
		step(s, IDLE, OPEN); // engages and casts at once
		expect(casting(a)).toBe(true);
		const pts = rowPoints(a);
		const walk: InputFrame = { ...EMPTY_INPUT, moveX: AXIS_MAX };
		for (let t = 0; t < D.castTicks; t++) step(s, walk, OPEN);
		expect(s.events.strikes).toBe(3);
		expect(s.player.x).toBeGreaterThan(2);
		const live = liveBullets(s);
		for (let i = 0; i < 3; i++)
			expect([live.some((b) => d2(b.x, b.z, pts[i][0], pts[i][1]) < 1e-18)]).toEqual([true]);
	});

	it("keeps 7-10 from its target", () => {
		const near: SimConfig = { encounter: enc([{ kind: "stormcaller", x: 0, z: 3 }]) };
		const s = createSimState(3, 0, 0, near);
		ghost(s);
		const a = s.combat.actors[0];
		for (let t = 0; t < 150; t++) step(s, IDLE, near);
		const r = math.sqrt(d2(a.x, a.z, 0, 0));
		expect(r >= D.keepMin - 0.1 && r <= D.keepMax + 0.1).toBe(true);
	});
});

// A hand-built floor: walls at x >= 2.5 (gx >= 3); a crate at cell (-1, 0); `shut` blocks every cell near the origin.
let shut = false;
const handBlocked = (x: number, z: number): boolean =>
	worldToGrid(x) >= 3 || (shut && math.abs(worldToGrid(x)) <= 3 && math.abs(worldToGrid(z)) <= 1);
const HAND: SimConfig = {
	encounter: enc([{ kind: "stormcaller", x: 0, z: -8 }]),
	isBulletBlocked: handBlocked,
	breakables: { ...BREAKABLES_CONFIG, pieces: [{ x: -1, y: 0, kind: "crate" }] },
};

describe("stormcaller: skipped points", () => {
	function castOnce(seed: number, px: number, closeAfterCast: boolean): { s: SimState; a: ActorState } {
		shut = false;
		const s = createSimState(seed, px, 0, HAND);
		put(s, 0, px, 0);
		ghost(s);
		const a = s.combat.actors[0];
		a.x = px;
		a.prevX = px;
		a.cooldown = 0;
		step(s, IDLE, HAND);
		expect(casting(a)).toBe(true);
		if (closeAfterCast) shut = true;
		for (let t = 0; t < D.castTicks; t++) step(s, IDLE, HAND);
		shut = false;
		return { s, a };
	}

	it("a wall point and a breakable point are skipped (no bullet, no draw); the floor point strikes", () => {
		// Caster straight below the player at (1.2, 0): bearing +Z, offset (-2.2, 0), points 3.4 (wall cell 3), 1.2
		// (floor), -1.0 (the crate's cell -1).
		const { s, a } = castOnce(1, 1.2, false);
		const pts = rowPoints(a);
		expect([worldToGrid(pts[0][0]), worldToGrid(pts[1][0]), worldToGrid(pts[2][0])]).toEqual([3, 1, -1]);
		expect(s.events.strikes).toBe(1);
		const live = liveBullets(s);
		expect(live.size()).toBe(1);
		expect([live[0].x, live[0].z]).toEqual([pts[1][0], pts[1][1]]);
		expect(s.breakables!.pieces[0].hp).toBe(createSimState(1, 0, 0, HAND).breakables!.pieces[0].hp); // untouched
	});

	it("a cast with all three skipped fires nothing but spends the same cooldown and draws as an open one", () => {
		const open = castOnce(9, 0, false);
		const closed = castOnce(9, 0, true);
		expect(open.s.events.strikes).toBeGreaterThan(0);
		expect(closed.s.events.strikes).toBe(0);
		expect(closed.s.combat.enemyBullets.activeCount).toBe(0);
		expect(closed.s.rngState).toBe(open.s.rngState);
		expect(closed.a.cooldown).toBe(open.a.cooldown);
		expect(closed.a.cooldown).toBeGreaterThan(0);
		expect(closed.a.aiState).toBe(STORMCALLER_KEEP);
	});
});

// ---------------------------------------------------------------------------------------------
// Real endless floors (run WITHOUT endless mode, the floor's breakables as config pieces): a Stormcaller and wandering
// ghost players in a combat room; every strike is checked against the floor itself.

interface Scene {
	readonly fl: EndlessRunFloor;
	readonly config: SimConfig;
	readonly players: ReadonlyArray<readonly [number, number]>;
}

function roomTiles(fl: EndlessRunFloor, id: number): Array<readonly [number, number]> {
	const d = fl.dungeon;
	const out: Array<readonly [number, number]> = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++)
			if (d.roomId[gy * d.W + gx] === id && tileAt(d, gx, gy) === TileType.FLOOR) out.push([gx, gy]);
	return out;
}

function scene(runSeed: number, floor: number, party: number): Scene | undefined {
	const fl = endlessRunFloor(runSeed, floor, party);
	const rooms = fl.config.encounter!.rooms;
	const rng = new Rng(runSeed * 37 + floor);
	const blocked = fl.config.isBulletBlocked!;
	for (let tries = 0; tries < 40; tries++) {
		const r = rooms[rng.int(0, rooms.size() - 1)];
		if (r.type !== "combat" && r.type !== "elite") continue;
		const tiles = roomTiles(fl, r.id);
		if (tiles.size() < 30) continue;
		const me = tiles[rng.int(0, tiles.size() - 1)];
		const players: Array<readonly [number, number]> = [];
		for (let k = 0; k < 20 && players.size() < party; k++) {
			const p = tiles[rng.int(0, tiles.size() - 1)];
			const dd = d2(p[0], p[1], me[0], me[1]);
			if (dd >= 36 && dd <= 81 && lineOfSight(blocked, me[0], me[1], p[0], p[1])) players.push(p);
		}
		if (players.size() < party) continue;
		const config: SimConfig = {
			...fl.config,
			encounter: { ...fl.config.encounter!, spawns: [{ kind: "stormcaller", x: me[0], z: me[1] }] },
			breakables: { ...BREAKABLES_CONFIG, pieces: fl.breakables ?? [] },
			party: party > 1 ? { size: party } : undefined,
		};
		return { fl, config, players };
	}
	return undefined;
}

/** A wandering player: a random 8-way move (or standing) held for 10-40 ticks. */
function wanderer(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let hold = 0;
	let cur: InputFrame = EMPTY_INPUT;
	const axes = [-AXIS_MAX, 0, AXIS_MAX];
	return () => {
		if (hold <= 0) {
			hold = rng.int(10, 40);
			cur = { ...EMPTY_INPUT, moveX: axes[rng.int(0, 2)], moveZ: axes[rng.int(0, 2)] };
		}
		hold--;
		return cur;
	};
}

interface Played {
	readonly strikes: number;
	readonly skipped: number;
	readonly hashes: string[];
}

function play(sc: Scene, seed: number, ticks: number): Played {
	const party = sc.players.size();
	const s = createSimState(seed, sc.players[0][0], sc.players[0][1], sc.config);
	for (let i = 0; i < party; i++) put(s, i, sc.players[i][0], sc.players[i][1]);
	ghost(s);
	const walkers: Array<() => InputFrame> = [];
	for (let i = 0; i < party; i++) walkers.push(wanderer(seed * 7 + i));
	const a = s.combat.actors[0];
	const d = sc.fl.dungeon;
	let strikes = 0;
	let skipped = 0;
	const hashes: string[] = [];
	for (let t = 0; t < ticks; t++) {
		const before = new Set<number>();
		for (const b of liveBullets(s)) before.add(b.slot);
		if (party > 1) {
			const inputs: InputFrame[] = [];
			for (let i = 0; i < party; i++) inputs.push(walkers[i]());
			stepParty(s, inputs, sc.config);
		} else step(s, walkers[0](), sc.config);
		hashes.push(hashState(s));
		if (s.events.strikes === 0) continue;
		// The open points of the row, from the floor itself: no wall / void cell, no intact breakable.
		const solid = solidCells(s);
		let open = 0;
		for (const [x, z] of rowPoints(a)) {
			const gx = worldToGrid(x);
			const gz = worldToGrid(z);
			const ok = !isBulletBlockingTile(tileAt(d, gx, gz)) && !(solid !== undefined && solid.has(cellKey(gx, gz)));
			if (ok) open += 1;
		}
		expect(s.events.strikes).toBe(open);
		strikes += open;
		skipped += 3 - open;
		for (const b of liveBullets(s)) {
			if (b.kind !== BulletKind.STRIKE || before.has(b.slot)) continue;
			const gx = worldToGrid(b.x);
			const gz = worldToGrid(b.z);
			expect([gx, gz, isBulletBlockingTile(tileAt(d, gx, gz))]).toEqual([gx, gz, false]);
			expect([gx, gz, solid !== undefined && solid.has(cellKey(gx, gz))]).toEqual([gx, gz, false]);
		}
	}
	return { strikes, skipped, hashes };
}

describe("stormcaller: strikes on real endless floors", () => {
	it("solo: every strike stands on floor, every skipped point is a wall / void / breakable cell (12 floors)", () => {
		let strikes = 0;
		let skipped = 0;
		let scenes = 0;
		for (let run = 1; run <= 12; run++) {
			const sc = scene(run, 2 + (run % 3), 1);
			if (sc === undefined) continue;
			scenes += 1;
			const p = play(sc, run, 1200);
			strikes += p.strikes;
			skipped += p.skipped;
		}
		expect(scenes).toBeGreaterThanOrEqual(10);
		expect(strikes).toBeGreaterThanOrEqual(30);
		expect(skipped).toBeGreaterThanOrEqual(1);
	});

	it("co-op (2): the same on 6 floors", () => {
		let strikes = 0;
		for (let run = 21; run <= 26; run++) {
			const sc = scene(run, 3, 2);
			if (sc === undefined) continue;
			strikes += play(sc, run, 900).strikes;
		}
		expect(strikes).toBeGreaterThanOrEqual(12);
	});

	it("is deterministic: identical runs give identical hashes every tick, and the outcome is pinned", () => {
		const pins: string[] = [];
		for (const [run, party] of [
			[4, 1],
			[23, 2],
		]) {
			const first = play(scene(run, 3, party)!, run, 600);
			const second = play(scene(run, 3, party)!, run, 600);
			expect(first.hashes.size()).toBe(600);
			expect(second.hashes).toEqual(first.hashes);
			pins.push(`${first.strikes}/${first.skipped}/${first.hashes[599]}`);
		}
		// Re-recorded for docs/NEW_ENEMIES.md NE7: the reshuffled roster moves floor 3's room spawns (and the breakables
		// around them); strike and skip counts are unchanged.
		// Re-recorded for the merge of solid decor and docs/NEW_ENEMIES.md: floor 3's tombs / candle stands (WALL cells)
		// move its room spawn tiles and breakables; strike and skip counts are unchanged. Before: b86ecbd6 / 8f7c3348.
		// Re-recorded for the merge of room themes (docs/DECOR.md "Room themes"): floor 3 lays out differently; run 4 now
		// casts 3 strikes, and run 23's co-op scene no longer casts within 600 ticks (strikes in co-op stay covered by
		// the "co-op (2)" case above). Before: 2/1/08f85cd2, 6/0/5cfa0ffb.
		// Re-recorded for bookcases and the library theme (docs/BOOKSHELVES.md): floor 3 lays out differently again;
		// run 4 casts 2 strikes (1 skipped) and run 23's co-op scene casts 6 again. Before: 3/0/49e332ac, 0/0/7c9c4b5e.
		// Re-recorded for the merge of main (bookcases) into docs/TREASURE.md: run 4's floor 3 holds a vault on the
		// bookcase layout (its chest a breakables piece), run 23's does not (unchanged); strike and skip counts (main's)
		// are unchanged. Before: 2/1/d5a796ef (main, no vaults), 3/0/e303e3be (treasure rooms, no bookcases).
		// Re-recorded for the libraries' reading area (docs/BOOKSHELVES.md): a table and chairs move run 23's floor 3
		// (strike and skip counts unchanged; run 4 untouched). Before: 6/0/ae2b2503.
		// Re-derived on the second merge of main (reading area) into docs/TREASURE.md: both compose: run 4 keeps the
		// vault pin (the reading area left it untouched on main too), run 23 takes main's reading-area pin (no vault on
		// its floor 3).
		// Re-recorded for the wall slide (docs/WALL_SLIDE.md WS4): the scenes' players move with the slide, so the
		// state hashes moved; strike and skip counts are unchanged and no layout changed. Before: 2/1/f21b6834,
		// 6/0/07335c64.
		// Re-recorded for Kenney decor's Forge pieces (docs/KENNEY_DECOR.md KN5-KN8): floor 3 lays out differently
		// (library v2, mess halls, store stock; free-standing pieces clear solid pillars); run 4 now casts 3 strikes (none
		// skipped), run 23 still 6. Before: 2/1/6b48e632, 6/0/4293fa96.
		// Re-recorded for floor modifiers (docs/FLOOR_MODIFIERS.md FM3): run 23's co-op floor 3 is a Hoard floor (a vault
		// and its chest piece now); strike and skip counts unchanged, run 4 untouched (a plain floor). Before: 6/0/c213cd8f.
		// Re-recorded for docs/DAILY.md DSD18 (every endless roster without unlock floors, one new kind a floor): floor
		// 3's rooms buy other kinds (run 23's on top of its Hoard floor), so spawns, breakables and state hashes moved;
		// strike and skip counts are unchanged and no layout changed. Before: 3/0/4b457f84, 6/0/59e6c52a.
		// Re-recorded for the Goldling's hiding place (docs/GOLDLING_RUMOURS.md GR1 / GR3): both scenes' floor 3 rolled a
		// Goldling, whose own barrel or crate is now appended to the floor's breakables (one more piece); strike and skip
		// counts are unchanged. Before: 3/0/ad7f1462, 6/0/f7c37743.
		// Re-recorded for secret rooms (docs/SECRET_ROOMS.md SR5): run 4's floor 3 holds a secret (its crack and chest
		// appended pieces, the movers on the carved grid); strike and skip counts unchanged; run 23's co-op floor 3 has
		// none (untouched). Before: 3/0/0406aa34.
		// Re-recorded for docs/NEW_ENEMIES_2.md NX6: four more room kinds and a reshuffled roster (14 seeded kinds), so
		// both scenes' floor 3 rooms buy other kinds (spawns, breakables and state hashes moved); the layouts did not, and
		// the scenes' strike and skip counts are unchanged. Before: 3/0/6b926521, 6/0/346b5428.
		// Re-recorded for docs/NEW_ENEMIES_3.md NT6: three more room kinds and a reshuffled roster (17 seeded kinds): run
		// 4's floor 3 now holds a Jackal pack (its roster swarmer / sniper / jackal / charger), run 23's co-op floor 3
		// buys slime / summoner / reaper (was charger / imp / reaper); spawns and the breakables around them moved, and
		// with the NX6 rosters both floors spend exactly their old spawns (the roster's move); layouts, strike and skip
		// counts unchanged. Before: 3/0/04cfeefe, 6/0/71038c42.
		expect(pins).toEqual(["3/0/31c1996c", "6/0/eb11734f"]); // check-asset-ids: allow (state hashes)
	});
});
