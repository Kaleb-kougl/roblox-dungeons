// Sword spacing SP2 / SP3 (docs/SWORD_SPACING.md Design 3-4): the walk and the finisher's lunge braked through
// SimConfig.spacing, on open-floor arenas with one contact enemy held in place (its position and hp put back after
// every tick, so the brake is read against a fixed tick-start entry) and the players made unhurtable.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	BOW_WEAPON_ID,
	Button,
	EMPTY_INPUT,
	PLAYER_RADIUS,
	ROLL_TICKS,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_SPACING,
	SWORD_V_BUSY,
	SWORD_V_LAST,
	SWORD_V_STEP,
	SWORD_V_WINDOW,
	archetypeAt,
	archetypeIndex,
	createSimState,
	hashState,
	partySize,
	playerAt,
	step,
	stepParty,
	weaponSpacingActive,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

/** A held enemy's hp: never killed by the swings or arrows of a run. */
const HELD_HP = 1e6;
/** Ticks of a walk: enough to cover every approach below several times over. */
const WALK_TICKS = 60;
/** The brake's stop lands on the keep circle up to float rounding. */
const EPS = 1e-9;

const keepOf = (kind: string) =>
	archetypeAt(archetypeIndex(kind)).data.radius + PLAYER_RADIUS + SWORD_SPACING.marginTiles;

function arena(kind: string | undefined, x: number, z: number, extra: Partial<SimConfig> = {}): SimConfig {
	return {
		encounter: {
			spawns: kind !== undefined ? [{ kind, x, z }] : [],
			rooms: [],
			entranceRoom: -1,
			bossRoom: -1,
		},
		...extra,
	};
}

/** The same arena with the brake on. */
const braked = (config: SimConfig): SimConfig => ({ ...config, spacing: SWORD_SPACING });

/** An input: move (mx, mz) and aim (ax, az) as unit fractions (exact integers on the axes used here), buttons. */
function input(mx: number, mz: number, buttons: number, ax = mx, az = mz): InputFrame {
	return { moveX: mx * AXIS_MAX, moveZ: mz * AXIS_MAX, aimX: ax * AXIS_MAX, aimZ: az * AXIS_MAX, buttons };
}

function stateOf(config: SimConfig, x = 0, z = 0): SimState {
	const s = createSimState(1, x, z, config);
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
	return s;
}

function enemyOf(s: SimState): ActorState {
	return s.combat.actors.find((a) => a.alive !== 0)!;
}

/** Puts the enemy back where it stood (and its hp, with `hp`). */
function hold(a: ActorState, x: number, z: number, hp = true): void {
	if (a.alive === 0) return;
	a.x = x;
	a.z = z;
	if (hp) a.hp = HELD_HP;
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

function distTo(s: SimState, i: number, x: number, z: number): number {
	const p = playerAt(s, i);
	return math.sqrt((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z));
}

/** Steps the arena with and without the brake on the same inputs; returns each tick's hash pair. */
function twin(
	config: SimConfig,
	frames: (t: number) => InputFrame,
	ticks: number,
	at: [number, number],
	x = 0,
	z = 0,
): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	const plain = stateOf(config, x, z);
	const brake = stateOf(braked(config), x, z);
	const a = enemyOf(plain);
	const b = enemyOf(brake);
	for (let t = 0; t < ticks; t++) {
		step(plain, frames(t), config);
		step(brake, frames(t), braked(config));
		if (a !== undefined) hold(a, at[0], at[1]);
		if (b !== undefined) hold(b, at[0], at[1]);
		out.push([hashState(plain), hashState(brake)]);
	}
	return out;
}

