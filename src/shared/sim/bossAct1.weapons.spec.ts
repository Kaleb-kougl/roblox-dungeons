// 'boss.act1' against the real E1.8 weapons (source: `src/sim/actors/archetypes/boss/act1.weapons.test.ts` @ 42897e2):
// the sword's swings and guard delete the boss's bullets (GDD: melee deletes enemy bullets inside its arc), and the
// bow's piercing heavy arrow goes through the boss without getting around its per-second damage cap (it hits the boss
// once, then pierces on into what stands behind it). Real dungeon (seed 1337 / 42), the boss alone in its room
// ({ boss } encounter), the player teleported in to engage. Per-tick checks are collected into one expect each (jest's
// expect is slow under Lune); a failure lists the offending ticks.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bossDoorSpawn,
	bulletBlocker,
	circleMover,
	circleOverlapsWall,
	generateDungeon,
	placeEncounter,
	type Dungeon,
} from "shared/dungeon";
import { hypot2, jsRound } from "shared/jsmath";
import {
	AXIS_MAX,
	AiState,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	BOW_DATA,
	BossState,
	Button,
	DAMAGE_CAP_BUCKETS,
	DAMAGE_CAP_BUCKET_TICKS,
	DAMAGE_CAP_WINDOW_SECONDS,
	EMPTY_INPUT,
	PLAYER_RADIUS,
	SWORD_DATA,
	SimCtx,
	createSimState,
	step,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import "shared/sim/testing";

const CAP = BOSS_ACT1_DATA.damageCapPerSecond!;
/** Any window of this many ticks spans at most DAMAGE_CAP_BUCKETS cap buckets: hp lost in it <= the cap. */
const CAP_WINDOW = (DAMAGE_CAP_BUCKETS - 1) * DAMAGE_CAP_BUCKET_TICKS;

interface Arena {
	d: Dungeon;
	state: SimState;
	config: SimConfig;
	boss: ActorState;
}

/** The boss alone in its room, the player teleported `dist` east of it and stepped until the intro roar is over. */
function engaged(seed: number, loadout: ReadonlyArray<string | undefined>, dist = 3): Arena {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const config: SimConfig = {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, { boss: BOSS_ACT1_ID }),
		loadout,
	};
	const spawn = bossDoorSpawn(d)!;
	const state = createSimState(seed, spawn.x, spawn.z, config);
	const boss = state.combat.actors[0];
	state.player.x = boss.x + dist;
	state.player.z = boss.z;
	for (let i = 0; i < 600 && boss.phase === 0; i++) {
		step(state, EMPTY_INPUT, config);
		state.player.hearts = state.player.heartsMax;
	}
	expect(boss.phase).toBe(1);
	// The intro roar (immune).
	for (let i = 0; i < BOSS_ACT1_DATA.introTicks; i++) {
		step(state, EMPTY_INPUT, config);
		state.player.hearts = state.player.heartsMax;
	}
	expect(boss.aiState).never.toBe(BossState.TRANSITION);
	return { d, state, config, boss };
}

/** Aim (and walk: radial correction toward `want`) at the boss. */
function toward(s: SimState, boss: ActorState, want: number, buttons: number): InputFrame {
	const dx = boss.x - s.player.x;
	const dz = boss.z - s.player.z;
	const h = hypot2(dx, dz);
	const dist = h !== 0 ? h : 1;
	const radial = math.max(-1, math.min(1, (dist - want) * 0.8));
	return {
		moveX: jsRound((dx / dist) * radial * AXIS_MAX),
		moveZ: jsRound((dz / dist) * radial * AXIS_MAX),
		aimX: jsRound((dx / dist) * AXIS_MAX),
		aimZ: jsRound((dz / dist) * AXIS_MAX),
		buttons,
	};
}

for (const seed of [1337, 42]) {
	describe(`boss.act1 vs the sword (seed ${seed})`, () => {
		it("combo swings hit the boss and delete its bullets inside their arc", () => {
			const { state, config, boss } = engaged(seed, ["weapon.sword", "weapon.bow"], 2.3);
			let deleted = 0;
			let swings = 0;
			let deletingSwings = 0;
			const bad: string[] = [];
			const hp0 = boss.hp;
			for (let i = 0; i < 40 * 60 && boss.alive !== 0; i++) {
				step(state, toward(state, boss, 2.3, Button.FIRE), config);
				state.player.hearts = state.player.heartsMax;
				const e = state.events;
				swings += e.meleeSwings;
				deleted += e.bulletsDeleted;
				if (e.meleeSwings > 0 && e.bulletsDeleted > 0 && e.bossPhase === 0) {
					deletingSwings++;
					// Only the boss shoots in this room: the deleted bullets are its own (no Ember, no roar on this tick).
					if (e.bulletsCleared !== 0) bad.push(`tick ${state.tick - 1}: bulletsCleared ${e.bulletsCleared}`);
				}
				// A swing is the only thing that deletes bullets here (no guard pressed).
				if (e.bulletsDeleted > 0 && !(e.meleeSwings > 0))
					bad.push(`tick ${state.tick - 1}: deleted without a swing`);
			}
			print(
				`[boss.act1 / sword] seed ${seed}: ${swings} swings, ${deletingSwings} deleted boss bullets (${deleted} bullets), boss hp ${hp0} -> ${boss.hp}`,
			);
			expect(bad).toEqual([]);
			expect(swings).toBeGreaterThan(100);
			expect(deletingSwings).toBeGreaterThan(5);
			expect(deleted).toBeGreaterThan(20);
			expect(boss.hp).toBeLessThan(hp0);
		});

		it("the guard (ALT) deletes boss bullets without dealing damage", () => {
			const { state, config, boss } = engaged(seed, ["weapon.sword", "weapon.bow"], 3);
			const hp0 = boss.hp;
			let deleted = 0;
			let guards = 0;
			const bad: string[] = [];
			const every = SWORD_DATA.guardCooldownTicks + 1;
			for (let i = 0; i < 40 * 60; i++) {
				// ALT pressed for one tick, once per guard cooldown (a fresh press edge each time). No FIRE.
				const alt = i % every === 0;
				if (alt) guards++;
				step(state, toward(state, boss, 3, alt ? Button.ALT : 0), config);
				state.player.hearts = state.player.heartsMax;
				deleted += state.events.bulletsDeleted;
				// The guard records no swing and deals no damage.
				if (state.events.meleeSwings !== 0)
					bad.push(`tick ${state.tick - 1}: meleeSwings ${state.events.meleeSwings}`);
				if (state.events.damageDealt !== 0)
					bad.push(`tick ${state.tick - 1}: damage ${state.events.damageDealt}`);
			}
			print(`[boss.act1 / guard] seed ${seed}: ${guards} guards deleted ${deleted} boss bullets`);
			expect(bad).toEqual([]);
			expect(deleted).toBeGreaterThan(10);
			expect(boss.hp).toBe(hp0);
		});
	});
}

