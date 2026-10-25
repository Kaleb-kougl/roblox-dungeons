// E1.5 player controller: roll, damagePlayer, flask, Ember, death, respawn, checkpoint refill, hashing.
// Ported from src/sim/player.test.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Button,
	EMBERS_PER_AREA,
	EMBER_IFRAME_TICKS,
	EMPTY_INPUT,
	FLASK_CHARGES,
	FLASK_HEAL_HALF_HEARTS,
	FLASK_MOVE_MULTIPLIER,
	FLASK_USE_TICKS,
	HIT_HEAVY,
	HIT_NORMAL,
	HURT_INVULN_TICKS,
	MAX_MOVE_STEP,
	PLAYER_HASH_FIELDS,
	PLAYER_SPEED,
	ROLL_DASH_TICKS,
	ROLL_DISTANCE,
	ROLL_IFRAME_TICKS,
	ROLL_RECOVERY_SPEED,
	ROLL_SPEED,
	ROLL_TICKS,
	SIM_DT,
	SQRT1_2,
	START_HALF_HEARTS,
	cloneSimState,
	createSimState,
	damagePlayer,
	hashState,
	isPlayerInvulnerable,
	refillAtCheckpoint,
	respawnPlayer,
	secondsToTicks,
	step,
	writePlayerHash,
	type InputFrame,
	type PlayerState,
	type SimConfig,
	type SimState,
} from "shared/sim";

/** No walls, no bounds: free movement. */
const OPEN: SimConfig = {};

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...over });
const IDLE = frame();
const RIGHT = frame({ moveX: 1000 });

function run(s: SimState, input: InputFrame, ticks: number, config: SimConfig = OPEN): void {
	for (let i = 0; i < ticks; i++) step(s, input, config);
}

/** A state that has just started a roll to +X (one tick stepped with ROLL down). */
function startRoll(config: SimConfig = OPEN): SimState {
	const s = createSimState(1, 0, 0);
	step(s, frame({ moveX: 1000, buttons: Button.ROLL }), config);
	return s;
}

describe("player data", () => {
	it("derives whole tick counts from seconds at SIM_HZ", () => {
		expect(secondsToTicks(0.35)).toBe(21);
		expect(ROLL_TICKS).toBe(21);
		expect(ROLL_IFRAME_TICKS).toBe(12);
		expect(HURT_INVULN_TICKS).toBe(45);
		expect(FLASK_USE_TICKS).toBe(30);
		expect(EMBER_IFRAME_TICKS).toBe(15);
		for (const t of [ROLL_TICKS, ROLL_IFRAME_TICKS, HURT_INVULN_TICKS, FLASK_USE_TICKS, EMBER_IFRAME_TICKS]) {
			expect(math.floor(t)).toBe(t);
		}
	});

	it("starts with 3 hearts (6 half hearts), no armor, 3 flask charges and 2 Embers", () => {
		const p = createSimState(1, 0, 0).player;
		expect([p.hearts, p.heartsMax, p.armor, p.armorMax]).toEqual([6, 6, 0, 0]);
		expect([p.flask, p.flaskMax, p.embers, p.emberMax]).toEqual([3, 3, 2, 2]);
		expect([p.rollTicks, p.iframeTicks, p.hurtTicks, p.flaskTicks, p.prevButtons, p.dead]).toEqual([
			0, 0, 0, 0, 0, 0,
		]);
		expect(START_HALF_HEARTS).toBe(6);
		expect(FLASK_CHARGES).toBe(3);
		expect(EMBERS_PER_AREA).toBe(2);
	});

	it("roll covers ~2.5 tiles at ~2x walk speed", () => {
		expect(ROLL_DISTANCE).toBeCloseTo(2.5, 12);
		expect(ROLL_SPEED / PLAYER_SPEED).toBeGreaterThan(1.5);
	});
});