describe("the walk (SP2)", () => {
	it("holding FIRE and walking at a bruiser stops at keep (never inside); without FIRE it walks in as today", () => {
		const keep = keepOf("bruiser");
		const config = braked(arena("bruiser", 0, 3));
		const s = stateOf(config);
		const a = enemyOf(s);
		hold(a, 0, 3);
		for (let t = 0; t < WALK_TICKS; t++) {
			step(s, input(0, 1, Button.FIRE), config);
			hold(a, 0, 3);
			expect(distTo(s, 0, 0, 3) >= keep - EPS).toBe(true);
		}
		expect(math.abs(distTo(s, 0, 0, 3) - keep) < EPS).toBe(true);
		expect(s.player.x).toBe(0); // the stop cone: no sideways drift

		// No FIRE and no combo: the same walk, bit for bit with and without the brake, into contact.
		const rows = twin(arena("bruiser", 0, 3), () => input(0, 1, 0), WALK_TICKS, [0, 3]);
		for (const [plain, brake] of rows) expect(brake).toBe(plain);
		const walked = stateOf(config);
		const w = enemyOf(walked);
		let nearest = math.huge;
		for (let t = 0; t < WALK_TICKS; t++) {
			step(walked, input(0, 1, 0), config);
			hold(w, 0, 3);
			nearest = math.min(nearest, distTo(walked, 0, 0, 3));
		}
		expect(nearest < keep).toBe(true); // straight through it
	});

	it("the combo window holds the brake after FIRE is released, and it ends with the window", () => {
		const keep = keepOf("bruiser");
		const config = braked(arena("bruiser", 0, 1.5));
		const s = stateOf(config);
		const a = enemyOf(s);
		hold(a, 0, 1.5);
		step(s, input(0, 0, Button.FIRE, 0, 1), config); // swing 1
		hold(a, 0, 1.5);
		const weapons = s.combat.weapons;
		let active = 0;
		let lastActiveDist = -1;
		for (let t = 0; t < WALK_TICKS; t++) {
			const on = weaponSpacingActive(weapons, 0);
			step(s, input(0, 1, 0), config);
			hold(a, 0, 1.5);
			if (on) {
				active++;
				lastActiveDist = distTo(s, 0, 0, 1.5);
				expect(lastActiveDist >= keep - EPS).toBe(true);
			}
		}
		// A swing's recovery, then the combo window: braked all through, then walking in.
		expect(active).toBe(SWORD_DATA.swingRecoveryTicks + SWORD_DATA.comboWindowTicks);
		expect(math.abs(lastActiveDist - keep) < EPS).toBe(true);
		expect(distTo(s, 0, 0, 1.5) < keep).toBe(true);
	});

	it("a roll is never braked (FIRE held): the roll's ticks are bit for bit as without the brake", () => {
		const keep = keepOf("bruiser");
		const rows = twin(
			arena("bruiser", 0, 1.6),
			(t) => input(0, 1, t === 0 ? Button.FIRE + Button.ROLL : Button.FIRE),
			ROLL_TICKS,
			[0, 1.6],
		);
		for (const [plain, brake] of rows) expect(brake).toBe(plain);
		// And the roll did carry the body inside keep.
		const config = braked(arena("bruiser", 0, 1.6));
		const s = stateOf(config);
		const a = enemyOf(s);
		let inside = false;
		for (let t = 0; t < ROLL_TICKS; t++) {
			step(s, input(0, 1, t === 0 ? Button.FIRE + Button.ROLL : Button.FIRE), config);
			hold(a, 0, 1.6);
			if (distTo(s, 0, 0, 1.6) < keep) inside = true;
		}
		expect(inside).toBe(true);
	});

	it("the guard alone is not braked", () => {
		const keep = keepOf("bruiser");
		const frames = (t: number) => input(0, 1, t === 0 ? Button.ALT : 0);
		const rows = twin(arena("bruiser", 0, 1.6), frames, WALK_TICKS, [0, 1.6]);
		for (const [plain, brake] of rows) expect(brake).toBe(plain);
		const config = braked(arena("bruiser", 0, 1.6));
		const s = stateOf(config);
		const a = enemyOf(s);
		let nearest = math.huge;
		for (let t = 0; t < WALK_TICKS; t++) {
			expect(weaponSpacingActive(s.combat.weapons, frames(t).buttons)).toBe(false);
			step(s, frames(t), config);
			hold(a, 0, 1.6);
			nearest = math.min(nearest, distTo(s, 0, 0, 1.6));
		}
		expect(nearest < keep).toBe(true);
	});

	it("the Archer (the bow only) walks into a swarmer with FIRE held exactly as before", () => {
		const config = arena("swarmer", 0, 2, { loadout: [BOW_WEAPON_ID] });
		const rows = twin(config, () => input(0, 1, Button.FIRE), WALK_TICKS, [0, 2]);
		for (const [plain, brake] of rows) expect(brake).toBe(plain);
		const s = stateOf(braked(config));
		const a = enemyOf(s);
		let nearest = math.huge;
		for (let t = 0; t < WALK_TICKS; t++) {
			expect(weaponSpacingActive(s.combat.weapons, Button.FIRE)).toBe(false);
			step(s, input(0, 1, Button.FIRE), braked(config));
			hold(a, 0, 2);
			nearest = math.min(nearest, distTo(s, 0, 0, 2));
		}
		expect(nearest < keepOf("swarmer")).toBe(true);
	});

	it("co-op: both players are braked against the same list (each stops at keep)", () => {
		const keep = keepOf("bruiser");
		const config = braked(arena("bruiser", 0, 0, { party: { size: 2 } }));
		const s = stateOf(config);
		put(s, 0, -3, 0);
		put(s, 1, 3, 0);
		const a = enemyOf(s);
		hold(a, 0, 0);
		for (let t = 0; t < WALK_TICKS; t++) {
			stepParty(s, [input(1, 0, Button.FIRE), input(-1, 0, Button.FIRE)], config);
			hold(a, 0, 0);
			for (let i = 0; i < 2; i++) expect(distTo(s, i, 0, 0) >= keep - EPS).toBe(true);
		}
		for (let i = 0; i < 2; i++) expect(math.abs(distTo(s, i, 0, 0) - keep) < EPS).toBe(true);
		expect([playerAt(s, 0).z, playerAt(s, 1).z]).toEqual([0, 0]);
	});
});

