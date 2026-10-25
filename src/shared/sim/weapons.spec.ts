// E1.8 weapons: registry and loadout, SWAP (instant, edge, not while dead, per-set cooldowns), 'press' / 'custom'
// triggers, player bullet payload source, the placeholder swing (sweepArc: actors in the arc, enemy bullets deleted),
// and the sword's combo (damage on test.dummy / a turret) / lunge / window / guard (no damage) / bullet deletion /
// SWAP mid-combo. Ported from src/sim/weapons/weapons.test.ts and src/sim/weapons/defs/sword.test.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { stableSort } from "shared/jsmath";
import {
	BULLET_Y,
	BulletKind,
	BulletPayload,
	HIT_NORMAL,
	PLAYER_FIRE_TICKS,
	TEST_MELEE_DATA,
	acquireSpawnData,
	packPayload,
	Button,
	DEFAULT_LOADOUT,
	EMPTY_INPUT,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_STEP_WINDUP,
	SWORD_V_GUARD,
	SWORD_V_LAST,
	SWORD_V_STEP,
	compareIds,
	createSimState,
	isValidRegistryId,
	registerWeapon,
	step,
	weaponIds,
	weaponIndex,
	type ActorSpawn,
	type EncounterConfig,
	type InputFrame,
	type SimState,
	type SimConfig,
	type WeaponData,
} from "shared/sim";

// Test-only weapons (registered before any run starts in this spec file's realm).
const PRESS_DATA: WeaponData = { cooldownTicks: 0, damage: 1, style: "ranged" };
let customSteps = 0;
let pressFires = 0;
registerWeapon({
	id: "test.press",
	data: PRESS_DATA,
	trigger: "press",
	fire() {
		pressFires++;
		return true;
	},
});
registerWeapon({
	id: "test.custom",
	data: PRESS_DATA,
	trigger: "custom",
	step(ctx, slot) {
		customSteps++;
		if (ctx.fireReleased()) slot.v[0]++; // e.g. a charge-and-release bow
	},
	fire() {
		return error("never called for custom triggers");
	},
});

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });
const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...over });
const FIRE = frame({ buttons: Button.FIRE });
const SWAP = frame({ buttons: Button.SWAP });
const SWAP_FIRE = frame({ buttons: Button.SWAP + Button.FIRE });

describe("weapon registry and loadout", () => {
	it("numbers weapons by sorted id; the default loadout is the sword in hand and the bow on SWAP", () => {
		const ids = [...weaponIds()];
		const sorted = stableSort([...ids], compareIds);
		expect(ids).toEqual(sorted);
		expect([...DEFAULT_LOADOUT]).toEqual(["weapon.sword", "weapon.bow"]);
		const s = createSimState(1, 0, 0);
		expect(s.combat.weapons.activeSet).toBe(0);
		expect(s.combat.weapons.sets.map((w) => w.weapon)).toEqual([
			weaponIndex("weapon.sword"),
			weaponIndex("weapon.bow"),
		]);
		const [ok, err] = pcall(() => createSimState(1, 0, 0, { loadout: ["weapon.nope"] }));
		expect(ok).toBe(false);
		expect(tostring(err).find("Unknown weapon 'weapon.nope'", 1, true)[0]).never.toBe(undefined);
		const empty = createSimState(1, 0, 0, { loadout: [undefined] });
		expect(empty.combat.weapons.sets[1].weapon).toBe(-1);
		step(empty, SWAP_FIRE, {});
		expect(empty.events.shotsFired + empty.events.meleeSwings).toBe(0); // an empty set does nothing
	});

	it("validates ids like the source's /^[a-z][a-z0-9]*(\\.[a-z0-9]+)*$/ and orders them by code unit", () => {
		for (const ok of ["weapon.bow", "a", "turret.sniper", "boss.act1", "a1.b2.c3"])
			expect(isValidRegistryId(ok)).toBe(true);
		for (const bad of ["", "1a", "Weapon", "a..b", "a.", ".a", "a-b", "a.B"])
			expect(isValidRegistryId(bad)).toBe(false);
		expect(compareIds("weapon.test", "weapon.test.melee")).toBe(-1);
		expect(compareIds("boss.act1", "bruiser")).toBe(-1);
		expect(compareIds("turret.caster", "turret.caster")).toBe(0);
	});
});