describe("dodge roll", () => {
	it("lasts exactly ROLL_TICKS ticks and covers ROLL_DISTANCE in open space", () => {
		const s = startRoll();
		let rollingTicks = 1;
		while (s.player.rollTicks > 0) {
			step(s, IDLE, OPEN);
			if (s.player.rollTicks > 0) rollingTicks++;
			expect(rollingTicks).toBeLessThanOrEqual(ROLL_TICKS);
		}
		expect(rollingTicks).toBe(ROLL_TICKS);
		expect(s.tick).toBe(ROLL_TICKS + 1); // the tick after the roll moved nothing (idle input)
		expect(s.player.x).toBeCloseTo(ROLL_DISTANCE, 9);
		expect(s.player.z).toBe(0);
	});

	it("dashes at ROLL_SPEED during the i-frames, then recovers at ROLL_RECOVERY_SPEED", () => {
		const s = createSimState(1, 0, 0);
		const steps: number[] = [];
		for (let t = 0; t < ROLL_TICKS; t++) {
			step(s, frame({ moveX: 1000, buttons: t === 0 ? Button.ROLL : 0 }), OPEN);
			steps.push(s.player.x - s.player.prevX);
		}
		for (let t = 0; t < ROLL_TICKS; t++) {
			expect(steps[t]).toBeCloseTo((t < ROLL_DASH_TICKS ? ROLL_SPEED : ROLL_RECOVERY_SPEED) * SIM_DT, 12);
		}
	});

	it("has i-frames for exactly the first ROLL_IFRAME_TICKS ticks", () => {
		// Hit attempt right after the k-th roll tick (as stepCombat would), for every tick of the roll.
		for (let k = 1; k <= ROLL_TICKS; k++) {
			const s = startRoll();
			run(s, IDLE, k - 1);
			expect(isPlayerInvulnerable(s)).toBe(k <= ROLL_IFRAME_TICKS);
			expect(damagePlayer(s, HIT_NORMAL)).toBe(k > ROLL_IFRAME_TICKS);
		}
	});

	it("cannot start a new roll mid-roll, holding does not re-roll, and there is no cooldown after", () => {
		const s = createSimState(1, 0, 0);
		let rolls = 0;
		// Press on tick 0, then tap ROLL again on every odd tick of the roll: only the first press counts.
		for (let t = 0; t < ROLL_TICKS; t++) {
			const down = t === 0 || (t % 2 === 1 && t < ROLL_TICKS - 1);
			step(s, frame({ moveX: 1000, buttons: down ? Button.ROLL : 0 }), OPEN);
			rolls += s.events.rollStarted;
		}
		expect(rolls).toBe(1);
		expect(s.player.rollTicks).toBe(1); // tick ROLL_TICKS - 1: the last tick of the first roll, on schedule

		// The very next tick: a fresh press starts a new roll at once.
		step(s, frame({ moveX: 1000, buttons: Button.ROLL }), OPEN);
		expect(s.events.rollStarted).toBe(1);
		expect(s.player.rollTicks).toBe(ROLL_TICKS);

		// Holding ROLL through and after that roll does not chain another one.
		run(s, frame({ moveX: 1000, buttons: Button.ROLL }), ROLL_TICKS * 2);
		expect(s.player.rollTicks).toBe(0);
	});

	it("rolls along move input, or facing when standing still; direction is locked, facing follows aim", () => {
		const a = createSimState(1, 0, 0);
		step(a, frame({ moveX: 600, moveZ: 800, buttons: Button.ROLL }), OPEN);
		expect([a.player.rollDirX, a.player.rollDirZ]).toEqual([0.6, 0.8]);

		const b = createSimState(1, 0, 0);
		step(b, frame({ aimX: -1000 }), OPEN); // face -X without moving
		step(b, frame({ buttons: Button.ROLL }), OPEN);
		expect([b.player.rollDirX, b.player.rollDirZ]).toEqual([-1, 0]);
		expect(b.player.x).toBeLessThan(0);

		// Steering mid-roll changes nothing; aiming turns the player.
		const c = startRoll();
		run(c, frame({ moveZ: 1000, aimX: 0, aimZ: -1000 }), ROLL_TICKS - 1);
		expect(c.player.x).toBeCloseTo(ROLL_DISTANCE, 9);
		expect(c.player.z).toBe(0);
		expect([c.player.faceX, c.player.faceZ]).toEqual([0, -1]);
	});

	it("is stopped by walls through the moveResolver, in sub-steps of at most MAX_MOVE_STEP", () => {
		const lengths: number[] = [];
		const wall: SimConfig = {
			moveResolver: (x, z, dx, dz) => {
				lengths.push(math.sqrt(dx * dx + dz * dz));
				return { x: math.min(x + dx, 1), z: z + dz };
			},
		};
		const s = startRoll(wall);
		run(s, IDLE, ROLL_TICKS, wall);
		expect(s.player.x).toBe(1);
		let longest = 0;
		for (const l of lengths) longest = math.max(longest, l);
		expect(longest).toBeLessThanOrEqual(MAX_MOVE_STEP);
		// Dash ticks move 11/60 = 0.183 -> two calls each; recovery ticks one call each.
		expect(lengths.size()).toBe(ROLL_DASH_TICKS * 2 + (ROLL_TICKS - ROLL_DASH_TICKS));
	});

	it("is clamped by the bounds fallback", () => {
		const bounds = { minX: -7.25, maxX: 7.25, minZ: -7.25, maxZ: 7.25 };
		const s = createSimState(1, 6.5, 0);
		step(s, frame({ moveX: 1000, buttons: Button.ROLL }), { bounds });
		run(s, IDLE, ROLL_TICKS, { bounds });
		expect(s.player.x).toBe(7.25);
	});
});