/** Puts the sword one press away from the finisher's wind-up (swings 1 and 2 done, the combo window open). */
function armFinisher(s: SimState): void {
	const v = s.combat.weapons.sets[s.combat.weapons.activeSet].v;
	v[SWORD_V_STEP] = 2;
	v[SWORD_V_BUSY] = 0;
	v[SWORD_V_WINDOW] = SWORD_DATA.comboWindowTicks;
}

/** Ticks from the press to the finisher's strike: the press tick, then the wind-up's ticks. */
const FINISHER_TICKS = 1 + SWORD_DATA.finisherWindupTicks;

describe("the lunge (SP3)", () => {
	it("a finisher at a swarmer 1.2 tiles ahead ends at keep and still kills it", () => {
		const keep = keepOf("swarmer");
		const config = braked(arena("swarmer", 0, 1.2));
		const s = stateOf(config);
		const a = enemyOf(s);
		armFinisher(s);
		for (let t = 0; t < FINISHER_TICKS; t++) {
			step(s, input(0, 0, Button.FIRE, 0, 1), config);
			hold(a, 0, 1.2, false);
			expect(distTo(s, 0, 0, 1.2) >= keep - EPS).toBe(true);
		}
		expect(s.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(SWORD_FINISHER);
		expect(a.alive).toBe(0);
		expect(math.abs(distTo(s, 0, 0, 1.2) - keep) < EPS).toBe(true);
		expect(s.player.x).toBe(0);
	});

	it("a finisher with nothing in front lunges the full 0.6, bit for bit as without the brake", () => {
		const config = arena(undefined, 0, 0);
		const plain = stateOf(config);
		const brake = stateOf(braked(config));
		armFinisher(plain);
		armFinisher(brake);
		for (let t = 0; t < FINISHER_TICKS; t++) {
			step(plain, input(0, 0, Button.FIRE, 0, 1), config);
			step(brake, input(0, 0, Button.FIRE, 0, 1), braked(config));
			expect(hashState(brake)).toBe(hashState(plain));
		}
		expect(brake.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(SWORD_FINISHER);
		expect(math.abs(brake.player.z - SWORD_DATA.lungeDistance) < EPS).toBe(true);
	});

	it("`lunge: false` lunges through as today (the walk rule alone)", () => {
		const config = arena("swarmer", 0, 1.2);
		const walkOnly = { ...config, spacing: { ...SWORD_SPACING, lunge: false } };
		const plain = stateOf(config);
		const brake = stateOf(walkOnly);
		armFinisher(plain);
		armFinisher(brake);
		const a = enemyOf(plain);
		const b = enemyOf(brake);
		for (let t = 0; t < FINISHER_TICKS; t++) {
			step(plain, input(0, 0, Button.FIRE, 0, 1), config);
			step(brake, input(0, 0, Button.FIRE, 0, 1), walkOnly);
			hold(a, 0, 1.2, false);
			hold(b, 0, 1.2, false);
			expect(hashState(brake)).toBe(hashState(plain));
		}
		expect(distTo(brake, 0, 0, 1.2) < keepOf("swarmer")).toBe(true);
	});
});

describe("no brake without SimConfig.spacing", () => {
	it("an empty input steps identically whether or not the list is built", () => {
		const config = arena("bruiser", 0, 3);
		const rows = twin(config, () => EMPTY_INPUT, 10, [0, 3]);
		for (const [plain, brake] of rows) expect(brake).toBe(plain);
	});
});
