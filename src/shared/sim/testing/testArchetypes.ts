/**
 * Test-only archetypes (source: `src/sim/actors/__test__/testArchetypes.ts`; never imported by the game): exercise the
 * generic actor paths (walking through the world, line of sight, contact damage, rng, runtime spawns, telegraphs,
 * phases, the damage cap, onDeath) in unit and determinism tests. Importing this module registers them, so import it
 * at the top of a spec (before any createSimState: the registry seals when the first run starts). Each spec file runs
 * in its own module world, so the extra ids never reach another spec's index table.
 *
 * @module
 */

import { SIM_DT } from "../units";
import { HIT_HEAVY, HIT_NORMAL, secondsToTicks } from "../playerData";
import { BulletKind, FULL_RING, type BurstSpec } from "../combat/patterns";
import { faceToward, toPlayer, walkToward } from "../combat/actors/helpers";
import { registerArchetype } from "../combat/actors/registry";
import { AiState, type ArchetypeData } from "../combat/actors/types";

/** Does nothing; 10 hp. A target for damage, melee and cap tests. */
export const TEST_DUMMY = registerArchetype<ArchetypeData>({
	id: "test.dummy",
	data: { hp: 10, radius: 0.5, speed: 0, contactDamage: 0, spriteId: "enemy.bruiser" },
	step() {},
});

const CHASER_SHOT: BurstSpec = { count: 1, spread: 0, speed: 6, life: 2, damage: HIT_NORMAL, kind: BulletKind.ENEMY };
const CHASE_RANGE = 12;
const CHASER_HESITATE_CHANCE = 0.01;
const CHASER_HESITATE_TICKS = 20;

/** Walks at the player while it can see them (with a random hesitation), touches for 1, shoots a single bullet now and then. */
export const TEST_CHASER = registerArchetype<ArchetypeData>({
	id: "test.chaser",
	data: { hp: 4, radius: 0.35, speed: 3, contactDamage: HIT_NORMAL, spriteId: "enemy.swarmer" },
	init(ctx, a) {
		a.cooldown = ctx.randomInt(30, 90);
	},
	step(ctx, a) {
		const p = ctx.player;
		const tp = toPlayer(ctx, a);
		if (p.dead !== 0 || tp.dist > CHASE_RANGE || !ctx.lineOfSight(a.x, a.z, p.x, p.z)) return;
		if (a.v[0] > 0) {
			a.v[0]--; // hesitating
		} else {
			walkToward(ctx, a, p.x, p.z, ctx.data(a).speed * SIM_DT);
			if (ctx.random() < CHASER_HESITATE_CHANCE) a.v[0] = CHASER_HESITATE_TICKS;
		}
		a.cooldown -= 1;
		if (a.cooldown <= 0) {
			ctx.fireEnemy(a, tp.dirX, tp.dirZ, CHASER_SHOT);
			a.cooldown = ctx.randomInt(60, 120);
		}
	},
});

interface TestBossData extends ArchetypeData {
	telegraphTicks: number;
	ring: BurstSpec;
}

export const TEST_BOSS_ATTACK_RING = 1;
const BOSS_PHASE_2_HP = 40;
const BOSS_PHASE_3_HP = 20;
const BOSS_WAKE_RANGE = 10;
const BOSS_MAX_ADDS = 3;
const BOSS_ADD_OFFSET = 1.2;

/** Three phases by hp, telegraphed rings, adds from phase 2, a damage cap; clears its bullets on death. */
export const TEST_BOSS = registerArchetype<TestBossData>({
	id: "test.boss",
	data: {
		hp: 60,
		radius: 0.9,
		speed: 0,
		contactDamage: HIT_HEAVY,
		spriteId: "boss.1",
		boss: true,
		damageCapPerSecond: 10,
		telegraphTicks: secondsToTicks(0.5),
		// Port deviation: 16 bullets (the source has 12). The sim reads V8's sin / cos from the arc table, which only
		// holds the shapes the game fires; a 16-bullet ring is one of them (turret.sprayer). No test depends on 12.
		ring: { count: 16, spread: FULL_RING, speed: 3, life: 4, damage: HIT_NORMAL, kind: BulletKind.BOSS },
	},
	init(ctx, a) {
		ctx.setPhase(a, 1);
		a.cooldown = 60;
	},
	step(ctx, a) {
		const d = ctx.data<TestBossData>(a);
		const tp = toPlayer(ctx, a);
		faceToward(a, tp.dx, tp.dz);
		if (ctx.player.dead !== 0 || tp.dist > BOSS_WAKE_RANGE) return;
		if (a.aiState === AiState.TELEGRAPH) {
			a.aiTicks -= 1;
			if (a.aiTicks > 0) return;
			ctx.fireEnemy(a, tp.dirX, tp.dirZ, d.ring);
			if (a.phase >= 2 && a.v[0] < BOSS_MAX_ADDS) {
				if (ctx.spawnActor("test.chaser", a.x + BOSS_ADD_OFFSET, a.z) !== undefined) a.v[0]++;
			}
			a.aiState = AiState.IDLE;
			a.cooldown = a.phase >= 3 ? 40 : 80;
			return;
		}
		a.cooldown -= 1;
		if (a.cooldown <= 0) ctx.telegraph(a, d.telegraphTicks, TEST_BOSS_ATTACK_RING);
	},
	onHit(ctx, a) {
		if (a.hp <= BOSS_PHASE_3_HP) ctx.setPhase(a, 3);
		else if (a.hp <= BOSS_PHASE_2_HP) ctx.setPhase(a, 2);
	},
	onDeath(ctx, a) {
		ctx.combat.enemyBullets.clear(a.emitterId);
	},
});