describe("SWAP", () => {
	it("switches sets instantly on the press edge (held = once), with an event, even while rolling; not while dead", () => {
		const s = createSimState(1, 0, 0);
		step(s, SWAP, {});
		expect(s.combat.weapons.activeSet).toBe(1);
		expect(s.events.weaponSwapped).toBe(1);
		step(s, SWAP, {});
		expect(s.combat.weapons.activeSet).toBe(1); // held
		expect(s.events.weaponSwapped).toBe(0);
		step(s, frame(), {});
		step(s, frame({ buttons: Button.SWAP + Button.ROLL }), {});
		expect(s.player.rollTicks).toBeGreaterThan(0);
		expect(s.combat.weapons.activeSet).toBe(0);
		const d = createSimState(1, 0, 0);
		d.player.dead = 1;
		step(d, SWAP, {});
		expect(d.combat.weapons.activeSet).toBe(0);
	});
});

describe("triggers", () => {
	it("'press' fires on the FIRE edge only; 'custom' never calls fire and steps every tick", () => {
		const s = createSimState(1, 0, 0, { loadout: ["test.press", undefined] });
		pressFires = 0;
		for (let t = 0; t < 5; t++) step(s, FIRE, {}); // held: once, although its cooldown is 0
		expect(pressFires).toBe(1);
		step(s, frame(), {});
		step(s, FIRE, {});
		expect(pressFires).toBe(2);
		const t = createSimState(1, 0, 0, { loadout: ["test.custom", undefined] });
		customSteps = 0;
		step(t, FIRE, {});
		step(t, FIRE, {});
		step(t, frame(), {}); // released
		expect(customSteps).toBe(3);
		expect(t.combat.weapons.sets[0].v[0]).toBe(1);
	});
});

// --- sword (src/sim/weapons/defs/sword.test.ts) -------------------------------------------------------------------

const aimed = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: 1000, ...over });
const S_IDLE = aimed();
const S_FIRE = aimed({ buttons: Button.FIRE });
const S_ALT = aimed({ buttons: Button.ALT });
const SWORD: SimConfig = { loadout: ["weapon.sword", "weapon.bow"] };
const withSword = (spawns: ActorSpawn[]): SimConfig => ({ ...SWORD, encounter: enc(spawns) });
const D = SWORD_DATA;
/** Ticks of the combo with FIRE held from tick 0: swing 1, swing 2, finisher, then swing 1 again. */
const COMBO = [0, D.swingRecoveryTicks, 2 * D.swingRecoveryTicks + D.finisherWindupTicks];
const CYCLE = COMBO[2] + D.finisherRecoveryTicks;