for (const seed of [1337, 42]) {
	describe(`boss.act1 vs the bow (seed ${seed})`, () => {
		it("a heavy arrow hits the boss once, only up to its cap, and pierces on into the two actors behind it", () => {
			const { d, state, config, boss } = engaged(seed, ["weapon.bow", "weapon.sword"], 5);
			// Wait for the boss to stand still (its first telegraph), then line two dummies up behind it, west of its center.
			for (let i = 0; i < 120 && boss.aiState !== AiState.TELEGRAPH; i++) {
				step(state, toward(state, boss, 5, 0), config);
			}
			const ctx = new SimCtx().bind(state, config, EMPTY_INPUT);
			const behind: ActorState[] = [];
			for (const off of [2.6, 4]) {
				const x = boss.x - off;
				expect(circleOverlapsWall(d, x, boss.z, 0.5)).toBe(false); // the arena is wide open around its center
				const a = ctx.spawnActor("test.dummy", x, boss.z);
				expect(a).never.toBe(undefined);
				behind.push(a!);
			}
			// Aim straight west through the boss's center from 5 units east.
			state.player.x = boss.x + 5;
			state.player.z = boss.z;
			const aimWest: InputFrame = { moveX: 0, moveZ: 0, aimX: -AXIS_MAX, aimZ: 0, buttons: 0 };
			for (let i = 0; i <= BOW_DATA.chargeTicks + 1; i++) {
				step(state, { ...aimWest, buttons: Button.ALT }, config);
				state.player.hearts = state.player.heartsMax;
			}
			// All but 1 of the cap window's budget (cap x 2 s) already spent (as if the stream had just hit it): 1 left.
			const BUDGET = CAP * DAMAGE_CAP_WINDOW_SECONDS;
			const hpBefore = boss.hp;
			new SimCtx().bind(state, config, EMPTY_INPUT).damageActor(boss, BUDGET - 1);
			expect(hpBefore - boss.hp).toBe(BUDGET - 1);
			const dummyBefore = behind.map((a) => a.hp);
			let shots = 0;
			for (let i = 0; i < 45; i++) {
				step(state, aimWest, config); // ALT released: the heavy arrow
				state.player.hearts = state.player.heartsMax;
				shots += state.events.shotsFired;
			}
			expect(shots).toBe(1);
			// The boss: the 4-damage arrow only takes what is left of the window (1), so the window's total is the budget.
			expect(hpBefore - boss.hp).toBe(BUDGET);
			// Both dummies behind it: heavyDamage each (the cap is the boss's own, the arrow keeps its damage).
			expect(behind.map((a, i) => dummyBefore[i] - a.hp)).toEqual([BOW_DATA.heavyDamage, BOW_DATA.heavyDamage]);
		});

		it("heavy arrows and the stream together never beat the damage cap (any 2 s window)", () => {
			const { state, config, boss } = engaged(seed, ["weapon.bow", "weapon.sword"], 4);
			const hp: number[] = [boss.hp];
			let heavy = 0;
			let n = 0;
			// Cycle: charge 40 ticks (ALT), release, stream 30 ticks (FIRE). Raw ~8 dps, twice the cap.
			for (let i = 0; i < 30 * 60 && boss.alive !== 0; i++) {
				const c = n % 72;
				n++;
				const buttons = c < 40 ? Button.ALT : c >= 42 ? Button.FIRE : 0;
				step(state, toward(state, boss, 4, buttons), config);
				state.player.hearts = state.player.heartsMax;
				if ((c === 40 || c === 41) && state.events.shotsFired > 0) heavy++;
				if (state.events.bossPhase > 0) n = 0;
				hp.push(boss.hp);
			}
			let max = 0;
			for (let i = CAP_WINDOW; i < hp.size(); i++) max = math.max(max, hp[i - CAP_WINDOW] - hp[i]);
			print(
				`[boss.act1 / bow] seed ${seed}: ${heavy} heavy arrows, max hp lost in any ${CAP_WINDOW}-tick window ${string.format(
					"%.2f",
					max,
				)} (cap ${CAP}/s, window budget ${CAP * DAMAGE_CAP_WINDOW_SECONDS})`,
			);
			expect(heavy).toBeGreaterThan(15);
			const budget = CAP * DAMAGE_CAP_WINDOW_SECONDS;
			expect(max).toBeLessThanOrEqual(budget + 1e-9);
			expect(max).toBeGreaterThan(budget * 0.75); // the cap is what limits this build's bursts
			expect(hp[0] - boss.hp).toBeLessThanOrEqual(32 * CAP + 1e-9);
		});
	});
}