describe("damagePlayer", () => {
	it("lands a normal hit: half a heart, playerHits event, post-hit invulnerability", () => {
		const s = createSimState(1, 0, 0);
		expect(damagePlayer(s, HIT_NORMAL)).toBe(true);
		expect(s.player.hearts).toBe(5);
		expect(s.events.playerHits).toBe(1);
		expect(s.player.hurtTicks).toBe(HURT_INVULN_TICKS);
		// A burst on the same tick is ignored.
		expect(damagePlayer(s, HIT_NORMAL)).toBe(false);
		expect(damagePlayer(s, HIT_HEAVY)).toBe(false);
		expect(s.player.hearts).toBe(5);
		expect(s.events.playerHits).toBe(1);
	});

	it("post-hit invulnerability lasts HURT_INVULN_TICKS ticks", () => {
		const s = createSimState(1, 0, 0);
		damagePlayer(s, HIT_NORMAL);
		run(s, IDLE, HURT_INVULN_TICKS - 1);
		expect(damagePlayer(s, HIT_NORMAL)).toBe(false);
		step(s, IDLE, OPEN);
		expect(isPlayerInvulnerable(s)).toBe(false);
		expect(damagePlayer(s, HIT_HEAVY)).toBe(true);
		expect(s.player.hearts).toBe(3);
	});

	it("armor pips absorb whole hits first, whatever the amount", () => {
		const s = createSimState(1, 0, 0);
		s.player.armor = 2;
		expect(damagePlayer(s, HIT_HEAVY)).toBe(true);
		expect([s.player.armor, s.player.hearts]).toEqual([1, 6]);
		expect(s.events.playerHits).toBe(1);
		s.player.hurtTicks = 0;
		expect(damagePlayer(s, 5)).toBe(true);
		expect([s.player.armor, s.player.hearts]).toEqual([0, 6]);
		s.player.hurtTicks = 0;
		expect(damagePlayer(s, HIT_NORMAL)).toBe(true);
		expect([s.player.armor, s.player.hearts]).toEqual([0, 5]);
	});

	it("kills at 0 hearts; the dead take no damage and do nothing", () => {
		const s = createSimState(1, 2, 3);
		s.player.hearts = 1;
		expect(damagePlayer(s, HIT_HEAVY)).toBe(true);
		expect(s.player.hearts).toBe(0);
		expect(s.player.dead).toBe(1);
		expect(s.events.playerDied).toBe(1);
		expect(damagePlayer(s, HIT_NORMAL)).toBe(false);

		run(s, frame({ moveX: 1000, aimX: -1000, buttons: Button.ROLL + Button.FLASK + Button.EMBER }), 30);
		expect([s.player.x, s.player.z, s.player.prevX, s.player.prevZ]).toEqual([2, 3, 2, 3]);
		expect([s.player.rollTicks, s.player.flask, s.player.embers]).toEqual([0, FLASK_CHARGES, EMBERS_PER_AREA]);
		expect([s.player.faceX, s.player.faceZ]).toEqual([SQRT1_2, SQRT1_2]);
		expect(s.tick).toBe(30); // the sim keeps ticking
	});

	it("ignores non-positive amounts", () => {
		const s = createSimState(1, 0, 0);
		expect(damagePlayer(s, 0)).toBe(false);
		expect(damagePlayer(s, -1)).toBe(false);
		expect(damagePlayer(s, 0 / 0)).toBe(false);
		expect(s.player.hurtTicks).toBe(0);
		expect(s.events.playerHits).toBe(0);
	});

	it("DEBUG_HIT input deals one normal hit per press, at the end of stepPlayer", () => {
		const s = createSimState(1, 0, 0);
		step(s, frame({ buttons: Button.DEBUG_HIT }), OPEN);
		expect(s.player.hearts).toBe(5);
		expect(s.events.playerHits).toBe(1);
		run(s, frame({ buttons: Button.DEBUG_HIT }), HURT_INVULN_TICKS * 2); // held: no repeat
		expect(s.player.hearts).toBe(5);
		step(s, IDLE, OPEN);
		step(s, frame({ buttons: Button.DEBUG_HIT }), OPEN);
		expect(s.player.hearts).toBe(4);
		// A roll started on the same tick protects (the roll is handled first).
		s.player.hurtTicks = 0;
		step(s, IDLE, OPEN);
		step(s, frame({ buttons: Button.DEBUG_HIT + Button.ROLL }), OPEN);
		expect(s.player.hearts).toBe(4);
		expect(s.events.playerHits).toBe(0);
	});
});