describe("sword: FIRE combo", () => {
	it("holding FIRE swings 1, 2, then the wider, longer finisher after a short wind-up, then starts over", () => {
		const s = createSimState(1, 0, 0, SWORD);
		const swings: { t: number; radius: number; halfCos: number; last: number }[] = [];
		for (let t = 0; t <= CYCLE + D.swingRecoveryTicks; t++) {
			step(s, S_FIRE, SWORD);
			const w = s.combat.weapons;
			if (s.events.meleeSwings !== 0) {
				swings.push({ t, radius: w.swingRadius, halfCos: w.swingHalfCos, last: w.sets[0].v[SWORD_V_LAST] });
			}
			expect(s.events.meleeSwings).toBeLessThanOrEqual(1);
		}
		expect(COMBO).toEqual([0, 12, 33]);
		expect(swings).toEqual([
			{ t: 0, radius: D.reach, halfCos: D.halfAngleCos, last: 1 },
			{ t: 12, radius: D.reach, halfCos: D.halfAngleCos, last: 2 },
			{ t: 33, radius: D.finisherReach, halfCos: D.finisherHalfAngleCos, last: SWORD_FINISHER },
			{ t: CYCLE, radius: D.reach, halfCos: D.halfAngleCos, last: 1 },
			{ t: CYCLE + 12, radius: D.reach, halfCos: D.halfAngleCos, last: 2 },
		]);
		expect(s.combat.playerSpawned).toBe(0); // melee: no bullets
	});

	it("deals 3, 3, then 6 to an actor in the arc (a 10-hp dummy: 7, 4, then dead on the finisher)", () => {
		const config = withSword([{ kind: "test.dummy", x: 0, z: 1.6 }]);
		const s = createSimState(1, 0, 0, config);
		const hp: number[] = [];
		for (let t = 0; t <= CYCLE; t++) {
			step(s, S_FIRE, config);
			if (s.events.meleeSwings !== 0) hp.push(s.combat.actors[0].hp);
		}
		expect([D.damage, D.finisherDamage]).toEqual([3, 6]);
		// The finisher kills (6 > the 4 left); the next combo swings at nothing.
		expect(hp).toEqual([10 - D.damage, 10 - 2 * D.damage, 0, 0]);
		expect(s.combat.actors[0].alive).toBe(0);
	});

	it("kills a 12-hp turret in one combo (3 + 3 + 6)", () => {
		const config = withSword([{ kind: "turret.sprayer", x: 0, z: 1.5 }]);
		const s = createSimState(1, 0, 0, config);
		s.player.iframeTicks = 100000; // test-only: ignore its rings
		let killTick = -1;
		for (let t = 0; t < 3 * CYCLE && killTick < 0; t++) {
			step(s, S_FIRE, config);
			if (s.events.enemiesKilled !== 0) killTick = t;
		}
		expect(killTick).toBe(COMBO[2]); // 3 + 3 + 6 = 12: the finisher kills
	});

	it("lunges lungeDistance forward during the wind-up (through the move path), walking slowed", () => {
		const s = createSimState(1, 0, 0, SWORD);
		for (let t = 0; t < COMBO[2]; t++) step(s, S_FIRE, SWORD);
		expect(s.combat.weapons.sets[0].v[SWORD_V_STEP]).toBe(SWORD_STEP_WINDUP);
		expect(s.player.z).toBeCloseTo((D.lungeDistance * (D.finisherWindupTicks - 1)) / D.finisherWindupTicks, 12);
		step(s, S_FIRE, SWORD);
		expect(s.events.meleeSwings).toBe(1);
		expect(s.player.z).toBeCloseTo(D.lungeDistance, 12);
		expect(s.combat.weapons.swingZ).toBeCloseTo(D.lungeDistance, 12); // the finisher strikes from the lunge's end
		// With bounds, the lunge stops at the wall like walking does.
		const walled: SimConfig = { ...SWORD, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 0.2 } };
		const b = createSimState(1, 0, 0, walled);
		for (let t = 0; t <= COMBO[2]; t++) step(b, S_FIRE, walled);
		expect(b.player.z).toBe(0.2);
	});

	it("resets to swing 1 after comboWindowTicks idle; within the window the combo continues", () => {
		const s = createSimState(1, 0, 0, SWORD);
		step(s, S_FIRE, SWORD); // swing 1
		for (let t = 1; t < D.swingRecoveryTicks + D.comboWindowTicks - 1; t++) step(s, S_IDLE, SWORD);
		step(s, S_FIRE, SWORD); // last tick of the window
		expect(s.events.meleeSwings).toBe(1);
		expect(s.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(2);

		const r = createSimState(1, 0, 0, SWORD);
		step(r, S_FIRE, SWORD);
		for (let t = 1; t < D.swingRecoveryTicks + D.comboWindowTicks; t++) step(r, S_IDLE, SWORD);
		step(r, S_FIRE, SWORD);
		expect(r.events.meleeSwings).toBe(1);
		expect(r.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(1);
	});

	it("a roll cancels the wind-up; no swings while rolling or dead", () => {
		const s = createSimState(1, 0, 0, SWORD);
		for (let t = 0; t < COMBO[2] - 3; t++) step(s, S_FIRE, SWORD);
		expect(s.combat.weapons.sets[0].v[SWORD_V_STEP]).toBe(SWORD_STEP_WINDUP);
		step(s, aimed({ buttons: Button.FIRE + Button.ROLL }), SWORD);
		let swings = s.events.meleeSwings;
		while (s.player.rollTicks > 1) {
			step(s, S_FIRE, SWORD);
			swings += s.events.meleeSwings;
		}
		expect(swings).toBe(0);
		step(s, S_FIRE, SWORD); // the roll's last tick is over: swinging again, from swing 1
		expect(s.player.rollTicks).toBe(0);
		expect(s.events.meleeSwings).toBe(1);
		expect(s.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(1);
		const d = createSimState(1, 0, 0, SWORD);
		d.player.dead = 1;
		step(d, S_FIRE, SWORD);
		expect(d.events.meleeSwings).toBe(0);
	});
});

describe("sword: ALT guard", () => {
	it("has a cooldown from its start, which keeps counting while the sword is holstered; it cancels the combo", () => {
		const s = createSimState(1, 0, 0, SWORD);
		const guards: number[] = [];
		for (let t = 0; t < 2 * D.guardCooldownTicks + 1; t++) {
			// ALT pressed every other tick (edges), SWAP out and back in the middle.
			const swap = t === 30 || t === 32 ? Button.SWAP : 0;
			step(s, aimed({ buttons: (t % 2 === 0 ? Button.ALT : 0) + swap }), SWORD);
			if (s.combat.weapons.activeSet === 0 && s.combat.weapons.sets[0].v[SWORD_V_GUARD] === D.guardTicks - 1) {
				guards.push(t);
			}
		}
		expect(guards).toEqual([0, D.guardCooldownTicks, 2 * D.guardCooldownTicks]);
		// A guard mid-combo: the next swing is swing 1.
		const c = createSimState(1, 0, 0, SWORD);
		step(c, S_FIRE, SWORD);
		step(c, S_ALT, SWORD);
		for (let t = 0; t < D.guardTicks + 1; t++) step(c, S_IDLE, SWORD);
		step(c, S_FIRE, SWORD);
		expect(c.events.meleeSwings).toBe(1);
		expect(c.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(1);
	});
});

describe("sword: SWAP mid-combo", () => {
	it("swapping away and back resets the combo; a wind-up in progress never strikes", () => {
		const s = createSimState(1, 0, 0, SWORD);
		for (let t = 0; t <= D.swingRecoveryTicks; t++) step(s, S_FIRE, SWORD); // swings 1 and 2
		expect(s.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(2);
		step(s, aimed({ buttons: Button.SWAP }), SWORD); // to the bow
		step(s, S_IDLE, SWORD);
		step(s, aimed({ buttons: Button.SWAP + Button.FIRE }), SWORD); // back, FIRE on the same tick
		expect(s.combat.weapons.activeSet).toBe(0);
		expect(s.events.meleeSwings).toBe(1);
		expect(s.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(1); // swing 1 again, not the finisher

		const w = createSimState(1, 0, 0, SWORD);
		for (let t = 0; t <= COMBO[2] - 4; t++) step(w, S_FIRE, SWORD); // into the wind-up
		expect(w.combat.weapons.sets[0].v[SWORD_V_STEP]).toBe(SWORD_STEP_WINDUP);
		step(w, aimed({ buttons: Button.SWAP + Button.FIRE }), SWORD); // bow in hand, FIRE held: arrows
		let swings = 0;
		for (let t = 0; t < 20; t++) {
			step(w, S_FIRE, SWORD);
			swings += w.events.meleeSwings;
		}
		expect(swings).toBe(0);
		expect(w.combat.playerSpawned).toBeGreaterThan(0);
		// While the bow is in hand the sword's state does not slow the player.
		const z = w.player.z;
		step(w, aimed({ moveZ: 1000, buttons: 0 }), SWORD);
		expect(w.player.z - z).toBeCloseTo(0.1, 12);
	});

	it("swapping to the bow and pressing FIRE shoots an arrow (payload source = weapon index + 1)", () => {
		const s = createSimState(1, 0, 0, SWORD);
		step(s, aimed({ buttons: Button.SWAP }), SWORD);
		step(s, aimed({ buttons: Button.FIRE }), SWORD);
		expect(s.events.shotsFired).toBe(1);
		expect(s.combat.playerBullets.activeCount).toBe(1);
		s.combat.playerBullets.forEachActive((_i, _p, payload) => {
			expect(BulletPayload.get(payload, "source")).toBe(weaponIndex("weapon.bow") + 1);
		});
	});
});

// --- bullets (src/sim/weapons/weapons.test.ts, src/sim/weapons/defs/sword.test.ts) ------------------------------

/** The placeholder gun + placeholder swing (the default loadout before the E1.8 sword and bow). */
const PLACEHOLDERS: SimConfig = { loadout: ["weapon.test", "weapon.test.melee"] };

/**
 * An enemy bullet at (x, z) with velocity (vx, vz) per second (test code may build patterns directly; the source
 * went through gen.arc with an atan2 heading, which lands within an ulp of the same velocity).
 */
function enemyBullet(s: SimState, x: number, z: number, vx = 0, vz = 0, damage = 0): void {
	const payload = packPayload(damage, BulletKind.ENEMY, 0);
	s.combat.enemyBullets.fireAt(
		{ x, y: BULLET_Y, z },
		() => {
			const p = acquireSpawnData();
			p.velocity.x = vx;
			p.velocity.z = vz;
			p.payload = payload;
			return [p];
		},
		0,
	);
}

/** Positions of the live enemy bullets, sorted, rounded (for set comparisons). */
function bulletSpots(s: SimState): string[] {
	const out: string[] = [];
	s.combat.enemyBullets.forEachActive((_i, p) => {
		out.push(string.format("%.2f,%.2f", p.x, p.z));
	});
	out.sort();
	return out;
}

describe("player bullets and per-set cooldowns", () => {
	it("player bullets carry the weapon index + 1 as their payload source", () => {
		const s = createSimState(1, 0, 0, PLACEHOLDERS);
		step(s, FIRE, {});
		expect(s.combat.playerBullets.activeCount).toBeGreaterThan(0);
		s.combat.playerBullets.forEachActive((_i, _p, payload) => {
			expect(BulletPayload.get(payload, "source")).toBe(weaponIndex("weapon.test") + 1);
		});
	});

	it("cooldowns belong to sets and keep counting while holstered; a swap and a shot can share a tick", () => {
		const s = createSimState(1, 0, 0, PLACEHOLDERS);
		step(s, FIRE, {}); // tick 0: the gun fires (cooldown 9)
		expect(s.events.shotsFired).toBe(1);
		step(s, SWAP_FIRE, {}); // tick 1: swap to the melee set, which swings at once
		expect(s.events.meleeSwings).toBe(1);
		expect(s.events.shotsFired).toBe(0);
		expect(s.combat.weapons.sets[1].cooldown).toBe(TEST_MELEE_DATA.cooldownTicks);
		step(s, frame({ buttons: Button.FIRE }), {});
		step(s, SWAP_FIRE, {}); // tick 3: back to the gun, still cooling down (9 - 3)
		expect(s.combat.weapons.activeSet).toBe(0);
		expect(s.events.shotsFired).toBe(0);
		expect(s.combat.weapons.sets[0].cooldown).toBe(PLAYER_FIRE_TICKS - 3);
		for (let i = 0; i < PLAYER_FIRE_TICKS - 3 - 1; i++) step(s, FIRE, {});
		expect(s.events.shotsFired).toBe(0);
		step(s, FIRE, {});
		expect(s.events.shotsFired).toBe(1); // tick 9: 9 ticks after the first shot, as without the swap
	});
});

describe("melee (placeholder swing via sweepArc)", () => {
	it("hits every actor whose body reaches into the arc, and only those", () => {
		// Player at the origin facing +Z (aim). Dummies: in front within reach, in front beyond reach, behind, to the
		// side just outside the 60-degree half-angle.
		const reach = TEST_MELEE_DATA.reach;
		const config: SimConfig = {
			loadout: ["weapon.test.melee", undefined],
			encounter: enc([
				{ kind: "test.dummy", x: 0, z: 1.2 },
				{ kind: "test.dummy", x: 0, z: reach + 0.5 + 0.2 },
				{ kind: "test.dummy", x: 0, z: -1.2 },
				{ kind: "test.dummy", x: 1.8, z: 0.6 },
			]),
		};
		const s = createSimState(1, 0, 0, config);
		step(s, aimed({ buttons: Button.FIRE }), config);
		expect(s.events.meleeSwings).toBe(1);
		expect(s.combat.actors.map((a) => a.hp)).toEqual([10 - TEST_MELEE_DATA.damage, 10, 10, 10]);
		expect(s.events.enemyHits).toBe(1);
		const w = s.combat.weapons;
		expect([w.swingTick, w.swingX, w.swingZ, w.swingDirX, w.swingDirZ, w.swingRadius, w.swingHalfCos]).toEqual([
			0,
			0,
			0,
			0,
			1,
			reach,
			TEST_MELEE_DATA.halfAngleCos,
		]);
		expect(s.combat.playerBullets.activeCount).toBe(0); // melee fires no bullets
	});

	it("deletes the enemy bullets inside the arc (not behind, not beyond reach)", () => {
		const reach = TEST_MELEE_DATA.reach;
		const s = createSimState(1, 0, 0, { loadout: ["weapon.test.melee", undefined] });
		s.player.iframeTicks = 100; // let the bullets sit on the player harmlessly (test-only poke)
		enemyBullet(s, 0, 0.8);
		enemyBullet(s, 0.5, 1.0);
		enemyBullet(s, 0, -0.8);
		enemyBullet(s, 0, reach + 0.3);
		enemyBullet(s, 1.2, 0.2); // ~80 degrees off the facing: outside
		step(s, aimed({ buttons: Button.FIRE }), {});
		expect(s.events.bulletsDeleted).toBe(2);
		expect(s.combat.enemyBullets.activeCount).toBe(3);
	});
});

describe("sword: enemy bullets", () => {
	it("each swing deletes the enemy bullets inside its arc, and only those", () => {
		const s = createSimState(1, 0, 0, SWORD);
		s.player.iframeTicks = 1000; // test-only: let bullets sit on the player harmlessly
		enemyBullet(s, 0, 1.0); // in front: in
		enemyBullet(s, 0.9, 1.0); // ~42 degrees off: in (120-degree arc)
		enemyBullet(s, 0, D.reach - 0.05); // at the tip: in
		enemyBullet(s, 0, -0.8); // behind: out
		enemyBullet(s, 0, D.reach + 0.2); // beyond reach: out (the finisher reaches it)
		enemyBullet(s, 1.5, 0.7); // ~65 degrees off: out (the finisher's half circle reaches it)
		enemyBullet(s, -1.0, -0.3); // behind the side: out for every swing
		step(s, S_FIRE, SWORD);
		expect(s.events.bulletsDeleted).toBe(3);
		const spots = ["-1.00,-0.30", "0.00,-0.80", "0.00,1.90", "1.50,0.70"];
		spots.sort();
		expect(bulletSpots(s)).toEqual(spots);
		// Swing 2: nothing new inside its arc.
		for (let t = 0; t < D.swingRecoveryTicks; t++) step(s, S_FIRE, SWORD);
		expect(s.events.bulletsDeleted).toBe(0);
		// Finisher: longer and wider, from the end of the lunge (z = lungeDistance).
		let deleted = 0;
		for (let t = 0; t < D.swingRecoveryTicks + D.finisherWindupTicks; t++) {
			step(s, S_FIRE, SWORD);
			deleted += s.events.bulletsDeleted;
		}
		expect(s.combat.weapons.sets[0].v[SWORD_V_LAST]).toBe(SWORD_FINISHER);
		expect(deleted).toBe(2);
		const left = ["-1.00,-0.30", "0.00,-0.80"];
		left.sort();
		expect(bulletSpots(s)).toEqual(left);
	});

	it("the guard deletes enemy bullets in a wide frontal arc every tick for guardTicks, without damage or a swing", () => {
		const config = withSword([{ kind: "test.dummy", x: 0, z: 1.2 }]);
		const s = createSimState(1, 0, 0, config);
		const deletedAt: number[] = [];
		// A stream of bullets flying at the player from the front, one fired every tick, 2 tiles out.
		for (let t = 0; t < D.guardTicks + 10; t++) {
			enemyBullet(s, 0.3, 1.8, 0, -6, HIT_NORMAL);
			step(s, t === 0 ? S_ALT : S_IDLE, config);
			if (s.events.bulletsDeleted > 0) deletedAt.push(t);
			expect(s.events.meleeSwings).toBe(0);
		}
		expect(D.guardTicks).toBe(18);
		expect(deletedAt[0]).toBe(0);
		expect(deletedAt[deletedAt.size() - 1]).toBe(D.guardTicks - 1);
		expect(s.combat.actors[0].hp).toBe(10);
	});

	it("the guard protects the player from the front while up; a bullet from behind still lands", () => {
		const s = createSimState(1, 0, 0, SWORD);
		step(s, S_ALT, SWORD);
		enemyBullet(s, 0, 2.5, 0, -8, HIT_NORMAL);
		for (let t = 0; t < D.guardTicks - 1; t++) step(s, S_IDLE, SWORD);
		expect(s.player.hearts).toBe(6);
		const b = createSimState(1, 0, 0, SWORD);
		step(b, S_ALT, SWORD);
		enemyBullet(b, 0, -1.5, 0, 8, HIT_NORMAL);
		for (let t = 0; t < 12; t++) step(b, S_IDLE, SWORD);
		expect(b.player.hearts).toBe(5);
	});
});