describe("flask", () => {
	it("heals one heart per charge, edge-triggered: holding uses one charge", () => {
		const s = createSimState(1, 0, 0);
		s.player.hearts = 2;
		run(s, frame({ buttons: Button.FLASK }), 120);
		expect(s.player.hearts).toBe(2 + FLASK_HEAL_HALF_HEARTS);
		expect(s.player.flask).toBe(FLASK_CHARGES - 1);
	});

	it("caps at max, is not wasted at full health, and does nothing with no charges", () => {
		const s = createSimState(1, 0, 0);
		step(s, frame({ buttons: Button.FLASK }), OPEN);
		expect(s.player.flask).toBe(FLASK_CHARGES); // full health: kept
		expect(s.events.flaskUsed).toBe(0);

		s.player.hearts = 5;
		step(s, IDLE, OPEN);
		step(s, frame({ buttons: Button.FLASK }), OPEN);
		expect(s.player.hearts).toBe(6);
		expect(s.player.flask).toBe(FLASK_CHARGES - 1);
		expect(s.events.flaskUsed).toBe(1);

		s.player.hearts = 1;
		s.player.flask = 0;
		run(s, IDLE, FLASK_USE_TICKS);
		step(s, frame({ buttons: Button.FLASK }), OPEN);
		expect(s.player.hearts).toBe(1);
		expect(s.events.flaskUsed).toBe(0);
	});

	it("halves walking speed for FLASK_USE_TICKS and blocks a second drink meanwhile", () => {
		const s = createSimState(1, 0, 0);
		s.player.hearts = 1;
		step(s, frame({ moveX: 1000, buttons: Button.FLASK }), OPEN);
		expect(s.player.x).toBeCloseTo(PLAYER_SPEED * SIM_DT * FLASK_MOVE_MULTIPLIER, 12);
		// Press again while drinking: ignored.
		step(s, RIGHT, OPEN);
		step(s, frame({ moveX: 1000, buttons: Button.FLASK }), OPEN);
		expect(s.player.flask).toBe(FLASK_CHARGES - 1);
		run(s, RIGHT, FLASK_USE_TICKS - 3);
		expect(s.player.flaskTicks).toBe(1); // tick FLASK_USE_TICKS - 1: the last slowed tick
		expect(s.player.x).toBeCloseTo(PLAYER_SPEED * SIM_DT * FLASK_MOVE_MULTIPLIER * FLASK_USE_TICKS, 9);
		const x = s.player.x;
		step(s, RIGHT, OPEN);
		expect(s.player.x - x).toBeCloseTo(PLAYER_SPEED * SIM_DT, 12);
	});
});

describe("Ember", () => {
	it("fires once per press while charges last, sets emberUsed on that tick only, grants i-frames", () => {
		const s = createSimState(1, 0, 0);
		step(s, frame({ buttons: Button.EMBER }), OPEN);
		expect(s.events.emberUsed).toBe(1);
		expect(s.player.embers).toBe(EMBERS_PER_AREA - 1);
		expect(s.player.iframeTicks).toBe(EMBER_IFRAME_TICKS);
		expect(damagePlayer(s, HIT_NORMAL)).toBe(false);

		step(s, frame({ buttons: Button.EMBER }), OPEN); // held
		expect(s.events.emberUsed).toBe(0);
		expect(s.player.embers).toBe(EMBERS_PER_AREA - 1);

		// I-frames end after EMBER_IFRAME_TICKS ticks in total.
		run(s, IDLE, EMBER_IFRAME_TICKS - 2);
		expect(isPlayerInvulnerable(s)).toBe(true);
		step(s, IDLE, OPEN);
		expect(isPlayerInvulnerable(s)).toBe(false);

		step(s, frame({ buttons: Button.EMBER }), OPEN);
		expect(s.player.embers).toBe(0);
		step(s, IDLE, OPEN);
		run(s, IDLE, EMBER_IFRAME_TICKS);
		step(s, frame({ buttons: Button.EMBER }), OPEN); // none left
		expect(s.events.emberUsed).toBe(0);
		expect(s.player.iframeTicks).toBe(0);
	});

	it("clears the (empty) enemy bullet pool on the Ember tick: bulletsCleared stays 0", () => {
		const s = createSimState(1, 0, 0);
		step(s, frame({ buttons: Button.EMBER }), OPEN);
		expect(s.events.emberUsed).toBe(1);
		expect(s.events.bulletsCleared).toBe(0);
	});
});

describe("respawnPlayer and refillAtCheckpoint", () => {
	it("respawnPlayer revives with full hearts and supplies, clears timers, keeps tick and rng", () => {
		const s = createSimState(7, 0, 0);
		step(s, frame({ moveX: 1000, buttons: Button.ROLL + Button.EMBER }), OPEN);
		s.rngState = 12345;
		s.player.flask = 0;
		s.player.armorMax = 1;
		s.player.hearts = 1;
		s.player.iframeTicks = 0;
		damagePlayer(s, HIT_NORMAL);
		expect(s.player.dead).toBe(1);
		const tick = s.tick;

		respawnPlayer(s, 4, -2);
		const p = s.player;
		expect([p.x, p.z, p.prevX, p.prevZ]).toEqual([4, -2, 4, -2]);
		expect([p.hearts, p.armor, p.flask, p.embers, p.dead]).toEqual([6, 1, 3, 2, 0]);
		expect([p.rollTicks, p.iframeTicks, p.hurtTicks, p.flaskTicks]).toEqual([0, 0, 0, 0]);
		expect(s.tick).toBe(tick);
		expect(s.rngState).toBe(12345);
		step(s, RIGHT, OPEN);
		expect(s.player.x).toBeGreaterThan(4);
	});

	it("refillAtCheckpoint restores armor pips, flask charges and Embers, not hearts", () => {
		const s = createSimState(1, 0, 0);
		s.player.armorMax = 2;
		s.player.flask = 0;
		s.player.embers = 0;
		s.player.hearts = 3;
		refillAtCheckpoint(s);
		expect([s.player.armor, s.player.flask, s.player.embers, s.player.hearts]).toEqual([2, 3, 2, 3]);
	});
});

describe("player state hashing", () => {
	it("every PlayerState field is a number and is covered by the hash", () => {
		const s = createSimState(1, 0, 0);
		const base = hashState(s);
		const keys: (keyof PlayerState)[] = [];
		for (const [k, v] of pairs(s.player)) {
			keys.push(k);
			expect(typeIs(v, "number")).toBe(true);
		}
		const out: number[] = [];
		writePlayerHash(s, out);
		expect(out.size()).toBe(keys.size());
		expect(PLAYER_HASH_FIELDS.size()).toBe(keys.size());
		for (const k of keys) {
			const t = cloneSimState(s);
			t.player[k] += 1;
			expect(`${k}: ${hashState(t) !== base}`).toBe(`${k}: true`);
		}
	});

	it("cloneSimState copies every field and is independent", () => {
		const s = startRoll();
		const c = cloneSimState(s);
		expect(c.player).toEqual(s.player);
		expect(c.events).toEqual(s.events);
		expect(hashState(c)).toBe(hashState(s));
		step(c, IDLE, OPEN);
		expect(hashState(c)).never.toBe(hashState(s));
	});
});
